import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { activeCycle, fmtDate } from '@/lib/cycle';
import { divisionRows, pkr, pct } from '@/lib/budget';
import { visibleDivisionIds } from '@/lib/rbac';
import { Card, Badge, Meter, PageHeader, EmptyState, budgetTone, statusTone, humanStatus, Th, Td } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function WorkspaceIndex() {
  const user = await requireUser();
  const cycle = activeCycle();

  if (!cycle) {
    return <Card><EmptyState title="No active ASR cycle" hint="HR has not yet uploaded the master file from Rewards." /></Card>;
  }

  const allowed = visibleDivisionIds(user);
  if (allowed !== 'ALL' && allowed.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No division has been assigned to you"
          hint="Your account is not currently linked to a division or department. Contact the HR Manager if you believe this is an error."
        />
      </Card>
    );
  }

  // A Director or HOD with exactly one division goes straight into it.
  if (allowed !== 'ALL' && allowed.length === 1) redirect(`/workspace/${allowed[0]}`);

  const rows = divisionRows(cycle.id).filter((r) => allowed === 'ALL' || allowed.includes(r.divisionId));

  return (
    <>
      <PageHeader
        title="Division workspaces"
        subtitle={`${cycle.name} · each division holds only its own employees`}
        meta={<Badge tone="gray">{rows.length} workspace{rows.length === 1 ? '' : 's'}</Badge>}
      />

      <Card bodyClass="p-0" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Division</Th>
                <Th>Head of Department</Th>
                <Th align="right">Employees</Th>
                <Th align="right">Allocated</Th>
                <Th align="right">Utilised</Th>
                <Th>Utilisation</Th>
                <Th>Review progress</Th>
                <Th>Status</Th>
                <Th align="right">Deadline</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.divisionId} className="row-hover">
                  <Td><span className="font-medium text-ink-900">{r.name}</span>
                    <span className="block text-2xs text-ink-500">{r.code}</span></Td>
                  <Td className="text-ink-700">{r.hodName ?? '—'}</Td>
                  <Td align="right" num>{r.employees}</Td>
                  <Td align="right" num>{pkr(r.effectiveAllocated, { compact: true })}</Td>
                  <Td align="right" num>{pkr(r.utilised, { compact: true })}</Td>
                  <Td className="w-36">
                    <div className="flex items-center gap-2">
                      <Meter value={r.utilisationPct} tone={budgetTone(r.status)} height="h-1.5" />
                      <span className="text-2xs tabular w-11 text-right">{pct(r.utilisationPct)}</span>
                    </div>
                  </Td>
                  <Td className="w-28">
                    <div className="flex items-center gap-2">
                      <Meter value={r.completionPct} tone="blue" height="h-1.5" showOverflow={false} />
                      <span className="text-2xs tabular w-8 text-right">{pct(r.completionPct, 0)}</span>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.workflowStatus)}>{humanStatus(r.workflowStatus)}</Badge>
                    {r.openExceptions > 0 && <Badge tone="amber" className="ml-1">{r.openExceptions} exc.</Badge>}
                  </Td>
                  <Td align="right" className="text-ink-500">{fmtDate(r.deadline)}</Td>
                  <Td align="right">
                    <Link href={`/workspace/${r.divisionId}`} className="btn-secondary btn-sm">Open</Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
