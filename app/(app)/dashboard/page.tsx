import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { activeCycle, timeline, fmtDate } from '@/lib/cycle';
import { cycleBudget, divisionRows, pkr, pct } from '@/lib/budget';
import {
  Card, Kpi, Badge, Meter, Th, Td, PageHeader, EmptyState, budgetTone, statusTone, humanStatus,
} from '@/components/ui';
import { Timeline } from '@/components/timeline';
import { UtilisationChart } from '@/components/dashboard-charts';
import { DistributeBanner } from '@/components/distribute-banner';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  if (!['HR_MANAGER', 'ADMIN', 'GSM_PRESIDENT'].includes(user.role)) redirect('/');

  const cycle = activeCycle();
  if (!cycle) {
    return (
      <Card>
        <EmptyState
          title="No ASR cycle yet"
          hint="The annual salary review begins when the Rewards department uploads the master ASR sheet. You will be notified as soon as it arrives."
        />
      </Card>
    );
  }

  const budget = cycleBudget(cycle.id);
  const rows = divisionRows(cycle.id);
  const stages = timeline(cycle.id);

  const totalEmployees = rows.reduce((s, r) => s + r.employees, 0);
  const reviewed = rows.reduce((s, r) => s + r.reviewed, 0);
  const completedDivs = rows.filter((r) => r.workflowStatus === 'SUBMITTED' || r.workflowStatus === 'VALIDATED').length;
  const overBudget = rows.filter((r) => r.status === 'OVER');
  const notStarted = rows.filter((r) => r.workflowStatus === 'NOT_STARTED');
  const openExceptions = rows.reduce((s, r) => s + r.openExceptions, 0);

  const pendingApprovals =
    cycle.status === 'PENDING_GSM' ? 1 : 0;

  const deadlinePassed = cycle.review_deadline ? new Date(cycle.review_deadline) < new Date() : false;

  return (
    <>
      <PageHeader
        title={cycle.name}
        subtitle={`Effective ${fmtDate(cycle.effective_date)} · Review deadline ${fmtDate(cycle.review_deadline)}${deadlinePassed ? ' (passed)' : ''}`}
        meta={
          <>
            <Badge tone={statusTone(cycle.status)}>{humanStatus(cycle.status)}</Badge>
            <Badge tone="gray">{totalEmployees.toLocaleString('en-PK')} employees</Badge>
            <Badge tone="gray">{rows.length} divisions</Badge>
            {cycle.source_file && <Badge tone="gray">Source: {cycle.source_file}</Badge>}
          </>
        }
        actions={
          user.role !== 'GSM_PRESIDENT' && (
            <>
              <Link href="/analytics" className="btn-secondary">Analytics</Link>
              <Link href="/approvals" className="btn-primary">Approval centre</Link>
            </>
          )
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
        <Kpi label="Total ASR Budget" value={pkr(budget.totalBudget, { compact: true })}
          sub={budget.additionalApproved > 0 ? `+${pkr(budget.additionalApproved, { compact: true })} approved exceptions` : 'Allocated by Rewards'} emphasis />
        <Kpi label="Utilised Budget" value={pkr(budget.utilised, { compact: true })}
          tone={budgetTone(budget.status)}
          sub={`${pkr(budget.incrementCost, { compact: true })} increments · ${pkr(budget.bonusCost, { compact: true })} bonus`} />
        <Kpi label="Remaining Budget" value={pkr(budget.remaining, { compact: true })}
          tone={budget.remaining < 0 ? 'red' : undefined}
          sub={budget.remaining < 0 ? 'Company is over budget' : 'Available to allocate'} />
        <Kpi label="Overall Utilisation" value={pct(budget.utilisationPct)}
          tone={budgetTone(budget.status)}
          sub={<Meter value={budget.utilisationPct} tone={budgetTone(budget.status)} height="h-1.5" />} />
        <Kpi label="Review Progress" value={pct(totalEmployees ? (reviewed / totalEmployees) * 100 : 0, 0)}
          sub={`${reviewed.toLocaleString('en-PK')} of ${totalEmployees.toLocaleString('en-PK')} employees reviewed`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Divisions Completed" value={`${completedDivs} / ${rows.length}`}
          sub={`${notStarted.length} not started`} />
        <Kpi label="Over Budget" value={overBudget.length}
          tone={overBudget.length ? 'red' : 'green'}
          sub={overBudget.length ? overBudget.map((d) => d.name).join(', ') : 'All divisions within allocation'} />
        <Kpi label="Active Exceptions" value={openExceptions} tone={openExceptions ? 'amber' : undefined}
          sub={openExceptions ? <Link href="/exceptions" className="text-jazz-700 hover:underline">Review requests</Link> : 'None pending'} />
        <Kpi label="Pending Approvals" value={pendingApprovals}
          sub={cycle.status === 'PENDING_GSM' ? 'Awaiting GSM President' : 'None outstanding'} />
      </div>

      {/* Awaiting distribution */}
      {(user.role === 'HR_MANAGER' || user.role === 'ADMIN') && !cycle.distributed_at && (
        <DistributeBanner
          cycleId={cycle.id}
          cycleName={cycle.name}
          employees={totalEmployees}
          divisions={rows.length}
          totalBudget={budget.totalBudget}
        />
      )}

      {/* Alerts */}
      {(overBudget.length > 0 || openExceptions > 0) && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" className="text-amber-600 mt-0.5 shrink-0">
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div className="text-[13px] text-amber-900">
              <p className="font-medium">Budget attention required</p>
              <p className="mt-0.5 text-amber-800">
                {overBudget.length > 0 && (
                  <>
                    {overBudget.map((d) => `${d.name} is over by ${pkr(Math.abs(d.variance), { compact: true })}`).join('; ')}.{' '}
                  </>
                )}
                {openExceptions > 0 && <>{openExceptions} budget exception request{openExceptions > 1 ? 's are' : ' is'} awaiting your decision. </>}
                <Link href="/exceptions" className="underline font-medium">Open exception queue</Link>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        {/* Division table */}
        <Card className="lg:col-span-2 overflow-hidden" bodyClass="p-0"
          title="Division budget &amp; progress"
          subtitle="Live utilisation across every division in this cycle"
          action={<Link href="/analytics" className="btn-secondary btn-sm">Detailed analytics</Link>}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Division</Th>
                  <Th align="right">Employees</Th>
                  <Th align="right">Allocated</Th>
                  <Th align="right">Utilised</Th>
                  <Th align="right">Remaining</Th>
                  <Th>Utilisation</Th>
                  <Th align="right">Variance</Th>
                  <Th>Progress</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.divisionId} className="row-hover">
                    <Td>
                      <Link href={`/workspace/${r.divisionId}`} className="font-medium text-ink-900 hover:text-jazz-700">
                        {r.name}
                      </Link>
                      <span className="block text-2xs text-ink-500">{r.hodName ?? 'No HOD assigned'}</span>
                    </Td>
                    <Td align="right" num>{r.employees}</Td>
                    <Td align="right" num>
                      {pkr(r.effectiveAllocated, { compact: true })}
                      {r.additionalApproved > 0 && (
                        <span className="block text-2xs text-emerald-700">+{pkr(r.additionalApproved, { compact: true })} exc.</span>
                      )}
                    </Td>
                    <Td align="right" num>{pkr(r.utilised, { compact: true })}</Td>
                    <Td align="right" num className={r.remaining < 0 ? 'text-red-700 font-medium' : ''}>
                      {pkr(r.remaining, { compact: true })}
                    </Td>
                    <Td className="w-36">
                      <div className="flex items-center gap-2">
                        <Meter value={r.utilisationPct} tone={budgetTone(r.status)} height="h-1.5" />
                        <span className="text-2xs tabular text-ink-600 w-11 text-right">{pct(r.utilisationPct)}</span>
                      </div>
                    </Td>
                    <Td align="right" num className={r.variance < 0 ? 'text-red-700 font-medium' : 'text-ink-600'}>
                      {r.variance < 0 ? '−' : '+'}{pkr(Math.abs(r.variance), { compact: true }).replace('PKR ', '')}
                    </Td>
                    <Td className="w-28">
                      <div className="flex items-center gap-2">
                        <Meter value={r.completionPct} tone="blue" height="h-1.5" showOverflow={false} />
                        <span className="text-2xs tabular text-ink-600 w-8 text-right">{pct(r.completionPct, 0)}</span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Badge tone={statusTone(r.workflowStatus)}>{humanStatus(r.workflowStatus)}</Badge>
                        {r.openExceptions > 0 && <Badge tone="amber">{r.openExceptions} exc.</Badge>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-ink-50 font-semibold">
                  <Td>Company total</Td>
                  <Td align="right" num>{totalEmployees}</Td>
                  <Td align="right" num>{pkr(budget.effectiveAllocated, { compact: true })}</Td>
                  <Td align="right" num>{pkr(budget.utilised, { compact: true })}</Td>
                  <Td align="right" num className={budget.remaining < 0 ? 'text-red-700' : ''}>{pkr(budget.remaining, { compact: true })}</Td>
                  <Td><Meter value={budget.utilisationPct} tone={budgetTone(budget.status)} height="h-1.5" /></Td>
                  <Td align="right" num>{pct(budget.utilisationPct)}</Td>
                  <Td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {/* Timeline */}
        <Card title="ASR workflow" subtitle="Current position in the annual cycle">
          <Timeline stages={stages} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Budget utilisation by division" subtitle="Allocated versus proposed, highest utilisation first">
          <UtilisationChart
            data={[...rows].sort((a, b) => b.utilisationPct - a.utilisationPct).map((r) => ({
              name: r.code, full: r.name,
              allocated: r.effectiveAllocated, utilised: r.utilised,
              utilisation: Number(r.utilisationPct.toFixed(1)), status: r.status,
            }))}
          />
        </Card>

        <Card title="Divisions requiring attention" subtitle="Behind schedule, over budget, or not started"
          bodyClass="p-0">
          <div className="divide-y divide-ink-100">
            {[...rows]
              .filter((r) => r.status === 'OVER' || r.workflowStatus === 'NOT_STARTED' || r.completionPct < 50)
              .sort((a, b) => (b.status === 'OVER' ? 1 : 0) - (a.status === 'OVER' ? 1 : 0) || a.completionPct - b.completionPct)
              .slice(0, 8)
              .map((r) => (
                <div key={r.divisionId} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/workspace/${r.divisionId}`} className="text-[13px] font-medium text-ink-900 hover:text-jazz-700">
                      {r.name}
                    </Link>
                    <p className="text-2xs text-ink-500">
                      {r.employees} employees · {pct(r.completionPct, 0)} reviewed · {r.hodName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[13px] tabular font-medium ${r.status === 'OVER' ? 'text-red-700' : 'text-ink-700'}`}>
                      {pct(r.utilisationPct)}
                    </p>
                    <Badge tone={r.status === 'OVER' ? 'red' : statusTone(r.workflowStatus)}>
                      {r.status === 'OVER' ? 'Over budget' : humanStatus(r.workflowStatus)}
                    </Badge>
                  </div>
                </div>
              ))}
            {rows.every((r) => r.status !== 'OVER' && r.workflowStatus !== 'NOT_STARTED' && r.completionPct >= 50) && (
              <EmptyState title="Everything is on track" hint="No division is over budget or behind schedule." />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
