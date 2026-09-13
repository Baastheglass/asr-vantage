import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { activeCycle, timeline, fmtDateTime } from '@/lib/cycle';
import { cycleBudget, divisionRows, pkr, pct } from '@/lib/budget';
import { readinessChecks } from '@/lib/workflow';
import { Card, Kpi, Badge, Meter, Th, Td, PageHeader, EmptyState, budgetTone, statusTone, humanStatus } from '@/components/ui';
import { Timeline } from '@/components/timeline';
import { ApprovalActions } from '@/components/approval-actions';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const user = await requireUser();
  if (!['HR_MANAGER', 'ADMIN', 'GSM_PRESIDENT'].includes(user.role)) redirect('/');

  const cycle = activeCycle();
  if (!cycle) return <Card><EmptyState title="No active ASR cycle" /></Card>;

  const { checks } = readinessChecks(cycle.id);
  const budget = cycleBudget(cycle.id);
  const rows = divisionRows(cycle.id);
  const stages = timeline(cycle.id);
  const ready = checks.every((c) => c.passed);

  const history = db.prepare(
    `SELECT stage, actor_name AS actor, action, comment, at FROM approvals WHERE cycle_id = ? ORDER BY id DESC`,
  ).all(cycle.id) as any[];

  const isGSM = user.role === 'GSM_PRESIDENT';
  const isHR = user.role === 'HR_MANAGER' || user.role === 'ADMIN';

  // The exception workflow belongs to HR and Rewards. The President approves the
  // ASR as a whole — any approved top-up is already inside the budget totals he
  // sees, so the individual requests are not surfaced to him.
  const exceptions = isHR
    ? (db.prepare(
        `SELECT be.id, d.name AS divisionName, be.requested_amount AS amount, be.justification,
                be.status, u.name AS requestedBy
           FROM budget_exceptions be JOIN divisions d ON d.id = be.division_id
           JOIN users u ON u.id = be.requested_by
          WHERE be.cycle_id = ? ORDER BY be.created_at DESC`,
      ).all(cycle.id) as any[])
    : [];

  return (
    <>
      <PageHeader
        title="Approval centre"
        subtitle={cycle.name}
        meta={<>
          <Badge tone={statusTone(cycle.status)}>{humanStatus(cycle.status)}</Badge>
          {cycle.gsm_submitted_at && <Badge tone="gray">Sent to GSM {fmtDateTime(cycle.gsm_submitted_at)}</Badge>}
          {cycle.gsm_decided_at && <Badge tone="gray">Decided {fmtDateTime(cycle.gsm_decided_at)}</Badge>}
        </>}
        actions={<a href="/api/export/cycle" className="btn-secondary">Export full ASR</a>}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Kpi label="Total budget" value={pkr(budget.effectiveAllocated, { compact: true })} />
        <Kpi label="Total utilised" value={pkr(budget.utilised, { compact: true })} tone={budgetTone(budget.status)} />
        <Kpi label="Remaining" value={pkr(budget.remaining, { compact: true })} tone={budget.remaining < 0 ? 'red' : undefined} />
        <Kpi label="Utilisation" value={pct(budget.utilisationPct)} tone={budgetTone(budget.status)}
          sub={<Meter value={budget.utilisationPct} tone={budgetTone(budget.status)} height="h-1.5" />} />
        <Kpi label="Employees" value={rows.reduce((s, r) => s + r.employees, 0).toLocaleString('en-PK')} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Readiness checks"
            subtitle={isHR
              ? 'All checks must pass before the ASR can go to the GSM President'
              : 'Status of the ASR that has been submitted for your approval'}>
            <ul className="space-y-2">
              {checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 w-4 h-4 rounded-full grid place-items-center text-[10px] font-bold text-white shrink-0
                    ${c.passed ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                    {c.passed ? '✓' : '!'}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-[13px] ${c.passed ? 'text-ink-800' : 'text-ink-900 font-medium'}`}>{c.label}</p>
                    <p className="text-2xs text-ink-500">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <ApprovalActions
            cycleId={cycle.id}
            cycleName={cycle.name}
            status={cycle.status}
            ready={ready}
            role={user.role}
            divisions={rows.map((r) => ({ id: r.divisionId, name: r.name, status: r.workflowStatus }))}
          />

          <Card title="Division summary" subtitle="What the President is approving" bodyClass="p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <Th>Division</Th><Th align="right">Employees</Th><Th align="right">Allocated</Th>
                  <Th align="right">Utilised</Th><Th align="right">Utilisation</Th><Th>Status</Th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.divisionId} className="row-hover">
                      <Td className="font-medium">{r.name}</Td>
                      <Td align="right" num>{r.employees}</Td>
                      <Td align="right" num>{pkr(r.effectiveAllocated, { compact: true })}</Td>
                      <Td align="right" num>{pkr(r.utilised, { compact: true })}</Td>
                      <Td align="right" num className={r.status === 'OVER' ? 'text-red-700 font-medium' : ''}>
                        {pct(r.utilisationPct)}
                      </Td>
                      <Td><Badge tone={statusTone(r.workflowStatus)}>{humanStatus(r.workflowStatus)}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {exceptions.length > 0 && (
            <Card title="Budget exceptions in this cycle" bodyClass="p-0" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr>
                    <Th>Division</Th><Th align="right">Amount</Th><Th>Status</Th>
                    <Th>Requested by</Th><Th>Justification</Th>
                  </tr></thead>
                  <tbody>
                    {exceptions.map((e) => (
                      <tr key={e.id} className="row-hover">
                        <Td className="font-medium">{e.divisionName}</Td>
                        <Td align="right" num>{pkr(e.amount)}</Td>
                        <Td><Badge tone={e.status === 'APPROVED' ? 'green' : e.status === 'REJECTED' ? 'red' : 'amber'}>
                          {humanStatus(e.status)}</Badge></Td>
                        <Td>{e.requestedBy}</Td>
                        <Td className="max-w-md whitespace-normal text-2xs text-ink-600">{e.justification}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="ASR workflow"><Timeline stages={stages} /></Card>

          <Card title="Approval history" bodyClass="p-0">
            {history.length === 0 ? (
              <EmptyState title="No approval actions yet" />
            ) : (
              <ul className="divide-y divide-ink-100">
                {history.map((h, i) => (
                  <li key={i} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={h.action.includes('APPROVE') ? 'green' : h.action.includes('REJECT') || h.action.includes('CHANGES') ? 'red' : 'blue'}>
                        {humanStatus(h.action)}
                      </Badge>
                      <span className="text-2xs text-ink-500">{humanStatus(h.stage)}</span>
                    </div>
                    <p className="text-[13px] text-ink-800 mt-1">{h.actor}</p>
                    <p className="text-2xs text-ink-500">{fmtDateTime(h.at)}</p>
                    {h.comment && <p className="text-2xs text-ink-600 mt-1 italic">&ldquo;{h.comment}&rdquo;</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
