import postgres, { type Sql } from "postgres";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { d1Compat } from "../src/db/d1-compat";
import renovation from "../src/routes/renovation";
import projects from "../src/routes/projects";
import { assertDisposableTestDatabase } from "./lib/doc-no-fixture";
import { loadOpenLines, lineGroupOf, stampSiteReceipt } from "../src/scm/routes/site-receipts";
import { postGrnAndRollup } from "../src/scm/routes/grns";
import { pgTransactionSupabase } from "../src/scm/lib/pg-supabase-transaction";
import { onRenovationSoLinesChanged, projectHandoverState } from "../src/scm/lib/renovation-hooks";
import { renoDbOf } from "../src/scm/lib/renovation-db";

/* The renovation project routes against real Postgres, on the REAL schema:
   houzs_test must be built from every file in migrations-pg (phase 1 catalog,
   phase 2 sales documents 0060-0073 and phase 3 projects 0075-0082), on a
   throwaway local cluster or on PGlite (scripts/pg-tests-on-pglite.mjs);
   never staging or production. Billing amounts come from phase 2's own
   billingView, and handover state through phase 2's projectHandoverState hook.
   SKIPPED without TEST_DATABASE_URL. */

const url = process.env.TEST_DATABASE_URL ?? "";
const describePg = url ? describe : describe.skip;
let sql: Sql;
let app: Hono;
const CO = 1;
const run = Math.random().toString(36).slice(2, 8);

function makeApp(perms: string[] = ["*"]) {
  const outer = new Hono();
  outer.use("*", async (c, next) => {
    c.set("user" as never, { id: 1, permissions: perms, permissions_set: new Set(perms), position_id: null, page_access: {} } as never);
    c.set("companyId" as never, CO as never);
    await next();
  });
  outer.route("/api/renovation", renovation as never);
  outer.route("/api/projects", projects as never);
  return outer;
}

const files = new Map<string, ArrayBuffer>();
function env() {
  return {
    DB: d1Compat(() => sql),
    POD_BUCKET: {
      put: async (k: string, v: ArrayBuffer) => { files.set(k, v); },
      get: async (k: string) => (files.has(k) ? { body: files.get(k), writeHttpMetadata: () => {} } : null),
    },
  };
}

async function call(method: string, path: string, body?: unknown, base = "/api/renovation") {
  const res = await app.request(`${base}${path === "/" ? "" : path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env() as never);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

describePg("renovation project routes on the real schema", () => {
  let projectId = 0;
  let typeId = 0;
  const so = `SO-RN-${run}`;
  let staffId = "";
  let supplierId = "";
  const items: Record<string, string> = {};
  const poItems: Record<string, string> = {};

  beforeAll(async () => {
    assertDisposableTestDatabase(url);
    sql = postgres(url, { max: 1, prepare: false, fetch_types: false, onnotice: () => {} });
    app = makeApp();
    typeId = Number((await sql`select id from public.project_types where slug = 'full_renovation' and company_id = ${CO}`)[0]!.id);
  });

  afterAll(async () => {
    await sql?.end();
  });

  test("create opens a project with 11 stages, the stage checklist and template tasks", async () => {
    const r = await call("POST", "/", { name: `Skyline A-12-${run}`, projectTypeId: typeId, customerKind: "customer", customerName: "Ms Lim", building: "Skyline", unitNo: "A-12-3" });
    expect(r.status).toBe(201);
    expect(r.json.code).toMatch(/^RN-\d{4}-\d{3}$/);
    projectId = r.json.id;
    const d = await call("GET", `/${projectId}`);
    expect(d.status).toBe(200);
    expect(d.json.stages).toHaveLength(11);
    expect(d.json.checklist.length).toBe(34);
    expect(d.json.tasks.map((t: any) => t.trade_code)).toContain("INTERNAL:qc");
    expect(d.json.linesUnavailable).toBe("no_so");
    expect(d.json.gate.open).toBe(false);
    expect(d.json.gate.reasons).toEqual(["so_missing", "billing_unavailable", "shop_drawings_unsigned", "permit_pending"]);
    expect(d.json.currentStage).toBe("design");
  });

  test("validation refuses a create without a customer, and the board lists the project", async () => {
    expect((await call("POST", "/", { name: "x", projectTypeId: typeId, customerKind: "customer" })).json.error).toBe("customer_required");
    const b = await call("GET", "/");
    expect(b.status).toBe(200);
    const row = b.json.data.find((x: any) => x.id === projectId);
    expect(row).toMatchObject({ renoCondition: "design", furnitureCondition: null, unitKey: "not_collected", gateOpen: false });
  });

  test("skip rules: unskippable, reason required, actor logged; hardware gate refuses start", async () => {
    expect((await call("POST", `/${projectId}/stages/design/skip`, { reason: "no design" })).json.error).toBe("unskippable");
    expect((await call("POST", `/${projectId}/stages/defect_check/skip`, { reason: "ab" })).status).toBe(400);
    expect((await call("POST", `/${projectId}/stages/defect_check/skip`, { reason: "Developer already fixed defects" })).status).toBe(200);
    const d = await call("GET", `/${projectId}`);
    const dc = d.json.stages.find((s: any) => s.key === "defect_check");
    expect(dc).toMatchObject({ state: "skipped", skipSource: "manual", skipReason: "Developer already fixed defects", skippedBy: 1 });
    const hw = await call("POST", `/${projectId}/stages/hardware/start`);
    expect(hw.status).toBe(409);
    expect(hw.json.error).toBe("hardware_gate_closed");
    expect((await call("POST", `/${projectId}/stages/defect_check/unskip`)).status).toBe(200);
    const permit = d.json.checklist.find((c: any) => c.item_key === "renovation_permit");
    const signed = d.json.checklist.find((c: any) => c.item_key === "shop_drawings_signed");
    expect((await call("POST", `/checklist/${signed.id}/skip`, { reason: "not needed" })).json.error).toBe("unskippable");
    expect((await call("POST", `/checklist/${permit.id}/skip`, { reason: "Management needs no permit" })).status).toBe(200);
  });

  test("a renovation SO without contract lines: nothing auto-skipped, gate closed", async () => {
    await sql`insert into scm.mfg_sales_orders (doc_no, debtor_name, project_id, company_id, so_kind, status) values (${so}, 'Ms Lim', ${projectId}, ${CO}, 'RENOVATION', 'RENO_CONFIRMED')`;
    const d = await call("GET", `/${projectId}`);
    expect(d.status).toBe(200);
    expect(d.json.linesUnavailable).toBeNull();
    expect(d.json.stages.find((s: any) => s.key === "furniture").state).toBe("skipped");
    expect(d.json.billing).toMatchObject({ available: true, contractSen: 0, instalments: [] });
    expect(d.json.gate.open).toBe(false);
  });

  test("with phase 2's real tables: auto-skip, derived conditions, trade tasks, gate opens when paid and signed", async () => {

    staffId = String((await sql`insert into scm.staff (id, staff_code, name, role, initials, color) values (gen_random_uuid(), ${"T" + run}, 'Test', 'admin', 'TT', '#000') returning id`)[0]!.id);
    supplierId = String((await sql`insert into scm.suppliers (code, name) values (${"SUP" + run}, 'Wiring Sdn Bhd') returning id`)[0]!.id);
    for (const [code, cat, group, sub] of [
      [`RN-ELECTRICAL-${run}`, "WORKS", "WORKS", "ELECTRICAL"],
      [`RN-PAINT-${run}`, "WORKS", "WORKS", "PAINTING"],
      [`SOFA-${run}`, "SOFA", "FURNITURE", "SOFA"],
    ] as const) {
      await sql`insert into scm.mfg_products (id, code, name, category, category_group, sub_category, company_id) values (${code}, ${code}, ${code}, ${cat}::scm.mfg_product_category, ${group}, ${sub}, ${CO})`;
    }
    const sec = String((await sql`insert into scm.reno_doc_sections (so_doc_no, heading) values (${so}, 'ALL') returning id`)[0]!.id);
    // contract RM 5,000: wiring 1,000 + painting 500 + sofa 3,500
    for (const [k, code, room, sen] of [["elec", `RN-ELECTRICAL-${run}`, "Living", 100000], ["paint", `RN-PAINT-${run}`, "Living", 50000], ["sofa", `SOFA-${run}`, "Living", 350000]] as const) {
      items[k] = String((await sql`insert into scm.mfg_sales_order_items (doc_no, item_group, item_code, qty, unit_price_sen, total_sen, company_id) values (${so}, 'RENOVATION', ${code}, 1, ${sen}, ${sen}, ${CO}) returning id`)[0]!.id);
      await sql`insert into scm.reno_doc_lines (section_id, kind, room, qty, so_item_id) values (${sec}, 'ITEM', ${room}, 1, ${items[k]})`;
    }
    const po = String((await sql`insert into scm.purchase_orders (po_number, supplier_id, created_by, company_id) values (${"PO-" + run}, ${supplierId}, ${staffId}, ${CO}) returning id`)[0]!.id);
    poItems.elec = String((await sql`insert into scm.purchase_order_items (purchase_order_id, material_kind, item_code, material_name, qty, unit_price_sen, line_total_sen, so_item_id, company_id)
      values (${po}, 'mfg_product', ${`RN-ELECTRICAL-${run}`}, 'Wiring', 1, 100000, 100000, ${items.elec!}, ${CO}) returning id`)[0]!.id);

    const d = await call("GET", `/${projectId}`);
    expect(d.json.linesUnavailable).toBeNull();
    const st = Object.fromEntries(d.json.stages.map((s: any) => [s.key, s]));
    expect(st.appliances).toMatchObject({ state: "skipped", skipSource: "auto" });
    expect(st.furniture.state).toBe("not_started");
    expect(d.json.conditions.furniture.condition).toBe("pending_purchased");
    expect(d.json.conditions.renoItem.condition).toBe("pending_purchased"); // painting has no PO yet
    expect(d.json.billing.available).toBe(true);

    // phase 2's lines-changed hook (fired after a convert or a VO) syncs the trade tasks and the cached stage
    await sql`update public.projects set reno_stage = 'closed', stage = 'completed' where id = ${projectId}`;
    await onRenovationSoLinesChanged(so, renoDbOf(sql));
    const cached = await sql`select reno_stage, stage from public.projects where id = ${projectId}`;
    expect(cached[0]).toMatchObject({ reno_stage: "design", stage: "draft" });
    const hooked = await call("GET", `/${projectId}`);
    expect(hooked.json.tasks.filter((t: any) => !String(t.trade_code).startsWith("INTERNAL:")).length).toBe(3); // electrical first + second, painting
    const again = await call("POST", `/${projectId}/trade-tasks/sync`);
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(0);
    const d2 = await call("GET", `/${projectId}`);
    const wiring = d2.json.tasks.find((t: any) => t.trade_code === "ELECTRICAL" && t.fix_phase === "first");
    expect(wiring).toMatchObject({ label: "WIRING & HACKING", supplier_id: supplierId, fulfilment_kind: "po" });

    // planned dates + calendar
    expect((await call("PATCH", `/trade-tasks/${wiring.id}`, { plannedStart: "2026-10-20", plannedEnd: "2026-10-18" })).json.error).toBe("end_before_start");
    expect((await call("PATCH", `/trade-tasks/${wiring.id}`, { plannedStart: "2026-10-20", plannedEnd: "2026-10-22" })).status).toBe(200);
    const cal = await call("GET", `/calendar?from=2026-10-01&to=2026-10-31&supplierId=${supplierId}`);
    expect(cal.status).toBe(200);
    expect(cal.json.data.map((t: any) => t.id)).toContain(wiring.id);
    expect((await call("POST", `/trade-tasks/${wiring.id}/complete`)).json.error).toBe("po_task_completes_on_receipt");

    // pay instalment 1 + sign drawings + confirm SO -> gate opens
    const inst = String((await sql`insert into scm.reno_doc_instalments (so_doc_no, seq, label, pct_bp, stage_code, trigger) values (${so}, 1, 'Deposit', 1500, 'design', 'so_confirmed') returning id`)[0]!.id);
    await sql`insert into scm.reno_doc_instalments (so_doc_no, seq, label, pct_bp, stage_code, trigger) values (${so}, 2, 'Works start', 5000, 'hardware', 'stage_start')`;
    await sql`insert into scm.reno_doc_instalments (so_doc_no, seq, label, pct_bp, stage_code, trigger) values (${so}, 3, 'Handover', 3500, 'handover', 'stage_done')`;
    // phase 2's amounts before anything is billed: 15%, 50% and 35% of RM 5,000
    const pre = await call("GET", `/${projectId}`);
    expect(pre.json.billing.contractSen).toBe(500000);
    expect(pre.json.billing.instalments.map((i: any) => [i.seq, i.dueSen, i.billed])).toEqual([[1, 75000, false], [2, 250000, false], [3, 175000, false]]);
    const inv = String((await sql`insert into scm.sales_invoices (invoice_number, so_doc_no, debtor_name, total_sen, paid_sen, created_by, company_id) values (${"SI-" + run}, ${so}, 'Ms Lim', 75000, 75000, ${staffId}, ${CO}) returning id`)[0]!.id);
    await sql`insert into scm.reno_instalment_bills (so_doc_no, instalment_id, seq, kind, amount_sen, cum_bp, revised_contract_sen, billed_before_sen, invoice_date, sales_invoice_id, invoice_number)
      values (${so}, ${inst}, 1, 'INVOICE', 75000, 1500, 500000, 0, '2026-10-09', ${inv}, ${"SI-" + run})`;
    const signed = d2.json.checklist.find((c: any) => c.item_key === "shop_drawings_signed");
    await sql`update public.project_checklist set status = 'done' where id = ${signed.id}`;
    const d3 = await call("GET", `/${projectId}`);
    expect(d3.json.gate).toMatchObject({ open: true, reasons: [] });
    expect(d3.json.payment).toMatchObject({ condition: "partly_paid", receivedCount: 1, count: 3, billedSen: 75000, receivedSen: 75000, contractSen: 500000 });
    expect((await call("POST", `/${projectId}/stages/hardware/start`)).status).toBe(200);
    const d4 = await call("GET", `/${projectId}`);
    expect(d4.json.prompts.map((p: any) => [p.seq, p.actionable])).toEqual([[2, true]]);
    expect((await call("POST", `/trade-tasks/${wiring.id}/start`)).status).toBe(200);
  });

  test("site receipt: open lines read, and posting books no stock but rolls the PO and ticks the task", async () => {
    const open = await loadOpenLines(d1Compat(() => sql) as never, projectId);
    const elec = open.find((l) => l.po_item_id === poItems.elec);
    expect(elec).toMatchObject({ remaining: 1, category_group: "WORKS", room: null });
    expect(lineGroupOf(elec!)).toBe("WORKS");

    // Inserted the way the shared PO->GRN core inserts it: no status, so the column default applies.
    const grnId = String((await sql`insert into scm.grns (grn_number, purchase_order_id, supplier_id, created_by, company_id)
      values (${"GRN-" + run}, (select purchase_order_id from scm.purchase_order_items where id = ${poItems.elec!}), ${supplierId}, ${staffId}, ${CO}) returning id`)[0]!.id);
    await sql`insert into scm.grn_items (grn_id, purchase_order_item_id, material_kind, item_code, material_name, qty_received, qty_accepted, unit_price_sen, line_total_sen, company_id)
      values (${grnId}, ${poItems.elec!}, 'mfg_product', ${`RN-ELECTRICAL-${run}`}, 'Wiring', 1, 1, 100000, 100000, ${CO})`;
    await stampSiteReceipt(d1Compat(() => sql) as never, {
      grnId, companyId: CO, projectId, supervisorStaffId: staffId, lat: null, lng: null, accuracyM: null,
      photos: [{ grn_item_id: null, location: "Living", kind: "after", r2_key: `renovation/${projectId}/after.png`, caption: null, taken_at: null }],
      supervisorSignatureR2Key: `renovation/${projectId}/sig.png`, customerSignerName: null, customerSignatureR2Key: null, notes: null,
    });
    const stamped = await sql`select received_at_site, project_id::int as project_id from scm.grns where id = ${grnId}`;
    expect(stamped[0]).toMatchObject({ received_at_site: true, project_id: projectId });
    await expect(stampSiteReceipt(d1Compat(() => sql) as never, {
      grnId: "00000000-0000-4000-8000-00000000dead", companyId: CO, projectId, supervisorStaffId: staffId, lat: null, lng: null, accuracyM: null,
      photos: [], supervisorSignatureR2Key: `renovation/${projectId}/sig.png`, customerSignerName: null, customerSignatureR2Key: null, notes: null,
    })).rejects.toThrow(/matched 0/);
    await sql`insert into scm.warehouses (code, name, type, company_id, is_default) values (${"WH" + run}, 'Main', 'warehouse', ${CO}, true)`;

    const res = await sql.begin((tx) => postGrnAndRollup(pgTransactionSupabase(tx as never) as never, grnId, staffId, CO));
    expect(res.ok).toBe(true);
    const moves = await sql`select count(*)::int as n from scm.inventory_movements where source_doc_id = ${grnId}`;
    expect(moves[0]!.n).toBe(0);
    const poi = await sql`select received_qty from scm.purchase_order_items where id = ${poItems.elec!}`;
    expect(Number(poi[0]!.received_qty)).toBe(1);
    const g = await sql`select status::text as status from scm.grns where id = ${grnId}`;
    expect(g[0]!.status).toBe("POSTED");

    const d = await call("GET", `/${projectId}`);
    const wiring = d.json.tasks.find((t: any) => t.trade_code === "ELECTRICAL" && t.fix_phase === "first");
    expect(wiring.poFullyReceived).toBe(true);
    expect(wiring.status).toBe("done");
    const pod = await call("GET", `/${projectId}/pod`);
    expect(pod.status).toBe(200);
    expect(pod.json.receipts.map((r: any) => r.id)).toContain(grnId);
  });

  test("control: an ordinary warehouse receipt of the same kind still books stock", async () => {
    const wh = await sql`select id from scm.warehouses where company_id = ${CO} limit 1`;
    expect(wh.length).toBe(1);
    const po = String((await sql`insert into scm.purchase_orders (po_number, supplier_id, created_by, company_id) values (${"PO2-" + run}, ${supplierId}, ${staffId}, ${CO}) returning id`)[0]!.id);
    const poi = String((await sql`insert into scm.purchase_order_items (purchase_order_id, material_kind, item_code, material_name, qty, unit_price_sen, line_total_sen, so_item_id, company_id, warehouse_id)
      values (${po}, 'mfg_product', ${`SOFA-${run}`}, 'Sofa', 1, 50000, 50000, ${items.sofa!}, ${CO}, ${wh[0]!.id}) returning id`)[0]!.id);
    const grnId = String((await sql`insert into scm.grns (grn_number, purchase_order_id, supplier_id, status, created_by, company_id, warehouse_id)
      values (${"GRN2-" + run}, ${po}, ${supplierId}, 'DRAFT', ${staffId}, ${CO}, ${wh[0]!.id}) returning id`)[0]!.id);
    await sql`insert into scm.grn_items (grn_id, purchase_order_item_id, material_kind, item_code, material_name, qty_received, qty_accepted, unit_price_sen, line_total_sen, company_id)
      values (${grnId}, ${poi}, 'mfg_product', ${`SOFA-${run}`}, 'Sofa', 1, 1, 50000, 50000, ${CO})`;
    const res = await sql.begin((tx) => postGrnAndRollup(pgTransactionSupabase(tx as never) as never, grnId, staffId, CO));
    expect(res).toMatchObject({ ok: true });
    const moves = await sql`select count(*)::int as n from scm.inventory_movements where source_doc_id = ${grnId} and movement_type = 'IN'`;
    expect(moves[0]!.n).toBe(1);
  });

  test("handover is refused while a snag is open, then signed", async () => {
    const snag = await call("POST", `/${projectId}/snags`, { location: "Kitchen", description: "Chipped cabinet door" });
    expect(snag.status).toBe(201);
    const up = await app.request(`/api/renovation/${projectId}/files?kind=signature`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) }, env() as never);
    const key = (await up.json() as { key: string }).key;
    expect(key.startsWith(`renovation/${projectId}/signature-`)).toBe(true);
    expect(await projectHandoverState(renoDbOf(sql), projectId)).toBe("not_handed_over");
    expect(await projectHandoverState(renoDbOf(sql), null)).toBe("unknown");
    const refused = await call("POST", `/${projectId}/handover`, { customerSignerName: "Ms Lim", customerSignatureR2Key: key });
    expect(refused.json.error).toBe("snags_open");
    expect((await call("POST", `/snags/${snag.json.id}/close`)).status).toBe(200);
    expect((await call("POST", `/${projectId}/handover`, { customerSignerName: "Ms Lim", customerSignatureR2Key: "elsewhere/x.png" })).json.error).toBe("signature_required");
    const ok = await call("POST", `/${projectId}/handover`, { customerSignerName: "Ms Lim", customerSignatureR2Key: key, keysReturned: 2 });
    expect(ok.status).toBe(201);
    const d = await call("GET", `/${projectId}`);
    expect(d.json.handover.customer_signer_name).toBe("Ms Lim");
    expect(d.json.unitKey).toBe("returned");
    expect(d.json.checklist.find((c: any) => c.item_key === "handover_signed").status).toBe("done");
    // phase 2's PO payment schedule reads this through its hook: retention becomes payable
    expect(await projectHandoverState(renoDbOf(sql), projectId)).toBe("handed_over");
  });

  test("a user without projects.write cannot change anything", async () => {
    const ro = makeApp([]);
    const res = await ro.request(`/api/renovation/${projectId}/stages/key_permit/skip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "xxxx" }) }, env() as never);
    expect(res.status).toBe(403);
  });

  test("Project Maintenance: a section added by hand carries a stage and is copied into new projects", async () => {
    const tpl = Number((await sql`select checklist_template_id from public.project_types where id = ${typeId}`)[0]!.checklist_template_id);
    const P = (m: string, path: string, body?: unknown) => call(m, path, body, "/api/projects");
    expect((await P("POST", `/checklist-templates/${tpl}/sections`, { name: "Bad stage", stage_key: "painting" })).status).toBe(400);
    // same stage as a seeded section, so the copy must keep the two sections' items apart
    const sec = await P("POST", `/checklist-templates/${tpl}/sections`, { name: `Site safety ${run}`, stage_key: "hardware" });
    expect(sec.status).toBe(201);
    expect(sec.json.stage_key).toBe("hardware");
    const loose = await P("POST", `/checklist-templates/${tpl}/sections`, { name: `No stage ${run}` });
    expect(loose.status).toBe(201);
    expect((await P("POST", `/checklist-templates/${tpl}/items`, { title: `Safety briefing ${run}`, section_id: sec.json.id })).status).toBe(201);
    let got = await P("GET", `/checklist-templates/${tpl}/items`);
    expect(got.json.sections.find((x: any) => x.id === sec.json.id).stage_key).toBe("hardware");
    expect((await P("PATCH", `/checklist-templates/sections/${loose.json.id}`, { stage_key: "nope" })).status).toBe(400);
    expect((await P("PATCH", `/checklist-templates/sections/${loose.json.id}`, { stage_key: "furniture" })).status).toBe(200);
    got = await P("GET", `/checklist-templates/${tpl}/items`);
    expect(got.json.sections.find((x: any) => x.id === loose.json.id).stage_key).toBe("furniture");
    expect((await P("PATCH", `/checklist-templates/sections/${loose.json.id}`, { stage_key: null })).status).toBe(200);

    const r = await call("POST", "/", { name: `Stage copy ${run}`, projectTypeId: typeId, customerKind: "customer", customerName: "Mr Tan" });
    expect(r.status).toBe(201);
    const d = await call("GET", `/${r.json.id}`);
    expect(d.json.checklist.length).toBe(35); // 34 seeded + the hand-added one, nothing doubled
    const briefing = d.json.checklist.filter((c: any) => c.title === `Safety briefing ${run}`);
    expect(briefing).toHaveLength(1);
    expect(briefing[0].stage_key).toBe("hardware");
    const secs = await sql`select name, stage_key from public.project_checklist_sections where project_id = ${r.json.id} order by sort_order`;
    expect(secs.some((x) => x.name === `Site safety ${run}` && x.stage_key === "hardware")).toBe(true);
    expect(secs.some((x) => x.name === `No stage ${run}`)).toBe(false);
  });
});
