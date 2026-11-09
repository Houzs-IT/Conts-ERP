import { describe, expect, it } from "vitest";
import { issueMaterials, reverseIssues } from "../src/scm/lib/renovation-production-stock";
import { stockOutDoLinesFromRacks, writeDoItemCosts } from "../src/scm/routes/delivery-orders-mfg";

/* The free Workers plan allows 50 outside calls a request, and every Supabase REST call (sb.from / sb.rpc) is one
   (Hookka #1152). A 60-line document must finish its stock step well inside that. The fake below answers each awaited
   query from a table of canned rows and counts it, so a test reads "this step made N calls". */

type Call = { table: string; op: string };
type Answer = (table: string, op: string, filters: Record<string, unknown>) => unknown[] | null;

function fakeSb(answer: Answer, rpc: (name: string) => { data?: unknown; error?: { message: string } | null }) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    let op = "select";
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      if (name === "update" || name === "delete" || name === "insert" || name === "upsert") op = name;
      if (name === "eq" || name === "in") filters[String(args[0])] = args[1];
      return b;
    };
    for (const m of ["select", "eq", "in", "neq", "lt", "gt", "or", "order", "limit", "update", "delete", "insert", "upsert", "maybeSingle", "single"]) b[m] = chain(m);
    b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      calls.push({ table, op });
      try { resolve({ data: answer(table, op, filters), error: null, count: 0 }); } catch (e) { reject(e); }
    };
    return b;
  };
  const sb = {
    from: (t: string) => builder(t),
    rpc: async (name: string) => { calls.push({ table: name, op: "rpc" }); return { data: 0, error: null, ...rpc(name) }; },
  };
  return { sb, calls };
}

const N = 60;
const ids = Array.from({ length: N }, (_, i) => `m${String(i).padStart(3, "0")}`);
const codes = ids.map((_, i) => `SKU-${i}`);

describe("production order Start (issue) and Cancel (release): calls do not grow with the material count", () => {
  const materials = ids.map((id, i) => ({ id, item_code: codes[i], description: `Material ${i}`, qty_needed: (i % 7) + 1, qty_issued: 0, qty_returned: 0, qty_issued_short: 0 }));
  const answer: Answer = (table, op) => {
    if (op !== "select") return [];
    if (table === "production_order_materials") return materials;
    if (table === "warehouses") return [{ id: "wh1", code: "HQ", is_default: true }];
    if (table === "inventory_balances") return codes.map((c) => ({ warehouse_id: "wh1", item_code: c, variant_key: "", qty: 100 }));
    if (table === "inventory_movements") {
      return ids.map((id, i) => ({ source_doc_id: id, movement_type: "OUT", warehouse_id: "wh1", item_code: codes[i], variant_key: "", batch_no: null, product_name: null, qty: (i % 7) + 1, unit_cost_sen: 100, source_doc_no: "PRD-1", company_id: 1 }));
    }
    return [];
  };

  it(`issues ${N} materials in a handful of calls`, async () => {
    const { sb, calls } = fakeSb((t, op, f) => (t === "inventory_movements" && op === "select" ? [] : answer(t, op, f)), () => ({}));
    const r = await issueMaterials(sb, { orderId: "o1", poNumber: "PRD-1", companyId: 1, performedBy: null });
    expect(r).toMatchObject({ ok: true, issuedLines: N });
    expect(calls.length).toBeLessThanOrEqual(8);
    expect(calls.filter((c) => c.table === "production_order_materials" && c.op === "update")).toHaveLength(0);
  });

  it("before migration 0250, issue still stays inside the budget (one update per distinct count)", async () => {
    const { sb, calls } = fakeSb((t, op, f) => (t === "inventory_movements" && op === "select" ? [] : answer(t, op, f)),
      (name) => (name === "production_stamp_issued" ? { error: { message: "Could not find the function scm.production_stamp_issued in the schema cache" } } : {}));
    const r = await issueMaterials(sb, { orderId: "o1", poNumber: "PRD-1", companyId: 1, performedBy: null });
    expect(r.ok).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(8 + 7); // 7 distinct needs in this fixture
  });

  it(`releases ${N} materials in a handful of calls`, async () => {
    const { sb, calls } = fakeSb(answer, () => ({}));
    const r = await reverseIssues(sb, "o1", null);
    expect(r).toEqual({ ok: true });
    expect(calls.length).toBeLessThanOrEqual(10);
    const inserts = calls.filter((c) => c.table === "inventory_movements" && c.op === "insert");
    expect(inserts).toHaveLength(1);
  });

  it("a release whose bucket already nets to zero writes nothing back (safe to repeat)", async () => {
    const both: Answer = (t, op, f) => {
      const rows = answer(t, op, f) ?? [];
      if (t !== "inventory_movements") return rows;
      return [...rows, ...(rows as Array<Record<string, unknown>>).map((r) => ({ ...r, movement_type: "IN" }))];
    };
    const { sb, calls } = fakeSb(both, () => ({}));
    expect(await reverseIssues(sb, "o1", null)).toEqual({ ok: true });
    expect(calls.filter((c) => c.table === "inventory_movements" && c.op === "insert")).toHaveLength(0);
  });
});

describe(`delivery order ship: rack stock-out and line re-cost for ${N} lines`, () => {
  const items = ids.map((id, i) => ({ id, item_code: codes[i], description: `Line ${i}`, qty: 2, item_group: "GOODS", rack_id: null }));
  const lineWh = new Map(ids.map((id) => [id, "wh1"] as [string, string]));
  const answer: Answer = (table, op) => {
    if (op !== "select") return [];
    if (table === "warehouse_racks") return [{ id: "r1", rack: "A1", warehouse_id: "wh1", reserved: false }, { id: "r2", rack: "A2", warehouse_id: "wh1", reserved: false }];
    if (table === "warehouse_rack_items") {
      return codes.flatMap((c, i) => [
        { id: `p${i}a`, rack_id: "r1", item_code: c, qty: 1, stocked_in_date: "2026-01-01" },
        { id: `p${i}b`, rack_id: "r2", item_code: c, qty: 5, stocked_in_date: "2026-02-01" },
      ]);
    }
    return [];
  };

  it("takes every line off its racks in a fixed number of calls, oldest placement first", async () => {
    const { sb, calls } = fakeSb(answer, () => ({}));
    await stockOutDoLinesFromRacks(sb, "do1", "DO-1", "u1", lineWh, items, 1);
    expect(calls.length).toBeLessThanOrEqual(12);
    // Each line of 2: 1 from the older placement (emptied), 1 from the newer (5 -> 4): one delete, one update for all.
    expect(calls.filter((c) => c.table === "warehouse_rack_items" && c.op === "delete")).toHaveLength(1);
    expect(calls.filter((c) => c.table === "warehouse_rack_items" && c.op === "update")).toHaveLength(1);
    expect(calls.filter((c) => c.table === "warehouse_rack_movements" && c.op === "insert")).toHaveLength(1);
  });

  it("re-costs every line in one call", async () => {
    const { sb, calls } = fakeSb(() => [], () => ({}));
    await writeDoItemCosts(sb, "do1", ids.map((id) => ({ id, unit_cost_sen: 10, line_cost_sen: 20, line_margin_sen: 5 })));
    expect(calls).toEqual([{ table: "do_restamp_item_costs", op: "rpc" }]);
  });
});
