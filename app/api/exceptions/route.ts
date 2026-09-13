import { NextRequest } from 'next/server';
import { requireUser, HttpError } from '@/lib/auth';
import { handler, ok, bad, num } from '@/lib/api';
import { assertDivisionAccess, visibleDivisionIds } from '@/lib/rbac';
import { db, audit, notifyRole, logStage } from '@/lib/db';
import { divisionBudget, pkr } from '@/lib/budget';
import { activeCycle } from '@/lib/cycle';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const user = await requireUser();
  if (!['HR_MANAGER', 'ADMIN', 'HOD'].includes(user.role)) {
    throw new HttpError(403, 'Budget exceptions are handled by HR and Rewards');
  }
  const cycle = activeCycle();
  if (!cycle) return ok({ exceptions: [] });

  const allowed = visibleDivisionIds(user);
  let where = 'be.cycle_id = ?';
  const params: unknown[] = [cycle.id];
  if (allowed !== 'ALL') {
    if (allowed.length === 0) return ok({ exceptions: [] });
    where += ` AND be.division_id IN (${allowed.map(() => '?').join(',')})`;
    params.push(...allowed);
  }

  const rows = db.prepare(
    `SELECT be.id, be.division_id AS divisionId, d.name AS divisionName,
            be.requested_amount AS requestedAmount, be.projected_utilisation AS projectedUtilisation,
            be.justification, be.status, be.decision_comment AS decisionComment,
            be.created_at AS createdAt, be.decided_at AS decidedAt,
            u.name AS requestedBy, du.name AS decidedBy,
            db.allocated_budget AS allocated, db.additional_approved AS additionalApproved
       FROM budget_exceptions be
       JOIN divisions d ON d.id = be.division_id
       JOIN users u ON u.id = be.requested_by
       LEFT JOIN users du ON du.id = be.decided_by
       LEFT JOIN division_budgets db ON db.cycle_id = be.cycle_id AND db.division_id = be.division_id
      WHERE ${where}
      ORDER BY CASE be.status WHEN 'PENDING' THEN 0 WHEN 'CLARIFICATION' THEN 1 ELSE 2 END, be.created_at DESC`,
  ).all(...params) as any[];

  const exceptions = rows.map((r) => {
    const b = divisionBudget(cycle.id, r.divisionId);
    return { ...r, utilised: b.utilised, currentUtilisation: b.utilisationPct, variance: b.variance };
  });

  return ok({ exceptions });
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  if (!['HOD', 'HR_MANAGER', 'ADMIN'].includes(user.role)) {
    throw new HttpError(403, 'Only the Head of Department can raise a budget exception');
  }

  const cycle = activeCycle();
  if (!cycle) throw new HttpError(404, 'No active ASR cycle');

  const body = await req.json();
  const divisionId = num(body.divisionId);
  assertDivisionAccess(user, divisionId);

  const justification = String(body.justification ?? '').trim();
  if (justification.length < 40) {
    return bad('Please provide a business justification of at least 40 characters explaining why the additional budget is warranted.');
  }

  const budget = divisionBudget(cycle.id, divisionId);
  const requested = body.requestedAmount != null ? Math.round(Number(body.requestedAmount)) : Math.abs(Math.min(0, budget.variance));
  if (!Number.isFinite(requested) || requested <= 0) {
    return bad('The requested amount must be greater than zero.');
  }

  const existing = db.prepare(
    `SELECT id FROM budget_exceptions WHERE cycle_id=? AND division_id=? AND status IN ('PENDING','CLARIFICATION')`,
  ).get(cycle.id, divisionId);
  if (existing) return bad('An exception request for this division is already open with HR.', 409);

  const division = db.prepare(`SELECT name FROM divisions WHERE id=?`).get(divisionId) as { name: string };

  const id = Number(db.prepare(
    `INSERT INTO budget_exceptions (cycle_id, division_id, requested_by, requested_amount,
        projected_utilisation, justification, employee_refs, status)
     VALUES (?,?,?,?,?,?,?, 'PENDING')`,
  ).run(cycle.id, divisionId, user.id, requested, budget.utilisationPct, justification,
        JSON.stringify(body.employeeRefs ?? [])).lastInsertRowid);

  audit({ actor: user, action: 'EXCEPTION_REQUESTED', entity: 'budget_exception', entityId: id,
    after: { divisionId, requested, utilisation: budget.utilisationPct } });
  logStage({ cycleId: cycle.id, divisionId, stage: 'DEPARTMENT_REVIEW', status: 'ACTION_REQUIRED', actor: user,
    note: `Budget exception requested for ${pkr(requested)}` });

  notifyRole('HR_MANAGER', {
    type: 'EXCEPTION_RAISED', severity: 'warning',
    title: `${division.name} has requested a budget exception`,
    body: `${pkr(requested)} additional budget requested. Projected utilisation ${budget.utilisationPct.toFixed(1)}%.`,
    link: '/exceptions',
  });

  return ok({ id, budget });
});
