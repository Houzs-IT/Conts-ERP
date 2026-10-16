/* SLA per project step (owner, 16 Oct 2026; migration 0121).
     Project Maintenance sets the days a step may take (project_flow_steps.sla_days, blank = no SLA).
     A project copies that number when it enters the step and keeps it, so a later change of the default does not move
     projects already in the step; a project can also have its own number for any step (project page, "edit").
     When a step had no default as the project entered it, nothing is copied, and the first default set afterwards is
     taken: otherwise every project in a step on the day SLAs were first set up would never get one.
   The day a project entered its current step:
     a step set by hand (Move step)  the day it was set (not the Notion import's own setting, see entryDayOf);
     Design                          the project's start date;
     Handover                        the day the customer signed (or the handover date);
     Renovation                      the first site task's actual start (else its first planned start);
     anything else                   the day the engine first saw the project there (nothing records it earlier).
   Closed has no SLA. Days in step = today - entered day; Overdue when that is more than the days allowed.
   The step is derived on every read (flow.ts), so the rows are written where the step is computed (board, list,
   project page, step routes), like the start and end dates (projectDates.ts). One read and at most one write per
   call, whatever the number of projects. A secondary write: a failure is logged and never fails the read. */

import { todayMyt } from "../../scm/lib/my-time";
import type { FlowStepKey } from "../../scm/shared/renovation-stages";
import type { Db, ProjectFacts } from "./load";
import type { ProjectView } from "./view";
import { dayOf } from "./projectDates";

export type SlaSource = "default" | "project";
export interface StepSlaRow { project_id: number; step_key: string; entered_on: string | null; sla_days: number | null; sla_source: SlaSource | null }

export interface StepSlaStep {
  key: FlowStepKey;
  label: string;
  /** days allowed for this project in this step: its own row when one was copied or set, else the default */
  days: number | null;
  /** where `days` comes from: copied default, set on the project, or the current default (not copied yet) */
  source: SlaSource | "maintenance";
  defaultDays: number | null;
}

export interface StepSlaView {
  stepKey: FlowStepKey;
  enteredOn: string | null;
  daysIn: number | null;
  days: number | null;
  /** days over the SLA; null when not over (or no SLA) */
  overdueBy: number | null;
  /** every step but Closed, for the project page's "edit" and the calendar's total */
  steps: StepSlaStep[];
  /** the days allowed for all the steps together, null when no step has an SLA */
  totalDays: number | null;
}

const DAY = 86_400_000;
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** The day the project entered its current step, as far as the data tells; null when it does not (first seen today). */
export function entryDayOf(f: ProjectFacts, v: Pick<ProjectView, "flow">): string | null {
  /* The Notion import set every imported project's step by hand, on the day of the import and by nobody: that day is
     not when the project got there, so those read the step's own data like a project that follows it. */
  const setByImport = f.project.source === "import" && f.project.flow_manual_by == null;
  if (v.flow.manualInEffect && !setByImport) return dayOf(f.project.flow_manual_at);
  switch (v.flow.current) {
    case "design": return dayOf(f.project.start_date) ?? dayOf(f.project.created_at);
    case "handover": return dayOf(f.handover?.signed_at) ?? dayOf(f.project.handed_over_at);
    case "renovation": {
      /* the first site task's actual start; the import brought planned dates only, so then the first planned start */
      const actual = f.tasks.map((t) => dayOf(t.actual_start)).filter((d): d is string => !!d).sort();
      const planned = f.tasks.map((t) => dayOf(t.planned_start)).filter((d): d is string => !!d).sort();
      return actual[0] ?? planned[0] ?? null;
    }
    default: return null;
  }
}

/** The view of one project from its rows. Pure. */
export function stepSlaViewOf(input: {
  current: FlowStepKey;
  steps: ReadonlyArray<{ key: FlowStepKey; label: string; defaultDays: number | null }>;
  rows: ReadonlyArray<Pick<StepSlaRow, "step_key" | "entered_on" | "sla_days" | "sla_source">>;
  today: string;
}): StepSlaView {
  const row = (k: string) => input.rows.find((r) => r.step_key === k);
  const steps: StepSlaStep[] = input.steps.filter((s) => s.key !== "closed").map((s) => {
    const r = row(s.key);
    return r?.sla_source
      ? { key: s.key, label: s.label, days: r.sla_days ?? null, source: r.sla_source, defaultDays: s.defaultDays }
      : { key: s.key, label: s.label, days: s.defaultDays, source: "maintenance", defaultDays: s.defaultDays };
  });
  const cur = steps.find((s) => s.key === input.current) ?? null;
  const enteredOn = dayOf(row(input.current)?.entered_on ?? null);
  const daysIn = enteredOn && input.current !== "closed" ? Math.max(0, daysBetween(enteredOn, input.today)) : null;
  const days = cur?.days ?? null;
  const overdueBy = days != null && daysIn != null && daysIn > days ? daysIn - days : null;
  const withDays = steps.filter((s) => s.days != null);
  return {
    stepKey: input.current, enteredOn, daysIn, days, overdueBy, steps,
    totalDays: withDays.length ? withDays.reduce((a, s) => a + (s.days ?? 0), 0) : null,
  };
}

/** What to write for the project's current step (null = nothing). Pure. */
export function slaWriteFor(input: {
  current: FlowStepKey; entryDay: string | null; defaultDays: number | null; today: string;
  row: Pick<StepSlaRow, "entered_on" | "sla_days" | "sla_source"> | undefined;
}): { enteredOn: string | null; days: number | null; source: SlaSource | null } | null {
  if (input.current === "closed") return null;
  const r = input.row;
  const copy = input.defaultDays != null ? { days: input.defaultDays, source: "default" as const } : { days: null, source: null };
  if (!r) return { enteredOn: input.entryDay ?? input.today, ...copy };
  const needsEntry = !r.entered_on;
  const needsCopy = !r.sla_source && input.defaultDays != null;
  if (!needsEntry && !needsCopy) return null;
  return {
    enteredOn: r.entered_on ? dayOf(r.entered_on) : input.entryDay ?? input.today,
    days: needsCopy ? input.defaultDays : r.sla_days ?? null,
    source: needsCopy ? "default" : r.sla_source,
  };
}

let ready: boolean | null = null;
/** Whether migration 0121 is applied. Cached once it is; asked again while it is not. */
export async function stepSlaReady(db: Db): Promise<boolean> {
  if (ready) return true;
  try {
    const r = await db.prepare(`SELECT to_regclass('public.project_step_sla') IS NOT NULL AS ok`).first<{ ok: unknown }>();
    ready = r?.ok === true || r?.ok === "t" || r?.ok === "true";
  } catch {
    ready = false;
  }
  return ready;
}

/** Bring the SLA rows of the projects' current steps up to date and attach each project's view (f.stepSla). Never
    throws; before migration 0121 every view stays undefined. */
export async function syncStepSla(db: Db, list: ReadonlyArray<{ f: ProjectFacts; v: Pick<ProjectView, "flow"> }>, today = todayMyt()): Promise<void> {
  if (list.length === 0) return;
  try {
    if (!(await stepSlaReady(db))) return;
    const ids = JSON.stringify(list.map(({ f }) => String(f.project.id)));
    const res = await db.prepare(
      `SELECT project_id::int AS project_id, step_key, entered_on::text AS entered_on, sla_days, sla_source
         FROM project_step_sla WHERE project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`,
    ).bind(ids).all<StepSlaRow>();
    const byProject = new Map<number, StepSlaRow[]>();
    for (const r of res.results ?? []) {
      const pid = Number(r.project_id);
      byProject.set(pid, [...(byProject.get(pid) ?? []), { ...r, project_id: pid, sla_days: r.sla_days == null ? null : Number(r.sla_days) }]);
    }
    const writes: Array<{ p: number; c: number; k: string; e: string | null; d: number | null; s: SlaSource | null }> = [];
    for (const { f, v } of list) {
      const pid = Number(f.project.id);
      const rows = byProject.get(pid) ?? [];
      const defaults = new Map((f.flowSteps ?? []).map((s) => [s.step_key, s.sla_days ?? null] as const));
      const cur = v.flow.current;
      const w = slaWriteFor({ current: cur, entryDay: entryDayOf(f, v), defaultDays: defaults.get(cur) ?? null, today, row: rows.find((r) => r.step_key === cur) });
      if (w) {
        writes.push({ p: pid, c: Number(f.project.company_id), k: cur, e: w.enteredOn, d: w.days, s: w.source });
        const i = rows.findIndex((r) => r.step_key === cur);
        const next: StepSlaRow = { project_id: pid, step_key: cur, entered_on: w.enteredOn, sla_days: w.days, sla_source: w.source };
        if (i >= 0) rows[i] = next; else rows.push(next);
      }
      f.stepSla = stepSlaViewOf({
        current: cur,
        steps: v.flow.steps.map((s) => ({ key: s.key, label: s.label, defaultDays: defaults.get(s.key) ?? null })),
        rows,
        today,
      });
    }
    if (writes.length) {
      await db.prepare(
        `INSERT INTO project_step_sla (project_id, company_id, step_key, entered_on, sla_days, sla_source)
         SELECT x.p, x.c, x.k, x.e::date, x.d, x.s FROM jsonb_to_recordset(?::text::jsonb) AS x(p bigint, c bigint, k text, e text, d int, s text)
         ON CONFLICT (project_id, step_key) DO UPDATE SET
           entered_on = coalesce(project_step_sla.entered_on, excluded.entered_on),
           sla_days = CASE WHEN project_step_sla.sla_source IS NULL THEN excluded.sla_days ELSE project_step_sla.sla_days END,
           sla_source = coalesce(project_step_sla.sla_source, excluded.sla_source),
           updated_at = now()`,
      ).bind(JSON.stringify(writes)).run();
    }
  } catch (e) {
    console.error("[renovation] step SLA not synced", e);
  }
}
