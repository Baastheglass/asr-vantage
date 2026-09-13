import { requireUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ExceptionQueue } from '@/components/exception-queue';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ExceptionsPage() {
  const user = await requireUser();
  // Exceptions are an HR/Rewards matter. The GSM President approves the ASR
  // as a whole and does not take part in the exception workflow.
  if (!['HR_MANAGER', 'ADMIN', 'HOD'].includes(user.role)) redirect('/');
  const isHR = user.role === 'HR_MANAGER' || user.role === 'ADMIN';

  return (
    <>
      <PageHeader
        title="Budget exception requests"
        subtitle={
          isHR
            ? 'Divisions that need more than their allocation must justify it here. Approving adds budget on top of the Rewards allocation — the original figure is never overwritten.'
            : 'Requests raised by your division for budget above the allocation set by Rewards.'
        }
      />
      <ExceptionQueue canDecide={isHR} />
    </>
  );
}
