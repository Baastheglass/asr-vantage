import { requireUser, HttpError } from '@/lib/auth';
import { handler, ok, num } from '@/lib/api';
import { assertDivisionAccess } from '@/lib/rbac';
import { db, audit, notify, notifyRole, logStage } from '@/lib/db';
import { divisionBudget, pkr } from '@/lib/budget';
import { activeCycle } from '@/lib/cycle';

export const dynamic = 'force-dynamic';

/**
 * A division submits its completed review to HR.
 *
 * Submission is refused while the division is over budget unless an approved
 * exception covers the overage — this is the control that replaces "the HOD
 * quietly typed a bigger number into the spreadsheet".
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const divisionId = num((await ctx.params).id);
  assertDivisionAccess(user, divisionId);
  if (!['HOD', 'HR_MANAGER', 'ADMIN'].includes(user.role)) {
    throw new HttpError(403, 'Only the Head of Department can submit a division review');
  }

  const cycle = activeCycle();
  if (!cycle) throw new HttpError(404, 'No active ASR cycle');

  const division = db.prepare(`SELECT id, name FROM divisions WHERE id = ?`).get(divisionId) as { id: number; name: string };
  const budget = divisionBudget(cycle.id, divisionId);

  const pending = (db.prepare(
    `SELECT COUNT(*) AS n FROM asr_records r JOIN employees e ON e.id = r.employee_id
      WHERE r.cycle_id = ? AND e.division_id = ? AND r.status = 'PENDING'`,
  ).get(cycle.id, divisionId) as { n: number }).n;

  const blockers: string[] = [];
  if (budget.status === 'OVER') {
    blockers.push(
      `${division.name} is over budget by ${pkr(Math.abs(budget.variance))}. Reduce the proposed increments or bonuses, or raise a budget exception request for the additional amount.`,
    );
  }
  if (pending > 0) {
    blockers.push(
      `${pending} employee${pending > 1 ? 's have' : ' has'} not been reviewed yet. Every employee needs a decision — enter an increment, a bonus, or mark them as no increment.`,
    );
  }

  if (blockers.length) {
    return Response.json({ error: 'Submission blocked', blockers, budget }, { status: 409 });
  }

  db.prepare(
    `UPDATE division_budgets SET status='SUBMITTED', submitted_at=datetime('now'), submitted_by=?, returned_reason=NULL
      WHERE cycle_id=? AND division_id=?`,
  ).run(user.id, cycle.id, divisionId);

  db.prepare(
    `UPDATE asr_records SET status='SUBMITTED'
      WHERE cycle_id=? AND employee_id IN (SELECT id FROM employees WHERE division_id=?)`,
  ).run(cycle.id, divisionId);

  logStage({ cycleId: cycle.id, divisionId, stage: 'DEPARTMENT_SUBMISSION', status: 'COMPLETED', actor: user, note: `${division.name} submitted to HR` });
  audit({ actor: user, action: 'DIVISION_SUBMITTED', entity: 'division', entityId: divisionId, after: { utilised: budget.utilised, allocated: budget.effectiveAllocated } });

  notifyRole('HR_MANAGER', {
    type: 'DIVISION_SUBMITTED', severity: 'success',
    title: `${division.name} has submitted its ASR`,
    body: `${pkr(budget.utilised, { compact: true })} of ${pkr(budget.effectiveAllocated, { compact: true })} utilised (${budget.utilisationPct.toFixed(1)}%).`,
    link: `/workspace/${divisionId}`,
  });

  return ok({ ok: true, budget });
});
