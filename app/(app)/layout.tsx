import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { unreadCount, activeCycle } from '@/lib/cycle';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect('/login');

  const cycle = activeCycle();
  let pendingExceptions = 0;
  if (cycle) {
    if (user.role === 'HR_MANAGER' || user.role === 'ADMIN') {
      pendingExceptions = (db.prepare(
        `SELECT COUNT(*) AS n FROM budget_exceptions WHERE cycle_id = ? AND status = 'PENDING'`,
      ).get(cycle.id) as { n: number }).n;
    } else if (user.role === 'HOD' && user.divisionId) {
      pendingExceptions = (db.prepare(
        `SELECT COUNT(*) AS n FROM budget_exceptions WHERE cycle_id = ? AND division_id = ? AND status = 'PENDING'`,
      ).get(cycle.id, user.divisionId) as { n: number }).n;
    }
  }

  return (
    <Shell
      user={{ id: user.id, name: user.name, role: user.role, title: user.title, email: user.email }}
      unread={unreadCount(user)}
      pendingExceptions={pendingExceptions}
    >
      {children}
    </Shell>
  );
}
