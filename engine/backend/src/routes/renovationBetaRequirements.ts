import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess, requirePermission } from "../middleware/auth";
import { activeCompanyId, activeCompanySql } from "../scm/lib/companyScope";
import { todayMyt } from "../scm/lib/my-time";
import { isMissingRelation, type Db } from "../services/renovation/load";
import { reopenLineTrade, setLineDoneQty, type LineActor, type TradeTaskRow } from "../services/renovation/lineProgress";
import { loadCategoryScope } from "../services/categoryAccess";
import { isMissingColumn, loadRequirementBoard } from "../services/renovation/requirementBoard";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx): Db => c.env.DB as unknown as Db;

app.get("/requirements", requirePageAccess("projects.list"), async (c) => {
  try {
    return c.json(await loadRequirementBoard(db(c), { companySql: activeCompanySql(c, "p.company_id"), categoryScope: loadCategoryScope(db(c), c.get("user")), brandName: null }));
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

const PROGRESS_REFUSALS = {
  line_not_found: [404, "That line is not a Works or Built-in line of a live renovation project."],
  invalid_qty: [400, "Units done must be a number from 0 up to the line's qty."],
  trade_complete: [409, "This trade is already done, so its lines cannot go back. Saving a lower count on the line reopens it."],
  po_receipt: [409, "This trade was closed when its purchase order was received, so it cannot be reopened here."],
} as const;

const REOPEN_REFUSALS = {
  line_not_found: PROGRESS_REFUSALS.line_not_found,
  po_receipt: [409, "This trade was closed when its purchase order was received, so it cannot be reopened here."],
} as const;

async function logTradesReopened(c: Ctx, projectId: number, tasks: readonly TradeTaskRow[]): Promise<void> {
  for (const task of tasks) {
    await db(c).prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(projectId, "task_reopened", task.trade_code, "in_progress", "Reopened from the Renovation board", lineActor(c).userId, activeCompanyId(c) ?? 1).run();
  }
}

app.post("/requirements/lines/:soItemId/reopen", requirePermission("projects.write"), async (c) => {
  try {
    const outcome = await reopenLineTrade(db(c), c.req.param("soItemId"), lineActor(c).companySql);
    if (typeof outcome === "string") {
      const [status, message] = REOPEN_REFUSALS[outcome];
      return c.json({ error: outcome, message }, status);
    }
    await logTradesReopened(c, outcome.projectId, outcome.reopenedTasks);
    return c.json({ ok: true, reopenedTaskIds: outcome.reopenedTasks.map((task) => task.id) });
  } catch (error) {
    if (isMissingRelation(error) || isMissingColumn(error)) return c.json(TICKS_NOT_READY, 409);
    throw error;
  }
});

app.put("/requirements/lines/:soItemId/progress", requirePermission("projects.write"), async (c) => {
  const body = await c.req.json<{ doneQty?: unknown; shouldReopenTrade?: unknown }>().catch(() => ({ doneQty: undefined, shouldReopenTrade: undefined }));
  const doneQty = typeof body.doneQty === "number" ? body.doneQty : Number.NaN;
  try {
    const outcome = await setLineDoneQty(db(c), c.req.param("soItemId"), doneQty, lineActor(c), { shouldReopenTrade: body.shouldReopenTrade === true });
    if (typeof outcome === "string") {
      const [status, message] = PROGRESS_REFUSALS[outcome];
      return c.json({ error: outcome, message }, status);
    }
    if (outcome.reopenedTasks) await logTradesReopened(c, outcome.projectId, outcome.reopenedTasks);
    return c.json({
      ok: true, previousDoneQty: outcome.previousDoneQty, doneQty: outcome.doneQty, completedTaskIds: [],
      ...(outcome.reopenedTasks ? { didReopenTrade: true } : {}),
    });
  } catch (error) {
    if (isMissingRelation(error) || isMissingColumn(error)) return c.json(TICKS_NOT_READY, 409);
    throw error;
  }
});

export default app;
