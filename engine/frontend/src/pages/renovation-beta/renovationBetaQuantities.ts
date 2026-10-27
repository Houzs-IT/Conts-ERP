/* Quantity rules of the ID SOP deck (slides 12 to 16), as pure functions for the PO tab's Quantity helper.
   Plan: PLAN-quantity-calculators.md. Every number the deck sets is in QTY, so a rule change is one line.
   Owner rules of 27 Oct 2026 beat the deck where they differ: one 100 W driver per 5 m of COB strip (slide 16's
   driver table is not used), and 3 m track light is bought as 2 m + 1 m with a connector and a 100 W driver. */

export const QTY = {
  /** A plaster / partition board is 4 ft x 8 ft. */
  boardSqft: 24,
  teePerBoard: 6,
  channelPerBoard: 6,
  cornerBeadPerPartition: 2,
  lBoxFt: 8,
  defaultCoats: 2,
  /** Deck says 5 to 10% spare for touch-up and trimming. */
  defaultSparePct: 10,
  /** A remainder over this many litres is bought as a 5 L tin, not 1 L tins. */
  smallTinMaxL: 2,
  trackPieceM: 2,
  ledRollM: 5,
} as const;

/** Real-world coverage (slide 14: official figure x 0.8). Not the official 140 and 129 sqft/L. */
export const PAINT_BRANDS = [
  { id: "nippon", label: "Nippon EasyWash", sqftPerLitre: 112 },
  { id: "jotun", label: "Jotun Majestic True Beauty", sqftPerLitre: 103 },
] as const;

/* A float such as 240 / 24 must not round up on dust. */
const up = (x: number): number => Math.ceil(x - 1e-9);

/** A typed number above zero, else null (empty, text, zero and negatives are not quantities). */
export function positive(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/** A typed number of zero or more, else null. */
export function nonNegative(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

export interface PlasterCeilingResult { boards: number; tees: number }

export function plasterCeiling(areaSqft: number): PlasterCeilingResult {
  const boards = up(areaSqft / QTY.boardSqft);
  return { boards, tees: boards * QTY.teePerBoard };
}

export function lBoxes(lengthFt: number): number {
  return up(lengthFt / QTY.lBoxFt);
}

export interface PartitionResult { boards: number; channels: number; cornerBeads: number }

/** areaSqft is left + right + front faces together. */
export function partition(areaSqft: number, partitions: number): PartitionResult {
  const boards = up(areaSqft / QTY.boardSqft);
  return { boards, channels: boards * QTY.channelPerBoard, cornerBeads: partitions * QTY.cornerBeadPerPartition };
}

export interface PaintTins { l20: number; l5: number; l1: number }

/** Tins that cover the litres: 20 L for each full 20, then 5 L tins, and the last bit as one more 5 L tin or 1 L tins.
    ponytail: tin sizes only, no prices. Add a price-based mix if purchasing wants the cheapest one. */
export function paintTins(litres: number): PaintTins {
  const l20 = Math.floor(litres / 20);
  const rest = litres - l20 * 20;
  const l5 = Math.floor(rest / 5);
  const bit = rest - l5 * 5;
  if (bit <= 1e-9) return { l20, l5, l1: 0 };
  return bit > QTY.smallTinMaxL ? { l20, l5: l5 + 1, l1: 0 } : { l20, l5, l1: up(bit) };
}

export interface PaintInput {
  perimeterFt: number;
  heightFt: number;
  openingsSqft: number;
  sqftPerLitre: number;
  coats: number;
  sparePct: number;
}

export interface PaintResult { netWallSqft: number; litres: number; tins: PaintTins }

/** Null when the doors and windows are as big as the walls (nothing to paint). */
export function wallPaint(i: PaintInput): PaintResult | null {
  const netWallSqft = i.perimeterFt * i.heightFt - i.openingsSqft;
  if (netWallSqft <= 0) return null;
  const litres = (netWallSqft / i.sqftPerLitre) * i.coats * (1 + i.sparePct / 100);
  return { netWallSqft, litres, tins: paintTins(litres) };
}

export interface TrackLightResult {
  /** Pieces of QTY.trackPieceM. */
  fullPieces: number;
  /** The last, shorter piece in metres; 0 when the length is an exact number of full pieces. */
  remainderM: number;
  connectors: number;
  /** 100 W drivers, one per run. */
  drivers: number;
}

/** 3 m = 2 m + 1 m, 1 connector, 1 driver (owner, 27 Oct 2026). Longer runs follow the same pattern, one driver per run.
    ponytail: one 100 W driver per run is only confirmed for 3 m. */
export function trackLight(lengthM: number): TrackLightResult {
  const fullPieces = Math.floor(lengthM / QTY.trackPieceM + 1e-9);
  const rest = lengthM - fullPieces * QTY.trackPieceM;
  const remainderM = rest > 1e-9 ? Math.round(rest * 100) / 100 : 0;
  const pieces = fullPieces + (remainderM > 0 ? 1 : 0);
  return { fullPieces, remainderM, connectors: Math.max(0, pieces - 1), drivers: 1 };
}

export interface LedStripResult { rolls: number; drivers: number }

/** 5 m per roll, and one 100 W driver holds 5 m, so 10 m = 2 rolls + 2 drivers (owner, 27 Oct 2026). */
export function ledStrip(lengthM: number): LedStripResult {
  const rolls = up(lengthM / QTY.ledRollM);
  return { rolls, drivers: rolls };
}
