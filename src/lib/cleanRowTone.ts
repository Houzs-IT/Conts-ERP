/** Pure (no imports) so node --test can load it. */

/** `overdue`: red, `out`: yellow, null: no colour. */
export type CleanRowTone = 'overdue' | 'out' | null;

export interface CleanRowToneInput { day: string; status: string; guestOut: boolean; checkOutTime: string | null }

/**
 * The whole-row colour of a clean on the Cleaning board (CS, 26 Oct 2026). Red once the departing guest's checkout
 * time (Malaysia) has passed and nobody has ticked them out; yellow once they are out (or the cleaner has started) and
 * the clean is not finished. A clean with no departing guest (`checkOutTime` null) is never red.
 */
export function cleanRowTone({ day, status, guestOut, checkOutTime }: CleanRowToneInput, now: number): CleanRowTone {
  if (status === 'done') return null;
  if (guestOut || status === 'cleaning') return 'out';
  if (checkOutTime == null) return null;
  const hm = /^\d{2}:\d{2}$/.test(checkOutTime) ? checkOutTime : '11:00';
  return Date.parse(`${day}T${hm}:00+08:00`) <= now ? 'overdue' : null;
}
