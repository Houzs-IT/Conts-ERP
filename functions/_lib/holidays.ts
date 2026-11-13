import { type Env, all, one } from './db';
import { hasColumn } from './auth';
import { can, type Level } from './access';
import type { PublicHoliday } from './leaveRules';

/** The company's one public holiday list (migration 0202): kept on Pricing > Public holidays and on HR > Workers >
 *  Leave, read by pricing (holiday prices, sent to Channex) and by leave and payroll (staff days off).
 *  Before 0202 the list lived in settings 'hr.public_holidays' and HR alone used it; readers fall back to it. */

export const holidaysReady = (env: Env): Promise<boolean> => hasColumn(env, 'public_holidays', 'id');
export const HOLIDAYS_NOT_MIGRATED = 'The shared public holiday list needs a database update (migration 0202) that has not been applied yet.';
export const OLD_HOLIDAYS_KEY = 'hr.public_holidays';

/** Malaysia's states and federal territories, as a holiday's state is stored. */
export const MY_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak',
  'Selangor', 'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
] as const;

const ALIASES: Record<string, string> = {
  pulaupinang: 'Penang', pinang: 'Penang', malacca: 'Melaka', ns: 'Negeri Sembilan', nsembilan: 'Negeri Sembilan',
  kl: 'Kuala Lumpur', wp: 'Kuala Lumpur', wilayahpersekutuan: 'Kuala Lumpur', federalterritory: 'Kuala Lumpur',
};
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** A building's free-text state ("Selangor", "WP Kuala Lumpur", "Pulau Pinang") as one of MY_STATES, or null when it
 *  is not recognised; a unit whose state is not recognised follows only the every-state holidays. */
export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = squash(raw);
  if (!s) return null;
  for (const st of MY_STATES) if (squash(st) === s) return st;
  const bare = s.replace(/^(wilayahpersekutuan|federalterritoryof|federalterritory|wp)/, '');
  for (const st of MY_STATES) if (bare && squash(st) === bare) return st;
  return ALIASES[s] ?? null;
}

export interface HolidayRow { id: string; date: string; name: string; state: string | null; staffDayOff: boolean; updatedAt: string }

export async function listHolidays(env: Env, from?: string, to?: string): Promise<HolidayRow[]> {
  const rows = await all<{ id: string; holiday_date: string; name: string; state: string | null; staff_day_off: boolean; updated_at: string }>(env, `
    SELECT id, holiday_date, name, state, staff_day_off, updated_at FROM public_holidays
    WHERE (?::text IS NULL OR holiday_date >= ?) AND (?::text IS NULL OR holiday_date <= ?)
    ORDER BY holiday_date, state NULLS FIRST`, from ?? null, from ?? null, to ?? null, to ?? null);
  return rows.map(r => ({ id: r.id, date: r.holiday_date, name: r.name, state: r.state, staffDayOff: !!r.staff_day_off, updatedAt: r.updated_at }));
}

/** Whether a holiday of `state` (null: every state) applies to a building in `buildingState`. */
export const appliesTo = (state: string | null, buildingState: string | null) => state === null || state === buildingState;

/** The holiday dates that apply to each unit between from and to (inclusive), by its building's state. Empty sets
 *  before migration 0202: the old list was HR's and never priced anything. */
export async function holidayDatesByUnit(env: Env, units: { id: string; state: string | null }[], from: string, to: string): Promise<Map<string, Set<string>>> {
  const out = new Map(units.map(u => [u.id, new Set<string>()]));
  if (!units.length || !(await holidaysReady(env))) return out;
  const rows = await all<{ holiday_date: string; state: string | null }>(env, 'SELECT holiday_date, state FROM public_holidays WHERE holiday_date BETWEEN ? AND ?', from, to);
  for (const u of units) {
    const st = normalizeState(u.state);
    const set = out.get(u.id)!;
    for (const h of rows) if (appliesTo(h.state, st)) set.add(h.holiday_date);
  }
  return out;
}

/** The staff days off that leave and payroll count: every entry marked as one, one per date. */
export async function staffHolidays(env: Env): Promise<PublicHoliday[] | null> {
  if (!(await holidaysReady(env))) return null;
  const rows = await all<{ holiday_date: string; name: string }>(env, `
    SELECT DISTINCT ON (holiday_date) holiday_date, name FROM public_holidays WHERE staff_day_off ORDER BY holiday_date, state NULLS FIRST`);
  return rows.map(r => ({ date: r.holiday_date, name: r.name }));
}

/** A starting list of Malaysia's national public holidays to load and then check against the official gazette
 *  (the Prime Minister's Department publishes it each year). Typed in by hand on 2 Nov 2026. The Islamic and lunar
 *  dates (check: true) depend on the moon sighting and can move by a day; replacement holidays for a holiday on a
 *  weekend are announced each year and are not included. */
export const MALAYSIA_HOLIDAYS: Record<number, { date: string; name: string; check?: boolean }[]> = {
  2026: [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-02-17', name: 'Chinese New Year', check: true },
    { date: '2026-02-18', name: 'Chinese New Year (second day)', check: true },
    { date: '2026-03-20', name: 'Hari Raya Aidilfitri', check: true },
    { date: '2026-03-21', name: 'Hari Raya Aidilfitri (second day)', check: true },
    { date: '2026-05-01', name: 'Labour Day' },
    { date: '2026-05-27', name: 'Hari Raya Haji', check: true },
    { date: '2026-05-31', name: 'Wesak Day', check: true },
    { date: '2026-06-01', name: "Agong's Birthday" },
    { date: '2026-06-17', name: 'Awal Muharram', check: true },
    { date: '2026-08-25', name: 'Maulidur Rasul', check: true },
    { date: '2026-08-31', name: 'National Day' },
    { date: '2026-09-16', name: 'Malaysia Day' },
    { date: '2026-11-08', name: 'Deepavali', check: true },
    { date: '2026-12-25', name: 'Christmas Day' },
  ],
  2027: [
    { date: '2027-01-01', name: "New Year's Day" },
    { date: '2027-02-06', name: 'Chinese New Year', check: true },
    { date: '2027-02-07', name: 'Chinese New Year (second day)', check: true },
    { date: '2027-03-10', name: 'Hari Raya Aidilfitri', check: true },
    { date: '2027-03-11', name: 'Hari Raya Aidilfitri (second day)', check: true },
    { date: '2027-05-01', name: 'Labour Day' },
    { date: '2027-05-17', name: 'Hari Raya Haji', check: true },
    { date: '2027-05-20', name: 'Wesak Day', check: true },
    { date: '2027-06-06', name: 'Awal Muharram', check: true },
    { date: '2027-06-07', name: "Agong's Birthday" },
    { date: '2027-08-15', name: 'Maulidur Rasul', check: true },
    { date: '2027-08-31', name: 'National Day' },
    { date: '2027-09-16', name: 'Malaysia Day' },
    { date: '2027-10-28', name: 'Deepavali', check: true },
    { date: '2027-12-25', name: 'Christmas Day' },
  ],
};

/** The units a holiday of `state` (null: every state) applies to: rental units whose building is in that state. */
export async function unitsInState(env: Env, state: string | null): Promise<string[]> {
  const rows = await all<{ id: string; state: string | null }>(env, `SELECT u.id, p.state FROM units u JOIN properties p ON p.id = u.property_id`);
  return rows.filter(r => appliesTo(state, normalizeState(r.state))).map(r => r.id);
}

/** One holiday by id. */
export async function holidayById(env: Env, id: string): Promise<HolidayRow | null> {
  const r = await one<{ id: string; holiday_date: string; name: string; state: string | null; staff_day_off: boolean; updated_at: string }>(env,
    'SELECT id, holiday_date, name, state, staff_day_off, updated_at FROM public_holidays WHERE id = ?', id);
  return r ? { id: r.id, date: r.holiday_date, name: r.name, state: r.state, staffDayOff: !!r.staff_day_off, updatedAt: r.updated_at } : null;
}

/** Who may change the list: Full access to Pricing, or the HR access that edited the holiday list before it was shared
 *  (edit on Employees). Management has both. */
export const mayEditHolidays = (session: { role: string; levels?: Record<string, Level> }): boolean =>
  session.role === 'management' || can(session, 'pricing', 'full') || can(session, 'hr', 'edit');
/** Who may read it: anyone who can open Pricing or Employees. */
export const maySeeHolidays = (session: { role: string; levels?: Record<string, Level> }): boolean =>
  session.role === 'management' || can(session, 'pricing', 'view') || can(session, 'hr', 'view');

export interface HolidayInput { date: string; name: string; state: string | null; staffDayOff: boolean }
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d: string) => DAY.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** A holiday from a request body, merged over `was` when editing. state null or '' is every state. A new entry for
 *  every state is a staff day off unless said otherwise; a state's own holiday is not. */
export function readHolidayInput(b: any, was?: HolidayInput): { value: HolidayInput } | { field: string; message: string } {
  if (!b || typeof b !== 'object') return { field: 'date', message: 'Send the holiday.' };
  const date = b.date !== undefined ? String(b.date ?? '') : was?.date ?? '';
  if (!realDay(date)) return { field: 'date', message: 'Pick a date.' };
  const name = b.name !== undefined ? String(b.name ?? '').trim() : was?.name ?? '';
  if (!name) return { field: 'name', message: 'Name the holiday.' };
  if (name.length > 80) return { field: 'name', message: 'Keep the name under 80 characters.' };
  const rawState = b.state !== undefined ? b.state : was?.state ?? null;
  const state = rawState === null || rawState === '' ? null : MY_STATES.find(s => s === rawState) ?? null;
  if (rawState !== null && rawState !== '' && !state) return { field: 'state', message: 'Pick a state, or All states.' };
  const staffDayOff = typeof b.staffDayOff === 'boolean' ? b.staffDayOff : was?.staffDayOff ?? state === null;
  return { value: { date, name, state, staffDayOff } };
}
