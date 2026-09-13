import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.ASR_DB_PATH || path.join(DATA_DIR, 'asr.db');

declare global {
  // eslint-disable-next-line no-var
  var __asrDb: Database.Database | undefined;
}

function connect(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

export const db: Database.Database = global.__asrDb ?? connect();
if (process.env.NODE_ENV !== 'production') global.__asrDb = db;

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ *
 * Organisational hierarchy mirrors the Rewards ASR workbook exactly:
 *   Division  -> owned by an HOD      (the unit budgets are allocated to)
 *   Department-> owned by a Director  (a Director sees only their own)
 *   Sub Department -> reporting/filter granularity only
 * ------------------------------------------------------------------ */
function migrate(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN
                    ('HR_MANAGER','HOD','DIRECTOR','GSM_PRESIDENT','REWARDS','ADMIN')),
    title         TEXT,
    division_id   INTEGER REFERENCES divisions(id),
    is_active     INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS divisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    hod_user_id INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS departments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    division_id      INTEGER NOT NULL REFERENCES divisions(id),
    code             TEXT NOT NULL UNIQUE,
    name             TEXT NOT NULL,
    director_user_id INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sub_departments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL REFERENCES departments(id),
    name          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_grades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL UNIQUE,
    level      INTEGER NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    band_min   INTEGER NOT NULL,
    band_max   INTEGER NOT NULL,
    max_merit_pct REAL NOT NULL DEFAULT 0.20
  );

  CREATE TABLE IF NOT EXISTS employees (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_code          TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    joining_date      TEXT,
    job_title         TEXT,
    grade_id          INTEGER NOT NULL REFERENCES job_grades(id),
    division_id       INTEGER NOT NULL REFERENCES divisions(id),
    department_id     INTEGER NOT NULL REFERENCES departments(id),
    sub_department_id INTEGER REFERENCES sub_departments(id),
    line_manager_code TEXT,
    line_manager_name TEXT,
    dept_head_name    TEXT,
    division_head_name TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS asr_cycles (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    year                INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'DRAFT',
    total_budget        INTEGER NOT NULL DEFAULT 0,
    source_file         TEXT,
    effective_date      TEXT,
    review_deadline     TEXT,
    created_by          INTEGER REFERENCES users(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    validated_at        TEXT,
    distributed_at      TEXT,
    hr_validated_at     TEXT,
    gsm_submitted_at    TEXT,
    gsm_decided_at      TEXT,
    rewards_submitted_at TEXT,
    completed_at        TEXT,
    frozen_snapshot     TEXT
  );

  CREATE TABLE IF NOT EXISTS asr_records (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id                 INTEGER NOT NULL REFERENCES asr_cycles(id) ON DELETE CASCADE,
    employee_id              INTEGER NOT NULL REFERENCES employees(id),
    current_salary           INTEGER NOT NULL,
    proposed_increment_pct   REAL NOT NULL DEFAULT 0,
    proposed_increment_amount INTEGER NOT NULL DEFAULT 0,
    proposed_bonus_amount    INTEGER NOT NULL DEFAULT 0,
    promotion_recommended    INTEGER NOT NULL DEFAULT 0,
    new_grade_id             INTEGER REFERENCES job_grades(id),
    eligibility_promotion    INTEGER NOT NULL DEFAULT 0,
    last_promotion_date      TEXT,
    prev_asr_pct             REAL NOT NULL DEFAULT 0,
    performance_rating       TEXT,
    remarks                  TEXT,
    status                   TEXT NOT NULL DEFAULT 'PENDING',
    is_exception             INTEGER NOT NULL DEFAULT 0,
    updated_by               INTEGER REFERENCES users(id),
    updated_at               TEXT,
    UNIQUE (cycle_id, employee_id)
  );

  CREATE TABLE IF NOT EXISTS division_budgets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id            INTEGER NOT NULL REFERENCES asr_cycles(id) ON DELETE CASCADE,
    division_id         INTEGER NOT NULL REFERENCES divisions(id),
    allocated_budget    INTEGER NOT NULL DEFAULT 0,
    additional_approved INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'NOT_STARTED',
    deadline            TEXT,
    submitted_at        TEXT,
    submitted_by        INTEGER REFERENCES users(id),
    returned_reason     TEXT,
    hr_validated_at     TEXT,
    UNIQUE (cycle_id, division_id)
  );

  CREATE TABLE IF NOT EXISTS budget_exceptions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id           INTEGER NOT NULL REFERENCES asr_cycles(id) ON DELETE CASCADE,
    division_id        INTEGER NOT NULL REFERENCES divisions(id),
    requested_by       INTEGER NOT NULL REFERENCES users(id),
    requested_amount   INTEGER NOT NULL,
    projected_utilisation REAL NOT NULL DEFAULT 0,
    justification      TEXT NOT NULL,
    employee_refs      TEXT,
    status             TEXT NOT NULL DEFAULT 'PENDING',
    decided_by         INTEGER REFERENCES users(id),
    decided_at         TEXT,
    decision_comment   TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflow_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id    INTEGER NOT NULL REFERENCES asr_cycles(id) ON DELETE CASCADE,
    division_id INTEGER REFERENCES divisions(id),
    stage       TEXT NOT NULL,
    status      TEXT NOT NULL,
    actor_id    INTEGER REFERENCES users(id),
    actor_name  TEXT,
    note        TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER NOT NULL REFERENCES asr_cycles(id) ON DELETE CASCADE,
    stage    TEXT NOT NULL,
    actor_id INTEGER REFERENCES users(id),
    actor_name TEXT,
    action   TEXT NOT NULL,
    comment  TEXT,
    at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    type       TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'info',
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id   INTEGER REFERENCES users(id),
    actor_name TEXT,
    actor_role TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  TEXT,
    before     TEXT,
    after      TEXT,
    meta       TEXT,
    at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS record_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id       INTEGER NOT NULL REFERENCES asr_records(id) ON DELETE CASCADE,
    field           TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    changed_by      INTEGER REFERENCES users(id),
    changed_by_name TEXT,
    at              TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS column_mappings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    mapping    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS validation_issues (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id  INTEGER REFERENCES asr_cycles(id) ON DELETE CASCADE,
    batch     TEXT,
    row_num   INTEGER,
    severity  TEXT NOT NULL,
    field     TEXT,
    message   TEXT NOT NULL,
    raw       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_emp_div   ON employees(division_id);
  CREATE INDEX IF NOT EXISTS idx_emp_dept  ON employees(department_id);
  CREATE INDEX IF NOT EXISTS idx_emp_grade ON employees(grade_id);
  CREATE INDEX IF NOT EXISTS idx_rec_cycle ON asr_records(cycle_id);
  CREATE INDEX IF NOT EXISTS idx_rec_emp   ON asr_records(employee_id);
  CREATE INDEX IF NOT EXISTS idx_wf_cycle  ON workflow_events(cycle_id, division_id);
  CREATE INDEX IF NOT EXISTS idx_notif     ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_audit_at  ON audit_logs(at DESC);
  CREATE INDEX IF NOT EXISTS idx_ver_rec   ON record_versions(record_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_dept_dir  ON departments(director_user_id);
  CREATE INDEX IF NOT EXISTS idx_exc_cycle ON budget_exceptions(cycle_id, status);
  `);
}

/* ------------------------------------------------------------------ *
 * Shared types
 * ------------------------------------------------------------------ */
export type Role = 'HR_MANAGER' | 'HOD' | 'DIRECTOR' | 'GSM_PRESIDENT' | 'REWARDS' | 'ADMIN';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  title: string | null;
  divisionId: number | null;
}

export const CYCLE_STAGES = [
  'ASR_RECEIVED',
  'ASR_UPLOADED',
  'DATA_VALIDATED',
  'DEPARTMENTS_DISTRIBUTED',
  'DEPARTMENT_REVIEW',
  'DEPARTMENT_SUBMISSION',
  'HR_VALIDATION',
  'GSM_APPROVAL',
  'REWARDS_REVIEW',
  'ASR_COMPLETED',
] as const;
export type CycleStage = (typeof CYCLE_STAGES)[number];

export const STAGE_LABELS: Record<CycleStage, string> = {
  ASR_RECEIVED: 'ASR Received from Rewards',
  ASR_UPLOADED: 'Master File Uploaded',
  DATA_VALIDATED: 'Data Validated',
  DEPARTMENTS_DISTRIBUTED: 'Divisions Auto-Distributed',
  DEPARTMENT_REVIEW: 'Division Review in Progress',
  DEPARTMENT_SUBMISSION: 'Division Submissions',
  HR_VALIDATION: 'HR Validation',
  GSM_APPROVAL: 'GSM President Approval',
  REWARDS_REVIEW: 'Rewards Review',
  ASR_COMPLETED: 'ASR Completed',
};

export const ROLE_LABELS: Record<Role, string> = {
  HR_MANAGER: 'HR Manager',
  HOD: 'Head of Department',
  DIRECTOR: 'Director',
  GSM_PRESIDENT: 'GSM President',
  REWARDS: 'Rewards',
  ADMIN: 'System Administrator',
};

/* ------------------------------------------------------------------ *
 * Audit + notification helpers (used by every mutating route)
 * ------------------------------------------------------------------ */
export function audit(entry: {
  actor?: SessionUser | null;
  action: string;
  entity?: string;
  entityId?: string | number;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}) {
  db.prepare(
    `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity, entity_id, before, after, meta)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    entry.actor?.id ?? null,
    entry.actor?.name ?? 'system',
    entry.actor?.role ?? 'SYSTEM',
    entry.action,
    entry.entity ?? null,
    entry.entityId != null ? String(entry.entityId) : null,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
    entry.meta === undefined ? null : JSON.stringify(entry.meta),
  );
}

export function notify(n: {
  userId: number;
  type: string;
  title: string;
  body?: string;
  link?: string;
  severity?: 'info' | 'warning' | 'critical' | 'success';
}) {
  db.prepare(
    `INSERT INTO notifications (user_id, type, severity, title, body, link)
     VALUES (?,?,?,?,?,?)`,
  ).run(n.userId, n.type, n.severity ?? 'info', n.title, n.body ?? null, n.link ?? null);
}

export function notifyRole(
  role: Role,
  n: { type: string; title: string; body?: string; link?: string; severity?: 'info' | 'warning' | 'critical' | 'success' },
) {
  const users = db.prepare(`SELECT id FROM users WHERE role = ? AND is_active = 1`).all(role) as { id: number }[];
  for (const u of users) notify({ userId: u.id, ...n });
}

export function logStage(e: {
  cycleId: number;
  divisionId?: number | null;
  stage: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'ACTION_REQUIRED' | 'REOPENED';
  actor?: SessionUser | null;
  note?: string;
}) {
  db.prepare(
    `INSERT INTO workflow_events (cycle_id, division_id, stage, status, actor_id, actor_name, note)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(e.cycleId, e.divisionId ?? null, e.stage, e.status, e.actor?.id ?? null, e.actor?.name ?? 'System', e.note ?? null);
}
