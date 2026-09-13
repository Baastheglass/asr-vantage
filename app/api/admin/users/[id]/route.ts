import { NextRequest } from 'next/server';
import { requireRole, hashPassword } from '@/lib/auth';
import { handler, ok, bad, num, str } from '@/lib/api';
import { db, audit, type Role } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['HR_MANAGER', 'HOD', 'DIRECTOR', 'GSM_PRESIDENT', 'REWARDS', 'ADMIN'];

/**
 * Update an account: rename, change email/title, change role, reassign which
 * division or departments they are responsible for, reset password, or
 * deactivate. Accounts are never deleted — deactivating preserves the audit
 * trail while removing access immediately (getSession re-checks is_active).
 */
export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireRole('HR_MANAGER', 'ADMIN');
  const id = num((await ctx.params).id);
  const b = await req.json();

  const before = db.prepare(
    `SELECT id, name, email, role, title, division_id AS divisionId, is_active AS isActive FROM users WHERE id = ?`,
  ).get(id) as any;
  if (!before) return bad('That account no longer exists.', 404);

  const name = b.name !== undefined ? str(b.name).trim() : before.name;
  const email = b.email !== undefined ? str(b.email).trim().toLowerCase() : before.email;
  const role = (b.role !== undefined ? str(b.role) : before.role) as Role;
  const title = b.title !== undefined ? (str(b.title).trim() || null) : before.title;
  const divisionId = b.divisionId !== undefined ? (b.divisionId ? num(b.divisionId) : null) : before.divisionId;
  const isActive = b.isActive !== undefined ? (b.isActive ? 1 : 0) : before.isActive;
  const departmentIds: number[] | null = Array.isArray(b.departmentIds) ? b.departmentIds.map(Number) : null;

  if (!name) return bad('The name cannot be empty.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Enter a valid email address.');
  if (!ROLES.includes(role)) return bad('Choose a valid role.');
  if (role === 'HOD' && !divisionId) return bad('A Head of Department must be assigned to a division.');

  // Guard against locking yourself out of the system.
  if (id === actor.id) {
    if (!isActive) return bad('You cannot deactivate your own account.');
    if (role !== before.role) return bad('You cannot change your own role. Ask another administrator.');
  }
  if (before.role === 'HR_MANAGER' && role !== 'HR_MANAGER') {
    const others = (db.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role IN ('HR_MANAGER','ADMIN') AND is_active = 1 AND id != ?`,
    ).get(id) as { n: number }).n;
    if (others === 0) return bad('This is the last active HR Manager — assign someone else first.');
  }

  const clash = db.prepare(`SELECT id FROM users WHERE lower(email) = ? AND id != ?`).get(email, id);
  if (clash) return bad('Another account already uses that email address.', 409);

  const newPassword = str(b.password);
  if (newPassword && newPassword.length < 8) return bad('The new password must be at least 8 characters.');
  const hash = newPassword ? await hashPassword(newPassword) : null;

  db.transaction(() => {
    db.prepare(
      `UPDATE users SET name=?, email=?, role=?, title=?, division_id=?, is_active=?
        ${hash ? ', password_hash=?' : ''} WHERE id=?`,
    ).run(...(hash
      ? [name, email, role, title, divisionId, isActive, hash, id]
      : [name, email, role, title, divisionId, isActive, id]));

    // Keep the org chart consistent with the role.
    if (role === 'HOD' && divisionId) {
      db.prepare(`UPDATE divisions SET hod_user_id = NULL WHERE hod_user_id = ? AND id != ?`).run(id, divisionId);
      db.prepare(`UPDATE divisions SET hod_user_id = ? WHERE id = ?`).run(id, divisionId);
    } else if (before.role === 'HOD' && role !== 'HOD') {
      db.prepare(`UPDATE divisions SET hod_user_id = NULL WHERE hod_user_id = ?`).run(id);
    }

    if (departmentIds) {
      db.prepare(`UPDATE departments SET director_user_id = NULL WHERE director_user_id = ?`).run(id);
      if (role === 'DIRECTOR' && departmentIds.length) {
        const ph = departmentIds.map(() => '?').join(',');
        db.prepare(`UPDATE departments SET director_user_id = ? WHERE id IN (${ph})`).run(id, ...departmentIds);
      }
    } else if (before.role === 'DIRECTOR' && role !== 'DIRECTOR') {
      db.prepare(`UPDATE departments SET director_user_id = NULL WHERE director_user_id = ?`).run(id);
    }

    if (!isActive) {
      db.prepare(`UPDATE divisions SET hod_user_id = NULL WHERE hod_user_id = ?`).run(id);
      db.prepare(`UPDATE departments SET director_user_id = NULL WHERE director_user_id = ?`).run(id);
    }
  })();

  audit({
    actor, action: hash ? 'USER_PASSWORD_RESET' : 'USER_UPDATED', entity: 'user', entityId: id,
    before: { name: before.name, email: before.email, role: before.role, divisionId: before.divisionId, isActive: before.isActive },
    after: { name, email, role, divisionId, isActive, departmentIds: departmentIds ?? undefined },
  });

  return ok({ id });
});
