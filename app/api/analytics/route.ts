import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handler, ok, bad, num } from '@/lib/api';
import { buildAnalytics, analyticsOptions } from '@/lib/analytics';
import { activeCycle } from '@/lib/cycle';
import { assertCycleVisible } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const cycle = activeCycle();
  if (!cycle) return bad('No active ASR cycle', 404);
  assertCycleVisible(user, cycle.id);

  const sp = req.nextUrl.searchParams;
  const opt = (k: string) => (sp.get(k) ? num(sp.get(k)) : undefined);

  const data = buildAnalytics(user, cycle.id, {
    divisionId: opt('divisionId'),
    departmentId: opt('departmentId'),
    gradeId: opt('gradeId'),
    incMin: opt('incMin'),
    incMax: opt('incMax'),
    bonusMin: opt('bonusMin'),
    bonusMax: opt('bonusMax'),
    budgetStatus: sp.get('budgetStatus') || undefined,
    completion: sp.get('completion') || undefined,
  });

  return ok({ ...data, options: analyticsOptions(user, cycle.id), cycle: { id: cycle.id, name: cycle.name } });
});
