'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Badge, Th, Td, EmptyState, Meter } from './ui';

const pkr = (n: number, compact = true) => {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (compact) {
    if (a >= 1e9) return `${(n / 1e9).toFixed(2)}Bn`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  }
  return Math.round(n).toLocaleString('en-PK');
};

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { n: 1, label: 'Upload file' },
  { n: 2, label: 'Validate & map' },
  { n: 3, label: 'Allocate budget' },
  { n: 4, label: 'Send to HR' },
];

export function UploadWizard({ role }: { role: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const [cycleName, setCycleName] = useState(`Annual Salary Review ${new Date().getFullYear() + 1}`);
  const [totalBudget, setTotalBudget] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(`${new Date().getFullYear() + 1}-01-01`);
  const [deadline, setDeadline] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const [result, setResult] = useState<any>(null);

  /* ---------------- step 1: upload ---------------- */
  async function upload(file: File) {
    setBusy(true); setError('');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload/parse', { method: 'POST', body: fd });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Could not read the file'); return; }
    setReport(data);
    setMapping(data.mapping ?? {});
    setStep(2);
  }

  /* ---------------- re-validate with a corrected mapping ---------------- */
  async function revalidate(next: Record<string, string>) {
    setBusy(true);
    const fd = new FormData();
    fd.append('token', report.token);
    fd.append('mapping', JSON.stringify(next));
    const res = await fetch('/api/upload/parse', { method: 'POST', body: fd });
    const data = await res.json();
    setBusy(false);
    if (res.ok) setReport(data);
  }

  /* ---------------- step 3 -> commit ---------------- */
  function goToBudget() {
    const total = report.divisions.reduce((s: number, d: any) => s + d.annualPayroll, 0);
    const suggestedTotal = Math.round((total * 0.115) / 1e6) * 1e6;
    if (!totalBudget) setTotalBudget(String(suggestedTotal));
    const next: Record<string, string> = {};
    for (const d of report.divisions) {
      next[d.name] = String(Math.round((suggestedTotal * (d.annualPayroll / total)) / 1e5) * 1e5);
    }
    setAllocations(next);
    setStep(3);
  }

  function autoAllocate() {
    const total = report.divisions.reduce((s: number, d: any) => s + d.annualPayroll, 0);
    const budget = Number(totalBudget) || 0;
    const next: Record<string, string> = {};
    for (const d of report.divisions) {
      next[d.name] = String(Math.round((budget * (d.annualPayroll / total)) / 1e5) * 1e5);
    }
    setAllocations(next);
  }

  async function commit() {
    setBusy(true); setError('');
    const res = await fetch('/api/upload/commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: report.token, mapping, cycleName,
        year: Number(cycleName.match(/\d{4}/)?.[0] ?? new Date().getFullYear() + 1),
        totalBudget: Number(totalBudget),
        effectiveDate, reviewDeadline: deadline,
        allocations: Object.fromEntries(Object.entries(allocations).map(([k, v]) => [k, Number(v) || 0])),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Import failed'); return; }
    setResult(data);
    setStep(4);
  }

  const allocTotal = Object.values(allocations).reduce((s: number, v) => s + (Number(v) || 0), 0);
  const budgetNum = Number(totalBudget) || 0;

  return (
    <div className="space-y-4">
      {/* Stepper */}
      <div className="card px-4 py-3">
        <ol className="flex items-center gap-2 flex-wrap">
          {STEPS.map((s, i) => (
            <li key={s.n} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full grid place-items-center text-2xs font-semibold
                ${step > s.n ? 'bg-emerald-500 text-white' : step === s.n ? 'bg-jazz-600 text-white' : 'bg-ink-200 text-ink-600'}`}>
                {step > s.n ? '✓' : s.n}
              </span>
              <span className={`text-[13px] ${step === s.n ? 'font-semibold text-ink-900' : 'text-ink-500'}`}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="w-8 h-px bg-ink-200 mx-1" />}
            </li>
          ))}
        </ol>
      </div>

      {error && (
        <p className="text-[13px] text-red-800 bg-red-50 border border-red-300 rounded-md px-3 py-2.5">{error}</p>
      )}

      {/* ---------------- STEP 1 ---------------- */}
      {step === 1 && (
        <Card title="Master ASR file" subtitle="The workbook sent by the Rewards department">
          <div
            className="border-2 border-dashed border-ink-300 rounded-lg p-10 text-center hover:border-jazz-500 transition-colors cursor-pointer"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-ink-400 mb-3">
              <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <p className="text-[14px] font-medium text-ink-800">
              {busy ? 'Reading workbook…' : 'Drop the master ASR workbook here, or click to browse'}
            </p>
            <p className="text-xs text-ink-500 mt-1">.xlsx, .xlsm, .xls or .csv · up to 25 MB · around 1,500 rows</p>
          </div>
          <div className="mt-4 text-[13px] text-ink-600 bg-ink-50 border border-ink-200 rounded-md px-3 py-2.5">
            <p className="font-medium text-ink-800 mb-1">What happens next</p>
            <p>
              The file is read and every row checked for missing or duplicate employee IDs, unrecognised job
              grades, missing divisions and invalid salaries. Nothing is imported until you have reviewed the
              validation report. Column names are matched automatically and remembered for next year.
            </p>
          </div>
        </Card>
      )}

      {/* ---------------- STEP 2 ---------------- */}
      {step === 2 && report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Tile label="Rows read" value={report.totalRows.toLocaleString('en-PK')} />
            <Tile label="Valid records" value={report.validRows.toLocaleString('en-PK')} tone="green" />
            <Tile label="Blocking errors" value={report.errorCount} tone={report.errorCount ? 'red' : 'green'} />
            <Tile label="Warnings" value={report.warningCount} tone={report.warningCount ? 'amber' : undefined} />
            <Tile label="Divisions found" value={report.divisions.length} />
          </div>

          <Card title="Column mapping" subtitle={`Detected from "${report.fileName}" — correct anything that was matched wrongly`}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.fields.map((f: any) => (
                <div key={f.key}>
                  <label className="label">
                    {f.label} {f.required && <span className="text-jazz-600">*</span>}
                  </label>
                  <select className="input" value={mapping[f.key] ?? ''}
                    onChange={(e) => {
                      const next: Record<string, string> = { ...mapping, [f.key]: e.target.value };
                      if (!e.target.value) delete next[f.key as string];
                      setMapping(next); revalidate(next);
                    }}>
                    <option value="">— not in this file —</option>
                    {report.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Card>

          {report.issues.length > 0 && (
            <Card title={`Validation issues (${report.errorCount} errors, ${report.warningCount} warnings)`}
              subtitle={report.errorCount > 0
                ? 'Rows with errors will not be imported. Fix them in the source workbook and upload again.'
                : 'Warnings do not block the import but are recorded against the cycle.'}
              bodyClass="p-0" className="overflow-hidden">
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0"><tr>
                    <Th align="right">Row</Th><Th>Severity</Th><Th>Field</Th><Th>Issue</Th>
                  </tr></thead>
                  <tbody>
                    {report.issues.slice(0, 200).map((i: any, k: number) => (
                      <tr key={k} className="row-hover">
                        <Td align="right" num>{i.row}</Td>
                        <Td><Badge tone={i.severity === 'ERROR' ? 'red' : 'amber'}>{i.severity}</Badge></Td>
                        <Td>{i.field}</Td>
                        <Td className="whitespace-normal">{i.message}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.issues.length > 200 && (
                <p className="px-4 py-2 text-xs text-ink-500 border-t border-ink-200">
                  Showing the first 200 of {report.issues.length} issues.
                </p>
              )}
            </Card>
          )}

          <Card title="Divisions detected" subtitle="Each of these becomes its own secure workspace" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <Th>Division</Th><Th align="right">Employees</Th>
                  <Th align="right">Departments</Th><Th align="right">Annual payroll</Th>
                </tr></thead>
                <tbody>
                  {report.divisions.map((d: any) => (
                    <tr key={d.name} className="row-hover">
                      <Td className="font-medium">{d.name}</Td>
                      <Td align="right" num>{d.count}</Td>
                      <Td align="right" num>{d.departments}</Td>
                      <Td align="right" num>PKR {pkr(d.annualPayroll)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => { setStep(1); setReport(null); }}>Start over</button>
            <button className="btn-primary" disabled={report.errorCount > 0 || busy} onClick={goToBudget}>
              {report.errorCount > 0 ? `Resolve ${report.errorCount} error(s) to continue` : 'Continue to budget allocation'}
            </button>
          </div>
        </>
      )}

      {/* ---------------- STEP 3 ---------------- */}
      {step === 3 && report && (
        <>
          <Card title="Cycle details">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div><label className="label">Cycle name</label>
                <input className="input" value={cycleName} onChange={(e) => setCycleName(e.target.value)} /></div>
              <div><label className="label">Total ASR budget (PKR, annualised)</label>
                <input className="input" type="number" value={totalBudget}
                  onChange={(e) => setTotalBudget(e.target.value)} /></div>
              <div><label className="label">Effective date</label>
                <input className="input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>
              <div><label className="label">Review deadline</label>
                <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
            </div>
            <p className="text-2xs text-ink-500 mt-2">
              Budget is tracked as annualised impact: monthly increment × 12, plus one-off bonus.
            </p>
          </Card>

          <Card title="Budget allocation per division"
            subtitle="The amount each division may spend. Divisions cannot exceed this without an approved exception."
            action={<button className="btn-secondary btn-sm" onClick={autoAllocate}>Auto-allocate by payroll</button>}
            bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <Th>Division</Th><Th align="right">Employees</Th><Th align="right">Annual payroll</Th>
                  <Th align="right">Allocation (PKR)</Th><Th align="right">% of payroll</Th>
                </tr></thead>
                <tbody>
                  {report.divisions.map((d: any) => {
                    const a = Number(allocations[d.name]) || 0;
                    return (
                      <tr key={d.name} className="row-hover">
                        <Td className="font-medium">{d.name}</Td>
                        <Td align="right" num>{d.count}</Td>
                        <Td align="right" num>PKR {pkr(d.annualPayroll)}</Td>
                        <Td align="right">
                          <input type="number" className="input w-36 text-right py-1"
                            value={allocations[d.name] ?? ''}
                            onChange={(e) => setAllocations({ ...allocations, [d.name]: e.target.value })} />
                        </Td>
                        <Td align="right" num className="text-ink-500">
                          {d.annualPayroll ? ((a / d.annualPayroll) * 100).toFixed(1) : '0.0'}%
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-ink-50 font-semibold">
                    <Td>Total allocated</Td>
                    <Td align="right" num>{report.validRows}</Td>
                    <Td align="right" num>PKR {pkr(report.divisions.reduce((s: number, d: any) => s + d.annualPayroll, 0))}</Td>
                    <Td align="right" num className={allocTotal > budgetNum ? 'text-red-700' : 'text-emerald-700'}>
                      PKR {pkr(allocTotal)}
                    </Td>
                    <Td align="right" num />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-ink-200">
              {allocTotal > budgetNum ? (
                <p className="text-[13px] text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  Division allocations total PKR {pkr(allocTotal)}, which is PKR {pkr(allocTotal - budgetNum)} more
                  than the total ASR budget of PKR {pkr(budgetNum)}.
                </p>
              ) : (
                <p className="text-[13px] text-ink-600">
                  PKR {pkr(budgetNum - allocTotal)} of the total budget is unallocated and held centrally
                  — available to fund approved budget exceptions later in the cycle.
                </p>
              )}
            </div>
          </Card>

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
            <button className="btn-primary" disabled={busy || budgetNum <= 0} onClick={commit}>
              {busy ? 'Importing…' : `Import ${report.validRows.toLocaleString('en-PK')} records`}
            </button>
          </div>
        </>
      )}

      {/* ---------------- STEP 4 ---------------- */}
      {step === 4 && result && (
        <>
          <Card title="Import complete">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Tile label="Records imported" value={result.imported.toLocaleString('en-PK')} tone="green" />
              <Tile label="Divisions created" value={result.divisions} />
              <Tile label="Warnings recorded" value={result.warnings} tone={result.warnings ? 'amber' : undefined} />
              <Tile label="Cycle ID" value={`#${result.cycleId}`} />
            </div>

            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
              <h3 className="text-[14px] font-semibold text-emerald-900">
                Sent to HR — the ASR cycle has begun
              </h3>
              <p className="text-[13px] text-emerald-900/90 mt-1 max-w-3xl">
                The People &amp; Organization team has been notified. They will review the
                allocations and release each division&apos;s workspace to its Head of Department.
                You will be notified again once the completed ASR is approved and returned to
                Rewards for processing.
              </p>
              <button className="btn-primary mt-3" onClick={() => { router.push('/rewards'); router.refresh(); }}>
                Done
              </button>
            </div>
          </Card>

        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  const c = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : 'text-ink-900';
  return (
    <div className="card px-3 py-2.5">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`text-lg font-semibold tabular ${c}`}>{value}</p>
    </div>
  );
}
