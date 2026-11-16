import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { activeCompanySql } from "../scm/lib/companyScope";
import { todayMyt } from "../scm/lib/my-time";
import { isMissingRelation, type Db } from "../services/renovation/load";
import { setLineDoneQty, type LineActor, type ProgressRefusal } from "../services/renovation/lineProgress";
import { finishTrade, startTrade, type TradeRefusal } from "../services/renovation/tradeProgress";
import { isProofRefusal, parseProofPhotos } from "../services/renovation/lineProof";
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
  po_receipt: [409, "This trade was closed when its purchase order was received, so the office has to reopen it."],
  progress_not_ready: [409, "Line progress is not switched on yet on this server."],
};

const TRADE_REFUSALS: Readonly<Record<TradeRefusal, readonly [404 | 409, string]>> = {
  task_not_found: [404, "That trade is not one of your brand's projects."],
  trade_done: [409, "This trade is already finished."],
  trade_skipped: [409, "The office skipped this trade."],
  not_started: [409, "Start this trade first."],
};

const JOBS_NOT_READY = { error: "jobs_not_ready", message: "Jobs are not switched on yet on this server." } as const;

class JobsNotReadyError extends Error {}

const NOT_RENOVATOR = { error: "not_renovator", message: "Jobs are for Renovation staff." } as const;

const NO_BRAND = { error: "no_brand", message: "Your Renovation record has no brand yet. Ask the office to set it in Employee Master." } as const;

const database = (c: SiteForwardContext): Db => c.env.DB as unknown as Db;

async function brandNameOf(db: Db, userId: string): Promise<string | null> {
  try {
    const row = await db.prepare(`SELECT brand_name FROM public.conts_renovators WHERE user_id = ? LIMIT 1`).bind(userId).first<{ brand_name: string | null }>();
    return row?.brand_name?.trim() || null;
  } catch (error) {
    if (isMissingRelation(error)) throw new JobsNotReadyError();
    throw error;
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
    if (error instanceof JobsNotReadyError) return c.json(JOBS_NOT_READY, 409);
    if (isMissingRelation(error)) return c.json({ error: "progress_not_ready", message: REFUSALS.progress_not_ready[1] }, 409);
    console.error("[site-forward] jobs read failed", error);
    return c.json({ error: "renovation_read_failed", message: "The jobs could not be read. Try again." }, 500);
  }
});

app.put("/lines/:soItemId/progress", async (c) => {
  const body = await c.req.json<{ doneQty?: unknown; photos?: unknown }>().catch(() => ({ doneQty: undefined, photos: undefined }));
  const doneQty = typeof body.doneQty === "number" ? body.doneQty : Number.NaN;
  const refuse = (refusal: SiteForwardRefusal): Response => {
    const [status, message] = REFUSALS[refusal];
    return c.json({ error: refusal, message }, status);
  };
  try {
    const { userId, name } = c.get("staff");
    const brandName = await brandNameOf(database(c), userId);
    if (brandName === null) return c.json(NO_BRAND, 409);
    const photos = parseProofPhotos(body.photos);
    if (isProofRefusal(photos)) return c.json(photos, 400);
    const actor: LineActor = {
      userId: null,
      personId: null,
      posUserId: userId,
      companySql: activeCompanySql(c, "p.company_id"),
      brandName,
      today: todayMyt(),
    };
    const outcome = await setLineDoneQty(database(c), c.req.param("soItemId"), doneQty, actor, { proof: { photos, bucket: c.env.POD_BUCKET, by: name } });
    if (typeof outcome === "string") return refuse(outcome);
    return c.json({
      ok: true, previousDoneQty: outcome.previousDoneQty, doneQty: outcome.doneQty,
      completedTaskIds: [], photoCount: outcome.photoCount ?? photos.length,
    });
  } catch (error) {
    if (error instanceof JobsNotReadyError) return c.json(JOBS_NOT_READY, 409);
    if (isMissingRelation(error) || isMissingColumn(error)) return refuse("progress_not_ready");
    throw error;
  }
});

function tradeRoute(action: "start" | "finish"): void {
  app.post(`/trades/:taskId/${action}`, async (c) => {
    const body = await c.req.json<{ photos?: unknown }>().catch(() => ({ photos: undefined }));
    try {
      const { userId, name } = c.get("staff");
      const brandName = await brandNameOf(database(c), userId);
      if (brandName === null) return c.json(NO_BRAND, 409);
      const taskId = Number(c.req.param("taskId"));
      const photos = parseProofPhotos(body.photos);
      if (isProofRefusal(photos)) return c.json(photos, 400);
      const actor: LineActor = { userId: null, personId: null, posUserId: userId, companySql: activeCompanySql(c, "p.company_id"), brandName, today: todayMyt() };
      const proof = { photos, bucket: c.env.POD_BUCKET, by: name };
      const outcome = !Number.isInteger(taskId) || taskId < 1 ? "task_not_found"
        : action === "start" ? await startTrade(database(c), taskId, actor, proof) : await finishTrade(database(c), taskId, actor, proof);
      if (typeof outcome === "string") {
        const [status, message] = TRADE_REFUSALS[outcome];
        return c.json({ error: outcome, message }, status);
      }
      return c.json({ ok: true, ...outcome });
    } catch (error) {
      if (error instanceof JobsNotReadyError) return c.json(JOBS_NOT_READY, 409);
      throw error;
    }
  });
}

tradeRoute("start");
tradeRoute("finish");

export default app;
