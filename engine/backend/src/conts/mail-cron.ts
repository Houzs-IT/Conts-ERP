// Conts only (not part of Houzs's code): the engine's email retries, run on request.
//
// Houzs retries failed emails from its own every-5-minute schedule (drainEmailOutbox in index.ts). This instance
// has no schedule (wrangler.production.toml), so Property OS's cron worker calls this route every 5 minutes instead
// (functions/_lib/cronJobs.ts, engineMailOutbox). Server to server only, proven by CONTS_CRON_SECRET; off (503)
// until that secret is set. Without RESEND_API_KEY nothing is ever queued, so there is nothing to retry.
import { Hono } from "hono";
import type { Env } from "../types";
import { drainEmailOutbox } from "../services/email";

type ContsEnv = Env & { CONTS_CRON_SECRET?: string };

/** Constant-time compare, as mail-inbound.ts does for its secret. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const app = new Hono<{ Bindings: ContsEnv }>();

/** POST /api/conts-cron/mail-outbox -> { processed, sent, failed } */
app.post("/mail-outbox", async (c) => {
  const secret = c.env.CONTS_CRON_SECRET ?? "";
  if (secret.length < 16) return c.json({ error: "scheduled mail not configured" }, 503);
  const header = c.req.header("Authorization") ?? "";
  if (!same(header.startsWith("Bearer ") ? header.slice(7) : "", secret)) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await drainEmailOutbox(c.env));
});

export default app;
