/* The unit key log (owner, 14 Oct 2026): every move newest first, with how many
   days the receiver held the key (until the next move, or until today for the
   current holder). Pure. */

const DAY_MS = 86_400_000;

/** Whole calendar days from `from` to `to` (YYYY-MM-DD), never negative. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

export function keyLogRows<T extends { id: number; moved_on: string }>(moves: readonly T[], today: string): Array<T & { daysHeld: number; current: boolean }> {
  const sorted = [...moves].sort((x, y) => (x.moved_on === y.moved_on ? y.id - x.id : x.moved_on < y.moved_on ? 1 : -1));
  return sorted.map((m, i) => ({
    ...m,
    daysHeld: daysBetween(m.moved_on, i === 0 ? today : sorted[i - 1]!.moved_on),
    current: i === 0,
  }));
}
