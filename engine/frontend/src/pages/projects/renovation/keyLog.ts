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

export interface KeyDraft { on: string; from: number | null; to: number | null }

/** Why a key pass cannot be saved yet, in words; null when it can. */
export function keyDraftRefusal(d: KeyDraft, today: string): string | null {
  if (!d.on) return "Give the date of the key pass.";
  if (d.on > today) return "A key pass cannot be in the future.";
  if (!d.to) return "Pick who received the key.";
  if (d.from != null && d.from === d.to) return "The key cannot pass from a person to the same person.";
  return null;
}
