/* Worker actual hours on a production order (TODO item 16; Hookka's working-hour entries, reimplemented for Conts).
   A worker presses Start time when they begin on the order and Stop when they leave it; a supervisor can add or correct
   an entry by hand. Actual hours are the sum of the entries; the budget is the order's Production time
   (production_orders.production_time_hours), typed by management and never worked out from the plan dates. The plan
   dates, the budget and the actual hours stay three separate things (production-hours rule).

   Pure: the routes (routes/production-hours.ts) read and write, this file decides. */

export type TimeEntry = {
  id: string;
  person_key: string;
  name: string;
  started_at: string;
  stopped_at: string | null;
  notes?: string | null;
  how?: string | null;
};

/** One entry may not run longer than this: a timer left on overnight is corrected, not counted as 30 hours. */
export const MAX_ENTRY_MINUTES = 16 * 60;

const ms = (iso: string): number => Date.parse(iso);

/** Whole minutes of one entry; a running one counts up to `now`, never past the limit (Stop would cap it there too). */
export function entryMinutes(e: Pick<TimeEntry, 'started_at' | 'stopped_at'>, now: Date): number {
  const start = ms(e.started_at);
  const end = e.stopped_at ? ms(e.stopped_at) : Math.min(now.getTime(), start + MAX_ENTRY_MINUTES * 60_000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

export type PersonHours = { personKey: string; name: string; minutes: number; running: boolean; entries: number };
export type HoursSummary = {
  actualMinutes: number;
  /** null when management has not set a Production time. */
  budgetMinutes: number | null;
  /** actual - budget; positive is over budget. null without a budget. */
  varianceMinutes: number | null;
  overBudget: boolean;
  running: number;
  people: PersonHours[];
};

export function summarizeHours(entries: readonly TimeEntry[], budgetHours: number | null, now: Date): HoursSummary {
  const people = new Map<string, PersonHours>();
  let actual = 0;
  let running = 0;
  for (const e of entries) {
    const m = entryMinutes(e, now);
    actual += m;
    if (!e.stopped_at) running += 1;
    const p = people.get(e.person_key) ?? { personKey: e.person_key, name: e.name, minutes: 0, running: false, entries: 0 };
    p.minutes += m;
    p.entries += 1;
    p.running ||= !e.stopped_at;
    people.set(e.person_key, p);
  }
  const budgetMinutes = budgetHours == null || !Number.isFinite(budgetHours) ? null : Math.round(budgetHours * 60);
  const varianceMinutes = budgetMinutes == null ? null : actual - budgetMinutes;
  return {
    actualMinutes: actual, budgetMinutes, varianceMinutes, overBudget: varianceMinutes != null && varianceMinutes > 0, running,
    people: [...people.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)),
  };
}

/** Minutes as hours with one decimal, the way the budget is typed (7.5). */
export const hoursOf = (minutes: number): number => Math.round(minutes / 6) / 10;

/** A typed or edited entry: both ends real times, the stop after the start, nothing in the future, not overlong. */
export function checkEntryTimes(startedAt: unknown, stoppedAt: unknown, now: Date): { ok: true; startedAt: string; stoppedAt: string } | { ok: false; message: string } {
  const s = typeof startedAt === 'string' ? ms(startedAt) : NaN;
  const e = typeof stoppedAt === 'string' ? ms(stoppedAt) : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, message: 'Give a start and a stop time.' };
  if (e <= s) return { ok: false, message: 'The stop time must be after the start time.' };
  if (e > now.getTime() + 60_000) return { ok: false, message: 'The stop time is in the future.' };
  if ((e - s) / 60_000 > MAX_ENTRY_MINUTES) return { ok: false, message: `One entry can be at most ${MAX_ENTRY_MINUTES / 60} hours. Split it into days.` };
  return { ok: true, startedAt: new Date(s).toISOString(), stoppedAt: new Date(e).toISOString() };
}

/** Stopping a running timer: past MAX_ENTRY_MINUTES it stops at the limit, and says so, rather than count a forgotten night. */
export function stopTimeFor(startedAt: string, now: Date): { stoppedAt: string; capped: boolean } {
  const cap = ms(startedAt) + MAX_ENTRY_MINUTES * 60_000;
  if (now.getTime() > cap) return { stoppedAt: new Date(cap).toISOString(), capped: true };
  /* Stop in the same instant as Start (a double tap) still ends after it: the row's check wants stop > start. It counts 0. */
  return { stoppedAt: new Date(Math.max(now.getTime(), ms(startedAt) + 1000)).toISOString(), capped: false };
}

/** A running timer older than the limit: it is closed at the limit before anything new starts. */
export const isStale = (startedAt: string, now: Date): boolean => now.getTime() > ms(startedAt) + MAX_ENTRY_MINUTES * 60_000;

/** Two entries of one person may not overlap: the same hour is not worked twice on one order. */
export function overlaps(entries: readonly TimeEntry[], personKey: string, startedAt: string, stoppedAt: string | null, exceptId: string | null, now: Date): TimeEntry | null {
  const s = ms(startedAt);
  const e = stoppedAt ? ms(stoppedAt) : now.getTime();
  for (const x of entries) {
    if (x.person_key !== personKey || x.id === exceptId) continue;
    const xs = ms(x.started_at);
    const xe = x.stopped_at ? ms(x.stopped_at) : now.getTime();
    if (s < xe && xs < e) return x;
  }
  return null;
}
