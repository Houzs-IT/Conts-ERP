export const NO_BEDS = 'no_beds';
export const bedKey = (size: string): string => `bed:${size}`;

/** How a clean priced by beds reads a unit's beds (settings 'cleaning.bedPricing', servicePrices.bedPricingMode):
 *  - 'size': each bed size has a price, times its quantity, added up (owner, 6 Nov 2026). Rows 'bed:<size>'.
 *  - 'count': one price per NUMBER of beds (chew, 10 Nov 2026: YJ's pay "根据床来算"). Rows 'beds:1' to 'beds:6', the
 *    last for six or more.
 *  Either way a unit with no beds takes the 'no_beds' row. */
export type BedPricing = 'size' | 'count';
export const BED_COUNT_ROWS = 6;
export const bedCountKey = (n: number): string => `beds:${Math.min(Math.max(1, Math.floor(n)), BED_COUNT_ROWS)}`;
export const isBedGridKey = (key: string, mode: BedPricing = 'size'): boolean =>
  key === NO_BEDS || key.startsWith(mode === 'count' ? 'beds:' : 'bed:');

/** Not a bed when beds are counted. The owners' cleaning charges never counted a floor mattress or a sofa bed
 *  (production, 10 Nov 2026: a unit with 2 queens and 2 floor mattresses pays the 2-bed price), and YJ's pay follows
 *  the same rule (chew: "因为owner 算法没有变"). */
export const NOT_COUNTED: ReadonlySet<string> = new Set(['single_floor_mattress', 'sofa_bed']);

export interface BedCount { size: string; quantity: number }
/** A price row: what the owner is charged, the cleaner's pay, and (migration 0257) what a guest is charged. */
export interface DatedFigures { owner_price: number | null; internal_cost: number | null; guest_price?: number | null; effective_from: string }

export const countedBeds = (beds: readonly BedCount[]): number => beds.reduce((n, bed) => n + (NOT_COUNTED.has(bed.size) ? 0 : bed.quantity), 0);

/** The price grid's rows when priced by number of beds: '1 bed' to '6 or more beds', then 'No beds recorded'. */
export function bedCountRows(): { keys: string[]; labels: Record<string, string> } {
  const keys = Array.from({ length: BED_COUNT_ROWS }, (_, n) => bedCountKey(n + 1));
  const label = (n: number) => (n === 1 ? '1 bed' : n === BED_COUNT_ROWS ? `${n} or more beds` : `${n} beds`);
  return { keys: [...keys, NO_BEDS], labels: { ...Object.fromEntries(keys.map((key, n) => [key, label(n + 1)])), [NO_BEDS]: 'No beds recorded' } };
}

const isBedCount = (value: unknown): value is BedCount =>
  typeof value === 'object' && value !== null
  && typeof (value as BedCount).size === 'string' && (value as BedCount).size !== ''
  && Number.isInteger((value as BedCount).quantity) && (value as BedCount).quantity > 0;

export function parseBeds(stored: unknown): BedCount[] {
  const value: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored;
  return Array.isArray(value) ? value.filter(isBedCount) : [];
}

const sumField = (beds: readonly BedCount[], rows: readonly (DatedFigures | null)[], field: 'owner_price' | 'internal_cost' | 'guest_price'): number | null => {
  let total = 0;
  for (const [index, bed] of beds.entries()) {
    const price = rows[index]?.[field];
    if (price == null) return null;
    total += Number(price) * bed.quantity;
  }
  return total;
};

export function priceFromBeds(beds: readonly BedCount[], priceOf: (size: string) => DatedFigures | null): DatedFigures | null {
  if (!beds.length) return null;
  const rows = beds.map(bed => priceOf(bed.size));
  const dates = rows.flatMap(row => (row ? [row.effective_from] : []));
  if (!dates.length) return null;
  return {
    owner_price: sumField(beds, rows, 'owner_price'),
    internal_cost: sumField(beds, rows, 'internal_cost'),
    guest_price: sumField(beds, rows, 'guest_price'),
    effective_from: dates.sort()[dates.length - 1],
  };
}

/** A unit's price from the bed grid. `priceOf` answers a grid row ('bed:queen', 'beds:2', 'no_beds') on the job's day. */
export function priceByBeds(mode: BedPricing, beds: readonly BedCount[], priceOf: (key: string) => DatedFigures | null): DatedFigures | null {
  if (mode === 'count') {
    const n = countedBeds(beds);
    return priceOf(n > 0 ? bedCountKey(n) : NO_BEDS);
  }
  if (!beds.length) return priceOf(NO_BEDS);
  return priceFromBeds(beds, size => priceOf(bedKey(size)));
}
