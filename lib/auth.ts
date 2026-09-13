import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { db, type SessionUser, type Role } from './db';

const COOKIE = 'asr_session';
const SECRET_FILE = path.join(process.cwd(), 'data', '.session-secret');

function secret(): Uint8Array {
  let s = process.env.ASR_SESSION_SECRET;
  if (!s) {
    // Dev convenience: persist a random secret so sessions survive restarts.
    if (fs.existsSync(SECRET_FILE)) s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    else {
      s = crypto.randomUUID() + crypto.randomUUID();
      fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
      fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    }
  }
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyLogin(email: string, password: string): Promise<SessionUser | null> {
  const row = db
    .prepare(
      `SELECT id, email, name, password_hash, role, title, division_id, is_active
         FROM users WHERE lower(email) = lower(?)`,
    )
    .get(email.trim()) as
    | {
        id: number; email: string; name: string; password_hash: string;
        role: Role; title: string | null; division_id: number | null; is_active: number;
      }
    | undefined;

  if (!row || !row.is_active) return null;
  if (!(await bcrypt.compare(password, row.password_hash))) return null;

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);
  return {
    id: row.id, email: row.email, name: row.name, role: row.role,
    title: row.title, divisionId: row.division_id,
  };
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({
    uid: user.id, role: user.role, name: user.name,
    email: user.email, title: user.title, div: user.divisionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/**
 * Resolve the caller from the signed cookie, then RE-READ the user from the
 * database. The token is only proof of identity — role and division always
 * come from the DB so that a revoked or moved user loses access immediately
 * and a tampered token cannot escalate.
 */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = Number(payload.uid);
    if (!uid) return null;
    const row = db
      .prepare(
        `SELECT id, email, name, role, title, division_id, is_active FROM users WHERE id = ?`,
      )
      .get(uid) as
      | { id: number; email: string; name: string; role: Role; title: string | null; division_id: number | null; is_active: number }
      | undefined;
    if (!row || !row.is_active) return null;
    return {
      id: row.id, email: row.email, name: row.name, role: row.role,
      title: row.title, divisionId: row.division_id,
    };
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSession();
  if (!u) throw new HttpError(401, 'Authentication required');
  return u;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!roles.includes(u.role)) throw new HttpError(403, 'You do not have permission to perform this action');
  return u;
}
