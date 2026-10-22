/* Site tasks of a renovation project: trade tasks from the SO's WORKS lines and
   template tasks from the project type.

   Owner's Notion boards (9 Oct): the trade order is a SUGGESTION. It only decides
   where a new task is laid out (seq); no task waits for another to finish, tasks
   carry planned date ranges, may overlap, and only overdue dates raise a flag.

   - One task per trade present on the contract; ELECTRICAL gets two (first fix
     piping before ceiling, second fix fittings after painting).
   - CLEANING lands in handover; PROJECT_MGMT gets no task. Both, and
     AIRCON_INSTALL, are filed under SERVICE but still come in as trades
     (contractSync picks lines by stages.ts lineGroup).
   - A trade whose every line was omitted by a variation order is skipped
     automatically ('vo_omitted'); a VO that adds it back re-opens it.
   - Template tasks: INTERNAL_TASKS whose stage the project type runs, stored as
     trade_code 'INTERNAL:<key>', fulfilment_kind 'internal', no PO.
   - Every task carries its Notion category (TASK_CATEGORIES) and is named by it.
     A trade task may be switched to our own in-house crew (fulfilment_kind
     'internal', people assigned, ticked done); a contract sync never puts a PO
     back on it. Extra tasks are added by hand from a category, and a category may
     repeat (occurrence 2, 3...); the sync only ever owns occurrence 1. */

import {
  INTERNAL_TASKS,
  NON_TASK_TRADES,
  TRADE_ORDER,
  categoryOfTask,
  taskCodeOfCategory,
  type StageKey,
  type TaskCategoryDef,
} from "../../scm/shared/renovation-stages";

export type FixPhase = "single" | "first" | "second";
export type FulfilmentKind = "po" | "internal";

/* Task names follow the owner's Notion vocabulary (spec section 5). */
const TRADE_LABEL: Readonly<Record<string, string>> = {
  PROTECTION: "PROTECTION",
  HACKING: "HACKING",
  PLUMBING: "PLUMBING",
  WATERPROOFING: "WATERPROOFING",
  "ELECTRICAL:first": "WIRING & HACKING",
  "ELECTRICAL:second": "LIGHTING & FAN INSTALLATION",
  MASONRY_TILING: "TILING",
  PLASTER_CEILING: "PLASTER CEILING",
  ALUMINIUM_GLASS: "WINDOW / SLIDING DOOR INSTALLATION",
  GRILL: "GRILL",
  PAINTING: "PAINTING",
  TEXTURED_PAINTING: "TEXTURED PAINTING",
  FLOORING: "FLOORING",
  AIRCON_INSTALL: "AIRCON INSTALLATION",
  CLEANING: "POST RENO CLEANING",
};

export function tradeTaskLabel(trade: string, fix: FixPhase): string {
  return categoryOfTask(trade, fix)?.label ?? TRADE_LABEL[`${trade}:${fix}`] ?? TRADE_LABEL[trade] ?? trade.replace(/_/g, " ");
}

export function internalTradeCode(key: string): string {
  return `INTERNAL:${key}`;
}

export function isInternalTradeCode(code: string | null | undefined): boolean {
  return String(code ?? "").startsWith("INTERNAL:");
}

export interface WorksLine {
  soItemId: string;
  trade: string | null;
  /** omitted by a VO (omitted_by_vo_id) or cancelled on the SO. */
  omitted: boolean;
  poItemId: string | null;
  poId: string | null;
  supplierId: string | null;
}

export interface ExistingTask {
  id: number;
  trade_code: string;
  fix_phase: string;
  state: string;
  skip_source?: string | null;
  purchase_order_id?: string | null;
  supplier_id?: string | null;
  fulfilment_kind?: string | null;
  occurrence?: number | null;
}

export interface TaskPlanRow {
  tradeCode: string;
  fixPhase: FixPhase;
  categoryCode: string | null;
  label: string;
  stageKey: StageKey;
  seq: number;
  fulfilmentKind: FulfilmentKind;
  supplierId: string | null;
  purchaseOrderId: string | null;
  soItemIds: string[];
  /** poItem per soItem, for project_trade_task_lines. */
  lines: Array<{ soItemId: string; poItemId: string | null }>;
}

export interface TaskPlan {
  create: TaskPlanRow[];
  /** existing tasks whose links should be refreshed (lines/PO/supplier). */
  refresh: Array<TaskPlanRow & { id: number }>;
  /** existing tasks to auto-skip: every line omitted by a VO. */
  autoSkip: number[];
  /** existing tasks auto-skipped earlier whose trade came back. */
  reopen: number[];
}

function orderSeq(trade: string, fix: FixPhase): number {
  const i = TRADE_ORDER.findIndex((s) => s.trade === trade && s.fix === fix);
  return i >= 0 ? (i + 1) * 10 : 900;
}

function phasesFor(trade: string): FixPhase[] {
  const steps = TRADE_ORDER.filter((s) => s.trade === trade).map((s) => s.fix);
  return steps.length > 0 ? steps : ["single"];
}

function key(trade: string, fix: string): string {
  return `${trade}|${fix}`;
}

export interface PlanInput {
  works: readonly WorksLine[];
  existing: readonly ExistingTask[];
  /** Stages the project type runs. */
  typeStageKeys: readonly string[];
}

export function planTradeTasks(input: PlanInput): TaskPlan {
  const typeStages = new Set(input.typeStageKeys);
  const byTrade = new Map<string, WorksLine[]>();
  for (const w of input.works) {
    const t = String(w.trade ?? "").toUpperCase();
    if (!t) continue;
    if (t in NON_TASK_TRADES && NON_TASK_TRADES[t] === null) continue;
    const list = byTrade.get(t) ?? [];
    list.push(w);
    byTrade.set(t, list);
  }

  const wanted = new Map<string, TaskPlanRow & { allOmitted: boolean }>();
  for (const [trade, lines] of byTrade) {
    const live = lines.filter((l) => !l.omitted);
    const stageKey: StageKey = (NON_TASK_TRADES[trade] as StageKey | undefined) ?? "hardware";
    const pick = live[0] ?? lines[0]!;
    for (const fix of phasesFor(trade)) {
      wanted.set(key(trade, fix), {
        tradeCode: trade,
        fixPhase: fix,
        categoryCode: categoryOfTask(trade, fix)?.code ?? null,
        label: tradeTaskLabel(trade, fix),
        stageKey,
        seq: stageKey === "handover" ? 950 : orderSeq(trade, fix),
        fulfilmentKind: "po",
        supplierId: pick.supplierId,
        purchaseOrderId: pick.poId,
        soItemIds: lines.map((l) => l.soItemId),
        lines: lines.map((l) => ({ soItemId: l.soItemId, poItemId: l.poItemId })),
        allOmitted: live.length === 0,
      });
    }
  }
  INTERNAL_TASKS.forEach((t, i) => {
    if (!typeStages.has(t.stage)) return;
    const cat = categoryOfTask(internalTradeCode(t.key), "single");
    wanted.set(key(internalTradeCode(t.key), "single"), {
      tradeCode: internalTradeCode(t.key),
      fixPhase: "single",
      categoryCode: cat?.code ?? null,
      label: cat?.label ?? t.label,
      stageKey: t.stage,
      seq: t.key === "pre_reno_delivery" ? 5 : t.stage === "hardware" ? 990 : 960 + i,
      fulfilmentKind: "internal",
      supplierId: null,
      purchaseOrderId: null,
      soItemIds: [],
      lines: [],
      allOmitted: false,
    });
  });

  /* The sync owns the first occurrence only; repeats added by hand are left alone. */
  const existingBy = new Map<string, ExistingTask>();
  for (const e of input.existing) {
    const k = key(e.trade_code, e.fix_phase);
    const cur = existingBy.get(k);
    if (!cur || Number(e.occurrence ?? 1) < Number(cur.occurrence ?? 1)) existingBy.set(k, e);
  }

  const plan: TaskPlan = { create: [], refresh: [], autoSkip: [], reopen: [] };
  for (const [k, row] of wanted) {
    const { allOmitted, ...clean } = row;
    const ex = existingBy.get(k);
    if (!ex) {
      if (!allOmitted) plan.create.push(clean);
      continue;
    }
    if (clean.fulfilmentKind === "po") {
      /* switched to in-house crew: keep its line links, never give it a PO or supplier */
      const inHouse = ex.fulfilment_kind === "internal";
      plan.refresh.push({ ...clean, id: ex.id, ...(inHouse ? { purchaseOrderId: null, supplierId: null } : {}) });
    }
    if (allOmitted && ex.state !== "skipped" && ex.state !== "done") plan.autoSkip.push(ex.id);
    if (!allOmitted && ex.state === "skipped" && ex.skip_source === "vo_omitted") plan.reopen.push(ex.id);
  }
  return plan;
}

export type TaskStatus = "skipped" | "done" | "in_progress" | "overdue" | "late_start" | "planned" | "unscheduled";

export interface TaskStatusInput {
  state: string;
  fulfilment_kind: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  /** po tasks: every linked PO line fully received (GRN or site receipt). */
  poFullyReceived?: boolean | null;
}

/** Display status of a task on a given day (YYYY-MM-DD). No sequencing rule: only dates. */
export function tradeTaskStatus(t: TaskStatusInput, today: string): TaskStatus {
  if (t.state === "skipped") return "skipped";
  if (t.state === "done" || t.actual_end) return "done";
  if (t.fulfilment_kind === "po" && t.poFullyReceived === true) return "done";
  const end = t.planned_end ? String(t.planned_end).slice(0, 10) : null;
  const start = t.planned_start ? String(t.planned_start).slice(0, 10) : null;
  if (end && end < today) return "overdue";
  if (t.state === "in_progress" || t.actual_start) return "in_progress";
  if (start && start < today) return "late_start";
  if (start || end) return "planned";
  return "unscheduled";
}

export function isTaskFlagged(status: TaskStatus): boolean {
  return status === "overdue" || status === "late_start";
}

export type TaskDateRefusal = "invalid_date" | "end_before_start";

export function plannedDatesRefusal(start: string | null | undefined, end: string | null | undefined): TaskDateRefusal | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (start != null && start !== "" && !re.test(start)) return "invalid_date";
  if (end != null && end !== "" && !re.test(end)) return "invalid_date";
  if (start && end && end < start) return "end_before_start";
  return null;
}

export interface ManualTaskRow {
  tradeCode: string;
  fixPhase: FixPhase;
  categoryCode: string;
  label: string;
  stageKey: StageKey;
  seq: number;
  occurrence: number;
  fulfilmentKind: FulfilmentKind;
}

/** A task added by hand from a category: the next free occurrence of its task code. Template tasks and
    categories with no trade are always our own people's; a trade defaults to in-house unless a PO is wanted. */
export function manualTaskRow(
  cat: TaskCategoryDef,
  existing: ReadonlyArray<{ trade_code: string; fix_phase: string; occurrence?: number | null }>,
  opts: { fulfilment?: FulfilmentKind } = {},
): ManualTaskRow {
  const tradeCode = taskCodeOfCategory(cat);
  const used = existing.filter((e) => e.trade_code === tradeCode && e.fix_phase === cat.fix).map((e) => Number(e.occurrence ?? 1));
  const occurrence = used.length ? Math.max(...used) + 1 : 1;
  const fulfilmentKind: FulfilmentKind = isInternalTradeCode(tradeCode) ? "internal" : (opts.fulfilment ?? "internal");
  return { tradeCode, fixPhase: cat.fix, categoryCode: cat.code, label: cat.label, stageKey: cat.stage, seq: cat.sort * 10 + occurrence, occurrence, fulfilmentKind };
}
