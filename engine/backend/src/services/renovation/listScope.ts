/* The renovation Project List's own filters (owner, 15 Oct 2026), applied by GET /api/projects?reno=1:
   - reno_step=design,signed,...  only projects whose current step (of the six) is one of these
   - reno_hide_closed=1            "Hide completed" means: hide projects in the Closed step
   - from / to                     a renovation project has no start / end date, so the range is matched against
                                   its calendar bar (created date to planned handover, services/renovation/calendarSpan.ts)
   The step is computed (services/renovation/view.ts), not stored, so these become id lists that listProjects
   applies next to its own filters. Exhibition projects keep the Houzs filters unchanged. */

import { isFlowStepKey, type FlowStepKey } from "../../scm/shared/renovation-stages";
import { todayMyt } from "../../scm/lib/my-time";
import { BOARD_CHECKLIST_KEYS, loadProjectRows, loadRenovationFacts, type Db } from "./load";
import { computeProjectView } from "./view";
import { renovationCalendarSpan, spanOverlaps } from "./calendarSpan";

export interface ListScopeRow {
  id: number;
  step: string;
  createdAt: string | null;
  plannedHandover: string | null;
  handedOverAt: string | null;
}

export interface ListScopeQuery {
  steps: FlowStepKey[];
  hideClosed: boolean;
  from: string;
  to: string;
}

export interface ListScope {
  /** keep only these ids (a step was picked) */
  onlyIds?: number[];
  /** drop these ids (Hide completed) */
  exceptIds?: number[];
  /** these ids pass the date range filter whatever their start / end date */
  rangeIds?: number[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the reno_* query values; null when the list asked for nothing renovation-specific. */
export function listScopeQuery(q: { reno?: string; reno_step?: string; reno_hide_closed?: string; from?: string; to?: string }): ListScopeQuery | null {
  if (q.reno !== "1") return null;
  const steps = String(q.reno_step ?? "").split(",").map((s) => s.trim()).filter(isFlowStepKey);
  const from = ISO.test(q.from ?? "") ? q.from! : "";
  const to = ISO.test(q.to ?? "") ? q.to! : "";
  const hideClosed = q.reno_hide_closed === "1";
  if (steps.length === 0 && !hideClosed && !from && !to) return null;
  return { steps, hideClosed, from, to };
}

export function renovationListScope(rows: readonly ListScopeRow[], q: ListScopeQuery): ListScope {
  const out: ListScope = {};
  if (q.steps.length > 0) out.onlyIds = rows.filter((r) => (q.steps as string[]).includes(r.step)).map((r) => r.id);
  if (q.hideClosed) out.exceptIds = rows.filter((r) => r.step === "closed").map((r) => r.id);
  if (q.from || q.to) {
    const from = q.from || "0000-01-01";
    const to = q.to || "9999-12-31";
    out.rangeIds = rows
      .filter((r) => {
        const span = renovationCalendarSpan({ createdAt: r.createdAt, plannedHandover: r.plannedHandover, handedOverAt: r.handedOverAt, slaDays: null });
        return !!span && spanOverlaps(span, from, to);
      })
      .map((r) => r.id);
  }
  return out;
}

/** Every renovation project of the active company with its current step. */
export async function loadListScopeRows(db: Db, companySql: string, includeArchived: boolean): Promise<ListScopeRow[]> {
  const projects = await loadProjectRows(db, companySql, { includeArchived });
  const facts = await loadRenovationFacts(db, projects, { checklistKeys: BOARD_CHECKLIST_KEYS });
  const today = todayMyt();
  // postgres.js may hand timestamps over as Date objects
  const iso = (x: unknown): string | null => (x == null ? null : x instanceof Date ? x.toISOString() : String(x));
  return projects.map((p) => ({
    id: p.id,
    step: computeProjectView(facts.get(p.id)!, today).flow.current,
    createdAt: iso(p.created_at),
    plannedHandover: iso(p.planned_handover_date)?.slice(0, 10) ?? null,
    handedOverAt: iso(p.handed_over_at),
  }));
}
