# ASR Vantage

**Annual Salary Review management platform — Jazz People & Organization**

Replaces the Excel-based ASR process: Rewards sends one master workbook, HR uploads it once,
the system validates and splits it into secure per-division workspaces, HODs and Directors
enter recommendations against a live budget that cannot be silently exceeded, and the cycle
moves through HR validation, GSM President approval and release back to Rewards — with a
complete audit trail behind every figure.

---

## Running it

```bash
cd asr-vantage
npm install
npm run seed        # builds the demo org, 1,500 employees and an in-flight ASR 2027 cycle
npm run dev         # http://localhost:4100
```

`npm run reset` wipes the database and re-seeds from scratch.

### Demo accounts — password `Jazz@2027`

| Role | Email | Sees |
|---|---|---|
| HR Manager | `hr.manager@jazz.com.pk` | Everything after upload: all 14 divisions, budget control, exceptions, audit |
| Head of Department | `hod.tech@jazz.com.pk` | Technology division only (210 employees) |
| Director | `dir.tech.nw@jazz.com.pk` | Network Engineering department only (52 employees) |
| GSM President | `gsm.president@jazz.com.pk` | Company-wide dashboard and analytics, read-only, for approval only — not the exception workflow |
| Rewards | `rewards@jazz.com.pk` | Uploads the master sheet and sets budgets; then nothing until the approved ASR is released back |

Every division has an HOD (`hod.<code>@jazz.com.pk`) and every department a Director
(`dir.<dept-code>@jazz.com.pk`) — see the `divisions` and `departments` tables for codes.

---

## The lifecycle

```
Rewards master file
   -> Rewards uploads       /upload        parse, auto-map columns, validate, set budgets
   -> HR distributes        one button     14 secure workspaces created, HODs notified
   -> Division review       /workspace/:id increments + bonuses against a live budget meter
   -> Budget exceptions     /exceptions    over-budget divisions must justify, HR decides
   -> HR validation         /approvals     readiness checks must all pass
   -> GSM approval          /approvals     approve / reject / return specific divisions
   -> Release to Rewards    /rewards       frozen immutable snapshot
```

---

## How the privacy problem is solved

The old failure mode was a password-protected workbook whose password got shared onward.
This system has no shared secret to leak:

- **Individual accounts.** Every person signs in as themselves; the session cookie is a signed
  JWT, but role and division are **re-read from the database on every request** (`lib/auth.ts`),
  so a tampered or stale token cannot escalate.
- **Row-level security in SQL.** `employeeScope()` in `lib/rbac.ts` returns a WHERE fragment
  that is ANDed into every query touching salary data. An HOD is pinned to their division; a
  Director to only the departments they are named director of. Because the restriction lives
  *inside the SQL statement*, changing a URL, editing the DOM, or hand-crafting a request
  cannot widen the result — it returns fewer rows, never someone else's.
- **Per-record write checks.** `assertCanEditRecord()` re-derives a record's division and
  department from the database before any write, and refuses writes to locked cycles.
- **Exports obey the same scope.** A Director hitting the whole-cycle export URL receives only
  their own departments, and the summary sheet names the real scope. Every export is audited.

Verified behaviour (Director account, `dir.tech.nw`):

| Attempt | Result |
|---|---|
| Read own division (210 employees) | 52 rows — only Network Engineering |
| Read another division via `?divisionId=2` | `403` |
| Drop `divisionId` entirely to get everything | still 52 rows, one department |
| `PATCH` a record in a sibling department | `403` |
| Read that record's change history | `403` |
| Submit another division | `403` |
| Export "the whole cycle" | 52 rows, scope labelled `Technology — Network Engineering` |

**Production note:** swap the local password check in `lib/auth.ts` for Microsoft Entra ID /
corporate SSO. Nothing else changes — `getSession()` is the only place identity enters the
system, and every authorisation decision already flows from it.

---

## Budget model

Budget is tracked as **annualised impact**, which is how the cost actually lands:

```
increment cost = monthly increment amount x 12
bonus cost     = one-off bonus amount
utilised       = increment cost + bonus cost
```

All of it derives from `lib/budget.ts`, so the dashboard, the workspace meter, analytics,
the exception maths and the exports can never disagree.

- Green < 90% · amber ≥ 90% · red > 100% of allocation.
- **Advisory warnings at entry time**: an increment above the grade's policy ceiling, or a
  revised salary above the grade's band maximum, both warn immediately. The budget remains the
  only hard gate.
- **Submission is blocked** while a division is over budget, or while any employee is
  unreviewed. The blockers are returned as plain sentences, not a generic error.
- **Exceptions never overwrite the Rewards allocation.** An approved top-up is stored in
  `additional_approved`, so the original figure, the approved extra and the effective budget
  all stay visible and auditable.
- **A revision does not restart the cycle.** When the GSM President requests changes they
  select which divisions to return; only those reopen, and the other divisions keep their
  completed work.

### Bulk entry

Entering 260 values one at a time would be a step backwards from Excel, so the workspace
supports applying one decision to many people:

- Tick individual rows, or leave everything unticked to act on **every employee matching the
  current filters** (the count is shown before you confirm).
- **Set increment %** — each person's PKR amount is derived from their own salary.
- **Set bonus** / **Set rating** — one value across the selection.
- **Mark as no increment** — records a deliberate decision of zero, which clears employees who
  would otherwise block submission.
- **Enter** in a cell saves and jumps to the row below, like a spreadsheet.

Targets are resolved server-side through the caller's scope, so "apply to all" can never reach a
record the caller may not edit — a Director asking for a whole division still only touches their
own departments. Every individual change writes its own version-history row.

### Login throttling

Five failed attempts on one account, or twenty from one IP within 15 minutes, locks sign-in for
15 minutes (`lib/ratelimit.ts`). Blocked attempts are audited. State is in memory, which suits a
single server; behind multiple instances move it to Redis.

---

## Screens

| Route | Who | What |
|---|---|---|
| `/dashboard` | HR, GSM | KPI tiles, live division budget table, workflow timeline, utilisation chart, attention list |
| `/upload` | Rewards | 4-step wizard: upload → validate & map → allocate budget → send to HR |
| `/workspace` | HR, HOD, Director | Division list, or straight into the one workspace you own |
| `/workspace/:id` | HR, HOD, Director | Server-paginated employee table, inline entry, live budget bar, per-record change history |
| `/exceptions` | HR, HOD | Exception queue with approve / reject / request clarification (not visible to the GSM President) |
| `/analytics` | HR, HOD, GSM | Budget, increment, bonus, grade, department and completion analysis with 8 filters |
| `/approvals` | HR, GSM | Readiness checks, proceed-to-GSM, GSM decision, approval history |
| `/rewards` | Rewards, HR | Frozen final ASR — inaccessible until released |
| `/audit` | HR | Append-only log of every action, searchable and filterable |
| `/notifications` | all | Assignments, deadlines, budget alerts, approval activity |

---

## Data model

`lib/db.ts` creates the whole schema on first run.

```
users ── divisions ── departments ── sub_departments
                 └─ employees ── job_grades
asr_cycles ── asr_records ── record_versions
           ├─ division_budgets
           ├─ budget_exceptions
           ├─ workflow_events / approvals
           └─ validation_issues
notifications · audit_logs · column_mappings
```

- **Version history** — every changed field on a record writes an immutable
  `record_versions` row (field, old value, new value, who, when), surfaced by the ↺ button on
  each workspace row.
- **Audit log** — every upload, edit, exception, approval, export and login attempt, with
  before/after values.
- **Column mappings** are remembered, so next year's upload auto-maps.

SQLite in WAL mode with indexes on every scope column; 1,500 records paginate server-side.
The schema is unchanged for a repeat cycle — a new `asr_cycles` row reuses the same org tree.

---

## Excel import

`lib/import.ts` scans the first 25 rows for the real header line (Rewards workbooks often
carry a summary block above the data), de-duplicates header names, and matches 14 fields
against a list of aliases. On the seeded master file it maps 13 of 14 columns with no help.

Validation blocks the import on: missing or duplicate employee IDs, missing names, missing
divisions, unrecognised job grades, and missing or non-numeric salaries. Blank departments and
unreadable joining dates are warnings. Rows with errors are listed with row numbers and are
never imported; warnings are stored against the cycle.

A ready-to-use master workbook is written to `data/Master-ASR-2027-Rewards.xlsx` by the seed.

---

---

## Giving other people access

### Same office / same WiFi (works right now)

The dev server already listens on the network. While it is running, anyone on the same WiFi
opens the **Network URL** printed when it starts, for example:

```
http://192.168.100.166:4100
```

Run `ipconfig getifaddr en0` to get the current address — it changes between networks. This is
fine for a demo to your manager; it is not a deployment.

### Real deployment

For actual use it needs to run on an always-on machine or server rather than a laptop:

1. `npm run build` then `npm start` (or a process manager such as `pm2`).
2. **Set `ASR_SESSION_SECRET`** to a long random value — otherwise sessions reset when the app
   restarts.
3. Put it behind **HTTPS**. Salary data must never travel over plain HTTP.
4. Back up `data/asr.db` — that single file is the entire system of record.
5. Ideally swap the password login for **Microsoft Entra ID / corporate SSO**. Identity enters
   the system in exactly one place (`getSession()` in `lib/auth.ts`), so nothing else changes.

## Managing accounts

**User Management** in the sidebar (HR Manager and Admin only) — no code or scripts needed.

- **Add person** — name, corporate email (this is their username), role, and a temporary password.
- **Role** decides what they see. Assigning an **HOD** to a division gives them that division and
  replaces whoever currently heads it. A **Director** must be ticked against specific departments,
  otherwise they see nothing.
- **Edit** — rename someone, change their title, move them to a different division, change their
  role, or reset their password.
- **Deactivate** — access is revoked immediately, including any session they already have open,
  because role and status are re-read from the database on every request. Their history stays in
  the audit trail. Accounts are never deleted.
- Guard rails: you cannot deactivate your own account, change your own role, or remove the last
  active HR Manager. Every change is written to the audit trail.

### Staff accounts vs employee records

Two different things:

- **Accounts** (User Management) — the handful of people who log in: HR, HODs, Directors, the GSM
  President, Rewards.
- **Employees** (the 1,500 in the ASR) — these come from the Excel file Rewards sends and are
  refreshed on every upload. To correct an employee's name or grade, fix it in the source
  workbook; it is Rewards' data, not the app's.

## Stack

Next.js 15 (App Router, React 19) · TypeScript · SQLite via better-sqlite3 · Tailwind ·
Recharts · SheetJS · jose + bcryptjs.

Chart colours follow a validated palette. Budget status uses reserved status colours
(green/amber/red) that are **never the only carrier of meaning** — every bar is direct-labelled
with its utilisation figure and a reference line marks the 100% boundary, because green-vs-red
is indistinguishable under deuteranopia.

## Branding

`components/ui.tsx` draws a placeholder wordmark in Jazz brand red. To use the official asset,
drop it at `public/jazz-logo.svg` and replace the inline `<svg>` in `JazzLogo` with
`<img src="/jazz-logo.svg" alt="Jazz" />`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ASR_SESSION_SECRET` | generated into `data/.session-secret` | JWT signing key — **set this explicitly in production** |
| `ASR_DB_PATH` | `data/asr.db` | Database location |

Demo data contains no real employee or salary information.
