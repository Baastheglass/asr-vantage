import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { assertDivisionAccess, canEdit, employeeScope } from '@/lib/rbac';
import { db } from '@/lib/db';
import { activeCycle, fmtDate } from '@/lib/cycle';
import { divisionBudget } from '@/lib/budget';
import { Card, Badge, PageHeader, EmptyState, statusTone, humanStatus } from '@/components/ui';
import { WorkspaceTable } from '@/components/workspace-table';

export const dynamic = 'force-dynamic';

export default async function DivisionWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const divisionId = Number((await params).id);

  // Throws 403 before any data is read if the division is outside the caller's scope.
  assertDivisionAccess(user, divisionId);

  const cycle = activeCycle();
  if (!cycle) return <Card><EmptyState title="No active ASR cycle" /></Card>;

  const division = db.prepare(
    `SELECT d.id, d.code, d.name, u.name AS hodName FROM divisions d
       LEFT JOIN users u ON u.id = d.hod_user_id WHERE d.id = ?`,
  ).get(divisionId) as { id: number; code: string; name: string; hodName: string | null } | undefined;

  if (!division) return <Card><EmptyState title="Division not found" /></Card>;

  const budgetRow = db.prepare(
    `SELECT status, deadline, submitted_at AS submittedAt, returned_reason AS returnedReason
       FROM division_budgets WHERE cycle_id = ? AND division_id = ?`,
  ).get(cycle.id, divisionId) as any;

  const budget = divisionBudget(cycle.id, divisionId);

  // Headcount visible to THIS caller (a Director sees only their departments).
  const scope = employeeScope(user, 'e');
  const visible = db.prepare(
    `SELECT COUNT(*) AS n FROM asr_records r JOIN employees e ON e.id = r.employee_id
      WHERE r.cycle_id = ? AND e.division_id = ? AND ${scope.sql}`,
  ).get(cycle.id, divisionId, ...scope.params) as { n: number };

  const myDepartments = user.role === 'DIRECTOR'
    ? (db.prepare(`SELECT name FROM departments WHERE director_user_id = ? AND division_id = ?`)
        .all(user.id, divisionId) as { name: string }[]).map((d) => d.name)
    : [];

  const workflowStatus = budgetRow?.status ?? 'NOT_STARTED';

  return (
    <>
      <PageHeader
        title={division.name}
        subtitle={
          user.role === 'DIRECTOR'
            ? `Your departments: ${myDepartments.join(', ') || 'none assigned'} · ${visible.n} employees visible to you`
            : `Head of Department: ${division.hodName ?? '—'} · ${visible.n} employees`
        }
        meta={
          <>
            <Badge tone={statusTone(workflowStatus)}>{humanStatus(workflowStatus)}</Badge>
            <Badge tone="gray">{cycle.name}</Badge>
            {budgetRow?.deadline && <Badge tone="gray">Deadline {fmtDate(budgetRow.deadline)}</Badge>}
            {budgetRow?.submittedAt && <Badge tone="green">Submitted {fmtDate(budgetRow.submittedAt)}</Badge>}
          </>
        }
        actions={
          <>
            <a href={`/api/export/division/${divisionId}`} className="btn-secondary">Export</a>
            {(user.role === 'HR_MANAGER' || user.role === 'ADMIN') && (
              <Link href="/workspace" className="btn-secondary">All divisions</Link>
            )}
          </>
        }
      />

      {user.role === 'DIRECTOR' && (
        <p className="mb-4 text-[13px] text-blue-800 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
          You are seeing only the employees in the departments assigned to you. Salary information for the
          rest of {division.name} is not accessible from this account.
        </p>
      )}

      {budgetRow?.returnedReason && (
        <p className="mb-4 text-[13px] text-amber-900 bg-amber-50 border border-amber-300 rounded-md px-3 py-2">
          <span className="font-semibold">Returned by HR:</span> {budgetRow.returnedReason}
        </p>
      )}

      <WorkspaceTable
        divisionId={divisionId}
        divisionName={division.name}
        canEdit={canEdit(user)}
        initialBudget={budget}
        workflowStatus={workflowStatus}
        isHR={user.role === 'HR_MANAGER' || user.role === 'ADMIN'}
      />
    </>
  );
}
