import { describe, expect, it } from "vitest";
import { variantCategoryOf } from "./renovationVariantCategory";

describe("variantCategoryOf", () => {
  it("a Furniture SKU filed under Sofa or Bedframe gets their variant fields", () => {
    expect(variantCategoryOf("FURNITURE", "SOFA")).toBe("SOFA");
    expect(variantCategoryOf("FURNITURE", "BEDFRAME")).toBe("BEDFRAME");
  });
  it("other SKUs keep their own category", () => {
    expect(variantCategoryOf("FURNITURE", "DINING")).toBe("FURNITURE");
    expect(variantCategoryOf("BEDFRAME", null)).toBe("BEDFRAME");
    expect(variantCategoryOf(undefined, undefined)).toBe("");
  });
});
