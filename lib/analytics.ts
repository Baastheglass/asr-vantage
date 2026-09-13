import { db, type SessionUser } from './db';
import { employeeScope } from './rbac';
import { snapshot, statusOf, MONTHS_PER_YEAR } from './budget';

export interface AnalyticsFilter {
  divisionId?: number;
  departmentId?: number;
  gradeId?: number;
  incMin?: number;   // percentage points, e.g. 5 = 5%
  incMax?: number;
  bonusMin?: number;
  bonusMax?: number;
  budgetStatus?: string;     // WITHIN | APPROACHING | OVER
  completion?: string;       // NOT_STARTED | IN_PROGRESS | SUBMITTED
}

function buildWhere(user: SessionUser, cycleId: number, f: AnalyticsFilter) {
  const scope = employeeScope(user, 'e');
  const where = ['r.cycle_id = ?', scope.sql];
  const params: unknown[] = [cycleId, ...scope.params];

  if (f.divisionId) { where.push('e.division_id = ?'); params.push(f.divisionId); }
  if (f.departmentId) { where.push('e.department_id = ?'); params.push(f.departmentId); }
  if (f.gradeId) { where.push('e.grade_id = ?'); params.push(f.gradeId); }
  if (f.incMin != null) { where.push('r.proposed_increment_pct >= ?'); params.push(f.incMin / 100); }
  if (f.incMax != null) { where.push('r.proposed_increment_pct <= ?'); params.push(f.incMax / 100); }
  if (f.bonusMin != null) { where.push('r.proposed_bonus_amount >= ?'); params.push(f.bonusMin); }
  if (f.bonusMax != null) { where.push('r.proposed_bonus_amount <= ?'); params.push(f.bonusMax); }
  if (f.completion) { where.push('COALESCE(db.status, \'NOT_STARTED\') = ?'); params.push(f.completion); }

  return { sql: where.join(' AND '), params };
}

const BASE_JOIN = `
  FROM asr_records r
  JOIN employees e   ON e.id = r.employee_id
  JOIN job_grades g  ON g.id = e.grade_id
  JOIN divisions d   ON d.id = e.division_id
  JOIN departments p ON p.id = e.department_id
  LEFT JOIN division_budgets db ON db.cycle_id = r.cycle_id AND db.division_id = e.division_id
`;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildAnalytics(user: SessionUser, cycleId: number, f: AnalyticsFilter) {
  const w = buildWhere(user, cycleId, f);

  /* ---------------- headline ---------------- */
  const head = db.prepare(
    `SELECT COUNT(*) AS employees,
            COALESCE(SUM(r.current_salary),0)              AS payrollMonthly,
            COALESCE(SUM(r.proposed_increment_amount),0)   AS incMonthly,
            COALESCE(SUM(r.proposed_bonus_amount),0)       AS bonus,
            SUM(CASE WHEN r.proposed_increment_amount > 0 THEN 1 ELSE 0 END) AS withIncrement,
            SUM(CASE WHEN r.proposed_bonus_amount > 0 THEN 1 ELSE 0 END)     AS withBonus,
            SUM(CASE WHEN r.promotion_recommended = 1 THEN 1 ELSE 0 END)     AS promotions,
            SUM(CASE WHEN r.eligibility_promotion = 1 THEN 1 ELSE 0 END)     AS promotionEligible,
            SUM(CASE WHEN r.proposed_increment_amount = 0 AND r.proposed_bonus_amount = 0 THEN 1 ELSE 0 END) AS notReviewed,
            COALESCE(AVG(NULLIF(r.proposed_increment_pct,0)),0) AS avgIncPct,
            COALESCE(MAX(r.proposed_increment_pct),0)        AS maxIncPct
       ${BASE_JOIN} WHERE ${w.sql}`,
  ).get(...w.params) as any;

  const incPctList = (db.prepare(
    `SELECT r.proposed_increment_pct AS p ${BASE_JOIN} WHERE ${w.sql} AND r.proposed_increment_amount > 0`,
  ).all(...w.params) as { p: number }[]).map((x) => x.p);

  const bonusList = (db.prepare(
    `SELECT r.proposed_bonus_amount AS b ${BASE_JOIN} WHERE ${w.sql} AND r.proposed_bonus_amount > 0`,
  ).all(...w.params) as { b: number }[]).map((x) => x.b);

  /* allocation in scope (only divisions the filter touches) */
  const alloc = db.prepare(
    `SELECT COALESCE(SUM(allocated),0) AS allocated, COALESCE(SUM(additional),0) AS additional FROM (
       SELECT DISTINCT e.division_id,
              COALESCE(db.allocated_budget,0)    AS allocated,
              COALESCE(db.additional_approved,0) AS additional
         ${BASE_JOIN} WHERE ${w.sql})`,
  ).get(...w.params) as { allocated: number; additional: number };

  const budget = snapshot({
    allocated: alloc.allocated,
    additionalApproved: alloc.additional,
    incrementMonthly: head.incMonthly,
    bonus: head.bonus,
  });

  /* ---------------- by division ---------------- */
  const byDivision = (db.prepare(
    `SELECT d.id, d.code AS name, d.name AS full,
            COUNT(*) AS employees,
            COALESCE(SUM(r.current_salary),0) AS payrollMonthly,
            COALESCE(SUM(r.proposed_increment_amount),0) AS incMonthly,
            COALESCE(SUM(r.proposed_bonus_amount),0) AS bonus,
            MAX(COALESCE(db.allocated_budget,0)) AS allocated,
            MAX(COALESCE(db.additional_approved,0)) AS additional,
            MAX(COALESCE(db.status,'NOT_STARTED')) AS workflowStatus,
            COALESCE(AVG(NULLIF(r.proposed_increment_pct,0)),0) AS avgIncPct,
            SUM(CASE WHEN r.proposed_increment_amount > 0 OR r.proposed_bonus_amount > 0 THEN 1 ELSE 0 END) AS reviewed,
            SUM(CASE WHEN r.promotion_recommended = 1 THEN 1 ELSE 0 END) AS promotions
       ${BASE_JOIN} WHERE ${w.sql} GROUP BY d.id ORDER BY d.name`,
  ).all(...w.params) as any[]).map((r) => {
    const utilised = r.incMonthly * MONTHS_PER_YEAR + r.bonus;
    const effective = r.allocated + r.additional;
    return {
      ...r,
      allocated: effective,
      originalAllocated: r.allocated,
      utilised,
      remaining: effective - utilised,
      utilisation: effective > 0 ? (utilised / effective) * 100 : 0,
      variance: effective - utilised,
      status: statusOf(utilised, effective),
      avgIncPct: r.avgIncPct * 100,
      completionPct: r.employees ? (r.reviewed / r.employees) * 100 : 0,
      annualPayroll: r.payrollMonthly * MONTHS_PER_YEAR,
    };
  }).filter((r) => !f.budgetStatus || r.status === f.budgetStatus);

  /* ---------------- by grade ---------------- */
  const byGrade = (db.prepare(
    `SELECT g.code AS name, g.label, g.level,
            COUNT(*) AS employees,
            COALESCE(AVG(r.current_salary),0) AS avgSalary,
            COALESCE(AVG(NULLIF(r.proposed_increment_pct,0)),0) AS avgIncPct,
            COALESCE(SUM(r.proposed_increment_amount),0) AS incMonthly,
            COALESCE(SUM(r.proposed_bonus_amount),0) AS bonus,
            COALESCE(AVG(NULLIF(r.proposed_bonus_amount,0)),0) AS avgBonus,
            SUM(CASE WHEN r.proposed_increment_amount > 0 THEN 1 ELSE 0 END) AS withIncrement,
            SUM(CASE WHEN r.promotion_recommended = 1 THEN 1 ELSE 0 END) AS promotions,
            g.band_min AS bandMin, g.band_max AS bandMax
       ${BASE_JOIN} WHERE ${w.sql} GROUP BY g.id ORDER BY g.level`,
  ).all(...w.params) as any[]).map((r) => ({
    ...r,
    avgIncPct: r.avgIncPct * 100,
    cost: r.incMonthly * MONTHS_PER_YEAR + r.bonus,
    incidence: r.employees ? (r.withIncrement / r.employees) * 100 : 0,
    compaRatio: r.bandMin && r.bandMax ? (r.avgSalary / ((r.bandMin + r.bandMax) / 2)) * 100 : 0,
  }));

  /* ---------------- increment distribution ---------------- */
  const BANDS = [
    { name: '0%', min: -1, max: 0.00001 },
    { name: '0–5%', min: 0.00001, max: 0.05 },
    { name: '5–8%', min: 0.05, max: 0.08 },
    { name: '8–10%', min: 0.08, max: 0.10 },
    { name: '10–12%', min: 0.10, max: 0.12 },
    { name: '12–15%', min: 0.12, max: 0.15 },
    { name: '15–18%', min: 0.15, max: 0.18 },
    { name: '18%+', min: 0.18, max: 99 },
  ];
  const incDistribution = BANDS.map((b) => ({
    name: b.name,
    employees: (db.prepare(
      `SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${w.sql} AND r.proposed_increment_pct > ? AND r.proposed_increment_pct <= ?`,
    ).get(...w.params, b.min, b.max) as { n: number }).n,
  }));

  /* ---------------- bonus by division / department ---------------- */
  const byDepartment = (db.prepare(
    `SELECT p.id, p.name, d.name AS divisionName,
            COUNT(*) AS employees,
            COALESCE(SUM(r.proposed_increment_amount),0) AS incMonthly,
            COALESCE(SUM(r.proposed_bonus_amount),0) AS bonus,
            COALESCE(AVG(NULLIF(r.proposed_increment_pct,0)),0) AS avgIncPct,
            SUM(CASE WHEN r.proposed_increment_amount > 0 OR r.proposed_bonus_amount > 0 THEN 1 ELSE 0 END) AS reviewed
       ${BASE_JOIN} WHERE ${w.sql} GROUP BY p.id ORDER BY (SUM(r.proposed_increment_amount)*12 + SUM(r.proposed_bonus_amount)) DESC`,
  ).all(...w.params) as any[]).map((r) => ({
    ...r,
    cost: r.incMonthly * MONTHS_PER_YEAR + r.bonus,
    avgIncPct: r.avgIncPct * 100,
    completionPct: r.employees ? (r.reviewed / r.employees) * 100 : 0,
  }));

  /* ---------------- top recipients (scoped) ---------------- */
  const topIncrements = db.prepare(
    `SELECT e.name, e.emp_code AS empCode, g.code AS grade, d.name AS division, p.name AS department,
            r.proposed_increment_pct AS pct, r.proposed_increment_amount AS amount,
            r.proposed_bonus_amount AS bonus, r.promotion_recommended AS promotion,
            (r.proposed_increment_amount * 12 + r.proposed_bonus_amount) AS cost
       ${BASE_JOIN} WHERE ${w.sql} AND r.proposed_increment_amount > 0
      ORDER BY cost DESC LIMIT 15`,
  ).all(...w.params) as any[];

  /* ---------------- completion mix ---------------- */
  const completionMix = db.prepare(
    `SELECT COALESCE(db.status,'NOT_STARTED') AS status, COUNT(DISTINCT e.division_id) AS divisions
       ${BASE_JOIN} WHERE ${w.sql} GROUP BY COALESCE(db.status,'NOT_STARTED')`,
  ).all(...w.params) as { status: string; divisions: number }[];

  const reviewed = head.employees - head.notReviewed;

  return {
    headline: {
      employees: head.employees,
      annualPayroll: head.payrollMonthly * MONTHS_PER_YEAR,
      monthlyPayroll: head.payrollMonthly,
      withIncrement: head.withIncrement,
      withBonus: head.withBonus,
      incrementIncidence: head.employees ? (head.withIncrement / head.employees) * 100 : 0,
      bonusIncidence: head.employees ? (head.withBonus / head.employees) * 100 : 0,
      avgIncrementPct: head.avgIncPct * 100,
      medianIncrementPct: median(incPctList) * 100,
      maxIncrementPct: head.maxIncPct * 100,
      totalBonus: head.bonus,
      avgBonus: bonusList.length ? bonusList.reduce((a, b) => a + b, 0) / bonusList.length : 0,
      medianBonus: median(bonusList),
      promotions: head.promotions,
      promotionEligible: head.promotionEligible,
      reviewed,
      notReviewed: head.notReviewed,
      completionPct: head.employees ? (reviewed / head.employees) * 100 : 0,
      payrollIncreasePct: head.payrollMonthly ? (head.incMonthly / head.payrollMonthly) * 100 : 0,
    },
    budget,
    byDivision,
    byGrade,
    byDepartment,
    incDistribution,
    topIncrements,
    completionMix,
  };
}

/** Filter dropdown contents, scoped to the caller. */
export function analyticsOptions(user: SessionUser, cycleId: number) {
  const scope = employeeScope(user, 'e');
  const divisions = db.prepare(
    `SELECT DISTINCT d.id, d.name FROM employees e JOIN divisions d ON d.id = e.division_id
      WHERE ${scope.sql} ORDER BY d.name`,
  ).all(...scope.params) as { id: number; name: string }[];
  const departments = db.prepare(
    `SELECT DISTINCT p.id, p.name, p.division_id AS divisionId FROM employees e JOIN departments p ON p.id = e.department_id
      WHERE ${scope.sql} ORDER BY p.name`,
  ).all(...scope.params) as { id: number; name: string; divisionId: number }[];
  const grades = db.prepare(
    `SELECT DISTINCT g.id, g.code, g.label FROM employees e JOIN job_grades g ON g.id = e.grade_id
      WHERE ${scope.sql} ORDER BY g.level`,
  ).all(...scope.params) as { id: number; code: string; label: string }[];
  return { divisions, departments, grades };
}
