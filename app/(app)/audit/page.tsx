import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDateTime } from '@/lib/cycle';
import { Card, Badge, Th, Td, PageHeader, EmptyState, humanStatus } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TONE = (a: string) =>
  a.includes('APPROVE') || a.includes('LOGIN') ? 'green'
  : a.includes('REJECT') || a.includes('FAILED') ? 'red'
  : a.includes('EXPORT') ? 'violet'
  : a.includes('EXCEPTION') ? 'amber' : 'blue';

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; action?: string; page?: string }> }) {
  const user = await requireUser();
  if (!['HR_MANAGER', 'ADMIN'].includes(user.role)) redirect('/');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const size = 60;

  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (sp.q) { where.push('(actor_name LIKE ? OR entity LIKE ? OR entity_id LIKE ? OR meta LIKE ?)');
    const s = `%${sp.q}%`; params.push(s, s, s, s); }
  if (sp.action) { where.push('action = ?'); params.push(sp.action); }

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${where.join(' AND ')}`)
    .get(...params) as { n: number }).n;

  const rows = db.prepare(
    `SELECT id, actor_name AS actor, actor_role AS role, action, entity, entity_id AS entityId,
            before, after, meta, at
       FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all(...params, size, (page - 1) * size) as any[];

  const actions = db.prepare(`SELECT action, COUNT(*) AS n FROM audit_logs GROUP BY action ORDER BY n DESC`)
    .all() as { action: string; n: number }[];

  const pages = Math.max(1, Math.ceil(total / size));

  return (
    <>
      <PageHeader title="Audit trail"
        subtitle="Every action taken on salary data — who did it, what changed, and when. Records are append-only." />

      <Card bodyClass="p-3" className="mb-4">
        <form className="flex flex-wrap gap-2 items-end">
          <div><label className="label">Search</label>
            <input name="q" className="input w-64" defaultValue={sp.q ?? ''} placeholder="Actor, entity or detail…" /></div>
          <div><label className="label">Action</label>
            <select name="action" className="input w-auto min-w-48" defaultValue={sp.action ?? ''}>
              <option value="">All actions ({total})</option>
              {actions.map((a) => <option key={a.action} value={a.action}>{humanStatus(a.action)} ({a.n})</option>)}
            </select></div>
          <button className="btn-primary">Apply</button>
          <span className="text-xs text-ink-500 ml-auto tabular">{total.toLocaleString('en-PK')} entries</span>
        </form>
      </Card>

      <Card bodyClass="p-0" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <Th>When</Th><Th>Actor</Th><Th>Role</Th><Th>Action</Th>
              <Th>Entity</Th><Th>Change</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-hover align-top">
                  <Td className="text-ink-500 whitespace-nowrap">{fmtDateTime(r.at)}</Td>
                  <Td className="font-medium">{r.actor}</Td>
                  <Td><Badge tone="gray">{humanStatus(r.role ?? '')}</Badge></Td>
                  <Td><Badge tone={TONE(r.action) as any}>{humanStatus(r.action)}</Badge></Td>
                  <Td className="text-ink-600">{r.entity}{r.entityId ? ` #${r.entityId}` : ''}</Td>
                  <Td className="whitespace-normal max-w-lg text-2xs text-ink-600 font-mono">
                    {r.before && <span className="text-red-700">− {r.before.slice(0, 120)}</span>}
                    {r.before && r.after && <br />}
                    {r.after && <span className="text-emerald-700">+ {r.after.slice(0, 120)}</span>}
                    {!r.before && !r.after && r.meta && <span>{r.meta.slice(0, 160)}</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <EmptyState title="No audit entries match this filter" />}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-ink-200 bg-ink-50/60">
          <p className="text-xs text-ink-600 tabular">Page {page} of {pages}</p>
          <div className="flex gap-1">
            {page > 1 && <a className="btn-secondary btn-sm" href={`/audit?page=${page - 1}${sp.q ? `&q=${sp.q}` : ''}${sp.action ? `&action=${sp.action}` : ''}`}>Previous</a>}
            {page < pages && <a className="btn-secondary btn-sm" href={`/audit?page=${page + 1}${sp.q ? `&q=${sp.q}` : ''}${sp.action ? `&action=${sp.action}` : ''}`}>Next</a>}
          </div>
        </div>
      </Card>
    </>
  );
}
