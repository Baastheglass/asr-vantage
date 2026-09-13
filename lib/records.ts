import { db, type SessionUser } from './db';
import { employeeScope } from './rbac';

export interface RecordQuery {
  cycleId: number;
  divisionId?: number;
  search?: string;
  gradeId?: number;
  departmentId?: number;
  subDepartmentId?: number;
  status?: string;         // reviewed | pending | promotion | exception
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface RecordRow {
  id: number;
  employeeId: number;
  empCode: string;
  name: string;
  jobTitle: string;
  gradeCode: string;
  gradeLabel: string;
  gradeLevel: number;
  maxMeritPct: number;
  bandMin: number;
  bandMax: number;
  divisionId: number;
  divisionName: string;
  departmentId: number;
  departmentName: string;
  subDepartment: string | null;
  joiningDate: string | null;
  currentSalary: number;
  incrementPct: number;
  incrementAmount: number;
  bonusAmount: number;
  promotionRecommended: number;
  eligibilityPromotion: number;
  lastPromotionDate: string | null;
  prevAsrPct: number;
  performanceRating: string | null;
  remarks: string | null;
  status: string;
  revisedSalary: number;
  annualisedCost: number;
  updatedAt: string | null;
}

const SORTS: Record<string, string> = {
  name: 'e.name',
  empCode: 'e.emp_code',
  grade: 'g.level',
  salary: 'r.current_salary',
  increment: 'r.proposed_increment_pct',
  bonus: 'r.proposed_bonus_amount',
  department: 'p.name',
  updated: 'r.updated_at',
};

/**
 * Server-side paginated, filtered record fetch. The caller's scope fragment is
 * always ANDed into the WHERE clause, so a Director asking for another
 * department's divisionId simply gets zero rows rather than someone else's data.
 */
export function queryRecords(user: SessionUser, q: RecordQuery) {
  const scope = employeeScope(user, 'e');
  const where: string[] = ['r.cycle_id = ?', scope.sql];
  const params: unknown[] = [q.cycleId, ...scope.params];

  if (q.divisionId) { where.push('e.division_id = ?'); params.push(q.divisionId); }
  if (q.departmentId) { where.push('e.department_id = ?'); params.push(q.departmentId); }
  if (q.subDepartmentId) { where.push('e.sub_department_id = ?'); params.push(q.subDepartmentId); }
  if (q.gradeId) { where.push('e.grade_id = ?'); params.push(q.gradeId); }
  if (q.search) {
    where.push('(e.name LIKE ? OR e.emp_code LIKE ? OR e.job_title LIKE ?)');
    const s = `%${q.search}%`;
    params.push(s, s, s);
  }
  switch (q.status) {
    case 'reviewed':  where.push('(r.proposed_increment_amount > 0 OR r.proposed_bonus_amount > 0)'); break;
    case 'pending':   where.push('(r.proposed_increment_amount = 0 AND r.proposed_bonus_amount = 0)'); break;
    case 'promotion': where.push('r.promotion_recommended = 1'); break;
    case 'eligible':  where.push('r.eligibility_promotion = 1'); break;
    case 'exception': where.push('r.is_exception = 1'); break;
  }

  const whereSql = where.join(' AND ');
  const orderCol = SORTS[q.sort ?? 'name'] ?? 'e.name';
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  const pageSize = Math.min(Math.max(q.pageSize ?? 50, 10), 200);
  const page = Math.max(q.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM asr_records r
       JOIN employees e ON e.id = r.employee_id
      WHERE ${whereSql}`,
  ).get(...params) as { n: number }).n;

  const rows = db.prepare(
    `SELECT r.id, r.employee_id AS employeeId, e.emp_code AS empCode, e.name, e.job_title AS jobTitle,
            g.code AS gradeCode, g.label AS gradeLabel, g.level AS gradeLevel,
            g.max_merit_pct AS maxMeritPct, g.band_min AS bandMin, g.band_max AS bandMax,
            e.division_id AS divisionId, d.name AS divisionName,
            e.department_id AS departmentId, p.name AS departmentName,
            sd.name AS subDepartment, e.joining_date AS joiningDate,
            r.current_salary AS currentSalary,
            r.proposed_increment_pct AS incrementPct,
            r.proposed_increment_amount AS incrementAmount,
            r.proposed_bonus_amount AS bonusAmount,
            r.promotion_recommended AS promotionRecommended,
            r.eligibility_promotion AS eligibilityPromotion,
            r.last_promotion_date AS lastPromotionDate,
            r.prev_asr_pct AS prevAsrPct,
            r.performance_rating AS performanceRating,
            r.remarks, r.status, r.updated_at AS updatedAt
       FROM asr_records r
       JOIN employees e  ON e.id = r.employee_id
       JOIN job_grades g ON g.id = e.grade_id
       JOIN divisions d  ON d.id = e.division_id
       JOIN departments p ON p.id = e.department_id
       LEFT JOIN sub_departments sd ON sd.id = e.sub_department_id
      WHERE ${whereSql}
      ORDER BY ${orderCol} ${dir}, e.id ASC
      LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset) as any[];

  const data: RecordRow[] = rows.map((r) => ({
    ...r,
    revisedSalary: r.currentSalary + r.incrementAmount,
    annualisedCost: r.incrementAmount * 12 + r.bonusAmount,
  }));

  return { data, total, page, pageSize, pages: Math.ceil(total / pageSize) || 1 };
}

/** Filter option lists, themselves scoped so a Director never learns other department names. */
export function filterOptions(user: SessionUser, cycleId: number, divisionId?: number) {
  const scope = employeeScope(user, 'e');
  const params: unknown[] = [...scope.params];
  let extra = '';
  if (divisionId) { extra = ' AND e.division_id = ?'; params.push(divisionId); }

  const departments = db.prepare(
    `SELECT DISTINCT p.id, p.name FROM employees e JOIN departments p ON p.id = e.department_id
      WHERE ${scope.sql}${extra} ORDER BY p.name`,
  ).all(...params) as { id: number; name: string }[];

  const subDepartments = db.prepare(
    `SELECT DISTINCT sd.id, sd.name FROM employees e JOIN sub_departments sd ON sd.id = e.sub_department_id
      WHERE ${scope.sql}${extra} ORDER BY sd.name`,
  ).all(...params) as { id: number; name: string }[];

  const grades = db.prepare(
    `SELECT DISTINCT g.id, g.code, g.label, g.level FROM employees e JOIN job_grades g ON g.id = e.grade_id
      WHERE ${scope.sql}${extra} ORDER BY g.level`,
  ).all(...params) as { id: number; code: string; label: string; level: number }[];

  return { departments, subDepartments, grades };
}
