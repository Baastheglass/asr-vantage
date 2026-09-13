import * as XLSX from 'xlsx';
import { db } from './db';

/* ------------------------------------------------------------------ *
 * Master ASR import
 * ------------------------------------------------------------------ *
 * Reads the workbook Rewards sends, maps its columns onto the ASR data model,
 * validates every row, and then splits the population into division workspaces.
 * ------------------------------------------------------------------ */

export const FIELDS = [
  { key: 'empCode',      label: 'Employee ID',       required: true,
    aliases: ['employee id', 'emp id', 'employee code', 'emp code', 'employee no', 'staff id', 'personnel number'] },
  { key: 'name',         label: 'Employee Name',     required: true,
    aliases: ['name', 'employee name', 'full name', 'employee'] },
  { key: 'joiningDate',  label: 'Joining Date',      required: false,
    aliases: ['joining date', 'date of joining', 'doj', 'hire date', 'start date'] },
  { key: 'jobTitle',     label: 'Job Title',         required: false,
    aliases: ['job title', 'designation', 'position', 'role', 'title'] },
  { key: 'grade',        label: 'Job Grade',         required: true,
    aliases: ['job grade', 'grade', 'level', 'job level', 'band'] },
  { key: 'division',     label: 'Division',          required: true,
    aliases: ['division', 'business unit', 'function', 'group'] },
  { key: 'department',   label: 'Department',        required: false,
    aliases: ['department', 'dept', 'sub function'] },
  { key: 'subDepartment', label: 'Sub Department',   required: false,
    aliases: ['sub department', 'sub-department', 'subdepartment', 'sub dept', 'section'] },
  { key: 'lineManager',  label: 'Line Manager',      required: false,
    aliases: ['line manager', 'manager', 'reporting manager', 'supervisor'] },
  { key: 'deptHead',     label: 'Departmental Head', required: false,
    aliases: ['departmental head', 'department head', 'dept head'] },
  { key: 'divisionHead', label: 'Division Head',     required: false,
    aliases: ['division head', 'divisional head', 'head of division'] },
  { key: 'salary',       label: 'Current Gross Salary', required: true,
    aliases: ['current gross salary', 'gross salary', 'current salary', 'salary', 'monthly salary', 'basic salary'] },
  { key: 'lastPromotion', label: 'Last Promotion',   required: false,
    aliases: ['last promotion', 'last promotion date', 'promotion date'] },
  { key: 'prevAsr',      label: 'Previous ASR %',    required: false,
    aliases: ['2024 asr %', '2025 asr %', 'previous asr %', 'last asr %', 'prior increment %'] },
] as const;

export type FieldKey = (typeof FIELDS)[number]['key'];
export type Mapping = Partial<Record<FieldKey, string>>;

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[\s_\-.()]+/g, ' ').trim();

/** Best-guess mapping of sheet headers onto our fields. */
export function detectMapping(headers: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<string>();
  for (const f of FIELDS) {
    const hit = headers.find((h) => {
      if (used.has(h)) return false;
      const n = norm(h);
      return n === norm(f.label) || f.aliases.some((a) => n === norm(a));
    }) ?? headers.find((h) => {
      if (used.has(h)) return false;
      const n = norm(h);
      return f.aliases.some((a) => n.includes(norm(a)) || norm(a).includes(n));
    });
    if (hit) { m[f.key] = hit; used.add(hit); }
  }
  return m;
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, any>[];
  sheetNames: string[];
  sheetUsed: string;
}

/**
 * Reads the first sheet that actually contains a recognisable header row.
 * Rewards workbooks often carry a summary block above the data, so we scan the
 * first 25 rows for the line that looks most like a header.
 */
export function parseWorkbook(buf: Buffer): ParsedSheet {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null });

  let headerIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const row = (grid[i] ?? []).map((c) => String(c ?? '').trim());
    const filled = row.filter(Boolean).length;
    if (filled < 3) continue;
    const mapped = Object.keys(detectMapping(row.filter(Boolean))).length;
    const score = mapped * 10 + filled;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }

  const rawHeaders = (grid[headerIdx] ?? []).map((c, i) => {
    const v = String(c ?? '').replace(/\s+/g, ' ').trim();
    return v || `Column ${i + 1}`;
  });
  // de-duplicate header names so row objects don't lose columns
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });

  const rows: Record<string, any>[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    if (r.every((c) => c === null || String(c).trim() === '')) continue;
    const obj: Record<string, any> = {};
    headers.forEach((h, j) => { obj[h] = r[j] ?? null; });
    rows.push(obj);
  }

  return { headers, rows, sheetNames: wb.SheetNames, sheetUsed: sheetName };
}

export interface Issue {
  row: number;
  severity: 'ERROR' | 'WARNING';
  field: string;
  message: string;
  value?: string;
}

export interface ValidatedRow {
  empCode: string; name: string; joiningDate: string | null; jobTitle: string;
  grade: string; division: string; department: string; subDepartment: string | null;
  lineManager: string | null; deptHead: string | null; divisionHead: string | null;
  salary: number; lastPromotion: string | null; prevAsr: number;
}

function toDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toNumber(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function validateRows(rows: Record<string, any>[], mapping: Mapping) {
  const issues: Issue[] = [];
  const valid: ValidatedRow[] = [];
  const seenCodes = new Map<string, number>();

  const grades = db.prepare(`SELECT code, level FROM job_grades ORDER BY level`).all() as { code: string; level: number }[];
  const gradeCodes = new Set(grades.map((g) => g.code.toUpperCase()));

  const get = (r: Record<string, any>, k: FieldKey) => (mapping[k] ? r[mapping[k]!] : null);

  rows.forEach((r, i) => {
    const rowNum = i + 2; // 1-based, allowing for the header line
    let fatal = false;

    const empCodeRaw = get(r, 'empCode');
    const empCode = empCodeRaw == null ? '' : String(empCodeRaw).trim().replace(/\.0$/, '');
    if (!empCode) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'Employee ID', message: 'Employee ID is missing' });
      fatal = true;
    } else if (seenCodes.has(empCode)) {
      issues.push({
        row: rowNum, severity: 'ERROR', field: 'Employee ID', value: empCode,
        message: `Duplicate employee ID — already used on row ${seenCodes.get(empCode)}`,
      });
      fatal = true;
    } else {
      seenCodes.set(empCode, rowNum);
    }

    const name = String(get(r, 'name') ?? '').trim();
    if (!name) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'Name', message: 'Employee name is missing' });
      fatal = true;
    }

    let grade = String(get(r, 'grade') ?? '').trim().toUpperCase();
    if (/^\d+$/.test(grade)) grade = `L${grade}`;
    grade = grade.replace(/^LEVEL\s*/i, 'L').replace(/\s+/g, '');
    if (!grade) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'Job Grade', message: 'Job grade is missing' });
      fatal = true;
    } else if (!gradeCodes.has(grade)) {
      issues.push({
        row: rowNum, severity: 'ERROR', field: 'Job Grade', value: grade,
        message: `"${grade}" is not a recognised job grade (expected ${grades.map((g) => g.code).join(', ')})`,
      });
      fatal = true;
    }

    const division = String(get(r, 'division') ?? '').trim();
    if (!division) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'Division', message: 'Division is missing — the record cannot be routed to a workspace' });
      fatal = true;
    }

    const salary = toNumber(get(r, 'salary'));
    if (salary == null) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'Current Gross Salary', message: 'Salary is missing or not a number' });
      fatal = true;
    } else if (salary <= 0) {
      issues.push({ row: rowNum, severity: 'ERROR', field: 'Current Gross Salary', value: String(salary), message: 'Salary must be greater than zero' });
      fatal = true;
    }

    const department = String(get(r, 'department') ?? '').trim();
    if (!department) {
      issues.push({ row: rowNum, severity: 'WARNING', field: 'Department', message: 'Department is blank — the employee will be placed in a "General" department' });
    }

    const joiningDate = toDate(get(r, 'joiningDate'));
    if (!joiningDate && mapping.joiningDate) {
      issues.push({ row: rowNum, severity: 'WARNING', field: 'Joining Date', message: 'Joining date missing or unreadable — promotion eligibility cannot be calculated' });
    }

    if (fatal) return;

    let prevAsr = toNumber(get(r, 'prevAsr')) ?? 0;
    if (prevAsr > 1) prevAsr = prevAsr / 100;

    valid.push({
      empCode, name, joiningDate,
      jobTitle: String(get(r, 'jobTitle') ?? '').trim() || 'Not specified',
      grade, division,
      department: department || 'General',
      subDepartment: String(get(r, 'subDepartment') ?? '').trim() || null,
      lineManager: String(get(r, 'lineManager') ?? '').trim() || null,
      deptHead: String(get(r, 'deptHead') ?? '').trim() || null,
      divisionHead: String(get(r, 'divisionHead') ?? '').trim() || null,
      salary: salary!,
      lastPromotion: toDate(get(r, 'lastPromotion')),
      prevAsr,
    });
  });

  const byDivision = new Map<string, { count: number; payroll: number; departments: Set<string> }>();
  for (const v of valid) {
    const d = byDivision.get(v.division) ?? { count: 0, payroll: 0, departments: new Set<string>() };
    d.count++; d.payroll += v.salary; d.departments.add(v.department);
    byDivision.set(v.division, d);
  }

  return {
    issues,
    valid,
    errorCount: issues.filter((i) => i.severity === 'ERROR').length,
    warningCount: issues.filter((i) => i.severity === 'WARNING').length,
    divisions: [...byDivision.entries()]
      .map(([name, d]) => ({
        name, count: d.count,
        annualPayroll: Math.round(d.payroll * 12),
        departments: d.departments.size,
      }))
      .sort((a, b) => b.count - a.count),
    totalRows: rows.length,
    validRows: valid.length,
  };
}
