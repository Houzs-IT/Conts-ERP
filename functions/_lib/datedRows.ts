/** Which dated row applies on a day: a price or a contract set ahead takes over by itself, with nothing to run on the day. */

/** The row in force on `day` among rows sorted newest first. */
export const inForce = <T extends { effective_from: string }>(rows: T[] | undefined, day: string): T | null => rows?.find(r => r.effective_from <= day) ?? null;

/** The contract in force today when the unit's current one starts later (a new contract given a start date ahead):
 *  the newest earlier one that has begun. Null when the current one has begun, or there is none before it. */
export function heldContract<T extends { id: string; starts_on: string | null }>(current: T | null, rows: T[], today: string): T | null {
  if (!current?.starts_on || current.starts_on.slice(0, 10) <= today) return null;
  return rows.filter(r => r.id !== current.id && r.starts_on && r.starts_on.slice(0, 10) <= today)
    .sort((a, b) => String(b.starts_on).localeCompare(String(a.starts_on)))[0] ?? null;
}
