import { describe, expect, it } from "vitest";
import { PAINT_BRANDS, ledStrip, lBoxes, nonNegative, paintTins, partition, plasterCeiling, positive, trackLight, wallPaint } from "./renovationBetaQuantities";

const coverage = (id: string): number => PAINT_BRANDS.find((b) => b.id === id)?.sqftPerLitre ?? 0;
const paint = (id: string): ReturnType<typeof wallPaint> =>
  wallPaint({ perimeterFt: 100, heightFt: 5, openingsSqft: 0, sqftPerLitre: coverage(id), coats: 2, sparePct: 0 });

describe("plaster ceiling and partition", () => {
  it("rounds boards up and counts tees from the rounded boards", () => {
    expect(plasterCeiling(240)).toEqual({ boards: 10, tees: 60 });
    expect(plasterCeiling(241)).toEqual({ boards: 11, tees: 66 });
  });
  it("rounds L boxes up", () => {
    expect(lBoxes(16)).toBe(2);
    expect(lBoxes(17)).toBe(3);
  });
  it("counts partition boards, channels and 2 corner beads per partition", () => {
    expect(partition(100, 3)).toEqual({ boards: 5, channels: 30, cornerBeads: 6 });
  });
});

describe("wall paint", () => {
  it("matches the deck example: 500 sqft, 2 coats", () => {
    expect(paint("nippon")?.litres).toBeCloseTo(8.93, 2);
    expect(paint("jotun")?.litres).toBeCloseTo(9.71, 2);
  });
  it("takes openings off the walls and adds the spare", () => {
    const r = wallPaint({ perimeterFt: 100, heightFt: 10, openingsSqft: 100, sqftPerLitre: 100, coats: 2, sparePct: 10 });
    expect(r?.netWallSqft).toBe(900);
    expect(r?.litres).toBeCloseTo(19.8, 5);
  });
  it("returns null when nothing is left to paint", () => {
    expect(wallPaint({ perimeterFt: 10, heightFt: 10, openingsSqft: 100, sqftPerLitre: 100, coats: 2, sparePct: 0 })).toBeNull();
  });
  it("buys two 5 L tins for 8.9 L and covers the total", () => {
    expect(paintTins(8.93)).toEqual({ l20: 0, l5: 2, l1: 0 });
    expect(paintTins(9.71)).toEqual({ l20: 0, l5: 2, l1: 0 });
  });
  it("uses 20 L, 5 L and 1 L tins", () => {
    expect(paintTins(46.5)).toEqual({ l20: 2, l5: 1, l1: 2 });
    expect(paintTins(47.5)).toEqual({ l20: 2, l5: 2, l1: 0 });
    expect(paintTins(5)).toEqual({ l20: 0, l5: 1, l1: 0 });
    expect(paintTins(6.2)).toEqual({ l20: 0, l5: 1, l1: 2 });
  });
});

describe("track light", () => {
  it("3 m is 2 m + 1 m with 1 connector and 1 driver", () => {
    expect(trackLight(3)).toEqual({ fullPieces: 1, remainderM: 1, connectors: 1, drivers: 1 });
  });
  it("2 m is one piece with no connector", () => {
    expect(trackLight(2)).toEqual({ fullPieces: 1, remainderM: 0, connectors: 0, drivers: 1 });
  });
  it("5 m is 2 m + 2 m + 1 m with 2 connectors", () => {
    expect(trackLight(5)).toEqual({ fullPieces: 2, remainderM: 1, connectors: 2, drivers: 1 });
  });
});

describe("COB LED strip", () => {
  it("one roll and one driver per 5 m", () => {
    expect(ledStrip(5)).toEqual({ rolls: 1, drivers: 1 });
    expect(ledStrip(10)).toEqual({ rolls: 2, drivers: 2 });
    expect(ledStrip(11)).toEqual({ rolls: 3, drivers: 3 });
    expect(ledStrip(5.1)).toEqual({ rolls: 2, drivers: 2 });
  });
});

describe("typed numbers", () => {
  it("accepts only real quantities", () => {
    expect(positive("12.5")).toBe(12.5);
    for (const t of ["", " ", "abc", "0", "-3", "NaN", "Infinity"]) expect(positive(t)).toBeNull();
    expect(nonNegative("0")).toBe(0);
    for (const t of ["", "-1", "x"]) expect(nonNegative(t)).toBeNull();
  });
});
