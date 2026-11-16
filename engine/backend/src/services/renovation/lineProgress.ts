import type { Db } from "./load";
import { BUILT_IN_TASK_CATEGORY, LIVE_BOARD_LINE, SO_LINE_CATEGORY_JOIN } from "./requirementBoard";
import { completionRefusal, markTaskDone } from "./taskCompletion";

export interface LineActor {
  userId: number | null;
  personId: number | null;
  companySql: string;
  brandName?: string | null;
  today: string;
}

export interface ProgressLine {
  id: string;
  project_id: number;
  company_id: number;
  cat_code: string;
  sub_code: string | null;
  qty: number | string;
  done_qty: number | string | null;
}

export interface TradeTaskRow {
  id: number;
  trade_code: string;
  fulfilment_kind: string;
  state: string;
}

export interface ProgressSaved {
  projectId: number;
  previousDoneQty: number;
  doneQty: number;
  completedTasks: TradeTaskRow[];
}

export type ProgressRefusal = "line_not_found" | "invalid_qty" | "trade_complete";

const isBuiltIn = (line: ProgressLine): boolean => line.cat_code === "BUILTIN";

async function loadProgressLine(db: Db, soItemId: string, companySql: string, brandName: string | null = null): Promise<ProgressLine | null> {
  return db.prepare(
    `SELECT i.id::text AS id, p.id::int AS project_id, p.company_id::int AS company_id, cg.code AS cat_code, prod.sub_category AS sub_code,
            i.qty, lp.done_qty
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       JOIN projects p ON p.id = so.project_id
       LEFT JOIN project_line_progress lp ON lp.so_item_id = i.id
       ${SO_LINE_CATEGORY_JOIN}
      WHERE i.id::text = ? AND p.project_kind = 'renovation' AND p.archived_at IS NULL${companySql}${brandName === null ? "" : " AND lower(trim(p.brand)) = lower(trim(?))"} AND ${LIVE_BOARD_LINE}`,
  ).bind(...(brandName === null ? [soItemId] : [soItemId, brandName])).first<ProgressLine>();
}

async function tradeTasksOf(db: Db, line: ProgressLine): Promise<TradeTaskRow[]> {
  const matchSql = isBuiltIn(line) ? "t.category_code = ?" : "t.trade_code = ?";
  const { results } = await db.prepare(
    `SELECT t.id::int AS id, t.trade_code, t.fulfilment_kind, t.state FROM project_trade_tasks t
      WHERE t.project_id = ? AND t.state <> 'skipped' AND ${matchSql} ORDER BY t.seq`,
  ).bind(line.project_id, isBuiltIn(line) ? BUILT_IN_TASK_CATEGORY : line.sub_code).all<TradeTaskRow>();
  return results ?? [];
}

async function unfinishedTradeLineCount(db: Db, line: ProgressLine): Promise<number> {
  const subSql = isBuiltIn(line) ? "" : " AND prod.sub_category = ?";
  const row = await db.prepare(
    `SELECT count(*)::int AS remaining
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       LEFT JOIN project_line_progress lp ON lp.so_item_id = i.id
       ${SO_LINE_CATEGORY_JOIN}
      WHERE so.project_id = ? AND ${LIVE_BOARD_LINE} AND cg.code = ?${subSql}
        AND coalesce(lp.done_qty, 0) < i.qty`,
  ).bind(...[line.project_id, line.cat_code, ...(isBuiltIn(line) ? [] : [line.sub_code])]).first<{ remaining: number }>();
  return Number(row?.remaining ?? 0);
}

async function completeTradeIfAllDone(db: Db, line: ProgressLine, actor: LineActor): Promise<TradeTaskRow[]> {
  if (await unfinishedTradeLineCount(db, line) > 0) return [];
  const openTasks = (await tradeTasksOf(db, line)).filter((task) => task.state !== "done");
  const completed: TradeTaskRow[] = [];
  for (const task of openTasks) {
    if (await completionRefusal(db, task)) continue;
    await markTaskDone(db, task.id, { userId: actor.userId, today: actor.today, note: null });
    completed.push(task);
  }
  return completed;
}

export type ReopenRefusal = "line_not_found" | "po_receipt";

export async function reopenLineTrade(db: Db, soItemId: string, actorCompanySql: string): Promise<{ projectId: number; reopenedTasks: TradeTaskRow[] } | ReopenRefusal> {
  const line = await loadProgressLine(db, soItemId, actorCompanySql);
  if (!line) return "line_not_found";
  const doneTasks = (await tradeTasksOf(db, line)).filter((task) => task.state === "done");
  for (const task of doneTasks) {
    if (await completionRefusal(db, task) === "po_task_completes_on_receipt") return "po_receipt";
  }
  for (const task of doneTasks) {
    await db.prepare(
      `UPDATE project_trade_tasks SET state = 'in_progress', done_at = NULL, done_by = NULL, actual_end = NULL, updated_at = now() WHERE id = ?`,
    ).bind(task.id).run();
  }
  return { projectId: line.project_id, reopenedTasks: doneTasks };
}

export function doneQtyRefusal(doneQty: number, lineQty: number): "invalid_qty" | null {
  return Number.isFinite(doneQty) && doneQty >= 0 && doneQty <= lineQty ? null : "invalid_qty";
}

async function writeDoneQty(db: Db, line: ProgressLine, doneQty: number, actor: LineActor): Promise<void> {
  if (doneQty === 0) {
    await db.prepare(`DELETE FROM project_line_progress WHERE so_item_id = ?::uuid`).bind(line.id).run();
    return;
  }
  await db.prepare(
    `INSERT INTO project_line_progress (so_item_id, project_id, company_id, done_qty, done_by_user_id, done_by_person_id)
     VALUES (?::uuid, ?, ?, ?, ?, ?)
     ON CONFLICT (so_item_id) DO UPDATE SET done_qty = excluded.done_qty, done_at = now(),
       done_by_user_id = excluded.done_by_user_id, done_by_person_id = excluded.done_by_person_id`,
  ).bind(line.id, line.project_id, line.company_id, doneQty, actor.userId, actor.personId).run();
}

export async function setLineDoneQty(db: Db, soItemId: string, doneQty: number, actor: LineActor): Promise<ProgressSaved | ProgressRefusal> {
  const line = await loadProgressLine(db, soItemId, actor.companySql, actor.brandName ?? null);
  if (!line) return "line_not_found";
  const lineQty = Number(line.qty);
  const previousDoneQty = Number(line.done_qty ?? 0);
  const refusal = doneQtyRefusal(doneQty, lineQty);
  if (refusal) return refusal;
  if (doneQty < previousDoneQty && (await tradeTasksOf(db, line)).some((task) => task.state === "done")) return "trade_complete";
  await writeDoneQty(db, line, doneQty, actor);
  const completedTasks = doneQty === lineQty ? await completeTradeIfAllDone(db, line, actor) : [];
  return { projectId: line.project_id, previousDoneQty, doneQty, completedTasks };
}
