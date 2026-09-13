'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Th, Td } from './ui';

const pkr = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `PKR ${(n / 1e9).toFixed(2)}Bn`;
  if (a >= 1e6) return `PKR ${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `PKR ${(n / 1e3).toFixed(1)}K`;
  return `PKR ${Math.round(n).toLocaleString('en-PK')}`;
};

/**
 * Shown to HR when Rewards has provided a new ASR sheet but the divisions have
 * not been released yet. This is the "split and send" step — the one action
 * that replaces manually cutting the workbook into per-department files.
 */
export function DistributeBanner({
  cycleId, cycleName, employees, divisions, totalBudget,
}: {
  cycleId: number; cycleName: string; employees: number; divisions: number; totalBudget: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  async function distribute() {
    setBusy(true); setError('');
    const res = await fetch(`/api/cycles/${cycleId}/distribute`, { method: 'POST' });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Distribution failed'); return; }
    setResult(data);
    router.refresh();
  }

  if (result) {
    return (
      <div className="card mb-4 overflow-hidden">
        <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-200">
          <h2 className="text-[14px] font-semibold text-emerald-900">
            {result.divisions.length} division workspaces released · {result.notified} Heads of Department notified
          </h2>
          {result.warnings?.map((w: string, i: number) => (
            <p key={i} className="text-[13px] text-amber-900 mt-2 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">{w}</p>
          ))}
        </div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0"><tr>
              <Th>Division</Th><Th>Head of Department</Th>
              <Th align="right">Employees</Th><Th align="right">Allocated budget</Th><Th>Notified</Th>
            </tr></thead>
            <tbody>
              {result.divisions.map((d: any) => (
                <tr key={d.id} className="row-hover">
                  <Td className="font-medium">{d.name}</Td>
                  <Td>{d.hodName ?? <span className="text-amber-700">No HOD linked</span>}</Td>
                  <Td align="right" num>{d.employees}</Td>
                  <Td align="right" num>{pkr(d.allocated)}</Td>
                  <Td>{d.hodName ? <Badge tone="green">Sent</Badge> : <Badge tone="amber">Skipped</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-jazz-300 bg-jazz-50/70 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-ink-900">
            New ASR sheet received from Rewards
          </h2>
          <p className="text-[13px] text-ink-700 mt-1 max-w-3xl">
            <span className="font-medium">{cycleName}</span> — {employees.toLocaleString('en-PK')} employees
            across {divisions} divisions, with a total budget of {pkr(totalBudget)}. Releasing creates a
            secure workspace for each division and notifies its Head of Department. No files are sent and
            no password is shared — each HOD can only open their own.
          </p>
          {error && (
            <p className="text-[13px] text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-2">{error}</p>
          )}
        </div>
        <button className="btn-primary shrink-0" onClick={distribute} disabled={busy}>
          {busy ? 'Distributing…' : 'Distribute to divisions'}
        </button>
      </div>
    </div>
  );
}
