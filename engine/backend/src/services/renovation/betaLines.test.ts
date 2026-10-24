import { describe, expect, it } from "vitest";
import { cleanLinePlan, grOf, markOf, mergePlan, planOrderRefusal, type LinePo } from "./betaLines";
import { amendmentLineChange, lineChangeWords, type AmendmentLineRow } from "./betaVoPo";

const po = (over: Partial<LinePo>): LinePo => ({ photoKeys: [],
  poId: "p", poNumber: "PO-1", poStatus: "SUBMITTED", poLineId: "l", poDate: null, deliveryDate: null, supplierRevised: false, qty: 1, received: 0, ...over,
});

describe("line marks", () => {
  it("GR counts only live POs", () => {
    expect(grOf([po({ qty: 2, received: 2 }), po({ poStatus: "CANCELLED", qty: 5, received: 0 })])).toBe("yes");
    expect(grOf([po({ qty: 4, received: 1 })])).toBe("part");
    expect(grOf([])).toBe("no");
  });
  it("DO compares delivered with the line quantity", () => {
    expect(markOf(3, 3)).toBe("yes");
    expect(markOf(3, 1)).toBe("part");
    expect(markOf(3, 0)).toBe("no");
  });
});

describe("planned dates", () => {
  it("accepts dates, null to clear, and the PO choice", () => {
    expect(cleanLinePlan({ orderOn: "2026-11-02", deliverOn: null, noPo: true })).toEqual({ ok: true, patch: { orderOn: "2026-11-02", deliverOn: null, noPo: true } });
  });
  it("refuses an impossible date and an empty edit", () => {
    expect(cleanLinePlan({ orderOn: "2026-02-31" }).ok).toBe(false);
    expect(cleanLinePlan({ deliverOn: "next week" }).ok).toBe(false);
    expect(cleanLinePlan({}).ok).toBe(false);
  });
  it("merges onto the saved plan, keeping what the edit leaves out", () => {
    const next = mergePlan({ orderOn: "2026-11-01", deliverOn: "2026-11-20", noPo: false }, { deliverOn: "2026-11-25" });
    expect(next).toEqual({ orderOn: "2026-11-01", deliverOn: "2026-11-25", noPo: false });
    expect(planOrderRefusal(next)).toBeNull();
    expect(planOrderRefusal({ orderOn: "2026-12-01", deliverOn: "2026-11-01", noPo: false })).toMatch(/after/);
  });
});

const amend = (over: Partial<AmendmentLineRow>): AmendmentLineRow => ({
  change_type: "SPEC", new_item_code: null, new_qty: null, new_unit_price_sen: null, new_discount_sen: null, old_snapshot: null,
  cur_item_code: null, cur_description: null, cur_qty: null, cur_total_sen: null, product_name: null, ...over,
});

/* What the PO tab's "Save & post to VO" sends for an edit that costs nothing: the line's own price and qty, a new
   colour and remark. The VO must still read as a record of what moved. */
describe("a VO raised from a PO tab edit", () => {
  it("a colour and remark change is recorded at no money, with the words of the change", () => {
    const v = amendmentLineChange(amend({
      new_item_code: "PNT-NIPPON-5L", new_qty: 2, new_unit_price_sen: 12000, new_remark: "Feature wall only",
      new_variants: { colorCode: "NP 1234 Grey" },
      old_snapshot: { itemCode: "PNT-NIPPON-5L", qty: 2, unitPriceSen: 12000, variants: { colorCode: "NP 0001 White" }, remark: "" },
      cur_item_group: "materials",
    }));
    expect(v.amountSen).toBe(0);
    expect(v.change).toBe("change");
    expect(v.changes).toEqual(["Colour: NP 0001 White -> NP 1234 Grey", "Remark: Feature wall only"]);
  });
  it("a qty and SKU swap reads both, with the money", () => {
    const v = amendmentLineChange(amend({
      new_item_code: "TILE-B", new_qty: 3, new_unit_price_sen: 5000,
      old_snapshot: { itemCode: "TILE-A", qty: 2, unitPriceSen: 4000 },
    }));
    expect(v.amountSen).toBe(3 * 5000 - 2 * 4000);
    expect(v.changes).toEqual(["SKU: TILE-A -> TILE-B", "Qty: 2 -> 3"]);
    expect(v.fromItemCode).toBe("TILE-A");
  });
  it("a remark cleared is said; the remark key inside variants is not a variant change", () => {
    expect(lineChangeWords(amend({ new_remark: "", new_variants: { remark: "x" }, old_snapshot: { remark: "old note", variants: {} } }))).toEqual(["Remark cleared"]);
  });
  it("added and removed lines carry no change words", () => {
    expect(lineChangeWords(amend({ change_type: "ADD", new_remark: "x" }))).toEqual([]);
  });
});
