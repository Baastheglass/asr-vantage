import React from 'react';

/* ------------------------------------------------------------------ *
 * Brand mark
 * ------------------------------------------------------------------ *
 * The logo is read from public/jazz-logo.svg, which currently holds a
 * placeholder drawn in Jazz brand red. To use the official asset, just
 * replace that one file — no code change is needed. For a PNG or JPG,
 * set NEXT_PUBLIC_LOGO_FILE (e.g. "jazz-logo.png").
 * ------------------------------------------------------------------ */
const LOGO_SRC = `/${process.env.NEXT_PUBLIC_LOGO_FILE || 'jazz-logo.svg'}`;

export function JazzLogo({ className = '', light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_SRC} alt="Jazz" width={30} height={30}
        className="w-[30px] h-[30px] object-contain shrink-0" />
      <span className="leading-tight">
        <span className={`block text-[15px] font-bold tracking-tight ${light ? 'text-white' : 'text-ink-900'}`}>
          ASR Vantage
        </span>
        <span className={`block text-2xs ${light ? 'text-white/55' : 'text-ink-500'}`}>
          Jazz · People &amp; Organization
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */
export function Card({
  title, subtitle, action, children, className = '', bodyClass = 'p-4',
}: {
  title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <div className="min-w-0">
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const TONES = {
  green:  'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber:  'bg-amber-50 text-amber-800 ring-amber-600/20',
  red:    'bg-red-50 text-red-700 ring-red-600/20',
  blue:   'bg-blue-50 text-blue-700 ring-blue-600/20',
  gray:   'bg-ink-100 text-ink-700 ring-ink-500/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children, className = '' }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`chip ${TONES[tone]} ${className}`}>{children}</span>;
}

export function Dot({ tone }: { tone: Tone }) {
  const c = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500', gray: 'bg-ink-400', violet: 'bg-violet-500' }[tone];
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${c}`} />;
}

export function budgetTone(status: string): Tone {
  return status === 'OVER' ? 'red' : status === 'APPROACHING' ? 'amber' : 'green';
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'SUBMITTED': case 'VALIDATED': case 'APPROVED': case 'COMPLETED': return 'green';
    case 'IN_PROGRESS': case 'IN_REVIEW': case 'PENDING_GSM': return 'blue';
    case 'RETURNED': case 'CHANGES_REQUESTED': case 'REJECTED': return 'red';
    case 'NOT_STARTED': return 'gray';
    default: return 'gray';
  }
}

export function humanStatus(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Progress / utilisation meter -------------------------------------- */
export function Meter({
  value, tone = 'green', height = 'h-2', showOverflow = true,
}: { value: number; tone?: Tone; height?: string; showOverflow?: boolean }) {
  const capped = Math.min(value, 100);
  const over = Math.max(0, Math.min(value - 100, 60));
  const bar = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500', gray: 'bg-ink-400', violet: 'bg-violet-500' }[tone];
  return (
    <div className={`w-full ${height} rounded-full bg-ink-200/70 overflow-hidden flex`}>
      <div className={`${bar} ${height} transition-all duration-300`} style={{ width: `${capped}%` }} />
      {showOverflow && over > 0 && (
        <div className={`${height} bg-red-700/80 transition-all duration-300`} style={{ width: `${over}%` }} />
      )}
    </div>
  );
}

/* KPI tile ---------------------------------------------------------- */
export function Kpi({
  label, value, sub, tone, icon, emphasis = false,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone;
  icon?: React.ReactNode; emphasis?: boolean;
}) {
  const valueTone = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700'
    : tone === 'green' ? 'text-emerald-700' : 'text-ink-900';
  return (
    <div className={`card px-4 py-3 ${emphasis ? 'ring-1 ring-jazz-600/20' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
        {icon && <span className="text-ink-400 shrink-0">{icon}</span>}
      </div>
      <p className={`mt-1.5 text-xl font-semibold tabular tracking-tight ${valueTone}`}>{value}</p>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-4">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {hint && <p className="text-xs text-ink-500 mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Th({ children, className = '', align = 'left' }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return <th className={`th ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`}>{children}</th>;
}
export function Td({ children, className = '', align = 'left', num = false, colSpan }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center'; num?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={`td ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${num ? 'tabular' : ''} ${className}`}>{children}</td>;
}

/* Section heading --------------------------------------------------- */
export function PageHeader({
  title, subtitle, actions, meta,
}: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-ink-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-ink-600 mt-0.5">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
