import { type Env, all, mytToday } from './db';
import { listEmployees } from './hr';
import type { Department, Employee } from './hrFields';
import { readHolidays } from './leave';
import { readPayRules, hasPayroll } from './payroll';
import { hasWorkingHours, entriesBetween, punchesBetween, punchHours, homeDepartment } from './workingHours';
import { maintenanceMoney, cleaningMoney } from './jobProfit';
import { MYT_DATE } from './ops';
import { rowCosts, byDepartment, type CostPerson, type HoursRow, type DepartmentCost } from './laborCostCalc';

/**
 * Labour cost against what the jobs were charged (HR > Employees > Labor Cost, Department Labor), as Hookka's Labor
 * Cost tab: hours per person, day and department from the Working Hours grid (the punch where nothing is saved, as
 * payroll reads them), costed by laborCostCalc.ts; revenue is what the cleaning and repair jobs finished in the range
 * were billed (jobProfit.ts, as Profit by job); for one finished month, the payroll reconciliation against the payslips.
 */

export interface RevenueRow { date: string; kind: 'cleaning' | 'repair'; ref: string; billedSen: number }
export interface DepartmentLine extends DepartmentCost {
  /** Billed for the department's jobs: cleaning jobs to Cleaning, repairs to Maintenance. Null for those not shown money. */
  revenueSen: number | null;
  /** For one finished month with payslips: payroll paid beyond the logged hours (leave, absences paid, statutory, allowances). */
  underRecordedSen: number | null;
}
export interface Reconciliation { loggedSen: number; underRecordedSen: number; payrollSen: number; payslips: number }
export interface Docked { name: string; hours: number; sen: number }
export interface LaborCostPayload {
  from: string; to: string; today: string;
  /** The month when the range is exactly one calendar month that has ended: the reconciliation needs one. */
  closedMonth: string | null;
  showRevenue: boolean;
  departments: DepartmentLine[];
  reconciliation: Reconciliation | null;
  docked: Docked[];
  revenue: RevenueRow[] | null;
}

/** Hours per person, day and department: saved grid rows, and the punch (on their home department) for the days
 *  nobody saved. */
async function hoursRows(env: Env, people: Employee[], from: string, to: string): Promise<HoursRow[]> {
  const today = mytToday();
  const [entries, punches, rules] = await Promise.all([
    hasWorkingHours(env).then(ok => (ok ? entriesBetween(env, from, to) : [])), punchesBetween(env, from, to), readPayRules(env),
  ]);
  const byId = new Map(people.filter(p => p.id).map(p => [p.id, p]));
  const logged = new Set(entries.map(e => `${e.employeeId}|${e.date}`));
  const rows: HoursRow[] = entries.map(e => ({ employeeId: e.employeeId, date: e.date, department: e.department, hours: e.hours }));
  for (const p of punches) {
    const person = byId.get(p.employee_id);
    if (!person || logged.has(`${p.employee_id}|${p.work_date}`)) continue;
    rows.push({ employeeId: p.employee_id, date: p.work_date, department: homeDepartment(person), hours: punchHours(p, rules, person.workingHoursPerDay, today).hours });
  }
  return rows;
}

/** The basic in force each month, from salary history (the record's own salary before any history). */
async function salaries(env: Env, people: Employee[], to: string, payroll: boolean): Promise<(employeeId: string, month: string) => number> {
  const ids = people.map(p => p.id).filter((x): x is string => !!x);
  const rows = ids.length && payroll ? await all<{ employee_id: string; basic_salary_sen: number; effective_from: string }>(env, `
    SELECT employee_id, basic_salary_sen, effective_from FROM employee_salary_history
    WHERE employee_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND effective_from <= ? ORDER BY effective_from`, JSON.stringify(ids), to) : [];
  const own = new Map(people.filter(p => p.id).map(p => [p.id, p.basicSalarySen]));
  return (employeeId, month) => {
    const end = `${month}-31`;
    const inForce = rows.filter(r => r.employee_id === employeeId && r.effective_from <= end).pop();
    return inForce ? Number(inForce.basic_salary_sen) : own.get(employeeId) ?? 0;
  };
}

/** Cleaning and repair jobs finished in the range, with what each was billed. */
async function revenueRows(env: Env, from: string, to: string): Promise<RevenueRow[]> {
  const [cleans, repairs] = await Promise.all([
    all<{ id: string; day: string; ref: string }>(env, `
      SELECT t.id, ${MYT_DATE('t.completed_at')} AS day, concat_ws(' · ', COALESCE(u.unit_number, t.external_address), t.title) AS ref
      FROM tasks t LEFT JOIN units u ON u.id = t.unit_id
      WHERE t.kind IN ('turnover','deep_clean','light_clean') AND t.state = 'resolved' AND t.completed_at IS NOT NULL
        AND ${MYT_DATE('t.completed_at')} BETWEEN ? AND ?`, from, to),
    all<{ id: string; day: string; ref: string }>(env, `
      SELECT m.id, ${MYT_DATE('m.resolved_at')} AS day, concat_ws(' · ', u.unit_number, m.title) AS ref
      FROM maintenance_issues m JOIN units u ON u.id = m.unit_id
      WHERE m.state = 'resolved' AND m.resolved_at IS NOT NULL AND ${MYT_DATE('m.resolved_at')} BETWEEN ? AND ?`, from, to),
  ]);
  const [cm, mm] = await Promise.all([cleaningMoney(env, cleans.map(c => c.id)), maintenanceMoney(env, repairs.map(r => r.id))]);
  return [
    ...cleans.map(c => ({ date: c.day, kind: 'cleaning' as const, ref: c.ref, billedSen: cm.get(c.id)?.billed ?? 0 })),
    ...repairs.map(r => ({ date: r.day, kind: 'repair' as const, ref: r.ref, billedSen: mm.get(r.id)?.billed ?? 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** One calendar month that has ended, when the range is exactly that. */
export function closedMonth(from: string, to: string, today: string): string | null {
  if (from.slice(0, 7) !== to.slice(0, 7) || !from.endsWith('-01')) return null;
  const last = `${to.slice(0, 7)}-${String(new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
  return to === last && last < today ? to.slice(0, 7) : null;
}

export async function laborCost(env: Env, from: string, to: string, showRevenue: boolean, department: Department | null): Promise<LaborCostPayload> {
  const today = mytToday();
  const [people, holidays, rules, payroll] = await Promise.all([listEmployees(env), readHolidays(env), readPayRules(env), hasPayroll(env)]);
  const [allRows, salaryOn] = await Promise.all([hoursRows(env, people, from, to), salaries(env, people, to, payroll)]);
  const rows = department ? allRows.filter(r => r.department === department) : allRows;
  const costPeople = new Map<string, CostPerson>(people.filter((p): p is Employee & { id: string } => !!p.id).map(p => [p.id, {
    id: p.id, payBasis: p.payBasis, dailyRateSen: p.dailyRateSen, workingHoursPerDay: p.workingHoursPerDay, workingDaysPerMonth: p.workingDaysPerMonth,
    otMultiplier: p.otMultiplier, resignedAt: p.status === 'resigned' ? p.resignedAt : null,
  }]));
  // Costs are worked out on every row of the day (a split day shares its overtime), then filtered.
  const allCosts = rowCosts(allRows, costPeople, salaryOn, new Set(holidays.map(h => h.date)), rules);
  const costs = department ? allCosts.filter((_, i) => allRows[i].department === department) : allCosts;
  const departments = byDepartment(rows, costs);

  const revenue = showRevenue ? await revenueRows(env, from, to) : null;
  const month = closedMonth(from, to, today);
  let reconciliation: Reconciliation | null = null;
  let docked: Docked[] = [];
  const under = new Map<Department, number>();
  if (month && !department && payroll) {
    const slips = await all<{ employee_id: string; employee_name: string; gross_sen: number; epf_employer_sen: number; socso_employer_sen: number; eis_employer_sen: number; late_short_hours: number; late_short_sen: number }>(env, `
      SELECT employee_id, employee_name, gross_sen, epf_employer_sen, socso_employer_sen, eis_employer_sen, late_short_hours, late_short_sen
      FROM payslips WHERE period = ?`, month);
    if (slips.length) {
      const loggedBy = new Map<string, number>();
      allRows.forEach((r, i) => loggedBy.set(r.employeeId, (loggedBy.get(r.employeeId) ?? 0) + allCosts[i]));
      let payroll = 0, logged = 0;
      for (const s of slips) {
        const paid = Number(s.gross_sen) + Number(s.epf_employer_sen) + Number(s.socso_employer_sen) + Number(s.eis_employer_sen);
        const mine = loggedBy.get(s.employee_id) ?? 0;
        payroll += paid; logged += mine;
        // The part of their pay no logged hour accounts for goes to their home department (Hookka's under-recorded gap).
        const person = people.find(p => p.id === s.employee_id);
        const home = person ? homeDepartment(person) : 'cleaning';
        under.set(home, (under.get(home) ?? 0) + (paid - mine));
      }
      reconciliation = { loggedSen: Math.round(logged), underRecordedSen: Math.round(payroll - logged), payrollSen: Math.round(payroll), payslips: slips.length };
      docked = slips.filter(s => Number(s.late_short_sen) > 0).map(s => ({ name: s.employee_name, hours: Number(s.late_short_hours), sen: Number(s.late_short_sen) }));
    }
  }

  const billedBy = (d: Department): number | null => (revenue ? revenue.filter(r => (r.kind === 'cleaning' ? 'cleaning' : 'maintenance') === d).reduce((n, r) => n + r.billedSen, 0) : null);
  const lines: DepartmentLine[] = (['cleaning', 'maintenance'] as const)
    .filter(d => !department || d === department)
    .map(d => ({
      ...(departments.find(x => x.department === d) ?? { department: d, hours: 0, workers: 0, costSen: 0 }),
      revenueSen: billedBy(d),
      underRecordedSen: reconciliation ? Math.round(under.get(d) ?? 0) : null,
    }));
  return { from, to, today, closedMonth: month, showRevenue, departments: lines, reconciliation, docked, revenue };
}
