import postgres, { type Sql } from "postgres";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { d1Compat } from "../src/db/d1-compat";
import renovation from "../src/routes/renovation";
import { assertDisposableTestDatabase } from "./lib/doc-no-fixture";
import { onRenovationSoLinesChanged } from "../src/scm/lib/renovation-hooks";
import { renoDbOf } from "../src/scm/lib/renovation-db";

/* Migration 0141 filed Aircon install, Cleaning and Project management under SERVICE (owner, 22 Oct 2026).
   On the real migrated schema, with the real generic SKUs: the catalog lists them under Service, and a renovation
   SO with these lines still makes the aircon site task in hardware, cleaning in handover, no task for project
   management, and keeps the hardware stage. Run on PGlite: node scripts/pg-tests-on-pglite.mjs <this file>.
   SKIPPED without TEST_DATABASE_URL. */

const url = process.env.TEST_DATABASE_URL ?? "";
const describePg = url ? describe : describe.skip;
let sql: Sql;
let app: Hono;
const CO = 1;
const run = Math.random().toString(36).slice(2, 8);

async function call(method: string, path: string) {
  const res = await app.request(`/api/renovation${path}`, { method, headers: { "content-type": "application/json" } }, { DB: d1Compat(() => sql) } as never);
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: text as any }; }
}

describePg("site-trade services filed under Service, on the real schema", () => {
  beforeAll(async () => {
    assertDisposableTestDatabase(url);
    sql = postgres(url, { max: 1, prepare: false, fetch_types: false, onnotice: () => {} });
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user" as never, { id: 1, permissions: ["*"], permissions_set: new Set(["*"]), position_id: null, page_access: {} } as never);
      c.set("companyId" as never, CO as never);
      await next();
    });
    app.route("/api/renovation", renovation as never);
  });

  afterAll(async () => {
    await sql?.end();
  });

  test("the catalog and the generic SKUs list the three under Service", async () => {
    const subs = await sql`select group_code, code from scm.product_sub_categories where code in ('AIRCON_INSTALL', 'CLEANING', 'PROJECT_MGMT') order by sort_order`;
    expect(subs.map((r) => `${r.group_code}/${r.code}`)).toEqual(["SERVICE/AIRCON_INSTALL", "SERVICE/CLEANING", "SERVICE/PROJECT_MGMT"]);
    const skus = await sql`select code, name, category::text as category, category_group, sub_category from scm.mfg_products
                            where company_id = ${CO} and code in ('RN-AIRCON_INSTALL', 'RN-CLEANING', 'RN-PROJECT_MGMT') order by code`;
    expect(skus.map((r) => [r.code, r.name, r.category, r.category_group, r.sub_category])).toEqual([
      ["RN-AIRCON_INSTALL", "Service - Aircon install", "SERVICE", "SERVICE", "AIRCON_INSTALL"],
      ["RN-CLEANING", "Service - Cleaning", "SERVICE", "SERVICE", "CLEANING"],
      ["RN-PROJECT_MGMT", "Service - Project management", "SERVICE", "SERVICE", "PROJECT_MGMT"],
    ]);
    // the Products list filter (?group=SERVICE) reads category_group
    const service = await sql`select code from scm.mfg_products where company_id = ${CO} and category_group = 'SERVICE' and code like 'RN-%' order by code`;
    expect(service.map((r) => r.code)).toEqual(expect.arrayContaining(["RN-AIRCON_INSTALL", "RN-CLEANING", "RN-PROJECT_MGMT", "RN-DELIVERY"]));
    const lighting = await sql`select code, label from scm.product_sub_categories where group_code = 'LIGHTING' order by sort_order limit 2`;
    expect(lighting.map((r) => `${r.code}/${r.label}`)).toEqual(["DOWNLIGHT/Downlight", "EYEBALL/Eye ball"]);
    const works = await sql`select code from scm.mfg_products where company_id = ${CO} and category_group = 'WORKS' and sub_category in ('AIRCON_INSTALL', 'CLEANING', 'PROJECT_MGMT')`;
    expect(works).toHaveLength(0);
  });

  test("an SO with aircon install, cleaning and project management lines makes the same site tasks as before", async () => {
    const typeId = Number((await sql`select id from public.project_types where slug = 'full_renovation' and company_id = ${CO}`)[0]!.id);
    const created = await app.request("/api/renovation", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Aircon ${run}`, projectTypeId: typeId, customerKind: "customer", customerName: "Mr Tan", building: "Vista", unitNo: "B-3" }),
    }, { DB: d1Compat(() => sql) } as never);
    expect(created.status).toBe(201);
    const projectId = Number(((await created.json()) as { id: number }).id);
    const so = `SO-SV-${run}`;
    await sql`insert into scm.mfg_sales_orders (doc_no, debtor_name, project_id, company_id, so_kind, status) values (${so}, 'Mr Tan', ${projectId}, ${CO}, 'RENOVATION', 'RENO_CONFIRMED')`;
    const sec = String((await sql`insert into scm.reno_doc_sections (so_doc_no, heading) values (${so}, 'ALL') returning id`)[0]!.id);
    for (const code of ["RN-AIRCON_INSTALL", "RN-CLEANING", "RN-PROJECT_MGMT"]) {
      const item = String((await sql`insert into scm.mfg_sales_order_items (doc_no, item_group, item_code, qty, unit_price_sen, total_sen, company_id)
        values (${so}, 'RENOVATION', ${code}, 1, 10000, 10000, ${CO}) returning id`)[0]!.id);
      await sql`insert into scm.reno_doc_lines (section_id, kind, room, qty, so_item_id) values (${sec}, 'ITEM', 'Living', 1, ${item})`;
    }
    await onRenovationSoLinesChanged(so, renoDbOf(sql));

    const d = await call("GET", `/${projectId}`);
    expect(d.status).toBe(200);
    const trades = d.json.tasks.filter((t: any) => !String(t.trade_code).startsWith("INTERNAL:"));
    expect(trades.map((t: any) => `${t.trade_code}:${t.stage_key}`).sort()).toEqual(["AIRCON_INSTALL:hardware", "CLEANING:handover"]);
    expect(trades.find((t: any) => t.trade_code === "AIRCON_INSTALL")).toMatchObject({ label: "AIR CON INSTALLATION", fulfilment_kind: "po" });
    const st = Object.fromEntries(d.json.stages.map((s: any) => [s.key, s]));
    expect(st.hardware.skipSource).not.toBe("auto"); // the aircon install still keeps the hardware stage
    expect(st.soft_furnishing).toMatchObject({ state: "skipped", skipSource: "auto" }); // no real soft-furnishing or service line
    expect(d.json.conditions.renoItem.condition).toBe("pending_purchased");
    expect(d.json.conditions.furniture.condition).toBe("none");
  });
});
