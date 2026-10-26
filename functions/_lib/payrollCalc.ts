import { z } from 'zod';
import { resolvePcb, type PcbCategory, type PcbStatus, type PcbTaxProfile, type TaxResidency as PcbResidency } from './pcb';
import type { LeaveType, PublicHoliday } from './leaveRules';
import type { Employee, TaxCategory, TaxResidency } from './hrFields';

/**
 * One month's pay (migration 0165, PLAN-hr-employees.md phase 4), ported from Hookka's labor-engine computeMonthlyLabor
 * and payslips calcStatutory with the rules as Hookka has them (owner, 26 Oct 2026: "leave the rules"). No database code:
 * the API, the portal estimate and the tests all run this one function, so the office and the phone never disagree.
 *
 * The month, as on Hookka:
 *  - Working days are Monday to Saturday, less public holidays, counted up to `throughDay` (today for the running month).
 *  - Monthly pay starts from the full basic and takes off each absent working day at basic / working days per month (26).
 *    Absent = working days so far - days worked on them - paid leave on them. Approved annual and medical leave are paid
 *    (Hookka's payroll does not read leave; without this an approved day off would be docked). Emergency leave follows
 *    the `emergencyLeavePaid` rule; unpaid leave is an absence.
 *  - Daily pay is the days worked on working days times the daily rate. No absences: there is no salary to be absent from.
 *  - Overtime on a working day: hours above the daily hours, floored to whole `otBlockMin` blocks, at the hour rate times
 *    the person's overtime rate. Every hour on a Sunday at `sundayMultiplier`, every hour on a public holiday at
 *    `holidayMultiplier`, on top of the month's pay (Hookka). A forgotten clock-out counts as the standard day, no overtime.
 *  - Hour rate = day rate / daily hours (Hookka's "hours only" divisor; there is no lunch break on the punch clock).
 *  - EPF on the basic salary (Hookka passes the full basic, absences not taken off); SOCSO and EIS fixed amounts; PCB by
 *    LHDN's monthly method on basic earned plus overtime (pcb.ts). ponytail: flat SOCSO / EIS amounts and a flat EPF
 *    percentage, not the contribution tables; the office can change the amounts under Pay rules until the tables are added.
 *  - Net = gross - EPF - SOCSO - EIS - PCB - advances. Not clamped: an advance bigger than the month shows as owed.
 */

export const payRulesSchema = z.object({
  epfEmployeePct: z.number().min(0).max(30),
  epfEmployerPct: z.number().min(0).max(30),
  socsoEmployeeSen: z.int().min(0).max(100_000),
  socsoEmployerSen: z.int().min(0).max(100_000),
  eisEmployeeSen: z.int().min(0).max(100_000),
  eisEmployerSen: z.int().min(0).max(100_000),
  otBlockMin: z.int().min(1).max(60),
  sundayMultiplier: z.number().min(1).max(5),
  holidayMultiplier: z.number().min(1).max(5),
  emergencyLeavePaid: z.boolean(),
});
export type PayRules = z.infer<typeof payRulesSchema>;

/** Hookka's DEFAULT_PAY_RULES (pay-rules.ts), the parts The Conts uses. */
export const DEFAULT_PAY_RULES: PayRules = {
  epfEmployeePct: 11, epfEmployerPct: 13,
  socsoEmployeeSen: 745, socsoEmployerSen: 2615,
  eisEmployeeSen: 390, eisEmployerSen: 390,
  otBlockMin: 15, sundayMultiplier: 2, holidayMultiplier: 3,
  emergencyLeavePaid: true,
};

/** The stored rules; Hookka's defaults when never set. A broken setting throws rather than paying on guessed rates. */
export function parsePayRules(raw: string | null | undefined): PayRules {
  if (!raw) return DEFAULT_PAY_RULES;
  const r = payRulesSchema.safeParse(JSON.parse(raw));
  if (!r.success) throw new Error(`The pay rules in settings (hr.pay_rules) are not valid: ${r.error.issues[0]?.message ?? 'unknown'}`);
  return r.data;
}

/** The Conts stores the tax declaration in lower case (hrFields.ts); pcb.ts keeps Hookka's upper-case codes. */
const RESIDENCY: Record<TaxResidency, PcbResidency> = { resident: 'RESIDENT', non_resident: 'NON_RESIDENT' };
const CATEGORY: Record<TaxCategory, PcbCategory> = {
  single: 'SINGLE', married_spouse_not_working: 'MARRIED_SPOUSE_NOT_WORKING', married_spouse_working: 'MARRIED_SPOUSE_WORKING',
};
export const pcbProfile = (e: Pick<Employee, 'taxResidency' | 'taxCategory' | 'taxChildReliefSen'>): PcbTaxProfile => ({
  residency: e.taxResidency ? RESIDENCY[e.taxResidency] : null,
  category: e.taxCategory ? CATEGORY[e.taxCategory] : null,
  childReliefSen: e.taxChildReliefSen,
});

export interface PunchDay { date: string; minutes: number; forgotOut: boolean }
export interface ApprovedLeave { type: LeaveType; startDate: string; endDate: string }
export interface YearToDate { remunerationSen: number; epfSen: number; pcbSen: number }

export interface PayInput {
  /** YYYY-MM */
  period: string;
  /** Last day counted: the month's last day, or today while the month is running (the portal's estimate). */
  throughDay: string;
  employee: Pick<Employee, 'payBasis' | 'dailyRateSen' | 'workingDaysPerMonth' | 'workingHoursPerDay' | 'otMultiplier'
    | 'epfEnabled' | 'socsoEnabled' | 'eisEnabled' | 'pcbEnabled' | 'taxResidency' | 'taxCategory' | 'taxChildReliefSen'>;
  /** Basic salary in force on the month's last day (salary history). */
  basicSalarySen: number;
  days: PunchDay[];
  leaves: ApprovedLeave[];
  holidays: readonly PublicHoliday[];
  advanceSen: number;
  ytd: YearToDate;
  rules: PayRules;
}

export interface PayFigures {
  basicSalarySen: number; dayRateSen: number; hourRateSen: number;
  workingDays: number; daysWorked: number; paidLeaveDays: number; absentDays: number; absenceDeductionSen: number;
  otHours: number; otSen: number; sundayHours: number; sundaySen: number; holidayHours: number; holidaySen: number;
  grossSen: number;
  epfEmployeeSen: number; epfEmployerSen: number; socsoEmployeeSen: number; socsoEmployerSen: number;
  eisEmployeeSen: number; eisEmployerSen: number;
  pcbSen: number; pcbStatus: PcbStatus; pcbNote: string;
  advanceSen: number; totalDeductionsSen: number; netSen: number;
}

const utcDay = (d: string): Date => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
const isSunday = (d: string): boolean => utcDay(d).getUTCDay() === 0;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Every date of the period up to `through`, as YYYY-MM-DD. */
export function periodDates(period: string, through: string): string[] {
  const out: string[] = [];
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  for (let d = 1; d <= last; d++) {
    const date = `${period}-${String(d).padStart(2, '0')}`;
    if (date > through) break;
    out.push(date);
  }
  return out;
}

export function computePay(p: PayInput): PayFigures {
  const { employee: e, rules } = p;
  const holidays = new Set(p.holidays.map(h => h.date));
  const dates = periodDates(p.period, p.throughDay);
  const workingDates = new Set(dates.filter(d => !isSunday(d) && !holidays.has(d)));
  const hoursPerDay = e.workingHoursPerDay;

  const worked = new Map(p.days.filter(d => d.date.startsWith(`${p.period}-`) && d.date <= p.throughDay).map(d => [d.date, d]));
  const daysWorked = [...worked.keys()].filter(d => workingDates.has(d)).length;

  const paidTypes: LeaveType[] = rules.emergencyLeavePaid ? ['annual', 'medical', 'emergency'] : ['annual', 'medical'];
  const leaveDates = new Set<string>();
  for (const l of p.leaves) {
    if (!paidTypes.includes(l.type)) continue;
    for (const d of workingDates) if (d >= l.startDate && d <= l.endDate && !worked.has(d)) leaveDates.add(d);
  }

  const monthly = e.payBasis === 'monthly';
  const basic = monthly ? p.basicSalarySen : 0;
  const dayRateExact = monthly ? basic / e.workingDaysPerMonth : e.dailyRateSen;
  const hourRateExact = dayRateExact / hoursPerDay;
  const absentDays = monthly ? Math.max(0, workingDates.size - daysWorked - leaveDates.size) : 0;
  const absenceDeductionSen = Math.round(absentDays * dayRateExact);

  let otHours = 0, sundayHours = 0, holidayHours = 0;
  for (const [date, d] of worked) {
    const hours = d.forgotOut ? hoursPerDay : d.minutes / 60;
    if (isSunday(date)) sundayHours += hours;
    else if (holidays.has(date)) holidayHours += hours;
    else if (!d.forgotOut && hours > hoursPerDay) {
      const blockH = rules.otBlockMin / 60;
      otHours += Math.floor((hours - hoursPerDay + 1e-9) / blockH) * blockH;
    }
  }
  otHours = round2(otHours); sundayHours = round2(sundayHours); holidayHours = round2(holidayHours);
  const otSen = Math.round(otHours * hourRateExact * e.otMultiplier);
  const sundaySen = Math.round(sundayHours * hourRateExact * rules.sundayMultiplier);
  const holidaySen = Math.round(holidayHours * hourRateExact * rules.holidayMultiplier);

  const basicEarnedSen = monthly ? basic - absenceDeductionSen : Math.round(daysWorked * e.dailyRateSen);
  const grossSen = basicEarnedSen + otSen + sundaySen + holidaySen;

  // EPF on the basic (Hookka's calcStatutory gets the full basic); a daily-paid person's basic is what the days earned.
  const epfBase = monthly ? basic : basicEarnedSen;
  const epfEmployeeSen = e.epfEnabled ? Math.round((epfBase * rules.epfEmployeePct) / 100) : 0;
  const epfEmployerSen = e.epfEnabled ? Math.round((epfBase * rules.epfEmployerPct) / 100) : 0;
  const socsoEmployeeSen = e.socsoEnabled ? rules.socsoEmployeeSen : 0;
  const socsoEmployerSen = e.socsoEnabled ? rules.socsoEmployerSen : 0;
  const eisEmployeeSen = e.eisEnabled ? rules.eisEmployeeSen : 0;
  const eisEmployerSen = e.eisEnabled ? rules.eisEmployerSen : 0;

  const pcb = resolvePcb({
    pcbEnabled: e.pcbEnabled,
    year: Number(p.period.slice(0, 4)),
    monthIndex: Number(p.period.slice(5, 7)),
    profile: pcbProfile(e),
    // Basic earned plus overtime, as on Hookka; the EPF actually taken is the relief.
    currentRemunerationSen: grossSen,
    currentEpfSen: epfEmployeeSen,
    ytdRemunerationSen: p.ytd.remunerationSen,
    ytdEpfSen: p.ytd.epfSen,
    ytdPcbSen: p.ytd.pcbSen,
  });

  const totalDeductionsSen = epfEmployeeSen + socsoEmployeeSen + eisEmployeeSen + pcb.pcbSen;
  return {
    basicSalarySen: basic, dayRateSen: Math.round(dayRateExact), hourRateSen: Math.round(hourRateExact),
    workingDays: workingDates.size, daysWorked, paidLeaveDays: leaveDates.size, absentDays, absenceDeductionSen,
    otHours, otSen, sundayHours, sundaySen, holidayHours, holidaySen, grossSen,
    epfEmployeeSen, epfEmployerSen, socsoEmployeeSen, socsoEmployerSen, eisEmployeeSen, eisEmployerSen,
    pcbSen: pcb.pcbSen, pcbStatus: pcb.status, pcbNote: pcb.note,
    advanceSen: p.advanceSen, totalDeductionsSen, netSen: grossSen - totalDeductionsSen - p.advanceSen,
  };
}
