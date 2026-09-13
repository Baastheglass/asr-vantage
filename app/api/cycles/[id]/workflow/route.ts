import { NextRequest } from 'next/server';
import { requireUser, HttpError } from '@/lib/auth';
import { handler, ok, bad, num } from '@/lib/api';
import { db, audit, notify, notifyRole, logStage } from '@/lib/db';
import { cycleBudget, divisionRows, pkr } from '@/lib/budget';
import { getCycle } from '@/lib/cycle';
import { readinessChecks } from '@/lib/workflow';

export const dynamic = 'force-dynamic';


export const GET = handler(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const cycleId = num((await ctx.params).id);
  const { checks, budget } = readinessChecks(cycleId);
  return ok({ checks, budget, ready: checks.every((c) => c.passed) });
});

export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const cycleId = num((await ctx.params).id);
  const cycle = getCycle(cycleId);
  if (!cycle) return bad('ASR cycle not found', 404);

  const body = await req.json();
  const action = String(body.action ?? '').toUpperCase();
  const comment = String(body.comment ?? '').trim();

  /* ---------------- HR: validate and send to GSM ---------------- */
  if (action === 'SUBMIT_GSM') {
    if (!['HR_MANAGER', 'ADMIN'].includes(user.role)) throw new HttpError(403, 'Only the HR Manager can send the ASR for approval');
    if (cycle.status === 'PENDING_GSM') return bad('This ASR is already with the GSM President.', 409);

    const { checks, budget } = readinessChecks(cycleId);
    const failed = checks.filter((c) => !c.passed);
    if (failed.length && !body.force) {
      return Response.json({ error: 'Readiness checks failed', checks, failed: failed.map((f) => f.key) }, { status: 409 });
    }

    db.prepare(
      `UPDATE asr_cycles SET status='PENDING_GSM', hr_validated_at=COALESCE(hr_validated_at, datetime('now')),
          gsm_submitted_at=datetime('now') WHERE id=?`,
    ).run(cycleId);

    // Lock every division so nothing moves while the President is reviewing.
    db.prepare(`UPDATE division_budgets SET status='VALIDATED' WHERE cycle_id=? AND status='SUBMITTED'`).run(cycleId);
    db.prepare(`UPDATE asr_records SET status='LOCKED' WHERE cycle_id=?`).run(cycleId);

    logStage({ cycleId, stage: 'HR_VALIDATION', status: 'COMPLETED', actor: user, note: comment || 'HR validation complete' });
    logStage({ cycleId, stage: 'GSM_APPROVAL', status: 'ACTION_REQUIRED', actor: user, note: 'Sent to GSM President for approval' });

    db.prepare(`INSERT INTO approvals (cycle_id, stage, actor_id, actor_name, action, comment) VALUES (?,?,?,?,?,?)`)
      .run(cycleId, 'HR_VALIDATION', user.id, user.name, 'SUBMITTED_FOR_APPROVAL', comment || null);

    audit({ actor: user, action: 'SUBMITTED_TO_GSM', entity: 'asr_cycle', entityId: cycleId,
      after: { utilised: budget.utilised, allocated: budget.effectiveAllocated } });

    notifyRole('GSM_PRESIDENT', {
      type: 'GSM_APPROVAL_REQUIRED', severity: 'warning',
      title: `${cycle.name} requires your approval`,
      body: `${pkr(budget.utilised, { compact: true })} of ${pkr(budget.effectiveAllocated, { compact: true })} allocated (${budget.utilisationPct.toFixed(1)}%).`,
      link: '/approvals',
    });

    return ok({ status: 'PENDING_GSM' });
  }

  /* ---------------- GSM decision ---------------- */
  if (['APPROVE', 'REJECT', 'REQUEST_CHANGES'].includes(action)) {
    if (!['GSM_PRESIDENT', 'ADMIN'].includes(user.role)) throw new HttpError(403, 'Only the GSM President can decide this approval');
    if (cycle.status !== 'PENDING_GSM') return bad('This ASR is not currently awaiting GSM approval.', 409);
    if (action !== 'APPROVE' && comment.length < 10) {
      return bad('Please explain what needs to change so HR knows how to act.');
    }

    if (action === 'APPROVE') {
      db.prepare(`UPDATE asr_cycles SET status='APPROVED', gsm_decided_at=datetime('now') WHERE id=?`).run(cycleId);
      logStage({ cycleId, stage: 'GSM_APPROVAL', status: 'COMPLETED', actor: user, note: comment || 'Approved by GSM President' });
      notifyRole('HR_MANAGER', {
        type: 'GSM_APPROVED', severity: 'success',
        title: `${cycle.name} approved by the GSM President`,
        body: comment || 'You can now submit the final ASR to Rewards.',
        link: '/approvals',
      });
    } else {
      const target = String(body.returnTo ?? 'DEPARTMENT_REVIEW');
      db.prepare(`UPDATE asr_cycles SET status='CHANGES_REQUESTED', gsm_decided_at=datetime('now') WHERE id=?`).run(cycleId);

      // Reopen only what needs reworking — completed divisions are left alone
      // unless the President named specific ones.
      const divisionIds: number[] = Array.isArray(body.divisionIds) ? body.divisionIds.map(Number) : [];
      if (divisionIds.length) {
        const ph = divisionIds.map(() => '?').join(',');
        db.prepare(`UPDATE division_budgets SET status='RETURNED', returned_reason=? WHERE cycle_id=? AND division_id IN (${ph})`)
          .run(comment, cycleId, ...divisionIds);
        db.prepare(
          `UPDATE asr_records SET status='IN_PROGRESS'
            WHERE cycle_id=? AND employee_id IN (SELECT id FROM employees WHERE division_id IN (${ph}))`,
        ).run(cycleId, ...divisionIds);
        for (const dvId of divisionIds) {
          const hod = db.prepare(`SELECT hod_user_id AS id, name FROM divisions WHERE id=?`).get(dvId) as any;
          if (hod?.id) {
            notify({ userId: hod.id, type: 'CHANGES_REQUESTED', severity: 'warning',
              title: `Changes requested for ${hod.name}`, body: comment, link: `/workspace/${dvId}` });
          }
          logStage({ cycleId, divisionId: dvId, stage: 'DEPARTMENT_REVIEW', status: 'REOPENED', actor: user, note: comment });
        }
      } else {
        db.prepare(`UPDATE division_budgets SET status='RETURNED', returned_reason=? WHERE cycle_id=?`).run(comment, cycleId);
        db.prepare(`UPDATE asr_records SET status='IN_PROGRESS' WHERE cycle_id=?`).run(cycleId);
      }

      logStage({ cycleId, stage: 'GSM_APPROVAL', status: 'ACTION_REQUIRED', actor: user,
        note: action === 'REJECT' ? `Rejected: ${comment}` : `Changes requested: ${comment}` });
      logStage({ cycleId, stage: target, status: 'IN_PROGRESS', actor: user, note: 'Reopened following GSM feedback' });

      notifyRole('HR_MANAGER', {
        type: 'GSM_CHANGES', severity: 'critical',
        title: `${cycle.name} returned by the GSM President`,
        body: comment, link: '/approvals',
      });
    }

    db.prepare(`INSERT INTO approvals (cycle_id, stage, actor_id, actor_name, action, comment) VALUES (?,?,?,?,?,?)`)
      .run(cycleId, 'GSM_APPROVAL', user.id, user.name, action, comment || null);
    audit({ actor: user, action: `GSM_${action}`, entity: 'asr_cycle', entityId: cycleId, after: { comment } });

    return ok({ status: action === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED' });
  }

  /* ---------------- HR: release to Rewards ---------------- */
  if (action === 'SUBMIT_REWARDS') {
    if (!['HR_MANAGER', 'ADMIN'].includes(user.role)) throw new HttpError(403, 'Only the HR Manager can submit to Rewards');
    if (cycle.status !== 'APPROVED') return bad('The ASR must be approved by the GSM President first.', 409);

    const budget = cycleBudget(cycleId);
    // Freeze an immutable snapshot of exactly what was approved.
    const snapshotRows = db.prepare(
      `SELECT e.emp_code, e.name, g.code AS grade, d.name AS division, p.name AS department,
              r.current_salary, r.proposed_increment_pct, r.proposed_increment_amount,
              r.proposed_bonus_amount, r.promotion_recommended
         FROM asr_records r
         JOIN employees e ON e.id = r.employee_id
         JOIN job_grades g ON g.id = e.grade_id
         JOIN divisions d ON d.id = e.division_id
         JOIN departments p ON p.id = e.department_id
        WHERE r.cycle_id = ?`,
    ).all(cycleId);

    db.prepare(
      `UPDATE asr_cycles SET status='SUBMITTED_TO_REWARDS', rewards_submitted_at=datetime('now'),
          completed_at=datetime('now'), frozen_snapshot=? WHERE id=?`,
    ).run(JSON.stringify({ frozenAt: new Date().toISOString(), budget, records: snapshotRows }), cycleId);

    logStage({ cycleId, stage: 'REWARDS_REVIEW', status: 'COMPLETED', actor: user, note: 'Final approved ASR released to Rewards' });
    logStage({ cycleId, stage: 'ASR_COMPLETED', status: 'COMPLETED', actor: user, note: `${snapshotRows.length.toLocaleString('en-PK')} records frozen` });

    db.prepare(`INSERT INTO approvals (cycle_id, stage, actor_id, actor_name, action, comment) VALUES (?,?,?,?,?,?)`)
      .run(cycleId, 'REWARDS_SUBMISSION', user.id, user.name, 'SUBMITTED', comment || null);
    audit({ actor: user, action: 'SUBMITTED_TO_REWARDS', entity: 'asr_cycle', entityId: cycleId,
      after: { records: snapshotRows.length, utilised: budget.utilised } });

    notifyRole('REWARDS', {
      type: 'ASR_FINAL', severity: 'success',
      title: `${cycle.name} has been approved and released`,
      body: `${snapshotRows.length.toLocaleString('en-PK')} records · ${pkr(budget.utilised, { compact: true })} total impact.`,
      link: '/rewards',
    });

    return ok({ status: 'SUBMITTED_TO_REWARDS', records: snapshotRows.length });
  }

  /* ---------------- HR: reopen a division ---------------- */
  if (action === 'REOPEN_DIVISION') {
    if (!['HR_MANAGER', 'ADMIN'].includes(user.role)) throw new HttpError(403, 'Only the HR Manager can reopen a division');
    const divisionId = num(body.divisionId);
    if (!divisionId) return bad('divisionId is required');
    if (comment.length < 10) return bad('Please explain why the division is being reopened.');

    db.prepare(`UPDATE division_budgets SET status='RETURNED', returned_reason=?, submitted_at=NULL WHERE cycle_id=? AND division_id=?`)
      .run(comment, cycleId, divisionId);
    db.prepare(
      `UPDATE asr_records SET status='IN_PROGRESS'
        WHERE cycle_id=? AND employee_id IN (SELECT id FROM employees WHERE division_id=?)`,
    ).run(cycleId, divisionId);

    const div = db.prepare(`SELECT name, hod_user_id AS hodId FROM divisions WHERE id=?`).get(divisionId) as any;
    if (div?.hodId) {
      notify({ userId: div.hodId, type: 'DIVISION_REOPENED', severity: 'warning',
        title: `${div.name} has been reopened by HR`, body: comment, link: `/workspace/${divisionId}` });
    }
    logStage({ cycleId, divisionId, stage: 'DEPARTMENT_REVIEW', status: 'REOPENED', actor: user, note: comment });
    audit({ actor: user, action: 'DIVISION_REOPENED', entity: 'division', entityId: divisionId, after: { comment } });

    return ok({ ok: true });
  }

  return bad('Unknown action');
});
