/* A renovation project's Start date and End date (owner, 15 Oct 2026; migration 0117). Nobody types them:
     Start date  the day the project was created (Malaysia time). Migration 0117's insert trigger fills it on every
                 create path; projectDatesFor only fills it for a row created before that trigger.
     End date    the day the project reached the Closed step, whether moved there by hand (Move step) or by its
                 data (closed_at, or handed over and fully paid); cleared when it leaves Closed.
   The step is derived on every read (flow.ts), so the end date is written wherever the step is computed: the board,
   the project page, the step routes and the contract hooks (syncProjectDates). Nothing else writes these columns for
   a renovation project: the generic project PATCH drops them (services/projects.ts). */

import { mytDateOf, todayMyt } from "../../scm/lib/my-time";
import type { FlowStepKey } from "../../scm/shared/renovation-stages";
import { loadProjectRows, loadRenovationFacts, type Db, type ProjectFacts } from "./load";
import { computeProjectView, type ProjectView } from "./view";

export interface ProjectDatesInput {
  /** the current step of the six */
  current: FlowStepKey;
  /** the current step is a hand-set one (Move step) */
  manualInEffect: boolean;
  /** when the step was last set by hand */
  manualAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Malaysia calendar day, YYYY-MM-DD */
  today: string;
}

/** A stored date or timestamp as its Malaysian calendar day; null when blank or unreadable. */
export function dayOf(x: unknown): string | null {
  if (x == null || x === "") return null;
  if (x instanceof Date) return Number.isNaN(x.getTime()) ? null : mytDateOf(x);
  const s = String(x);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : mytDateOf(ms);
}

/** What the two dates should be. An end date already stored while the project stays Closed is kept: it is the day
    the project got there, and re-reading the project on a later day must not move it. */
export function projectDatesFor(i: ProjectDatesInput): { startDate: string | null; endDate: string | null } {
  const startDate = dayOf(i.startDate) ?? dayOf(i.createdAt);
  if (i.current !== "closed") return { startDate, endDate: null };
  const kept = dayOf(i.endDate);
  if (kept) return { startDate, endDate: kept };
  const reached = i.manualInEffect ? dayOf(i.manualAt) : dayOf(i.closedAt);
  return { startDate, endDate: reached ?? i.today };
}

export function projectDatesOf(f: ProjectFacts, v: Pick<ProjectView, "flow">, today: string) {
  return projectDatesFor({
    current: v.flow.current,
    manualInEffect: v.flow.manualInEffect,
    manualAt: f.project.flow_manual_at ?? null,
    closedAt: f.project.closed_at,
    createdAt: f.project.created_at,
    startDate: f.project.start_date ?? null,
    endDate: f.project.end_date ?? null,
    today,
  });
}

/** Write the two dates when they differ from what is stored. A secondary write: a failure is logged and never fails
    the read or the action that called it. Returns the dates as they now are. */
export async function syncProjectDates(db: Db, f: ProjectFacts, v: Pick<ProjectView, "flow">, today = todayMyt()): Promise<{ startDate: string | null; endDate: string | null }> {
  const want = projectDatesOf(f, v, today);
  const haveStart = dayOf(f.project.start_date);
  const haveEnd = dayOf(f.project.end_date);
  if (want.startDate === haveStart && want.endDate === haveEnd) return want;
  try {
    await db.prepare(`UPDATE projects SET start_date = ?, end_date = ? WHERE id = ? AND project_kind = 'renovation'`)
      .bind(want.startDate, want.endDate, f.project.id).run();
    f.project.start_date = want.startDate;
    f.project.end_date = want.endDate;
    return want;
  } catch (e) {
    console.error("[renovation] project dates not written", f.project.id, e);
    return { startDate: haveStart, endDate: haveEnd };
  }
}

/** Load one project of the company (`companySql` on alias p) and bring its dates up to date, for the screens that
    read the stored columns (Customer info, the SO's Order information). Never throws. */
export async function refreshProjectDates(db: Db, projectId: number, companySql: string): Promise<void> {
  try {
    const rows = await loadProjectRows(db, companySql, { projectId, includeArchived: true });
    if (rows.length === 0) return;
    const f = (await loadRenovationFacts(db, rows)).get(projectId);
    if (!f) return;
    const today = todayMyt();
    await syncProjectDates(db, f, computeProjectView(f, today), today);
  } catch (e) {
    console.error("[renovation] project dates not refreshed", projectId, e);
  }
}
