import { describe, expect, test } from "vitest";
import { categoryStage, isLate, linesOf, stageOf, stageText, type StatusLine } from "./procurementStatusModel";

const line = (p: Partial<StatusLine>): StatusLine => ({
  categoryGroup: "WORKS", subCategory: "ELECTRICAL", qty: 1, orderedQty: 0, receivedQty: 0, deliveredQty: 0, grs: [], dos: [], ...p,
});
const gr = (id: string, date: string) => ({ id, no: `GRN-${id}`, date, atSite: false, photos: 0 });

describe("procurement details: ordered -> received -> delivered", () => {
  test("counts ordered lines, then those received and delivered; Ready when every ordered line is both", () => {
    const s = stageOf([
      line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1, grs: [gr("b", "2026-10-16")] }),
      line({ qty: 2, orderedQty: 2, receivedQty: 2, deliveredQty: 0, grs: [gr("a", "2026-10-15"), gr("b", "2026-10-16")] }),
      line({ orderedQty: 0 }),
    ]);
    expect([s.items, s.ordered, s.received, s.delivered, s.ready]).toEqual([3, 2, 2, 1, false]);
    expect(s.grs.map((g) => g.id)).toEqual(["a", "b"]);
    expect(stageText(s)).toBe("3 items · 2 ordered · 2 received · 1 delivered");
    expect(stageOf([line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 }), line({})]).ready).toBe(true);
    expect(stageOf([line({})]).ready).toBe(false);
    expect(stageText(stageOf([]))).toBe("");
  });

  test("a category is Ready only when every sub-category with items is Ready", () => {
    const ready = stageOf([line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 })]);
    const not = stageOf([line({ orderedQty: 1, receivedQty: 1 })]);
    const empty = stageOf([]);
    expect(categoryStage([ready, empty]).ready).toBe(true);
    expect(categoryStage([ready, not]).ready).toBe(false);
    expect(categoryStage([empty]).ready).toBe(false);
    expect(categoryStage([ready, not]).delivered).toBe(1);
  });

  test("rows take their own lines; the category row takes the lines with no sub-category row", () => {
    const lines = [line({}), line({ subCategory: "PLUMBING" }), line({ subCategory: null }), line({ categoryGroup: "SERVICE" })];
    expect(linesOf(lines, "WORKS", "ELECTRICAL", ["ELECTRICAL"]).length).toBe(1);
    expect(linesOf(lines, "WORKS", null, ["ELECTRICAL"]).length).toBe(2);
  });

  test("LATE when the planned delivery has passed and the row is not Ready", () => {
    const not = stageOf([line({ orderedQty: 1 })]);
    expect(isLate(not, "2026-10-10", "2026-10-15")).toBe(true);
    expect(isLate(not, "2026-10-20", "2026-10-15")).toBe(false);
    expect(isLate(stageOf([line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 })]), "2026-10-10", "2026-10-15")).toBe(false);
    expect(isLate(stageOf([]), "2026-10-10", "2026-10-15")).toBe(false);
  });
});
