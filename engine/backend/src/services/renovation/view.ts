/* Turns loaded facts into what the board row and the project detail show.
   Pure: same facts, same answer; every rule lives in its own module. */

import { billingPrompts, instalmentOneReceived, paymentSummary, type BillingPrompt, type PaymentSummary } from "./billing";
import { boardConditions, unitKeyStatus, type ConditionSummary, type UnitKeyStatus } from "./conditions";
import { evaluateHardwareGate, isSoConfirmed, permitStateOf, type GateResult } from "./gate";
import type { ProjectFacts, TaskRow } from "./load";
import { podCoverage, type PodCoverage } from "./pod";
import { redFlags, type RedFlag } from "./redFlags";
import { currentStage, deriveStageViews, type StageView } from "./stages";
import { tradeTaskStatus, type TaskStatus } from "./tradeTasks";
import type { StageKey } from "../../scm/shared/renovation-stages";

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

  const qtyBySoItem = new Map((f.lines ?? []).map((l) => [l.soItemId, l.qty]));
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
  return {
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
