'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { JazzLogo } from './ui';
import type { Role } from '@/lib/db';

const ROLE_LABELS: Record<string, string> = {
  HR_MANAGER: 'HR Manager', HOD: 'Head of Department', DIRECTOR: 'Director',
  GSM_PRESIDENT: 'GSM President', REWARDS: 'Rewards', ADMIN: 'Administrator',
};

interface NavItem { href: string; label: string; icon: React.ReactNode; roles: Role[]; badge?: number }

const I = {
  grid: <path d="M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z" />,
  upload: <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  layers: <path d="m12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5" />,
  alert: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  chart: <path d="M3 3v18h18M8 17V9m5 8V5m5 12v-6" />,
  check: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  bell: <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />,
  send: <path d="m22 2-7 20-4-9-9-4 20-7Z" />,
  users: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {d}
    </svg>
  );
}

export function Shell({
  user, unread, pendingExceptions, children,
}: {
  user: { id: number; name: string; role: Role; title: string | null; email: string };
  unread: number;
  pendingExceptions: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const nav: NavItem[] = ([
    { href: '/dashboard', label: 'Dashboard', icon: <Icon d={I.grid} />, roles: ['HR_MANAGER', 'ADMIN', 'GSM_PRESIDENT'] },
    { href: '/upload', label: 'Upload ASR Sheet', icon: <Icon d={I.upload} />, roles: ['REWARDS', 'ADMIN'] },
    { href: '/workspace', label: user.role === 'DIRECTOR' ? 'My Departments' : user.role === 'HOD' ? 'My Division' : 'Division Workspaces', icon: <Icon d={I.layers} />, roles: ['HR_MANAGER', 'ADMIN', 'HOD', 'DIRECTOR'] },
    { href: '/exceptions', label: 'Budget Exceptions', icon: <Icon d={I.alert} />, roles: ['HR_MANAGER', 'ADMIN', 'HOD'], badge: pendingExceptions },
    { href: '/analytics', label: 'Analytics', icon: <Icon d={I.chart} />, roles: ['HR_MANAGER', 'ADMIN', 'HOD', 'GSM_PRESIDENT'] },
    { href: '/approvals', label: 'Approvals', icon: <Icon d={I.check} />, roles: ['HR_MANAGER', 'ADMIN', 'GSM_PRESIDENT'] },
    { href: '/rewards', label: 'Final ASR', icon: <Icon d={I.send} />, roles: ['REWARDS', 'HR_MANAGER', 'ADMIN'] },
    { href: '/audit', label: 'Audit Trail', icon: <Icon d={I.shield} />, roles: ['HR_MANAGER', 'ADMIN'] },
    { href: '/admin/users', label: 'User Management', icon: <Icon d={I.users} />, roles: ['HR_MANAGER', 'ADMIN'] },
    { href: '/notifications', label: 'Notifications', icon: <Icon d={I.bell} />, roles: ['HR_MANAGER', 'ADMIN', 'HOD', 'DIRECTOR', 'GSM_PRESIDENT', 'REWARDS'], badge: unread },
  ] as NavItem[]).filter((n) => n.roles.includes(user.role));

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const initials = user.name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('');

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-60 bg-[#1d2430] text-white flex flex-col
                    transition-transform ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="h-14 flex items-center px-4 border-b border-white/10 shrink-0">
          <JazzLogo light />
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {nav.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + '/');
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors
                  ${active ? 'bg-jazz-600 text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                {n.icon}
                <span className="flex-1 truncate">{n.label}</span>
                {!!n.badge && n.badge > 0 && (
                  <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full
                    ${active ? 'bg-white/25' : 'bg-jazz-600 text-white'}`}>
                    {n.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3 shrink-0">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-full bg-jazz-600 grid place-items-center text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium truncate">{user.name}</p>
              <p className="text-2xs text-white/50 truncate">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <button onClick={logout} className="w-full text-left text-2xs text-white/60 hover:text-white px-1 py-1 transition-colors">
            Sign out
          </button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-ink-200 flex items-center gap-3 px-4 sticky top-0 z-20 shrink-0">
          <button className="lg:hidden btn-ghost px-2" onClick={() => setOpen(true)} aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-ink-800 truncate">
              {user.title || ROLE_LABELS[user.role]}
            </p>
          </div>
          <span className="hidden sm:inline-flex chip bg-ink-100 text-ink-600 ring-ink-500/20">
            Confidential
          </span>
          <Link href="/notifications" className="relative btn-ghost px-2" aria-label="Notifications">
            <Icon d={I.bell} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-jazz-600 text-white text-[9px] grid place-items-center font-semibold">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full">{children}</main>
      </div>
    </div>
  );
}
