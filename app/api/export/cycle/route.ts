import { requireUser } from '@/lib/auth';
import { handler } from '@/lib/api';
import { assertCycleVisible } from '@/lib/rbac';
import { activeCycle } from '@/lib/cycle';
import { buildWorkbook } from '@/lib/export';

export const dynamic = 'force-dynamic';

/**
 * Whole-cycle export. Not role-gated by itself — the workbook builder applies
 * the caller's scope, so a Director hitting this URL still receives only their
 * own departments rather than the company file.
 */
export const GET = handler(async () => {
  const user = await requireUser();
  const cycle = activeCycle();
  if (!cycle) return new Response('No active ASR cycle', { status: 404 });
  assertCycleVisible(user, cycle.id);

  const { buf, filename } = buildWorkbook(user, cycle.id);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
