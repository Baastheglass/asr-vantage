import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function Home() {
  const user = await getSession();
  if (!user) redirect('/login');
  if (user.role === 'HOD' || user.role === 'DIRECTOR') redirect('/workspace');
  if (user.role === 'GSM_PRESIDENT') redirect('/approvals');
  if (user.role === 'REWARDS') redirect('/upload');
  redirect('/dashboard');
}
