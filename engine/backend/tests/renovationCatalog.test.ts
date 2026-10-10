// Phase 1 additions to the renovation catalog contract: generic SKUs, the
// legacy category list growing the six new groups, and the import parser
// reading them. (renovationShared.test.ts covers the foundation.)
import { describe, expect, test } from "vitest";
import {
  GENERIC_SKU_GROUPS,
  SUB_CATEGORIES,
  UOMS,
  genericSkuCode,
  genericSkus,
  isUom,
  subCategoriesOf,
  validateCategoryPair,
} from "../src/scm/shared/renovation-catalog";
import { MFG_PRODUCT_CATEGORIES, mfgCategoryLabel, parseMfgCategory } from "../src/scm/shared/product-categories";

describe("generic SKUs", () => {
  test("one per WORKS and SERVICE sub-category, coded RN-<SUB>", () => {
    expect(GENERIC_SKU_GROUPS).toEqual(["WORKS", "SERVICE"]);
    const list = genericSkus();
    const expected = [...subCategoriesOf("WORKS"), ...subCategoriesOf("SERVICE")];
    expect(list.map((g) => g.code)).toEqual(expected.map((s) => `RN-${s.code}`));
    expect(genericSkuCode("ELECTRICAL")).toBe("RN-ELECTRICAL");
  });

  test("every generic SKU is a valid category pair with a real UOM", () => {
    for (const g of genericSkus()) {
      expect(validateCategoryPair(g.group, g.sub), g.code).toEqual({ ok: true });
      expect(isUom(g.uom), g.code).toBe(true);
      expect(g.name.length).toBeGreaterThan(0);
    }
  });

  test("measured trades default to their measuring unit", () => {
    const by = new Map(genericSkus().map((g) => [g.sub, g.uom]));
    expect(by.get("ELECTRICAL")).toBe("POINT");
    expect(by.get("PLASTER_CEILING")).toBe("SQFT");
    expect(by.get("HACKING")).toBe("LOT");
    expect(by.get("DELIVERY")).toBe("LOT");
  });

  test("UOM list is exactly the spec's eight", () => {
    expect(UOMS.map((u) => u.code)).toEqual(["PCS", "UNIT", "SET", "LOT", "FT", "SQFT", "POINT", "FULL"]);
    expect(isUom("sqft")).toBe(true);
    expect(isUom("BAG")).toBe(false);
  });
});

describe("product categories grow the six new groups", () => {
  test("the enum list carries every new group after the legacy ones", () => {
    for (const g of ["WORKS", "BUILTIN", "FURNITURE", "LIGHTING", "APPLIANCE", "SOFT"]) {
      expect(MFG_PRODUCT_CATEGORIES as readonly string[]).toContain(g);
    }
    expect(MFG_PRODUCT_CATEGORIES.slice(0, 10)).toEqual([
      "SOFA", "BEDFRAME", "ACCESSORY", "FABRIC_ACCESSORY", "MATTRESS", "BEDLINES", "DINING", "DIFFUSER", "CARPET", "SERVICE",
    ]);
  });

  test("labels and import parsing read the new groups", () => {
    expect(mfgCategoryLabel("BUILTIN")).toBe("Built-in");
    expect(mfgCategoryLabel("SOFT")).toBe("Soft furnishing");
    expect(parseMfgCategory("works")).toBe("WORKS");
    expect(parseMfgCategory("Built-in")).toBe("BUILTIN");
    expect(parseMfgCategory("Soft furnishing")).toBe("SOFT");
  });

  test("no new group code contains a substring legacy readers test for", () => {
    const probes = ["sofa", "bedframe", "mattress", "accessor", "dining", "service"];
    for (const g of ["WORKS", "BUILTIN", "FURNITURE", "LIGHTING", "APPLIANCE", "SOFT"]) {
      for (const p of probes) expect(g.toLowerCase().includes(p), `${g} ~ ${p}`).toBe(false);
    }
  });

  test("sub-category codes never collide with a group code", () => {
    const groups = new Set<string>(MFG_PRODUCT_CATEGORIES);
    const clashes = SUB_CATEGORIES.filter((s) => groups.has(s.code) && !["SOFA", "BEDFRAME", "MATTRESS", "DINING", "ACCESSORY", "CARPET", "DIFFUSER"].includes(s.code));
    expect(clashes).toEqual([]);
  });
});
