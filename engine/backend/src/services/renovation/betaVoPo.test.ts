import { describe, expect, it } from "vitest";
import { amendmentLineChange, amendmentStatus, grState, labelVos, voTotals, type AmendmentLineRow, type VoRow } from "./betaVoPo";
import { readClientLink, signClientLink } from "./betaClientLink";

const line = (over: Partial<AmendmentLineRow>): AmendmentLineRow => ({
  change_type: "ADD", new_item_code: null, new_qty: null, new_unit_price_sen: null, new_discount_sen: null, old_snapshot: null,
  cur_item_code: null, cur_description: null, cur_qty: null, cur_total_sen: null, product_name: null, ...over,
});

describe("amendmentLineChange", () => {
  it("an added line adds its quantity and amount", () => {
    const v = amendmentLineChange(line({ change_type: "ADD", new_item_code: "CAB-1", new_qty: 2, new_unit_price_sen: 50000, new_discount_sen: 1000, product_name: "Cabinet" }));
    expect(v).toMatchObject({ itemCode: "CAB-1", qty: 2, amountSen: 99000, change: "add", goesTo: "po", description: "Cabinet" });
  });
  it("a removed line deducts what the snapshot held", () => {
    const v = amendmentLineChange(line({ change_type: "REMOVE", old_snapshot: { item_code: "LT-9", qty: 3, total_sen: 30000, description: "Downlight" } }));
    expect(v).toMatchObject({ itemCode: "LT-9", qty: -3, amountSen: -30000, change: "deduct", description: "Downlight" });
  });
  it("a quantity cut deducts the difference", () => {
    const v = amendmentLineChange(line({ change_type: "MODIFY", new_qty: 1, new_unit_price_sen: 10000, old_snapshot: JSON.stringify({ item_code: "X", qty: 4, unit_price_sen: 10000, total_sen: 40000 }) }));
    expect(v).toMatchObject({ qty: -3, amountSen: -30000, change: "deduct" });
  });
  it("a customer SKU goes to Client PO", () => {
    expect(amendmentLineChange(line({ new_item_code: "CUS-TV", new_qty: 1, new_unit_price_sen: 0 })).goesTo).toBe("client");
  });
  it("a price-only change keeps the line's quantity beside the money", () => {
    const v = amendmentLineChange(line({ change_type: "SPEC", new_item_code: "RN-ELECTRICAL", new_qty: 1, new_unit_price_sen: 120000,
      old_snapshot: { itemCode: "RN-ELECTRICAL", qty: 1, unitPriceSen: 150000, itemGroup: "works" }, cur_room: "Living hall", cur_item_group: "works" }));
    expect(v).toMatchObject({ qty: 0, lineQty: 1, amountSen: -30000, change: "deduct", room: "Living hall", goesTo: "works" });
  });
  it("an added line reads the room it was added in, and a supplier decides where it goes", () => {
    expect(amendmentLineChange(line({ new_item_code: "RN-GRILL", new_qty: 1, new_unit_price_sen: 95000, old_snapshot: { itemGroup: "works", room: "Bedroom 1" } })))
      .toMatchObject({ room: "Bedroom 1", goesTo: "works" });
    expect(amendmentLineChange(line({ new_item_code: "RN-GRILL", new_qty: 1, new_unit_price_sen: 95000, main_supplier: "GRILLCO", old_snapshot: { itemGroup: "works" } })).goesTo).toBe("po");
    expect(amendmentLineChange(line({ new_item_code: "TILE-1", new_qty: 1, new_unit_price_sen: 0, main_supplier: "CUSTOMER" })).goesTo).toBe("client");
  });
  it("a change without a before value has no amount", () => {
    expect(amendmentLineChange(line({ change_type: "SPEC", new_item_code: "B" })).amountSen).toBeNull();
  });
});

describe("VO numbering and totals", () => {
  const vo = (no: string, date: string, bucket: VoRow["bucket"], amounts: number[]): VoRow => ({
    key: no, label: "", source: "amendment", no, soDocNo: "SO-1", title: null, status: "", statusLabel: "", bucket, date, raisedBy: null, approvedBy: null,
    approvedAt: null, recorded: bucket === "approved", netSen: amounts.reduce((s, a) => s + a, 0), href: "", lines: amounts.map((a) => ({
      itemCode: null, description: "", room: null, qty: 1, lineQty: 1, measure: null, amountSen: a, change: a < 0 ? "deduct" : "add", goesTo: "po", fromItemCode: null,
    })),
  });
  it("numbers VOs oldest first", () => {
    expect(labelVos([vo("B", "2026-10-02", "approved", []), vo("A", "2026-10-01", "approved", [])]).map((v) => `${v.label}=${v.no}`)).toEqual(["VO-01=A", "VO-02=B"]);
  });
  it("sums approved adds and deducts, pending apart, closed ignored", () => {
    expect(voTotals([vo("A", "1", "approved", [100, -40]), vo("B", "2", "pending", [7]), vo("C", "3", "closed", [999])]))
      .toEqual({ addedSen: 100, deductedSen: -40, netSen: 60, pendingNetSen: 7 });
  });
  it("labels a withdrawn request", () => {
    expect(amendmentStatus("REJECTED", "WITHDRAWN")).toEqual(["Withdrawn", "closed"]);
    expect(amendmentStatus("SENT", null)).toEqual(["Recorded", "approved"]);
  });
});

describe("grState", () => {
  it("none, part, all", () => {
    expect([grState(4, 0), grState(4, 2), grState(4, 4)]).toEqual(["no", "part", "yes"]);
  });
});

describe("client link token", () => {
  it("round-trips, and refuses a changed, foreign or expired token", async () => {
    const t = await signClientLink("s1", { projectId: 12, companyId: 3, expiresAt: 2_000_000_000_000 });
    expect(await readClientLink("s1", t, 1_000)).toEqual({ projectId: 12, companyId: 3, expiresAt: 2_000_000_000_000 });
    expect(await readClientLink("s2", t, 1_000)).toBeNull();
    const forged = (await signClientLink("s1", { projectId: 13, companyId: 3, expiresAt: 2_000_000_000_000 })).split(".")[0] + "." + t.split(".")[1];
    expect(await readClientLink("s1", forged, 1_000)).toBeNull();
    expect(await readClientLink("s1", t, 3_000_000_000_000)).toBeNull();
    expect(await readClientLink("s1", "nope", 1_000)).toBeNull();
  });
});
