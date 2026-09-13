import { db } from './db';

/* ------------------------------------------------------------------ *
 * Budget model
 * ------------------------------------------------------------------ *
 * Rewards allocates budget as ANNUALISED IMPACT, which is how the cost of an
 * ASR cycle actually lands on the P&L:
 *
 *   increment cost = monthly increment amount x 12
 *   bonus cost     = one-off bonus amount
 *   utilised       = increment cost + bonus cost
 *
 * Everything on every screen is derived from these helpers so the dashboard,
 * the workspace meter, analytics and the exception maths can never disagree.
 * ------------------------------------------------------------------ */

export const MONTHS_PER_YEAR = 12;

/** Amber once a division passes this share of its allocation. */
export const AMBER_THRESHOLD = 0.9;

export type BudgetStatus = 'WITHIN' | 'APPROACHING' | 'OVER';

export interface BudgetSnapshot {
  allocated: number;          // original allocation from Rewards
  additionalApproved: number; // approved exception top-ups, tracked separately
  effectiveAllocated: number; // allocated + additionalApproved
  incrementCost: number;
  bonusCost: number;
  utilised: number;
  remaining: number;
  utilisationPct: number;     // 0..n against effective allocation
  variance: number;           // effectiveAllocated - utilised (negative = over)
  status: BudgetStatus;
}

export function statusOf(utilised: number, allocated: number): BudgetStatus {
  if (allocated <= 0) return utilised > 0 ? 'OVER' : 'WITHIN';
  if (utilised > allocated) return 'OVER';
  if (utilised / allocated >= AMBER_THRESHOLD) return 'APPROACHING';
  return 'WITHIN';
}

export function snapshot(args: {
  allocated: number;
  additionalApproved?: number;
  incrementMonthly: number;
  bonus: number;
}): BudgetSnapshot {
  const additionalApproved = args.additionalApproved ?? 0;
  const effectiveAllocated = args.allocated + additionalApproved;
  const incrementCost = Math.round(args.incrementMonthly * MONTHS_PER_YEAR);
  const bonusCost = Math.round(args.bonus);
  const utilised = incrementCost + bonusCost;
  return {
    allocated: args.allocated,
    additionalApproved,
    effectiveAllocated,
    incrementCost,
    bonusCost,
    utilised,
    remaining: effectiveAllocated - utilised,
    utilisationPct: effectiveAllocated > 0 ? (utilised / effectiveAllocated) * 100 : 0,
    variance: effectiveAllocated - utilised,
    status: statusOf(utilised, effectiveAllocated),
  };
}

/** Live roll-up for one division in one cycle. */
export function divisionBudget(cycleId: number, divisionId: number): BudgetSnapshot {
  const alloc = db
    .prepare(
      `SELECT allocated_budget, additional_approved
         FROM division_budgets WHERE cycle_id = ? AND division_id = ?`,
    )
    .get(cycleId, divisionId) as { allocated_budget: number; additional_approved: number } | undefined;

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(r.proposed_increment_amount),0) AS inc,
              COALESCE(SUM(r.proposed_bonus_amount),0)     AS bon
         FROM asr_records r
         JOIN employees e ON e.id = r.employee_id
        WHERE r.cycle_id = ? AND e.division_id = ?`,
    )
    .get(cycleId, divisionId) as { inc: number; bon: number };

  return snapshot({
    allocated: alloc?.allocated_budget ?? 0,
    additionalApproved: alloc?.additional_approved ?? 0,
    incrementMonthly: totals.inc,
    bonus: totals.bon,
  });
}

/** Company-wide roll-up. */
export function cycleBudget(cycleId: number): BudgetSnapshot & { totalBudget: number } {
  const cycle = db.prepare(`SELECT total_budget FROM asr_cycles WHERE id = ?`).get(cycleId) as
    | { total_budget: number }
    | undefined;

  const extra = db
    .prepare(`SELECT COALESCE(SUM(additional_approved),0) AS x FROM division_budgets WHERE cycle_id = ?`)
    .get(cycleId) as { x: number };

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(proposed_increment_amount),0) AS inc,
              COALESCE(SUM(proposed_bonus_amount),0)     AS bon
         FROM asr_records WHERE cycle_id = ?`,
    )
    .get(cycleId) as { inc: number; bon: number };

  const snap = snapshot({
    allocated: cycle?.total_budget ?? 0,
    additionalApproved: extra.x,
    incrementMonthly: totals.inc,
    bonus: totals.bon,
  });
  return { ...snap, totalBudget: cycle?.total_budget ?? 0 };
}

export interface DivisionRow extends BudgetSnapshot {
  divisionId: number;
  code: string;
  name: string;
  hodName: string | null;
  employees: number;
  reviewed: number;
  completionPct: number;
  workflowStatus: string;
  deadline: string | null;
  submittedAt: string | null;
  openExceptions: number;
}

/** The dashboard's department table — one pass, no N+1. */
export function divisionRows(cycleId: number): DivisionRow[] {
  const rows = db
    .prepare(
      `SELECT d.id                                   AS divisionId,
              d.code, d.name,
              u.name                                 AS hodName,
              COALESCE(db.allocated_budget, 0)       AS allocated,
              COALESCE(db.additional_approved, 0)    AS additionalApproved,
              COALESCE(db.status, 'NOT_STARTED')     AS workflowStatus,
              db.deadline, db.submitted_at           AS submittedAt,
              COUNT(r.id)                            AS employees,
              COALESCE(SUM(CASE WHEN r.status IN ('IN_PROGRESS','SUBMITTED','LOCKED')
                                 OR r.proposed_increment_amount > 0
                                 OR r.proposed_bonus_amount > 0
                            THEN 1 ELSE 0 END), 0)   AS reviewed,
              COALESCE(SUM(r.proposed_increment_amount), 0) AS incMonthly,
              COALESCE(SUM(r.proposed_bonus_amount), 0)     AS bonus,
              (SELECT COUNT(*) FROM budget_exceptions be
                WHERE be.cycle_id = ? AND be.division_id = d.id AND be.status = 'PENDING') AS openExceptions
         FROM divisions d
         LEFT JOIN users u            ON u.id = d.hod_user_id
         LEFT JOIN division_budgets db ON db.division_id = d.id AND db.cycle_id = ?
         LEFT JOIN employees e        ON e.division_id = d.id AND e.is_active = 1
         LEFT JOIN asr_records r      ON r.employee_id = e.id AND r.cycle_id = ?
        GROUP BY d.id
        ORDER BY d.name`,
    )
    .all(cycleId, cycleId, cycleId) as any[];

  return rows.map((r) => {
    const snap = snapshot({
      allocated: r.allocated,
      additionalApproved: r.additionalApproved,
      incrementMonthly: r.incMonthly,
      bonus: r.bonus,
    });
    return {
      ...snap,
      divisionId: r.divisionId,
      code: r.code,
      name: r.name,
      hodName: r.hodName,
      employees: r.employees,
      reviewed: r.reviewed,
      completionPct: r.employees > 0 ? (r.reviewed / r.employees) * 100 : 0,
      workflowStatus: r.workflowStatus,
      deadline: r.deadline,
      submittedAt: r.submittedAt,
      openExceptions: r.openExceptions,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */
export function pkr(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return 'PKR 0';
  const abs = Math.abs(n);
  if (opts.compact) {
    if (abs >= 1_000_000_000) return `PKR ${(n / 1_000_000_000).toFixed(2)}Bn`;
    if (abs >= 1_000_000) return `PKR ${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `PKR ${(n / 1_000).toFixed(1)}K`;
  }
  return `PKR ${Math.round(n).toLocaleString('en-PK')}`;
}

export function pct(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return '0.0%';
  return `${n.toFixed(dp)}%`;
}
