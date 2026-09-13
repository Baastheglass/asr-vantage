import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { UploadWizard } from '@/components/upload-wizard';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const user = await requireUser();
  // The master ASR sheet comes FROM Rewards TO HR, so Rewards owns this screen.
  if (!['REWARDS', 'ADMIN'].includes(user.role)) redirect('/');

  return (
    <>
      <PageHeader
        title="Upload master ASR sheet"
        subtitle="Upload the master ASR workbook and set the budget for each division. Once submitted it goes to HR, who distribute it to the divisions and run the review."
      />
      <UploadWizard role={user.role} />
    </>
  );
}
