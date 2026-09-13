import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { UserAdmin } from '@/components/user-admin';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const user = await requireUser();
  if (!['HR_MANAGER', 'ADMIN'].includes(user.role)) redirect('/');

  return (
    <>
      <PageHeader
        title="User management"
        subtitle="Add people, set what each person is allowed to see, and reset passwords. Everyone signs in with their own account — no file or password is ever shared."
      />
      <UserAdmin currentUserId={user.id} />
    </>
  );
}
