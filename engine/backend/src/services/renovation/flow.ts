/* The main flow of a renovation project: six stages, each derived from the module that owns the fact.
   Rules from the owner, 19 Nov 2026 (they replace those of 11 and 14 Oct 2026):

     signed      Sales order: complete once a sales order is linked. The project moves on to Design only after the
                 FIRST payment is received (any amount on the order); linked but unpaid stays here, "Waiting first payment".
     design      every Design step is done (stageRules.ts designSteps: the works In Design, then Variants)
     ordering    the sales order has a variation order that is not cancelled
     renovation  every product category the sales order uses is complete (stageRules.ts renovationCategories)
     handover    completed by hand (Complete on the stage) or by the customer signing the handover
     closed      Close pressed (closed_at) AND the contract fully settled: received >= revised contract sum

   The derived stage is the first active stage, in order, that is not complete; Sales order comes before Design whatever
   the stored order says, because Design waits on its first payment. When every stage is complete it is the last one.
   Staff may set a stage by hand, forward or back; it holds until the data moves past both the manual stage and the
   stage the data was on when it was set. Pure: same facts, same answer. */

import { FLOW_STEP_DEFAULT_LABEL, FLOW_STEP_KEYS, type FlowStepKey } from "../../scm/shared/renovation-stages";
import type { DesignStepStatus, RenovationCategoryStatus } from "./stageRules";

export interface FlowStepRow {
  step_key: FlowStepKey;
  label: string;
  sort_order: number;
  active: boolean;
  /** days a project may stay in this step (Project Maintenance, migration 0121); null = no SLA */
  sla_days?: number | null;
}

export interface FlowFacts {
  /** A live sales order is linked to the project. */
  hasSo: boolean;
  /** Any money received on the sales order. */
  firstPaymentReceived: boolean;
  /** Every Design step is done. */
  designDone: boolean;
  /** The sales order has a variation order that is not cancelled. */
  hasVo: boolean;
  /** Every category the sales order uses is complete. */
  renovationDone: boolean;
  handedOver: boolean;
  /** revised contract sum (SO lines incl. VOs), sen; null when unreadable */
  contractSen: number | null;
  receivedSen: number;
  /** Close pressed */
  closedAt: string | null;
}

export interface ManualStep {
  step: FlowStepKey | null;
  /** the derived step when the manual step was set; null reads as the manual step itself */
  base: FlowStepKey | null;
}

/** The owner's order of the stages (19 Nov 2026): Sales order first. */
export const FLOW_STAGE_ORDER: readonly FlowStepKey[] = ["signed", "design", "ordering", "renovation", "handover", "closed"];

export const DEFAULT_FLOW_STEPS: readonly FlowStepRow[] = FLOW_STAGE_ORDER.map((k, i) => ({
  step_key: k, label: FLOW_STEP_DEFAULT_LABEL[k], sort_order: (i + 1) * 10, active: true,
}));

/** Active steps in the company's order, design always kept (every project is at least there). Sales order is put just
    before Design when the stored order has it after: Design waits on the sales order's first payment. */
export function activeSteps(steps: readonly FlowStepRow[]): FlowStepRow[] {
  const list = (steps.length ? steps : DEFAULT_FLOW_STEPS).filter((s) => s.active || s.step_key === "design");
  const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order || FLOW_STEP_KEYS.indexOf(a.step_key) - FLOW_STEP_KEYS.indexOf(b.step_key));
  const d = sorted.findIndex((s) => s.step_key === "design");
  const g = sorted.findIndex((s) => s.step_key === "signed");
  if (d >= 0 && g > d) sorted.splice(d, 0, ...sorted.splice(g, 1));
  return sorted;
}

export function isFullyPaid(contractSen: number | null, receivedSen: number): boolean {
  return contractSen != null && contractSen > 0 && receivedSen >= contractSen;
}

/** Whether a stage's own rule is met. Sales order is complete on the link alone; the first payment is the gate out of it. */
export function stageComplete(key: FlowStepKey, f: FlowFacts): boolean {
  switch (key) {
    case "signed": return f.hasSo;
    case "design": return f.designDone;
    case "ordering": return f.hasVo;
    case "renovation": return f.renovationDone;
    case "handover": return f.handedOver;
    case "closed": return !!f.closedAt && isFullyPaid(f.contractSen, f.receivedSen);
  }
}

/** Linked to a sales order but nothing received: complete, yet the project waits on this stage. */
export function waitingFirstPayment(f: FlowFacts): boolean {
  return f.hasSo && !f.firstPaymentReceived;
}

/** The first active stage that is not complete (Sales order also holds while it waits for the first payment); the
    last stage when every one is complete. */
export function derivedFlowStep(steps: readonly FlowStepRow[], f: FlowFacts): FlowStepKey {
  const list = activeSteps(steps);
  for (const s of list) {
    if (!stageComplete(s.step_key, f)) return s.step_key;
    if (s.step_key === "signed" && waitingFirstPayment(f)) return s.step_key;
  }
  return list[list.length - 1]?.step_key ?? "design";
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

/** One stage as the project page draws it: whether its rule is met, a short state text, and for Design and Renovation
    the second layer (designSteps / categories). */
export interface FlowStageStatus {
  key: FlowStepKey;
  label: string;
  complete: boolean;
  /** Complete but the project still waits here: Sales order linked, first payment not received. */
  waiting: boolean;
  state: string;
  /** Design only: each Design step, in order. */
  designSteps?: DesignStepStatus[];
  /** Renovation only: every catalog category, on the project or not. */
  categories?: RenovationCategoryStatus[];
}

/** The flow with each stage's status. */
export interface ProjectFlow extends FlowView {
  stages: FlowStageStatus[];
}

function stageState(key: FlowStepKey, f: FlowFacts, design: readonly DesignStepStatus[], cats: readonly RenovationCategoryStatus[]): string {
  switch (key) {
    case "signed":
      return !f.hasSo ? "No sales order yet" : f.firstPaymentReceived ? "First payment received" : "Waiting first payment";
    case "design": {
      if (f.designDone) return "Design done";
      return `${design.filter((s) => s.done).length} of ${design.length} steps done`;
    }
    case "ordering":
      return f.hasVo ? "Variation order raised" : "No variation order yet";
    case "renovation": {
      const on = cats.filter((c) => c.onProject);
      if (on.length === 0) return "No sales order lines";
      if (f.renovationDone) return "All categories complete";
      return `${on.filter((c) => c.done).length} of ${on.length} categories complete`;
    }
    case "handover":
      return f.handedOver ? "Handed over" : "Not handed over";
    case "closed": {
      const paid = isFullyPaid(f.contractSen, f.receivedSen);
      if (f.closedAt) return paid ? "Closed" : "Closed, waiting full payment";
      return paid ? "Fully paid, not closed" : "Open";
    }
  }
}

/** Every active stage, in order, with its status. */
export function flowStages(
  steps: readonly FlowStepRow[], f: FlowFacts, design: readonly DesignStepStatus[], cats: readonly RenovationCategoryStatus[],
): FlowStageStatus[] {
  return activeSteps(steps).map((s): FlowStageStatus => ({
    key: s.step_key,
    label: s.label,
    complete: stageComplete(s.step_key, f),
    waiting: s.step_key === "signed" && waitingFirstPayment(f),
    state: stageState(s.step_key, f, design, cats),
    ...(s.step_key === "design" ? { designSteps: [...design] } : {}),
    ...(s.step_key === "renovation" ? { categories: [...cats] } : {}),
  }));
}

/** The stages' second layer as the project detail sends it (GET /api/renovation/:id `stageLayers`): every active stage's
    complete flag and state, every catalog category (catalog order) for Renovation, and the Design steps. */
export interface StageLayers {
  stages: Array<{ key: FlowStepKey; label: string; complete: boolean; waiting: boolean; state: string }>;
  renovation: { categories: RenovationCategoryStatus[] };
  design?: { steps: DesignStepStatus[] };
}

export function stageLayersOf(
  stages: readonly FlowStageStatus[], design: readonly DesignStepStatus[], cats: readonly RenovationCategoryStatus[],
): StageLayers {
  return {
    stages: stages.map((s) => ({ key: s.key, label: s.label, complete: s.complete, waiting: s.waiting, state: s.state })),
    renovation: { categories: [...cats] },
    design: { steps: [...design] },
  };
}
