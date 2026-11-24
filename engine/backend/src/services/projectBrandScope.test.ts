/* Projects by company (PLAN-project-brand-access.md). */
import { describe, expect, it } from "vitest";
import { brandVisibleCond, brandVisibleSql, loadBrandSide, projectIdOfPath, projectRefOf } from "./projectBrandScope";
import type { Db } from "./renovation/load";

const dbAnswering = (side: string | null, seen: unknown[][] = []): Db => ({
  prepare: () => ({
    bind: (...args: unknown[]) => {
      seen.push(args);
      return { first: async () => ({ side }), all: async () => ({ results: [] }), run: async () => ({}) };
    },
  }),
}) as unknown as Db;

const staff = (email: string, permissions: string[] = []) => ({ email, permissions });

describe("loadBrandSide", () => {
  it("limits The Conts and Dream Crafter people to their company", async () => {
    expect(await loadBrandSide(dbAnswering("conts"), staff("a@x.com"))).toBe("conts");
    expect(await loadBrandSide(dbAnswering("dream_crafter"), staff("b@x.com"))).toBe("dream_crafter");
  });

  it("leaves both companies, unknown people and the view before migration 0364 unlimited", async () => {
    expect(await loadBrandSide(dbAnswering("both"), staff("c@x.com"))).toBeNull();
    expect(await loadBrandSide(dbAnswering(null), staff("d@x.com"))).toBeNull();
  });

  it("treats a database without the staff view as unlimited, and still fails loud on other errors", async () => {
    const failing = (message: string): Db => ({ prepare: () => ({ bind: () => ({ first: async () => { throw new Error(message); } }) }) }) as unknown as Db;
    expect(await loadBrandSide(failing('relation "conts_staff" does not exist'), staff("f@x.com"))).toBeNull();
    expect(await loadBrandSide(failing("no such table: conts_staff"), staff("g@x.com"))).toBeNull();
    await expect(loadBrandSide(failing("connection reset"), staff("h@x.com"))).rejects.toThrow("connection reset");
  });

  it("never limits a full-access account and asks nothing for it", async () => {
    const seen: unknown[][] = [];
    expect(await loadBrandSide(dbAnswering("conts", seen), staff("e@x.com", ["*"]))).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe("brandVisibleSql", () => {
  it("adds nothing for someone who sees every brand", () => {
    expect(brandVisibleSql(null)).toBe("");
    expect(brandVisibleCond(null)).toBe("TRUE");
  });

  it("drops only projects whose brand belongs to the other company", () => {
    const sql = brandVisibleSql("conts", "p");
    expect(sql.startsWith(" AND NOT EXISTS")).toBe(true);
    expect(sql).toContain("lower(p.brand)");
    expect(sql).toContain("<> 'conts'");
    expect(sql).toContain("IS NOT NULL");
  });
});

describe("projectIdOfPath", () => {
  it("finds the project in one-project addresses", () => {
    expect(projectIdOfPath("/api/projects/12")).toBe(12);
    expect(projectIdOfPath("/api/projects/12/checklist")).toBe(12);
    expect(projectIdOfPath("/api/projects-print/7")).toBe(7);
    expect(projectIdOfPath("/api/renovation/31/pod")).toBe(31);
    expect(projectIdOfPath("/api/beta/projects/44/workspace")).toBe(44);
  });

  it("ignores lists, settings and other ids", () => {
    expect(projectIdOfPath("/api/projects")).toBeNull();
    expect(projectIdOfPath("/api/projects/brands/3")).toBeNull();
    expect(projectIdOfPath("/api/renovation/calendar")).toBeNull();
    expect(projectIdOfPath("/api/beta/board")).toBeNull();
    expect(projectIdOfPath("/api/beta/handover-templates/5")).toBeNull();
  });
});

describe("projectRefOf", () => {
  const noQuery = () => undefined;
  const withQuery = (q: Record<string, string>) => (name: string) => q[name];

  it("uses the project in the address", () => {
    expect(projectRefOf("/api/beta/projects/44/vo", noQuery)).toEqual({ sql: "?", id: 44 });
  });

  it("finds the project of a child record", () => {
    const ref = projectRefOf("/api/renovation/trade-tasks/12/start", noQuery);
    expect(ref?.id).toBe(12);
    expect(ref?.sql).toContain("FROM project_trade_tasks WHERE id = ?");
    expect(projectRefOf("/api/beta/handover-check-items/9", noQuery)?.sql).toContain("JOIN project_handover_checks");
    expect(projectRefOf("/api/projects/checklist/3/status", noQuery)?.sql).toContain("FROM project_checklist");
  });

  it("uses a projectId in the query for lists cut to one project", () => {
    expect(projectRefOf("/api/beta/board", withQuery({ projectId: "8" }))).toEqual({ sql: "?", id: 8 });
    expect(projectRefOf("/api/renovation/key-log", withQuery({ projectId: "x" }))).toBeNull();
  });

  it("leaves settings lists alone", () => {
    expect(projectRefOf("/api/renovation/people/5", noQuery)).toBeNull();
    expect(projectRefOf("/api/projects/brands/2/logo", noQuery)).toBeNull();
  });
});
