'use client';

import { useEffect, useState } from 'react';
import { Card, Badge, Meter, EmptyState, Th, Td } from './ui';

const pkr = (n: number, compact = false) => {
  if (!Number.isFinite(n)) return '0';
  if (compact) {
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(2)}Bn`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  }
  return Math.round(n).toLocaleString('en-PK');
};

interface Exc {
  id: number; divisionId: number; divisionName: string;
  requestedAmount: number; projectedUtilisation: number; justification: string;
  status: string; decisionComment: string | null; createdAt: string; decidedAt: string | null;
  requestedBy: string; decidedBy: string | null;
  allocated: number; additionalApproved: number;
  utilised: number; currentUtilisation: number; variance: number;
}

const TONE: Record<string, any> = {
  PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', CLARIFICATION: 'blue',
};

export function ExceptionQueue({ canDecide }: { canDecide: boolean }) {
  const [items, setItems] = useState<Exc[] | null>(null);
  const [active, setActive] = useState<Exc | null>(null);
  const [msg, setMsg] = useState('');

  async function load() {
    const r = await fetch('/api/exceptions');
    const d = await r.json();
    setItems(d.exceptions ?? []);
  }
  useEffect(() => { load(); }, []);

  if (items === null) return <Card><p className="text-[13px] text-ink-500">Loading…</p></Card>;

  const pending = items.filter((i) => i.status === 'PENDING' || i.status === 'CLARIFICATION');
  const decided = items.filter((i) => i.status === 'APPROVED' || i.status === 'REJECTED');

  return (
    <div className="space-y-4">
      {msg && <p className="text-[13px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">{msg}</p>}

      <Card title={`Awaiting decision (${pending.length})`}
        subtitle={canDecide ? 'Approve, reject, or ask the division for more detail' : 'Requests your division has open with HR'}
        bodyClass="p-0">
        {pending.length === 0 ? (
          <EmptyState title="No open exception requests"
            hint="Divisions that stay within their allocation never reach this queue." />
        ) : (
          <div className="divide-y divide-ink-100">
            {pending.map((e) => (
              <div key={e.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[14px] font-semibold text-ink-900">{e.divisionName}</h3>
                      <Badge tone={TONE[e.status]}>{e.status === 'CLARIFICATION' ? 'Clarification requested' : 'Pending'}</Badge>
                    </div>
                    <p className="text-2xs text-ink-500 mt-0.5">
                      Raised by {e.requestedBy} · {new Date(e.createdAt.replace(' ', 'T') + 'Z').toLocaleString('en-GB')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xs uppercase tracking-wide text-ink-500 font-semibold">Additional requested</p>
                    <p className="text-xl font-semibold tabular text-jazz-700">PKR {pkr(e.requestedAmount)}</p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-4 gap-3 mt-3 text-[13px]">
                  <Fig label="Allocated by Rewards" value={`PKR ${pkr(e.allocated, true)}`} />
                  <Fig label="Currently proposed" value={`PKR ${pkr(e.utilised, true)}`} tone="red" />
                  <Fig label="Shortfall" value={`PKR ${pkr(Math.abs(Math.min(0, e.variance)), true)}`} tone="red" />
                  <Fig label="Projected utilisation" value={`${e.currentUtilisation.toFixed(1)}%`} tone="red" />
                </div>

                <div className="mt-2.5">
                  <Meter value={e.currentUtilisation} tone="red" height="h-2" />
                </div>

                <div className="mt-3 rounded-md bg-ink-50 border border-ink-200 px-3 py-2.5">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500 mb-1">Business justification</p>
                  <p className="text-[13px] text-ink-800 leading-relaxed">{e.justification}</p>
                </div>

                {canDecide && (
                  <div className="mt-3 flex flex-wrap gap-2 justify-end">
                    <button className="btn-secondary" onClick={() => setActive({ ...e, status: 'CLARIFY' as any })}>
                      Request clarification
                    </button>
                    <button className="btn-danger" onClick={() => setActive({ ...e, status: 'REJECT' as any })}>
                      Reject
                    </button>
                    <button className="btn-success" onClick={() => setActive({ ...e, status: 'APPROVE' as any })}>
                      Approve additional budget
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {decided.length > 0 && (
        <Card title="Decision history" bodyClass="p-0" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                <Th>Division</Th><Th align="right">Requested</Th><Th>Outcome</Th>
                <Th>Decided by</Th><Th>When</Th><Th>Comment</Th>
              </tr></thead>
              <tbody>
                {decided.map((e) => (
                  <tr key={e.id} className="row-hover">
                    <Td className="font-medium">{e.divisionName}</Td>
                    <Td align="right" num>PKR {pkr(e.requestedAmount)}</Td>
                    <Td><Badge tone={TONE[e.status]}>{e.status === 'APPROVED' ? 'Approved' : 'Rejected'}</Badge></Td>
                    <Td>{e.decidedBy ?? '—'}</Td>
                    <Td className="text-ink-500">{e.decidedAt ? new Date(e.decidedAt.replace(' ', 'T') + 'Z').toLocaleString('en-GB') : '—'}</Td>
                    <Td className="max-w-xs whitespace-normal text-ink-600 text-2xs">{e.decisionComment ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {active && (
        <DecisionModal exc={active} onClose={() => setActive(null)}
          onDone={(m) => { setActive(null); setMsg(m); load(); }} />
      )}
    </div>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const c = tone === 'red' ? 'text-red-700' : 'text-ink-900';
  return (
    <div>
      <p className="text-2xs uppercase tracking-wide text-ink-500 font-semibold">{label}</p>
      <p className={`text-[15px] font-semibold tabular ${c}`}>{value}</p>
    </div>
  );
}

function DecisionModal({ exc, onClose, onDone }: { exc: any; onClose: () => void; onDone: (m: string) => void }) {
  const action = exc.status as 'APPROVE' | 'REJECT' | 'CLARIFY';
  const [amount, setAmount] = useState(String(exc.requestedAmount));
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const title = action === 'APPROVE' ? 'Approve additional budget'
    : action === 'REJECT' ? 'Reject exception request' : 'Request clarification';

  async function go() {
    setBusy(true); setErr('');
    const res = await fetch(`/api/exceptions/${exc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, approvedAmount: Number(amount), comment }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(d.error ?? 'Could not record decision'); return; }
    onDone(
      action === 'APPROVE'
        ? `Approved PKR ${pkr(Number(amount))} additional budget for ${exc.divisionName}. The original allocation is unchanged.`
        : action === 'REJECT' ? `Exception request from ${exc.divisionName} rejected.`
        : `Clarification requested from ${exc.divisionName}.`,
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3 className="card-title">{title}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose}>×</button></div>
        <div className="p-4 space-y-4">
          <p className="text-[13px] text-ink-600">
            {exc.divisionName} · requested by {exc.requestedBy}
          </p>

          {action === 'APPROVE' && (
            <div>
              <label className="label">Amount to approve (PKR)</label>
              <input type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-2xs text-ink-500 mt-1">
                You may approve less than requested. This is added to the division&apos;s allocation as a
                separate, tracked top-up — the original {`PKR ${pkr(exc.allocated)}`} from Rewards stays on record.
              </p>
            </div>
          )}

          <div>
            <label className="label">
              Comment {action === 'APPROVE' ? '(optional)' : '(required)'}
            </label>
            <textarea className="input min-h-24" rows={4} value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={action === 'APPROVE'
                ? 'Note the basis for approval…'
                : action === 'REJECT'
                ? 'Explain why the request is not supported so the division can rework its proposal…'
                : 'What additional detail do you need from the division?'} />
          </div>

          {err && <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</p>}

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className={action === 'APPROVE' ? 'btn-success' : action === 'REJECT' ? 'btn-danger' : 'btn-primary'}
              disabled={busy || (action !== 'APPROVE' && comment.trim().length < 10)}
              onClick={go}>
              {busy ? 'Saving…' : title}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
