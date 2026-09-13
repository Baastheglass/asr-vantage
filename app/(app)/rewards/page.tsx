import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { activeCycle, timeline, fmtDateTime, fmtDate } from '@/lib/cycle';
import { cycleBudget, divisionRows, pkr, pct } from '@/lib/budget';
import { Card, Kpi, Badge, Meter, Th, Td, PageHeader, EmptyState, budgetTone, statusTone, humanStatus } from '@/components/ui';
import { Timeline } from '@/components/timeline';

export const dynamic = 'force-dynamic';

export default async function RewardsPage() {
  const user = await requireUser();
  if (!['REWARDS', 'HR_MANAGER', 'ADMIN'].includes(user.role)) redirect('/');

  const cycle = activeCycle();
  if (!cycle) return <Card><EmptyState title="No ASR cycle" /></Card>;

  const released = ['SUBMITTED_TO_REWARDS', 'COMPLETED'].includes(cycle.status);

  if (!released) {
    return (
      <>
        <PageHeader title="Final approved ASR" subtitle={cycle.name} />
        <Card>
          <EmptyState
            title="This ASR has not been released yet"
            hint={
              user.role === 'REWARDS'
                ? 'The review is still in progress with HR. You will be notified the moment the approved ASR is submitted to Rewards — until then no salary data is accessible from this account.'
                : `The cycle is currently at "${humanStatus(cycle.status)}". Complete the GSM approval, then submit to Rewards from the Approval centre.`
            }
          />
        </Card>
        {user.role !== 'REWARDS' && (
          <Card title="ASR workflow" className="mt-4"><Timeline stages={timeline(cycle.id)} /></Card>
        )}
      </>
    );
  }

  const budget = cycleBudget(cycle.id);
  const rows = divisionRows(cycle.id);
  const snapshot = cycle.frozen_snapshot ? JSON.parse(cycle.frozen_snapshot) : null;
  const approval = db.prepare(
    `SELECT actor_name AS actor, comment, at FROM approvals
      WHERE cycle_id = ? AND stage='GSM_APPROVAL' AND action='APPROVE' ORDER BY id DESC LIMIT 1`,
  ).get(cycle.id) as any;

  return (
    <>
      <PageHeader
        title="Final approved ASR"
        subtitle={cycle.name}
        meta={<>
          <Badge tone="green">Approved &amp; released</Badge>
          <Badge tone="gray">Effective {fmtDate(cycle.effective_date)}</Badge>
          <Badge tone="gray">Released {fmtDateTime(cycle.rewards_submitted_at)}</Badge>
        </>}
        actions={<a href="/api/export/cycle" className="btn-primary">Download final ASR</a>}
      />

      <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 mb-4">
        <p className="text-[13px] text-emerald-900">
          <span className="font-semibold">This version is frozen.</span>{' '}
          {snapshot?.records?.length?.toLocaleString('en-PK') ?? rows.reduce((s, r) => s + r.employees, 0).toLocaleString('en-PK')} records
          were locked at release{approval ? `, following approval by ${approval.actor} on ${fmtDateTime(approval.at)}` : ''}.
          No further changes can be made to this cycle.
        </p>
        {approval?.comment && <p className="text-[13px] text-emerald-800 mt-1 italic">&ldquo;{approval.comment}&rdquo;</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Kpi label="Approved budget" value={pkr(budget.effectiveAllocated, { compact: true })}
          sub={budget.additionalApproved ? `incl. ${pkr(budget.additionalApproved, { compact: true })} exceptions` : undefined} />
        <Kpi label="Total impact" value={pkr(budget.utilised, { compact: true })} tone={budgetTone(budget.status)} />
        <Kpi label="Increment cost" value={pkr(budget.incrementCost, { compact: true })} sub="annualised" />
        <Kpi label="Bonus cost" value={pkr(budget.bonusCost, { compact: true })} sub="one-off" />
        <Kpi label="Utilisation" value={pct(budget.utilisationPct)} tone={budgetTone(budget.status)}
          sub={<Meter value={budget.utilisationPct} tone={budgetTone(budget.status)} height="h-1.5" />} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 overflow-hidden" bodyClass="p-0"
          title="Approved position by division">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                <Th>Division</Th><Th align="right">Employees</Th><Th align="right">Allocated</Th>
                <Th align="right">Approved impact</Th><Th align="right">Variance</Th><Th align="right">Utilisation</Th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.divisionId} className="row-hover">
                    <Td className="font-medium">{r.name}</Td>
                    <Td align="right" num>{r.employees}</Td>
                    <Td align="right" num>{pkr(r.effectiveAllocated, { compact: true })}</Td>
                    <Td align="right" num>{pkr(r.utilised, { compact: true })}</Td>
                    <Td align="right" num className={r.variance < 0 ? 'text-red-700' : 'text-ink-600'}>
                      {pkr(r.variance, { compact: true })}
                    </Td>
                    <Td align="right" num>{pct(r.utilisationPct)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-ink-50 font-semibold">
                  <Td>Total</Td>
                  <Td align="right" num>{rows.reduce((s, r) => s + r.employees, 0)}</Td>
                  <Td align="right" num>{pkr(budget.effectiveAllocated, { compact: true })}</Td>
                  <Td align="right" num>{pkr(budget.utilised, { compact: true })}</Td>
                  <Td align="right" num>{pkr(budget.variance, { compact: true })}</Td>
                  <Td align="right" num>{pct(budget.utilisationPct)}</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card title="ASR workflow"><Timeline stages={timeline(cycle.id)} /></Card>
      </div>
    </>
  );
}
