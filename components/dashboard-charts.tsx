'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, LabelList, Legend,
} from 'recharts';

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ *
 * Status steps are reserved for budget state only. They are never the sole
 * carrier of meaning: every bar is direct-labelled with its utilisation figure
 * and a reference line marks the 100% allocation boundary, so an over-budget
 * division reads as over-budget by position and number even if the colour
 * cannot be distinguished (green/red confusion under deuteranopia).
 * ------------------------------------------------------------------ */
export const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const GRID = '#e6e7ea';
export const AXIS = '#52514e';

export function toneColor(status: string) {
  return status === 'OVER' ? STATUS.critical : status === 'APPROACHING' ? STATUS.warning : STATUS.good;
}

const compact = (n: number) =>
  Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1)}Bn`
  : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(Math.round(n));

const tipStyle = {
  contentStyle: {
    fontSize: 12, borderRadius: 8, border: '1px solid #d5d9e2',
    boxShadow: '0 12px 32px -8px rgb(16 24 40 / 0.18)', padding: '8px 10px',
  },
  labelStyle: { fontWeight: 600, color: '#23272f', marginBottom: 4 },
};

/* ---------------- Utilisation by division (dashboard) --------------- */
export function UtilisationChart({
  data,
}: {
  data: { name: string; full: string; allocated: number; utilised: number; utilisation: number; status: string }[];
}) {
  const height = Math.max(240, data.length * 26 + 40);
  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, left: 4, bottom: 4 }} barCategoryGap={4}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" domain={[0, (max: number) => Math.max(120, Math.ceil(max / 10) * 10)]}
              tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: AXIS }} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={54}
              tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
            <Tooltip
              {...tipStyle}
              formatter={(v: any, _n: any, p: any) => [
                `${v}% used — PKR ${compact(p.payload.utilised)} of PKR ${compact(p.payload.allocated)}`,
                'Utilisation',
              ]}
              labelFormatter={(_l, p: any) => p?.[0]?.payload?.full ?? ''}
              cursor={{ fill: 'rgba(42,120,214,0.06)' }}
            />
            <ReferenceLine x={100} stroke={STATUS.critical} strokeWidth={1.5}
              label={{ value: 'Allocation', position: 'top', fontSize: 10, fill: STATUS.critical }} />
            <Bar dataKey="utilisation" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.name} fill={toneColor(d.status)} />)}
              <LabelList dataKey="utilisation" position="right"
                formatter={(v: any) => `${v}%`} style={{ fontSize: 10, fill: AXIS }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <StatusLegend />
    </>
  );
}

export function StatusLegend() {
  const items = [
    { c: STATUS.good, t: 'Within budget', i: '✓' },
    { c: STATUS.warning, t: 'Approaching limit (≥90%)', i: '!' },
    { c: STATUS.critical, t: 'Over budget', i: '×' },
  ];
  return (
    <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-ink-100">
      {items.map((i) => (
        <span key={i.t} className="inline-flex items-center gap-1.5 text-2xs text-ink-600">
          <span className="w-4 h-4 rounded grid place-items-center text-[9px] font-bold text-white shrink-0"
            style={{ background: i.c }} aria-hidden>{i.i}</span>
          {i.t}
        </span>
      ))}
    </div>
  );
}

/* ---------------- Allocated vs utilised (analytics) ----------------- */
export function AllocatedVsUtilised({
  data,
}: { data: { name: string; full: string; allocated: number; utilised: number }[] }) {
  const height = Math.max(260, data.length * 34 + 50);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barGap={2}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11, fill: AXIS }}
            axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis type="category" dataKey="name" width={54} tick={{ fontSize: 11, fill: AXIS }}
            axisLine={false} tickLine={false} />
          <Tooltip {...tipStyle}
            formatter={(v: any, n: any) => [`PKR ${Number(v).toLocaleString('en-PK')}`, n]}
            labelFormatter={(_l, p: any) => p?.[0]?.payload?.full ?? ''}
            cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={8} />
          <Bar dataKey="allocated" name="Allocated" fill={SERIES[0]} radius={[0, 3, 3, 0]} maxBarSize={11} isAnimationActive={false} />
          <Bar dataKey="utilised" name="Proposed / utilised" fill={SERIES[1]} radius={[0, 3, 3, 0]} maxBarSize={11} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- Single-series column chart ------------------------ */
export function ColumnChart({
  data, valueKey, label, format = 'number', color = SERIES[0], height = 260, angle = 0,
}: {
  data: any[]; valueKey: string; label: string;
  format?: 'number' | 'pkr' | 'pct'; color?: string; height?: number; angle?: number;
}) {
  const fmt = (v: number) =>
    format === 'pkr' ? `PKR ${compact(v)}` : format === 'pct' ? `${Number(v).toFixed(1)}%` : Number(v).toLocaleString('en-PK');
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: angle ? 44 : 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: AXIS }} axisLine={{ stroke: GRID }} tickLine={false}
            angle={angle} textAnchor={angle ? 'end' : 'middle'} height={angle ? 50 : 30} interval={0} />
          <YAxis tickFormatter={(v) => (format === 'pct' ? `${v}%` : compact(v))}
            tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} width={54} />
          <Tooltip {...tipStyle} formatter={(v: any) => [fmt(v), label]}
            cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
          <Bar dataKey={valueKey} name={label} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
            <LabelList dataKey={valueKey} position="top"
              formatter={(v: any) => (format === 'pct' ? `${Number(v).toFixed(1)}%` : compact(Number(v)))}
              style={{ fontSize: 10, fill: AXIS }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- Grouped two-series column ------------------------- */
export function GroupedColumnChart({
  data, keys, labels, format = 'number', height = 260,
}: {
  data: any[]; keys: [string, string]; labels: [string, string];
  format?: 'number' | 'pkr' | 'pct'; height?: number;
}) {
  const fmt = (v: number) =>
    format === 'pkr' ? `PKR ${compact(v)}` : format === 'pct' ? `${Number(v).toFixed(1)}%` : Number(v).toLocaleString('en-PK');
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: AXIS }} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tickFormatter={(v) => (format === 'pct' ? `${v}%` : compact(v))}
            tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} width={54} />
          <Tooltip {...tipStyle} formatter={(v: any, n: any) => [fmt(v), n]} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} />
          <Bar dataKey={keys[0]} name={labels[0]} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          <Bar dataKey={keys[1]} name={labels[1]} fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- Completion composition ---------------------------- */
export function CompletionBar({
  segments,
}: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div className="flex w-full h-6 rounded-md overflow-hidden gap-[2px] bg-ink-100">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            className="grid place-items-center" title={`${s.label}: ${s.value}`}>
            {(s.value / total) > 0.08 && (
              <span className="text-[10px] font-semibold text-white tabular">{s.value}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2.5">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-2xs text-ink-600">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            {s.label} <span className="tabular font-medium text-ink-800">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
