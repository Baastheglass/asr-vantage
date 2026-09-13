import { requireUser } from '@/lib/auth';
import { handler, ok, num } from '@/lib/api';
import { db } from '@/lib/db';
import { employeeScope } from '@/lib/rbac';
import { HttpError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const id = num((await ctx.params).id);

  // The record must fall inside the caller's scope before any history is returned.
  const scope = employeeScope(user, 'e');
  const allowed = db.prepare(
    `SELECT r.id FROM asr_records r JOIN employees e ON e.id = r.employee_id
      WHERE r.id = ? AND ${scope.sql}`,
  ).get(id, ...scope.params);
  if (!allowed) throw new HttpError(403, 'You do not have access to this record');

  const versions = db.prepare(
    `SELECT field, old_value AS oldValue, new_value AS newValue,
            changed_by_name AS changedBy, at
       FROM record_versions WHERE record_id = ? ORDER BY id DESC LIMIT 100`,
  ).all(id);

  return ok({ versions });
});
