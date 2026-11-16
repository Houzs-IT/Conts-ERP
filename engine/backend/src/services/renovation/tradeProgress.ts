import type { Db, DbStmt } from "./load";
import { personIdOf, runTogether, tradeDoneLogStatements, type LineActor, type TradeTaskRow } from "./lineProgress";
import { proofRowsStatement, storeProofFiles, type LineProof } from "./lineProof";
import { BUILT_IN_TASK_CATEGORY, LIVE_BOARD_LINE, SO_LINE_CATEGORY_JOIN } from "./requirementBoard";
import { completionRefusal, markTaskDoneStatement, startTaskStatement } from "./taskCompletion";

export type TradeRefusal = "task_not_found" | "trade_done" | "trade_skipped" | "not_started";

export interface TradeTask extends TradeTaskRow {
  project_id: number;
  company_id: number;
  category_code: string | null;
  actual_start: string | null;
}

export interface TradeStarted {
  startedOn: string;
}

export interface TradeFinished {
  linesCompleted: number;
  closedTaskIds: number[];
  waitingForReceipt: boolean;
}

interface UnfinishedLine {
  id: string;
  qty: number | string;
}

const isBuiltInTask = (task: Pick<TradeTask, "category_code">): boolean => task.category_code === BUILT_IN_TASK_CATEGORY;

async function loadBrandTask(db: Db, taskId: number, actor: LineActor): Promise<TradeTask | null> {
  const task = await db.prepare(
    `SELECT t.id::int AS id, t.project_id::int AS project_id, p.company_id::int AS company_id, t.trade_code, t.category_code,
            t.fulfilment_kind, t.state, t.actual_start::text AS actual_start
       FROM project_trade_tasks t
       JOIN projects p ON p.id = t.project_id
      WHERE t.id = ? AND p.project_kind = 'renovation' AND p.archived_at IS NULL${actor.companySql} AND lower(trim(p.brand)) = lower(trim(?))`,
  ).bind(taskId, actor.brandName ?? null).first<TradeTask>();
  if (!task) return null;
  return isBuiltInTask(task) || !task.trade_code.includes(":") ? task : null;
}

async function tradeTasksOf(db: Db, task: TradeTask): Promise<TradeTask[]> {
  const matchSql = isBuiltInTask(task) ? "t.category_code = ?" : "t.trade_code = ?";
  const { results } = await db.prepare(
    `SELECT t.id::int AS id, t.project_id::int AS project_id, ?::int AS company_id, t.trade_code, t.category_code,
            t.fulfilment_kind, t.state, t.actual_start::text AS actual_start
       FROM project_trade_tasks t
      WHERE t.project_id = ? AND t.state <> 'skipped' AND ${matchSql} ORDER BY t.seq`,
  ).bind(task.company_id, task.project_id, isBuiltInTask(task) ? BUILT_IN_TASK_CATEGORY : task.trade_code).all<TradeTask>();
  return results ?? [];
}

async function unfinishedLinesOf(db: Db, task: TradeTask): Promise<UnfinishedLine[]> {
  const subSql = isBuiltInTask(task) ? "" : " AND prod.sub_category = ?";
  const { results } = await db.prepare(
    `SELECT i.id::text AS id, i.qty
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
       LEFT JOIN project_line_progress lp ON lp.so_item_id = i.id
       ${SO_LINE_CATEGORY_JOIN}
      WHERE so.project_id = ? AND ${LIVE_BOARD_LINE} AND cg.code = ?${subSql}
        AND coalesce(lp.done_qty, 0) < i.qty`,
  ).bind(...[task.project_id, isBuiltInTask(task) ? "BUILTIN" : "WORKS", ...(isBuiltInTask(task) ? [] : [task.trade_code])]).all<UnfinishedLine>();
  return results ?? [];
}

const hasStarted = (task: TradeTask): boolean => task.state === "in_progress" || task.state === "done" || task.actual_start !== null;

type LoadedTrade = { task: TradeTask; tasks: TradeTask[] } | TradeRefusal;

async function loadTrade(db: Db, taskId: number, actor: LineActor): Promise<LoadedTrade> {
  const task = await loadBrandTask(db, taskId, actor);
  if (!task) return "task_not_found";
  if (task.state === "skipped") return "trade_skipped";
  const tasks = await tradeTasksOf(db, task);
  if (tasks.every((sibling) => sibling.state === "done")) return "trade_done";
  return { task, tasks };
}

export async function startTrade(db: Db, taskId: number, actor: LineActor, proof: LineProof): Promise<TradeStarted | TradeRefusal> {
  const trade = await loadTrade(db, taskId, actor);
  if (typeof trade === "string") return trade;
  const { task, tasks } = trade;
  const files = await storeProofFiles(proof, task.project_id, { stage: "start" });
  await runTogether(db, [
    ...tasks.filter((candidate) => !hasStarted(candidate)).map((sibling) => startTaskStatement(db, sibling.id, actor.today)),
    proofRowsStatement(db, task.project_id, task.company_id, { kind: "task", taskId: task.id }, files),
  ]);
  const earliest = tasks.map((sibling) => sibling.actual_start?.slice(0, 10)).filter((day): day is string => Boolean(day)).sort().at(0);
  return { startedOn: earliest ?? actor.today };
}

const fullQtyStatement = (db: Db, task: TradeTask, lines: readonly UnfinishedLine[], actor: LineActor, personId: number | null): DbStmt => db.prepare(
  `INSERT INTO project_line_progress (so_item_id, project_id, company_id, done_qty, done_by_user_id, done_by_person_id)
   SELECT x.id::uuid, ?, ?, x.qty::numeric, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, qty text)
   ON CONFLICT (so_item_id) DO UPDATE SET done_qty = excluded.done_qty, done_at = now(),
     done_by_user_id = excluded.done_by_user_id, done_by_person_id = excluded.done_by_person_id`,
).bind(task.project_id, task.company_id, actor.userId, personId, JSON.stringify(lines.map((line) => ({ id: line.id, qty: String(line.qty) }))));

export async function finishTrade(db: Db, taskId: number, actor: LineActor, proof: LineProof): Promise<TradeFinished | TradeRefusal> {
  const trade = await loadTrade(db, taskId, actor);
  if (typeof trade === "string") return trade;
  const { task, tasks } = trade;
  if (!tasks.some(hasStarted)) return "not_started";
  const lines = await unfinishedLinesOf(db, task);
  const personId = actor.personId ?? (actor.posUserId ? await personIdOf(db, actor.posUserId, task.company_id) : null);
  const closing: TradeTask[] = [];
  let waitingForReceipt = false;
  for (const sibling of tasks.filter((candidate) => candidate.state !== "done")) {
    if (await completionRefusal(db, sibling) === "po_task_completes_on_receipt") waitingForReceipt = true;
    else closing.push(sibling);
  }
  const files = await storeProofFiles(proof, task.project_id, { stage: "finish" });
  await runTogether(db, [
    ...(lines.length > 0 ? [fullQtyStatement(db, task, lines, actor, personId)] : []),
    ...closing.map((sibling) => markTaskDoneStatement(db, sibling.id, { userId: actor.userId, today: actor.today, note: null })),
    proofRowsStatement(db, task.project_id, task.company_id, { kind: "task", taskId: task.id }, files),
    ...tradeDoneLogStatements(db, task.project_id, closing, task.company_id, actor.userId, `Finished on the phone by ${proof.by}`),
  ]);
  return { linesCompleted: lines.length, closedTaskIds: closing.map((sibling) => sibling.id), waitingForReceipt };
}
