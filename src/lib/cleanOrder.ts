/** Pure (no imports) so node --test can load it. */

/** What the cleaner's order needs from one job. `checkIn` is the next guest's check-in, "HH:MM" (Malaysia), or null. */
export interface CleanOrderInput { checkIn: string | null; done?: boolean; building?: string | null; unit?: string | null }

/** A check-in at or before this time is cleaned first (owner, 2 Nov 2026). */
export const EARLY_CHECK_IN = '15:00';

const HHMM = /^\d{2}:\d{2}$/;

/** 0: a guest arrives by 15:00. 1: no guest arriving. 2: a guest arrives from 15:01. */
export function checkInBucket(checkIn: string | null | undefined): 0 | 1 | 2 {
  if (!checkIn || !HHMM.test(checkIn)) return 1;
  return checkIn <= EARLY_CHECK_IN ? 0 : 2;
}

/**
 * The order a cleaner works in (owner, 2 Nov 2026): units whose next guest checks in by 15:00 first, earliest check-in
 * first; then units with no check-in; then units whose guest checks in after 15:00, earliest first. Finished jobs go
 * to the bottom, in the same order, so the next job is always at the top. Ties fall back to building, then unit
 * number read as numbers (B-08-11 before B-10-02), so the list stays put between reloads.
 */
export function compareForCleaner(a: CleanOrderInput, b: CleanOrderInput): number {
  const done = Number(!!a.done) - Number(!!b.done);
  if (done) return done;
  const ba = checkInBucket(a.checkIn), bb = checkInBucket(b.checkIn);
  if (ba !== bb) return ba - bb;
  if (ba !== 1 && a.checkIn !== b.checkIn) return a.checkIn! < b.checkIn! ? -1 : 1;
  const building = (a.building ?? '').localeCompare(b.building ?? '');
  if (building) return building;
  return (a.unit ?? '').localeCompare(b.unit ?? '', undefined, { numeric: true });
}

/** A sorted copy of `rows`, in the cleaner's order. */
export function sortForCleaner<T>(rows: readonly T[], key: (row: T) => CleanOrderInput): T[] {
  return rows.map(r => ({ r, k: key(r) })).sort((x, y) => compareForCleaner(x.k, y.k)).map(x => x.r);
}
