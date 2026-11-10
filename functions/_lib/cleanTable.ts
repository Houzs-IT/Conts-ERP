/** The cleaning price table by number of beds (chew, 10 Nov 2026): one table, a row per number of beds, and for Basic
 *  clean and Deep clean what the owner is charged, what a guest is charged and the cleaner's pay. Saved from one date
 *  for both clean types at once (POST /api/housekeeping/clean-prices). Amounts in sen; null = not set. */

export interface CleanFigures { owner: number | null; guest: number | null; cost: number | null }
export interface CleanTableRow { layout: string; basic: CleanFigures; deep: CleanFigures }
type ItemRow = { layout: string; ownerPrice: number | null; internalCost: number | null; guestPrice: number | null };
export interface CleanTableSet { effectiveFrom: string; note: string | null; basic: ItemRow[]; deep: ItemRow[] }

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isAmount = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000_000);
const bad = (message: string, field: string) => ({ error: { message, field } });

/** Checks a whole table sent to be saved. `keys` are the table's rows (bedCountRows().keys). */
export function checkCleanTable(body: unknown, keys: readonly string[]): CleanTableSet | { error: { message: string; field: string } } {
  const b = body as { effectiveFrom?: unknown; note?: unknown; rows?: unknown } | null;
  if (!b || typeof b !== 'object') return bad('Send the price table.', 'rows');
  if (!isDay(b.effectiveFrom)) return bad('Pick the date the prices apply from.', 'effectiveFrom');
  if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > keys.length) return bad('Enter the prices.', 'rows');
  const seen = new Set<string>();
  const basic: ItemRow[] = [], deep: ItemRow[] = [];
  for (const raw of b.rows as unknown[]) {
    const r = raw as { layout?: unknown; basic?: Partial<CleanFigures>; deep?: Partial<CleanFigures> } | null;
    const layout = typeof r?.layout === 'string' ? r.layout : '';
    if (!keys.includes(layout) || seen.has(layout)) return bad('Unknown or repeated row in the price table.', 'rows');
    seen.add(layout);
    for (const [side, out] of [['basic', basic], ['deep', deep]] as const) {
      const f = r?.[side] ?? {};
      const figures = [f.owner ?? null, f.guest ?? null, f.cost ?? null];
      if (!figures.every(isAmount)) return bad('Prices are RM 0.00 or more, or empty.', 'rows');
      out.push({ layout, ownerPrice: f.owner ?? null, guestPrice: f.guest ?? null, internalCost: f.cost ?? null });
    }
  }
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 300) : null;
  return { effectiveFrom: b.effectiveFrom, note, basic, deep };
}
