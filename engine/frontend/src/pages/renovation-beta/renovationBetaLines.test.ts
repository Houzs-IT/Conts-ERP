import { describe, expect, it } from "vitest";
import { amendmentLine, amountAfter, byAreaBlocks, dateSettable, editProblem, effectiveEdit, groupDate, groupDateTargets, lineDates, lineLate, linesCsv, refusalText, voBatches, type ManagedLine } from "./renovationBetaLines";

const line = (over: Partial<ManagedLine> = {}): ManagedLine => ({
  id: "i1", soDocNo: "TC-SO-1", soStatus: "CONFIRMED", voLocked: true, lineNo: 1, itemCode: "PNT-5L", description: "Paint 5L", variantText: null,
  variants: { colorCode: "White", remark: "old side channel" }, itemGroup: "materials", uom: "TIN", qty: 2, unitPriceSen: 10000, discountSen: 0, amountSen: 20000,
  area: "Living", remark: null, supplierName: "Nippon", goesTo: "po", categoryLabel: "Paint", categorySort: 1, subLabel: "General", subSort: 1,
  pos: [], photoKeys: [], skuPhotos: [], gr: "no", do: "no", plan: { orderOn: null, deliverOn: null, noPo: false }, ...over,
});

describe("edits", () => {
  it("an edit equal to the line is no edit", () => {
    expect(effectiveEdit(line(), { qty: 2, colour: "White ", remark: "" })).toBeNull();
  });
  it("amount follows qty at the line's price, and a swapped SKU at its sell price", () => {
    const l = line({ discountSen: 1000, amountSen: 19000 });
    expect(amountAfter(l, effectiveEdit(l, { qty: 3 }))).toBe(29000);
    expect(amountAfter(l, effectiveEdit(l, { itemCode: "PNT-10L", pickedPriceSen: 18000 }))).toBe(35000);
    expect(amountAfter(l, effectiveEdit(l, { remark: "x" }))).toBe(19000);
  });
  it("refuses a qty below 1 or not whole", () => {
    expect(editProblem({ qty: 0 })).toMatch(/1 or more/);
    expect(editProblem({ qty: 1.5 })).toMatch(/whole/);
  });
});

describe("Save & post to VO", () => {
  it("a qty-only change is a QTY line with the old values as its snapshot", () => {
    const a = amendmentLine(line(), { qty: 4 });
    expect(a).toMatchObject({ salesOrderItemId: "i1", changeType: "QTY", newQty: 4, newItemCode: "PNT-5L", newUnitPriceSen: 10000 });
    expect(a.oldSnapshot).toMatchObject({ itemCode: "PNT-5L", qty: 2, unitPriceSen: 10000 });
    expect(a).not.toHaveProperty("newRemark");
  });
  it("a colour and remark change is a SPEC line: whole variants with the new colour, the remark key left out, the remark sent", () => {
    const a = amendmentLine(line(), { colour: "Grey 22", remark: "Feature wall" });
    expect(a.changeType).toBe("SPEC");
    expect(a.newVariants).toEqual({ colorCode: "Grey 22" });
    expect(a.newRemark).toBe("Feature wall");
    expect(a.newQty).toBe(2);
  });
  it("a SKU swap carries the new code and its price", () => {
    expect(amendmentLine(line(), { itemCode: "PNT-10L", pickedPriceSen: 18000 })).toMatchObject({ changeType: "SPEC", newItemCode: "PNT-10L", newUnitPriceSen: 18000 });
  });
  it("one VO per sales order; draft orders and untouched lines are left out", () => {
    const lines = [line(), line({ id: "i2", itemCode: "TILE" }), line({ id: "i3", soDocNo: "TC-SO-2" }), line({ id: "i4", soDocNo: "TC-SO-3", voLocked: false })];
    const b = voBatches(lines, { i1: { qty: 3 }, i2: { remark: "matte" }, i3: { colour: "Blue" }, i4: { qty: 9 } });
    expect(b.map((x) => [x.docNo, x.lines.length])).toEqual([["TC-SO-1", 2], ["TC-SO-2", 1]]);
    expect(b[0].reason).toContain("PNT-5L: Qty 2 -> 3");
    expect(b[0].reason).toContain("TILE: Remark: matte");
  });
  it("shows the server's own sentence when the order refuses", () => {
    const err = Object.assign(new Error("That clashes"), { body: JSON.stringify({ error: "received_floor", reason: "PO-9 has 3 received; the qty cannot go below 3." }) });
    expect(refusalText(err)).toBe("PO-9 has 3 received; the qty cannot go below 3.");
    expect(refusalText(new Error("plain"))).toBe("plain");
  });
});

describe("dates", () => {
  const po = { poId: "p", poNumber: "PO-1", poStatus: "SUBMITTED", poLineId: "pl", poDate: "2026-10-01", deliveryDate: "2026-10-20", supplierRevised: false, qty: 2, received: 0, photoKeys: [] };
  it("processing date is always the line's own; delivery is the PO line's once a PO holds it", () => {
    const l = line({ pos: [po], plan: { orderOn: "2026-09-01", deliverOn: "2026-09-02", noPo: false } });
    expect(lineDates(l)).toMatchObject({ orderOn: "2026-09-01", deliverOn: "2026-10-20" });
    expect(lineDates(line({ plan: { orderOn: "2026-09-01", deliverOn: null, noPo: false } })).orderOn).toBe("2026-09-01");
  });
  it("late: past order date with no PO, past delivery not delivered; a no-PO line is never late to order", () => {
    expect(lineLate(line({ plan: { orderOn: "2026-10-01", deliverOn: null, noPo: false } }), "2026-10-24")).toBe("order");
    expect(lineLate(line({ plan: { orderOn: "2026-10-01", deliverOn: null, noPo: true } }), "2026-10-24")).toBeNull();
    expect(lineLate(line({ pos: [po] }), "2026-10-24")).toBe("deliver");
    expect(lineLate(line({ pos: [po], do: "yes" }), "2026-10-24")).toBeNull();
  });
  it("a group shows the date its lines share, else mixed", () => {
    const a = line({ id: "a", plan: { orderOn: "2026-10-01", deliverOn: null, noPo: false } });
    const b = line({ id: "b", plan: { orderOn: "2026-10-01", deliverOn: null, noPo: false } });
    const c = line({ id: "c" });
    expect(groupDate([a, b], "orderOn")).toBe("2026-10-01");
    expect(groupDate([a, b, c], "orderOn")).toBe("mixed");
    expect(groupDate([c], "deliverOn")).toBeNull();
    expect(groupDate([line({ id: "d", pos: [po] }), line({ id: "e", plan: { orderOn: null, deliverOn: "2026-10-20", noPo: false } })], "deliverOn")).toBe("2026-10-20");
  });
  it("a group date sets only the lines it can and that differ; a supplier-revised PO line keeps its date", () => {
    const onPo = line({ id: "p", pos: [po] });
    const revised = line({ id: "r", pos: [{ ...po, supplierRevised: true }] });
    const draft = line({ id: "d", voLocked: false });
    const plain = line({ id: "x" });
    expect(dateSettable(onPo, "deliverOn", false)).toBe(true);
    expect(dateSettable(revised, "deliverOn", true)).toBe(false);
    expect(dateSettable(plain, "orderOn", false)).toBe(false);
    expect(groupDateTargets([onPo, revised, draft, plain], "deliverOn", "2026-11-01", true).map((l) => l.id)).toEqual(["p", "x"]);
    expect(groupDateTargets([onPo], "deliverOn", "2026-10-20", true)).toEqual([]);
  });
  it("by area: one block per room, no area last", () => {
    const b = byAreaBlocks([line({ id: "a", area: null }), line({ id: "b", area: "Kitchen" }), line({ id: "c", area: "Kitchen" })]);
    expect(b.map((x) => [x.label, x.count])).toEqual([["Kitchen", 2], ["No area", 1]]);
  });
  it("exports one row per line, quoting commas", () => {
    const csv = linesCsv([line({ description: "Paint, matte" })], true).split("\r\n");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('"Paint, matte"');
    expect(csv[1]).toContain("200.00");
  });
});

describe("line photos", () => {
  it("shows up to three, order line first, then PO, then SKU; the rest are +N", async () => {
    const { photoCount, photoSlots } = await import("./BetaLinePhotos");
    const set = {
      so: { docNo: "SO", itemId: "i", keys: ["a", "b"] },
      po: [{ poId: "p", poLineId: "pl", poNumber: "PO-1", keys: ["c", "d"] }],
      sku: [{ productId: "x", key: "k", thumbKey: null }],
    };
    expect(photoCount(set)).toBe(5);
    expect(photoSlots(set, 3)).toEqual({ so: 2, po: [1], sku: 0 });
    expect(photoSlots({ so: null, po: [], sku: set.sku }, 3)).toEqual({ so: 0, po: [], sku: 1 });
  });
});
