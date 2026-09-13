import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handler, ok, bad, num } from '@/lib/api';
import { assertCanEditRecord } from '@/lib/rbac';
import { db, audit } from '@/lib/db';
import { divisionBudget } from '@/lib/budget';

export const dynamic = 'force-dynamic';

/** Fields a reviewer is allowed to set, and how each is stored. */
const EDITABLE = ['incrementPct', 'incrementAmount', 'bonusAmount', 'promotionRecommended', 'remarks', 'performanceRating'] as const;

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const recordId = num((await ctx.params).id);

  // Authoritative permission + lock check, re-derived from the database.
  const meta = assertCanEditRecord(user, recordId);

  const body = await req.json();
  const before = db.prepare(
    `SELECT r.*, g.max_merit_pct AS cap, g.code AS gradeCode, g.band_max AS bandMax,
            e.name AS empName, e.division_id AS divisionId
       FROM asr_records r
       JOIN employees e ON e.id = r.employee_id
       JOIN job_grades g ON g.id = e.grade_id
      WHERE r.id = ?`,
  ).get(recordId) as any;

  const salary = before.current_salary as number;

  // Increment may arrive as a percentage or an absolute amount; derive the other.
  let incPct = before.proposed_increment_pct as number;
  let incAmt = before.proposed_increment_amount as number;

  if (body.incrementPct !== undefined && body.incrementPct !== null) {
    const p = Number(body.incrementPct);
    if (!Number.isFinite(p) || p < 0) return bad('Increment percentage must be zero or greater');
    if (p > 1) return bad('Increment percentage must be entered as a fraction (0.10 = 10%)');
    incPct = Number(p.toFixed(4));
    incAmt = Math.round(salary * incPct);
  } else if (body.incrementAmount !== undefined && body.incrementAmount !== null) {
    const a = Math.round(Number(body.incrementAmount));
    if (!Number.isFinite(a) || a < 0) return bad('Increment amount must be zero or greater');
    incAmt = a;
    incPct = salary > 0 ? Number((a / salary).toFixed(4)) : 0;
  }

  let bonus = before.proposed_bonus_amount as number;
  if (body.bonusAmount !== undefined && body.bonusAmount !== null) {
    const b = Math.round(Number(body.bonusAmount));
    if (!Number.isFinite(b) || b < 0) return bad('Bonus must be zero or greater');
    bonus = b;
  }

  const promotion = body.promotionRecommended !== undefined
    ? (body.promotionRecommended ? 1 : 0) : before.promotion_recommended;
  const remarks = body.remarks !== undefined ? String(body.remarks).slice(0, 1000) : before.remarks;
  const rating = body.performanceRating !== undefined ? String(body.performanceRating).slice(0, 60) : before.performance_rating;

  // Policy ceiling and salary band are advisory: the budget is the hard gate,
  // but the reviewer is told immediately so mistakes surface at entry time.
  const overCap = incPct > before.cap + 1e-9;
  const overBand = before.bandMax > 0 && salary + incAmt > before.bandMax;

  db.prepare(
    `UPDATE asr_records
        SET proposed_increment_pct = ?, proposed_increment_amount = ?, proposed_bonus_amount = ?,
            promotion_recommended = ?, remarks = ?, performance_rating = ?,
            status = CASE WHEN ? > 0 OR ? > 0 THEN 'IN_PROGRESS' ELSE 'PENDING' END,
            updated_by = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(incPct, incAmt, bonus, promotion, remarks, rating, incAmt, bonus, user.id, recordId);

  /* ---- version history: one row per changed field ---- */
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  const cmp = (field: string, oldV: unknown, newV: unknown) => {
    if (String(oldV ?? '') !== String(newV ?? '')) changes.push({ field, old: oldV, new: newV });
  };
  cmp('Increment %', before.proposed_increment_pct, incPct);
  cmp('Increment (PKR)', before.proposed_increment_amount, incAmt);
  cmp('Bonus (PKR)', before.proposed_bonus_amount, bonus);
  cmp('Promotion recommended', before.promotion_recommended ? 'Yes' : 'No', promotion ? 'Yes' : 'No');
  cmp('Performance rating', before.performance_rating, rating);
  cmp('Remarks', before.remarks, remarks);

  const insVer = db.prepare(
    `INSERT INTO record_versions (record_id, field, old_value, new_value, changed_by, changed_by_name)
     VALUES (?,?,?,?,?,?)`,
  );
  for (const c of changes) {
    insVer.run(recordId, c.field, c.old == null ? null : String(c.old), c.new == null ? null : String(c.new), user.id, user.name);
  }

  if (changes.length) {
    audit({
      actor: user, action: 'RECORD_UPDATED', entity: 'asr_record', entityId: recordId,
      before: { incrementPct: before.proposed_increment_pct, incrementAmount: before.proposed_increment_amount, bonus: before.proposed_bonus_amount },
      after: { incrementPct: incPct, incrementAmount: incAmt, bonus },
      meta: { employee: before.empName, grade: before.gradeCode, fields: changes.map((c) => c.field) },
    });
  }

  const budget = divisionBudget(meta.cycle_id, before.divisionId);

  return ok({
    record: {
      id: recordId,
      incrementPct: incPct,
      incrementAmount: incAmt,
      bonusAmount: bonus,
      promotionRecommended: promotion,
      remarks, performanceRating: rating,
      revisedSalary: salary + incAmt,
      annualisedCost: incAmt * 12 + bonus,
      status: incAmt > 0 || bonus > 0 ? 'IN_PROGRESS' : 'PENDING',
    },
    budget,
    warnings: [
      ...(overCap ? [`Increment of ${(incPct * 100).toFixed(2)}% exceeds the ${(before.cap * 100).toFixed(0)}% policy ceiling for grade ${before.gradeCode}.`] : []),
      ...(overBand ? [`Revised salary of ${(salary + incAmt).toLocaleString('en-PK')} is above the ${before.gradeCode} band maximum of ${Number(before.bandMax).toLocaleString('en-PK')}.`] : []),
      ...(budget.status === 'OVER' ? [`This division is now over budget by ${Math.abs(budget.variance).toLocaleString('en-PK')} PKR.`] : []),
      ...(budget.status === 'APPROACHING' ? [`This division has used ${budget.utilisationPct.toFixed(1)}% of its allocation.`] : []),
    ],
    changed: changes.length,
  });
});
