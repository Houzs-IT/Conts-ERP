import { describe, expect, test } from "vitest";
import { categoryStage, isLate, linesOf, stageOf, stageText, type StatusLine } from "./procurementStatusModel";

const line = (p: Partial<StatusLine>): StatusLine => ({
  categoryGroup: "WORKS", subCategory: "ELECTRICAL", qty: 1, orderedQty: 0, receivedQty: 0, deliveredQty: 0, grs: [], dos: [], ...p,
});
const gr = (id: string, date: string) => ({ id, no: `GRN-${id}`, date, atSite: false, photos: 0 });

describe("procurement details: ordered -> received -> delivered", () => {
  test("counts ordered and delivered over every line, received over the lines that went through a PO", () => {
    const s = stageOf([
      line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1, grs: [gr("b", "2026-10-16")] }),
      line({ qty: 2, orderedQty: 2, receivedQty: 2, deliveredQty: 0, grs: [gr("a", "2026-10-15"), gr("b", "2026-10-16")] }),
      line({ orderedQty: 0, deliveredQty: 1 }),
    ]);
    expect([s.items, s.ordered, s.toReceive, s.received, s.delivered, s.ready]).toEqual([3, 2, 2, 2, 2, false]);
    expect(s.grs.map((g) => g.id)).toEqual(["a", "b"]);
    expect(stageText(s)).toBe("3 items · 2 ordered · 2 of 2 received · 2 delivered");
    expect(stageText(stageOf([]))).toBe("");
  });

  test("Ready only when every line is delivered, stock lines included, and every PO line is received (owner, 15 Oct)", () => {
    const done = line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 });
    // The Electrical case: one PO line in and delivered, two stock lines not yet delivered -> not Ready.
    expect(stageOf([done, line({}), line({})]).ready).toBe(false);
    // The stock lines delivered by their DO -> Ready.
    expect(stageOf([done, line({ deliveredQty: 1 }), line({ deliveredQty: 1 })]).ready).toBe(true);
    // Stock-only rows: Ready once delivered, with nothing to receive.
    const stock = stageOf([line({ deliveredQty: 1 })]);
    expect([stock.toReceive, stock.ready]).toEqual([0, true]);
    // A PO line delivered but its goods receipt not in yet -> not Ready.
    expect(stageOf([line({ orderedQty: 1, deliveredQty: 1 })]).ready).toBe(false);
    // Received but not delivered -> not Ready.
    expect(stageOf([line({ orderedQty: 1, receivedQty: 1 })]).ready).toBe(false);
    // Partly ordered, partly from stock: waits only for the ordered quantity to be received.
    expect(stageOf([line({ qty: 3, orderedQty: 1, receivedQty: 1, deliveredQty: 3 })]).ready).toBe(true);
    expect(stageOf([]).ready).toBe(false);
  });

  test("a category is Ready only when every sub-category with items is Ready", () => {
    const ready = stageOf([line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 })]);
    const not = stageOf([line({ orderedQty: 1, receivedQty: 1 })]);
    const empty = stageOf([]);
    expect(categoryStage([ready, empty]).ready).toBe(true);
    expect(categoryStage([ready, not]).ready).toBe(false);
    expect(categoryStage([empty]).ready).toBe(false);
    expect(categoryStage([ready, not]).delivered).toBe(1);
    expect(categoryStage([ready, not]).toReceive).toBe(2);
    const stockOnly = stageOf([line({ subCategory: "PLUMBING" })]);
    expect(categoryStage([ready, stockOnly]).ready).toBe(false);
  });

  test("rows take their own lines; the category row takes the lines with no sub-category row", () => {
    const lines = [line({}), line({ subCategory: "PLUMBING" }), line({ subCategory: null }), line({ categoryGroup: "SERVICE" })];
    expect(linesOf(lines, "WORKS", "ELECTRICAL", ["ELECTRICAL"]).length).toBe(1);
    expect(linesOf(lines, "WORKS", null, ["ELECTRICAL"]).length).toBe(2);
  });

  test("LATE when the planned delivery has passed and the row is not Ready", () => {
    expect(isLate(stageOf([line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 }), line({})]), "2026-10-10", "2026-10-15")).toBe(true);
    const not = stageOf([line({ orderedQty: 1 })]);
    expect(isLate(not, "2026-10-10", "2026-10-15")).toBe(true);
    expect(isLate(not, "2026-10-20", "2026-10-15")).toBe(false);
    expect(isLate(stageOf([line({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 })]), "2026-10-10", "2026-10-15")).toBe(false);
    expect(isLate(stageOf([]), "2026-10-10", "2026-10-15")).toBe(false);
  });
});
