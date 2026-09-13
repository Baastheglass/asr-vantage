'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Meter, Th, Td, Card, EmptyState, budgetTone } from './ui';

/* ------------------------------------------------------------------ */
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

interface Rec {
  id: number; empCode: string; name: string; jobTitle: string;
  gradeCode: string; gradeLabel: string; maxMeritPct: number;
  departmentName: string; subDepartment: string | null;
  currentSalary: number; incrementPct: number; incrementAmount: number;
  bonusAmount: number; promotionRecommended: number; eligibilityPromotion: number;
  prevAsrPct: number; performanceRating: string | null; remarks: string | null;
  status: string; revisedSalary: number; annualisedCost: number;
}

interface Budget {
  allocated: number; additionalApproved: number; effectiveAllocated: number;
  incrementCost: number; bonusCost: number; utilised: number; remaining: number;
  utilisationPct: number; variance: number; status: string;
}

const RATINGS = ['Outstanding', 'Exceeds Expectations', 'Meets Expectations', 'Partially Meets', 'Does Not Meet'];

export function WorkspaceTable({
  divisionId, divisionName, canEdit, initialBudget, workflowStatus, isHR,
}: {
  divisionId: number; divisionName: string; canEdit: boolean;
  initialBudget: Budget; workflowStatus: string; isHR: boolean;
}) {
  const [rows, setRows] = useState<Rec[]>([]);
  const [budget, setBudget] = useState<Budget>(initialBudget);
  const [filters, setFilters] = useState<any>({ departments: [], grades: [], subDepartments: [] });
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'warn' | 'err' } | null>(null);
  const [historyFor, setHistoryFor] = useState<Rec | null>(null);
  const [showException, setShowException] = useState(false);
  const [submitState, setSubmitState] = useState<{ blockers: string[] } | null>(null);
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<null | { action: string; label: string }>(null);

  const [q, setQ] = useState({
    page: 1, pageSize: 50, search: '', departmentId: '', gradeId: '', status: '',
    sort: 'name', dir: 'asc' as 'asc' | 'desc',
  });
  const searchTimer = useRef<any>(null);

  const submitted = workflowStatus === 'SUBMITTED';
  const editable = canEdit && !submitted;

  const load = useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams({
      divisionId: String(divisionId), page: String(q.page), pageSize: String(q.pageSize),
      sort: q.sort, dir: q.dir,
    });
    if (q.search) sp.set('search', q.search);
    if (q.departmentId) sp.set('departmentId', q.departmentId);
    if (q.gradeId) sp.set('gradeId', q.gradeId);
    if (q.status) sp.set('status', q.status);

    const res = await fetch(`/api/records?${sp}`);
    const data = await res.json();
    if (res.ok) {
      setRows(data.data); setTotal(data.total); setPages(data.pages);
      setFilters(data.filters);
      if (data.budget) setBudget(data.budget);
    } else {
      setToast({ msg: data.error ?? 'Failed to load', tone: 'err' });
    }
    setLoading(false);
  }, [divisionId, q]);

  useEffect(() => { load(); }, [load]);

  // A changed filter or page invalidates the current tick-box selection.
  useEffect(() => { setSelected(new Set()); }, [q.search, q.departmentId, q.gradeId, q.status, q.page]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  /* Enter moves down the same column, like a spreadsheet. */
  function focusNext(field: string, index: number) {
    const all = document.querySelectorAll<HTMLInputElement>(`[data-cell="${field}"]`);
    const next = all[index + 1];
    if (next) { next.focus(); next.select(); }
  }

  /* ---------------- saving --------------------------------------- */
  async function save(rec: Rec, patch: Record<string, unknown>) {
    setSaving((s) => new Set(s).add(rec.id));
    try {
      const res = await fetch(`/api/records/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) { setToast({ msg: data.error ?? 'Could not save', tone: 'err' }); return; }

      setRows((rs) => rs.map((r) => (r.id === rec.id ? { ...r, ...data.record } : r)));
      setBudget(data.budget);
      if (data.warnings?.length) setToast({ msg: data.warnings[0], tone: 'warn' });
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(rec.id); return n; });
    }
  }

  /* ---------------- submit --------------------------------------- */
  async function submitDivision() {
    const res = await fetch(`/api/divisions/${divisionId}/submit`, { method: 'POST' });
    const data = await res.json();
    if (res.status === 409) { setSubmitState({ blockers: data.blockers }); return; }
    if (!res.ok) { setToast({ msg: data.error ?? 'Submission failed', tone: 'err' }); return; }
    setToast({ msg: `${divisionName} submitted to HR for validation.`, tone: 'ok' });
    setTimeout(() => window.location.reload(), 900);
  }

  const overBy = budget.variance < 0 ? Math.abs(budget.variance) : 0;
  const tone = budgetTone(budget.status);

  return (
    <div className="space-y-4">
      {/* ---------- Live budget bar ---------- */}
      <div className={`card p-4 ${budget.status === 'OVER' ? 'ring-2 ring-red-500/60' : budget.status === 'APPROACHING' ? 'ring-1 ring-amber-400/60' : ''}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Stat label="Allocated budget" value={`PKR ${pkr(budget.allocated, true)}`}
              note={budget.additionalApproved > 0 ? `+ PKR ${pkr(budget.additionalApproved, true)} approved exception` : 'Set by Rewards'} />
            <Stat label="Utilised" value={`PKR ${pkr(budget.utilised, true)}`}
              note={`PKR ${pkr(budget.incrementCost, true)} increments · PKR ${pkr(budget.bonusCost, true)} bonus`}
              tone={tone} />
            <Stat label="Remaining" value={`PKR ${pkr(budget.remaining, true)}`}
              note={budget.remaining < 0 ? 'Over allocation' : 'Still available'}
              tone={budget.remaining < 0 ? 'red' : undefined} />
            <Stat label="Utilisation" value={`${budget.utilisationPct.toFixed(1)}%`} tone={tone}
              note={`of PKR ${pkr(budget.effectiveAllocated, true)}`} />
          </div>

          <div className="flex items-center gap-2">
            {submitted ? (
              <Badge tone="green">Submitted to HR</Badge>
            ) : editable ? (
              <>
                {overBy > 0 && (
                  <button className="btn-secondary" onClick={() => setShowException(true)}>
                    Request budget exception
                  </button>
                )}
                <button className="btn-primary" onClick={submitDivision}>Submit to HR</button>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <Meter value={budget.utilisationPct} tone={tone} height="h-2.5" />
        </div>

        {budget.status === 'OVER' && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2.5 flex items-start gap-2.5">
            <span className="mt-0.5 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] grid place-items-center font-bold shrink-0">!</span>
            <div className="text-[13px] text-red-800">
              <p className="font-semibold">
                {divisionName} is over budget by PKR {pkr(overBy)}
              </p>
              <p className="mt-0.5">
                This review cannot be submitted while it exceeds the allocation. Either reduce the proposed
                increments and bonuses, or raise a budget exception request with a business justification
                for HR to consider.
              </p>
            </div>
          </div>
        )}
        {budget.status === 'APPROACHING' && (
          <p className="mt-3 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {divisionName} has used {budget.utilisationPct.toFixed(1)}% of its allocation — only
            PKR {pkr(budget.remaining)} remains.
          </p>
        )}
      </div>

      {/* ---------- Filters ---------- */}
      <div className="card p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input max-w-xs" placeholder="Search name, employee ID or job title…"
            defaultValue={q.search}
            onChange={(e) => {
              const v = e.target.value;
              clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => setQ((s) => ({ ...s, search: v, page: 1 })), 300);
            }}
          />
          <select className="input w-auto" value={q.departmentId}
            onChange={(e) => setQ((s) => ({ ...s, departmentId: e.target.value, page: 1 }))}>
            <option value="">All departments</option>
            {filters.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input w-auto" value={q.gradeId}
            onChange={(e) => setQ((s) => ({ ...s, gradeId: e.target.value, page: 1 }))}>
            <option value="">All grades</option>
            {filters.grades.map((g: any) => <option key={g.id} value={g.id}>{g.code} — {g.label}</option>)}
          </select>
          <select className="input w-auto" value={q.status}
            onChange={(e) => setQ((s) => ({ ...s, status: e.target.value, page: 1 }))}>
            <option value="">All employees</option>
            <option value="pending">Not yet reviewed</option>
            <option value="reviewed">Reviewed</option>
            <option value="eligible">Promotion eligible</option>
            <option value="promotion">Promotion recommended</option>
          </select>
          <select className="input w-auto" value={q.pageSize}
            onChange={(e) => setQ((s) => ({ ...s, pageSize: Number(e.target.value), page: 1 }))}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
          <span className="text-xs text-ink-500 ml-auto tabular">
            {loading ? 'Loading…' : `${total.toLocaleString('en-PK')} employees`}
          </span>
        </div>
      </div>

      {/* ---------- Bulk actions ---------- */}
      {editable && (
        <div className="card px-3 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink-800">
            {selected.size > 0
              ? `${selected.size} selected`
              : `Apply to all ${total.toLocaleString('en-PK')} matching the filters`}
          </span>
          {selected.size > 0 && (
            <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
          )}
          <span className="w-px h-5 bg-ink-200 mx-1" />
          <button className="btn-secondary btn-sm" onClick={() => setBulk({ action: 'SET_INCREMENT_PCT', label: 'Set increment %' })}>
            Set increment %
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setBulk({ action: 'SET_BONUS', label: 'Set bonus' })}>
            Set bonus
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setBulk({ action: 'SET_RATING', label: 'Set performance rating' })}>
            Set rating
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setBulk({ action: 'NO_INCREMENT', label: 'Mark as no increment' })}>
            Mark as no increment
          </button>
          <span className="text-2xs text-ink-500 ml-auto hidden lg:block">
            Tip: press Enter in a cell to save and jump to the row below.
          </span>
        </div>
      )}

      {/* ---------- Table ---------- */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                {editable && (
                  <th className="th w-8">
                    <input type="checkbox" className="accent-jazz-600 align-middle"
                      aria-label="Select all on this page"
                      checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </th>
                )}
                <SortTh q={q} setQ={setQ} col="empCode">ID</SortTh>
                <SortTh q={q} setQ={setQ} col="name">Employee</SortTh>
                <SortTh q={q} setQ={setQ} col="grade">Grade</SortTh>
                <Th>Department</Th>
                <SortTh q={q} setQ={setQ} col="salary" align="right">Current salary</SortTh>
                <Th align="right">Prev ASR</Th>
                <SortTh q={q} setQ={setQ} col="increment" align="right">Increment %</SortTh>
                <Th align="right">Increment PKR</Th>
                <SortTh q={q} setQ={setQ} col="bonus" align="right">Bonus PKR</SortTh>
                <Th align="right">Revised salary</Th>
                <Th align="right">Annualised cost</Th>
                <Th align="center">Promo</Th>
                <Th>Rating</Th>
                <Th>Remarks</Th>
                <Th align="center">History</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Row key={r.id} rec={r} index={i} editable={editable} saving={saving.has(r.id)}
                  selected={selected.has(r.id)}
                  onSelect={(on) => setSelected((s) => {
                    const n = new Set(s);
                    if (on) n.add(r.id); else n.delete(r.id);
                    return n;
                  })}
                  onSave={save} onHistory={() => setHistoryFor(r)} onEnter={focusNext} />
              ))}
            </tbody>
          </table>
        </div>

        {!loading && rows.length === 0 && (
          <EmptyState title="No employees match these filters"
            hint="Adjust the search or filter selection to see more records." />
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-ink-200 bg-ink-50/60">
          <p className="text-xs text-ink-600 tabular">
            Page {q.page} of {pages} · {total.toLocaleString('en-PK')} records
          </p>
          <div className="flex gap-1">
            <button className="btn-secondary btn-sm" disabled={q.page <= 1}
              onClick={() => setQ((s) => ({ ...s, page: 1 }))}>First</button>
            <button className="btn-secondary btn-sm" disabled={q.page <= 1}
              onClick={() => setQ((s) => ({ ...s, page: s.page - 1 }))}>Previous</button>
            <button className="btn-secondary btn-sm" disabled={q.page >= pages}
              onClick={() => setQ((s) => ({ ...s, page: s.page + 1 }))}>Next</button>
            <button className="btn-secondary btn-sm" disabled={q.page >= pages}
              onClick={() => setQ((s) => ({ ...s, page: pages }))}>Last</button>
          </div>
        </div>
      </div>

      {/* ---------- Toast ---------- */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-lg shadow-pop px-4 py-3 text-[13px] border
          ${toast.tone === 'err' ? 'bg-red-50 border-red-300 text-red-800'
            : toast.tone === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-emerald-50 border-emerald-300 text-emerald-800'}`}>
          <div className="flex items-start gap-2">
            <span className="flex-1">{toast.msg}</span>
            <button onClick={() => setToast(null)} className="text-current/60 hover:text-current">×</button>
          </div>
        </div>
      )}

      {/* ---------- Submit blocked dialog ---------- */}
      {submitState && (
        <Modal title="Submission blocked" onClose={() => setSubmitState(null)}>
          <p className="text-[13px] text-ink-700 mb-3">
            {divisionName} cannot be submitted to HR until the following are resolved:
          </p>
          <ul className="space-y-2 mb-4">
            {submitState.blockers.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                <span className="mt-0.5 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] grid place-items-center font-bold shrink-0">!</span>
                {b}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setSubmitState(null)}>Close</button>
            {overBy > 0 && (
              <button className="btn-primary" onClick={() => { setSubmitState(null); setShowException(true); }}>
                Request budget exception
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* ---------- Exception request ---------- */}
      {showException && (
        <ExceptionModal divisionId={divisionId} divisionName={divisionName} budget={budget}
          onClose={() => setShowException(false)}
          onDone={() => { setShowException(false); setToast({ msg: 'Budget exception request submitted to HR.', tone: 'ok' }); }} />
      )}

      {/* ---------- Bulk apply ---------- */}
      {bulk && (
        <BulkModal
          divisionId={divisionId}
          action={bulk.action}
          label={bulk.label}
          count={selected.size > 0 ? selected.size : total}
          usingSelection={selected.size > 0}
          recordIds={selected.size > 0 ? [...selected] : undefined}
          filter={{ departmentId: q.departmentId, gradeId: q.gradeId, search: q.search, status: q.status }}
          onClose={() => setBulk(null)}
          onDone={(res) => {
            setBulk(null);
            setSelected(new Set());
            setBudget(res.budget);
            load();
            setToast({
              msg: res.warnings?.[0]
                ? `${res.changed} employees updated. ${res.warnings[0]}`
                : `${res.changed} employees updated.`,
              tone: res.warnings?.length ? 'warn' : 'ok',
            });
          }}
        />
      )}

      {/* ---------- History ---------- */}
      {historyFor && <HistoryDrawer rec={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  const c = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : 'text-ink-900';
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`text-lg font-semibold tabular ${c}`}>{value}</p>
      {note && <p className="text-2xs text-ink-500">{note}</p>}
    </div>
  );
}

function SortTh({ q, setQ, col, children, align }: any) {
  const active = q.sort === col;
  return (
    <th className={`th cursor-pointer select-none ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => setQ((s: any) => ({ ...s, sort: col, dir: active && s.dir === 'asc' ? 'desc' : 'asc', page: 1 }))}>
      <span className="inline-flex items-center gap-1">
        {children}
        <span className={active ? 'text-jazz-600' : 'text-ink-300'}>{active && q.dir === 'desc' ? '▼' : '▲'}</span>
      </span>
    </th>
  );
}

function Row({ rec, index, editable, saving, selected, onSelect, onSave, onHistory, onEnter }: {
  rec: Rec; index: number; editable: boolean; saving: boolean;
  selected: boolean; onSelect: (on: boolean) => void;
  onSave: (r: Rec, p: Record<string, unknown>) => void; onHistory: () => void;
  onEnter: (field: string, index: number) => void;
}) {
  const [pctInput, setPctInput] = useState((rec.incrementPct * 100).toFixed(2));
  const [bonusInput, setBonusInput] = useState(String(rec.bonusAmount || ''));
  const [remarks, setRemarks] = useState(rec.remarks ?? '');

  useEffect(() => { setPctInput((rec.incrementPct * 100).toFixed(2)); }, [rec.incrementPct]);
  useEffect(() => { setBonusInput(String(rec.bonusAmount || '')); }, [rec.bonusAmount]);

  const overCap = rec.incrementPct > rec.maxMeritPct + 1e-9;

  return (
    <tr className={`row-hover ${saving ? 'bg-blue-50/40' : ''} ${selected ? 'bg-jazz-50/50' : ''}`}>
      {editable && (
        <td className="td w-8">
          <input type="checkbox" className="accent-jazz-600 align-middle"
            aria-label={`Select ${rec.name}`}
            checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        </td>
      )}
      <Td num className="text-ink-500">{rec.empCode}</Td>
      <Td>
        <span className="font-medium text-ink-900">{rec.name}</span>
        <span className="block text-2xs text-ink-500">{rec.jobTitle}</span>
      </Td>
      <Td>
        <Badge tone="gray">{rec.gradeCode}</Badge>
        <span className="block text-2xs text-ink-500 mt-0.5">{rec.gradeLabel}</span>
      </Td>
      <Td>
        <span className="text-ink-700">{rec.departmentName}</span>
        {rec.subDepartment && <span className="block text-2xs text-ink-500">{rec.subDepartment}</span>}
      </Td>
      <Td align="right" num>{pkr(rec.currentSalary)}</Td>
      <Td align="right" num className="text-ink-500">{(rec.prevAsrPct * 100).toFixed(1)}%</Td>
      <Td align="right">
        {editable ? (
          <input
            type="number" step="0.01" min="0" max="100" data-cell="pct"
            className={`input w-20 text-right py-1 ${overCap ? 'border-amber-500 bg-amber-50' : ''}`}
            value={pctInput}
            onChange={(e) => setPctInput(e.target.value)}
            onBlur={() => {
              const v = Number(pctInput) / 100;
              if (Number.isFinite(v) && Math.abs(v - rec.incrementPct) > 1e-9) onSave(rec, { incrementPct: v });
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const v = Number(pctInput) / 100;
              if (Number.isFinite(v) && Math.abs(v - rec.incrementPct) > 1e-9) onSave(rec, { incrementPct: v });
              onEnter('pct', index);
            }}
            title={overCap ? `Above the ${(rec.maxMeritPct * 100).toFixed(0)}% ceiling for ${rec.gradeCode}` : undefined}
          />
        ) : (
          <span className="tabular">{(rec.incrementPct * 100).toFixed(2)}%</span>
        )}
      </Td>
      <Td align="right" num className="text-ink-600">{pkr(rec.incrementAmount)}</Td>
      <Td align="right">
        {editable ? (
          <input
            type="number" step="1000" min="0" data-cell="bonus"
            className="input w-24 text-right py-1" value={bonusInput}
            placeholder="0"
            onChange={(e) => setBonusInput(e.target.value)}
            onBlur={() => {
              const v = Number(bonusInput || 0);
              if (Number.isFinite(v) && v !== rec.bonusAmount) onSave(rec, { bonusAmount: v });
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const v = Number(bonusInput || 0);
              if (Number.isFinite(v) && v !== rec.bonusAmount) onSave(rec, { bonusAmount: v });
              onEnter('bonus', index);
            }}
          />
        ) : (
          <span className="tabular">{pkr(rec.bonusAmount)}</span>
        )}
      </Td>
      <Td align="right" num className="font-medium">{pkr(rec.revisedSalary)}</Td>
      <Td align="right" num className="text-ink-600">{pkr(rec.annualisedCost)}</Td>
      <Td align="center">
        <input type="checkbox" disabled={!editable} checked={!!rec.promotionRecommended}
          onChange={(e) => onSave(rec, { promotionRecommended: e.target.checked })}
          className="accent-jazz-600 w-4 h-4 disabled:opacity-50"
          title={rec.eligibilityPromotion ? 'Eligible by tenure' : 'Not yet eligible by tenure'} />
        {!rec.eligibilityPromotion && <span className="block text-[9px] text-ink-400">not elig.</span>}
      </Td>
      <Td>
        {editable ? (
          <select className="input w-40 py-1" value={rec.performanceRating ?? ''}
            onChange={(e) => onSave(rec, { performanceRating: e.target.value })}>
            <option value="">—</option>
            {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        ) : (
          <span className="text-ink-600">{rec.performanceRating ?? '—'}</span>
        )}
      </Td>
      <Td>
        {editable ? (
          <input className="input w-56 py-1" value={remarks} placeholder="Justification / comments"
            onChange={(e) => setRemarks(e.target.value)}
            onBlur={() => { if (remarks !== (rec.remarks ?? '')) onSave(rec, { remarks }); }} />
        ) : (
          <span className="text-ink-600 text-2xs" title={rec.remarks ?? ''}>
            {rec.remarks ? rec.remarks.slice(0, 40) + (rec.remarks.length > 40 ? '…' : '') : '—'}
          </span>
        )}
      </Td>
      <Td align="center">
        <button className="btn-ghost btn-sm" onClick={onHistory} title="View change history">↺</button>
      </Td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[85vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="card-head sticky top-0 bg-white z-10">
          <h3 className="card-title">{title}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function ExceptionModal({ divisionId, divisionName, budget, onClose, onDone }: any) {
  const over = Math.abs(Math.min(0, budget.variance));
  const [amount, setAmount] = useState(String(over || ''));
  const [justification, setJustification] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErr('');
    const res = await fetch('/api/exceptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ divisionId, requestedAmount: Number(amount), justification }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(data.error ?? 'Could not submit request'); return; }
    onDone();
  }

  return (
    <Modal title="Budget exception request" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
          <Stat label="Allocated" value={`PKR ${pkr(budget.allocated, true)}`} />
          <Stat label="Proposed" value={`PKR ${pkr(budget.utilised, true)}`} tone="red" />
          <Stat label="Shortfall" value={`PKR ${pkr(over, true)}`} tone="red" />
          <Stat label="Projected utilisation" value={`${budget.utilisationPct.toFixed(1)}%`} tone="red" />
        </div>

        <div>
          <label className="label">Additional budget requested (PKR)</label>
          <input type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="text-2xs text-ink-500 mt-1">
            Defaults to the exact shortfall. The original allocation from Rewards is never overwritten —
            any approved amount is recorded separately.
          </p>
        </div>

        <div>
          <label className="label">Business justification</label>
          <textarea className="input min-h-28" value={justification} rows={5}
            placeholder="Explain why these employees warrant an allocation above the approved budget — performance delivered, retention risk, contractual commitments, market benchmarking…"
            onChange={(e) => setJustification(e.target.value)} />
          <p className="text-2xs text-ink-500 mt-1">
            {justification.length} characters · minimum 40. This is shown to HR and, if escalated, to the GSM President.
          </p>
        </div>

        {err && <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || justification.length < 40}>
            {busy ? 'Submitting…' : 'Submit request to HR'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BulkModal({
  divisionId, action, label, count, usingSelection, recordIds, filter, onClose, onDone,
}: {
  divisionId: number; action: string; label: string; count: number; usingSelection: boolean;
  recordIds?: number[]; filter: Record<string, string>;
  onClose: () => void; onDone: (res: any) => void;
}) {
  const [value, setValue] = useState(action === 'SET_INCREMENT_PCT' ? '8' : action === 'SET_BONUS' ? '0' : RATINGS[2]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true); setErr('');
    const body: any = { divisionId, action };
    if (action === 'SET_INCREMENT_PCT') body.value = Number(value) / 100;
    else if (action === 'SET_BONUS') body.value = Number(value);
    else if (action === 'SET_RATING') body.value = value;
    if (recordIds) body.recordIds = recordIds;
    else body.filter = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== ''));

    const res = await fetch('/api/records/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(d.error ?? 'Could not apply'); return; }
    onDone(d);
  }

  return (
    <Modal title={label} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[13px] text-ink-700">
          This will be applied to{' '}
          <span className="font-semibold text-ink-900">
            {count.toLocaleString('en-PK')} employee{count === 1 ? '' : 's'}
          </span>
          {usingSelection ? ' you have selected.' : ' matching your current filters.'}
        </p>

        {action === 'SET_INCREMENT_PCT' && (
          <div>
            <label className="label">Increment percentage</label>
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" min="0" className="input w-32 text-right"
                value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
              <span className="text-[13px] text-ink-600">%</span>
            </div>
            <p className="text-2xs text-ink-500 mt-1">
              Each person&apos;s PKR amount is calculated from their own salary. You can still
              adjust individuals afterwards.
            </p>
          </div>
        )}

        {action === 'SET_BONUS' && (
          <div>
            <label className="label">Bonus amount (PKR)</label>
            <input type="number" step="1000" min="0" className="input w-44 text-right"
              value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <p className="text-2xs text-ink-500 mt-1">The same amount is given to everyone in the selection.</p>
          </div>
        )}

        {action === 'SET_RATING' && (
          <div>
            <label className="label">Performance rating</label>
            <select className="input" value={value} onChange={(e) => setValue(e.target.value)}>
              {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}

        {action === 'NO_INCREMENT' && (
          <p className="text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Their increment and bonus are set to zero and they are recorded as reviewed with no
            increase this cycle. Use this to clear the employees who are still blocking submission.
          </p>
        )}

        {err && <p className="text-[13px] text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</p>}

        <p className="text-2xs text-ink-500">
          Every individual change is written to that employee&apos;s history, so a bulk edit stays
          fully auditable.
        </p>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={go} disabled={busy}>
            {busy ? 'Applying…' : `Apply to ${count.toLocaleString('en-PK')}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryDrawer({ rec, onClose }: { rec: Rec; onClose: () => void }) {
  const [versions, setVersions] = useState<any[] | null>(null);
  useEffect(() => {
    fetch(`/api/records/${rec.id}/history`).then((r) => r.json()).then((d) => setVersions(d.versions ?? []));
  }, [rec.id]);

  return (
    <Modal title={`Change history — ${rec.name}`} onClose={onClose} wide>
      {versions === null ? (
        <p className="text-[13px] text-ink-500">Loading…</p>
      ) : versions.length === 0 ? (
        <EmptyState title="No changes recorded yet"
          hint="Every edit to this employee's increment, bonus or remarks will be listed here with who made it and when." />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr><Th>Field</Th><Th>From</Th><Th>To</Th><Th>Changed by</Th><Th>When</Th></tr>
          </thead>
          <tbody>
            {versions.map((v, i) => (
              <tr key={i} className="row-hover">
                <Td className="font-medium">{v.field}</Td>
                <Td className="text-ink-500">{v.oldValue ?? '—'}</Td>
                <Td className="font-medium text-ink-900">{v.newValue ?? '—'}</Td>
                <Td>{v.changedBy}</Td>
                <Td className="text-ink-500">{new Date(v.at.replace(' ', 'T') + 'Z').toLocaleString('en-GB')}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
