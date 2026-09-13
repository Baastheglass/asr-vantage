import { NextRequest, NextResponse } from 'next/server';
import { verifyLogin, createSession } from '@/lib/auth';
import { handler, ok, bad } from '@/lib/api';
import { audit } from '@/lib/db';
import {
  checkLoginAllowed, recordLoginFailure, clearLoginFailures, clientIp, LOGIN_LIMITS,
} from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const { email, password } = await req.json();
  if (!email || !password) return bad('Email and password are required');

  const ip = clientIp(req);

  // Throttle before touching the database, so a locked-out attacker cannot
  // even use this endpoint to probe which addresses exist.
  const limit = checkLoginAllowed(String(email), ip);
  if (!limit.allowed) {
    audit({ action: 'LOGIN_BLOCKED', entity: 'user', meta: { email, ip, retryAfterSec: limit.retryAfterSec } });
    return NextResponse.json(
      {
        error: `${limit.reason} Please try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s), or ask HR to reset your password.`,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const user = await verifyLogin(String(email), String(password));

  if (!user) {
    const nowLocked = recordLoginFailure(String(email), ip);
    audit({ action: 'LOGIN_FAILED', entity: 'user', meta: { email, ip, locked: nowLocked } });
    return bad(
      nowLocked
        ? `Incorrect email or password. This account is now locked for ${LOGIN_LIMITS.LOCK_MINUTES} minutes after ${LOGIN_LIMITS.MAX_PER_EMAIL} failed attempts.`
        : 'Incorrect email or password',
      401,
    );
  }

  clearLoginFailures(String(email), ip);
  await createSession(user);
  audit({ actor: user, action: 'LOGIN', entity: 'user', entityId: user.id, meta: { ip } });

  const landing =
    user.role === 'HOD' || user.role === 'DIRECTOR' ? '/workspace'
    : user.role === 'GSM_PRESIDENT' ? '/approvals'
    : user.role === 'REWARDS' ? '/upload'
    : '/dashboard';
  return ok({ ok: true, landing, role: user.role });
});
