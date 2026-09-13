import * as XLSX from 'xlsx';
import { db, audit, type SessionUser } from './db';
import { employeeScope } from './rbac';
import { divisionBudget, cycleBudget, MONTHS_PER_YEAR } from './budget';

/**
 * Exports obey exactly the same scope as the screens. A Director exporting
 * gets only their departments; nobody can widen the export by changing a URL.
 * Every export is written to the audit trail with the row count.
 */
export function buildWorkbook(user: SessionUser, cycleId: number, divisionId?: number) {
  const scope = employeeScope(user, 'e');
  const where = ['r.cycle_id = ?', scope.sql];
  const params: unknown[] = [cycleId, ...scope.params];
  if (divisionId) { where.push('e.division_id = ?'); params.push(divisionId); }

  const rows = db.prepare(
    `SELECT e.emp_code AS "Employee ID", e.name AS "Name", e.joining_date AS "Joining Date",
            e.job_title AS "Job Title", g.code AS "Job Grade", g.label AS "Grade Title",
            d.name AS "Division", p.name AS "Department", sd.name AS "Sub Department",
            e.line_manager_name AS "Line Manager",
            r.current_salary AS "Current Gross Salary",
            ROUND(r.proposed_increment_pct * 100, 2) AS "Proposed Merit Inc. (%)",
            r.proposed_increment_amount AS "Proposed Merit Inc. (PKR)",
            (r.current_salary + r.proposed_increment_amount) AS "Revised Gross Salary",
            r.proposed_bonus_amount AS "Proposed Bonus (PKR)",
            (r.proposed_increment_amount * ${MONTHS_PER_YEAR} + r.proposed_bonus_amount) AS "Annualised Cost (PKR)",
            CASE WHEN r.eligibility_promotion = 1 THEN 'Yes' ELSE 'No' END AS "Promotion Eligible",
            CASE WHEN r.promotion_recommended = 1 THEN 'Yes' ELSE 'No' END AS "Promotion Recommended",
            r.last_promotion_date AS "Last Promotion",
            ROUND(r.prev_asr_pct * 100, 1) AS "Previous ASR %",
            r.performance_rating AS "Performance Rating",
            r.remarks AS "Remarks",
            r.status AS "Record Status"
       FROM asr_records r
       JOIN employees e   ON e.id = r.employee_id
       JOIN job_grades g  ON g.id = e.grade_id
       JOIN divisions d   ON d.id = e.division_id
       JOIN departments p ON p.id = e.department_id
       LEFT JOIN sub_departments sd ON sd.id = e.sub_department_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.name, p.name, g.level DESC, e.name`,
  ).all(...params) as Record<string, any>[];

  const cycle = db.prepare(`SELECT name, year, effective_date, status FROM asr_cycles WHERE id=?`).get(cycleId) as any;
  const budget = divisionId ? divisionBudget(cycleId, divisionId) : cycleBudget(cycleId);
  // Describe what the file actually contains, not what was asked for: a
  // Director hitting the whole-cycle URL receives only their own departments,
  // and the summary sheet must say so.
  const divisionName = divisionId
    ? (db.prepare(`SELECT name FROM divisions WHERE id=?`).get(divisionId) as any)?.name
    : (() => {
        if (['HR_MANAGER', 'ADMIN', 'GSM_PRESIDENT', 'REWARDS'].includes(user.role)) return 'All divisions';
        const names = [...new Set(rows.map((r) => r['Division']))];
        if (user.role === 'DIRECTOR') {
          const depts = [...new Set(rows.map((r) => r['Department']))];
          return `${names.join(', ') || 'None'} — ${depts.join(', ') || 'no departments assigned'}`;
        }
        return names.join(', ') || 'None';
      })();

  const wb = XLSX.utils.book_new();

  /* --- Summary sheet --- */
  const summary = [
    ['Annual Salary Review — Export'],
    [],
    ['Cycle', cycle?.name ?? ''],
    ['Effective date', cycle?.effective_date ?? ''],
    ['Cycle status', cycle?.status ?? ''],
    ['Scope', divisionName],
    ['Exported by', `${user.name} (${user.role})`],
    ['Exported at', new Date().toLocaleString('en-GB')],
    [],
    ['Allocated budget (PKR)', budget.allocated],
    ['Approved exceptions (PKR)', budget.additionalApproved],
    ['Effective budget (PKR)', budget.effectiveAllocated],
    ['Increment cost, annualised (PKR)', budget.incrementCost],
    ['Bonus cost (PKR)', budget.bonusCost],
    ['Total utilised (PKR)', budget.utilised],
    ['Remaining (PKR)', budget.remaining],
    ['Utilisation (%)', Number(budget.utilisationPct.toFixed(2))],
    ['Budget status', budget.status],
    [],
    ['Employees in this export', rows.length],
    [],
    ['CONFIDENTIAL — contains individual salary information. Handle per Jazz data protection policy.'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summary);
  ws1['!cols'] = [{ wch: 36 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  /* --- Data sheet --- */
  const ws2 = XLSX.utils.json_to_sheet(rows);
  if (rows.length) {
    ws2['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: Math.min(Math.max(k.length + 3, 12), 34) }));
    ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: Object.keys(rows[0]).length - 1 } }) };
    ws2['!freeze'] = { xSplit: 0, ySplit: 1 };
  }
  XLSX.utils.book_append_sheet(wb, ws2, 'ASR Detail');

  /* --- Division roll-up (only when the caller can see more than one) --- */
  if (!divisionId) {
    const divs = db.prepare(
      `SELECT d.name AS "Division", COUNT(*) AS "Employees",
              COALESCE(SUM(r.proposed_increment_amount),0) * ${MONTHS_PER_YEAR} + COALESCE(SUM(r.proposed_bonus_amount),0) AS "Utilised (PKR)",
              COALESCE(MAX(db.allocated_budget),0) + COALESCE(MAX(db.additional_approved),0) AS "Allocated (PKR)",
              COALESCE(MAX(db.status),'NOT_STARTED') AS "Status"
         FROM asr_records r
         JOIN employees e ON e.id = r.employee_id
         JOIN divisions d ON d.id = e.division_id
         LEFT JOIN division_budgets db ON db.cycle_id = r.cycle_id AND db.division_id = d.id
        WHERE ${where.join(' AND ')}
        GROUP BY d.id ORDER BY d.name`,
    ).all(...params) as any[];
    if (divs.length > 1) {
      const ws3 = XLSX.utils.json_to_sheet(divs);
      ws3['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'Division Summary');
    }
  }

  audit({
    actor: user, action: 'EXPORT', entity: divisionId ? 'division' : 'asr_cycle',
    entityId: divisionId ?? cycleId,
    meta: { rows: rows.length, scope: divisionName },
  });

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const safe = String(divisionName).replace(/[^A-Za-z0-9]+/g, '-');
  return { buf, rows: rows.length, filename: `ASR-${cycle?.year ?? ''}-${safe}.xlsx` };
}
