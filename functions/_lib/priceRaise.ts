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

const MILLISECONDS_PER_DAY = 86_400_000;

export const dayAfter = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + MILLISECONDS_PER_DAY).toISOString().slice(0, 10);

/** A dated row strictly inside a price window would be lost when the old price comes back, so such a window is refused. */
export const hasChangeInside = (effectiveFroms: string[], startDay: string, backOn: string): boolean =>
  effectiveFroms.some(day => day > startDay && day < backOn);

const percentText = (basisPoints: number): string => `${basisPoints > 0 ? '+' : ''}${basisPoints / 100}%`;

export function raiseNote(raise: PriceRaise, internalLabel: string, effectiveTo: string | null): string {
  const parts = [
    raise.ownerBasisPoints ? `owner price ${percentText(raise.ownerBasisPoints)}` : null,
    raise.internalBasisPoints ? `${internalLabel} ${percentText(raise.internalBasisPoints)}` : null,
  ].filter((part): part is string => part !== null);
  const changed = `Changed by percent: ${parts.join(', ')}`;
  return effectiveTo ? `${changed}, until ${effectiveTo}` : changed;
}

export const restoreNote = (effectiveFrom: string, effectiveTo: string): string =>
  `Back to the prices before the percent change of ${effectiveFrom} to ${effectiveTo}`;
