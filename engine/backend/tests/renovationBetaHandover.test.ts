import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import handover from "../src/routes/renovationBetaHandover";
import renovationBeta from "../src/routes/renovationBeta";
import {
  checkProgress, cleanItemMark, cleanTemplate, finishRefusal, itemFailRefusal, itemMarkRefusal, templateItemsJson,
} from "../src/services/renovation/handoverChecks";

describe("handover checklist routes", () => {
  const routes = handover.routes.filter((r) => r.method !== "ALL");

  test("the router has the template, check and queue routes", () => {
    expect([...new Set(routes.map((r) => `${r.method} ${r.path}`))].sort()).toEqual([
      "GET /defect-queue",
      "GET /handover-templates",
      "GET /projects/:id/handover-checks",
      "POST /handover-check-items/:itemId",
      "POST /handover-checks/:id/finish",
      "POST /handover-checks/:id/remove",
      "POST /handover-checks/:id/reopen",
      "POST /handover-templates",
      "POST /projects/:id/handover-checks",
      "PUT /handover-templates/:id",
    ]);
  });

  test("every route needs a session (no session: 401)", async () => {
    const app = new Hono();
    app.route("/api/beta", handover);
    for (const r of routes) {
      const path = `/api/beta${r.path.replace(":id", "1").replace(":itemId", "1")}`;
      const res = await app.request(path, { method: r.method, headers: { "content-type": "application/json" }, body: r.method === "GET" ? undefined : "{}" }, {});
      expect(res.status, `${r.method} ${path}`).toBe(401);
    }
  });
});

/** A database that answers by the first SQL fragment it recognises; every statement run is recorded. */
function fakeDb(answer: (sql: string, args: unknown[]) => unknown) {
  const ran: Array<{ sql: string; args: unknown[] }> = [];
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => { ran.push({ sql, args }); return (answer(sql, args) as unknown) ?? null; },
    all: async () => { ran.push({ sql, args }); return { results: (answer(sql, args) as unknown[]) ?? [] }; },
    run: async () => { ran.push({ sql, args }); answer(sql, args); return {}; },
    sql,
  });
  return {
    ran,
    db: { prepare: (sql: string) => stmt(sql), batch: async (s: Array<{ run: () => Promise<unknown> }>) => Promise.all(s.map((x) => x.run())) },
  };
}

function appWith(db: unknown, permissions: string[] = ["projects.write", "projects.manage"], router: Hono<never> = handover as never) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: 5, permissions, page_access: { "projects.list": "full" } } as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/beta", router);
  const env = { DB: db };
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/api/beta${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return send;
}

describe("handover checklist routes against a pretend database", () => {
  test("a missing 0296 table: reads answer ready false, writes refuse not_ready", async () => {
    const missing = () => { throw Object.assign(new Error('relation "handover_checklist_templates" does not exist'), { code: "42P01" }); };
    const { db } = fakeDb(missing);
    const send = appWith(db);
    expect(await (await send("GET", "/handover-templates")).json()).toEqual({ ready: false });
    const res = await send("POST", "/handover-templates", { name: "A", items: [{ item: "Door" }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_ready" });
  });

  test("templates are written only with projects.manage", async () => {
    const { db } = fakeDb(() => ({ id: 1 }));
    const res = await appWith(db, ["projects.write"])("POST", "/handover-templates", { name: "A", items: [{ item: "Door" }] });
    expect(res.status).toBe(403);
  });

  test("a new template is written with its items in order, for the active company", async () => {
    const { db, ran } = fakeDb((sql) => (sql.includes("INSERT INTO handover_checklist_templates") ? { id: 9 } : null));
    const res = await appWith(db)("POST", "/handover-templates", { name: " Condo  handover ", items: [{ area: "Kitchen", item: "Sink" }, { item: "" }, { item: "Door" }] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 9 });
    const ins = ran.find((r) => r.sql.includes("INSERT INTO handover_checklist_templates"))!;
    expect(ins.args.slice(0, 3)).toEqual([1, "Condo handover", true]);
    expect(JSON.parse(String(ins.args[5]))).toEqual([{ area: "Kitchen", item: "Sink", criteria: null }, { area: null, item: "Door", criteria: null }]);
  });

  test("a second template of the same name is refused in words", async () => {
    const { db } = fakeDb(() => { throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }); });
    const res = await appWith(db)("POST", "/handover-templates", { name: "A", items: [{ item: "Door" }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "name_taken" });
  });

  test("a project with an open check cannot start another", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("FROM projects WHERE id = ?")) return { company_id: 1 };
      if (sql.includes("completed_at IS NULL") && sql.startsWith("SELECT id FROM project_handover_checks")) return { id: 3 };
      return null;
    });
    const res = await appWith(db)("POST", "/projects/7/handover-checks", { templateId: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "check_open" });
  });

  test("two starts at once: the one-open-check index's clash answers check_open", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("FROM projects WHERE id = ?")) return { company_id: 1 };
      if (sql.includes("INSERT INTO project_handover_checks")) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      return null;
    });
    const res = await appWith(db)("POST", "/projects/7/handover-checks", { templateId: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "check_open" });
  });

  test("a reopen that clashes with another open check answers check_open", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("FROM project_handover_checks k JOIN projects p")) return { id: 4, project_id: 7, company_id: 1, completed_at: "2026-11-09T00:00:00Z", template_name: "T" };
      if (sql.startsWith("UPDATE project_handover_checks SET completed_at = NULL")) throw Object.assign(new Error("duplicate key value"), { code: "23505" });
      return null;
    });
    const res = await appWith(db)("POST", "/handover-checks/4/reopen");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "check_open" });
  });

  test("Finish refuses while items are unmarked; the check stays open", async () => {
    const { db, ran } = fakeDb((sql) => {
      if (sql.includes("FROM project_handover_checks k JOIN projects p")) return { id: 4, project_id: 7, company_id: 1, completed_at: null, template_name: "T" };
      if (sql.startsWith("SELECT result FROM project_handover_check_items")) return [{ result: "pass" }, { result: null }, { result: "fail" }];
      return null;
    });
    const res = await appWith(db)("POST", "/handover-checks/4/finish");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "items_unchecked", progress: { total: 3, checked: 2, open: 1, failed: 1 } });
    expect(ran.some((r) => r.sql.includes("UPDATE project_handover_checks"))).toBe(false);
  });

  test("an item that failed with a defect cannot be re-marked from the check", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("SELECT i.check_id")) return { check_id: 4, result: "fail", defect_id: 11 };
      if (sql.includes("FROM project_handover_checks k JOIN projects p")) return { id: 4, project_id: 7, company_id: 1, completed_at: null, template_name: "T" };
      return null;
    });
    const res = await appWith(db)("POST", "/handover-check-items/8", { result: "pass" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "defect_raised" });
  });

  test("the queue lists open defects and open checks, and still answers before 0296", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("FROM project_defects d")) return [{ id: 1, project_id: 7, project_code: "RN-1", project_name: "A", location: "Kitchen", item_description: "Gap", due_date: "2026-11-01", redo_count: 0 }];
      if (sql.includes("FROM project_handover_checks k")) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      return null;
    });
    const res = await appWith(db)("GET", "/defect-queue");
    expect(res.status).toBe(200);
    const j = await res.json() as { checksReady: boolean; defects: Array<Record<string, unknown>>; checks: unknown[] };
    expect(j.checksReady).toBe(false);
    expect(j.checks).toEqual([]);
    expect(j.defects[0]).toMatchObject({ id: 1, projectId: 7, projectCode: "RN-1", location: "Kitchen", description: "Gap", dueDate: "2026-11-01" });
  });
});

describe("a Fail is a defect report from the check (POST /projects/:id/defects with checkItemId)", () => {
  const report = { location: "Kitchen", description: "Sink: leaks", photoKey: "renovation/7/defect-a.jpg", checkItemId: 8 };
  const answers = (item: Record<string, unknown> | null) => (sql: string) => {
    if (sql.includes("FROM projects WHERE id = ?")) return { company_id: 1 };
    if (sql.includes("INSERT INTO project_defects")) return { id: 21 };
    if (sql.includes("FROM project_handover_check_items i JOIN project_handover_checks k")) return item;
    return null;
  };

  test("the defect and the item's Fail are written in one statement", async () => {
    const { db, ran } = fakeDb(answers({ defect_id: null, completed_at: null }));
    const res = await appWith(db, ["projects.write"], renovationBeta as never)("POST", "/projects/7/defects", report);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 21 });
    const ins = ran.find((r) => r.sql.includes("INSERT INTO project_defects"))!;
    expect(ins.sql).toContain("UPDATE project_handover_check_items i SET result = 'fail', defect_id = d.id");
    // The item is locked first and the defect is inserted FROM that lock, so a lost race writes nothing.
    expect(ins.sql).toMatch(/lk AS \([\s\S]*k\.completed_at IS NULL AND i\.defect_id IS NULL[\s\S]*FOR UPDATE OF i\)/);
    expect(ins.sql).toMatch(/INSERT INTO project_defects[\s\S]*FROM lk\s+RETURNING/);
    expect(ins.args.slice(0, 2)).toEqual([8, 7]);
    expect(ins.args.slice(-1)).toEqual([5]);
  });

  test("a report that lost the race for its item (the lock found no row) answers 409 and writes nothing", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("FROM projects WHERE id = ?")) return { company_id: 1 };
      if (sql.includes("INSERT INTO project_defects")) return null; // the lock matched nothing, so no defect id comes back
      if (sql.includes("FROM project_handover_check_items i JOIN project_handover_checks k")) return { defect_id: null, completed_at: null };
      return null;
    });
    const res = await appWith(db, ["projects.write"], renovationBeta as never)("POST", "/projects/7/defects", report);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "check_changed" });
  });

  test("an item that already has a defect, or of another project, is refused before anything is written", async () => {
    const one = fakeDb(answers({ defect_id: 3, completed_at: null }));
    const res = await appWith(one.db, ["projects.write"], renovationBeta as never)("POST", "/projects/7/defects", report);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "defect_raised" });
    expect(one.ran.some((r) => r.sql.includes("INSERT INTO project_defects"))).toBe(false);
    const other = fakeDb(answers(null));
    expect((await appWith(other.db, ["projects.write"], renovationBeta as never)("POST", "/projects/7/defects", report)).status).toBe(404);
  });

  test("a report without checkItemId stays as it was", async () => {
    const { db, ran } = fakeDb(answers(null));
    const res = await appWith(db, ["projects.write"], renovationBeta as never)("POST", "/projects/7/defects", { ...report, checkItemId: undefined });
    expect(res.status).toBe(201);
    expect(ran.find((r) => r.sql.includes("INSERT INTO project_defects"))!.sql).not.toContain("project_handover_check_items");
  });
});

describe("cleanTemplate", () => {
  test("folds spaces, drops empty rows and keeps the order", () => {
    expect(cleanTemplate({ name: "  Condo ", items: [{ area: " Kitchen ", item: " Sink  tap ", criteria: "" }, {}, { item: "Door" }] })).toEqual({
      ok: true,
      value: { name: "Condo", active: true, items: [{ area: "Kitchen", item: "Sink tap", criteria: null }, { area: null, item: "Door", criteria: null }] },
    });
    expect(cleanTemplate({ name: "A", active: false, items: [{ item: "x" }] })).toMatchObject({ ok: true, value: { active: false } });
  });

  test("refuses no name, no items, a row with an area but nothing to check, and long text", () => {
    expect(cleanTemplate({ name: " ", items: [{ item: "x" }] })).toMatchObject({ ok: false, error: "name_required" });
    expect(cleanTemplate({ name: "A", items: [] })).toMatchObject({ ok: false, error: "items_required" });
    expect(cleanTemplate({ name: "A" })).toMatchObject({ ok: false, error: "items_required" });
    expect(cleanTemplate({ name: "A", items: [{ area: "Kitchen" }] })).toMatchObject({ ok: false, error: "item_required" });
    expect(cleanTemplate({ name: "x".repeat(121), items: [{ item: "x" }] })).toMatchObject({ ok: false, error: "name_too_long" });
    expect(cleanTemplate({ name: "A", items: [{ item: "x".repeat(301) }] })).toMatchObject({ ok: false, error: "item_too_long" });
    expect(cleanTemplate({ name: "A", items: Array.from({ length: 201 }, () => ({ item: "x" })) })).toMatchObject({ ok: false, error: "too_many_items" });
    expect(cleanTemplate({ name: "A", active: "yes", items: [{ item: "x" }] })).toMatchObject({ ok: false, error: "active_invalid" });
  });

  test("the items go to the insert as JSON in order", () => {
    expect(JSON.parse(templateItemsJson([{ area: null, item: "a", criteria: "b" }]))).toEqual([{ area: null, item: "a", criteria: "b" }]);
  });
});

describe("marks on a check", () => {
  test("Pass, Not applicable and clear are taken; Fail needs a defect report", () => {
    expect(cleanItemMark({ result: "pass", note: "  fine " })).toEqual({ ok: true, value: { result: "pass", note: "fine" } });
    expect(cleanItemMark({ result: null })).toEqual({ ok: true, value: { result: null, note: null } });
    expect(cleanItemMark({ result: "na" })).toMatchObject({ ok: true, value: { result: "na" } });
    expect(cleanItemMark({ result: "fail" })).toMatchObject({ ok: false, error: "fail_needs_defect" });
    expect(cleanItemMark({ result: "maybe" })).toMatchObject({ ok: false, error: "result_invalid" });
    expect(cleanItemMark({ result: "pass", note: 3 })).toMatchObject({ ok: false, error: "note_invalid" });
  });

  test("a finished check and a failed item with a defect refuse a mark", () => {
    expect(itemMarkRefusal({ completedAt: null }, { result: null, defectId: null })).toBeNull();
    expect(itemMarkRefusal({ completedAt: "2026-11-10T01:00:00Z" }, { result: null, defectId: null })).toMatchObject({ error: "check_finished" });
    expect(itemMarkRefusal({ completedAt: null }, { result: "fail", defectId: 4 })).toMatchObject({ error: "defect_raised" });
    // A Fail whose defect went (only with the whole project) still stays Fail.
    expect(itemMarkRefusal({ completedAt: null }, { result: "fail", defectId: null })).toMatchObject({ error: "defect_raised" });
    expect(itemFailRefusal({ completedAt: null }, { result: "pass", defectId: null })).toBeNull();
    expect(itemFailRefusal({ completedAt: null }, { result: "fail", defectId: 4 })).toMatchObject({ error: "defect_raised" });
    expect(itemFailRefusal({ completedAt: "2026-11-10T01:00:00Z" }, { result: null, defectId: null })).toMatchObject({ error: "check_finished" });
  });

  test("progress counts each mark; Finish waits for every item", () => {
    const p = checkProgress([{ result: "pass" }, { result: "fail" }, { result: "na" }, { result: null }]);
    expect(p).toEqual({ total: 4, checked: 3, passed: 1, failed: 1, na: 1, open: 1 });
    expect(finishRefusal({ completedAt: null }, p)).toMatchObject({ error: "items_unchecked", message: expect.stringContaining("1 item is not marked") });
    expect(finishRefusal({ completedAt: null }, checkProgress([{ result: "pass" }]))).toBeNull();
    expect(finishRefusal({ completedAt: "x" }, checkProgress([{ result: "pass" }]))).toMatchObject({ error: "check_finished" });
  });
});

describe("migration 0296", () => {
  const sql = readFileSync(new URL("../../../migrations-pg/0296_handover_checklists.sql", import.meta.url), "utf8");
  test("the database holds one open check per project", () => {
    expect(sql).toMatch(/create unique index if not exists project_handover_checks_one_open\s+on public\.project_handover_checks \(project_id\) where completed_at is null/);
  });
  test("grants match project_handovers (0080): owner scm_engine, RLS, service_role only", () => {
    expect(sql).not.toMatch(/pos_app/);
    expect(sql).toContain("grant all on public.%I to service_role'");
    expect(sql).toContain("owner to scm_engine");
    expect(sql).toContain("revoke all on public.%I from anon, authenticated");
  });
  test("is wrapped in the demo overlay rebuild", () => {
    expect(sql.indexOf("select demo.drop_views();")).toBeLessThan(sql.indexOf("create table"));
    expect(sql.trimEnd().endsWith("select demo.sync();")).toBe(true);
  });
});
