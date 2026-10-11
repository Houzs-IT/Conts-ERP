/* The simplified main flow of a renovation project (owner decisions 11 Oct 2026):
   six steps, each derived from the module that owns the fact.

     design      always (the project exists)
     signed      a live renovation sales order is linked
     ordering    a live purchase-order line exists on the SO's lines
     renovation  a site task has started (in progress, done, or its PO received)
     handover    the customer signed the handover
     closed      handed over AND fully paid, or closed_at set

   The derived step is the furthest active step (company order) whose fact holds,
   so data that arrives out of order still lands on the right step. Staff may set
   a step by hand, forward or back; it holds until the data moves past both the
   manual step and the step the data was on when it was set. Pure: same facts,
   same answer. */

import { FLOW_STEP_DEFAULT_LABEL, FLOW_STEP_KEYS, type FlowStepKey } from "../../scm/shared/renovation-stages";

export interface FlowStepRow {
  step_key: FlowStepKey;
  label: string;
  sort_order: number;
  active: boolean;
}

export interface FlowFacts {
  hasSo: boolean;
  hasPoLine: boolean;
  taskStarted: boolean;
  handedOver: boolean;
  /** revised contract sum (SO lines incl. VOs), sen; null when unreadable */
  contractSen: number | null;
  receivedSen: number;
  closedAt: string | null;
}

export interface ManualStep {
  step: FlowStepKey | null;
  /** the derived step when the manual step was set; null reads as the manual step itself */
  base: FlowStepKey | null;
}

export const DEFAULT_FLOW_STEPS: readonly FlowStepRow[] = FLOW_STEP_KEYS.map((k, i) => ({
  step_key: k, label: FLOW_STEP_DEFAULT_LABEL[k], sort_order: (i + 1) * 10, active: true,
}));

/** Active steps in the company's order; design is always kept (every project is at least there). */
export function activeSteps(steps: readonly FlowStepRow[]): FlowStepRow[] {
  const list = (steps.length ? steps : DEFAULT_FLOW_STEPS).filter((s) => s.active || s.step_key === "design");
  return [...list].sort((a, b) => a.sort_order - b.sort_order || FLOW_STEP_KEYS.indexOf(a.step_key) - FLOW_STEP_KEYS.indexOf(b.step_key));
}

export function isFullyPaid(contractSen: number | null, receivedSen: number): boolean {
  return contractSen != null && contractSen > 0 && receivedSen >= contractSen;
}

function holds(key: FlowStepKey, f: FlowFacts): boolean {
  switch (key) {
    case "design": return true;
    case "signed": return f.hasSo;
    case "ordering": return f.hasPoLine;
    case "renovation": return f.taskStarted;
    case "handover": return f.handedOver;
    case "closed": return !!f.closedAt || (f.handedOver && isFullyPaid(f.contractSen, f.receivedSen));
  }
}

export function derivedFlowStep(steps: readonly FlowStepRow[], f: FlowFacts): FlowStepKey {
  const list = activeSteps(steps);
  let out: FlowStepKey = list[0]?.step_key ?? "design";
  for (const s of list) if (holds(s.step_key, f)) out = s.step_key;
  return out;
}

export interface FlowView {
  current: FlowStepKey;
  currentLabel: string;
  currentIndex: number;
  derived: FlowStepKey;
  manualStep: FlowStepKey | null;
  manualInEffect: boolean;
  steps: Array<{ key: FlowStepKey; label: string }>;
}

export function effectiveFlowStep(steps: readonly FlowStepRow[], derived: FlowStepKey, manual: ManualStep | null): FlowView {
  const list = activeSteps(steps);
  const idx = (k: FlowStepKey | null) => (k ? list.findIndex((s) => s.step_key === k) : -1);
  const dIdx = Math.max(idx(derived), 0);
  const mIdx = idx(manual?.step ?? null);
  const bIdx = manual?.base ? idx(manual.base) : mIdx;
  const manualInEffect = mIdx >= 0 && dIdx <= Math.max(mIdx, bIdx);
  const cIdx = manualInEffect ? mIdx : dIdx;
  const cur = list[cIdx]!;
  return {
    current: cur.step_key,
    currentLabel: cur.label,
    currentIndex: cIdx,
    derived: list[dIdx]!.step_key,
    manualStep: manual?.step ?? null,
    manualInEffect,
    steps: list.map((s) => ({ key: s.step_key, label: s.label })),
  };
}
