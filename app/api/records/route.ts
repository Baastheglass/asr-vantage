import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handler, ok, num, str, bad } from '@/lib/api';
import { queryRecords, filterOptions } from '@/lib/records';
import { assertDivisionAccess, assertCycleVisible } from '@/lib/rbac';
import { activeCycle } from '@/lib/cycle';
import { divisionBudget } from '@/lib/budget';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const sp = req.nextUrl.searchParams;

  const cycle = activeCycle();
  if (!cycle) return bad('No active ASR cycle', 404);
  assertCycleVisible(user, cycle.id);

  const divisionId = sp.get('divisionId') ? num(sp.get('divisionId')) : undefined;
  if (divisionId) assertDivisionAccess(user, divisionId);

  const result = queryRecords(user, {
    cycleId: cycle.id,
    divisionId,
    departmentId: sp.get('departmentId') ? num(sp.get('departmentId')) : undefined,
    subDepartmentId: sp.get('subDepartmentId') ? num(sp.get('subDepartmentId')) : undefined,
    gradeId: sp.get('gradeId') ? num(sp.get('gradeId')) : undefined,
    search: str(sp.get('search')) || undefined,
    status: str(sp.get('status')) || undefined,
    sort: str(sp.get('sort')) || undefined,
    dir: sp.get('dir') === 'desc' ? 'desc' : 'asc',
    page: num(sp.get('page'), 1),
    pageSize: num(sp.get('pageSize'), 50),
  });

  return ok({
    ...result,
    filters: filterOptions(user, cycle.id, divisionId),
    budget: divisionId ? divisionBudget(cycle.id, divisionId) : null,
  });
});
