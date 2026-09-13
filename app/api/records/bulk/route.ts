import { NextRequest } from 'next/server';
import { requireUser, HttpError } from '@/lib/auth';
import { handler, ok, bad, num, str } from '@/lib/api';
import { canEdit, assertDivisionAccess, employeeScope } from '@/lib/rbac';
import { db, audit, type SessionUser } from '@/lib/db';
import { divisionBudget, pkr } from '@/lib/budget';
import { activeCycle } from '@/lib/cycle';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Action = 'SET_INCREMENT_PCT' | 'SET_BONUS' | 'NO_INCREMENT' | 'SET_RATING';

/**
 * Apply one decision to many employees at once — the equivalent of dragging a
 * value down a column in Excel.
 *
 * Targets are resolved server-side through the caller's scope, so "apply to
 * everything matching my filter" can never reach a record the caller is not
 * allowed to edit. Each change still writes its own version-history row, so
 * a bulk edit is just as auditable as 200 individual ones.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canEdit(user)) throw new HttpError(403, 'Your role cannot modify salary recommendations');

  const cycle = activeCycle();
  if (!cycle) return bad('No active ASR cycle', 404);

  const b = await req.json();
  const divisionId = num(b.divisionId);
  assertDivisionAccess(user, divisionId);

  const action = str(b.action) as Action;
  if (!['SET_INCREMENT_PCT', 'SET_BONUS', 'NO_INCREMENT', 'SET_RATING'].includes(action)) {
    return bad('Unknown bulk action');
  }

  /* ---- refuse if the cycle or this division is locked ---- */
  const lock = db.prepare(
    `SELECT c.status AS cycleStatus, COALESCE(db.status,'NOT_STARTED') AS divisionStatus
       FROM asr_cycles c
       LEFT JOIN division_budgets db ON db.cycle_id = c.id AND db.division_id = ?
      WHERE c.id = ?`,
  ).get(divisionId, cycle.id) as { cycleStatus: string; divisionStatus: string };

  if (['APPROVED', 'SUBMITTED_TO_REWARDS', 'COMPLETED', 'PENDING_GSM'].includes(lock.cycleStatus)) {
    return bad('This ASR cycle is locked and can no longer be edited.', 409);
  }
  if (lock.divisionStatus === 'SUBMITTED' && !['HR_MANAGER', 'ADMIN'].includes(user.role)) {
    return bad('This division has already been submitted to HR. Ask HR to reopen it.', 409);
  }

  /* ---- resolve the target rows inside the caller's scope ---- */
  const scope = employeeScope(user, 'e');
  const where: string[] = ['r.cycle_id = ?', 'e.division_id = ?', scope.sql];
  const params: unknown[] = [cycle.id, divisionId, ...scope.params];

  const ids: number[] = Array.isArray(b.recordIds) ? b.recordIds.map(Number).filter(Boolean) : [];
  if (ids.length) {
    where.push(`r.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  } else {
    // "apply to everything matching the current filter"
    const f = b.filter ?? {};
    if (f.departmentId) { where.push('e.department_id = ?'); params.push(num(f.departmentId)); }
    if (f.gradeId) { where.push('e.grade_id = ?'); params.push(num(f.gradeId)); }
    if (f.search) {
      where.push('(e.name LIKE ? OR e.emp_code LIKE ? OR e.job_title LIKE ?)');
      const s = `%${f.search}%`; params.push(s, s, s);
    }
    switch (f.status) {
      case 'reviewed':  where.push('(r.proposed_increment_amount > 0 OR r.proposed_bonus_amount > 0)'); break;
      case 'pending':   where.push("r.status = 'PENDING'"); break;
      case 'promotion': where.push('r.promotion_recommended = 1'); break;
      case 'eligible':  where.push('r.eligibility_promotion = 1'); break;
    }
  }

  const targets = db.prepare(
    `SELECT r.id, r.current_salary AS salary, r.proposed_increment_pct AS pct,
            r.proposed_increment_amount AS amt, r.proposed_bonus_amount AS bonus,
            r.performance_rating AS rating, r.status,
            g.max_merit_pct AS cap, g.code AS grade, g.band_max AS bandMax, e.name
       FROM asr_records r
       JOIN employees e ON e.id = r.employee_id
       JOIN job_grades g ON g.id = e.grade_id
      WHERE ${where.join(' AND ')}`,
  ).all(...params) as any[];

  if (targets.length === 0) return bad('No employees matched — nothing was changed.');

  /* ---- validate the value ---- */
  let pctValue = 0, bonusValue = 0, ratingValue = '';
  if (action === 'SET_INCREMENT_PCT') {
    pctValue = Number(b.value);
    if (!Number.isFinite(pctValue) || pctValue < 0) return bad('Enter a percentage of zero or more.');
    if (pctValue > 1) return bad('Enter the percentage as a fraction (0.08 = 8%).');
  } else if (action === 'SET_BONUS') {
    bonusValue = Math.round(Number(b.value));
    if (!Number.isFinite(bonusValue) || bonusValue < 0) return bad('Enter a bonus of zero or more.');
  } else if (action === 'SET_RATING') {
    ratingValue = str(b.value).slice(0, 60);
    if (!ratingValue) return bad('Choose a performance rating.');
  }

  /* ---- apply ---- */
  const updIncrement = db.prepare(
    `UPDATE asr_records SET proposed_increment_pct=?, proposed_increment_amount=?,
        status='IN_PROGRESS', updated_by=?, updated_at=datetime('now') WHERE id=?`,
  );
  const updBonus = db.prepare(
    `UPDATE asr_records SET proposed_bonus_amount=?, status='IN_PROGRESS',
        updated_by=?, updated_at=datetime('now') WHERE id=?`,
  );
  const updNone = db.prepare(
    `UPDATE asr_records SET proposed_increment_pct=0, proposed_increment_amount=0,
        proposed_bonus_amount=0, status='IN_PROGRESS', updated_by=?, updated_at=datetime('now') WHERE id=?`,
  );
  const updRating = db.prepare(
    `UPDATE asr_records SET performance_rating=?, updated_by=?, updated_at=datetime('now') WHERE id=?`,
  );
  const insVer = db.prepare(
    `INSERT INTO record_versions (record_id, field, old_value, new_value, changed_by, changed_by_name)
     VALUES (?,?,?,?,?,?)`,
  );

  let changed = 0;
  const overCap: string[] = [];
  const overBand: string[] = [];

  db.transaction(() => {
    for (const t of targets) {
      if (action === 'SET_INCREMENT_PCT') {
        const amt = Math.round(t.salary * pctValue);
        if (Math.abs(pctValue - t.pct) < 1e-9 && t.status !== 'PENDING') continue;
        updIncrement.run(Number(pctValue.toFixed(4)), amt, user.id, t.id);
        insVer.run(t.id, 'Increment %', String(t.pct), String(pctValue.toFixed(4)), user.id, user.name);
        insVer.run(t.id, 'Increment (PKR)', String(t.amt), String(amt), user.id, user.name);
        if (pctValue > t.cap + 1e-9 && overCap.length < 5) overCap.push(`${t.name} (${t.grade})`);
        if (t.salary + amt > t.bandMax && overBand.length < 5) overBand.push(`${t.name} (${t.grade})`);
        changed++;
      } else if (action === 'SET_BONUS') {
        if (bonusValue === t.bonus && t.status !== 'PENDING') continue;
        updBonus.run(bonusValue, user.id, t.id);
        insVer.run(t.id, 'Bonus (PKR)', String(t.bonus), String(bonusValue), user.id, user.name);
        changed++;
      } else if (action === 'NO_INCREMENT') {
        updNone.run(user.id, t.id);
        if (t.amt !== 0) insVer.run(t.id, 'Increment (PKR)', String(t.amt), '0', user.id, user.name);
        if (t.bonus !== 0) insVer.run(t.id, 'Bonus (PKR)', String(t.bonus), '0', user.id, user.name);
        insVer.run(t.id, 'Decision', t.status === 'PENDING' ? 'Not reviewed' : 'Reviewed', 'No increment this cycle', user.id, user.name);
        changed++;
      } else if (action === 'SET_RATING') {
        if (ratingValue === t.rating) continue;
        updRating.run(ratingValue, user.id, t.id);
        insVer.run(t.id, 'Performance rating', t.rating ?? '—', ratingValue, user.id, user.name);
        changed++;
      }
    }
  })();

  const budget = divisionBudget(cycle.id, divisionId);

  audit({
    actor: user, action: 'BULK_UPDATE', entity: 'division', entityId: divisionId,
    after: { action, value: b.value ?? null, employees: changed },
    meta: { matched: targets.length, utilisationAfter: Number(budget.utilisationPct.toFixed(1)) },
  });

  return ok({
    changed,
    matched: targets.length,
    budget,
    warnings: [
      ...(overCap.length ? [`Above the grade policy ceiling for ${overCap.join(', ')}${overCap.length === 5 ? ' and others' : ''}.`] : []),
      ...(overBand.length ? [`New salary exceeds the grade band maximum for ${overBand.join(', ')}${overBand.length === 5 ? ' and others' : ''}.`] : []),
      ...(budget.status === 'OVER' ? [`This division is now over budget by ${pkr(Math.abs(budget.variance))}.`] : []),
      ...(budget.status === 'APPROACHING' ? [`This division has now used ${budget.utilisationPct.toFixed(1)}% of its allocation.`] : []),
    ],
  });
});
