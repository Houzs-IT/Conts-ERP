import { z } from 'zod';

/**
 * Leave rules (migration 0164, PLAN-hr-employees.md phase 3), ported from Hookka's src/lib/leave-entitlement.ts. The one
 * place allowances, chargeable days and the leave year are decided. No database code: the portal, the desk, the API and
 * the tests share it, so the phone and the office can never show two different balances (Hookka's bug C4).
 */

export const LEAVE_TYPES = ['annual', 'medical', 'emergency', 'unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = { annual: 'Annual', medical: 'Medical', emergency: 'Emergency', unpaid: 'Unpaid' };
/** The two types that draw down a yearly allowance. Emergency and unpaid are recorded only. */
export const ALLOWANCE_TYPES = ['annual', 'medical'] as const;
export type AllowanceType = (typeof ALLOWANCE_TYPES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/**
 * Employment Act 1955 minimums by completed years of service: s.60E annual leave and s.60F paid sick leave (not
 * hospitalised). Used when the employee record has no number of its own. Hookka kept a flat 8 / 14 to avoid changing
 * existing balances; The Conts starts fresh and its Employees form already promises "the Act" (owner, 26 Oct 2026).
 * ponytail: no pro-rating for a first part-year and no hospitalisation leave; add them when someone asks.
 */
const TIERS: Record<AllowanceType, { minYears: number; days: number }[]> = {
  annual: [{ minYears: 0, days: 8 }, { minYears: 2, days: 12 }, { minYears: 5, days: 16 }],
  medical: [{ minYears: 0, days: 14 }, { minYears: 2, days: 18 }, { minYears: 5, days: 22 }],
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v);
const utc = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** The inclusive calendar span, weekends included (there is no rest-day list to take them off). */
export function calendarDays(start: string, end: string): number {
  return Math.round((utc(end) - utc(start)) / 86_400_000) + 1;
}

/** Whole years of service from the join date up to `on`. Null without a join date. */
export function serviceYears(joinDate: string | null, on: string): number | null {
  if (!isDay(joinDate)) return null;
  if (!isDay(on) || on < joinDate) return 0;
  let years = Number(on.slice(0, 4)) - Number(joinDate.slice(0, 4));
  if (on.slice(5) < joinDate.slice(5)) years -= 1;
  return Math.max(0, years);
}

export interface PublicHoliday { date: string; name: string }

/** The days a request takes from its allowance: its span less the public holidays inside it. */
export function chargeableDays(l: { startDate: string; endDate: string; days: number }, holidays: readonly PublicHoliday[]): number {
  const off = holidays.filter(h => h.date >= l.startDate && h.date <= l.endDate).length;
  return Math.max(0, l.days - off);
}

export interface AllowanceSource { joinDate: string | null; annualLeaveDays: number | null; medicalLeaveDays: number | null }

/** Days a year for one type: the employee record's own number, otherwise the Act's tier for their service on `on`
 *  (today, or the last day of a past year). Without a join date the first tier applies. */
export function allowanceDays(type: AllowanceType, e: AllowanceSource, on: string): number {
  const own = type === 'annual' ? e.annualLeaveDays : e.medicalLeaveDays;
  if (own !== null) return own;
  const years = serviceYears(e.joinDate, on) ?? 0;
  return TIERS[type].reduce((days, t) => (years >= t.minYears ? t.days : days), TIERS[type][0].days);
}

export interface LeaveLike { type: LeaveType; status: LeaveStatus; startDate: string; endDate: string; days: number }
export interface Balance { type: AllowanceType; year: number; allowance: number; used: number; pending: number; left: number }

/**
 * One type's balance in one leave year (the calendar year of each request's start date, as on Hookka). Approved
 * requests count as used, pending ones are shown apart so an approver sees what approving would leave. Not clamped
 * at zero: an overdrawn balance is what the approver needs to see.
 */
export function balance(type: AllowanceType, e: AllowanceSource, leaves: readonly LeaveLike[], year: number, holidays: readonly PublicHoliday[], today: string): Balance {
  const on = String(year) === today.slice(0, 4) ? today : `${year}-12-31`;
  const inYear = leaves.filter(l => l.type === type && l.startDate.startsWith(`${year}-`));
  const sum = (status: LeaveStatus) => inYear.filter(l => l.status === status).reduce((n, l) => n + chargeableDays(l, holidays), 0);
  const allowance = allowanceDays(type, e, on);
  const used = sum('approved');
  return { type, year, allowance, used, pending: sum('pending'), left: allowance - used };
}

/** What a person sends to apply. Dates are Malaysia days. */
export const leaveRequest = z.object({
  type: z.enum(LEAVE_TYPES),
  startDate: z.string().regex(DAY, 'Pick a date.'),
  endDate: z.string().regex(DAY, 'Pick a date.'),
  reason: z.string().trim().max(500).transform(v => v || null).nullable().default(null),
}).refine(r => r.endDate >= r.startDate, { path: ['endDate'], message: 'The last day is before the first day.' })
  .refine(r => r.endDate < r.startDate || calendarDays(r.startDate, r.endDate) <= 60, { path: ['endDate'], message: 'Apply for at most 60 days at a time.' });
export type LeaveRequest = z.infer<typeof leaveRequest>;

/** The holiday list the office keeps: unique dates, sorted. */
export const holidayList = z.array(z.object({ date: z.string().regex(DAY, 'Use a date.'), name: z.string().trim().min(1, 'Name the holiday.').max(80) }))
  .max(200)
  .refine(list => new Set(list.map(h => h.date)).size === list.length, { message: 'Each date once.' })
  .transform(list => [...list].sort((a, b) => a.date.localeCompare(b.date)));

/** The stored list; none when it was never set. A broken list throws rather than reading as "no holidays", which
 *  would quietly charge every holiday to everyone's leave. Only the Leave tab writes it, through holidayList. */
export function parseHolidays(raw: string | null | undefined): PublicHoliday[] {
  if (!raw) return [];
  const r = holidayList.safeParse(JSON.parse(raw));
  if (!r.success) throw new Error(`The public holiday list in settings (hr.public_holidays) is not valid: ${r.error.issues[0]?.message ?? 'unknown'}`);
  return r.data;
}
