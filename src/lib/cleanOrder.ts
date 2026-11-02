/** Pure (no imports) so node --test can load it. */

/**
 * What the cleaner's order needs from one job. `checkIn` is the next guest's check-in, "HH:MM" (Malaysia), or null when
 * nobody is booked in. `checkInDay` is the day of that check-in (YYYY-MM-DD); left out, it is the job's own `day`.
 */
export interface CleanOrderInput {
  checkIn: string | null; checkInDay?: string | null; day?: string | null;
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

/**
 * The order a cleaner works in (owner, 2 Nov 2026): the soonest next check-in first; then units nobody is booked into
 * yet (a last-minute booking can still come, so they are next); then very late arrivals (after 20:00, or on a later
 * day), soonest first. Finished jobs go to the bottom, in the same order, so the next job is always at the top. Ties
 * fall back to building, then unit number read as numbers (B-08-11 before B-10-02), so the list stays put between reloads.
 */
export function compareForCleaner(a: CleanOrderInput, b: CleanOrderInput): number {
  const done = Number(!!a.done) - Number(!!b.done);
  if (done) return done;
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
 * Building groups in order of their most urgent job (the first one in the cleaner's order), so the building that needs
 * someone soonest is at the top. External jobs always last; ties by building name. `jobs` lists a group's job keys.
 */
export function sortGroupsForCleaner<G>(groups: readonly G[], jobs: (g: G) => CleanOrderInput[], name: (g: G) => string, last?: (g: G) => boolean): G[] {
  const lead = (g: G) => jobs(g).reduce<CleanOrderInput | null>((m, k) => (!m || compareForCleaner(k, m) < 0 ? k : m), null);
  return groups.map(g => ({ g, k: lead(g), n: name(g), l: last?.(g) ?? false }))
    .sort((x, y) => Number(x.l) - Number(y.l)
      || (x.k && y.k ? compareForCleaner({ ...x.k, building: null, unit: null }, { ...y.k, building: null, unit: null }) : Number(!x.k) - Number(!y.k))
      || x.n.localeCompare(y.n))
    .map(x => x.g);
}
