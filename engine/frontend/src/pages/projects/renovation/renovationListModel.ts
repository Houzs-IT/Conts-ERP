/* The renovation Project List (owner, 15 Oct 2026): pure helpers for the step tiles, the 6-step track on each
   card / table row, the late and at-risk flags, and which section of the project page a step opens. */

import { FLOW_STEP_DEFAULT_LABEL, FLOW_STEP_KEYS, isFlowStepKey, type FlowStepKey } from "../../../vendor/shared/renovation-stages";
import type { BoardRowV2, FlowStepRow } from "./simpleApi";

export interface StepDef { key: FlowStepKey; label: string }

/** The company's active steps in its order and wording; the six defaults until Project Maintenance loads. */
export function activeSteps(rows: readonly FlowStepRow[] | null | undefined): StepDef[] {
  const active = (rows ?? []).filter((r) => r.active && isFlowStepKey(r.step_key)).sort((a, b) => a.sort_order - b.sort_order);
  if (active.length === 0) return FLOW_STEP_KEYS.map((key) => ({ key, label: FLOW_STEP_DEFAULT_LABEL[key] }));
  return active.map((r) => ({ key: r.step_key, label: r.label || FLOW_STEP_DEFAULT_LABEL[r.step_key] }));
}

/** Where on the project page a step's work lives (ids on the renovation detail sections). Closed opens the top. */
export const STEP_SECTION_ID: Readonly<Record<FlowStepKey, string | null>> = {
  design: "reno-design",
  signed: "reno-contract",
  ordering: "reno-procurement",
  renovation: "reno-unit-key",
  handover: "reno-unit-key",
  closed: null,
};

export function projectHref(id: number, step?: FlowStepKey | null): string {
  const anchor = step ? STEP_SECTION_ID[step] : null;
  return `/projects/${id}${anchor ? `#${anchor}` : ""}`;
}

/** How many projects sit in each step. */
export function stepCounts(rows: ReadonlyArray<Pick<BoardRowV2, "step">>): Record<FlowStepKey, number> {
  const out = Object.fromEntries(FLOW_STEP_KEYS.map((k) => [k, 0])) as Record<FlowStepKey, number>;
  for (const r of rows) if (isFlowStepKey(r.step.key)) out[r.step.key] += 1;
  return out;
}

export function toggleStep(selected: readonly string[], key: FlowStepKey): string[] {
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}

/** Days from `today` to `iso` (negative = past). */
export function daysUntil(today: string, iso: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export const AT_RISK_DAYS = 14;

const LATE_CODES = new Set(["handover_overdue", "task_overdue", "stage_overdue", "snag_overdue"]);
const RISK_CODES = new Set(["gate_blocked_works"]);
const BEFORE_HANDOVER: readonly FlowStepKey[] = ["design", "signed", "ordering", "renovation"];

export interface ListFlags {
  late: string[];
  atRisk: string[];
}

/** Late: something is past its date (handover, a task, a stage, a snag). At risk: not late yet, but the planned
    handover is within AT_RISK_DAYS while the works are not at Handover, or works started before the project was
    ready. A closed or handed-over project carries neither. */
export function listFlags(r: Pick<BoardRowV2, "step" | "plannedHandoverDate" | "handoverDate" | "redFlags">, today: string): ListFlags {
  const out: ListFlags = { late: [], atRisk: [] };
  if (r.step.key === "closed" || r.handoverDate) return out;
  const flags = r.redFlags ?? [];
  for (const f of flags) if (LATE_CODES.has(f.code)) out.late.push(f.text);
  const planned = r.plannedHandoverDate?.slice(0, 10) ?? null;
  if (planned && planned < today && !flags.some((f) => f.code === "handover_overdue")) out.late.push("Planned handover date has passed");
  if (out.late.length === 0) {
    for (const f of flags) if (RISK_CODES.has(f.code)) out.atRisk.push(f.text);
    if (planned && isFlowStepKey(r.step.key) && BEFORE_HANDOVER.includes(r.step.key)) {
      const n = daysUntil(today, planned);
      if (n >= 0 && n <= AT_RISK_DAYS) out.atRisk.push(`Handover ${n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`}, still at ${r.step.label}`);
    }
  }
  return out;
}
