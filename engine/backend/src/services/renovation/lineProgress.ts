import type { Db } from "./load";
import { BUILT_IN_TASK_CATEGORY, LIVE_BOARD_LINE, SO_LINE_CATEGORY_JOIN } from "./requirementBoard";
import { completionRefusal, markTaskDone } from "./taskCompletion";

export interface LineActor {
  userId: number | null;
  personId: number | null;
  companySql: string;
  today: string;
}

export interface TickedLine {
  id: string;
  project_id: number;
  company_id: number;
  cat_code: string;
  sub_code: string | null;
}

export interface TradeTaskRow {
  id: number;
  trade_code: string;
  fulfilment_kind: string;
  state: string;
}

export interface TickOutcome {
  projectId: number;
  completedTasks: TradeTaskRow[];
}

export type UntickRefusal = "line_not_found" | "trade_complete";

const isBuiltIn = (line: TickedLine): boolean => line.cat_code === "BUILTIN";

async function loadBoardLine(db: Db, soItemId: string, companySql: string): Promise<TickedLine | null> {
  return db.prepare(
    `SELECT i.id::text AS id, p.id::int AS project_id, p.company_id::int AS company_id, cg.code AS cat_code, prod.sub_category AS sub_code
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       JOIN projects p ON p.id = so.project_id
       ${SO_LINE_CATEGORY_JOIN}
      WHERE i.id::text = ? AND p.project_kind = 'renovation' AND p.archived_at IS NULL${companySql} AND ${LIVE_BOARD_LINE}`,
  ).bind(soItemId).first<TickedLine>();
}

async function tradeTasksOf(db: Db, line: TickedLine): Promise<TradeTaskRow[]> {
  const matchSql = isBuiltIn(line) ? "t.category_code = ?" : "t.trade_code = ?";
  const { results } = await db.prepare(
    `SELECT t.id::int AS id, t.trade_code, t.fulfilment_kind, t.state FROM project_trade_tasks t
      WHERE t.project_id = ? AND t.state <> 'skipped' AND ${matchSql} ORDER BY t.seq`,
  ).bind(line.project_id, isBuiltIn(line) ? BUILT_IN_TASK_CATEGORY : line.sub_code).all<TradeTaskRow>();
  return results ?? [];
}

async function untickedTradeLineCount(db: Db, line: TickedLine): Promise<number> {
  const subSql = isBuiltIn(line) ? "" : " AND prod.sub_category = ?";
  const row = await db.prepare(
    `SELECT count(*)::int AS remaining
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       ${SO_LINE_CATEGORY_JOIN}
      WHERE so.project_id = ? AND ${LIVE_BOARD_LINE} AND cg.code = ?${subSql}
        AND NOT EXISTS (SELECT 1 FROM project_line_progress lp WHERE lp.so_item_id = i.id)`,
  ).bind(...[line.project_id, line.cat_code, ...(isBuiltIn(line) ? [] : [line.sub_code])]).first<{ remaining: number }>();
  return Number(row?.remaining ?? 0);
}

async function completeTradeIfAllTicked(db: Db, line: TickedLine, actor: LineActor): Promise<TradeTaskRow[]> {
  if (await untickedTradeLineCount(db, line) > 0) return [];
  const openTasks = (await tradeTasksOf(db, line)).filter((task) => task.state !== "done");
  const completed: TradeTaskRow[] = [];
  for (const task of openTasks) {
    if (await completionRefusal(db, task)) continue;
    await markTaskDone(db, task.id, { userId: actor.userId, today: actor.today, note: null });
    completed.push(task);
  }
  return completed;
}

export async function tickLine(db: Db, soItemId: string, actor: LineActor): Promise<TickOutcome | "line_not_found"> {
  const line = await loadBoardLine(db, soItemId, actor.companySql);
  if (!line) return "line_not_found";
  await db.prepare(
    `INSERT INTO project_line_progress (so_item_id, project_id, company_id, done_by_user_id, done_by_person_id)
     VALUES (?::uuid, ?, ?, ?, ?) ON CONFLICT (so_item_id) DO NOTHING`,
  ).bind(line.id, line.project_id, line.company_id, actor.userId, actor.personId).run();
  return { projectId: line.project_id, completedTasks: await completeTradeIfAllTicked(db, line, actor) };
}

export async function untickLine(db: Db, soItemId: string, actor: LineActor): Promise<{ projectId: number } | UntickRefusal> {
  const line = await loadBoardLine(db, soItemId, actor.companySql);
  if (!line) return "line_not_found";
  if ((await tradeTasksOf(db, line)).some((task) => task.state === "done")) return "trade_complete";
  await db.prepare(`DELETE FROM project_line_progress WHERE so_item_id = ?::uuid`).bind(line.id).run();
  return { projectId: line.project_id };
}
