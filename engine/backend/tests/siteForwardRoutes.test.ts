import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import siteForward from "../src/conts/site-forward-routes";
import type { Staff } from "../src/conts/staff-identity";

const RENOVATOR: Staff = { userId: "u-reno", name: "Ah Seng", email: "seng@example.test", departmentId: null, side: null, role: "renovator", field: false };

interface Script {
  brand?: string | null;
  personId?: number | null;
  line?: Record<string, unknown> | null;
}

interface Call {
  sql: string;
  args: unknown[];
}

function scriptedDb(script: Script) {
  const calls: Call[] = [];
  const answer = (sql: string): unknown => {
    if (sql.includes("public.conts_renovators")) return script.brand === undefined ? null : { brand_name: script.brand };
    if (sql.includes("FROM project_people")) return script.personId === undefined ? null : { id: script.personId };
    if (sql.includes("i.id::text = ?")) return script.line ?? null;
    return null;
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => {
      calls.push({ sql, args });
      return answer(sql);
    },
    all: async () => {
      calls.push({ sql, args });
      return { results: [] };
    },
    run: async () => {
      calls.push({ sql, args });
      return {};
    },
  });
  return { calls, database: { prepare: (sql: string) => statement(sql) } };
}

function crewApp(database: unknown, staff: Staff = RENOVATOR) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("staff" as never, staff as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/site-forward", siteForward);
  return {
    jobs: () => app.request("/api/site-forward/jobs", { method: "GET" }, { DB: database }),
    save: (body: unknown) => app.request("/api/site-forward/lines/line-1/progress", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, { DB: database }),
  };
}

const worksLine = { id: "line-1", project_id: 13, company_id: 1, cat_code: "WORKS", sub_code: "ELECTRICAL", qty: "3", done_qty: null };

describe("renovator crew routes", () => {
  test("someone who is not a renovator is refused", async () => {
    const { database } = scriptedDb({ brand: "The Conts" });
    const crew = crewApp(database, { ...RENOVATOR, role: "housekeeper" });
    const jobs = await crew.jobs();
    expect(jobs.status).toBe(403);
    expect(await jobs.json()).toMatchObject({ error: "not_renovator" });
    expect((await crew.save({ doneQty: 1 })).status).toBe(403);
  });

  test("a renovator with no brand gets no_brand on both routes", async () => {
    const crew = crewApp(scriptedDb({ brand: null }).database);
    const jobs = await crew.jobs();
    expect(jobs.status).toBe(409);
    expect(await jobs.json()).toMatchObject({ error: "no_brand" });
    const saved = await crew.save({ doneQty: 1 });
    expect(saved.status).toBe(409);
    expect(await saved.json()).toMatchObject({ error: "no_brand" });
  });

  test("the jobs list asks only for the renovator's brand, as a bound value", async () => {
    const { database, calls } = scriptedDb({ brand: " The Conts " });
    const jobs = await crewApp(database).jobs();
    expect(jobs.status).toBe(200);
    expect(await jobs.json()).toEqual({ brand: "The Conts", areTicksReady: true, projects: [] });
    const boardCalls = calls.filter((call) => call.sql.includes("p.archived_at IS NULL"));
    expect(boardCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of boardCalls) {
      expect(call.sql).toContain("lower(trim(p.brand)) = lower(trim(?))");
      expect(call.sql).not.toContain("The Conts");
      expect(call.args).toEqual(["The Conts"]);
    }
  });

  test("a line of another brand is not found", async () => {
    const { database, calls } = scriptedDb({ brand: "Dream Crafter", line: null });
    const saved = await crewApp(database).save({ doneQty: 1 });
    expect(saved.status).toBe(404);
    expect(await saved.json()).toMatchObject({ error: "line_not_found" });
    const lookup = calls.find((call) => call.sql.includes("i.id::text = ?"));
    expect(lookup?.sql).toContain("lower(trim(p.brand)) = lower(trim(?))");
    expect(lookup?.args).toEqual(["line-1", "Dream Crafter"]);
    expect(calls.some((call) => call.sql.includes("INSERT INTO project_line_progress"))).toBe(false);
  });

  test("a save records the count, the person, and no office user", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", personId: 42, line: worksLine });
    const saved = await crewApp(database).save({ doneQty: 2 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, previousDoneQty: 0, doneQty: 2, completedTaskIds: [] });
    const write = calls.find((call) => call.sql.includes("INSERT INTO project_line_progress"));
    expect(write?.args).toEqual(["line-1", 13, 1, 2, null, 42]);
  });

  test("a save by someone with no person record leaves the person blank", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", line: worksLine });
    expect((await crewApp(database).save({ doneQty: 1 })).status).toBe(200);
    expect(calls.find((call) => call.sql.includes("INSERT INTO project_line_progress"))?.args).toEqual(["line-1", 13, 1, 1, null, null]);
  });

  test("a count above the line's qty is refused", async () => {
    const { database } = scriptedDb({ brand: "The Conts", line: worksLine });
    const saved = await crewApp(database).save({ doneQty: 4 });
    expect(saved.status).toBe(400);
    expect(await saved.json()).toMatchObject({ error: "invalid_qty" });
  });
});
