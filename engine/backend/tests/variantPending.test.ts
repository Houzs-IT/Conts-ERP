import { describe, expect, test } from "vitest";
import { pendingVariants, variantGroupOf } from "../src/services/renovation/variantPending";

describe("pending variants follow the SO tab's catalog rule", () => {
  test("a catalog sofa saved with item_group renovation still needs its variants", () => {
    const sofa = { itemCode: "SOF-HLM-6112-3S", itemGroup: "RENOVATION", prodCategory: "FURNITURE", prodSub: "SOFA", variants: {} };
    expect(variantGroupOf(sofa)).toBe("sofa");
    const open = pendingVariants([sofa]);
    expect(open).toHaveLength(1);
    expect(open[0].itemCode).toBe("SOF-HLM-6112-3S");
    expect(open[0].missing).toContain("Fabrics");
  });
  test("a bedframe is checked as a bedframe; works and services need nothing", () => {
    const bed = { itemCode: "BED-HLM-JAGER-Q", itemGroup: "RENOVATION", prodCategory: "FURNITURE", prodSub: "BEDFRAME", variants: null };
    const works = { itemCode: "RN-PAINTING", itemGroup: "RENOVATION", prodCategory: "RENOVATION", prodSub: "WORKS", variants: null };
    expect(pendingVariants([bed, works]).map((x) => x.itemCode)).toEqual(["BED-HLM-JAGER-Q"]);
  });
  test("a code not in the catalog falls back to the line's own group", () => {
    expect(variantGroupOf({ itemGroup: "sofa", prodCategory: null, prodSub: null })).toBe("sofa");
    expect(pendingVariants([{ itemCode: "X", itemGroup: "renovation", prodCategory: null, prodSub: null, variants: null }])).toEqual([]);
  });
});
