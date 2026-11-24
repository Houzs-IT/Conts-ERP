/* Turns loaded facts into what the board row and the project detail show.
   Pure: same facts, same answer; every rule lives in its own module. */

import { billingPrompts, instalmentOneReceived, paymentSummary, type BillingPrompt, type PaymentSummary } from "./billing";
import { boardConditions, unitKeyStatus, type ConditionSummary, type UnitKeyStatus } from "./conditions";
import { evaluateHardwareGate, GATE_REASON_TEXT, isSoConfirmed, permitStateOf, type GateResult } from "./gate";
import type { ProjectFacts, TaskRow } from "./load";
import { podCoverage, podQtyBySoItem, type PodCoverage } from "./pod";
import { redFlags, type RedFlag } from "./redFlags";
import { currentStage, deriveStageViews, type StageView } from "./stages";
import { tradeTaskStatus, type TaskStatus } from "./tradeTasks";
import { isFlowStepKey, type HoldFlag, type StageKey } from "../../scm/shared/renovation-stages";
import { derivedFlowStep, effectiveFlowStep, flowStages, stageLayersOf, type FlowFacts, type ProjectFlow, type StageLayers } from "./flow";
import { designSteps, renovationCategories, type DesignStepStatus, type RenovationCategoryStatus, type StageInputs } from "./stageRules";
import { LEGACY_WORK_TYPES } from "./workTypes";
import type { KeyHolder, VoSummary } from "./load";

export interface TaskView extends TaskRow {
  status: TaskStatus;
  poFullyReceived: boolean | null;
  soItemIds: string[];
}

export interface ProjectView {
  stages: Array<StageView & { pod: PodCoverage; tasks: number }>;
  currentStage: StageKey;
  gate: GateResult;
  prompts: BillingPrompt[];
  payment: PaymentSummary;
  conditions: { furniture: ConditionSummary | null; renoItem: ConditionSummary | null };
  unitKey: UnitKeyStatus;
  tasks: TaskView[];
  redFlags: RedFlag[];
  openSnags: number;
  /** the six-stage flow with each stage's status (owner rules 19 Nov 2026, flow.ts) */
  flow: ProjectFlow;
  /** the same stage statuses in the shape the project page's second layer reads */
  stageLayers: StageLayers;
  hold: { flag: HoldFlag; note: string | null; at: string | null } | null;
  /** contract total (SO incl. VOs) and received so far, from the SO's billing; never stored on the project */
  money: { contractSen: number | null; receivedSen: number | null; receivedPct: number | null };
  /** Live purchase orders raised for the project's sales order lines (owner, 24 Nov 2026: the To do drops "Order the main items" once there are some). */
  poCount: number;
  keyHolder: KeyHolder | null;
  vo: VoSummary | null;
}

/** The stage inputs of a project; fixtures and callers that skip the stage reads get them from the SO facts. */
export function stageInputsOf(f: ProjectFacts): StageInputs {
  if (f.stage) return f.stage;
  const received = f.billing.receivedTotalSen ?? 0;
  return {
    hasSo: !!f.so || !!f.signedSo,
    payment: f.so && f.billing.available
      ? { contractSen: f.billing.contractSen ?? 0, receivedSen: received, paidInstalments: f.billing.instalments.filter((i) => i.billed && (i.dueSen ?? 0) > 0 && (i.receivedSen ?? 0) >= (i.dueSen ?? 0)).length }
      : null,
    workTypes: LEGACY_WORK_TYPES, measuredOn: null, appointments: [], works: [], files: [], notes: [], reviews: [],
    variants: { lines: 0, missing: 0 },
    voCount: f.vo?.count ?? 0,
    categories: [],
    lines: [],
  };
}

export interface FlowDetail { facts: FlowFacts; designSteps: DesignStepStatus[]; categories: RenovationCategoryStatus[] }

/** What the six stages read from the modules (owner rules 19 Nov 2026). */
export function flowDetailOf(f: ProjectFacts, today: string): FlowDetail {
  const s = stageInputsOf(f);
  const design = designSteps(s, today);
  const categories = renovationCategories(s);
  const on = categories.filter((c) => c.onProject);
  const billingContract = f.billing.available ? f.billing.contractSen : (f.so?.local_total_sen ?? null);
  return {
    designSteps: design,
    categories,
    facts: {
      hasSo: s.hasSo,
      firstPaymentReceived: (s.payment?.receivedSen ?? f.billing.receivedTotalSen ?? 0) > 0,
      designDone: design.length > 0 && design.every((d) => d.done),
      hasVo: s.voCount > 0,
      renovationDone: on.length > 0 && on.every((c) => c.done),
      handedOver: !!f.handover || !!f.project.handed_over_at,
      contractSen: s.payment ? s.payment.contractSen : billingContract,
      receivedSen: s.payment ? s.payment.receivedSen : (f.billing.receivedTotalSen ?? 0),
      closedAt: f.project.closed_at,
    },
  };
}

/** The stage facts alone. */
export function flowFactsOf(f: ProjectFacts, today: string): FlowFacts {
  return flowDetailOf(f, today).facts;
}

export function moneyOf(f: ProjectFacts): ProjectView["money"] {
  if (!f.so) return { contractSen: null, receivedSen: null, receivedPct: null };
  const contractSen = f.billing.available ? f.billing.contractSen : (f.so.local_total_sen ?? null);
  const receivedSen = f.billing.available ? (f.billing.receivedTotalSen ?? 0) : null;
  const receivedPct = contractSen && contractSen > 0 && receivedSen != null ? Math.round((receivedSen / contractSen) * 1000) / 10 : null;
  return { contractSen, receivedSen, receivedPct };
}

export function computeProjectView(f: ProjectFacts, today: string): ProjectView {
  const views = deriveStageViews({
    typeStageKeys: f.type?.stage_keys ?? null,
    stored: f.stored,
    lines: f.lines,
  });
  const byKey = new Map(f.checklist.filter((c) => c.item_key).map((c) => [c.item_key!, c]));
  const soConfirmed = isSoConfirmed(f.so?.status);
  const shop = byKey.get("shop_drawings_signed");
  const gate = evaluateHardwareGate({
    soStatus: f.so?.status ?? null,
    instalment1Received: instalmentOneReceived(f.billing),
    shopDrawingsSigned: shop ? shop.status === "done" : null,
    permit: permitStateOf(byKey.get("renovation_permit")),
  });
  const prompts = billingPrompts(f.billing, views, soConfirmed);

  const qtyBySoItem = podQtyBySoItem(f.lines ?? []);
  const poLinesByItem = new Map<string, Array<{ id: string; qty: number; received_qty: number }>>();
  for (const pl of f.poLines) {
    const list = poLinesByItem.get(pl.so_item_id) ?? [];
    list.push(pl);
    poLinesByItem.set(pl.so_item_id, list);
  }
  const tasks: TaskView[] = f.tasks.map((t) => {
    const soItemIds = f.taskLines.filter((l) => Number(l.task_id) === Number(t.id)).map((l) => l.so_item_id);
    let poFullyReceived: boolean | null = null;
    if (t.fulfilment_kind === "po") {
      const pls = soItemIds.flatMap((id) => poLinesByItem.get(id) ?? []);
      poFullyReceived = pls.length > 0 ? pls.every((p) => Number(p.received_qty) >= Number(p.qty)) : false;
    }
    return { ...t, soItemIds, poFullyReceived, status: tradeTaskStatus({ ...t, poFullyReceived }, today) };
  });

  const stages = views.map((v) => ({
    ...v,
    pod: podCoverage(v, qtyBySoItem, f.pods),
    tasks: tasks.filter((t) => t.stage_key === v.key && t.status !== "skipped").length,
  }));
  const openSnags = f.defects.filter((d) => d.phase === "snag" && !d.closed_at);
  const handedOver = !!f.handover || !!f.project.handed_over_at;
  const flowSteps = f.flowSteps ?? [];
  const detail = flowDetailOf(f, today);
  const derived = derivedFlowStep(flowSteps, detail.facts);
  const manualStep = isFlowStepKey(f.project.flow_manual_step) ? f.project.flow_manual_step : null;
  const flow: ProjectFlow = {
    ...effectiveFlowStep(flowSteps, derived, manualStep
      ? { step: manualStep, base: isFlowStepKey(f.project.flow_manual_base_step) ? f.project.flow_manual_base_step : null }
      : null),
    stages: flowStages(flowSteps, detail.facts, detail.designSteps, detail.categories),
  };
  const holdFlag = f.project.hold_flag === "in_defect" || f.project.hold_flag === "on_hold" ? f.project.hold_flag : null;
  return {
    flow,
    stageLayers: stageLayersOf(flow.stages, detail.designSteps, detail.categories),
    hold: holdFlag ? { flag: holdFlag, note: f.project.hold_note ?? null, at: f.project.hold_at ?? null } : null,
    money: moneyOf(f),
    poCount: new Set(f.poLines.map((l) => l.purchase_order_id)).size,
    keyHolder: f.keyHolder ?? null,
    vo: f.vo ?? null,
    stages,
    currentStage: currentStage(views),
    gate,
    prompts,
    payment: paymentSummary(f.billing),
    conditions: boardConditions(f.lines, f.supply),
    unitKey: unitKeyStatus(byKey.get("keys_collected"), handedOver, byKey.get("keys_returned")),
    tasks,
    openSnags: openSnags.length,
    redFlags: redFlags({
      today,
      views,
      taskStatuses: tasks.map((t) => t.status),
      prompts,
      billingAvailable: f.billing.available,
      hasSo: !!f.so,
      openSnags,
      plannedHandoverDate: f.project.planned_handover_date,
      handedOver,
      gateOpen: gate.open,
      gateMessages: gate.reasons.map((r) => GATE_REASON_TEXT[r]),
    }),
  };
}

/** Why a stage cannot be marked done; empty when it can. */
export function stageCompletionBlockers(f: ProjectFacts, view: ProjectView, key: StageKey): string[] {
  const out: string[] = [];
  const stage = view.stages.find((s) => s.key === key);
  if (!stage) return ["unknown_stage"];
  if (stage.state === "skipped") out.push("stage_skipped");
  if (stage.state === "done") out.push("already_done");
  const open = f.checklist.filter(
    (c) => c.stage_key === key && c.status !== "done" && !(c.skip_reason && c.skip_reason.trim().length >= 3),
  );
  if (open.length > 0) out.push(`checklist_open:${open.length}`);
  if (stage.pod.missing.length > 0) out.push(`pod_missing:${stage.pod.missing.length}`);
  const openTasks = view.tasks.filter((t) => t.stage_key === key && t.status !== "done" && t.status !== "skipped");
  if (openTasks.length > 0) out.push(`tasks_open:${openTasks.length}`);
  if (key === "handover") {
    if (view.openSnags > 0) out.push(`snags_open:${view.openSnags}`);
    if (!f.handover) out.push("handover_unsigned");
  }
  return out;
}
