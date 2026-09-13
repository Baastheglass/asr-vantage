'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Badge, EmptyState } from './ui';

const SEV: Record<string, { tone: any; icon: string; bg: string }> = {
  info:     { tone: 'blue',  icon: 'i', bg: 'bg-blue-500' },
  success:  { tone: 'green', icon: '✓', bg: 'bg-emerald-500' },
  warning:  { tone: 'amber', icon: '!', bg: 'bg-amber-500' },
  critical: { tone: 'red',   icon: '!', bg: 'bg-red-600' },
};

export function NotificationList() {
  const router = useRouter();
  const [items, setItems] = useState<any[] | null>(null);

  async function load() {
    const r = await fetch('/api/notifications');
    const d = await r.json();
    setItems(d.items ?? []);
  }
  useEffect(() => { load(); }, []);

  async function markRead(id?: number) {
    await fetch('/api/notifications', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { id } : { all: true }),
    });
    await load();
    router.refresh();
  }

  if (items === null) return <Card><p className="text-[13px] text-ink-500">Loading…</p></Card>;

  const unread = items.filter((i) => !i.isRead);

  return (
    <Card
      title={`${unread.length} unread`}
      subtitle={`${items.length} notification${items.length === 1 ? '' : 's'} in total`}
      action={unread.length > 0 && (
        <button className="btn-secondary btn-sm" onClick={() => markRead()}>Mark all as read</button>
      )}
      bodyClass="p-0"
    >
      {items.length === 0 ? (
        <EmptyState title="Nothing to show yet"
          hint="You will be notified when an ASR is assigned to you, a deadline approaches, a budget is exceeded, or an approval is needed." />
      ) : (
        <ul className="divide-y divide-ink-100">
          {items.map((n) => {
            const s = SEV[n.severity] ?? SEV.info;
            return (
              <li key={n.id} className={`px-4 py-3 flex items-start gap-3 ${n.isRead ? 'opacity-60' : 'bg-jazz-50/30'}`}>
                <span className={`mt-0.5 w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold text-white shrink-0 ${s.bg}`}>
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2 flex-wrap">
                    <p className="text-[13px] font-medium text-ink-900">{n.title}</p>
                    {!n.isRead && <Badge tone="blue">New</Badge>}
                  </div>
                  {n.body && <p className="text-[13px] text-ink-600 mt-0.5">{n.body}</p>}
                  <p className="text-2xs text-ink-400 mt-1">
                    {new Date(n.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-GB')}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {n.link && (
                    <Link href={n.link} className="btn-secondary btn-sm" onClick={() => markRead(n.id)}>Open</Link>
                  )}
                  {!n.isRead && (
                    <button className="btn-ghost btn-sm" onClick={() => markRead(n.id)} title="Mark as read">✓</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
