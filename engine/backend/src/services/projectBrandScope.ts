// Projects by company (owner, 23 Nov 2026): a person sees the projects whose brand is their company's. The Conts people
// see The Conts brand, Dream Crafter people Dream Crafter's, people on both companies (and management) every brand.
// A project with no brand, or a brand on no company, stays open to all. PLAN-project-brand-access.md, migration 0363.
import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";
import type { AuthUser } from "./auth";
import { hasPermission } from "./permissions";
import { isMissingRelation, type Db } from "./renovation/load";

export type BrandSide = "conts" | "dream_crafter";
const isBrandSide = (v: unknown): v is BrandSide => v === "conts" || v === "dream_crafter";

/** The company whose brands limit this person, or null when they see every brand. `to_jsonb(...)->>'side'` reads null
 *  instead of failing before migration 0363, so the limit simply starts once it is applied. */
export async function loadBrandSide(db: Db, user: Partial<Pick<AuthUser, "email" | "permissions" | "permissions_set">> | undefined): Promise<BrandSide | null> {
  if (!user?.email || hasPermission(user.permissions_set ?? user.permissions ?? [], "*")) return null;
  const row = await guarded(() => db.prepare(`SELECT to_jsonb(s)->>'side' AS side FROM conts_staff s WHERE lower(s.email) = lower(?) LIMIT 1`)
    .bind(user.email).first<{ side: string | null }>());
  return isBrandSide(row?.side) ? row.side : null;
}

/** No conts_staff view (a Houzs-only database, the SQLite test database): nobody is limited, as before 0363. Any other
 *  failure is thrown. */
async function guarded<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (isMissingRelation(e) || /no such (table|function)/i.test(String((e as { message?: string } | null)?.message ?? ""))) {
      console.warn("[project-brand] view conts_staff missing, no brand limit applied");
      return null;
    }
    throw e;
  }
}

/** A WHERE fragment (starting with AND) on a projects alias: drops projects whose brand belongs to the other company.
 *  The side is one of two fixed words, so it is inlined and the fragment needs no binds. */
export function brandVisibleSql(side: BrandSide | null, alias = "p"): string {
  return side ? ` AND ${brandVisibleCond(side, alias)}` : "";
}

/** The same limit as a whole condition, for queries that join a list of conditions. */
export function brandVisibleCond(side: BrandSide | null, alias = "p"): string {
  return side ? `NOT ${otherBrandSql(side, alias)}` : "TRUE";
}

const otherBrandSql = (side: BrandSide, alias: string): string =>
  `EXISTS (SELECT 1 FROM project_brands pbs WHERE lower(pbs.name) = lower(${alias}.brand)
    AND to_jsonb(pbs)->>'side' IS NOT NULL AND to_jsonb(pbs)->>'side' <> '${side}')`;

/** The project id in a one-project address, or null for lists, settings and other non-project paths. */
export function projectIdOfPath(path: string): number | null {
  const id = /^\/api\/(?:projects|projects-print|renovation|beta\/projects)\/(\d+)(?:\/|$)/.exec(path)?.[1];
  return id ? Number(id) : null;
}

/** Records that belong to one project, addressed by their own id (/api/renovation/trade-tasks/12/start): the statement
 *  that finds their project. Settings lists (brands, venues, people, flow steps) belong to no project and are absent. */
const CHILD_PROJECT_SQL: Record<string, string> = {
  checklist: "SELECT project_id FROM project_checklist WHERE id = ?",
  "trade-tasks": "SELECT project_id FROM project_trade_tasks WHERE id = ?",
  defects: "SELECT project_id FROM project_defects WHERE id = ?",
  snags: "SELECT project_id FROM project_defects WHERE id = ?",
  "design-files": "SELECT project_id FROM project_design_files WHERE id = ?",
  "design-notes": "SELECT project_id FROM project_design_notes WHERE id = ?",
  "site-measures": "SELECT project_id FROM project_design_records WHERE id = ?",
  "key-moves": "SELECT project_id FROM project_key_moves WHERE id = ?",
  events: "SELECT project_id FROM project_beta_events WHERE id = ?",
  "handover-checks": "SELECT project_id FROM project_handover_checks WHERE id = ?",
  "handover-check-items": "SELECT k.project_id FROM project_handover_check_items i JOIN project_handover_checks k ON k.id = i.check_id WHERE i.id = ?",
};

export interface ProjectRef { sql: string; id: number }

/** Which project a request is about: its address, a child record's address, or a projectId / project_id in the query.
 *  `sql` stands where a project id goes and takes `id` as its one bind. Null when it is about no single project. */
export function projectRefOf(path: string, query: (name: string) => string | undefined): ProjectRef | null {
  const direct = projectIdOfPath(path);
  if (direct != null) return { sql: "?", id: direct };
  const child = /^\/api\/(?:projects|renovation|beta)\/([a-z-]+)\/(\d+)(?:\/|$)/.exec(path);
  const childSql = child ? CHILD_PROJECT_SQL[child[1]] : undefined;
  if (child && childSql) return { sql: `(${childSql})`, id: Number(child[2]) };
  const asked = query("projectId") ?? query("project_id");
  return asked && /^\d+$/.test(asked) ? { sql: "?", id: Number(asked) } : null;
}

/** Whether this person's company differs from the project's brand's company, in one statement (the guard runs on every
 *  one-project request, and each statement costs two waits on the database line). */
const HIDDEN_PROJECT_SQL = `SELECT 1 AS hit FROM projects p
   JOIN project_brands pbs ON lower(pbs.name) = lower(p.brand)
   JOIN conts_staff s ON lower(s.email) = lower(?)
  WHERE p.id = __PROJECT__ AND to_jsonb(s)->>'side' IN ('conts', 'dream_crafter')
    AND to_jsonb(pbs)->>'side' IS NOT NULL AND to_jsonb(pbs)->>'side' <> to_jsonb(s)->>'side'
  LIMIT 1`;

/** One guard for every request about one project (projectRefOf): a project of the other company's brand answers 404, as a missing one does. */
export const projectBrandGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const ref = projectRefOf(c.req.path, (name) => c.req.query(name));
  const user = c.get("user");
  if (ref == null || !user?.email || hasPermission(user.permissions_set ?? user.permissions ?? [], "*")) return next();
  const sql = HIDDEN_PROJECT_SQL.replace("__PROJECT__", ref.sql);
  const hidden = await guarded(() => (c.env.DB as unknown as Db).prepare(sql).bind(user.email, ref.id).first<{ hit: number }>());
  if (hidden) return c.json({ error: "not_found", message: "Project not found." }, 404);
  return next();
};
