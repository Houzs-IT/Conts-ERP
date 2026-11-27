/**
 * AI Connector round 4d: the runs behind the morning brief (D1), urgent alerts (D2) and the Monday data gaps (D4).
 * Called by POST /api/mcp/proactive/tick (every 15 minutes from the cron worker, functions/_lib/cronJobs.ts
 * aiBriefTick) and by the person's own Preview / Send me a test brief (functions/api/ai-connector/brief/*).
 *
 * AS THE PERSON, ALWAYS. Each run issues the person a connector token of their own (client mcpc_morning_brief, five
 * minutes) and revokes it in `finally`. The token is checked like any AI app's (resolveAccessToken: active, a desk
 * account, approved or management), so someone switched off or no longer approved gets nothing. The brief is the
 * daily_brief tool through runToolAs (Monday: data_gaps too); the alert reads go through readAsPerson. Both are the same
 * readValue path as a question from Claude: the session middleware's module gate, then each handler's own checks, then
 * credential fields stripped. There is no service account, and arrears are only read for someone whose Finance level is
 * above No access.
 *
 * BOUNDED + IDEMPOTENT. At most maxBriefsPerTick briefs and maxPeoplePerTick alert checks per tick, a 20 s budget,
 * people one at a time. One brief per person per Malaysia day (the key "brief" is claimed before building); every alert
 * key at most once per person per day (claimed before sending). Emails go through the ERP's own outbox (notify.ts:
 * notification_log, Resend, retried by the scheduled job). Each one is logged in mcp_proactive_sends, never its body.
 */
import { type Env, nowIso, run } from './db';
import { notify } from './notify';
import { gateFor } from './mcpActionTools';
import { issueTokens, resolveAccessToken, revokeToken, type McpIdentity } from './mcpStore';
import { BRIEF_CLIENT_ID } from './mcpMore';
import { readAsPerson, runToolAs, type PersonRead } from './mcpServer';
import { parseQuickText } from './mcpVisibility';
import { originOf } from './mcpDiscovery';
import {
  PROACTIVE_CONFIG, alertsToSend, buildAlertEmail, buildBriefEmail, computeAlerts, debounceSince, isMonday, mytNow, pickTickWork, type MytNow,
} from './mcpProactive';
import {
  activeSubscribers, claimKeys, logSend, markAlertChecked, releaseKeys, sentKeys, unsubscribeToken, usersWithKey, type Subscriber,
} from './mcpProactiveStore';

type Obj = Record<string, unknown>;
type WaitUntil = (p: Promise<unknown>) => void;
export interface RunCtx { request: Request; env: Env; waitUntil: WaitUntil }
export interface Person { userId: string; name: string; email: string }

/** The token the brief runs on lives this long, and is revoked as soon as the run ends anyway. */
const TOKEN_TTL_MS = 5 * 60_000;

/** Links in emails: the address staff use (APP_ORIGIN) when set, else the address this request came in on. */
export function appOrigin(c: RunCtx): string {
  const configured = (c.env.APP_ORIGIN ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\//.test(configured) ? configured : originOf(c.request);
}
export const settingsUrl = (origin: string) => `${origin}/system/ai-connector`;
export const unsubscribeUrl = (origin: string, token: string) => (token ? `${origin}/api/mcp/proactive/unsubscribe?t=${encodeURIComponent(token)}` : '');

let clientReady = false;
/** The brief's own OAuth client row, so its calls show as "Morning brief" in Recent lookups. */
async function ensureBriefClient(env: Env): Promise<void> {
  if (clientReady) return;
  await run(env, `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, 'Morning brief', '[]', ?) ON CONFLICT (client_id) DO NOTHING`, BRIEF_CLIENT_ID, nowIso());
  clientReady = true;
}

/** Run `fn` with a fresh connector token of the person's own; always revoked afterwards. Null when the AI Connector
 *  would not let them in right now (switched off, approval removed, not a desk account). */
export async function withPersonToken<T>(c: RunCtx, userId: string, fn: (id: McpIdentity, token: string) => Promise<T>): Promise<T | null> {
  await ensureBriefClient(c.env);
  const tok = await issueTokens(c.env, userId, BRIEF_CLIENT_ID, TOKEN_TTL_MS);
  try {
    const id = await resolveAccessToken(c.env, tok.accessToken);
    if (!id) return null;
    return await fn(id, tok.accessToken);
  } finally {
    await revokeToken(c.env, tok.tokenId, null).catch(() => 0);
  }
}

/** A quick answer's JSON: structuredContent when present, else the text parsed. */
function answerValue(r: { content: { text: string }[]; structuredContent?: Obj; isError?: boolean }): { ok: true; value: Obj } | { ok: false; message: string } {
  const t = r.content[0]?.text ?? '';
  if (r.isError) return { ok: false, message: t.slice(0, 200) };
  const sc = r.structuredContent;
  if (sc && !(Object.keys(sc).length === 1 && 'text' in sc)) return { ok: true, value: sc };
  const q = parseQuickText(t);
  return q ? { ok: true, value: q } : { ok: false, message: 'the answer could not be read' };
}

export type BuiltBrief = { ok: true; subject: string; html: string; text: string; items: number } | { ok: false; message: string };

/** The brief AS THE PERSON: daily_brief (+ data_gaps when asked) through runToolAs, then the email. */
export async function buildBrief(c: RunCtx, p: Person, id: McpIdentity, token: string, now: MytNow, opts: { withGaps: boolean; test?: boolean }): Promise<BuiltBrief> {
  const b = answerValue(await runToolAs(c.request, c.env, c.waitUntil, id, token, 'daily_brief', {}));
  if (!b.ok) return { ok: false, message: `daily_brief: ${b.message}` };
  let gaps: Obj | null = null;
  if (opts.withGaps) {
    const g = answerValue(await runToolAs(c.request, c.env, c.waitUntil, id, token, 'data_gaps', {}));
    gaps = g.ok ? g.value : null; // no access to any of its lists: no gaps section
  }
  const origin = appOrigin(c);
  const mail = buildBriefEmail({
    brief: b.value, gaps, name: p.name, date: now.day, test: opts.test,
    settingsUrl: settingsUrl(origin), unsubscribeUrl: unsubscribeUrl(origin, await unsubscribeToken(c.env, p.userId)),
  });
  return { ok: true, ...mail };
}

/** One email through the ERP's outbox. `urgent`: the person chose this time themselves (and alerts run 07:00-20:00),
 *  so the 22:00-08:00 quiet hours meant for guests and owners do not hold it back. */
export async function sendEmail(env: Env, x: { template: string; to: string; userId: string; key: string; subject: string; text: string; html: string }) {
  return notify(env, {
    template: x.template, recipient: x.to, channel: 'email', subject: x.subject, body: x.text, html: x.html,
    entityTable: 'mcp_brief_subscriptions', entityId: x.userId, urgent: true, idempotencyKey: x.key,
  });
}

export type PersonResult = { skipped?: string; brief?: 'sent' | 'queued' | 'failed' | 'already'; alerts?: number; alertError?: string };

/** One person on one tick: the brief if due, then the alert check if due. Never throws. */
export async function runPerson(c: RunCtx, s: Subscriber, now: MytNow, wantBrief: boolean, wantAlerts: boolean): Promise<PersonResult> {
  const out: PersonResult = {};
  const person: Person = { userId: s.userId, name: s.name, email: s.email };
  const done = await withPersonToken(c, s.userId, async (id, token) => {
    if (wantBrief) {
      const claimed = await claimKeys(c.env, s.userId, ['brief'], now.day);
      if (!claimed.length) out.brief = 'already';
      else {
        const gaps = isMonday(now);
        let built: BuiltBrief;
        let r: Awaited<ReturnType<typeof sendEmail>> | null = null;
        try {
          built = await buildBrief(c, person, id, token, now, { withGaps: gaps });
          // Once handed to the outbox the claim is kept even if the provider failed: the scheduled job retries that row.
          if (built.ok) r = await sendEmail(c.env, { template: 'ai.brief', to: s.email, userId: s.userId, key: `ai.brief|${s.userId}|${now.day}`, subject: built.subject, text: built.text, html: built.html });
        } catch (e) { built = { ok: false, message: e instanceof Error ? e.message : String(e) }; }
        if (!built.ok || !r) {
          const message = built.ok ? 'the email could not be queued' : built.message;
          // Give the claim back so a later tick today can retry (until the cutoff).
          await releaseKeys(c.env, s.userId, ['brief'], now.day).catch(() => {});
          await logSend(c.env, { userId: s.userId, kind: 'brief', day: now.day, items: 0, notificationId: null, status: 'failed', note: message });
          out.brief = 'failed';
        } else {
          await logSend(c.env, { userId: s.userId, kind: 'brief', day: now.day, items: built.items, notificationId: r.id ?? null, status: r.state, note: [gaps ? 'with data gaps' : '', r.reason ?? ''].filter(Boolean).join('; ') });
          out.brief = r.state;
        }
      }
    }
    if (wantAlerts) {
      try {
        const finance = (await gateFor(c.env, s.userId).level('finance')) !== 'none';
        const read = (path: string, q?: Obj): Promise<PersonRead | null> => readAsPerson(c.request, c.env, c.waitUntil, token, path, q);
        const [ex, mnt, guests, invoices] = await Promise.all([
          read('/api/dashboard/exceptions'),
          read('/api/maintenance/issues', { view: 'open', limit: 200 }),
          finance ? read('/api/reservations', { view: 'all', todo: 'unpaid', size: 100 }) : Promise.resolve(null),
          finance ? read('/api/sales-invoices') : Promise.resolve(null),
        ]);
        const v = (r: PersonRead | null) => (r && r.ok ? r.value : null);
        const alerts = computeAlerts({ today: now.day, origin: appOrigin(c), exceptions: v(ex), maintenance: v(mnt), canSeeFinance: finance, guestsOwing: v(guests), invoices: v(invoices) });
        const fresh = alertsToSend(alerts, await sentKeys(c.env, s.userId, alerts.map(a => a.key), debounceSince(now.day)), now.day);
        const claimed = new Set(await claimKeys(c.env, s.userId, fresh.map(a => a.key), now.day));
        const send = fresh.filter(a => claimed.has(a.key));
        if (send.length) {
          const origin = appOrigin(c);
          const mail = buildAlertEmail({ alerts: send, date: now.day, settingsUrl: settingsUrl(origin), unsubscribeUrl: unsubscribeUrl(origin, await unsubscribeToken(c.env, s.userId)) });
          try {
            const r = await sendEmail(c.env, { template: 'ai.alert', to: s.email, userId: s.userId, key: `ai.alert|${s.userId}|${now.day}|${now.hhmm}`, subject: mail.subject, text: mail.text, html: mail.html });
            await logSend(c.env, { userId: s.userId, kind: 'alert', day: now.day, items: send.length, notificationId: r.id ?? null, status: r.state, note: [...new Set(send.map(a => a.kind))].join(',') });
          } catch (e) {
            await releaseKeys(c.env, s.userId, send.map(a => a.key), now.day).catch(() => {});
            throw e;
          }
        }
        out.alerts = send.length;
      } catch (e) {
        out.alertError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      } finally {
        await markAlertChecked(c.env, s.userId).catch(() => {});
      }
    }
    return true;
  });
  if (done === null) {
    out.skipped = 'AI Connector not allowed for this account right now';
    if (wantAlerts) await markAlertChecked(c.env, s.userId).catch(() => {});
  }
  return out;
}

export interface TickReport {
  subscribers: number; briefsDue: number; alertChecksDue: number;
  briefsSent: number; briefsFailed: number; alertEmails: number; alertLines: number; alertErrors: number; skipped: number; peopleDone: number; peopleDeferred: number; ms: number;
}

/** One tick. `dryRun`: the counts only, nothing built or sent. */
export async function runTick(c: RunCtx, opts: { dryRun?: boolean; now?: Date } = {}): Promise<TickReport | { dryRun: true; subscribers: number; briefsDue: number; alertChecksDue: number }> {
  const t0 = Date.now();
  const now = mytNow(opts.now);
  const subs = await activeSubscribers(c.env);
  const work = pickTickWork(subs, now, await usersWithKey(c.env, 'brief', now.day), (opts.now ?? new Date()).getTime());
  if (opts.dryRun) return { dryRun: true, subscribers: subs.length, briefsDue: work.briefs.length, alertChecksDue: work.alerts.length };
  const byId = new Map<string, { s: Subscriber; brief: boolean; alerts: boolean }>();
  for (const s of work.briefs) byId.set(s.userId, { s, brief: true, alerts: false });
  for (const s of work.alerts) byId.set(s.userId, { s, brief: byId.get(s.userId)?.brief ?? false, alerts: true });
  const r: TickReport = { subscribers: subs.length, briefsDue: work.briefs.length, alertChecksDue: work.alerts.length, briefsSent: 0, briefsFailed: 0, alertEmails: 0, alertLines: 0, alertErrors: 0, skipped: 0, peopleDone: 0, peopleDeferred: 0, ms: 0 };
  // One person at a time (bounded above): each runs on a token of their own, so their reads are only ever theirs.
  for (const { s, brief, alerts } of byId.values()) {
    if (Date.now() - t0 > PROACTIVE_CONFIG.tickBudgetMs) { r.peopleDeferred += 1; continue; }
    try {
      const p = await runPerson(c, s, now, brief, alerts);
      if (p.skipped) r.skipped += 1;
      if (p.brief === 'sent' || p.brief === 'queued') r.briefsSent += 1;
      if (p.brief === 'failed') r.briefsFailed += 1;
      if (p.alerts) { r.alertEmails += 1; r.alertLines += p.alerts; }
      if (p.alertError) r.alertErrors += 1;
    } catch (e) {
      console.error('AI brief: one person failed', e instanceof Error ? e.message : e);
      r.alertErrors += 1;
    }
    r.peopleDone += 1;
  }
  r.ms = Date.now() - t0;
  return r;
}
