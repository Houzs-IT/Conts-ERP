import { describe, expect, it } from "vitest";
import { pickGroups, pickRows, type PickRow } from "./renovationBetaSkuPick";

const row = (over: Partial<PickRow>): PickRow => ({
  id: over.code ?? "x", code: "X", name: "Thing", category: "FURNITURE", description: null, barcode: null, status: "ACTIVE", sell_price_sen: 100, ...over,
} as PickRow);

const all = [
  row({ code: "SOFA-1", name: "Sofa", category: "FURNITURE" }),
  row({ code: "LAMP-1", name: "Pendant lamp", category: "LIGHTING" }),
  row({ code: "LAMP-2", name: "Wall lamp", category: "LIGHTING", status: "INACTIVE" }),
  row({ code: "TABLE-1", name: "Dining table", category: "FURNITURE" }),
];

describe("Swap SKU picker", () => {
  it("browses a group before anything is typed, leaving out the line's own SKU and inactive ones", () => {
    expect(pickRows(all, { current: "SOFA-1", group: "FURNITURE", query: "" }).map((r) => r.code)).toEqual(["TABLE-1"]);
    expect(pickRows(all, { current: "SOFA-1", group: null, query: "" }).map((r) => r.code)).toEqual(["LAMP-1", "TABLE-1"]);
  });
  it("a typed search looks across every group", () => {
    expect(pickRows(all, { current: "SOFA-1", group: "FURNITURE", query: "lamp" }).map((r) => r.code)).toEqual(["LAMP-1"]);
  });
  it("offers only groups with something to pick, with counts", () => {
    expect(pickGroups(all, "SOFA-1").map((g) => [g.code, g.count])).toEqual([["FURNITURE", 1], ["LIGHTING", 1]]);
  });
});
