import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth';
import { handler, ok, bad, num } from '@/lib/api';
import { db, audit, notify, logStage } from '@/lib/db';
import { divisionBudget, pkr } from '@/lib/budget';
import { activeCycle } from '@/lib/cycle';

export const dynamic = 'force-dynamic';

/**
 * HR decides a budget exception.
 *
 * An approval never overwrites the original allocation from Rewards — the extra
 * money is recorded in `additional_approved` so the original figure, the
 * approved top-up and the resulting effective budget all stay visible and
 * auditable.
 */
export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireRole('HR_MANAGER', 'ADMIN');
  const id = num((await ctx.params).id);
  const body = await req.json();
  const action = String(body.action ?? '').toUpperCase();
  const comment = String(body.comment ?? '').trim();

  if (!['APPROVE', 'REJECT', 'CLARIFY'].includes(action)) return bad('Unknown action');
  if (action !== 'APPROVE' && comment.length < 10) {
    return bad('Please add a short comment explaining the decision.');
  }

  const cycle = activeCycle();
  if (!cycle) return bad('No active ASR cycle', 404);

  const exc = db.prepare(
    `SELECT be.*, d.name AS divisionName FROM budget_exceptions be
       JOIN divisions d ON d.id = be.division_id WHERE be.id = ?`,
  ).get(id) as any;
  if (!exc) return bad('Exception request not found', 404);
  if (exc.status !== 'PENDING' && exc.status !== 'CLARIFICATION') {
    return bad('This request has already been decided.', 409);
  }

  const approvedAmount = action === 'APPROVE'
    ? Math.round(Number(body.approvedAmount ?? exc.requested_amount))
    : 0;

  if (action === 'APPROVE' && (!Number.isFinite(approvedAmount) || approvedAmount <= 0)) {
    return bad('Approved amount must be greater than zero.');
  }

  const status = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'CLARIFICATION';

  db.prepare(
    `UPDATE budget_exceptions
        SET status=?, decided_by=?, decided_at=datetime('now'), decision_comment=?, requested_amount=?
      WHERE id=?`,
  ).run(status, user.id, comment || null, action === 'APPROVE' ? approvedAmount : exc.requested_amount, id);

  if (action === 'APPROVE') {
    // Additional budget is tracked separately from the Rewards allocation.
    db.prepare(
      `UPDATE division_budgets SET additional_approved = additional_approved + ?
        WHERE cycle_id=? AND division_id=?`,
    ).run(approvedAmount, cycle.id, exc.division_id);
  }

  const budget = divisionBudget(cycle.id, exc.division_id);

  audit({
    actor: user, action: `EXCEPTION_${status}`, entity: 'budget_exception', entityId: id,
    before: { status: exc.status, requested: exc.requested_amount },
    after: { status, approvedAmount, comment },
    meta: { division: exc.divisionName },
  });
  logStage({
    cycleId: cycle.id, divisionId: exc.division_id, stage: 'DEPARTMENT_REVIEW',
    status: action === 'CLARIFY' ? 'ACTION_REQUIRED' : 'IN_PROGRESS', actor: user,
    note: `Exception ${status.toLowerCase()}${action === 'APPROVE' ? ` — ${pkr(approvedAmount)} additional budget` : ''}`,
  });

  notify({
    userId: exc.requested_by,
    type: 'EXCEPTION_DECIDED',
    severity: action === 'APPROVE' ? 'success' : action === 'REJECT' ? 'critical' : 'warning',
    title: action === 'APPROVE'
      ? `Budget exception approved — ${pkr(approvedAmount)}`
      : action === 'REJECT'
      ? 'Budget exception rejected'
      : 'HR has requested clarification on your exception',
    body: comment || (action === 'APPROVE'
      ? `Your allocation for ${exc.divisionName} has been increased. New utilisation ${budget.utilisationPct.toFixed(1)}%.`
      : undefined),
    link: `/workspace/${exc.division_id}`,
  });

  return ok({ status, budget });
});
