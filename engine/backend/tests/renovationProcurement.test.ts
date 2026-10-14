import { describe, expect, test } from "vitest";
import {
  buildProcurementView, cleanCategoryDates, cleanSubDates, effectiveSubDates,
} from "../src/services/renovation/procurement";

const CAT = { poDate: "2026-10-20", deliveryDate: "2026-11-05" };

describe("effective dates of a sub-category", () => {
  test("follow (or no row at all) takes the category's dates", () => {
    expect(effectiveSubDates(CAT, undefined)).toEqual(CAT);
    expect(effectiveSubDates(CAT, { mode: "follow", poDate: "2026-01-01", deliveryDate: "2026-01-02" })).toEqual(CAT);
  });
  test("own keeps its own dates, even when the category has none", () => {
    expect(effectiveSubDates({ poDate: null, deliveryDate: null }, { mode: "own", poDate: "2026-10-22", deliveryDate: null }))
      .toEqual({ poDate: "2026-10-22", deliveryDate: null });
  });
  test("none means no dates whatever the category says", () => {
    expect(effectiveSubDates(CAT, { mode: "none", poDate: null, deliveryDate: null })).toEqual({ poDate: null, deliveryDate: null });
  });
});

describe("input rules", () => {
  test("category dates: YYYY-MM-DD or empty, delivery not before PO", () => {
    expect(cleanCategoryDates({ poDate: "2026-10-20", deliveryDate: "2026-11-05" })).toEqual({ ok: true, value: CAT });
    expect(cleanCategoryDates({ poDate: "", deliveryDate: null })).toEqual({ ok: true, value: { poDate: null, deliveryDate: null } });
    expect(cleanCategoryDates({ poDate: "20/10/2026" })).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanCategoryDates({ poDate: "2026-02-30" })).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanCategoryDates({ poDate: "2026-11-06", deliveryDate: "2026-11-05" })).toMatchObject({ ok: false, error: "delivery_before_po" });
    expect(cleanCategoryDates({ poDate: "2026-11-05", deliveryDate: "2026-11-05" })).toMatchObject({ ok: true });
  });
  test("sub-category: follow and none drop any dates; own validates them", () => {
    expect(cleanSubDates({ mode: "follow", poDate: "2026-10-01" })).toEqual({ ok: true, value: { mode: "follow", poDate: null, deliveryDate: null } });
    expect(cleanSubDates({ mode: "none" })).toEqual({ ok: true, value: { mode: "none", poDate: null, deliveryDate: null } });
    expect(cleanSubDates({ mode: "own", poDate: "2026-10-01", deliveryDate: "2026-10-09" }))
      .toEqual({ ok: true, value: { mode: "own", poDate: "2026-10-01", deliveryDate: "2026-10-09" } });
    expect(cleanSubDates({ mode: "own", poDate: "2026-10-10", deliveryDate: "2026-10-09" })).toMatchObject({ ok: false, error: "delivery_before_po" });
    expect(cleanSubDates({ mode: "later" })).toMatchObject({ ok: false, error: "mode_invalid" });
  });
});

describe("the view", () => {
  const groups = [{ code: "FURNITURE", label: "Furniture", sort_order: 30 }, { code: "WORKS", label: "Works", sort_order: 10 }];
  const subs = [
    { group_code: "WORKS", code: "PAINTING", label: "Painting", sort_order: 90 },
    { group_code: "WORKS", code: "HACKING", label: "Hacking", sort_order: 20 },
    { group_code: "FURNITURE", code: "SOFA", label: "Sofa", sort_order: 10 },
  ];
  const rows = [
    { group_code: "WORKS", sub_code: "", po_date: "2026-10-20", delivery_date: "2026-11-05", mode: "follow", updated_at: null, updated_by: null },
    { group_code: "WORKS", sub_code: "PAINTING", po_date: "2026-10-25", delivery_date: null, mode: "own", updated_at: null, updated_by: null },
    { group_code: "FURNITURE", sub_code: "SOFA", po_date: null, delivery_date: null, mode: "none", updated_at: null, updated_by: null },
  ];
  const v = buildProcurementView(groups, subs, rows);
  test("groups and subs in sort order", () => {
    expect(v.map((g) => g.code)).toEqual(["WORKS", "FURNITURE"]);
    expect(v[0]!.subs.map((s) => s.code)).toEqual(["HACKING", "PAINTING"]);
  });
  test("stored and effective dates side by side", () => {
    expect(v[0]!).toMatchObject({ poDate: "2026-10-20", deliveryDate: "2026-11-05" });
    expect(v[0]!.subs[0]).toMatchObject({ mode: "follow", stored: { poDate: null, deliveryDate: null }, effective: CAT });
    expect(v[0]!.subs[1]).toMatchObject({ mode: "own", stored: { poDate: "2026-10-25", deliveryDate: null }, effective: { poDate: "2026-10-25", deliveryDate: null } });
    expect(v[1]!).toMatchObject({ poDate: null, deliveryDate: null });
    expect(v[1]!.subs[0]).toMatchObject({ mode: "none", effective: { poDate: null, deliveryDate: null } });
  });
  test("a stored row for a sub-category no longer in the catalog is ignored", () => {
    const w = buildProcurementView(groups, subs, [...rows, { group_code: "WORKS", sub_code: "GONE", po_date: "2026-10-01", delivery_date: null, mode: "own", updated_at: null, updated_by: null }]);
    expect(w[0]!.subs.map((s) => s.code)).toEqual(["HACKING", "PAINTING"]);
  });
});
