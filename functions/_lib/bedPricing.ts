export const NO_BEDS = 'no_beds';
export const bedKey = (size: string): string => `bed:${size}`;
export const isBedGridKey = (key: string): boolean => key === NO_BEDS || key.startsWith('bed:');

export interface BedCount { size: string; quantity: number }
export interface DatedFigures { owner_price: number | null; internal_cost: number | null; effective_from: string }

const isBedCount = (value: unknown): value is BedCount =>
  typeof value === 'object' && value !== null
  && typeof (value as BedCount).size === 'string' && (value as BedCount).size !== ''
  && Number.isInteger((value as BedCount).quantity) && (value as BedCount).quantity > 0;

export function parseBeds(stored: unknown): BedCount[] {
  const value: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored;
  return Array.isArray(value) ? value.filter(isBedCount) : [];
}

const sumField = (beds: readonly BedCount[], rows: readonly (DatedFigures | null)[], field: 'owner_price' | 'internal_cost'): number | null => {
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
    effective_from: dates.sort()[dates.length - 1],
  };
}
