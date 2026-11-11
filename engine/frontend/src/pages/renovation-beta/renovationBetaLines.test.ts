import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));
vi.mock("../../vendor/scm/lib/authed-fetch", () => ({
  authedFetch: async (path: string, init?: { body?: string }) => {
    h.calls.push([path, init?.body ? JSON.parse(init.body) : null]);
    if (path.includes("/lines/b/spec")) return { ok: true, changed: true, flags: 1 };
    if (path.endsWith("/line-edits")) return { voNo: "VO-TC-SO-1-03", flags: 0 };
    return { ok: true, changed: true };
  },
}));

import {
  amendmentLine, amountAfter, byAreaBlocks, contractLineEdits, dateSettable, editProblem, effectiveEdit, groupDate, groupDateTargets, lineDates, lineLate,
  postContractLines, refusalText, unitAfter, variantsAfter, voBatches, type ManagedLine,
} from "./renovationBetaLines";

const line = (over: Partial<ManagedLine> = {}): ManagedLine => ({
  id: "i1", soDocNo: "TC-SO-1", soStatus: "CONFIRMED", voLocked: true, lineNo: 1, itemCode: "PNT-5L", description: "Paint 5L", variantText: null,
  variants: { colorCode: "White", remark: "old side channel" }, itemGroup: "materials", uom: "TIN", qty: 2, unitPriceSen: 10000, discountSen: 0, amountSen: 20000,
  area: "Living", remark: null, supplierName: "Nippon", goesTo: "po", categoryCode: null, subCode: null, variantCategory: null, categoryLabel: "Paint", categorySort: 1, subLabel: "General", subSort: 1,
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

describe("contractLineEdits", () => {
  it("sends only the lines whose SKU or qty moved, with only what moved", () => {
    const l = line();
    const b = voBatches([l, line({ id: "i2", itemCode: "LT-1", qty: 3 })], { i1: { qty: 4 }, i2: { remark: "white" } });
    expect(contractLineEdits(b[0])).toEqual([{ soItemId: "i1", qty: 4 }]);
    const sku = voBatches([l], { i1: { itemCode: "PNT-10L" } });
    expect(contractLineEdits(sku[0])).toEqual([{ soItemId: "i1", itemCode: "PNT-10L" }]);
  });
});

describe("picked variants (owner, 2 Nov 2026)", () => {
  const sofa = line({ id: "s", itemCode: "SOF-GEN-3S", variantCategory: "SOFA", itemGroup: "RENOVATION", variants: { colourId: "PC1461-02", fabricId: "PC1461", fabricCode: "PC1461-02", colourLabel: "PC1461-02", fabricLabel: "PC1461", seatHeight: "24", legHeight: "Default" } });
  const bed = line({ id: "b", itemCode: "BED-HKA-1003-(K)", variantCategory: "BEDFRAME", itemGroup: "RENOVATION", variants: { fabricCode: "PC1461-01", divanHeight: '4"', gap: '4"', legHeight: '1"', totalHeight: '9"' } });
  const pick = { fabricCode: "PC1461-03", colourId: "PC1461-03", fabricId: "PC1461", colourLabel: "PC1461-03" };
  it("a pick lays its keys over the line's variants; the remark key is never sent", () => {
    expect(variantsAfter(line(), {})).toEqual({ colorCode: "White" });
    expect(variantsAfter(sofa, pick)).toEqual({ ...sofa.variants, ...pick });
  });
  it("an edit counts only the keys that moved, and the VO line carries the whole variants", () => {
    expect(effectiveEdit(sofa, { variants: { fabricCode: "PC1461-02", seatHeight: "24" } })).toBeNull();
    const e = effectiveEdit(sofa, { variants: { ...pick, fabricId: "PC1461", seatHeight: "24" } })!;
    expect(e.variants).toEqual({ fabricCode: "PC1461-03", colourId: "PC1461-03", colourLabel: "PC1461-03" });
    const a = amendmentLine(sofa, e);
    expect(a.changeType).toBe("SPEC");
    expect(a.newVariants).toEqual({ ...sofa.variants, ...pick });
  });
  it("the batch names the lines whose variants moved, and those a live PO buys; the words use the SO field names", () => {
    const po = { poId: "p", poNumber: "TC-PO-1", poStatus: "RECEIVED", poLineId: "pl", poDate: null, deliveryDate: null, supplierRevised: false, qty: 1, received: 1, photoKeys: [] };
    const b = voBatches([sofa, { ...bed, pos: [po] }], { s: { variants: pick }, b: { variants: { divanHeight: '6"', totalHeight: '11"' } } });
    expect(b[0].optionIds).toEqual(["s", "b"]);
    expect(b[0].poOptionIds).toEqual(["b"]);
    expect(b[0].reason).toContain("SOF-GEN-3S: Fabric PC1461-02 -> PC1461-03");
    expect(b[0].reason).toContain('Divan height 4" -> 6"; Total height 9" -> 11"');
  });
});

describe("postContractLines", () => {
  it("variants alone go to the line's spec route, no VO even on a PO line; with a qty change they ride the VO edit", async () => {
    h.calls.length = 0;
    const po = { poId: "p", poNumber: "TC-PO-1", poStatus: "RECEIVED", poLineId: "pl", poDate: null, deliveryDate: null, supplierRevised: false, qty: 1, received: 1, photoKeys: [] };
    const lines = [
      line({ id: "a", variantCategory: "SOFA", variants: { fabricCode: "F1", seatHeight: "24" } }),
      line({ id: "b", variantCategory: "BEDFRAME", variants: { divanHeight: '4"' }, pos: [po] }),
      line({ id: "c", variantCategory: "SOFA", variants: { fabricCode: "F1" } }),
    ];
    const [b] = voBatches(lines, { a: { variants: { fabricCode: "F2" } }, b: { variants: { divanHeight: '6"' } }, c: { qty: 5, variants: { seatHeight: "28" } } });
    const r = await postContractLines(b);
    expect(h.calls.map((c) => c[0])).toEqual(["/renovation-so-info/TC-SO-1/lines/a/spec", "/renovation-so-info/TC-SO-1/lines/b/spec", "/renovation/sales-orders/TC-SO-1/line-edits"]);
    expect(h.calls[0][1]).toEqual({ variants: { fabricCode: "F2", seatHeight: "24" } });
    expect((h.calls[2][1] as { edits: unknown[] }).edits).toEqual([{ soItemId: "c", qty: 5, variants: { fabricCode: "F1", seatHeight: "28" } }]);
    expect(r).toMatchObject({ applied: true, amendmentNo: "VO-TC-SO-1-03", poFlags: 1 });
  });
});

describe("unitAfter: a picked SKU with no sell price keeps the line's price", () => {
  it("keeps the stored price when the picked SKU's price is 0", () => {
    expect(unitAfter(line(), { itemCode: "PNT-1L", pickedPriceSen: 0 })).toBe(10000);
    expect(amountAfter(line(), { itemCode: "PNT-1L", pickedPriceSen: 0 })).toBe(20000);
  });
  it("takes the picked SKU's own price when it has one", () => {
    expect(unitAfter(line(), { itemCode: "PNT-1L", pickedPriceSen: 4500 })).toBe(4500);
  });
});
