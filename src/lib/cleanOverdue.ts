/** Pure (no imports) so node --test can load it, and the server (functions/) imports it too: one rule everywhere. */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** HH:MM in Malaysia of an ISO instant, and its Malaysian day. */
function mytParts(iso: string): { day: string; hm: string } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const s = new Date(ms + 8 * 3600e3).toISOString();
  return { day: s.slice(0, 10), hm: s.slice(11, 16) };
}

export interface NextCheckInInput {
  /** The job's Malaysian day, YYYY-MM-DD. */
  day: string;
  /** The next guest's booking's check-in time (reservations.check_in_time); null when no guest arrives that day. */
  reservationTime: string | null | undefined;
  /** The job's own "next guest" instant (tasks.next_guest_at): the time HostPlatform's cleaning job carries, or the one
   *  staff last set on the Cleaning page. */
  taskNextGuestAt?: string | null;
  /** The standard check-in time (settings operations.checkIn, 15:00). */
  standard?: string;
}

/**
 * The next guest's real check-in time on a cleaning job, HH:MM, or null when no guest arrives on the job's day.
 * A booking's own time wins once someone set it away from the standard (an early check-in typed on the Cleaning page);
 * otherwise the job's own next-guest time, when it is on the job's day (HostPlatform's job says 13:00 while the booking
 * still carries the 15:00 default: owner, 2 Nov 2026); otherwise the booking's time or the standard.
 */
export function nextCheckIn({ day, reservationTime, taskNextGuestAt, standard = '15:00' }: NextCheckInInput): string | null {
  if (reservationTime === null || reservationTime === undefined) return null;
  const booked = HHMM.test(reservationTime) ? reservationTime : null;
  if (booked && booked !== standard) return booked;
  const own = taskNextGuestAt ? mytParts(taskNextGuestAt) : null;
  if (own && own.day === day) return own.hm;
  return booked ?? (HHMM.test(standard) ? standard : '15:00');
}

/** The day after a YYYY-MM-DD day. */
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

/**
 * When a cleaning job becomes overdue (owner, 2 Nov 2026), as epoch milliseconds: at the next guest's check-in time on
 * the job's day; with no check-in that day, at midnight at the end of the job's day (it must be cleaned the same day).
 * Malaysia time. NaN for a day that is not YYYY-MM-DD.
 */
export function cleanDeadline(day: string, checkIn: string | null | undefined): number {
  if (!DAY.test(day)) return NaN;
  return checkIn && HHMM.test(checkIn) ? Date.parse(`${day}T${checkIn}:00+08:00`) : Date.parse(`${nextDay(day)}T00:00:00+08:00`);
}

export interface CleanOverdueInput { day: string; checkIn: string | null | undefined; done: boolean }

/** A cleaning job still not done at its deadline (cleanDeadline) is overdue. */
export function isCleanOverdue({ day, checkIn, done }: CleanOverdueInput, now: number): boolean {
  if (done) return false;
  const at = cleanDeadline(day, checkIn);
  return Number.isFinite(at) && now >= at;
}

/** Whole days between the job's day and today (Malaysia), 0 for today or later: "Overdue · 2 days". */
export function daysPast(day: string, now: number): number {
  if (!DAY.test(day)) return 0;
  const today = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 864e5));
}
