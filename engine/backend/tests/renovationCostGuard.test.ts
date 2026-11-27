import { describe, expect, test } from "vitest";
import { keepLineCosts, previousLines, stripLineCosts } from "../src/scm/lib/renovation-cost-guard";
import type { RenoDb } from "../src/scm/lib/renovation-db";
import type { NormSection } from "../src/scm/lib/renovation-validate";

/* Owner, 27 Nov 2026: sales never see what we pay; a salesperson's save must not clear it either. */
describe("a renovation line's cost, out and in", () => {
  test("every line at any depth loses its cost and supplier; nothing else changes", () => {
    const doc = {
      revision: { id: "r1", sections: [{ heading: "Living", lines: [
        { id: "l1", kind: "ITEM", itemCode: "FUR-HLM-355019", unitPriceSen: 120000, unitCostSen: 61950, supplierId: "s1" },
        { id: "l2", kind: "TEXT", description: "note", unitCostSen: 0, supplierId: null },
      ] }] },
      totals: { linesSen: 120000 },
      supplierId: "not-a-line",
    };
    const out = stripLineCosts(doc);
    expect(JSON.stringify(out)).not.toContain("61950");
    expect(out.revision.sections[0]!.lines[0]).toMatchObject({ unitPriceSen: 120000, unitCostSen: 0, supplierId: null, itemCode: "FUR-HLM-355019" });
    expect(out.totals.linesSen).toBe(120000);
    expect(out.supplierId).toBe("not-a-line");
    expect(doc.revision.sections[0]!.lines[0]!.unitCostSen).toBe(61950);
  });

  test("a saved line keeps the stored cost; a new line takes the product's main supplier binding; nothing found is zero", async () => {
    const calls: string[] = [];
    const db = {
      q: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("from scm.reno_doc_lines")) return [{ id: "11111111-1111-4111-8111-111111111111", unit_cost_sen: 61950, supplier_id: "s-stored" }];
        if (sql.includes("from scm.mfg_products")) return [{ code: "FUR-HLM-336046", supplier_id: "s-bound", cost_sen: 26750 }];
        return [];
      },
    } as unknown as RenoDb;
    const sections = [{ id: "sec", heading: "", lines: [
      { id: "11111111-1111-4111-8111-111111111111", kind: "ITEM", itemCode: "FUR-HLM-355019", unitCostSen: 0, supplierId: null },
      { id: "22222222-2222-4222-8222-222222222222", kind: "ITEM", itemCode: "FUR-HLM-336046", unitCostSen: 0, supplierId: null },
      { id: "33333333-3333-4333-8333-333333333333", kind: "ITEM", itemCode: "UNKNOWN", unitCostSen: 999, supplierId: "typed" },
    ] }] as unknown as NormSection[];
    const out = await keepLineCosts(db, sections, 1);
    const [a, b, c] = out[0]!.lines;
    expect(a).toMatchObject({ unitCostSen: 61950, supplierId: "s-stored" });
    expect(b).toMatchObject({ unitCostSen: 26750, supplierId: "s-bound" });
    expect(c).toMatchObject({ unitCostSen: 0, supplierId: null });
    expect(calls).toHaveLength(2);
  });

  test("an editor that sends new ids still keeps each line's stored cost, matched by product in order", async () => {
    const db = { q: async () => [] } as unknown as RenoDb;
    const before = { revision: { sections: [{ lines: [
      { kind: "ITEM", itemCode: "RN-PAINTING", unitCostSen: 12345, supplierId: "s1" },
      { kind: "ITEM", itemCode: "RN-PAINTING", unitCostSen: 500, supplierId: "s2" },
    ] }] } };
    const sections = [{ id: "sec", heading: "", lines: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "ITEM", itemCode: "RN-PAINTING", unitCostSen: 0, supplierId: null },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "ITEM", itemCode: "RN-PAINTING", unitCostSen: 0, supplierId: null },
    ] }] as unknown as NormSection[];
    const out = await keepLineCosts(db, sections, 1, previousLines(before));
    expect(out[0]!.lines.map((l) => [l.unitCostSen, l.supplierId])).toEqual([[12345, "s1"], [500, "s2"]]);
  });
});
