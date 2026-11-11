import { describe, expect, it } from "vitest";
import { PO_COLUMNS, bandParts, moveColumn, normalizeOrder } from "./renovationPoColumns";

describe("normalizeOrder", () => {
  it("nothing saved is the usual order", () => expect(normalizeOrder([])).toEqual(PO_COLUMNS));
  it("keeps a saved order, drops unknown names and repeats, and brings a missing column back", () => {
    const out = normalizeOrder(["po", "nope", "sku", "po"]);
    expect(out.indexOf("po")).toBeLessThan(out.indexOf("sku"));
    expect([...out].sort()).toEqual([...PO_COLUMNS].sort());
  });
});

describe("moveColumn", () => {
  it("moves a column to the left", () => expect(moveColumn(["sku", "desc", "po"], "po", "sku")).toEqual(["po", "sku", "desc"]));
  it("moves a column to the right", () => expect(moveColumn(["sku", "desc", "po"], "sku", "po")).toEqual(["desc", "po", "sku"]));
  it("dropped on itself nothing moves", () => expect(moveColumn(["sku", "desc"], "sku", "sku")).toEqual(["sku", "desc"]));
});

describe("bandParts", () => {
  it("the usual order: label, the two dates, then blank", () => {
    expect(bandParts(PO_COLUMNS)).toEqual([{ kind: "label", span: 5 }, { kind: "orderOn", span: 1 }, { kind: "deliverOn", span: 1 }, { kind: "blank", span: 4 }]);
  });
  it("dates stay under their columns wherever they move, and the cells add up", () => {
    const parts = bandParts(["orderOn", "sku", "desc", "deliverOn", "qty"]);
    expect(parts).toEqual([{ kind: "orderOn", span: 1 }, { kind: "label", span: 2 }, { kind: "deliverOn", span: 1 }, { kind: "blank", span: 1 }]);
  });
});
