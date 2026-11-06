import { describe, expect, it } from "vitest";
import {
  amendmentChanges, describeChange, facetLabel, isAutoTitle, optionDiffs, pairOmitAdd, variantsAsOf, voTopic,
  type ChangeSide, type PairItem,
} from "./renovationVoChanges";
import { mergeRenoPair, withWords, type RenoVoDraftLine, type VoLine, type VoRow } from "./betaVoPo";

const BED_4 = { gap: '4"', colourId: "PC1461-01", fabricId: "PC1461", legHeight: '1"', fabricCode: "PC1461-01", colourLabel: "PC1461-01", divanHeight: '4"', fabricLabel: "PC1461", totalHeight: '9"' };
const BED_5 = { ...BED_4, divanHeight: '5"', totalHeight: '10"' };
const SOFA_02 = { colourId: "PC1461-02", fabricId: "PC1461", legHeight: "Default", fabricCode: "PC1461-02", seatHeight: "24", colourLabel: "PC1461-02", fabricLabel: "PC1461" };
const SOFA_03 = { ...SOFA_02, colourId: "PC1461-03", fabricCode: "PC1461-03", colourLabel: "PC1461-03" };

const side = (o: Partial<ChangeSide>): ChangeSide => ({ itemCode: "X", description: "Thing", room: "Living hall", qty: 1, unitPriceSen: 1000, variants: null, ...o });
const item = (s: "omit" | "add", itemCode: string | null, room: string | null, payload: string, group = "g1"): PairItem<string> => ({ side: s, group, room, itemCode, payload });

describe("describeChange", () => {
  it("names an added and a removed line", () => {
    expect(describeChange(null, side({}))).toEqual([{ kind: "added", from: null, to: null }]);
    expect(describeChange(side({}), null)).toEqual([{ kind: "removed", from: null, to: null }]);
  });
  it("names a qty, SKU and price change with before and after", () => {
    expect(describeChange(side({ qty: 1 }), side({ qty: 2 }))).toEqual([{ kind: "qty", from: "1", to: "2" }]);
    expect(describeChange(side({ itemCode: "BED-A" }), side({ itemCode: "BED-B" }))[0]).toEqual({ kind: "sku", from: "BED-A", to: "BED-B" });
    const p = describeChange(side({ unitPriceSen: 600000 }), side({ unitPriceSen: 650000 }));
    expect(facetLabel(p[0])).toBe("Price changed RM 6,000.00 → RM 6,500.00");
    expect(facetLabel(p[0], false)).toBe("Price changed");
  });
  it("names an options change by the options that moved, one word per option", () => {
    const f = describeChange(side({ variants: BED_4 }), side({ variants: BED_5 }));
    expect(f).toEqual([{ kind: "options", from: 'Divan 4", Total height 9"', to: 'Divan 5", Total height 10"' }]);
    expect(facetLabel(f[0])).toBe('Options changed Divan 4", Total height 9" → Divan 5", Total height 10"');
    expect(optionDiffs(SOFA_02, SOFA_03)).toEqual([["Colour", "PC1461-02", "PC1461-03"]]);
  });
  it("does not compare options across two SKUs, nor when a side does not know them", () => {
    expect(describeChange(side({ itemCode: "A", variants: SOFA_02 }), side({ itemCode: "B", variants: BED_4 })).map((f) => f.kind)).toEqual(["sku"]);
    expect(describeChange(side({ variants: SOFA_02 }), side({ variants: null }))).toEqual([{ kind: "changed", from: null, to: null }]);
  });
});

describe("pairOmitAdd", () => {
  it("joins an omit and an add of the same SKU in the same section (quickVo's qty or options change)", () => {
    expect(pairOmitAdd([item("omit", "SOF", "Living hall", "o"), item("add", "SOF", "Living hall", "a")])).toEqual([{ omit: "o", add: "a" }]);
  });
  it("joins a SKU change by order: the add right after its omit", () => {
    const out = pairOmitAdd([item("omit", "BED-A", "Bedroom 1", "o1"), item("add", "BED-B", null, "a1"), item("omit", "TV", "Living hall", "o2")]);
    expect(out).toEqual([{ omit: "o1", add: "a1" }, { omit: "o2", add: null }]);
  });
  it("keeps a removal and an addition in different rooms apart", () => {
    const out = pairOmitAdd([item("omit", "SOF", "Living hall", "o"), item("add", "SOF", "Bedroom 1", "a")], { adjacent: false });
    expect(out).toEqual([{ omit: "o", add: null }, { omit: null, add: "a" }]);
  });
  it("keeps sections apart, and an unnamed room never pairs two different SKUs without order", () => {
    expect(pairOmitAdd([item("omit", "SOF", "Living hall", "o", "g1"), item("add", "SOF", "Living hall", "a", "g2")])).toEqual([{ omit: "o", add: null }, { omit: null, add: "a" }]);
    expect(pairOmitAdd([item("add", "CURTAIN", null, "a"), item("omit", "LIGHT", null, "o")], { adjacent: false })).toEqual([{ omit: null, add: "a" }, { omit: "o", add: null }]);
  });
  it("pairs the only omit and add left in a named room", () => {
    expect(pairOmitAdd([item("add", "BED-B", "Bedroom 1", "a"), item("omit", "BED-A", "Bedroom 1", "o")], { adjacent: false })).toEqual([{ omit: "o", add: "a" }]);
  });
  it("matches the same SKU first, so two edits in one section each find their own add", () => {
    const out = pairOmitAdd([item("omit", "A", null, "oA"), item("omit", "B", null, "oB"), item("add", "B", null, "aB"), item("add", "A", null, "aA")]);
    expect(out).toEqual([{ omit: "oA", add: "aA" }, { omit: "oB", add: "aB" }]);
  });
});

describe("amendmentChanges (a renovation VO's so_amendment_lines)", () => {
  const remove = (id: string, snap: Record<string, unknown>) => ({ id, change_type: "REMOVE", new_item_code: null, new_qty: null, new_unit_price_sen: null, old_snapshot: snap });
  const add = (id: string, code: string, qty: number, price: number, room: string, variants: unknown) => ({ id, change_type: "ADD", new_item_code: code, new_qty: qty, new_unit_price_sen: price, old_snapshot: null, cur_room: room, cur_variants: variants, cur_description: "x" });
  it("VO-01: a sofa omitted and re-added at 2 reads as one Qty changed 1 → 2", () => {
    const out = amendmentChanges([
      add("a", "SOF-GEN-3S", 2, 299000, "Living hall", SOFA_02),
      remove("r", { item_code: "SOF-GEN-3S", qty: 1, unit_price_sen: 299000, room: "Living hall", variants: SOFA_02, description: "SOFA 3S" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].lineIds).toEqual(["r", "a"]);
    expect(out[0].facets).toEqual([{ kind: "qty", from: "1", to: "2" }]);
  });
  it("VO-02: a bedframe re-specified reads as one Options changed", () => {
    const out = amendmentChanges([
      add("a", "BED-HKA-1003-(K)", 1, 150000, "Bedroom 1", BED_5),
      remove("r", { item_code: "BED-HKA-1003-(K)", qty: 1, unit_price_sen: 150000, room: "Bedroom 1", variants: BED_4 }),
    ]);
    expect(out.map((c) => c.facets[0].kind)).toEqual(["options"]);
  });
  it("an engine amendment's MODIFY reads its own fields; an empty variants object leaves the options alone", () => {
    const [c] = amendmentChanges([{ id: "m", change_type: "QTY", new_item_code: "DL", new_qty: 4, new_unit_price_sen: 4500, new_variants: {}, old_snapshot: { item_code: "DL", qty: 6, unit_price_sen: 4500, variants: { colorCode: "WH" } } }]);
    expect(c.facets).toEqual([{ kind: "qty", from: "6", to: "4" }]);
  });
});

describe("variantsAsOf", () => {
  const edits = [{ note: "SOF-GEN-3S: options PC1461-03 / SEAT 24", field_changes: [{ field: "variants", from: SOFA_02, to: SOFA_03 }], at: "2026-11-02T15:57:00Z" }];
  it("undoes an option edit made after the VO, from the edit's before", () => {
    expect(variantsAsOf("SOF-GEN-3S", SOFA_03, edits, "2026-11-02 14:48:54.156039+00")).toEqual(SOFA_02);
  });
  it("keeps the options when the edit came before the VO or was another SKU's", () => {
    expect(variantsAsOf("SOF-GEN-3S", SOFA_03, edits, "2026-11-02 16:00:00+00")).toEqual(SOFA_03);
    expect(variantsAsOf("BED-1", BED_5, edits, "2026-11-02 14:00:00+00")).toEqual(BED_5);
  });
});

describe("voTopic", () => {
  const lines = [
    { description: "SOFA 3S", itemCode: "SOF", facets: [{ kind: "qty" as const, from: "1", to: "2" }] },
    { description: "HILTON BEDFRAME", itemCode: "BED", facets: [{ kind: "options" as const, from: 'Divan 4"', to: 'Divan 5"' }] },
    { description: "TV CONSOLE", itemCode: "TV", facets: [{ kind: "added" as const, from: null, to: null }] },
  ];
  it("counts and names the changes when the title is the system's", () => {
    expect(voTopic("Changed on the project PO tab", lines)).toBe('2 changed, 1 added: SOFA 3S qty 1 → 2; HILTON BEDFRAME options Divan 4" → Divan 5"; TV CONSOLE added');
    expect(voTopic(null, lines, true, 1)).toBe("2 changed, 1 added: SOFA 3S qty 1 → 2; +2 more");
  });
  it("uses a title staff typed", () => {
    expect(voTopic("Client wants a bigger sofa", lines)).toBe("Client wants a bigger sofa");
    expect(isAutoTitle("Options of BED-HKA-1003-(K) changed (on TC-PO-2611-001)")).toBe(true);
    expect(isAutoTitle("Variation order VO-TC-SO-2611-001-01")).toBe(true);
  });
});

describe("mergeRenoPair and withWords", () => {
  const vl = (o: Partial<VoLine>): VoLine => ({ itemCode: "SOF", description: "SOFA 3S", room: "Living hall", qty: 1, measure: null, amountSen: 299000, change: "add", lineQty: 1, goesTo: "po", categoryCode: null, subCode: null, fromItemCode: null, ...o });
  const omit: RenoVoDraftLine = { line: vl({ qty: -1, amountSen: -299000, change: "deduct", lineQty: 0 }), side: side({ itemCode: "SOF", qty: 1, unitPriceSen: 299000 }), partial: null };
  const add: RenoVoDraftLine = { line: vl({ qty: 2, amountSen: 598000 }), side: side({ itemCode: "SOF", qty: 2, unitPriceSen: 299000 }), partial: null };
  it("makes one line of an omit and its add: the net qty and money, and the change", () => {
    const m = mergeRenoPair(omit, add);
    expect(m.qty).toBe(1);
    expect(m.amountSen).toBe(299000);
    expect(m.change).toBe("add");
    expect(m.facets).toEqual([{ kind: "qty", from: "1", to: "2" }]);
  });
  it("reads a part omit as a qty change of the line it cut", () => {
    const m = mergeRenoPair({ ...omit, partial: { from: 3, to: 2 } }, null);
    expect(m.facets).toEqual([{ kind: "qty", from: "3", to: "2" }]);
    expect(m.lineQty).toBe(2);
  });
  it("words each line and gives the VO its topic", () => {
    const v: VoRow = { key: "k", label: "VO-01", source: "renovation", no: "VO-1", soDocNo: "SO", title: "Changed on the project PO tab", status: "APPROVED", statusLabel: "Approved", bucket: "approved", date: null, raisedBy: null, approvedBy: null, approvedAt: null, recorded: false, netSen: 0, href: "", lines: [mergeRenoPair(omit, add)] };
    const w = withWords(v, true);
    expect(w.lines[0].changeLabels).toEqual(["Qty changed 1 → 2"]);
    expect(w.topic).toBe("1 changed: SOFA 3S qty 1 → 2");
  });
});
