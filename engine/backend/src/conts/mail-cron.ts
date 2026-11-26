// Conts only (not part of Houzs's code): the engine's scheduled Mail Center work, run on request.
//
// Houzs runs these from its own schedules in index.ts: every 5 minutes the email retry (drainEmailOutbox), then the
// Resend Message-ID backfill for outbound Mail Center rows (backfillOutboundMessageIds) and the Delivered / Bounced
// check (refreshOutboundDelivery); every 30 minutes the 48-hour acknowledgement chase (runMailAckEscalation). This
// instance has no schedule (wrangler.production.toml), so Property OS's cron worker calls this route every 5 minutes
// instead (functions/_lib/cronJobs.ts, engineMailOutbox). Server to server only, proven by CONTS_CRON_SECRET; off
// (503) until that secret is set. Without RESEND_API_KEY nothing is ever queued and Resend is never asked.
//
// The acknowledgement chase runs on every call: it is idempotent (each message is chased once, then stamped
// ack_escalated_at), so 5 minutes instead of Houzs's 30 only means an overdue chase goes out up to 25 minutes sooner.
// Each step is isolated: one failing never stops the next, and the reply keeps the { processed, sent, failed } shape
// the cron worker reads.
import { Hono } from "hono";
import type { Env } from "../types";
import { drainEmailOutbox } from "../services/email";
import { backfillOutboundMessageIds } from "../lib/mail-threading";
import { DELIVERY_REFRESH_LIMIT, refreshOutboundDelivery } from "../lib/mail-delivery";
import { runMailAckEscalation } from "../lib/mail-acks";

type ContsEnv = Env & { CONTS_CRON_SECRET?: string };

/** Constant-time compare, as mail-inbound.ts does for its secret. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (e) {
    console.error(`[conts-cron ${name}]`, e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const app = new Hono<{ Bindings: ContsEnv }>();

/** POST /api/conts-cron/mail-outbox -> { processed, sent, failed, messageIds, delivery, acks } */
app.post("/mail-outbox", async (c) => {
  const secret = c.env.CONTS_CRON_SECRET ?? "";
  if (secret.length < 16) return c.json({ error: "scheduled mail not configured" }, 503);
  const header = c.req.header("Authorization") ?? "";
  if (!same(header.startsWith("Bearer ") ? header.slice(7) : "", secret)) return c.json({ error: "Unauthorized" }, 401);
  const outbox = await step("email-outbox", () => drainEmailOutbox(c.env));
  const messageIds = await step("mail-message-ids", () => backfillOutboundMessageIds(c.env.DB, c.env, null, 10));
  const delivery = await step("mail-delivery", () => refreshOutboundDelivery(c.env.DB, c.env, DELIVERY_REFRESH_LIMIT, Date.now()));
  const acks = await step("mail-ack-escalation", () => runMailAckEscalation(c.env));
  const counts = "error" in outbox ? { processed: 0, sent: 0, failed: 0 } : outbox;
  return c.json({ ...counts, messageIds, delivery, acks });
});

export default app;
