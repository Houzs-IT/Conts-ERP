/** What a click on the Unit report's lockable amount shows before the server answers (Unit report locks; final review
 *  I1). A click puts an override on its cell and marks the cell busy; another click on a busy cell is ignored; once the
 *  answer is in, the override goes at the next reload, so what the server stored always wins. */
export interface ShownLock { by: string; at: string }
/** Per unit, per category: the lock the screen shows (null: shown open) until the report reloads. */
export type Overrides = Record<string, Partial<Record<string, ShownLock | null>>>;

export const cellKey = (unitId: string, stage: string): string => `${unitId}:${stage}`;

/** Starts a click on a cell, or answers false (ignore it) while that cell's last click is still on its way. */
export function startClick(busy: Set<string>, key: string): boolean {
  if (busy.has(key)) return false;
  busy.add(key);
  return true;
}

/** The overrides kept when the report reloads: only those whose click is still on its way. The same object comes back
 *  when nothing is dropped, so the screen does not draw again. */
export function settleOverrides(over: Overrides, busy: Set<string>): Overrides {
  let dropped = false;
  const next: Overrides = {};
  for (const [unitId, cells] of Object.entries(over)) {
    const left = Object.fromEntries(Object.entries(cells).filter(([stage]) => busy.has(cellKey(unitId, stage))));
    if (Object.keys(left).length !== Object.keys(cells).length) dropped = true;
    if (Object.keys(left).length) next[unitId] = left;
  }
  return dropped ? next : over;
}
