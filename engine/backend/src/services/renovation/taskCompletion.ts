import type { Db, DbStmt } from "./load";

export interface CompletableTask {
  id: number;
  fulfilment_kind: string;
  state: string;
}

export interface CompletionActor {
  userId: number | null;
  today: string;
  note: string | null;
}

export type CompletionRefusal = "po_task_completes_on_receipt" | "task_skipped";

export async function completionRefusal(db: Db, task: CompletableTask): Promise<CompletionRefusal | null> {
  if (task.fulfilment_kind === "po") {
    const linked = await db.prepare(`SELECT 1 AS x FROM project_trade_task_lines WHERE task_id = ? AND purchase_order_item_id IS NOT NULL LIMIT 1`)
      .bind(task.id).first();
    if (linked) return "po_task_completes_on_receipt";
  }
  return task.state === "skipped" ? "task_skipped" : null;
}

export const markTaskDoneStatement = (db: Db, taskId: number, actor: CompletionActor): DbStmt => db.prepare(
  `UPDATE project_trade_tasks SET state = 'done', actual_start = coalesce(actual_start, ?::date), actual_end = ?::date,
          done_by = ?, done_at = now(), notes = coalesce(?, notes), updated_at = now() WHERE id = ? AND state <> 'done'`,
).bind(actor.today, actor.today, actor.userId, actor.note, taskId);

export async function markTaskDone(db: Db, taskId: number, actor: CompletionActor): Promise<void> {
  await markTaskDoneStatement(db, taskId, actor).run();
}

export const startTaskStatement = (db: Db, taskId: number, today: string): DbStmt => db.prepare(
  `UPDATE project_trade_tasks SET state = 'in_progress', actual_start = coalesce(actual_start, ?::date), updated_at = now()
    WHERE id = ? AND state NOT IN ('done', 'skipped')`,
).bind(today, taskId);

export async function startTask(db: Db, taskId: number, today: string): Promise<void> {
  await startTaskStatement(db, taskId, today).run();
}
