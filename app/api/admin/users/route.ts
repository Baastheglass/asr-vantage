import { NextRequest } from 'next/server';
import { requireRole, hashPassword } from '@/lib/auth';
import { handler, ok, bad, num, str } from '@/lib/api';
import { db, audit, notify, type Role } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['HR_MANAGER', 'HOD', 'DIRECTOR', 'GSM_PRESIDENT', 'REWARDS', 'ADMIN'];

/** Everyone with an account, plus what they are responsible for. */
export const GET = handler(async () => {
  await requireRole('HR_MANAGER', 'ADMIN');

  const users = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.title, u.division_id AS divisionId,
            u.is_active AS isActive, u.last_login_at AS lastLoginAt, u.created_at AS createdAt,
            d.name AS divisionName
       FROM users u
       LEFT JOIN divisions d ON d.id = u.division_id
      ORDER BY CASE u.role
                 WHEN 'HR_MANAGER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'GSM_PRESIDENT' THEN 2
                 WHEN 'REWARDS' THEN 3 WHEN 'HOD' THEN 4 ELSE 5 END, u.name`,
  ).all() as any[];

  const headsOf = db.prepare(`SELECT hod_user_id AS uid, name FROM divisions WHERE hod_user_id IS NOT NULL`).all() as any[];
  const directsOf = db.prepare(
    `SELECT p.director_user_id AS uid, p.id, p.name, d.name AS divisionName
       FROM departments p JOIN divisions d ON d.id = p.division_id
      WHERE p.director_user_id IS NOT NULL`,
  ).all() as any[];

  for (const u of users) {
    u.headsDivisions = headsOf.filter((h) => h.uid === u.id).map((h) => h.name);
    u.directsDepartments = directsOf.filter((h) => h.uid === u.id).map((h) => h.name);
  }

  const divisions = db.prepare(
    `SELECT d.id, d.name, d.hod_user_id AS hodUserId, u.name AS hodName,
            (SELECT COUNT(*) FROM employees e WHERE e.division_id = d.id) AS employees
       FROM divisions d LEFT JOIN users u ON u.id = d.hod_user_id ORDER BY d.name`,
  ).all();

  const departments = db.prepare(
    `SELECT p.id, p.name, p.division_id AS divisionId, d.name AS divisionName,
            p.director_user_id AS directorUserId, u.name AS directorName,
            (SELECT COUNT(*) FROM employees e WHERE e.department_id = p.id) AS employees
       FROM departments p
       JOIN divisions d ON d.id = p.division_id
       LEFT JOIN users u ON u.id = p.director_user_id
      ORDER BY d.name, p.name`,
  ).all();

  return ok({ users, divisions, departments, roles: ROLES });
});

/** Create a new account. */
export const POST = handler(async (req: NextRequest) => {
  const actor = await requireRole('HR_MANAGER', 'ADMIN');
  const b = await req.json();

  const name = str(b.name).trim();
  const email = str(b.email).trim().toLowerCase();
  const role = str(b.role) as Role;
  const password = str(b.password);
  const title = str(b.title).trim() || null;
  const divisionId = b.divisionId ? num(b.divisionId) : null;
  const departmentIds: number[] = Array.isArray(b.departmentIds) ? b.departmentIds.map(Number) : [];

  if (!name) return bad('Enter the person\'s full name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Enter a valid email address.');
  if (!ROLES.includes(role)) return bad('Choose a role.');
  if (password.length < 8) return bad('The password must be at least 8 characters.');
  if (role === 'HOD' && !divisionId) return bad('A Head of Department must be assigned to a division.');
  if (role === 'DIRECTOR' && departmentIds.length === 0) {
    return bad('A Director must be assigned to at least one department, otherwise they will see nothing.');
  }

  const clash = db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email);
  if (clash) return bad('That email address already has an account.', 409);

  const hash = await hashPassword(password);
  let userId = 0;

  db.transaction(() => {
    userId = Number(db.prepare(
      `INSERT INTO users (email, name, password_hash, role, title, division_id) VALUES (?,?,?,?,?,?)`,
    ).run(email, name, hash, role, title, divisionId).lastInsertRowid);

    if (role === 'HOD' && divisionId) {
      db.prepare(`UPDATE divisions SET hod_user_id = ? WHERE id = ?`).run(userId, divisionId);
    }
    if (role === 'DIRECTOR' && departmentIds.length) {
      const ph = departmentIds.map(() => '?').join(',');
      db.prepare(`UPDATE departments SET director_user_id = ? WHERE id IN (${ph})`).run(userId, ...departmentIds);
    }
  })();

  audit({ actor, action: 'USER_CREATED', entity: 'user', entityId: userId,
    after: { name, email, role, divisionId, departmentIds } });

  notify({ userId, type: 'WELCOME', severity: 'info',
    title: 'Your ASR Vantage account is ready',
    body: `You have been set up as ${role.replace(/_/g, ' ').toLowerCase()}. Salary information you can see is confidential.`,
    link: '/' });

  return ok({ id: userId });
});
