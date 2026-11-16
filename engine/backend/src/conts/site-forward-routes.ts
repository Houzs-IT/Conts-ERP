import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { activeCompanyId, activeCompanySql } from "../scm/lib/companyScope";
import { todayMyt } from "../scm/lib/my-time";
import { isMissingRelation, type Db } from "../services/renovation/load";
import { setLineDoneQty, type LineActor, type ProgressRefusal, type TradeTaskRow } from "../services/renovation/lineProgress";
import { isMissingColumn, loadRequirementBoard } from "../services/renovation/requirementBoard";
import type { Staff } from "./staff-identity";

interface SiteForwardVariables {
  staff: Staff;
}

type SiteForwardContext = Context<{ Bindings: Env; Variables: SiteForwardVariables }>;

type SiteForwardRefusal = ProgressRefusal | "progress_not_ready";

const REFUSALS: Readonly<Record<SiteForwardRefusal, readonly [400 | 404 | 409, string]>> = {
  line_not_found: [404, "That line is not one of your brand's Works or Built-in lines."],
  invalid_qty: [400, "Units done must be a number from 0 up to the line's qty."],
  trade_complete: [409, "This trade is closed, so its lines cannot go back. The office can reopen it."],
  progress_not_ready: [409, "Line progress is not switched on yet on this server."],
};

const NOT_RENOVATOR = { error: "not_renovator", message: "Jobs are for Renovation staff." } as const;

const NO_BRAND = { error: "no_brand", message: "Your Renovation record has no brand yet. Ask the office to set it in Employee Master." } as const;

const database = (c: SiteForwardContext): Db => c.env.DB as unknown as Db;

async function brandNameOf(db: Db, userId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT brand_name FROM public.conts_renovators WHERE user_id = ? LIMIT 1`).bind(userId).first<{ brand_name: string | null }>();
  return row?.brand_name?.trim() || null;
}

async function personIdOf(db: Db, userId: string, companyId: number): Promise<number | null> {
  const row = await db.prepare(`SELECT id::int AS id FROM project_people WHERE company_id = ? AND pos_user_id = ? LIMIT 1`).bind(companyId, userId).first<{ id: number }>();
  return row?.id ?? null;
}

async function logTradesDone(db: Db, projectId: number, tasks: readonly TradeTaskRow[], companyId: number): Promise<void> {
  for (const task of tasks) {
    await db.prepare(`INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(projectId, "task_done", task.trade_code, "done", "Every line ticked on the phone", null, companyId).run();
  }
}

const app = new Hono<{ Bindings: Env; Variables: SiteForwardVariables }>();

app.use("*", async (c, next) => {
  if (c.get("staff").role !== "renovator") return c.json(NOT_RENOVATOR, 403);
  await next();
});

app.get("/jobs", async (c) => {
  try {
    const brandName = await brandNameOf(database(c), c.get("staff").userId);
    if (brandName === null) return c.json(NO_BRAND, 409);
    const board = await loadRequirementBoard(database(c), { companySql: activeCompanySql(c, "p.company_id"), categoryScope: null, brandName });
    return c.json({ brand: brandName, areTicksReady: board.areTicksReady, projects: board.projects.filter((project) => project.lines.length > 0) });
  } catch (error) {
    if (isMissingRelation(error)) return c.json({ error: "progress_not_ready", message: REFUSALS.progress_not_ready[1] }, 409);
    console.error("[site-forward] jobs read failed", error);
    return c.json({ error: "renovation_read_failed", message: "The jobs could not be read. Try again." }, 500);
  }
});

app.put("/lines/:soItemId/progress", async (c) => {
  const body = await c.req.json<{ doneQty?: unknown }>().catch(() => ({ doneQty: undefined }));
  const doneQty = typeof body.doneQty === "number" ? body.doneQty : Number.NaN;
  const refuse = (refusal: SiteForwardRefusal): Response => {
    const [status, message] = REFUSALS[refusal];
    return c.json({ error: refusal, message }, status);
  };
  try {
    const { userId } = c.get("staff");
    const brandName = await brandNameOf(database(c), userId);
    if (brandName === null) return c.json(NO_BRAND, 409);
    const companyId = activeCompanyId(c) ?? 1;
    const actor: LineActor = {
      userId: null,
      personId: await personIdOf(database(c), userId, companyId),
      companySql: activeCompanySql(c, "p.company_id"),
      brandName,
      today: todayMyt(),
    };
    const outcome = await setLineDoneQty(database(c), c.req.param("soItemId"), doneQty, actor);
    if (typeof outcome === "string") return refuse(outcome);
    await logTradesDone(database(c), outcome.projectId, outcome.completedTasks, companyId);
    return c.json({ ok: true, previousDoneQty: outcome.previousDoneQty, doneQty: outcome.doneQty, completedTaskIds: outcome.completedTasks.map((task) => task.id) });
  } catch (error) {
    if (isMissingRelation(error) || isMissingColumn(error)) return refuse("progress_not_ready");
    throw error;
  }
});

export default app;
