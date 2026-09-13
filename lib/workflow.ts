import { db } from './db';
import { cycleBudget, divisionRows, pkr } from './budget';

/** Every gate that must pass before the ASR can go to the GSM President. */
export function readinessChecks(cycleId: number) {
  const rows = divisionRows(cycleId);
  const budget = cycleBudget(cycleId);
  const openExceptions = (db.prepare(
    `SELECT COUNT(*) AS n FROM budget_exceptions WHERE cycle_id = ? AND status IN ('PENDING','CLARIFICATION')`,
  ).get(cycleId) as { n: number }).n;

  const notSubmitted = rows.filter((r) => r.workflowStatus !== 'SUBMITTED' && r.workflowStatus !== 'VALIDATED');
  const over = rows.filter((r) => r.status === 'OVER');
  const unreviewed = (db.prepare(
    `SELECT COUNT(*) AS n FROM asr_records WHERE cycle_id = ? AND status = 'PENDING'`,
  ).get(cycleId) as { n: number }).n;

  return {
    checks: [
      {
        key: 'divisions',
        label: 'All divisions have submitted their review',
        passed: notSubmitted.length === 0,
        detail: notSubmitted.length === 0
          ? `${rows.length} of ${rows.length} divisions submitted`
          : `${notSubmitted.length} outstanding: ${notSubmitted.map((r) => r.name).join(', ')}`,
      },
      {
        key: 'records',
        label: 'Every employee has a recorded decision',
        passed: unreviewed === 0,
        detail: unreviewed === 0 ? 'All records actioned' : `${unreviewed.toLocaleString('en-PK')} employees still unreviewed`,
      },
      {
        key: 'exceptions',
        label: 'No budget exception requests are open',
        passed: openExceptions === 0,
        detail: openExceptions === 0 ? 'None outstanding' : `${openExceptions} awaiting an HR decision`,
      },
      {
        key: 'divisionBudget',
        label: 'No division is over its allocation',
        passed: over.length === 0,
        detail: over.length === 0 ? 'All divisions within budget' : `${over.map((r) => `${r.name} (+${pkr(Math.abs(r.variance), { compact: true })})`).join(', ')}`,
      },
      {
        key: 'companyBudget',
        label: 'Company total is within the ASR budget',
        passed: budget.utilised <= budget.effectiveAllocated,
        detail: budget.utilised <= budget.effectiveAllocated
          ? `${pkr(budget.utilised, { compact: true })} of ${pkr(budget.effectiveAllocated, { compact: true })} (${budget.utilisationPct.toFixed(1)}%)`
          : `Over by ${pkr(Math.abs(budget.variance), { compact: true })}`,
      },
    ],
    budget,
    rows,
  };
}
