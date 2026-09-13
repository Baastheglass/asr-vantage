import { requireUser } from '@/lib/auth';
import { handler, num } from '@/lib/api';
import { assertDivisionAccess, assertCycleVisible } from '@/lib/rbac';
import { activeCycle } from '@/lib/cycle';
import { buildWorkbook } from '@/lib/export';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const divisionId = num((await ctx.params).id);
  assertDivisionAccess(user, divisionId);

  const cycle = activeCycle();
  if (!cycle) return new Response('No active ASR cycle', { status: 404 });
  assertCycleVisible(user, cycle.id);

  const { buf, filename } = buildWorkbook(user, cycle.id, divisionId);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
