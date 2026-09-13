/**
 * Seeds a complete, believable ASR environment:
 *   - Jazz-style org (14 divisions -> departments -> sub-departments)
 *   - 6 job grades with salary bands
 *   - 1,500 employees, no real salary data
 *   - one user per role, per division and per department
 *   - an in-flight ASR 2027 cycle with mixed progress so every dashboard,
 *     alert and exception path has something real to show on first login
 *   - data/Master-ASR-2027-Rewards.xlsx so the upload journey can be run too
 */
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../lib/db';

const PASSWORD = 'Jazz@2027';

let rngState = 20270101;
function rnd() {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const intBetween = (a: number, b: number) => Math.floor(between(a, b + 1));

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */
const MALE = ['Muhammad','Ahmed','Ali','Usman','Bilal','Hamza','Hassan','Imran','Junaid','Kamran','Khurram','Adnan','Asad','Faisal','Farhan','Fawad','Haris','Ibrahim','Irfan','Jawad','Kashif','Nadeem','Naveed','Noman','Owais','Qasim','Rizwan','Saad','Salman','Shahzad','Shoaib','Sohail','Talha','Tanveer','Taimoor','Umer','Waqas','Yasir','Zeeshan','Zohaib','Amjad','Arsalan','Azhar','Danish','Fahad','Haroon','Iftikhar','Javed','Khalid','Mansoor','Moiz','Mubashir','Nabeel','Nasir','Raheel','Rashid','Rehan','Sajjad','Saqib','Shahid','Sheraz','Tahir','Tariq','Umair','Waseem','Yousaf','Zahid','Zubair','Aamir','Asim','Atif','Basit','Faheem','Hammad','Kaleem','Luqman','Naeem','Rafiq','Shakeel','Suleman','Usama','Waleed','Zaheer','Aqib','Arif','Babar','Daniyal','Hamid','Hashim','Jamil','Nauman','Rameez','Shahbaz','Taha','Waqar','Zain','Mudassir','Ehtesham','Obaid','Sameer'];
const FEMALE = ['Ayesha','Sundas','Fatima','Hira','Maryam','Nida','Sana','Sadia','Mehwish','Amna','Anum','Bushra','Farah','Hina','Iqra','Javeria','Kiran','Komal','Laiba','Madiha','Mahnoor','Nazia','Noor','Rabia','Saba','Samina','Shazia','Sidra','Sumaira','Tehmina','Uzma','Zainab','Aiman','Areeba','Asma','Faiza','Humaira','Kanwal','Lubna','Mahreen','Nayab','Rimsha','Sehrish','Tooba','Warda','Yusra','Anila','Beenish','Erum','Fariha'];
const MID = ['Ahmed','Ali','Hussain','Khan','Raza','Abbas','Nawaz','Aslam','Ashraf','Mehmood','Akram','Anwar','Bashir','Farooq','Hameed','Iqbal','Jamal','Kamal','Latif','Majeed','Nazir','Qadir','Rasheed','Sarwar','Shabbir','Tufail','Waheed','Yaqoob','Zaman','','','','',''];
const LAST = ['Khan','Butt','Cheema','Chaudhry','Malik','Mirza','Qureshi','Sheikh','Siddiqui','Bhatti','Dar','Gondal','Hashmi','Janjua','Kiyani','Lodhi','Memon','Niazi','Rana','Sial','Tarar','Virk','Warraich','Zaidi','Abbasi','Afridi','Ansari','Awan','Baig','Bajwa','Durrani','Farooqui','Ghumman','Hameed','Hanif','Jatoi','Kazmi','Khokhar','Mahmood','Maqsood','Mughal','Naqvi','Pasha','Rehman','Riaz','Saleem','Sandhu','Shah','Shahzad','Soomro','Sultan','Tahir','Toor','Usmani','Wattoo','Yousafzai','Zafar','Ejaz','Mushtaq','Mujtaba','Warsi','Hamdani','Anjum','Tayyab'];

const usedNames = new Set<string>();
function makeName(female = rnd() < 0.24): string {
  for (let i = 0; i < 500; i++) {
    const parts = [pick(female ? FEMALE : MALE), pick(MID), pick(LAST)].filter(Boolean);
    let n = parts.join(' ');
    if (female && rnd() < 0.12) n = 'Syeda ' + n;
    if (!usedNames.has(n)) { usedNames.add(n); return n; }
  }
  const n = `${pick(MALE)} ${pick(LAST)} ${usedNames.size}`;
  usedNames.add(n);
  return n;
}

/* ------------------------------------------------------------------ */
/* Org design                                                          */
/* ------------------------------------------------------------------ */
interface DeptDef { code: string; name: string; subs: string[] }
interface DivDef { code: string; name: string; headcount: number; depts: DeptDef[] }

const ORG: DivDef[] = [
  { code: 'TECH', name: 'Technology', headcount: 210, depts: [
    { code: 'TECH-NW', name: 'Network Engineering', subs: ['Radio Access','Core Network','Transmission'] },
    { code: 'TECH-IT', name: 'IT & Platforms', subs: ['Enterprise Apps','Infrastructure','Service Desk'] },
    { code: 'TECH-SEC', name: 'Information Security', subs: ['SecOps','GRC'] },
    { code: 'TECH-DATA', name: 'Data & AI', subs: ['Data Engineering','Analytics Platform'] },
  ]},
  { code: 'COMM', name: 'Commercial', headcount: 260, depts: [
    { code: 'COMM-CA', name: 'Region Central A', subs: ['Region C1','Region C2','Region C3'] },
    { code: 'COMM-CB', name: 'Region Central B', subs: ['Region C4','Region C5','Region C6'] },
    { code: 'COMM-CC', name: 'Region Central C', subs: ['Region C7','Region C8'] },
    { code: 'COMM-CD', name: 'Region Central D', subs: ['Region C9','Region C10'] },
  ]},
  { code: 'CXO', name: 'Customer Operations', headcount: 200, depts: [
    { code: 'CXO-CC', name: 'Contact Centre', subs: ['Inbound','Outbound','Social Care'] },
    { code: 'CXO-EXP', name: 'Customer Experience', subs: ['Journey Design','Quality Assurance'] },
    { code: 'CXO-RET', name: 'Retail Operations', subs: ['Franchise','Company Owned'] },
  ]},
  { code: 'DFS', name: 'Digital & Financial Services', headcount: 130, depts: [
    { code: 'DFS-PROD', name: 'Product Management', subs: ['Wallet','Merchant'] },
    { code: 'DFS-RISK', name: 'Risk & Compliance', subs: ['AML','Fraud'] },
    { code: 'DFS-GTM', name: 'Go To Market', subs: ['Agent Network','Partnerships'] },
  ]},
  { code: 'NOC', name: 'Network Operations', headcount: 120, depts: [
    { code: 'NOC-FLD', name: 'Field Operations', subs: ['North','Central','South'] },
    { code: 'NOC-MON', name: 'Monitoring & Assurance', subs: ['NOC Tier 1','NOC Tier 2'] },
  ]},
  { code: 'FIN', name: 'Finance', headcount: 110, depts: [
    { code: 'FIN-CTRL', name: 'Controlling & Reporting', subs: ['Financial Reporting','Management Reporting'] },
    { code: 'FIN-TRS', name: 'Treasury & Tax', subs: ['Treasury','Taxation'] },
    { code: 'FIN-PROC', name: 'Procurement', subs: ['Sourcing','Vendor Management'] },
  ]},
  { code: 'EB', name: 'Enterprise Business', headcount: 105, depts: [
    { code: 'EB-SALES', name: 'Enterprise Sales', subs: ['Public Sector','Corporate'] },
    { code: 'EB-SOL', name: 'Solutions Engineering', subs: ['IoT','Connectivity'] },
  ]},
  { code: 'MKT', name: 'Marketing', headcount: 95, depts: [
    { code: 'MKT-BRD', name: 'Brand & Communications', subs: ['Brand','Media'] },
    { code: 'MKT-SEG', name: 'Segment Marketing', subs: ['Prepaid','Postpaid'] },
  ]},
  { code: 'SCM', name: 'Supply Chain', headcount: 70, depts: [
    { code: 'SCM-LOG', name: 'Logistics & Warehousing', subs: ['Warehouse','Distribution'] },
    { code: 'SCM-PLN', name: 'Demand Planning', subs: ['Planning'] },
  ]},
  { code: 'P&O', name: 'People & Organization', headcount: 55, depts: [
    { code: 'PO-TA', name: 'Talent Acquisition', subs: ['Sourcing','Campus'] },
    { code: 'PO-REW', name: 'Rewards & Operations', subs: ['Rewards','HR Operations'] },
    { code: 'PO-LD', name: 'Learning & Development', subs: ['Capability Building'] },
  ]},
  { code: 'CA', name: 'Corporate Affairs', headcount: 40, depts: [
    { code: 'CA-GOV', name: 'Government Relations', subs: ['Regulatory Affairs'] },
    { code: 'CA-CSR', name: 'Sustainability & CSR', subs: ['CSR Programmes'] },
  ]},
  { code: 'S&T', name: 'Strategy & Transformation', headcount: 40, depts: [
    { code: 'ST-STR', name: 'Corporate Strategy', subs: ['Strategy'] },
    { code: 'ST-PMO', name: 'Transformation PMO', subs: ['Programme Delivery'] },
  ]},
  { code: 'LEG', name: 'Legal & Regulatory', headcount: 35, depts: [
    { code: 'LEG-CORP', name: 'Corporate Legal', subs: ['Contracts','Litigation'] },
    { code: 'LEG-REG', name: 'Regulatory Compliance', subs: ['Compliance'] },
  ]},
  { code: 'IA', name: 'Internal Audit', headcount: 30, depts: [
    { code: 'IA-OPS', name: 'Operational Audit', subs: ['Field Audit'] },
    { code: 'IA-FIN', name: 'Financial Audit', subs: ['Finance Audit'] },
  ]},
];

const GRADES = [
  { code: 'L1', level: 1, label: 'Associate',        min: 85_000,  max: 150_000,  maxMerit: 0.20 },
  { code: 'L2', level: 2, label: 'Senior Associate', min: 140_000, max: 235_000,  maxMerit: 0.18 },
  { code: 'L3', level: 3, label: 'Manager',          min: 225_000, max: 385_000,  maxMerit: 0.16 },
  { code: 'L4', level: 4, label: 'Senior Manager',   min: 375_000, max: 630_000,  maxMerit: 0.15 },
  { code: 'L5', level: 5, label: 'Director',         min: 610_000, max: 1_050_000, maxMerit: 0.14 },
  { code: 'L6', level: 6, label: 'Vice President',   min: 1_020_000, max: 1_900_000, maxMerit: 0.12 },
];
const GRADE_MIX = [0.40, 0.28, 0.18, 0.09, 0.04, 0.01];

const TITLES: Record<number, string[]> = {
  1: ['Associate Engineer','Sales Officer','Customer Care Associate','Finance Associate','HR Associate','Analyst','Executive','Field Officer','Support Associate'],
  2: ['Senior Associate','Senior Engineer','Territory Sales Executive','Senior Analyst','Specialist','Team Lead','Senior Executive'],
  3: ['Manager','Area Sales Manager','Engineering Manager','Product Manager','Finance Manager','HR Business Partner','Project Manager'],
  4: ['Senior Manager','Regional Sales Manager','Head of Function','Principal Engineer','Senior Product Manager'],
  5: ['Director','Regional Director','Head of Department','Divisional Director'],
  6: ['Vice President','Chief Specialist','Group Head'],
};

/* ------------------------------------------------------------------ */
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
}

async function main() {
  console.log('Resetting tables...');
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM record_versions; DELETE FROM audit_logs; DELETE FROM notifications;
    DELETE FROM approvals; DELETE FROM workflow_events; DELETE FROM budget_exceptions;
    DELETE FROM division_budgets; DELETE FROM asr_records; DELETE FROM asr_cycles;
    DELETE FROM validation_issues; DELETE FROM column_mappings;
    DELETE FROM employees; DELETE FROM sub_departments; DELETE FROM departments;
    DELETE FROM users; DELETE FROM divisions; DELETE FROM job_grades;
    DELETE FROM sqlite_sequence;
    PRAGMA foreign_keys = ON;
  `);

  const hash = await bcrypt.hash(PASSWORD, 10);

  /* grades */
  const gradeId: Record<string, number> = {};
  for (const g of GRADES) {
    const r = db.prepare(
      `INSERT INTO job_grades (code, level, label, band_min, band_max, max_merit_pct) VALUES (?,?,?,?,?,?)`,
    ).run(g.code, g.level, g.label, g.min, g.max, g.maxMerit);
    gradeId[g.code] = Number(r.lastInsertRowid);
  }

  /* divisions + departments */
  const insUser = db.prepare(
    `INSERT INTO users (email, name, password_hash, role, title, division_id) VALUES (?,?,?,?,?,?)`,
  );
  const divId: Record<string, number> = {};
  const deptId: Record<string, number> = {};
  const subIds: Record<string, number[]> = {};

  for (const d of ORG) {
    const r = db.prepare(`INSERT INTO divisions (code, name) VALUES (?,?)`).run(d.code, d.name);
    divId[d.code] = Number(r.lastInsertRowid);
  }

  /* core users */
  const hrId = Number(insUser.run('hr.manager@jazz.com.pk', 'Ayesha Tariq Malik', hash, 'HR_MANAGER', 'Manager, People & Organization', null).lastInsertRowid);
  const gsmId = Number(insUser.run('gsm.president@jazz.com.pk', 'Kamran Shahid Qureshi', hash, 'GSM_PRESIDENT', 'President & Group Senior Manager', null).lastInsertRowid);
  const rewId = Number(insUser.run('rewards@jazz.com.pk', 'Nida Hassan Baig', hash, 'REWARDS', 'Lead, Total Rewards', null).lastInsertRowid);
  insUser.run('admin@jazz.com.pk', 'System Administrator', hash, 'ADMIN', 'Platform Administrator', null);

  /* HOD per division, Director per department */
  for (const d of ORG) {
    const hodName = makeName(rnd() < 0.3);
    const hodId = Number(insUser.run(`hod.${slug(d.code)}@jazz.com.pk`, hodName, hash, 'HOD', `Head of ${d.name}`, divId[d.code]).lastInsertRowid);
    db.prepare(`UPDATE divisions SET hod_user_id = ? WHERE id = ?`).run(hodId, divId[d.code]);

    for (const dept of d.depts) {
      const dr = db.prepare(`INSERT INTO departments (division_id, code, name) VALUES (?,?,?)`)
        .run(divId[d.code], dept.code, dept.name);
      deptId[dept.code] = Number(dr.lastInsertRowid);

      const dirName = makeName(rnd() < 0.3);
      const dirId = Number(insUser.run(`dir.${slug(dept.code)}@jazz.com.pk`, dirName, hash, 'DIRECTOR', `Director, ${dept.name}`, divId[d.code]).lastInsertRowid);
      db.prepare(`UPDATE departments SET director_user_id = ? WHERE id = ?`).run(dirId, deptId[dept.code]);

      subIds[dept.code] = dept.subs.map((s) =>
        Number(db.prepare(`INSERT INTO sub_departments (department_id, name) VALUES (?,?)`).run(deptId[dept.code], s).lastInsertRowid),
      );
    }
  }

  /* employees */
  console.log('Generating 1,500 employees...');
  const insEmp = db.prepare(
    `INSERT INTO employees (emp_code, name, joining_date, job_title, grade_id, division_id,
       department_id, sub_department_id, line_manager_code, line_manager_name,
       dept_head_name, division_head_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const usedCodes = new Set<string>();
  function empCode(joinYear: number) {
    for (;;) {
      const n = joinYear <= 2016 ? intBetween(4200, 13999)
        : joinYear <= 2021 ? intBetween(120000, 148999)
        : intBetween(155000, 179999);
      const c = String(n);
      if (!usedCodes.has(c)) { usedCodes.add(c); return c; }
    }
  }

  const employees: any[] = [];
  const seedEmployees = db.transaction(() => {
    for (const d of ORG) {
      const hodName = db.prepare(`SELECT u.name FROM users u JOIN divisions v ON v.hod_user_id=u.id WHERE v.id=?`).get(divId[d.code]) as { name: string };
      // grade counts for this division
      const counts = GRADE_MIX.map((p) => Math.round(d.headcount * p));
      let diff = d.headcount - counts.reduce((a, b) => a + b, 0);
      counts[0] += diff;

      const perDept = Math.floor(d.headcount / d.depts.length);
      let assigned = 0;
      const pool: { gi: number }[] = [];
      counts.forEach((c, gi) => { for (let i = 0; i < c; i++) pool.push({ gi }); });
      // shuffle
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

      for (const item of pool) {
        const di = Math.min(Math.floor(assigned / perDept), d.depts.length - 1);
        const dept = d.depts[di];
        assigned++;

        const g = GRADES[item.gi];
        const dirName = db.prepare(`SELECT u.name FROM users u JOIN departments p ON p.director_user_id=u.id WHERE p.id=?`).get(deptId[dept.code]) as { name: string };
        const earliest = [2008, 2008, 2006, 2005, 2003, 2001][item.gi];
        const latest = [2026, 2026, 2025, 2024, 2022, 2020][item.gi];
        const jy = intBetween(earliest, latest);
        const jd = `${jy}-${String(intBetween(1, 12)).padStart(2, '0')}-${String(intBetween(1, 28)).padStart(2, '0')}`;

        const e = {
          code: empCode(jy),
          name: makeName(),
          joining: jd,
          title: pick(TITLES[g.level]),
          gradeCode: g.code,
          gradeLevel: g.level,
          divCode: d.code,
          divName: d.name,
          deptCode: dept.code,
          deptName: dept.name,
          subName: pick(dept.subs),
          subId: pick(subIds[dept.code]),
          dirName: dirName.name,
          hodName: hodName.name,
          salary: Math.round(
            (g.min + (g.max - g.min) * Math.min(1, Math.pow(rnd(), 1.6) + Math.min(2026 - jy, 12) / 34)) / 500,
          ) * 500,
        };
        employees.push(e);
        insEmp.run(e.code, e.name, e.joining, e.title, gradeId[e.gradeCode], divId[d.code],
          deptId[dept.code], e.subId, null, e.dirName, e.dirName, e.hodName);
      }
    }
  });
  seedEmployees();
  console.log(`  -> ${employees.length} employees`);

  /* ---------------------------------------------------------------- */
  /* Master Excel that Rewards would send                              */
  /* ---------------------------------------------------------------- */
  const sheetRows = employees.map((e) => ({
    'Employee ID': Number(e.code),
    'Name': e.name,
    'Joining Date': e.joining,
    'Job Title': e.title,
    'Job Grade': e.gradeCode,
    'Grade Category': `L${Math.floor((e.gradeLevel - 1) / 2) * 2 + 1} - L${Math.floor((e.gradeLevel - 1) / 2) * 2 + 2}`,
    'Division': e.divName,
    'Department': e.deptName,
    'Sub Department': e.subName,
    'Line Manager': e.dirName,
    'Departmental Head': e.dirName,
    'Division Head': e.hodName,
    'Current Gross Salary': e.salary,
    'Proposed Merit Inc. (%)': '',
    'Proposed Merit Inc. (PKR)': '',
    'Proposed Bonus (PKR)': '',
    'Last Promotion': '',
    'Promotion Recommendation': '',
    'New Grade': '',
    'Remarks': '',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws['!cols'] = Object.keys(sheetRows[0]).map((k) => ({ wch: Math.max(14, k.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'ASR Master');
  const xlsxPath = path.join(process.cwd(), 'data', 'Master-ASR-2027-Rewards.xlsx');
  XLSX.writeFile(wb, xlsxPath);
  console.log(`  -> master workbook written to ${xlsxPath}`);

  /* ---------------------------------------------------------------- */
  /* In-flight ASR 2027 cycle                                          */
  /* ---------------------------------------------------------------- */
  const annualPayroll = employees.reduce((s, e) => s + e.salary, 0) * 12;
  const totalBudget = Math.round((annualPayroll * 0.118) / 1_000_000) * 1_000_000;

  const cycleId = Number(db.prepare(
    `INSERT INTO asr_cycles (name, year, status, total_budget, source_file, effective_date,
        review_deadline, created_by, validated_at, distributed_at)
     VALUES (?,?,?,?,?,?,?,?,datetime('now','-9 days'),datetime('now','-9 days'))`,
  ).run('Annual Salary Review 2027', 2027, 'IN_REVIEW', totalBudget,
       'Master-ASR-2027-Rewards.xlsx', '2027-01-01', '2026-10-10', rewId).lastInsertRowid);

  // allocate the pot across divisions in proportion to payroll
  const divPayroll: Record<string, number> = {};
  for (const e of employees) divPayroll[e.divCode] = (divPayroll[e.divCode] ?? 0) + e.salary * 12;
  const grandPayroll = Object.values(divPayroll).reduce((a, b) => a + b, 0);

  const insBudget = db.prepare(
    `INSERT INTO division_budgets (cycle_id, division_id, allocated_budget, status, deadline)
     VALUES (?,?,?,?,?)`,
  );
  for (const d of ORG) {
    const share = divPayroll[d.code] / grandPayroll;
    const alloc = Math.round((totalBudget * share) / 100_000) * 100_000;
    insBudget.run(cycleId, divId[d.code], alloc, 'NOT_STARTED', '2026-10-10');
  }

  // ASR records for everyone
  console.log('Creating ASR records...');
  const insRec = db.prepare(
    `INSERT INTO asr_records (cycle_id, employee_id, current_salary, eligibility_promotion,
        last_promotion_date, prev_asr_pct, status)
     VALUES (?,?,?,?,?,?, 'PENDING')`,
  );
  const empRows = db.prepare(`SELECT id, emp_code, joining_date FROM employees`).all() as
    { id: number; emp_code: string; joining_date: string }[];
  const byCode = new Map(employees.map((e) => [e.code, e]));

  db.transaction(() => {
    for (const row of empRows) {
      const e = byCode.get(row.emp_code)!;
      const tenure = (new Date('2027-01-01').getTime() - new Date(row.joining_date).getTime()) / 31557600000;
      const lastPromo = tenure >= 3 && rnd() < 0.55
        ? `${intBetween(2021, 2025)}-${String(intBetween(1, 12)).padStart(2, '0')}-01` : null;
      const basis = lastPromo ? new Date(lastPromo) : new Date(row.joining_date);
      const yrs = (new Date('2027-01-01').getTime() - basis.getTime()) / 31557600000;
      insRec.run(cycleId, row.id, e.salary, yrs >= 3 ? 1 : 0, lastPromo,
        tenure < 1.2 ? 0 : Number(between(0.06, 0.16).toFixed(3)));
    }
  })();

  /* ---------------------------------------------------------------- */
  /* Simulated review progress                                         */
  /* ---------------------------------------------------------------- */
  // completion profile per division: [pct filled, target utilisation of allocation]
  const PROFILE: Record<string, [number, number]> = {
    TECH: [1.00, 0.97], FIN: [1.00, 0.88], 'P&O': [1.00, 0.79], LEG: [1.00, 0.93],
    COMM: [0.68, 0.74], CXO: [0.55, 0.61], MKT: [0.82, 1.07], DFS: [0.40, 0.44],
    NOC: [0.30, 0.33], EB: [0.92, 1.14], SCM: [0.15, 0.16],
    CA: [0, 0], 'S&T': [0, 0], IA: [0, 0],
  };

  const recsByDiv = db.prepare(
    `SELECT r.id, r.current_salary, r.eligibility_promotion, g.level AS lvl, g.max_merit_pct AS cap
       FROM asr_records r
       JOIN employees e ON e.id = r.employee_id
       JOIN job_grades g ON g.id = e.grade_id
      WHERE r.cycle_id = ? AND e.division_id = ?`,
  );
  const updRec = db.prepare(
    `UPDATE asr_records SET proposed_increment_pct=?, proposed_increment_amount=?,
        proposed_bonus_amount=?, promotion_recommended=?, performance_rating=?,
        remarks=?, status='IN_PROGRESS', updated_by=?, updated_at=datetime('now','-'||?||' days')
      WHERE id=?`,
  );

  const RATINGS = ['Exceeds Expectations', 'Meets Expectations', 'Partially Meets', 'Outstanding'];

  for (const d of ORG) {
    const [fillPct, targetUtil] = PROFILE[d.code] ?? [0, 0];
    if (fillPct === 0) continue;

    const alloc = db.prepare(`SELECT allocated_budget FROM division_budgets WHERE cycle_id=? AND division_id=?`)
      .get(cycleId, divId[d.code]) as { allocated_budget: number };
    const hod = db.prepare(`SELECT id FROM users WHERE role='HOD' AND division_id=?`).get(divId[d.code]) as { id: number };

    const recs = recsByDiv.all(cycleId, divId[d.code]) as any[];
    const take = Math.floor(recs.length * fillPct);
    const targetSpend = alloc.allocated_budget * targetUtil;

    // first pass: provisional proposals
    const draft = recs.slice(0, take).map((r) => {
      const roll = rnd();
      const rating = roll < 0.10 ? 'Partially Meets' : roll < 0.62 ? 'Meets Expectations'
        : roll < 0.90 ? 'Exceeds Expectations' : 'Outstanding';
      let inc = rating === 'Partially Meets' ? between(0, 0.05)
        : rating === 'Meets Expectations' ? between(0.07, 0.11)
        : rating === 'Exceeds Expectations' ? between(0.115, 0.15)
        : between(0.15, r.cap);
      inc = Math.min(inc, r.cap);
      const bonusEligible = rating === 'Outstanding' || rating === 'Exceeds Expectations';
      const bonus = bonusEligible && rnd() < 0.6 ? Math.round((r.current_salary * between(0.5, 2)) / 1000) * 1000 : 0;
      const promo = r.eligibility_promotion && rating === 'Outstanding' && rnd() < 0.35 ? 1 : 0;
      return { ...r, rating, inc, bonus, promo };
    });

    // scale to hit the intended utilisation for a believable dashboard
    const rawCost = draft.reduce((s, x) => s + x.current_salary * x.inc * 12 + x.bonus, 0);
    const scale = rawCost > 0 ? targetSpend / rawCost : 1;

    db.transaction(() => {
      for (const x of draft) {
        const inc = Math.min(x.inc * scale, x.cap);
        const amt = Math.round((x.current_salary * inc) / 100) * 100;
        const bonus = Math.round((x.bonus * scale) / 1000) * 1000;
        const remarks = x.rating === 'Outstanding'
          ? 'Outstanding contribution through the year; recommended for accelerated reward.'
          : x.rating === 'Partially Meets'
          ? 'Below expectations; increment restricted as per policy.'
          : rnd() < 0.25 ? 'Consistent delivery against agreed objectives.' : null;
        updRec.run(Number((amt / x.current_salary).toFixed(4)), amt, bonus, x.promo,
          x.rating, remarks, hod.id, intBetween(1, 7), x.id);
      }
    })();

    // workflow state
    const done = fillPct >= 1;
    db.prepare(`UPDATE division_budgets SET status=?, submitted_at=?, submitted_by=? WHERE cycle_id=? AND division_id=?`)
      .run(done ? 'SUBMITTED' : 'IN_PROGRESS', done ? new Date(Date.now() - 86400000 * 2).toISOString() : null,
           done ? hod.id : null, cycleId, divId[d.code]);
  }

  /* Budget exceptions for the two divisions deliberately over budget */
  for (const code of ['MKT', 'EB']) {
    const div = ORG.find((o) => o.code === code)!;
    const hod = db.prepare(`SELECT id, name FROM users WHERE role='HOD' AND division_id=?`).get(divId[code]) as { id: number; name: string };
    const alloc = db.prepare(`SELECT allocated_budget FROM division_budgets WHERE cycle_id=? AND division_id=?`).get(cycleId, divId[code]) as { allocated_budget: number };
    const spent = db.prepare(
      `SELECT COALESCE(SUM(r.proposed_increment_amount),0)*12 + COALESCE(SUM(r.proposed_bonus_amount),0) AS t
         FROM asr_records r JOIN employees e ON e.id=r.employee_id
        WHERE r.cycle_id=? AND e.division_id=?`,
    ).get(cycleId, divId[code]) as { t: number };
    const over = Math.max(0, spent.t - alloc.allocated_budget);
    if (over <= 0) continue;

    db.prepare(
      `INSERT INTO budget_exceptions (cycle_id, division_id, requested_by, requested_amount,
          projected_utilisation, justification, status, created_at)
       VALUES (?,?,?,?,?,?,'PENDING', datetime('now','-2 days'))`,
    ).run(cycleId, divId[code], hod.id, Math.round(over / 10000) * 10000,
      (spent.t / alloc.allocated_budget) * 100,
      code === 'MKT'
        ? 'Two brand leads received competing offers from a direct competitor during the campaign peak. Losing them mid-cycle would stall the Q1 product launch. Requesting an additional allocation to fund retention adjustments for these individuals only.'
        : 'The enterprise sales team over-delivered against the annual order-intake target by 31%. The proposed incentive uplift reflects contracted commission obligations that exceed the original allocation provided by Rewards.');
  }

  /* Workflow + notifications so the timeline is populated */
  const wf = db.prepare(`INSERT INTO workflow_events (cycle_id, division_id, stage, status, actor_id, actor_name, note, at) VALUES (?,?,?,?,?,?,?,datetime('now',?))`);
  wf.run(cycleId, null, 'ASR_RECEIVED', 'COMPLETED', rewId, 'Nida Hassan Baig', 'Master ASR file received from Total Rewards', '-10 days');
  wf.run(cycleId, null, 'ASR_UPLOADED', 'COMPLETED', rewId, 'Nida Hassan Baig', '1,500 employee records uploaded by Rewards', '-9 days');
  wf.run(cycleId, null, 'DATA_VALIDATED', 'COMPLETED', rewId, 'Nida Hassan Baig', 'Validation passed with 0 blocking issues', '-9 days');
  wf.run(cycleId, null, 'DEPARTMENTS_DISTRIBUTED', 'COMPLETED', hrId, 'Ayesha Tariq Malik', '14 division workspaces created and released to HODs', '-9 days');
  wf.run(cycleId, null, 'DEPARTMENT_REVIEW', 'IN_PROGRESS', null, 'System', 'Divisions are entering recommendations', '-8 days');

  db.prepare(`INSERT INTO approvals (cycle_id, stage, actor_id, actor_name, action, comment, at) VALUES (?,?,?,?,?,?,datetime('now','-9 days'))`)
    .run(cycleId, 'DATA_VALIDATED', rewId, 'Nida Hassan Baig', 'VALIDATED', 'Master file provided to People & Organization');

  notifySeed(hrId, 'EXCEPTION_RAISED', 'warning', '2 budget exception requests await your review',
    'Marketing and Enterprise Business have exceeded their allocations and submitted justifications.', '/exceptions');
  notifySeed(hrId, 'DIVISION_SUBMITTED', 'success', '4 divisions have submitted their ASR',
    'Technology, Finance, People & Organization and Legal & Regulatory are ready for HR validation.', '/dashboard');
  notifySeed(hrId, 'DEADLINE', 'warning', 'Review deadline is 10 October 2026',
    '3 divisions have not started their review yet.', '/dashboard');

  db.prepare(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity, entity_id, meta, at)
              VALUES (?,?,?,?,?,?,?,datetime('now','-9 days'))`)
    .run(hrId, 'Ayesha Tariq Malik', 'HR_MANAGER', 'CYCLE_CREATED', 'asr_cycle', String(cycleId),
      JSON.stringify({ employees: 1500, totalBudget }));

  console.log('\nSeed complete.');
  console.log(`  ASR cycle      : Annual Salary Review 2027 (id ${cycleId})`);
  console.log(`  Total budget   : PKR ${totalBudget.toLocaleString('en-PK')} (annualised)`);
  console.log(`  Divisions      : ${ORG.length}`);
  console.log(`  Employees      : ${employees.length}`);
  console.log(`\n  Login password for every demo account: ${PASSWORD}`);
  console.log('   hr.manager@jazz.com.pk     HR Manager');
  console.log('   gsm.president@jazz.com.pk  GSM President');
  console.log('   rewards@jazz.com.pk        Rewards (uploads the master sheet)');
  console.log('   hod.tech@jazz.com.pk       HOD - Technology');
  console.log('   dir.tech.nw@jazz.com.pk    Director - Network Engineering');
}

function notifySeed(userId: number, type: string, severity: string, title: string, body: string, link: string) {
  db.prepare(`INSERT INTO notifications (user_id, type, severity, title, body, link, created_at)
              VALUES (?,?,?,?,?,?, datetime('now','-1 days'))`).run(userId, type, severity, title, body, link);
}

main().catch((e) => { console.error(e); process.exit(1); });
