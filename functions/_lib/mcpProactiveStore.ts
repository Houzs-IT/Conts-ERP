/**
 * Storage for AI Connector round 4d (morning brief + urgent alerts), migration 0397_mcp_brief_alerts.sql. Pure logic is
 * in mcpProactive.ts, the runs in mcpProactiveRun.ts.
 *
 *   mcp_brief_subscriptions  one row per person who saved the settings: brief on/off, time (HH:MM Malaysia), weekdays
 *                            or daily, alerts on/off, the random token in the email's unsubscribe link, last alert check.
 *   mcp_proactive_keys       the debounce / idempotency ledger: one row per person + key + Malaysia day. "brief" is a
 *                            key too, so a second tick on the same day cannot send a second brief
 *                            (INSERT ... ON CONFLICT DO NOTHING RETURNING = the claim).
 *   mcp_proactive_sends      the send log: who, what kind, how many items, the notification_log id, status. NEVER the
 *                            body or the subject.
 *
 * Migrations are applied by hand here (Apply migrations to production). Until 0397 is in, proactiveReady() is false:
 * the tick does nothing and says so, and the settings section on the AI Connector page says it is not set up yet.
 */
import { type Env, all, one, run, nowIso } from './db';
import { hasColumn } from './auth';
import { randomToken } from './mcpStore';
import { hasRealEmail } from './fieldPin';
import { subscriptionFromRow, type Subscription } from './mcpProactive';

/** Whether migration 0397 has been applied (remembered by hasColumn). */
export const proactiveReady = (env: Env) => hasColumn(env, 'mcp_proactive_sends', 'id');

const s = (r: Record<string, unknown>, ...k: string[]): string => { for (const x of k) if (r[x] !== undefined && r[x] !== null) return String(r[x]); return ''; };

/* ---------- subscriptions ---------- */

export async function getSubscription(env: Env, userId: string): Promise<Subscription | null> {
  const r = await one<Record<string, unknown>>(env, 'SELECT * FROM mcp_brief_subscriptions WHERE user_id = ?', userId);
  return r ? subscriptionFromRow(r) : null;
}

/** Insert or update; the unsubscribe token is made once and kept. */
export async function saveSubscription(env: Env, sub: Subscription): Promise<void> {
  const now = nowIso();
  await run(env, `INSERT INTO mcp_brief_subscriptions (user_id, brief_enabled, brief_time, brief_days, alerts_enabled, unsub_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET brief_enabled = excluded.brief_enabled, brief_time = excluded.brief_time,
      brief_days = excluded.brief_days, alerts_enabled = excluded.alerts_enabled, updated_at = excluded.updated_at`,
  sub.userId, sub.briefEnabled ? 1 : 0, sub.briefTime, sub.briefDays, sub.alertsEnabled ? 1 : 0, randomToken(24), now, now);
}

/** The token in this person's unsubscribe link (made on first save). */
export async function unsubscribeToken(env: Env, userId: string): Promise<string> {
  const r = await one<Record<string, unknown>>(env, 'SELECT unsub_token FROM mcp_brief_subscriptions WHERE user_id = ?', userId);
  return r ? s(r, 'unsub_token') : '';
}

/** A token can only ever be one of ours: base64url, the length randomToken(24) makes. */
export const UNSUB_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/** The unsubscribe link: brief AND alerts off for whoever holds this token (the token alone identifies the person; no
 *  user id in the link). Returns the user id, or null for an unknown or malformed token. */
export async function unsubscribeWithToken(env: Env, token: string): Promise<string | null> {
  if (!UNSUB_TOKEN_RE.test(token)) return null;
  const r = await one<Record<string, unknown>>(env,
    'UPDATE mcp_brief_subscriptions SET brief_enabled = 0, alerts_enabled = 0, updated_at = ? WHERE unsub_token = ? RETURNING user_id', nowIso(), token);
  return r ? s(r, 'user_id') : null;
}

/** Who already holds `key` for `day`: one query (who got today's brief). */
export async function usersWithKey(env: Env, key: string, day: string): Promise<Set<string>> {
  const rows = await all<Record<string, unknown>>(env, 'SELECT user_id FROM mcp_proactive_keys WHERE alert_key = ? AND day = ?', key, day);
  return new Set(rows.map(r => s(r, 'user_id')));
}

export type Subscriber = Subscription & { email: string; name: string; role: string; lastAlertCheckAt: string };

/**
 * Everyone opted in to anything, with their account: ONE query. Only the people the AI Connector itself would let in
 * (resolveAccessToken): active desk accounts that management approved, or management, with an email. The tick picks who
 * is due from this list.
 */
export async function activeSubscribers(env: Env): Promise<Subscriber[]> {
  const rows = await all<Record<string, unknown>>(env, `
    SELECT b.*, u.email, u.full_name, u.role
      FROM mcp_brief_subscriptions b JOIN users u ON u.id = b.user_id
     WHERE (b.brief_enabled = 1 OR b.alerts_enabled = 1)
       AND u.is_active = 1
       AND u.role NOT IN ('owner', 'housekeeper', 'technician', 'renovator')
       AND (u.role = 'management' OR EXISTS (SELECT 1 FROM mcp_access a WHERE a.user_id = u.id))`);
  return rows.map(r => ({
    ...subscriptionFromRow(r),
    email: s(r, 'email').trim(), name: s(r, 'full_name').trim() || s(r, 'email'), role: s(r, 'role'), lastAlertCheckAt: s(r, 'last_alert_check_at'),
  })).filter(x => x.email.includes('@') && hasRealEmail(x.email));
}

export async function markAlertChecked(env: Env, userId: string): Promise<void> {
  await run(env, 'UPDATE mcp_brief_subscriptions SET last_alert_check_at = ? WHERE user_id = ?', nowIso(), userId);
}

/* ---------- the debounce / idempotency ledger ---------- */

/** key -> the latest day it was sent to this person, for these keys, since `sinceDay`. One query. */
export async function sentKeys(env: Env, userId: string, keys: string[], sinceDay: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(keys)];
  if (!uniq.length) return out;
  const rows = await all<Record<string, unknown>>(env,
    `SELECT alert_key, MAX(day) AS day FROM mcp_proactive_keys WHERE user_id = ? AND day >= ? AND alert_key IN (${uniq.map(() => '?').join(',')}) GROUP BY alert_key`,
    userId, sinceDay, ...uniq);
  for (const r of rows) out.set(s(r, 'alert_key'), s(r, 'day'));
  return out;
}

/** Claim keys for today: returns only the keys THIS call inserted. A key already claimed today (another tick, a retry)
 *  comes back missing, so it is not sent twice. One statement. */
export async function claimKeys(env: Env, userId: string, keys: string[], day: string): Promise<string[]> {
  const uniq = [...new Set(keys)];
  if (!uniq.length) return [];
  const now = nowIso();
  const rows = await all<Record<string, unknown>>(env,
    `INSERT INTO mcp_proactive_keys (user_id, alert_key, day, created_at) VALUES ${uniq.map(() => '(?, ?, ?, ?)').join(', ')}
     ON CONFLICT (user_id, alert_key, day) DO NOTHING RETURNING alert_key`,
    ...uniq.flatMap(k => [userId, k, day, now]));
  return rows.map(r => s(r, 'alert_key'));
}

/** Give claims back (the email could not be built or queued: a later tick may retry today). */
export async function releaseKeys(env: Env, userId: string, keys: string[], day: string): Promise<void> {
  if (!keys.length) return;
  await run(env, `DELETE FROM mcp_proactive_keys WHERE user_id = ? AND day = ? AND alert_key IN (${keys.map(() => '?').join(',')})`, userId, day, ...keys);
}

/* ---------- the send log (never the body) ---------- */

export type SendKind = 'brief' | 'brief_test' | 'alert' | 'unsubscribe';
export type SendStatus = 'sent' | 'queued' | 'failed' | 'skipped';

/** One row per email (or unsubscribe). Never throws: a failed log line must not fail the send. */
export async function logSend(env: Env, x: { userId: string; kind: SendKind; day: string; items: number; notificationId: string | null; status: SendStatus; note?: string }): Promise<void> {
  try {
    await run(env, 'INSERT INTO mcp_proactive_sends (id, user_id, kind, day, items, notification_id, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `mcps_${randomToken(12)}`, x.userId, x.kind, x.day, x.items, x.notificationId, x.status, (x.note ?? '').slice(0, 200), nowIso());
  } catch (e) {
    console.error('AI brief send log failed', e instanceof Error ? e.message : e);
  }
}

export interface SendRow { at: string; kind: string; items: number; status: string; note: string }

export async function recentSends(env: Env, userId: string, limit = 10): Promise<SendRow[]> {
  const rows = await all<Record<string, unknown>>(env, 'SELECT kind, items, status, note, created_at FROM mcp_proactive_sends WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit);
  return rows.map(r => ({ at: s(r, 'created_at'), kind: s(r, 'kind'), items: Number(s(r, 'items')) || 0, status: s(r, 'status'), note: s(r, 'note') }));
}

/** The test brief's limit: one per person per 10 minutes, counted from the send log. */
export async function lastTestAt(env: Env, userId: string): Promise<string | null> {
  const r = await one<Record<string, unknown>>(env, `SELECT max(created_at) AS at FROM mcp_proactive_sends WHERE user_id = ? AND kind = 'brief_test' AND status <> 'failed'`, userId);
  return r && r.at ? String(r.at) : null;
}
