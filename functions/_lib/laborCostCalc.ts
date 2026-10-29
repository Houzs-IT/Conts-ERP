import type { Department } from './hrFields';

/**
 * Labour cost of logged hours (HR > Employees > Labor Cost and Department Labor), ported from Hookka's labor-day-cost
 * workerDayEntryCostsSen. No database code. For each person and day:
 *  - Monthly paid: the day's ordinary hours at salary / the month's working days (Mon to Sat less public holidays) /
 *    daily hours; overtime at salary / days a month (26) / daily hours times the day's rate: Sunday and public holiday
 *    for every hour (Pay rules), a working day for the hours above the daily hours at the person's OT multiplier.
 *  - Daily paid: the daily rate for the day.
 *  - A day split between departments shares the day's cost by hours, overtime included pro rata (Hookka).
 *  - Nothing after a resigned person's last day.
 * Exact sen until the department totals, which are rounded once.
 */

export interface CostPerson {
  id: string; payBasis: 'monthly' | 'daily'; dailyRateSen: number; workingHoursPerDay: number; workingDaysPerMonth: number;
  otMultiplier: number; resignedAt: string | null;
}
export interface HoursRow { employeeId: string; date: string; department: Department; hours: number }
export interface CostRules { sundayMultiplier: number; holidayMultiplier: number }

const isSunday = (d: string): boolean => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

/** Mon to Sat less public holidays, the whole month (Hookka's countElapsedWorkingDays for a full month). */
export function workingDaysInMonth(month: string, holidays: ReadonlySet<string>): number {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`;
    if (!isSunday(day) && !holidays.has(day)) n++;
  }
  return Math.max(1, n);
}

/** The cost of each row, exact sen, in the order given. `salaryOn(employeeId, month)` is the basic in force that month. */
export function rowCosts(rows: readonly HoursRow[], people: ReadonlyMap<string, CostPerson>, salaryOn: (employeeId: string, month: string) => number,
  holidays: ReadonlySet<string>, rules: CostRules): number[] {
  const dayHours = new Map<string, number>();
  for (const r of rows) dayHours.set(`${r.employeeId}|${r.date}`, (dayHours.get(`${r.employeeId}|${r.date}`) ?? 0) + r.hours);
  const workDays = new Map<string, number>();
  return rows.map(r => {
    const p = people.get(r.employeeId);
    const total = dayHours.get(`${r.employeeId}|${r.date}`) ?? 0;
    if (!p || total <= 0 || r.hours <= 0) return 0;
    if (p.resignedAt && r.date > p.resignedAt) return 0;
    const share = r.hours / total;
    if (p.payBasis === 'daily') return p.dailyRateSen * share;
    const month = r.date.slice(0, 7);
    const salary = salaryOn(r.employeeId, month);
    if (salary <= 0) return 0;
    const std = p.workingHoursPerDay > 0 ? p.workingHoursPerDay : 8;
    let wd = workDays.get(month);
    if (wd === undefined) { wd = workingDaysInMonth(month, holidays); workDays.set(month, wd); }
    const regularRate = salary / wd / std;
    const otBase = salary / Math.max(1, p.workingDaysPerMonth) / std;
    const premium = isSunday(r.date) ? { otHours: total, mult: rules.sundayMultiplier }
      : holidays.has(r.date) ? { otHours: total, mult: rules.holidayMultiplier }
      : { otHours: Math.max(0, total - std), mult: p.otMultiplier };
    const otH = r.hours * (premium.otHours / total);
    return (r.hours - otH) * regularRate + otH * otBase * premium.mult;
  });
}

export interface DepartmentCost { department: Department; hours: number; workers: number; costSen: number }

/** Hours, people and cost per department, rounded once per department. */
export function byDepartment(rows: readonly HoursRow[], costs: readonly number[]): DepartmentCost[] {
  const out = new Map<Department, { hours: number; people: Set<string>; cost: number }>();
  rows.forEach((r, i) => {
    const d = out.get(r.department) ?? { hours: 0, people: new Set<string>(), cost: 0 };
    d.hours += r.hours; d.people.add(r.employeeId); d.cost += costs[i];
    out.set(r.department, d);
  });
  return [...out.entries()].map(([department, d]) => ({ department, hours: Math.round(d.hours * 100) / 100, workers: d.people.size, costSen: Math.round(d.cost) }))
    .sort((a, b) => a.department.localeCompare(b.department));
}
