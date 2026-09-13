import { requireRole } from '@/lib/auth';
import { handler, ok, bad, num } from '@/lib/api';
import { db, audit, notify, logStage } from '@/lib/db';
import { pkr } from '@/lib/budget';

export const dynamic = 'force-dynamic';

/**
 * The "split and send" action.
 *
 * Replaces the manual step of slicing the master workbook into one file per
 * department and emailing them out. Each division already holds only its own
 * records; this marks them released and notifies the HOD who owns each one.
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireRole('HR_MANAGER', 'ADMIN');
  const cycleId = num((await ctx.params).id);

  const cycle = db.prepare(`SELECT id, name, status, review_deadline FROM asr_cycles WHERE id = ?`).get(cycleId) as any;
  if (!cycle) return bad('ASR cycle not found', 404);
  if (['SUBMITTED_TO_REWARDS', 'COMPLETED'].includes(cycle.status)) {
    return bad('This cycle is closed and cannot be redistributed.', 409);
  }

  const divisions = db.prepare(
    `SELECT d.id, d.name, d.hod_user_id AS hodId, u.name AS hodName,
            COUNT(r.id) AS employees,
            COALESCE(db.allocated_budget,0) AS allocated
       FROM divisions d
       LEFT JOIN users u ON u.id = d.hod_user_id
       LEFT JOIN division_budgets db ON db.division_id = d.id AND db.cycle_id = ?
       LEFT JOIN employees e ON e.division_id = d.id AND e.is_active = 1
       LEFT JOIN asr_records r ON r.employee_id = e.id AND r.cycle_id = ?
      GROUP BY d.id HAVING employees > 0
      ORDER BY d.name`,
  ).all(cycleId, cycleId) as any[];

  if (divisions.length === 0) return bad('There are no divisions with employees in this cycle.');

  const unallocated = divisions.filter((d) => d.allocated <= 0).map((d) => d.name);
  const noHod = divisions.filter((d) => !d.hodId).map((d) => d.name);

  let notified = 0;
  const tx = db.transaction(() => {
    for (const d of divisions) {
      db.prepare(
        `UPDATE division_budgets SET status = CASE WHEN status='NOT_STARTED' THEN 'NOT_STARTED' ELSE status END
          WHERE cycle_id=? AND division_id=?`,
      ).run(cycleId, d.id);

      if (d.hodId) {
        notify({
          userId: d.hodId,
          type: 'ASR_ASSIGNED',
          severity: 'info',
          title: `${cycle.name} is ready for ${d.name}`,
          body: `${d.employees} employees have been assigned to your division with an allocated budget of ${pkr(d.allocated, { compact: true })}.${cycle.review_deadline ? ` Please complete your review by ${cycle.review_deadline}.` : ''}`,
          link: `/workspace/${d.id}`,
        });
        notified++;
      }
      logStage({ cycleId, divisionId: d.id, stage: 'DEPARTMENTS_DISTRIBUTED', status: 'COMPLETED', actor: user,
        note: `${d.employees} employees released to ${d.hodName ?? 'division'}` });
    }

    db.prepare(`UPDATE asr_cycles SET status='IN_REVIEW', distributed_at=datetime('now') WHERE id=?`).run(cycleId);
  });
  tx();

  logStage({ cycleId, stage: 'DEPARTMENTS_DISTRIBUTED', status: 'COMPLETED', actor: user,
    note: `${divisions.length} division workspaces created and released` });
  logStage({ cycleId, stage: 'DEPARTMENT_REVIEW', status: 'IN_PROGRESS', actor: user,
    note: 'Divisions are entering recommendations' });

  audit({ actor: user, action: 'CYCLE_DISTRIBUTED', entity: 'asr_cycle', entityId: cycleId,
    after: { divisions: divisions.length, notified } });

  return ok({
    divisions: divisions.map((d) => ({ id: d.id, name: d.name, hodName: d.hodName, employees: d.employees, allocated: d.allocated })),
    notified,
    warnings: [
      ...(unallocated.length ? [`No budget has been allocated to: ${unallocated.join(', ')}.`] : []),
      ...(noHod.length ? [`No HOD account is linked to: ${noHod.join(', ')} — these workspaces were created but nobody was notified.`] : []),
    ],
  });
});
