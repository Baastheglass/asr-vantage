import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { AnalyticsView } from '@/components/analytics-view';
import { activeCycle } from '@/lib/cycle';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const user = await requireUser();
  // Rewards provide the sheet and receive the approved result; the review
  // analytics in between belong to HR, the HODs and the GSM President.
  if (!['HR_MANAGER', 'ADMIN', 'HOD', 'GSM_PRESIDENT'].includes(user.role)) redirect('/');
  const cycle = activeCycle();

  return (
    <>
      <PageHeader
        title="ASR analytics"
        subtitle={cycle ? `${cycle.name} · figures update live as divisions enter their recommendations` : undefined}
      />
      <AnalyticsView />
    </>
  );
}
