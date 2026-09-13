import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { NotificationList } from '@/components/notification-list';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Notifications" subtitle="Assignments, deadlines, budget alerts and approval activity" />
      <NotificationList />
    </>
  );
}
