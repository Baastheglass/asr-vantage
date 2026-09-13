import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handler, ok } from '@/lib/api';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const user = await requireUser();
  const items = db.prepare(
    `SELECT id, type, severity, title, body, link, is_read AS isRead, created_at AS createdAt
       FROM notifications WHERE user_id = ? ORDER BY is_read ASC, id DESC LIMIT 100`,
  ).all(user.id);
  return ok({ items });
});

export const PATCH = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const { id, all } = await req.json();
  if (all) db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(user.id);
  else if (id) db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(Number(id), user.id);
  return ok();
});
