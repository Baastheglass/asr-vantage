/**
 * Login throttling.
 *
 * Without this, an attacker can guess passwords as fast as the network allows,
 * which matters a great deal for an application holding salary data. Counts are
 * kept per email and per source IP, so one attacker cannot lock out a whole
 * office by hammering a single account, and one attacker cannot spray many
 * accounts from one machine.
 *
 * State is in memory, which is correct for a single-server deployment. Behind
 * more than one instance this should move to Redis or a shared table.
 */
const WINDOW_MS = 15 * 60 * 1000;   // rolling window
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 20;
const LOCK_MS = 15 * 60 * 1000;

interface Bucket { hits: number[]; lockedUntil: number }

const byEmail = new Map<string, Bucket>();
const byIp = new Map<string, Bucket>();

function bucket(map: Map<string, Bucket>, key: string): Bucket {
  let b = map.get(key);
  if (!b) { b = { hits: [], lockedUntil: 0 }; map.set(key, b); }
  return b;
}

function prune(b: Bucket, now: number) {
  b.hits = b.hits.filter((t) => now - t < WINDOW_MS);
}

/** Housekeeping so the maps cannot grow without bound. */
function sweep(now: number) {
  if (Math.random() > 0.02) return;
  for (const map of [byEmail, byIp]) {
    for (const [k, b] of map) {
      prune(b, now);
      if (b.hits.length === 0 && b.lockedUntil < now) map.delete(k);
    }
  }
}

export interface LimitResult { allowed: boolean; retryAfterSec: number; reason?: string }

export function checkLoginAllowed(email: string, ip: string): LimitResult {
  const now = Date.now();
  sweep(now);

  const e = bucket(byEmail, email.trim().toLowerCase());
  const i = bucket(byIp, ip);

  if (e.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000),
      reason: 'Too many failed sign-in attempts for this account.',
    };
  }
  if (i.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((i.lockedUntil - now) / 1000),
      reason: 'Too many failed sign-in attempts from this device.',
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Call after a failed attempt. Returns true if this failure triggered a lock. */
export function recordLoginFailure(email: string, ip: string): boolean {
  const now = Date.now();
  const e = bucket(byEmail, email.trim().toLowerCase());
  const i = bucket(byIp, ip);

  prune(e, now); prune(i, now);
  e.hits.push(now); i.hits.push(now);

  let locked = false;
  if (e.hits.length >= MAX_PER_EMAIL) { e.lockedUntil = now + LOCK_MS; locked = true; }
  if (i.hits.length >= MAX_PER_IP) { i.lockedUntil = now + LOCK_MS; locked = true; }
  return locked;
}

export function clearLoginFailures(email: string, ip: string) {
  byEmail.delete(email.trim().toLowerCase());
  const i = byIp.get(ip);
  if (i) { i.hits = []; i.lockedUntil = 0; }
}

/** Best-effort client IP behind a proxy or load balancer. */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') || 'unknown';
}

export const LOGIN_LIMITS = { MAX_PER_EMAIL, MAX_PER_IP, LOCK_MINUTES: LOCK_MS / 60000 };
