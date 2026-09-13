import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { requireRole } from '@/lib/auth';
import { handler, ok, bad, num } from '@/lib/api';
import { validateRows, type Mapping } from '@/lib/import';
import { db, audit, logStage, notifyRole } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

/**
 * Commits a validated master file into a new ASR cycle:
 * creates/updates the org tree, upserts employees, creates one ASR record per
 * employee, and allocates the budget per division. Everything runs inside a
 * single transaction so a failure leaves no half-imported cycle behind.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireRole('REWARDS', 'ADMIN');
  const body = await req.json();

  const token = String(body.token ?? '');
  const p = path.join(UPLOAD_DIR, `${path.basename(token)}.json`);
  if (!token || !fs.existsSync(p)) return bad('Upload session expired — please upload the file again.', 410);

  const cached = JSON.parse(fs.readFileSync(p, 'utf8'));
  const mapping: Mapping = body.mapping;
  const report = validateRows(cached.rows, mapping);

  if (report.errorCount > 0) {
    return bad(`The file still has ${report.errorCount} blocking error${report.errorCount > 1 ? 's' : ''}. Resolve them in the source workbook and upload again.`, 409);
  }
  if (report.valid.length === 0) return bad('No valid rows to import');

  const cycleName = String(body.cycleName ?? '').trim() || `Annual Salary Review ${new Date().getFullYear() + 1}`;
  const year = num(body.year, new Date().getFullYear() + 1);
  const totalBudget = Math.round(num(body.totalBudget, 0));
  const effectiveDate = String(body.effectiveDate ?? '') || null;
  const deadline = String(body.reviewDeadline ?? '') || null;
  const allocations: Record<string, number> = body.allocations ?? {};

  if (totalBudget <= 0) return bad('Enter the total ASR budget provided by Rewards.');

  const gradeByCode = new Map(
    (db.prepare(`SELECT id, code FROM job_grades`).all() as { id: number; code: string }[])
      .map((g) => [g.code.toUpperCase(), g.id]),
  );

  let cycleId = 0;

  const run = db.transaction(() => {
    cycleId = Number(db.prepare(
      `INSERT INTO asr_cycles (name, year, status, total_budget, source_file, effective_date,
          review_deadline, created_by, validated_at)
       VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
    ).run(cycleName, year, 'DRAFT', totalBudget, cached.fileName, effectiveDate, deadline, user.id).lastInsertRowid);

    /* ---- org tree: create anything the file introduces ---- */
    const divIds = new Map<string, number>();
    const deptIds = new Map<string, number>();
    const subIds = new Map<string, number>();

    const findDiv = db.prepare(`SELECT id FROM divisions WHERE lower(name) = lower(?)`);
    const insDiv = db.prepare(`INSERT INTO divisions (code, name) VALUES (?,?)`);
    const findDept = db.prepare(`SELECT id FROM departments WHERE division_id = ? AND lower(name) = lower(?)`);
    const insDept = db.prepare(`INSERT INTO departments (division_id, code, name) VALUES (?,?,?)`);
    const findSub = db.prepare(`SELECT id FROM sub_departments WHERE department_id = ? AND lower(name) = lower(?)`);
    const insSub = db.prepare(`INSERT INTO sub_departments (department_id, name) VALUES (?,?)`);

    const codeFor = (s: string, salt: string) =>
      (s.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || 'UNIT') + '-' + salt;

    for (const r of report.valid) {
      if (!divIds.has(r.division)) {
        const found = findDiv.get(r.division) as { id: number } | undefined;
        divIds.set(r.division, found?.id ?? Number(insDiv.run(codeFor(r.division, String(divIds.size + 1)), r.division).lastInsertRowid));
      }
      const dvId = divIds.get(r.division)!;

      const dKey = `${dvId}::${r.department}`;
      if (!deptIds.has(dKey)) {
        const found = findDept.get(dvId, r.department) as { id: number } | undefined;
        deptIds.set(dKey, found?.id ?? Number(insDept.run(dvId, codeFor(r.department, `${dvId}${deptIds.size + 1}`), r.department).lastInsertRowid));
      }
      const dpId = deptIds.get(dKey)!;

      if (r.subDepartment) {
        const sKey = `${dpId}::${r.subDepartment}`;
        if (!subIds.has(sKey)) {
          const found = findSub.get(dpId, r.subDepartment) as { id: number } | undefined;
          subIds.set(sKey, found?.id ?? Number(insSub.run(dpId, r.subDepartment).lastInsertRowid));
        }
      }
    }

    /* ---- employees (upsert by employee code) ---- */
    const findEmp = db.prepare(`SELECT id FROM employees WHERE emp_code = ?`);
    const insEmp = db.prepare(
      `INSERT INTO employees (emp_code, name, joining_date, job_title, grade_id, division_id,
          department_id, sub_department_id, line_manager_name, dept_head_name, division_head_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const updEmp = db.prepare(
      `UPDATE employees SET name=?, joining_date=?, job_title=?, grade_id=?, division_id=?,
          department_id=?, sub_department_id=?, line_manager_name=?, dept_head_name=?,
          division_head_name=?, is_active=1 WHERE id=?`,
    );
    const insRec = db.prepare(
      `INSERT INTO asr_records (cycle_id, employee_id, current_salary, eligibility_promotion,
          last_promotion_date, prev_asr_pct, status)
       VALUES (?,?,?,?,?,?, 'PENDING')`,
    );

    const asrEffective = effectiveDate ? new Date(effectiveDate) : new Date();

    for (const r of report.valid) {
      const dvId = divIds.get(r.division)!;
      const dpId = deptIds.get(`${dvId}::${r.department}`)!;
      const sbId = r.subDepartment ? subIds.get(`${dpId}::${r.subDepartment}`) ?? null : null;
      const gId = gradeByCode.get(r.grade)!;

      const existing = findEmp.get(r.empCode) as { id: number } | undefined;
      let empId: number;
      if (existing) {
        updEmp.run(r.name, r.joiningDate, r.jobTitle, gId, dvId, dpId, sbId,
          r.lineManager, r.deptHead, r.divisionHead, existing.id);
        empId = existing.id;
      } else {
        empId = Number(insEmp.run(r.empCode, r.name, r.joiningDate, r.jobTitle, gId, dvId, dpId, sbId,
          r.lineManager, r.deptHead, r.divisionHead).lastInsertRowid);
      }

      const basis = r.lastPromotion ?? r.joiningDate;
      const eligible = basis
        ? (asrEffective.getTime() - new Date(basis).getTime()) / 31557600000 >= 3 ? 1 : 0
        : 0;

      insRec.run(cycleId, empId, Math.round(r.salary), eligible, r.lastPromotion, r.prevAsr);
    }

    /* ---- budget allocation per division ---- */
    const insBudget = db.prepare(
      `INSERT INTO division_budgets (cycle_id, division_id, allocated_budget, status, deadline)
       VALUES (?,?,?, 'NOT_STARTED', ?)`,
    );
    for (const [name, id] of divIds) {
      insBudget.run(cycleId, id, Math.round(allocations[name] ?? 0), deadline);
    }

    /* ---- remember the mapping for next year ---- */
    db.prepare(
      `INSERT INTO column_mappings (name, mapping) VALUES (?,?)
         ON CONFLICT(name) DO UPDATE SET mapping = excluded.mapping`,
    ).run(`import-${year}`, JSON.stringify(mapping));

    /* ---- persist the validation warnings against the cycle ---- */
    const insIssue = db.prepare(
      `INSERT INTO validation_issues (cycle_id, row_num, severity, field, message) VALUES (?,?,?,?,?)`,
    );
    for (const i of report.issues.slice(0, 2000)) {
      insIssue.run(cycleId, i.row, i.severity, i.field, i.message);
    }
  });

  run();

  logStage({ cycleId, stage: 'ASR_RECEIVED', status: 'COMPLETED', actor: user, note: `Master file ${cached.fileName} provided by Rewards` });
  logStage({ cycleId, stage: 'ASR_UPLOADED', status: 'COMPLETED', actor: user, note: `${report.valid.length.toLocaleString('en-PK')} employee records uploaded` });
  logStage({ cycleId, stage: 'DATA_VALIDATED', status: 'COMPLETED', actor: user, note: `Validation passed — ${report.warningCount} warning(s), 0 blocking errors` });

  audit({ actor: user, action: 'CYCLE_CREATED', entity: 'asr_cycle', entityId: cycleId,
    after: { name: cycleName, employees: report.valid.length, totalBudget, divisions: report.divisions.length } });

  // Hand over to HR, who own everything from here.
  notifyRole('HR_MANAGER', {
    type: 'ASR_RECEIVED', severity: 'info',
    title: `${cycleName} has been provided by Rewards`,
    body: `${report.valid.length.toLocaleString('en-PK')} employees across ${report.divisions.length} divisions, with a total budget of PKR ${totalBudget.toLocaleString('en-PK')}. Review the allocations and distribute to the divisions.`,
    link: '/dashboard',
  });

  try { fs.unlinkSync(p); } catch { /* best effort */ }

  return ok({ cycleId, imported: report.valid.length, divisions: report.divisions.length, warnings: report.warningCount });
});
