import { z } from 'zod';
import { resolvePcb, type PcbCategory, type PcbStatus, type PcbTaxProfile, type TaxResidency as PcbResidency } from './pcb';
import type { LeaveType, PublicHoliday } from './leaveRules';
import type { Employee, TaxCategory, TaxResidency } from './hrFields';

/**
 * One month's pay (migration 0165, PLAN-hr-employees.md phase 4), ported from Hookka's labor-engine computeMonthlyLabor,
 * attendance-rules computeAttendanceDay and payslips calcStatutory. Every rule is a setting on Payroll > Pay rules
 * (owner, 26 Oct 2026: The Conts' own rules are not decided yet), starting from Hookka's defaults, except that shift
 * rules start off. No database code: the API, the portal estimate and the tests all run this one function.
 *
 * The month, as on Hookka:
 *  - Working days are Monday to Saturday, less public holidays, counted up to `throughDay` (today for the running month).
 *    While the month runs, the last `absenceGraceWorkingDays` working days with nothing logged are not yet absences.
 *  - Monthly pay starts from the full basic and takes off each absent working day at the day rate. Absent = working days
 *    so far - days worked on them - paid leave on them. Approved annual and medical leave are paid (Hookka's payroll does
 *    not read leave; without this an approved day off would be docked); emergency leave follows `emergencyLeavePaid`.
 *  - Daily pay is the days worked on working days times the daily rate. No absences.
 *  - Day rate = basic / (26, the month's calendar days, or its working days), by `dayRateDivisorMode`. Hour rate = day
 *    rate / (daily hours + lunch, daily hours, or `rateHoursPerDay`), by `hourRateDivisorMode`, rounded to the sen
 *    before it is multiplied (Hookka, 8 Oct 2026: the payslip must add up on a calculator). Lunch counts only with the
 *    shift rules on.
 *  - Shift rules off: a day's hours are clock-out minus clock-in; overtime is the hours above the daily hours, floored to
 *    `otBlockMin` blocks; nothing is docked. Shift rules on (Hookka's computeAttendanceDay): arriving more than
 *    `lateGraceMin` after the shift start counts from the shift start, the lunch overlap is taken off, overtime is only
 *    after the shift end in `otBlockMin` blocks, and the shortfall against the standard day is docked at the hour rate.
 *    A day whose punches give no time at all (in and out at knock-off) counts as a full day if
 *    `brokenPunchCreditsFullDay`, otherwise as not worked.
 *  - Every hour on a Sunday at `sundayMultiplier`, every hour on a public holiday at `holidayMultiplier`, on top. A
 *    forgotten clock-out counts as the standard day, no overtime and no dock.
 *  - EPF on the basic (`epfOn: 'basic'`, Hookka passes the full basic) or on the basic earned after absences and docks
 *    (`'earned'`); SOCSO and EIS fixed amounts; PCB by LHDN's monthly method on basic earned plus overtime (pcb.ts).
 *    ponytail: flat SOCSO / EIS amounts and a flat EPF percentage, not the contribution tables.
 *  - Net = gross - EPF - SOCSO - EIS - PCB - advances. Not clamped: an advance bigger than the month shows as owed.
 */

const minuteOfDay = z.int().min(0).max(24 * 60);
/** Each rule falls back to its default on its own, so rules saved before a rule existed still read (Hookka's
 *  normalizePayRules does the same). */
export const payRulesSchema = z.object({
  dayRateDivisorMode: z.enum(['fixed26', 'calendarDays', 'workingDays']).default('fixed26'),
  hourRateDivisorMode: z.enum(['hoursPlusLunch', 'hoursOnly', 'fixed']).default('hoursPlusLunch'),
  rateHoursPerDay: z.number().min(1).max(24).default(10),
  useShiftRules: z.boolean().default(false),
  shiftStartMin: minuteOfDay.default(8 * 60),
  shiftEndMin: minuteOfDay.default(18 * 60),
  lunchStartMin: minuteOfDay.default(12 * 60),
  lunchMin: z.int().min(0).max(180).default(60),
  lateGraceMin: z.int().min(0).max(120).default(15),
  lateBlockMin: z.int().min(1).max(60).default(1),
  otBlockMin: z.int().min(1).max(60).default(15),
  sundayMultiplier: z.number().min(1).max(5).default(2),
  holidayMultiplier: z.number().min(1).max(5).default(3),
  absenceGraceWorkingDays: z.int().min(0).max(10).default(2),
  brokenPunchCreditsFullDay: z.boolean().default(true),
  emergencyLeavePaid: z.boolean().default(true),
  epfOn: z.enum(['basic', 'earned']).default('basic'),
  epfEmployeePct: z.number().min(0).max(30).default(11),
  epfEmployerPct: z.number().min(0).max(30).default(13),
  socsoEmployeeSen: z.int().min(0).max(100_000).default(745),
  socsoEmployerSen: z.int().min(0).max(100_000).default(2615),
  eisEmployeeSen: z.int().min(0).max(100_000).default(390),
  eisEmployerSen: z.int().min(0).max(100_000).default(390),
}).refine(r => r.shiftEndMin > r.shiftStartMin, { path: ['shiftEndMin'], message: 'The shift ends before it starts.' });
export type PayRules = z.infer<typeof payRulesSchema>;

/** Hookka's DEFAULT_PAY_RULES (pay-rules.ts), with shift rules off until The Conts sets its own. */
export const DEFAULT_PAY_RULES: PayRules = payRulesSchema.parse({});

/** The stored rules; the defaults when never set. A broken setting throws rather than paying on guessed rates. */
export function parsePayRules(raw: string | null | undefined): PayRules {
  if (!raw) return DEFAULT_PAY_RULES;
  const r = payRulesSchema.safeParse(JSON.parse(raw));
  if (!r.success) throw new Error(`The pay rules in settings (hr.pay_rules) are not valid: ${r.error.issues[0]?.message ?? 'unknown'}`);
  return r.data;
}

export interface ShiftDay { regularMin: number; otMin: number; shortfallMin: number; lateMin: number }
/** Hookka's computeAttendanceDay (src/lib/attendance-rules.ts), minutes since midnight, Malaysia time. */
export function shiftDay(inMin: number, outMin: number, r: PayRules): ShiftDay {
  const rawLate = Math.max(0, inMin - r.shiftStartMin);
  const isLate = rawLate > r.lateGraceMin;
  const penalLate = isLate ? Math.ceil(rawLate / r.lateBlockMin) * r.lateBlockMin : 0;
  const effectiveIn = r.shiftStartMin + penalLate;
  const regularEnd = Math.min(outMin, r.shiftEndMin);
  const lunchOverlap = Math.min(r.lunchMin, Math.max(0, Math.min(regularEnd, r.lunchStartMin + r.lunchMin) - Math.max(effectiveIn, r.lunchStartMin)));
  const regularMin = Math.max(0, regularEnd - effectiveIn - lunchOverlap);
  let otMin = 0;
  if (outMin > r.shiftEndMin) {
    const roundedOut = Math.floor(outMin / 60) * 60 + Math.floor((outMin % 60) / r.otBlockMin) * r.otBlockMin;
    otMin = Math.max(0, roundedOut - r.shiftEndMin);
    if (otMin < r.otBlockMin) otMin = 0;
  }
  const standard = Math.max(0, r.shiftEndMin - r.shiftStartMin - r.lunchMin);
  return { regularMin, otMin, shortfallMin: Math.max(0, standard - regularMin - otMin), lateMin: isLate ? rawLate : 0 };
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

/** One day's punch. inMin / outMin are minutes since midnight in Malaysia time, for the shift rules; null when open.
 *  loggedMin: the day's hours on the Working Hours grid (all departments), which win over the punch when present. */
export interface PunchDay { date: string; minutes: number; forgotOut: boolean; inMin: number | null; outMin: number | null; loggedMin?: number | null }
export interface ApprovedLeave { type: LeaveType; startDate: string; endDate: string }
export interface YearToDate { remunerationSen: number; epfSen: number; pcbSen: number }

export interface PayInput {
  /** YYYY-MM */
  period: string;
  /** Last day counted: the month's last day, or today while the month is running (the portal's estimate). */
  throughDay: string;
  employee: Pick<Employee, 'payBasis' | 'dailyRateSen' | 'workingDaysPerMonth' | 'workingHoursPerDay' | 'otMultiplier' | 'leaderAllowanceSen'
    | 'epfEnabled' | 'socsoEnabled' | 'eisEnabled' | 'pcbEnabled' | 'taxResidency' | 'taxCategory' | 'taxChildReliefSen'>;
  /** Basic salary in force on the month's last day (salary history). */
  basicSalarySen: number;
  days: PunchDay[];
  leaves: ApprovedLeave[];
  holidays: readonly PublicHoliday[];
  advanceSen: number;
  /** Approved worker penalties on this payroll month (Worker Penalty), taken after statutory like an advance. */
  penaltySen: number;
  ytd: YearToDate;
  rules: PayRules;
}

export interface PayFigures {
  basicSalarySen: number; dayRateSen: number; hourRateSen: number;
  workingDays: number; daysWorked: number; paidLeaveDays: number; absentDays: number; absenceDeductionSen: number;
  otHours: number; otSen: number; sundayHours: number; sundaySen: number; holidayHours: number; holidaySen: number;
  /** Late and short hours docked under the shift rules (0 with them off). */
  lateShortHours: number; lateShortSen: number;
  /** Leader allowance for the month (Hookka: less the share of working days missed; the efficiency allowance waits
   *  for production time to be decided). Added to gross after statutory and PCB are worked out. */
  allowanceSen: number;
  grossSen: number;
  epfEmployeeSen: number; epfEmployerSen: number; socsoEmployeeSen: number; socsoEmployerSen: number;
  eisEmployeeSen: number; eisEmployerSen: number;
  pcbSen: number; pcbStatus: PcbStatus; pcbNote: string;
  advanceSen: number; penaltySen: number; totalDeductionsSen: number; netSen: number;
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
  const allDates = periodDates(p.period, '9999-12-31');
  const dates = allDates.filter(d => d <= p.throughDay);
  const isWorking = (d: string): boolean => !isSunday(d) && !holidays.has(d);
  const workingDates = new Set(dates.filter(isWorking));
  const hoursPerDay = e.workingHoursPerDay;
  const shift = rules.useShiftRules;

  // Each day's payable minutes, overtime and dock. Under the shift rules a day whose punches give no time at all is a
  // full day or not worked, by brokenPunchCreditsFullDay.
  interface Day { minutes: number; otMin: number; dockMin: number }
  const worked = new Map<string, Day>();
  for (const d of p.days) {
    if (!d.date.startsWith(`${p.period}-`) || d.date > p.throughDay) continue;
    // Hours the office logged on the Working Hours grid are the day (Hookka: payroll reads the grid). Zero logged = not
    // worked. Overtime is above the daily hours; with the shift rules on, the shortfall against the standard day is docked.
    if (d.loggedMin !== undefined && d.loggedMin !== null) {
      if (d.loggedMin <= 0) continue;
      const surplus = Math.max(0, d.loggedMin - hoursPerDay * 60);
      const standard = Math.max(0, rules.shiftEndMin - rules.shiftStartMin - rules.lunchMin);
      worked.set(d.date, { minutes: d.loggedMin, otMin: Math.floor(surplus / rules.otBlockMin + 1e-9) * rules.otBlockMin, dockMin: shift ? Math.max(0, standard - d.loggedMin) : 0 });
      continue;
    }
    if (d.forgotOut) { worked.set(d.date, { minutes: hoursPerDay * 60, otMin: 0, dockMin: 0 }); continue; }
    if (shift && d.inMin !== null && d.outMin !== null && d.outMin > d.inMin) {
      const day = shiftDay(d.inMin, d.outMin, rules);
      if (day.regularMin + day.otMin === 0) {
        if (rules.brokenPunchCreditsFullDay) worked.set(d.date, { minutes: hoursPerDay * 60, otMin: 0, dockMin: 0 });
        continue;
      }
      worked.set(d.date, { minutes: day.regularMin + day.otMin, otMin: day.otMin, dockMin: day.shortfallMin });
      continue;
    }
    const surplus = Math.max(0, d.minutes - hoursPerDay * 60);
    worked.set(d.date, { minutes: d.minutes, otMin: Math.floor(surplus / rules.otBlockMin + 1e-9) * rules.otBlockMin, dockMin: 0 });
  }
  const daysWorked = [...worked.keys()].filter(d => workingDates.has(d)).length;

  const paidTypes: LeaveType[] = rules.emergencyLeavePaid ? ['annual', 'medical', 'emergency'] : ['annual', 'medical'];
  const leaveDates = new Set<string>();
  for (const l of p.leaves) {
    if (!paidTypes.includes(l.type)) continue;
    for (const d of workingDates) if (d >= l.startDate && d <= l.endDate && !worked.has(d)) leaveDates.add(d);
  }

  // While the month is running, the last few working days with nothing logged are pending, not absences (Hookka).
  const pending = new Set<string>();
  if (p.throughDay < allDates[allDates.length - 1]) {
    for (const d of [...workingDates].sort().reverse()) {
      if (pending.size >= rules.absenceGraceWorkingDays) break;
      if (!worked.has(d) && !leaveDates.has(d)) pending.add(d);
    }
  }

  const monthly = e.payBasis === 'monthly';
  const basic = monthly ? p.basicSalarySen : 0;
  const divisor = rules.dayRateDivisorMode === 'calendarDays' ? allDates.length
    : rules.dayRateDivisorMode === 'workingDays' ? allDates.filter(isWorking).length : e.workingDaysPerMonth;
  const dayRateExact = monthly ? basic / Math.max(1, divisor) : e.dailyRateSen;
  const lunchHours = shift ? rules.lunchMin / 60 : 0;
  const hourDivisor = rules.hourRateDivisorMode === 'fixed' ? rules.rateHoursPerDay
    : rules.hourRateDivisorMode === 'hoursOnly' ? hoursPerDay : hoursPerDay + lunchHours;
  const hourRateSen = Math.round(dayRateExact / Math.max(1, hourDivisor));
  const absentDays = monthly ? Math.max(0, workingDates.size - daysWorked - leaveDates.size - pending.size) : 0;
  const absenceDeductionSen = Math.round(absentDays * dayRateExact);

  let otMin = 0, sundayMin = 0, holidayMin = 0, dockMin = 0;
  for (const [date, d] of worked) {
    if (isSunday(date)) sundayMin += d.minutes;
    else if (holidays.has(date)) holidayMin += d.minutes;
    else { otMin += d.otMin; dockMin += d.dockMin; }
  }
  const otHours = round2(otMin / 60), sundayHours = round2(sundayMin / 60), holidayHours = round2(holidayMin / 60);
  const lateShortHours = round2(dockMin / 60);
  const otSen = Math.round(otHours * hourRateSen * e.otMultiplier);
  const sundaySen = Math.round(sundayHours * hourRateSen * rules.sundayMultiplier);
  const holidaySen = Math.round(holidayHours * hourRateSen * rules.holidayMultiplier);
  const lateShortSen = Math.round(lateShortHours * hourRateSen);

  const basicEarnedSen = (monthly ? basic - absenceDeductionSen : Math.round(daysWorked * e.dailyRateSen)) - lateShortSen;
  const grossSen = basicEarnedSen + otSen + sundaySen + holidaySen;

  // EPF on the basic (Hookka passes the full basic) or on what the month earned; a daily-paid person's basic is earned.
  const epfBase = Math.max(0, monthly && rules.epfOn === 'basic' ? basic : basicEarnedSen);
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

  // Hookka's resolveLeadershipAllowanceSen: the share of the person's working days a month not missed.
  const daysPerMonth = Math.max(1, e.workingDaysPerMonth);
  const allowanceSen = e.leaderAllowanceSen > 0 ? Math.round((e.leaderAllowanceSen * Math.max(0, daysPerMonth - absentDays)) / daysPerMonth) : 0;
  const grossWithAllowanceSen = grossSen + allowanceSen;

  const totalDeductionsSen = epfEmployeeSen + socsoEmployeeSen + eisEmployeeSen + pcb.pcbSen;
  return {
    basicSalarySen: basic, dayRateSen: Math.round(dayRateExact), hourRateSen,
    workingDays: workingDates.size, daysWorked, paidLeaveDays: leaveDates.size, absentDays, absenceDeductionSen,
    otHours, otSen, sundayHours, sundaySen, holidayHours, holidaySen, lateShortHours, lateShortSen, allowanceSen, grossSen: grossWithAllowanceSen,
    epfEmployeeSen, epfEmployerSen, socsoEmployeeSen, socsoEmployerSen, eisEmployeeSen, eisEmployerSen,
    pcbSen: pcb.pcbSen, pcbStatus: pcb.status, pcbNote: pcb.note,
    advanceSen: p.advanceSen, penaltySen: p.penaltySen, totalDeductionsSen, netSen: grossWithAllowanceSen - totalDeductionsSen - p.advanceSen - p.penaltySen,
  };
}
