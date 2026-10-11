import postgres, { type Sql } from "postgres";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { d1Compat } from "../src/db/d1-compat";
import renovation from "../src/routes/renovation";
import { assertDisposableTestDatabase } from "./lib/doc-no-fixture";

/* GET /api/renovation/monitor against real Postgres on the real schema (every file in
   migrations-pg), on a throwaway local cluster or PGlite (scripts/pg-tests-on-pglite.mjs);
   never staging or production. SKIPPED without TEST_DATABASE_URL. */

const url = process.env.TEST_DATABASE_URL ?? "";
const describePg = url ? describe : describe.skip;
let sql: Sql;
const CO = 1;
const run = Math.random().toString(36).slice(2, 8);
let queries = 0;

function makeApp(perms: string[] = ["*"]) {
  const outer = new Hono();
  outer.use("*", async (c, next) => {
    c.set("user" as never, { id: 1, permissions: perms, permissions_set: new Set(perms), position_id: null, page_access: {} } as never);
    c.set("companyId" as never, CO as never);
    await next();
  });
  outer.route("/api/renovation", renovation as never);
  return outer;
}

function env() {
  const base = d1Compat(() => sql) as unknown as { prepare(s: string): unknown; batch?: (x: unknown[]) => Promise<unknown[]> };
  return {
    DB: { prepare: (s: string) => { queries++; return base.prepare(s); }, batch: base.batch?.bind(base) },
    POD_BUCKET: { put: async () => {}, get: async () => null },
  };
}

const app = makeApp();
async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api/renovation${path === "/" ? "" : path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env() as never);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

describePg("Project Monitor on the real schema", () => {
  let typeId = 0;
  let p1 = 0;
  let p2 = 0;
  let sales = 0;
  let designer = 0;
  let crew = 0;
  const so = `SO-MON-${run}`;

  beforeAll(async () => {
    assertDisposableTestDatabase(url);
    sql = postgres(url, { max: 1, prepare: false, fetch_types: false, onnotice: () => {} });
    typeId = Number((await sql`select id from public.project_types where slug = 'full_renovation' and company_id = ${CO}`)[0]!.id);
    sales = (await call("POST", "/people", { name: `Sales ${run}`, roles: ["sales"] })).json.id;
    designer = (await call("POST", "/people", { name: `Designer ${run}`, roles: ["designer"] })).json.id;
    crew = (await call("POST", "/people", { name: `Crew ${run}`, roles: ["site_crew"] })).json.id;

    const c1 = await call("POST", "/", { name: `BARON ${run}`, projectTypeId: typeId, customerKind: "customer", customerName: "Mr Albert", building: "BARON", unitNo: "C-20-08", salesPersonId: sales, designerPersonId: designer });
    if (!c1.json?.id) throw new Error(JSON.stringify(c1) + " people " + JSON.stringify([sales, designer, crew, typeId]));
    p1 = c1.json.id;
    p2 = (await call("POST", "/", { name: `MYARA ${run}`, projectTypeId: typeId, customerKind: "customer", customerName: "Ms Chong", building: "MYARA PARK", unitNo: "R-09-08" })).json.id;
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(0);
    expect((await call("POST", `/${p1}/site-measures`, { doneOn: "2026-10-01", personId: designer })).status).toBe(201);
    expect((await call("POST", `/${p1}/hold`, { flag: "in_defect", note: "leak" })).status).toBe(200);
    expect((await call("POST", `/${p1}/tasks`, { categoryCode: "PAINTING", fulfilment: "internal", assigneeIds: [crew], plannedStart: "2026-01-05", plannedEnd: "2026-01-09" })).status).toBe(201);

    await sql`insert into scm.mfg_sales_orders (doc_no, debtor_name, project_id, company_id, so_kind, status) values (${so}, 'Ms Chong', ${p2}, ${CO}, 'RENOVATION', 'RENO_CONFIRMED')`;
    await sql`insert into scm.reno_variation_orders (vo_no, so_doc_no, seq, status) values (${`VO-${so}-01`}, ${so}, 1, 'SENT')`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  test("every project lands in its queues, computed in a bounded number of queries", async () => {
    queries = 0;
    const r = await call("GET", "/monitor");
    expect(r.status).toBe(200);
    expect(queries).toBeLessThan(40);
    const row1 = r.json.rows.find((x: any) => x.id === p1);
    const row2 = r.json.rows.find((x: any) => x.id === p2);
    expect(row1.queues).toEqual(expect.arrayContaining(["sales_no_so", "design_in_design", "design_files_missing", "reno_overdue", "boss_in_defect", "boss_overdue"]));
    expect(row1.queues).not.toContain("design_no_measure");
    expect(row1.flags).toEqual(expect.arrayContaining(["in_defect", "task_overdue"]));
    expect(row1.crewIds).toEqual([crew]);
    expect(row1).toMatchObject({ siteMeasured: true, has2d: false, overdueTasks: 1, statusText: "IN DEFECT · Design" });
    expect(row2.step.key).toBe("signed");
    expect(row2.queues).toEqual(expect.arrayContaining(["reno_to_arrange", "sales_vo_open", "design_no_measure", "sales_ongoing"]));
    expect(row2.queues).not.toContain("sales_no_so");
    expect(row2.openVo).toMatchObject({ voNo: `VO-${so}-01`, count: 1 });
    const q = (k: string) => r.json.queues.find((x: any) => x.key === k);
    expect(q("boss_in_defect").ids).toContain(p1);
    expect(q("reno_to_arrange").ids).toContain(p2);
    expect(r.json.stepCounts.signed).toBeGreaterThanOrEqual(1);
    expect(r.json.flags.find((x: any) => x.key === "in_defect").ids).toContain(p1);
  });

  test("a person narrows to their projects: crew, sales person; bad id refused", async () => {
    const byCrew = await call("GET", `/monitor?personId=${crew}`);
    expect(byCrew.json.rows.map((x: any) => x.id)).toEqual([p1]);
    expect(byCrew.json.queues.find((x: any) => x.key === "sales_ongoing").count).toBe(1);
    const bySales = await call("GET", `/monitor?personId=${sales}`);
    expect(bySales.json.rows.map((x: any) => x.id)).toEqual([p1]);
    expect((await call("GET", "/monitor?personId=abc")).status).toBe(400);
  });

  test("the /monitor path is not swallowed by /:id", async () => {
    const r = await call("GET", "/monitor");
    expect(Array.isArray(r.json.rows)).toBe(true);
  });
});
