/* Service cases in renovation mode: route bodies. The paths and their gates stay in routes/assr.ts (the route
   generator reads them there); see services/renovation/serviceCaseProject.ts for the rule. */

import type { Context } from "hono";
import type { Env } from "../types";
import type { Db } from "../services/renovation/load";
import { activeCompanySql } from "../scm/lib/companyScope";
import {
  annotateCaseProjects,
  readCaseCategories,
  readCaseProject,
  renovationMode,
  searchCaseProjects,
  type CaseProject,
} from "../services/renovation/serviceCaseProject";

type Ctx = Context<{ Bindings: Env }>;
const db = (c: Ctx) => c.env.DB as unknown as Db;
const projectScope = (c: Ctx) => activeCompanySql(c, "p.company_id");

/** GET /api/assr/renovation/context: is this a renovation install, and its item categories. */
export async function renovationCaseContextRoute(c: Ctx) {
  const reno = await renovationMode(db(c)).catch(() => false);
  if (!reno) return c.json({ renovation: false, categories: [] });
  const categories = await readCaseCategories(db(c)).catch((e) => {
    console.error("[assr.renovation] categories unreadable", e);
    return [];
  });
  return c.json({ renovation: true, categories });
}

/** GET /api/assr/renovation/projects?q=: the New Service Case project picker. */
export async function renovationCaseProjectsRoute(c: Ctx) {
  if (!(await renovationMode(db(c)))) return c.json({ error: "not_renovation_mode", message: "This install does not run renovation projects." }, 409);
  return c.json({ data: await searchCaseProjects(db(c), projectScope(c), String(c.req.query("q") ?? "").slice(0, 80)) });
}

/** The project a create names, checked: renovation mode, a renovation project of the active company.
    Answers the refusal to send when it is not usable. */
export async function caseProjectForCreate(c: Ctx, raw: unknown): Promise<{ project: CaseProject } | { refusal: Response }> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { refusal: c.json({ error: "project_invalid", message: "Pick the project from the list." }, 400) };
  if (!(await renovationMode(db(c)))) return { refusal: c.json({ error: "not_renovation_mode", message: "This install does not run renovation projects." }, 400) };
  const project = await readCaseProject(db(c), id, projectScope(c));
  if (!project) return { refusal: c.json({ error: "project_not_found", message: "That project was not found. Pick it from the list again." }, 404) };
  return { project };
}

/** Add project_code / project_name to case rows that carry a project_id. Never fails the read it decorates. */
export async function withCaseProjects(c: Ctx, rows: ReadonlyArray<Record<string, unknown> | null | undefined>): Promise<void> {
  try {
    await annotateCaseProjects(db(c), rows);
  } catch (e) {
    console.error("[assr.renovation] project labels unreadable", e);
  }
}
