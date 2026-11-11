/* What one Import SKUs row would do to the SKU it names: create it, change some
   fields, or nothing at all. The preview and the real import both call this, so
   the plan the operator confirms is the plan that is written (Hookka
   d36177ca0 / 2b04557df: pick a file, see the plan, apply).

   `row` is the write the import has already built: only filled cells are in it
   (a blank cell is never a value), so a field missing from `row` is "keep". */

export type SkuImportChange = { field: string; from: unknown; to: unknown };
export type SkuImportStatus = 'new' | 'changed' | 'unchanged';
export type SkuImportPlanRow = {
  code: string;
  name: string | null;
  status: SkuImportStatus;
  changes: SkuImportChange[];
};

/* The fields an import can write, in the order the preview lists them. */
export const SKU_IMPORT_FIELDS = [
  'name', 'category', 'sub_category', 'uom', 'status', 'description', 'base_model',
  'size_label', 'branding', 'base_price_sen', 'price1_sen', 'unit_m3_milli', 'seat_height_prices',
] as const;

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

/* Seat prices compare by content, not by the order the entries were stored in. */
function seatKey(v: unknown): string {
  if (!Array.isArray(v)) return '[]';
  const norm = (v as Array<Record<string, unknown>>).map((e) => {
    const keys = Object.keys(e).filter((k) => e[k] != null).sort();
    return JSON.stringify(keys.map((k) => [k, e[k]]));
  });
  return JSON.stringify(norm.sort());
}

export function sameImportValue(field: string, from: unknown, to: unknown): boolean {
  if (field === 'seat_height_prices') return seatKey(from) === seatKey(to);
  if (blank(from) && blank(to)) return true;
  if (blank(from) || blank(to)) return false;
  if (typeof from === 'number' || typeof to === 'number') return Number(from) === Number(to);
  return String(from).trim() === String(to).trim();
}

export function diffSkuImportRow(
  existing: Record<string, unknown> | null | undefined,
  row: Record<string, unknown>,
): { status: SkuImportStatus; changes: SkuImportChange[] } {
  const changes: SkuImportChange[] = [];
  for (const field of SKU_IMPORT_FIELDS) {
    if (!(field in row)) continue;
    const to = row[field];
    const from = existing ? existing[field] ?? null : null;
    if (existing && sameImportValue(field, from, to)) continue;
    if (!existing && blank(to)) continue;
    changes.push({ field, from, to });
  }
  if (!existing) return { status: 'new', changes };
  return { status: changes.length > 0 ? 'changed' : 'unchanged', changes };
}
