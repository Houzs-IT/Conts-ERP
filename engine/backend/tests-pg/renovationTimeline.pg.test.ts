import postgres, { type Sql } from "postgres";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { d1Compat } from "../src/db/d1-compat";
import renovation from "../src/routes/renovation";
import { assertDisposableTestDatabase } from "./lib/doc-no-fixture";

/* The renovation project Timeline against real Postgres on the REAL schema (every file in migrations-pg, including
   0118's project_timeline_notes): hand-written notes are added, listed and archived, and the System entries come
   from the project's own history (created, step, hold, key pass, design records, SO link, PO).
   Run: node scripts/pg-tests-on-pglite.mjs tests-pg/renovationTimeline.pg.test.ts. SKIPPED without TEST_DATABASE_URL. */

const url = process.env.TEST_DATABASE_URL ?? "";
const describePg = url ? describe : describe.skip;
let sql: Sql;
let app: Hono;
const CO = 1;
const run = Math.random().toString(36).slice(2, 8);

function makeApp(perms: string[]) {
  const outer = new Hono();
  outer.use("*", async (c, next) => {
    c.set("user" as never, { id: 1, permissions: perms, permissions_set: new Set(perms), position_id: null, page_access: {} } as never);
    c.set("companyId" as never, CO as never);
    await next();
  });
  outer.route("/api/renovation", renovation as never);
  return outer;
}
const env = () => ({ DB: d1Compat(() => sql), POD_BUCKET: { put: async () => {}, get: async () => null } });

async function call(method: string, path: string, body?: unknown, a = app) {
  const res = await a.request(`/api/renovation${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env() as never);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

describePg("renovation project timeline on the real schema", () => {
  let projectId = 0;
  let otherId = 0;
  let noteId = 0;

  beforeAll(async () => {
    assertDisposableTestDatabase(url);
    sql = postgres(url, { max: 1, prepare: false, fetch_types: false, onnotice: () => {} });
    app = makeApp(["*"]);
    const typeId = Number((await sql`select id from public.project_types where slug = 'full_renovation' and company_id = ${CO}`)[0]!.id);
    const r = await call("POST", "", { name: `Timeline ${run}`, projectTypeId: typeId, customerKind: "customer", customerName: "Ms Tan", building: "Vista", unitNo: `T-${run}` });
    expect(r.status).toBe(201);
    projectId = r.json.id;
    const o = await call("POST", "", { name: `Other ${run}`, projectTypeId: typeId, customerKind: "customer", customerName: "Mr Ong", building: "Vista", unitNo: `O-${run}` });
    otherId = o.json.id;
  });

  afterAll(async () => {
    await sql?.end();
  });

  test("a new project's timeline starts with Project created, and notes are switched on", async () => {
    const t = await call("GET", `/${projectId}/timeline`);
    expect(t.status).toBe(200);
    expect(t.json.notesReady).toBe(true);
    expect(t.json.entries.map((e: any) => e.title)).toContain("Project created");
    expect(t.json.entries.every((e: any) => e.category === "system")).toBe(true);
  });

  test("add a note: type and text are checked; it lists newest first under its type", async () => {
    expect((await call("POST", `/${projectId}/timeline/notes`, { type: "system", note: "x" })).json.error).toBe("type_invalid");
    expect((await call("POST", `/${projectId}/timeline/notes`, { type: "site", note: "  " })).json.error).toBe("note_required");
    expect((await call("POST", `/999999999/timeline/notes`, { type: "site", note: "x" })).status).toBe(404);
    const a = await call("POST", `/${projectId}/timeline/notes`, { type: "site", note: "Lift booked for Saturday" });
    expect(a.status).toBe(201);
    const b = await call("POST", `/${projectId}/timeline/notes`, { type: "customer", note: "Customer prefers WhatsApp" });
    expect(b.status).toBe(201);
    noteId = a.json.id;
    const t = await call("GET", `/${projectId}/timeline`);
    const notes = t.json.entries.filter((e: any) => e.noteId);
    expect(notes.map((e: any) => [e.category, e.body])).toEqual([["customer", "Customer prefers WhatsApp"], ["site", "Lift booked for Saturday"]]);
    expect(notes[0].title).toBeNull();
    // another project's timeline does not see them
    const other = await call("GET", `/${otherId}/timeline`);
    expect(other.json.entries.some((e: any) => e.noteId)).toBe(false);
  });

  test("System entries come from the project's own history", async () => {
    const people = await Promise.all(["Office", `Seng ${run}`].map((name) => call("POST", "/people", { name, roles: ["reno_pic"] })));
    const [from, to] = people.map((p) => p.json.id as number);
    expect((await call("POST", `/${projectId}/key-moves`, { movedOn: "2026-10-01", fromPersonId: from, toPersonId: to })).status).toBe(201);
    expect((await call("POST", `/${projectId}/step`, { step: "signed", reason: "deposit paid" })).status).toBe(200);
    expect((await call("POST", `/${projectId}/hold`, { flag: "on_hold", note: "customer travelling" })).status).toBe(200);
    expect((await call("POST", `/${projectId}/site-measures`, { doneOn: "2026-10-02", personIds: [to], note: "measured" })).status).toBe(201);
    expect((await call("POST", `/${projectId}/design-links`, { kind: "3d", url: "https://example.test/3d", submittedOn: "2026-10-03", personIds: [to] })).status).toBe(201);
    expect((await call("POST", `/${projectId}/design-notes`, { kind: "2d", notedOn: "2026-10-04", requestedByPersonId: null, requestedByText: "Ms Tan", note: "Move the TV wall" })).status).toBe(201);
    const t = await call("GET", `/${projectId}/timeline`);
    const titles = t.json.entries.filter((e: any) => e.category === "system").map((e: any) => e.title);
    expect(titles).toEqual(expect.arrayContaining([
      "Project created", `Key passed: Office to Seng ${run}`, "Step changed to Signed", "Flag set: ON HOLD",
      "Design onsite visit", "3D v1 submitted (link)", "2D amendment requested",
    ]));
    const key = t.json.entries.find((e: any) => e.title === `Key passed: Office to Seng ${run}`);
    expect(key).toMatchObject({ dateOnly: true, at: "2026-10-01T04:00:00.000Z" });
    const step = t.json.entries.find((e: any) => e.title === "Step changed to Signed");
    expect(step.body).toBe("From Design · deposit paid");
    // newest first
    const ats = t.json.entries.map((e: any) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  test("SO linked and the project's purchase orders show up", async () => {
    const so = `SO-TL-${run}`;
    await sql`insert into scm.mfg_sales_orders (doc_no, debtor_name, company_id, so_kind, status) values (${so}, 'Ms Tan', ${CO}, 'RENOVATION', 'RENO_CONFIRMED')`;
    const l = await call("POST", "/link-so", { projectId, docNo: so });
    expect(l.status).toBe(200);
    const staff = String((await sql`insert into scm.staff (id, staff_code, name, role, initials, color) values (gen_random_uuid(), ${"TL" + run}, 'Buyer', 'admin', 'BY', '#000') returning id`)[0]!.id);
    const sup = String((await sql`insert into scm.suppliers (code, name) values (${"TLS" + run}, 'Tiles Sdn Bhd') returning id`)[0]!.id);
    await sql`insert into scm.purchase_orders (po_number, supplier_id, status, created_by, company_id, project_id) values (${"PO-TL-" + run}, ${sup}, 'SUBMITTED', ${staff}, ${CO}, ${projectId})`;
    const t = await call("GET", `/${projectId}/timeline`);
    const titles = t.json.entries.map((e: any) => e.title);
    expect(titles).toContain(`Sales order ${so} linked`);
    const po = t.json.entries.find((e: any) => e.title === `Purchase order PO-TL-${run} created`);
    expect(po).toMatchObject({ category: "system", by: "Buyer" });
    expect(po.body).toContain("Tiles Sdn Bhd");
  });

  test("moving the project to Closed shows Step changed and Project completed", async () => {
    expect((await call("POST", `/${projectId}/step`, { step: "closed", reason: "handed over and paid" })).status).toBe(200);
    const t = await call("GET", `/${projectId}/timeline`);
    const titles = t.json.entries.map((e: any) => e.title);
    expect(titles).toContain("Step changed to Closed");
    expect(titles).toContain("Project completed");
  });

  test("archive hides a note; a read-only user cannot add or archive", async () => {
    const readOnly = makeApp(["projects.list"]);
    expect((await call("POST", `/${projectId}/timeline/notes`, { type: "site", note: "x" }, readOnly)).status).toBe(403);
    expect((await call("POST", `/timeline/notes/${noteId}/archive`, undefined, readOnly)).status).toBe(403);
    expect((await call("POST", `/timeline/notes/${noteId}/archive`)).json).toEqual({ ok: true });
    expect((await call("POST", `/timeline/notes/${noteId}/archive`)).json).toEqual({ ok: true, unchanged: true });
    expect((await call("POST", `/timeline/notes/999999999/archive`)).status).toBe(404);
    const t = await call("GET", `/${projectId}/timeline`);
    expect(t.json.entries.filter((e: any) => e.noteId).map((e: any) => e.body)).toEqual(["Customer prefers WhatsApp"]);
    const row = (await sql`select archived_at is not null as archived, archived_by from public.project_timeline_notes where id = ${noteId}`)[0]!;
    expect(row).toMatchObject({ archived: true });
  });
});
