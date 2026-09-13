'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, Kpi, Badge, Meter, Th, Td, EmptyState, budgetTone, statusTone, humanStatus } from './ui';
import {
  AllocatedVsUtilised, ColumnChart, GroupedColumnChart, CompletionBar,
  UtilisationChart, SERIES, STATUS,
} from './dashboard-charts';

const pkr = (n: number, compact = true) => {
  if (!Number.isFinite(n)) return 'PKR 0';
  const a = Math.abs(n);
  if (compact) {
    if (a >= 1e9) return `PKR ${(n / 1e9).toFixed(2)}Bn`;
    if (a >= 1e6) return `PKR ${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `PKR ${(n / 1e3).toFixed(1)}K`;
  }
  return `PKR ${Math.round(n).toLocaleString('en-PK')}`;
};
const pct = (n: number, dp = 1) => `${(Number.isFinite(n) ? n : 0).toFixed(dp)}%`;

const EMPTY_FILTERS = {
  divisionId: '', departmentId: '', gradeId: '',
  incMin: '', incMax: '', bonusMin: '', bonusMax: '',
  budgetStatus: '', completion: '',
};

export function AnalyticsView() {
  const [f, setF] = useState(EMPTY_FILTERS);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const sp = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== '') sp.set(k, String(v)); });
    fetch(`/api/analytics?${sp}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [f]);

  const activeFilters = Object.values(f).filter((v) => v !== '').length;

  const departments = useMemo(() => {
    if (!data) return [];
    return f.divisionId
      ? data.options.departments.filter((d: any) => String(d.divisionId) === f.divisionId)
      : data.options.departments;
  }, [data, f.divisionId]);

  if (!data) return <Card><p className="text-[13px] text-ink-500">Loading analytics…</p></Card>;
  if (data.error) return <Card><EmptyState title={data.error} /></Card>;

  const h = data.headline;
  const b = data.budget;

  return (
    <div className={`space-y-4 ${loading ? 'opacity-70 transition-opacity' : ''}`}>
      {/* ------------ Filters ------------ */}
      <Card bodyClass="p-3">
        <div className="flex flex-wrap gap-2 items-end">
          <Sel label="Division" value={f.divisionId}
            onChange={(v) => setF({ ...f, divisionId: v, departmentId: '' })}
            options={data.options.divisions.map((d: any) => ({ v: String(d.id), l: d.name }))} />
          <Sel label="Department" value={f.departmentId}
            onChange={(v) => setF({ ...f, departmentId: v })}
            options={departments.map((d: any) => ({ v: String(d.id), l: d.name }))} />
          <Sel label="Job grade" value={f.gradeId}
            onChange={(v) => setF({ ...f, gradeId: v })}
            options={data.options.grades.map((g: any) => ({ v: String(g.id), l: `${g.code} — ${g.label}` }))} />
          <Sel label="Budget status" value={f.budgetStatus}
            onChange={(v) => setF({ ...f, budgetStatus: v })}
            options={[{ v: 'WITHIN', l: 'Within budget' }, { v: 'APPROACHING', l: 'Approaching limit' }, { v: 'OVER', l: 'Over budget' }]} />
          <Sel label="Completion" value={f.completion}
            onChange={(v) => setF({ ...f, completion: v })}
            options={[{ v: 'NOT_STARTED', l: 'Not started' }, { v: 'IN_PROGRESS', l: 'In progress' }, { v: 'SUBMITTED', l: 'Submitted' }]} />

          <div>
            <label className="label">Increment % range</label>
            <div className="flex gap-1 items-center">
              <input className="input w-16 py-1" placeholder="min" value={f.incMin}
                onChange={(e) => setF({ ...f, incMin: e.target.value })} />
              <span className="text-ink-400">–</span>
              <input className="input w-16 py-1" placeholder="max" value={f.incMax}
                onChange={(e) => setF({ ...f, incMax: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Bonus range (PKR)</label>
            <div className="flex gap-1 items-center">
              <input className="input w-24 py-1" placeholder="min" value={f.bonusMin}
                onChange={(e) => setF({ ...f, bonusMin: e.target.value })} />
              <span className="text-ink-400">–</span>
              <input className="input w-24 py-1" placeholder="max" value={f.bonusMax}
                onChange={(e) => setF({ ...f, bonusMax: e.target.value })} />
            </div>
          </div>

          {activeFilters > 0 && (
            <button className="btn-secondary" onClick={() => setF(EMPTY_FILTERS)}>
              Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
            </button>
          )}
          <span className="text-xs text-ink-500 ml-auto tabular">
            {loading ? 'Updating…' : `${h.employees.toLocaleString('en-PK')} employees in scope`}
          </span>
        </div>
      </Card>

      {h.employees === 0 ? (
        <Card><EmptyState title="No employees match these filters" hint="Clear or widen the filters above." /></Card>
      ) : (
        <>
          {/* ------------ Budget KPIs ------------ */}
          <SectionTitle>Budget position</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Allocated" value={pkr(b.effectiveAllocated)}
              sub={b.additionalApproved ? `incl. ${pkr(b.additionalApproved)} exceptions` : 'from Rewards'} />
            <Kpi label="Utilised" value={pkr(b.utilised)} tone={budgetTone(b.status)} />
            <Kpi label="Remaining" value={pkr(b.remaining)} tone={b.remaining < 0 ? 'red' : undefined} />
            <Kpi label="Utilisation" value={pct(b.utilisationPct)} tone={budgetTone(b.status)}
              sub={<Meter value={b.utilisationPct} tone={budgetTone(b.status)} height="h-1.5" />} />
            <Kpi label="Variance" value={pkr(b.variance)} tone={b.variance < 0 ? 'red' : 'green'}
              sub={b.variance < 0 ? 'Over allocation' : 'Under allocation'} />
            <Kpi label="Payroll uplift" value={pct(h.payrollIncreasePct, 2)}
              sub={`on ${pkr(h.annualPayroll)} annual payroll`} />
          </div>

          {/* ------------ Increment KPIs ------------ */}
          <SectionTitle>Increment &amp; bonus profile</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <Kpi label="Receiving increment" value={h.withIncrement.toLocaleString('en-PK')}
              sub={`${pct(h.incrementIncidence)} of population`} />
            <Kpi label="Average increment" value={pct(h.avgIncrementPct, 2)} />
            <Kpi label="Median increment" value={pct(h.medianIncrementPct, 2)} />
            <Kpi label="Highest increment" value={pct(h.maxIncrementPct, 2)} />
            <Kpi label="Receiving bonus" value={h.withBonus.toLocaleString('en-PK')}
              sub={`${pct(h.bonusIncidence)} of population`} />
            <Kpi label="Average bonus" value={pkr(h.avgBonus)}
              sub={`median ${pkr(h.medianBonus)}`} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <Kpi label="Total bonus pool" value={pkr(h.totalBonus)} />
            <Kpi label="Promotions recommended" value={h.promotions}
              sub={`${h.promotionEligible} eligible by tenure`} />
            <Kpi label="Reviewed" value={h.reviewed.toLocaleString('en-PK')}
              sub={`${pct(h.completionPct, 0)} complete`} />
            <Kpi label="Not yet reviewed" value={h.notReviewed.toLocaleString('en-PK')}
              tone={h.notReviewed ? 'amber' : 'green'} />
            <Kpi label="Employees in scope" value={h.employees.toLocaleString('en-PK')} />
            <Kpi label="Annual payroll" value={pkr(h.annualPayroll)} />
          </div>

          {/* ------------ Charts ------------ */}
          <SectionTitle>Division analysis</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Allocated vs proposed by division" subtitle="Annualised impact, PKR">
              <AllocatedVsUtilised data={data.byDivision.map((d: any) => ({
                name: d.name, full: d.full, allocated: d.allocated, utilised: d.utilised,
              }))} />
            </Card>
            <Card title="Budget utilisation by division" subtitle="Share of allocation proposed so far">
              <UtilisationChart data={[...data.byDivision]
                .sort((a: any, b: any) => b.utilisation - a.utilisation)
                .map((d: any) => ({
                  name: d.name, full: d.full, allocated: d.allocated,
                  utilised: d.utilised, utilisation: Number(d.utilisation.toFixed(1)), status: d.status,
                }))} />
            </Card>
          </div>

          <Card title="Division detail" bodyClass="p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <Th>Division</Th><Th align="right">Employees</Th><Th align="right">Allocated</Th>
                  <Th align="right">Utilised</Th><Th align="right">Remaining</Th><Th align="right">Utilisation</Th>
                  <Th align="right">Variance</Th><Th align="right">Avg inc.</Th><Th align="right">Promotions</Th>
                  <Th align="right">Complete</Th><Th>Status</Th>
                </tr></thead>
                <tbody>
                  {data.byDivision.map((d: any) => (
                    <tr key={d.id} className="row-hover">
                      <Td className="font-medium">{d.full}</Td>
                      <Td align="right" num>{d.employees}</Td>
                      <Td align="right" num>{pkr(d.allocated)}</Td>
                      <Td align="right" num>{pkr(d.utilised)}</Td>
                      <Td align="right" num className={d.remaining < 0 ? 'text-red-700 font-medium' : ''}>{pkr(d.remaining)}</Td>
                      <Td align="right" num className={d.status === 'OVER' ? 'text-red-700 font-medium' : ''}>{pct(d.utilisation)}</Td>
                      <Td align="right" num className={d.variance < 0 ? 'text-red-700' : 'text-ink-600'}>{pkr(d.variance)}</Td>
                      <Td align="right" num>{pct(d.avgIncPct, 2)}</Td>
                      <Td align="right" num>{d.promotions}</Td>
                      <Td align="right" num>{pct(d.completionPct, 0)}</Td>
                      <Td><Badge tone={statusTone(d.workflowStatus)}>{humanStatus(d.workflowStatus)}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <SectionTitle>Job grade analysis</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Average increment by job grade" subtitle="Where the increase is concentrated">
              <ColumnChart data={data.byGrade.map((g: any) => ({ name: g.name, value: Number(g.avgIncPct.toFixed(2)) }))}
                valueKey="value" label="Average increment" format="pct" />
            </Card>
            <Card title="Headcount and increment recipients by grade">
              <GroupedColumnChart
                data={data.byGrade.map((g: any) => ({ name: g.name, employees: g.employees, withIncrement: g.withIncrement }))}
                keys={['employees', 'withIncrement']} labels={['Employees', 'Receiving increment']} />
            </Card>
          </div>

          <Card title="Job grade detail" bodyClass="p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <Th>Grade</Th><Th>Level</Th><Th align="right">Employees</Th><Th align="right">Avg salary</Th>
                  <Th align="right">Band mid</Th><Th align="right">Compa-ratio</Th><Th align="right">Avg increment</Th>
                  <Th align="right">Incidence</Th><Th align="right">Avg bonus</Th><Th align="right">Total cost</Th>
                  <Th align="right">Promotions</Th>
                </tr></thead>
                <tbody>
                  {data.byGrade.map((g: any) => (
                    <tr key={g.name} className="row-hover">
                      <Td><Badge tone="gray">{g.name}</Badge></Td>
                      <Td className="text-ink-700">{g.label}</Td>
                      <Td align="right" num>{g.employees}</Td>
                      <Td align="right" num>{pkr(g.avgSalary, false)}</Td>
                      <Td align="right" num className="text-ink-500">{pkr((g.bandMin + g.bandMax) / 2, false)}</Td>
                      <Td align="right" num className={g.compaRatio > 100 ? 'text-amber-700' : 'text-ink-700'}>
                        {pct(g.compaRatio, 0)}
                      </Td>
                      <Td align="right" num>{pct(g.avgIncPct, 2)}</Td>
                      <Td align="right" num>{pct(g.incidence, 0)}</Td>
                      <Td align="right" num>{pkr(g.avgBonus)}</Td>
                      <Td align="right" num>{pkr(g.cost)}</Td>
                      <Td align="right" num>{g.promotions}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-2xs text-ink-500 border-t border-ink-200">
              Compa-ratio compares average salary to the mid-point of the grade&apos;s salary band. Above 100% means
              the grade sits above its band mid-point on average.
            </p>
          </Card>

          <SectionTitle>Distribution &amp; progress</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Increment distribution" subtitle="How many employees fall in each increment band">
              <ColumnChart data={data.incDistribution.map((d: any) => ({ name: d.name, value: d.employees }))}
                valueKey="value" label="Employees" />
            </Card>
            <Card title="Division review status" subtitle="Where each division stands in the cycle">
              <CompletionBar segments={[
                { label: 'Submitted', value: data.completionMix.find((c: any) => c.status === 'SUBMITTED')?.divisions ?? 0, color: STATUS.good },
                { label: 'In progress', value: data.completionMix.find((c: any) => c.status === 'IN_PROGRESS')?.divisions ?? 0, color: SERIES[0] },
                { label: 'Not started', value: data.completionMix.find((c: any) => c.status === 'NOT_STARTED')?.divisions ?? 0, color: '#b1b9c9' },
              ]} />
              <div className="mt-5 space-y-2">
                {[...data.byDivision].sort((a: any, b: any) => a.completionPct - b.completionPct).slice(0, 6).map((d: any) => (
                  <div key={d.id} className="flex items-center gap-3">
                    <span className="text-[13px] text-ink-700 w-40 truncate">{d.full}</span>
                    <Meter value={d.completionPct} tone="blue" height="h-1.5" showOverflow={false} />
                    <span className="text-2xs tabular text-ink-600 w-10 text-right">{pct(d.completionPct, 0)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <SectionTitle>Department &amp; individual detail</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Departments by total cost" subtitle="Annualised increment plus bonus" bodyClass="p-0" className="overflow-hidden">
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0"><tr>
                    <Th>Department</Th><Th>Division</Th><Th align="right">Employees</Th>
                    <Th align="right">Avg inc.</Th><Th align="right">Cost</Th><Th align="right">Complete</Th>
                  </tr></thead>
                  <tbody>
                    {data.byDepartment.map((d: any) => (
                      <tr key={d.id} className="row-hover">
                        <Td className="font-medium">{d.name}</Td>
                        <Td className="text-ink-500 text-2xs">{d.divisionName}</Td>
                        <Td align="right" num>{d.employees}</Td>
                        <Td align="right" num>{pct(d.avgIncPct, 2)}</Td>
                        <Td align="right" num>{pkr(d.cost)}</Td>
                        <Td align="right" num>{pct(d.completionPct, 0)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Highest total awards" subtitle="Largest annualised cost per employee in scope"
              bodyClass="p-0" className="overflow-hidden">
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0"><tr>
                    <Th>Employee</Th><Th>Grade</Th><Th>Division</Th>
                    <Th align="right">Inc. %</Th><Th align="right">Bonus</Th><Th align="right">Annual cost</Th>
                  </tr></thead>
                  <tbody>
                    {data.topIncrements.map((t: any) => (
                      <tr key={t.empCode} className="row-hover">
                        <Td>
                          <span className="font-medium">{t.name}</span>
                          <span className="block text-2xs text-ink-500">{t.empCode} · {t.department}</span>
                        </Td>
                        <Td><Badge tone="gray">{t.grade}</Badge></Td>
                        <Td className="text-2xs text-ink-600">{t.division}</Td>
                        <Td align="right" num>{pct(t.pct * 100, 2)}</Td>
                        <Td align="right" num>{pkr(t.bonus)}</Td>
                        <Td align="right" num className="font-medium">{pkr(t.cost)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[13px] font-semibold text-ink-700 uppercase tracking-wide pt-2">{children}</h2>;
}

function Sel({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input w-auto min-w-36" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}
