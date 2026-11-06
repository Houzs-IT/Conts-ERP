export interface PriceFigures { owner_price: number | null; internal_cost: number | null }
export interface PriceRaise { ownerBasisPoints: number | null; internalBasisPoints: number | null }

const LOWEST_BASIS_POINTS = -10_000;
const HIGHEST_BASIS_POINTS = 100_000;

export const raiseSen = (sen: number, basisPoints: number): number => Math.round((sen * (10_000 + basisPoints)) / 10_000);

export function percentToBasisPoints(percent: unknown): number | null | undefined {
  if (percent == null || percent === '') return null;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined;
  const basisPoints = Math.round(percent * 100);
  if (Math.abs(basisPoints - percent * 100) > 1e-6) return undefined;
  return basisPoints >= LOWEST_BASIS_POINTS && basisPoints <= HIGHEST_BASIS_POINTS ? basisPoints : undefined;
}

const raiseOne = (sen: number | null, basisPoints: number | null): number | null =>
  sen == null || basisPoints == null ? sen : raiseSen(Number(sen), basisPoints);

export function raiseFigures(row: PriceFigures, raise: PriceRaise): PriceFigures {
  return { owner_price: raiseOne(row.owner_price, raise.ownerBasisPoints), internal_cost: raiseOne(row.internal_cost, raise.internalBasisPoints) };
}

export const figuresChanged = (before: PriceFigures, after: PriceFigures): boolean =>
  (before.owner_price ?? null) !== (after.owner_price ?? null) || (before.internal_cost ?? null) !== (after.internal_cost ?? null);
