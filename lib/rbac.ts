import { db, type SessionUser } from './db';
import { HttpError } from './auth';

/**
 * Row-level security.
 *
 * Every query that touches employee or salary data MUST compose its WHERE
 * clause with `employeeScope()`. The fragment is generated from the session
 * that was re-read from the database, never from client input, so changing a
 * URL, editing the DOM or hand-crafting a request cannot widen what comes back
 * — the restriction is applied inside the SQL statement itself.
 *
 *   HR_MANAGER / ADMIN : entire company
 *   GSM_PRESIDENT      : entire company, read-only (approval needs the full picture)
 *   REWARDS            : entire company, read-only, and only once a cycle is approved
 *   HOD                : their own division only
 *   DIRECTOR           : only the departments they are named director of
 */
export interface Scope {
  sql: string;
  params: unknown[];
}

export function employeeScope(user: SessionUser, alias = 'e'): Scope {
  switch (user.role) {
    case 'HR_MANAGER':
    case 'ADMIN':
    case 'GSM_PRESIDENT':
    case 'REWARDS':
      return { sql: '1=1', params: [] };

    case 'HOD':
      if (!user.divisionId) return { sql: '1=0', params: [] };
      return { sql: `${alias}.division_id = ?`, params: [user.divisionId] };

    case 'DIRECTOR':
      return {
        sql: `${alias}.department_id IN (SELECT id FROM departments WHERE director_user_id = ?)`,
        params: [user.id],
      };

    default:
      return { sql: '1=0', params: [] };
  }
}

/** Divisions the caller may open a workspace for. */
export function visibleDivisionIds(user: SessionUser): number[] | 'ALL' {
  if (['HR_MANAGER', 'ADMIN', 'GSM_PRESIDENT', 'REWARDS'].includes(user.role)) return 'ALL';
  if (user.role === 'HOD') return user.divisionId ? [user.divisionId] : [];
  if (user.role === 'DIRECTOR') {
    const rows = db
      .prepare(`SELECT DISTINCT division_id AS id FROM departments WHERE director_user_id = ?`)
      .all(user.id) as { id: number }[];
    return rows.map((r) => r.id);
  }
  return [];
}

export function assertDivisionAccess(user: SessionUser, divisionId: number) {
  const allowed = visibleDivisionIds(user);
  if (allowed === 'ALL') return;
  if (!allowed.includes(divisionId)) {
    throw new HttpError(403, 'You do not have access to this division');
  }
}

/** Can this user type salary recommendations at all? */
export function canEdit(user: SessionUser): boolean {
  return user.role === 'HOD' || user.role === 'DIRECTOR' || user.role === 'HR_MANAGER' || user.role === 'ADMIN';
}

/**
 * Authoritative per-record write check. Re-derives the record's division and
 * department from the database and tests them against the caller's scope.
 * Also refuses writes once the division or cycle is locked.
 */
export function assertCanEditRecord(user: SessionUser, recordId: number) {
  if (!canEdit(user)) throw new HttpError(403, 'Your role cannot modify salary recommendations');

  const row = db
    .prepare(
      `SELECT r.id, r.cycle_id, r.status,
              e.division_id, e.department_id,
              c.status AS cycle_status,
              db.status AS division_status
         FROM asr_records r
         JOIN employees e   ON e.id = r.employee_id
         JOIN asr_cycles c  ON c.id = r.cycle_id
         LEFT JOIN division_budgets db
                ON db.cycle_id = r.cycle_id AND db.division_id = e.division_id
        WHERE r.id = ?`,
    )
    .get(recordId) as
    | { id: number; cycle_id: number; status: string; division_id: number; department_id: number; cycle_status: string; division_status: string | null }
    | undefined;

  if (!row) throw new HttpError(404, 'Record not found');

  if (user.role === 'HOD') {
    if (row.division_id !== user.divisionId) throw new HttpError(403, 'Record is outside your division');
  } else if (user.role === 'DIRECTOR') {
    const ok = db
      .prepare(`SELECT 1 FROM departments WHERE id = ? AND director_user_id = ?`)
      .get(row.department_id, user.id);
    if (!ok) throw new HttpError(403, 'Record is outside the departments assigned to you');
  }

  const locked = ['APPROVED', 'SUBMITTED_TO_REWARDS', 'COMPLETED', 'PENDING_GSM'];
  if (locked.includes(row.cycle_status)) {
    throw new HttpError(409, 'This ASR cycle is locked and can no longer be edited');
  }
  if (row.division_status === 'SUBMITTED' && user.role !== 'HR_MANAGER' && user.role !== 'ADMIN') {
    throw new HttpError(409, 'This division has already been submitted to HR. Ask HR to reopen it.');
  }
  return row;
}

/** Rewards may only ever see a cycle that has been formally submitted to them. */
export function assertCycleVisible(user: SessionUser, cycleId: number) {
  if (user.role !== 'REWARDS') return;
  const c = db.prepare(`SELECT status FROM asr_cycles WHERE id = ?`).get(cycleId) as { status: string } | undefined;
  if (!c || !['SUBMITTED_TO_REWARDS', 'COMPLETED'].includes(c.status)) {
    throw new HttpError(403, 'This ASR cycle has not been released to Rewards');
  }
}
