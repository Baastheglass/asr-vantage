import { NextResponse } from 'next/server';
import { HttpError } from './auth';

/**
 * Wraps a route handler so that permission failures always surface as a clean
 * status code instead of a stack trace, and never leak data in the message.
 */
export function handler<T extends any[]>(fn: (...args: T) => Promise<NextResponse | Response>) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      console.error('[api]', e);
      return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 });
    }
  };
}

export const ok = (data: unknown = { ok: true }) => NextResponse.json(data);
export const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
