import { db, type SessionUser, CYCLE_STAGES, type CycleStage, STAGE_LABELS } from './db';

export interface Cycle {
  id: number;
  name: string;
  year: number;
  status: string;
  total_budget: number;
  source_file: string | null;
  effective_date: string | null;
  review_deadline: string | null;
  created_at: string;
  validated_at: string | null;
  distributed_at: string | null;
  hr_validated_at: string | null;
  gsm_submitted_at: string | null;
  gsm_decided_at: string | null;
  rewards_submitted_at: string | null;
  completed_at: string | null;
  frozen_snapshot: string | null;
}

/** The cycle the app is currently working on — most recent non-archived. */
export function activeCycle(): Cycle | null {
  return (db
    .prepare(`SELECT * FROM asr_cycles ORDER BY year DESC, id DESC LIMIT 1`)
    .get() as Cycle | undefined) ?? null;
}

export function getCycle(id: number): Cycle | null {
  return (db.prepare(`SELECT * FROM asr_cycles WHERE id = ?`).get(id) as Cycle | undefined) ?? null;
}

export interface TimelineStage {
  stage: CycleStage;
  label: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'ACTION_REQUIRED';
  actor: string | null;
  at: string | null;
  note: string | null;
}

/**
 * Derives the workflow timeline from recorded events plus the live state of the
 * cycle, so a stage that is reopened (for example after GSM requests changes)
 * correctly falls back to "in progress" rather than staying green.
 */
export function timeline(cycleId: number): TimelineStage[] {
  const cycle = getCycle(cycleId);
  const events = db
    .prepare(
      `SELECT stage, status, actor_name, note, at FROM workflow_events
        WHERE cycle_id = ? AND division_id IS NULL ORDER BY id ASC`,
    )
    .all(cycleId) as { stage: string; status: string; actor_name: string; note: string | null; at: string }[];

  const latest = new Map<string, { status: string; actor: string; note: string | null; at: string }>();
  for (const e of events) {
    latest.set(e.stage, { status: e.status, actor: e.actor_name, note: e.note, at: e.at });
  }

  const divStats = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END) AS submitted
         FROM division_budgets WHERE cycle_id = ?`,
    )
    .get(cycleId) as { total: number; submitted: number };

  const st = cycle?.status ?? 'DRAFT';

  return CYCLE_STAGES.map((stage) => {
    const rec = latest.get(stage);
    let status: TimelineStage['status'] = rec
      ? (rec.status === 'REOPENED' ? 'IN_PROGRESS' : (rec.status as TimelineStage['status']))
      : 'PENDING';

    // Live overrides for the stages that depend on current state
    if (stage === 'DEPARTMENT_SUBMISSION') {
      if (divStats.total > 0 && divStats.submitted === divStats.total) status = 'COMPLETED';
      else if (divStats.submitted > 0) status = 'IN_PROGRESS';
    }
    if (stage === 'DEPARTMENT_REVIEW' && divStats.submitted === divStats.total && divStats.total > 0) {
      status = 'COMPLETED';
    }
    if (stage === 'HR_VALIDATION' && cycle?.hr_validated_at) status = 'COMPLETED';
    if (stage === 'GSM_APPROVAL') {
      if (cycle?.gsm_decided_at && st !== 'CHANGES_REQUESTED') status = 'COMPLETED';
      else if (st === 'PENDING_GSM') status = 'ACTION_REQUIRED';
      else if (st === 'CHANGES_REQUESTED') status = 'ACTION_REQUIRED';
    }
    if (stage === 'REWARDS_REVIEW' && cycle?.rewards_submitted_at) status = 'COMPLETED';
    if (stage === 'ASR_COMPLETED' && cycle?.completed_at) status = 'COMPLETED';

    return {
      stage,
      label: STAGE_LABELS[stage],
      status,
      actor: rec?.actor ?? null,
      at: rec?.at ?? null,
      note: rec?.note ?? null,
    };
  });
}

export function unreadCount(user: SessionUser): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0`)
    .get(user.id) as { n: number };
  return r.n;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z') : s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z') : s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
