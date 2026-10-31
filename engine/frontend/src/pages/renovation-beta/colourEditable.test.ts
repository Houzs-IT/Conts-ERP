import { describe, expect, it } from "vitest";
import { colourEditable } from "./renovationBetaLines";

const line = (over: Record<string, unknown>) => ({ itemGroup: "RENOVATION", variants: {}, categoryCode: "FURNITURE", goesTo: "po", ...over }) as never;

describe("the colour / code box (owner, 1 Nov 2026: not every SKU has variants)", () => {
  it("shows for goods we buy", () => {
    expect(colourEditable(line({}))).toBe(true);
  });
  it("hides for works, services, raw materials and our own works", () => {
    for (const categoryCode of ["WORKS", "SERVICE", "RAW"]) expect(colourEditable(line({ categoryCode }))).toBe(false);
    expect(colourEditable(line({ goesTo: "works" }))).toBe(false);
  });
});
