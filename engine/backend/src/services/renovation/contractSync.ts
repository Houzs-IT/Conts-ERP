/* What a renovation project writes when its contract's lines change.

   Stage views (auto-skip, re-open) are derived on every read (stages.ts), so a
   variation order that adds or removes furniture needs no stage write. Two
   things ARE stored and go stale without a write:
     - projects.reno_stage / projects.stage: the cached current stage that the
       board's sort and the old exhibition lists and calendar read;
     - project_trade_tasks: one task per WORKS trade, auto-skipped when a VO
       omits all its lines and re-opened when a VO brings them back.
   syncTradeTasks and refreshCachedStage are the same code the
   /api/renovation routes run; onContractLinesChanged runs both after phase 2
   converts a quotation or applies a VO (scm/lib/renovation-hooks.ts). */

import { RENO_STAGES, type StageKey } from "../../scm/shared/renovation-stages";
import { todayMyt } from "../../scm/lib/my-time";
import { loadProjectRows, loadRenovationFacts, type Db, type ProjectFacts } from "./load";
import { planTradeTasks, type WorksLine } from "./tradeTasks";
import { computeProjectView } from "./view";
import { syncProjectDates } from "./projectDates";

/** Legacy `projects.stage` kept meaningful for the exhibition calendar and lists. */
export function legacyStageOf(stage: StageKey): "draft" | "setup" | "completed" {
  if (stage === "design" || stage === "key_permit" || stage === "defect_check" || stage === "shop_drawings") return "draft";
  if (stage === "warranty" || stage === "closed") return "completed";
  return "setup";
}

export async function writeCachedStage(db: Db, projectId: number, facts: ProjectFacts): Promise<StageKey> {
  const today = todayMyt();
  const view = computeProjectView(facts, today);
  const cur = view.currentStage;
  await syncProjectDates(db, facts, view, today);
  await db.prepare(`UPDATE projects SET reno_stage = ?, stage = ?, updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`)
    .bind(cur, legacyStageOf(cur), projectId).run();
  return cur;
}

export interface SyncResult { created: number; refreshed: number; skipped: number; reopened: number }

/** Create / refresh / auto-skip / re-open trade tasks from the contract's WORKS lines. Null when the lines cannot be read. */
export async function syncTradeTasks(db: Db, projectId: number, f: ProjectFacts): Promise<SyncResult | null> {
  if (f.allLines === null) return null;
  const poBySoItem = new Map<string, (typeof f.poLines)[number]>();
  for (const pl of f.poLines) if (!poBySoItem.has(pl.so_item_id)) poBySoItem.set(pl.so_item_id, pl);
  const works: WorksLine[] = f.allLines
    .filter((l) => l.group === "WORKS")
    .map((l) => {
      const pl = poBySoItem.get(l.soItemId);
      return { soItemId: l.soItemId, trade: l.subCategory, omitted: l.omitted, poItemId: pl?.id ?? null, poId: pl?.purchase_order_id ?? null, supplierId: pl?.supplier_id ?? l.supplierId ?? null };
    });
  const typeKeys = f.type?.stage_keys ?? [...RENO_STAGES];
  const plan = planTradeTasks({ works, existing: f.tasks, typeStageKeys: typeKeys });
  const co = Number(f.project.company_id);
  const stmts: ReturnType<Db["prepare"]>[] = [];
  for (const t of plan.create) {
    stmts.push(db.prepare(
      `WITH t AS (
         INSERT INTO project_trade_tasks (project_id, stage_key, trade_code, fix_phase, label, seq, fulfilment_kind, supplier_id, purchase_order_id, company_id, category_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?::uuid, ?::uuid, ?, ?)
         ON CONFLICT (project_id, trade_code, fix_phase, occurrence) DO NOTHING
         RETURNING id
       )
       INSERT INTO project_trade_task_lines (task_id, so_item_id, purchase_order_item_id, company_id)
       SELECT t.id, x.so_item_id::uuid, x.po_item_id::uuid, ? FROM t, jsonb_to_recordset(?::text::jsonb) AS x(so_item_id text, po_item_id text)
       ON CONFLICT (task_id, so_item_id) DO NOTHING`,
    ).bind(projectId, t.stageKey, t.tradeCode, t.fixPhase, t.label, t.seq, t.fulfilmentKind, t.supplierId, t.purchaseOrderId, co, t.categoryCode,
      co, JSON.stringify(t.lines.map((l) => ({ so_item_id: l.soItemId, po_item_id: l.poItemId })))));
  }
  for (const t of plan.refresh) {
    stmts.push(db.prepare(
      /* an in-house task (switched to our own crew) never gets a PO or supplier back from the contract */
      `UPDATE project_trade_tasks
          SET supplier_id = CASE WHEN fulfilment_kind = 'po' THEN coalesce(supplier_id, ?::uuid) ELSE supplier_id END,
              purchase_order_id = CASE WHEN fulfilment_kind = 'po' THEN coalesce(?::uuid, purchase_order_id) ELSE purchase_order_id END,
              category_code = coalesce(category_code, ?), updated_at = now()
        WHERE id = ?`,
    ).bind(t.supplierId, t.purchaseOrderId, t.categoryCode, t.id));
    stmts.push(db.prepare(
      `INSERT INTO project_trade_task_lines (task_id, so_item_id, purchase_order_item_id, company_id)
       SELECT ?, x.so_item_id::uuid, x.po_item_id::uuid, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(so_item_id text, po_item_id text)
       ON CONFLICT (task_id, so_item_id) DO UPDATE SET purchase_order_item_id = coalesce(EXCLUDED.purchase_order_item_id, project_trade_task_lines.purchase_order_item_id)`,
    ).bind(t.id, co, JSON.stringify(t.lines.map((l) => ({ so_item_id: l.soItemId, po_item_id: l.poItemId })))));
  }
  for (const tid of plan.autoSkip) {
    stmts.push(db.prepare(
      `UPDATE project_trade_tasks SET state = 'skipped', skip_source = 'vo_omitted', skip_reason = 'All lines omitted by a variation order', skipped_at = now(), skipped_by = NULL, updated_at = now() WHERE id = ? AND state NOT IN ('done', 'skipped')`,
    ).bind(tid));
  }
  for (const tid of plan.reopen) {
    stmts.push(db.prepare(
      `UPDATE project_trade_tasks SET state = 'open', skip_source = NULL, skip_reason = NULL, skipped_at = NULL, skipped_by = NULL, updated_at = now() WHERE id = ? AND skip_source = 'vo_omitted'`,
    ).bind(tid));
  }
  if (stmts.length > 0) {
    if (db.batch) await db.batch(stmts);
    else for (const s of stmts) await s.run();
  }
  return { created: plan.create.length, refreshed: plan.refresh.length, skipped: plan.autoSkip.length, reopened: plan.reopen.length };
}

/** After phase 2 changed a renovation contract's lines: sync its project's trade tasks, then its cached stage. */
export async function onContractLinesChanged(db: Db, soDocNo: string): Promise<void> {
  const so = await db.prepare(`SELECT project_id::int AS project_id FROM scm.mfg_sales_orders WHERE doc_no = ? AND so_kind = 'RENOVATION' AND project_id IS NOT NULL`)
    .bind(soDocNo).first<{ project_id: number }>();
  if (!so) return;
  const projectId = Number(so.project_id);
  const rows = await loadProjectRows(db, "", { projectId, includeArchived: true });
  if (rows.length === 0) return;
  const facts = (await loadRenovationFacts(db, rows)).get(projectId)!;
  await syncTradeTasks(db, projectId, facts);
  await writeCachedStage(db, projectId, facts); // the current stage reads stage views only, which tasks do not change
}
