import { describe, expect, test } from "vitest";
import { groupKeyFor, type GroupKeyInput } from "../src/scm/lib/po-grouping";

/* Owner, 4 Nov 2026: Combined merges the selected lines of several SOs to one
   supplier into one PO; Per SO opens one PO per SO. Every line alike. */

const WH = "11111111-1111-4111-8111-111111111111";
const SUP = "22222222-2222-4222-8222-222222222222";

const line = (over: Partial<GroupKeyInput> = {}): GroupKeyInput => ({ warehouseId: WH, supplierId: SUP, soDocNo: "SO-1", ...over });

describe("Combined", () => {
  test("several SOs to one supplier share one PO", () => {
    expect(groupKeyFor(line({ soDocNo: "SO-1" }), "combined")).toBe(groupKeyFor(line({ soDocNo: "SO-2" }), "combined"));
  });
  test("two suppliers never share a PO", () => {
    expect(groupKeyFor(line({ supplierId: "other" }), "combined")).not.toBe(groupKeyFor(line(), "combined"));
  });
  test("two warehouses never share a PO, so the goods receipt lands in the right one", () => {
    expect(groupKeyFor(line({ warehouseId: "other" }), "combined")).not.toBe(groupKeyFor(line(), "combined"));
  });
});

describe("Per SO", () => {
  test("each SO has its own PO", () => {
    expect(groupKeyFor(line({ soDocNo: "SO-1" }), "per-so")).not.toBe(groupKeyFor(line({ soDocNo: "SO-2" }), "per-so"));
  });
  test("one SO with two suppliers has two POs", () => {
    expect(groupKeyFor(line({ supplierId: "other" }), "per-so")).not.toBe(groupKeyFor(line(), "per-so"));
  });
});
