import { destroySession, getSession } from '@/lib/auth';
import { handler, ok } from '@/lib/api';
import { audit } from '@/lib/db';

export const POST = handler(async () => {
  const user = await getSession();
  if (user) audit({ actor: user, action: 'LOGOUT', entity: 'user', entityId: user.id });
  await destroySession();
  return ok();
});
