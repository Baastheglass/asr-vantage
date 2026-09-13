import type { TimelineStage } from '@/lib/cycle';
import { fmtDateTime } from '@/lib/cycle';

const STYLES = {
  COMPLETED: {
    ring: 'bg-emerald-500 ring-emerald-100', line: 'bg-emerald-400',
    label: 'text-ink-900', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', text: 'Completed',
  },
  IN_PROGRESS: {
    ring: 'bg-blue-500 ring-blue-100 animate-pulse', line: 'bg-ink-200',
    label: 'text-ink-900', chip: 'bg-blue-50 text-blue-700 ring-blue-600/20', text: 'In progress',
  },
  ACTION_REQUIRED: {
    ring: 'bg-amber-500 ring-amber-100', line: 'bg-ink-200',
    label: 'text-ink-900', chip: 'bg-amber-50 text-amber-800 ring-amber-600/20', text: 'Action required',
  },
  PENDING: {
    ring: 'bg-ink-300 ring-ink-100', line: 'bg-ink-200',
    label: 'text-ink-500', chip: 'bg-ink-100 text-ink-600 ring-ink-500/20', text: 'Pending',
  },
} as const;

/** Vertical workflow timeline used on the dashboard. */
export function Timeline({ stages }: { stages: TimelineStage[] }) {
  return (
    <ol className="relative">
      {stages.map((s, i) => {
        const st = STYLES[s.status];
        const last = i === stages.length - 1;
        return (
          <li key={s.stage} className="relative pl-7 pb-4 last:pb-0">
            {!last && <span className={`absolute left-[7px] top-4 bottom-0 w-0.5 ${st.line}`} />}
            <span className={`absolute left-0 top-1 w-3.5 h-3.5 rounded-full ring-4 ${st.ring}`} />
            <div className="flex flex-wrap items-center gap-2">
              <p className={`text-[13px] font-medium ${st.label}`}>{s.label}</p>
              <span className={`chip ${st.chip}`}>{st.text}</span>
            </div>
            {(s.actor || s.at) && (
              <p className="text-2xs text-ink-500 mt-0.5">
                {s.actor && <span>{s.actor}</span>}
                {s.actor && s.at && <span> · </span>}
                {s.at && <span>{fmtDateTime(s.at)}</span>}
              </p>
            )}
            {s.note && <p className="text-2xs text-ink-500 mt-0.5 italic">{s.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** Compact horizontal variant for narrow headers. */
export function TimelineStrip({ stages }: { stages: TimelineStage[] }) {
  const done = stages.filter((s) => s.status === 'COMPLETED').length;
  return (
    <div className="flex items-center gap-1.5">
      {stages.map((s) => {
        const tone = s.status === 'COMPLETED' ? 'bg-emerald-500'
          : s.status === 'IN_PROGRESS' ? 'bg-blue-500'
          : s.status === 'ACTION_REQUIRED' ? 'bg-amber-500' : 'bg-ink-200';
        return <span key={s.stage} title={`${s.label} — ${s.status}`} className={`h-1.5 flex-1 rounded-full ${tone}`} />;
      })}
      <span className="text-2xs text-ink-500 ml-1 whitespace-nowrap tabular">{done}/{stages.length}</span>
    </div>
  );
}
