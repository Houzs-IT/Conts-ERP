import type { Db } from "./load";

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

export async function markTaskDone(db: Db, taskId: number, actor: CompletionActor): Promise<void> {
  await db.prepare(
    `UPDATE project_trade_tasks SET state = 'done', actual_start = coalesce(actual_start, ?::date), actual_end = ?::date,
            done_by = ?, done_at = now(), notes = coalesce(?, notes), updated_at = now() WHERE id = ?`,
  ).bind(actor.today, actor.today, actor.userId, actor.note, taskId).run();
}
