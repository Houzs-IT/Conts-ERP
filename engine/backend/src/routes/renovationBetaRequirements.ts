import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanyId, activeCompanySql } from "../scm/lib/companyScope";
import { todayMyt } from "../scm/lib/my-time";
import { isMissingRelation, type Db } from "../services/renovation/load";
import { setLineDoneQty, type LineActor, type TradeTaskRow } from "../services/renovation/lineProgress";
import { loadCategoryScope } from "../services/categoryAccess";
import {
  LIVE_BOARD_LINE, REQUIREMENT_LINE_LIMIT, SO_LINE_CATEGORY_JOIN, buildRequirementBoard, type RequirementLineRow, type LineTickRow, type RequirementProjectRow, type TradePlanRow,
} from "../services/renovation/requirementBoard";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx): Db => c.env.DB as unknown as Db;

const LIVE_RENOVATION_PROJECTS = (companyScope: string): string =>
  `p.project_kind = 'renovation' AND p.archived_at IS NULL${companyScope}`;

const PROJECTS_SQL = (companyScope: string): string =>
  `SELECT p.id::int AS project_id, p.code AS project_code, p.name AS project_name, p.brand
     FROM projects p
    WHERE ${LIVE_RENOVATION_PROJECTS(companyScope)}
    ORDER BY p.code`;

const LINES_SQL = (companyScope: string): string =>
  `SELECT i.id::text AS id, p.id::int AS project_id, i.item_code, i.description, i.remark, i.qty, i.uom,
          coalesce(nullif(trim(to_jsonb(i)->>'room'), ''), nullif(trim((SELECT l.room FROM scm.reno_doc_lines l WHERE l.so_item_id = i.id LIMIT 1)), ''), nullif(trim(i.location), '')) AS room,
          cg.code AS cat_code, sc.code AS sub_code, sc.label AS sub_label,
          EXISTS (SELECT 1 FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                   WHERE pi.so_item_id = i.id AND po.status::text <> 'CANCELLED') AS is_on_po,
          plan.deliver_on::text AS deliver_on
     FROM scm.mfg_sales_order_items i
     JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
     JOIN projects p ON p.id = so.project_id
     LEFT JOIN scm.reno_beta_line_plans plan ON plan.so_item_id = i.id
     ${SO_LINE_CATEGORY_JOIN}
    WHERE ${LIVE_RENOVATION_PROJECTS(companyScope)} AND ${LIVE_BOARD_LINE}
    ORDER BY p.code, so.so_date NULLS LAST, i.doc_no, i.line_no NULLS LAST
    LIMIT ${REQUIREMENT_LINE_LIMIT}`;

const PLANS_SQL = (companyScope: string): string =>
  `SELECT t.id::int AS id, t.project_id::int AS project_id, t.trade_code, t.category_code, t.label, t.state, t.fulfilment_kind,
          t.planned_start::text AS planned_start, t.planned_end::text AS planned_end,
          t.actual_start::text AS actual_start, t.actual_end::text AS actual_end,
          (EXISTS (SELECT 1 FROM project_trade_task_lines l WHERE l.task_id = t.id AND l.purchase_order_item_id IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM project_trade_task_lines l JOIN scm.purchase_order_items poi ON poi.id = l.purchase_order_item_id
                             WHERE l.task_id = t.id AND poi.received_qty < poi.qty)) AS po_fully_received
     FROM project_trade_tasks t
     JOIN projects p ON p.id = t.project_id
    WHERE ${LIVE_RENOVATION_PROJECTS(companyScope)} AND t.state <> 'skipped' AND t.trade_code NOT LIKE 'INTERNAL:%'
    ORDER BY t.project_id, t.seq`;

const TICKS_SQL = (companyScope: string): string =>
  `SELECT lp.so_item_id::text AS so_item_id, lp.done_at::text AS done_at, lp.done_qty
     FROM project_line_progress lp
     JOIN projects p ON p.id = lp.project_id
    WHERE ${LIVE_RENOVATION_PROJECTS(companyScope)}`;

const isMissingColumn = (error: unknown): boolean => (error as { code?: string } | null)?.code === "42703";

async function readTicks(database: Db, companyScope: string): Promise<LineTickRow[] | null> {
  try {
    return (await database.prepare(TICKS_SQL(companyScope)).all<LineTickRow>()).results ?? [];
  } catch (error) {
    if (isMissingRelation(error) || isMissingColumn(error)) return null;
    throw error;
  }
}

app.get("/requirements", requirePageAccess("projects.list"), async (c) => {
  try {
    const companyScope = activeCompanySql(c, "p.company_id");
    const [projects, lines, plans, ticks, scope] = await Promise.all([
      db(c).prepare(PROJECTS_SQL(companyScope)).all<RequirementProjectRow>(),
      db(c).prepare(LINES_SQL(companyScope)).all<RequirementLineRow>(),
      db(c).prepare(PLANS_SQL(companyScope)).all<TradePlanRow>(),
      readTicks(db(c), companyScope),
      loadCategoryScope(db(c), c.get("user")),
    ]);
    const rows = { projects: projects.results ?? [], lines: lines.results ?? [], plans: plans.results ?? [], ticks };
    return c.json(buildRequirementBoard(rows, scope, todayMyt()));
  } catch (error) {
    console.error("[renovation-beta] requirement board read failed", error);
    return c.json({ error: "renovation_read_failed", message: "The renovation lines could not be read. Try again." }, 500);
  }
});

const lineActor = (c: Ctx): LineActor => ({
  userId: Number(c.get("user").id) || null,
  personId: null,
  companySql: activeCompanySql(c, "p.company_id"),
  today: todayMyt(),
});

const TICKS_NOT_READY = { error: "progress_not_ready", message: "Line progress is not switched on yet on this server." } as const;

async function logTradesDone(c: Ctx, projectId: number, tasks: readonly TradeTaskRow[]): Promise<void> {
  for (const task of tasks) {
    await db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(projectId, "task_done", task.trade_code, "done", "Every line ticked", lineActor(c).userId, activeCompanyId(c) ?? 1).run();
  }
}

const PROGRESS_REFUSALS = {
  line_not_found: [404, "That line is not a Works or Built-in line of a live renovation project."],
  invalid_qty: [400, "Units done must be a number from 0 up to the line's qty."],
  trade_complete: [409, "This trade is already done, so its lines cannot go back. Reopen it on the project's Site tab first."],
} as const;

app.put("/requirements/lines/:soItemId/progress", requirePermission("projects.write"), async (c) => {
  const body = await c.req.json<{ doneQty?: unknown }>().catch(() => ({ doneQty: undefined }));
  const doneQty = typeof body.doneQty === "number" ? body.doneQty : Number.NaN;
  try {
    const outcome = await setLineDoneQty(db(c), c.req.param("soItemId"), doneQty, lineActor(c));
    if (typeof outcome === "string") {
      const [status, message] = PROGRESS_REFUSALS[outcome];
      return c.json({ error: outcome, message }, status);
    }
    await logTradesDone(c, outcome.projectId, outcome.completedTasks);
    return c.json({ ok: true, previousDoneQty: outcome.previousDoneQty, doneQty: outcome.doneQty, completedTaskIds: outcome.completedTasks.map((task) => task.id) });
  } catch (error) {
    if (isMissingRelation(error) || isMissingColumn(error)) return c.json(TICKS_NOT_READY, 409);
    throw error;
  }
});

export default app;
