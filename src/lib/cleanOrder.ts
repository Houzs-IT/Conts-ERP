/** Pure (no imports) so node --test can load it. */

/**
 * What the cleaner's order needs from one job. `checkIn` is the next guest's check-in, "HH:MM" (Malaysia), or null when
 * nobody is booked in. `checkInDay` is the day of that check-in (YYYY-MM-DD); left out, it is the job's own `day`.
 * `guestIn` is a departing guest who has not left yet (the unit cannot be cleaned now); `checkOut` is when they are due
 * out, "HH:MM" on the job's day: the standard checkout or the late checkout's time.
 */
export interface CleanOrderInput {
  checkIn: string | null; checkInDay?: string | null; day?: string | null;
  guestIn?: boolean; checkOut?: string | null;
  done?: boolean; building?: string | null; unit?: string | null;
}

/** A check-in after this time on the job's day, or on a later day, is "very late": those units are cleaned last
 *  (owner, 2 Nov 2026). Change it here and the board, the phone list and the cleaner's portal all follow. */
export const VERY_LATE_CHECK_IN = '20:00';

const HHMM = /^\d{2}:\d{2}$/;

/** 0: a guest arrives on the job's day by 20:00. 1: no guest booked in. 2: a very late arrival (after 20:00, or a later day). */
export function checkInBucket(checkIn: string | null | undefined, checkInDay?: string | null, day?: string | null): 0 | 1 | 2 {
  if (!checkIn || !HHMM.test(checkIn)) return 1;
  if (checkInDay && day && checkInDay > day) return 2;
  return checkIn > VERY_LATE_CHECK_IN ? 2 : 0;
}

/** When the next guest arrives, comparable as text: "2026-11-02T14:00". */
const arrival = (x: CleanOrderInput) => `${x.checkInDay ?? x.day ?? ''}T${x.checkIn}`;
/** When the departing guest is due out, comparable as text; no readable time sorts last among them. */
const departure = (x: CleanOrderInput) => `${x.day ?? ''}T${x.checkOut && HHMM.test(x.checkOut) ? x.checkOut : '99:99'}`;

/**
 * The order a cleaner works in inside one building (owner, 2 Nov 2026):
 *   1. units that can be cleaned now (the guest has left, or nobody was staying): the soonest next check-in first; then
 *      units nobody is booked into (a last-minute booking can still come); then very late arrivals (after 20:00, or on
 *      a later day), soonest first;
 *   2. units whose guest has not left yet, by when they are due out (11:00, or the late checkout), earliest first: no
 *      point going there first;
 *   3. finished jobs, at the bottom.
 * Ties fall back to the next check-in rule, then building, then unit number read as numbers (B-08-11 before B-10-02),
 * so the list stays put between reloads.
 */
export function compareForCleaner(a: CleanOrderInput, b: CleanOrderInput): number {
  const done = Number(!!a.done) - Number(!!b.done);
  if (done) return done;
  const waiting = Number(!!a.guestIn) - Number(!!b.guestIn);
  if (waiting) return waiting;
  if (a.guestIn && b.guestIn) {
    const at = departure(a), bt = departure(b);
    if (at !== bt) return at < bt ? -1 : 1;
  }
  const ba = checkInBucket(a.checkIn, a.checkInDay, a.day), bb = checkInBucket(b.checkIn, b.checkInDay, b.day);
  if (ba !== bb) return ba - bb;
  if (ba !== 1) {
    const at = arrival(a), bt = arrival(b);
    if (at !== bt) return at < bt ? -1 : 1;
  }
  const building = (a.building ?? '').localeCompare(b.building ?? '');
  if (building) return building;
  return (a.unit ?? '').localeCompare(b.unit ?? '', undefined, { numeric: true });
}

/** A sorted copy of `rows`, in the cleaner's order. */
export function sortForCleaner<T>(rows: readonly T[], key: (row: T) => CleanOrderInput): T[] {
  return rows.map(r => ({ r, k: key(r) })).sort((x, y) => compareForCleaner(x.k, y.k)).map(x => x.r);
}

/**
 * Building groups always in the same order, A to Z by name, with external jobs last (owner, 2 Nov 2026: the same every
 * day, so cleaners learn where each building is). Urgency orders the jobs inside a building, never the buildings.
 */
export function sortBuildings<G>(groups: readonly G[], name: (g: G) => string, last?: (g: G) => boolean): G[] {
  return [...groups].sort((a, b) => Number(last?.(a) ?? false) - Number(last?.(b) ?? false)
    || name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: 'base' }));
}
