import { describe, expect, test } from "vitest";
import {
  CATALOG_GROUPS,
  RENOVATION_GROUPS,
  SUB_CATEGORIES,
  categoryGroupOf,
  defaultStageOf,
  isPhotoRequiredCategory,
  legacySubOf,
  subCategoriesOf,
  uomPrintLabel,
  validateCategoryPair,
} from "../src/scm/shared/renovation-catalog";
import { AUTO_SKIP_RULE, INTERNAL_TASKS, RENO_STAGES, TRADE_ORDER, UNSKIPPABLE, isSkippable } from "../src/scm/shared/renovation-stages";
import { MFG_PRODUCT_CATEGORIES } from "../src/scm/shared/product-categories";

describe("renovation catalog", () => {
  test("every legacy Houzs category maps to a group", () => {
    for (const c of [...MFG_PRODUCT_CATEGORIES, "OTHERS"]) {
      expect(categoryGroupOf(c), c).not.toBeNull();
    }
    expect(categoryGroupOf("SOFA")).toBe("FURNITURE");
    expect(categoryGroupOf("BEDLINES")).toBe("SOFT");
    expect(categoryGroupOf("SERVICE")).toBe("SERVICE");
    expect(categoryGroupOf("NOPE")).toBeNull();
  });

  test("legacy categories imply their sub-category; SERVICE implies none", () => {
    expect(legacySubOf("FABRIC_ACCESSORY")).toBe("ACCESSORY");
    expect(legacySubOf("BEDLINES")).toBe("BED_LINEN");
    expect(legacySubOf("SERVICE")).toBeNull();
  });

  test("sub-category codes are unique and every group has at least one", () => {
    const codes = SUB_CATEGORIES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const g of CATALOG_GROUPS) expect(subCategoriesOf(g).length, g).toBeGreaterThan(0);
  });

  test("new groups need a matching sub-category, legacy values do not", () => {
    expect(validateCategoryPair("WORKS", "HACKING")).toEqual({ ok: true });
    expect(validateCategoryPair("WORKS", null)).toEqual({ ok: false, error: "sub_category_required" });
    expect(validateCategoryPair("WORKS", "SOFA")).toEqual({ ok: false, error: "sub_category_mismatch" });
    expect(validateCategoryPair("SOFA", null)).toEqual({ ok: true });
    expect(validateCategoryPair("XYZ", null)).toEqual({ ok: false, error: "invalid_category" });
  });

  test("photo rule applies to new photo groups only", () => {
    expect(isPhotoRequiredCategory("BUILTIN")).toBe(true);
    expect(isPhotoRequiredCategory("WORKS")).toBe(false);
    expect(isPhotoRequiredCategory("SOFA")).toBe(false);
  });

  test("group stages are real stage keys", () => {
    for (const g of RENOVATION_GROUPS) expect(RENO_STAGES).toContain(g.stage);
    expect(defaultStageOf("APPLIANCE")).toBe("appliances");
    expect(defaultStageOf("SOFA")).toBe("furniture");
  });

  test("UOM print labels match the sample documents", () => {
    expect(uomPrintLabel("LOT")).toBe("LS");
    expect(uomPrintLabel("FULL")).toBe("FULL UNIT");
    expect(uomPrintLabel("FT")).toBe("FT");
  });
});

describe("renovation stages", () => {
  test("auto-skip rules name only stages and groups that exist", () => {
    for (const [stage, groups] of Object.entries(AUTO_SKIP_RULE)) {
      expect(RENO_STAGES).toContain(stage);
      for (const g of groups ?? []) expect(CATALOG_GROUPS).toContain(g);
    }
  });

  test("unskippable stages cannot be skipped", () => {
    for (const s of UNSKIPPABLE) expect(isSkippable(s)).toBe(false);
    expect(isSkippable("furniture")).toBe(true);
  });

  test("every trade in the site order is a WORKS sub-category", () => {
    const works = new Set(subCategoriesOf("WORKS").map((s) => s.code));
    for (const step of TRADE_ORDER) expect(works.has(step.trade), step.trade).toBe(true);
  });

  test("template tasks have unique keys and real stages", () => {
    const keys = INTERNAL_TASKS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of INTERNAL_TASKS) expect(RENO_STAGES).toContain(t.stage);
  });
});
