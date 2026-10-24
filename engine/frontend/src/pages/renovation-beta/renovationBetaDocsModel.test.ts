import { describe, expect, it } from "vitest";
import { datesText, deliveredGroups, docSummary } from "./renovationBetaDocsModel";
import type { LinePo, ManagedLine } from "./renovationBetaLines";
import { dayMonth } from "./renovationBetaModel";
import type { SiteDelivery } from "./renovationBetaSiteApi";
import { progressDayText } from "./renovationBetaSiteModel";

const po = (over: Partial<LinePo>): LinePo => ({
  poId: "po1", poNumber: "TC-PO-1", poStatus: "SUBMITTED", poLineId: "pl1", poDate: null, deliveryDate: "2026-10-30", qty: 1, received: 0, photoKeys: [], supplierRevised: false, ...over,
});
const line = (id: string, over: Partial<ManagedLine> = {}): ManagedLine => ({
  id, soDocNo: "SO-1", soStatus: "CONFIRMED", voLocked: false, lineNo: 1, itemCode: `SKU-${id}`, description: `Item ${id}`, variantText: null, variants: {},
  itemGroup: null, uom: "UNIT", qty: 2, unitPriceSen: null, discountSen: null, amountSen: null, area: "Kitchen", remark: null, supplierName: null,
  goesTo: "po", categoryLabel: "Cabinet", categorySort: 1, subLabel: "", subSort: 0, pos: [], photoKeys: [], skuPhotos: [], gr: "no", do: "no",
  plan: { orderOn: null, deliverOn: "2026-11-05", noPo: false }, ...over,
});
const doc = (over: Partial<SiteDelivery>): SiteDelivery => ({
  type: "delivery_order", id: "d1", no: "DO-1", at: "2026-10-24T03:00:00Z", status: "DELIVERED", from: null, poNumber: null, poIds: [], areas: [], lines: [], photos: [], ...over,
});

const lines = [
  line("a", { pos: [po({ poNumber: "TC-PO-1", poLineId: "pl-a", deliveryDate: "2026-10-30" }), po({ poNumber: "TC-PO-0", poStatus: "CANCELLED", poLineId: "pl-x" })] }),
  line("b", { goesTo: "client", area: "Living", categoryLabel: "Lighting", categorySort: 0 }),
  line("c", { area: null }),
];

describe("DO and GR rows", () => {
  it("show the PO number, Client PO and delivery date the PO tab shows", () => {
    const d = doc({ lines: [{ soItemId: "a", poLineId: null, qty: 1 }, { soItemId: "b", poLineId: null, qty: 1 }] });
    const s = docSummary(d, lines, [d]);
    expect(s.pos).toEqual(["TC-PO-1"]);
    expect(s.clientPo).toBe(true);
    // a: the PO line's date (not the plan's); b: no PO, so the line's plan.
    expect(s.deliverOn).toEqual(["2026-10-30", "2026-11-05"]);
    expect(datesText(s.deliverOn, dayMonth)).toBe("30 Oct, 5 Nov");
    expect(datesText(["2026-10-01", "2026-10-02", "2026-10-09"], dayMonth)).toBe("1 Oct to 9 Oct");
  });

  it("link a goods receipt to the DOs that carried its lines", () => {
    const d1 = doc({ id: "d1", no: "DO-1", lines: [{ soItemId: "a", poLineId: null, qty: 1 }] });
    const d2 = doc({ id: "d2", no: "DO-2", lines: [{ soItemId: "c", poLineId: null, qty: 1 }] });
    const g = doc({ type: "goods_received", id: "g1", no: "GRN-1", poNumber: "TC-PO-1", lines: [{ soItemId: "a", poLineId: "pl-a", qty: 2 }] });
    const s = docSummary(g, lines, [d1, d2, g]);
    expect(s.dos.map((x) => x.no)).toEqual(["DO-1"]);
    expect(s.pos).toEqual(["TC-PO-1"]);
    expect(docSummary(doc({ type: "goods_received", poNumber: "TC-PO-9" }), [], []).pos).toEqual(["TC-PO-9"]);
  });

  it("group delivered lines by category or area with the documents that delivered them", () => {
    const pod = { id: "p1", path: "/p", name: "POD", image: true, area: null, at: null, source: "pod" as const };
    const living = { ...pod, id: "p2", area: "Living", source: "upload" as const };
    const d1 = doc({ id: "d1", no: "DO-1", lines: [{ soItemId: "a", poLineId: null, qty: 1 }, { soItemId: "b", poLineId: null, qty: 1 }], photos: [pod, living] });
    const d2 = doc({ id: "d2", no: "DO-2", lines: [{ soItemId: "a", poLineId: null, qty: 1 }, { soItemId: "c", poLineId: null, qty: 2 }, { soItemId: "zz", poLineId: null, qty: 1 }] });
    const byCat = deliveredGroups([d1, d2], lines, "category");
    expect(byCat.map((g) => [g.label, g.lines.map((r) => r.key)])).toEqual([["Lighting", ["b"]], ["Cabinet", ["a", "c"]]]);
    const a = byCat[1].lines[0];
    expect([a.qty, a.docs.map((x) => `${x.d.no}:${x.qty}`), a.poNumber, a.deliverOn]).toEqual([2, ["DO-1:1", "DO-2:1"], "TC-PO-1", "2026-10-30"]);
    expect(byCat[0].lines[0].clientPo).toBe(true);
    const byArea = deliveredGroups([d1, d2], lines, "area");
    expect(byArea.map((g) => g.label)).toEqual(["Kitchen", "Living", "No area"]);
    // The kitchen line keeps the whole-DO POD but not the photo tagged Living.
    expect(byArea[0].lines[0].photos.map((p) => p.id)).toEqual(["p1"]);
    expect(byArea[1].lines[0].photos.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("Site progress header", () => {
  const span = { day: 1, total: 1, start: "2026-10-24" };
  it("reads the step SLA like the project list, not the tasks' span", () => {
    expect(progressDayText({ stepKey: "renovation", daysIn: 0, days: 45, overdueBy: null }, "Renovation", span, "2026-10-24")).toBe("Day 1 of 45");
    expect(progressDayText({ stepKey: "ordering", daysIn: 2, days: 14, overdueBy: null }, "Ordering", span, "2026-10-24")).toBe("Ordering · Day 3 of 14");
    expect(progressDayText(null, null, { day: 3, total: 20, start: "2026-10-22" }, "2026-10-24")).toBe("Day 3 of 20");
    expect(progressDayText(null, null, null, "2026-10-24")).toBeNull();
  });
});
