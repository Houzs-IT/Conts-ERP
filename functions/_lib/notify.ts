import { type Env, all, one, run, nowIso } from './db';
import { hasColumn } from './auth';
import { hasRealEmail } from './fieldPin';

/**
 * Every outbound message goes through here. Templates and their triggers are in
 * notifications.md — this file owns delivery, idempotency and quiet hours.
 *
 * Two provider bindings are expected in wrangler.toml as secrets:
 *   MAIL_API_KEY      (transactional email)
 *   WHATSAPP_TOKEN    (WhatsApp Business)
 * Without them the send is recorded as queued and returns without throwing, so a
 * missing integration never takes down the action that triggered it.
 */

export type Channel = 'email' | 'whatsapp' | 'push' | 'in_app';

export interface Send {
  template: string;
  recipient: string;
  channel: Channel;
  /** Rendered subject and body. Copy lives in copy.md, not here. */
  subject?: string;
  body: string;
  entityTable?: string;
  entityId?: string;
  /** Overrides quiet hours. Check-in risk and payout failure only. */
  urgent?: boolean;
  /** Set when every call is a new message (a staff reply): the default key below would treat a second reply to the
   *  same guest within the hour as a retry of the first, skip it and report the first one's result. */
  idempotencyKey?: string;
}

const QUIET_FROM = 22;
const QUIET_TO = 8;

/** 22:00–08:00 MYT. Non-urgent guest and owner messages queue until 08:00. */
function inQuietHours(now = new Date()) {
  const myt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  const h = myt.getHours();
  return h >= QUIET_FROM || h < QUIET_TO;
}

function nextSendTime(now = new Date()) {
  const myt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  myt.setHours(QUIET_TO, 0, 0, 0);
  if (myt.getTime() <= now.getTime()) myt.setDate(myt.getDate() + 1);
  return myt.toISOString();
}

/** {template, entity, hour} — a retry of the same event never double-sends. */
async function key(s: Send) {
  const raw = s.idempotencyKey ?? `${s.template}|${s.entityId ?? s.recipient}|${new Date().toISOString().slice(0, 13)}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function notify(env: Env, s: Send): Promise<{ state: 'sent' | 'queued' | 'failed'; reason?: string }> {
  // A phone sign-in account's placeholder address (migration 0143) can never receive mail.
  if (s.channel === 'email' && !hasRealEmail(s.recipient)) return { state: 'failed', reason: 'This account has no email address.' };
  const idem = await key(s);

  const existing = await one<{ state: string }>(env,
    'SELECT state FROM notification_log WHERE idempotency_key = ?', idem);
  if (existing) return { state: existing.state as 'sent' | 'queued' | 'failed', reason: 'already recorded' };

  const id = crypto.randomUUID();
  const queued = !s.urgent && inQuietHours();
  // Sent now: the row is claimed as it is written, so the scheduled job does not send it a second time meanwhile.
  const lease = !queued && await hasSendLease(env);

  await run(env, `
    INSERT INTO notification_log (id, template, recipient, channel, entity_table, entity_id, idempotency_key, state, queued_at, subject, body${lease ? ', sending_until' : ''})
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?${lease ? ', ?' : ''})`,
    id, s.template, s.recipient, s.channel, s.entityTable ?? null, s.entityId ?? null, idem, nowIso(), s.subject ?? null, s.body, ...(lease ? [sendLeaseUntil()] : []));

  if (queued) {
    // The scheduled Worker (worker/scheduled.ts) actually sends these at 08:00 using the
    // subject/body just stored above — it must call deliver() below, not just flip the state,
    // or the message is silently never delivered.
    return { state: 'queued', reason: `Quiet hours. Sending at ${nextSendTime().slice(11, 16)} MYT.` };
  }

  try {
    const providerId = await deliver(env, s);
    await run(env, `UPDATE notification_log SET state = 'sent', sent_at = ?, provider_message_id = ?${lease ? ', sending_until = NULL' : ''} WHERE id = ?`,
      nowIso(), providerId, id);
    return { state: 'sent' };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Unknown delivery error';
    // A failed send is a visible state on the related record, never a silent drop.
    await run(env, `UPDATE notification_log SET state = 'failed', error = ?${lease ? ', sending_until = NULL' : ''} WHERE id = ?`, reason, id);
    // The scheduled job retries it (worker/scheduled.ts); separate so a database without migration 0095 still records the failure.
    await run(env, 'UPDATE notification_log SET attempts = 1, next_attempt_at = ? WHERE id = ?', retryAt(1), id).catch(() => {});
    return { state: 'failed', reason };
  }
}

/** How long a run holds a message it is sending (migration 0103, notification_log.sending_until). Longer than any
 *  provider call, shorter than the 15-minute job, so a run that died mid-send is picked up by the next one. */
export const SEND_LEASE_MS = 10 * 60_000;
export const sendLeaseUntil = (now = Date.now()) => new Date(now + SEND_LEASE_MS).toISOString();
/** Whether this database has the claim column; without it everything behaves as before migration 0103. */
export const hasSendLease = (env: Env) => hasColumn(env, 'notification_log', 'sending_until').catch(() => false);

/** Retries wait 5 min, 20 min, 80 min, ... and stop after MAX_SEND_ATTEMPTS. */
export const MAX_SEND_ATTEMPTS = 5;
export function retryAt(attempts: number, now = Date.now()) {
  return new Date(now + 5 * 60_000 * 4 ** Math.max(0, attempts - 1)).toISOString();
}

/** The actual provider call, shared by an immediate send above and the quiet-hours drainer
 *  (worker/scheduled.ts) resending a queued row later — the drainer must never just flip a
 *  row's state to 'sent' without going through this, or the message never really goes out. */
export async function deliver(env: Env, s: Send): Promise<string> {
  if (s.channel === 'in_app' || s.channel === 'push') {
    // In-app lands in notification_log itself; the client polls /api/notifications.
    return 'internal';
  }

  if (s.channel === 'email') {
    const keyOk = (env as any).MAIL_API_KEY;
    if (!keyOk) throw new Error('Mail provider is not configured.');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${keyOk}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'The Conts <noreply@theconts.com>',
        to: s.recipient,
        subject: s.subject ?? 'The Conts',
        text: s.body,
      }),
    });
    if (!res.ok) throw new Error(`Mail provider returned ${res.status}`);
    const j = await res.json<{ id: string }>();
    return j.id;
  }

  // WhatsApp Business Cloud API
  const token = (env as any).WHATSAPP_TOKEN;
  const phoneId = (env as any).WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error('WhatsApp is not configured.');
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: s.recipient.replace(/[^0-9]/g, ''),
      type: 'text',
      text: { body: s.body },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp returned ${res.status}`);
  const j = await res.json<{ messages: { id: string }[] }>();
  return j.messages?.[0]?.id ?? 'unknown';
}

/* ------------------------------------------------------------------ *
 * In-app notices to staff (pos.user_notifications, migration 0095).
 * notifyUsers is the one entry point every handler and the scheduled job use; its
 * signature is relied on by other modules (approvals), so keep it stable.
 * ------------------------------------------------------------------ */

/** Named groups a handler can address instead of listing roles. */
export const ROLE_GROUPS: Record<string, string[]> = {
  ops: ['operations_manager', 'operations_staff'],
  ops_managers: ['operations_manager'],
  managers: ['management', 'operations_manager'],
  finance: ['finance_admin', 'management'],
  management: ['management'],
};

/** A role name, a group name from ROLE_GROUPS, a list of user ids, or both kinds at once. */
export type NotifyTarget = string | string[] | { roles?: string[]; userIds?: (string | null | undefined)[] };

export interface UserNotice {
  /** What happened, dotted: booking.created, cleaning.assigned, maintenance.done ... */
  kind: string;
  title: string;
  body?: string | null;
  /** In-app path the notice opens, e.g. /reservations/bookings?open=<id>. */
  link?: string | null;
  entityTable?: string;
  entityId?: string;
  /** The same key never notifies one person twice (a retried request, the sweep running again). */
  dedupeKey?: string;
  /** Leave this person out, normally whoever did the thing. */
  except?: string | null;
  /** Also send an email copy, only where mail is configured. */
  email?: boolean;
}

function resolveTarget(target: NotifyTarget): { roles: string[]; userIds: string[] } {
  if (typeof target === 'string') return { roles: ROLE_GROUPS[target] ?? [target], userIds: [] };
  if (Array.isArray(target)) return { roles: [], userIds: target.filter((x): x is string => !!x) };
  return {
    roles: (target.roles ?? []).flatMap(r => ROLE_GROUPS[r] ?? [r]),
    userIds: (target.userIds ?? []).filter((x): x is string => !!x),
  };
}

/**
 * Writes one in-app notice for every active person the target names. Never throws and never fails the action
 * that called it: a failure is recorded in audit_log and the caller carries on. Returns how many were written.
 */
export async function notifyUsers(env: Env, target: NotifyTarget, n: UserNotice): Promise<{ created: number }> {
  try {
    const { roles, userIds } = resolveTarget(target);
    if (!roles.length && !userIds.length) return { created: 0 };
    // Lists go as JSON text: the driver runs with fetch_types off, so it cannot send arrays.
    const people = await all<{ id: string; email: string | null }>(env, `
      SELECT id, email FROM users
      WHERE is_active = 1
        AND (id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
             OR (role <> 'owner' AND role IN (SELECT jsonb_array_elements_text(?::text::jsonb))))
        AND id IS DISTINCT FROM ?`,
      JSON.stringify(userIds), JSON.stringify(roles), n.except ?? null);
    if (!people.length) return { created: 0 };
    const now = nowIso();
    const rows = people.map(p => ({
      id: crypto.randomUUID(), user_id: p.id, kind: n.kind, title: n.title.slice(0, 200), body: n.body ? n.body.slice(0, 1000) : null,
      link: n.link ?? null, entity_table: n.entityTable ?? null, entity_id: n.entityId ?? null, dedupe_key: n.dedupeKey ?? null, created_at: now,
    }));
    const made = await all<{ user_id: string }>(env, `
      INSERT INTO user_notifications (id, user_id, kind, title, body, link, entity_table, entity_id, dedupe_key, created_at)
      SELECT x.id, x.user_id, x.kind, x.title, x.body, x.link, x.entity_table, x.entity_id, x.dedupe_key, x.created_at
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, user_id text, kind text, title text, body text, link text, entity_table text, entity_id text, dedupe_key text, created_at text)
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING user_id`, JSON.stringify(rows));

    if (n.email && (env as any).MAIL_API_KEY && made.length) {
      const fresh = new Set(made.map(m => m.user_id));
      for (const p of people) {
        if (!fresh.has(p.id) || !p.email) continue;
        try {
          await notify(env, { template: `staff.${n.kind}`, recipient: p.email, channel: 'email', subject: n.title, body: [n.body, n.link ? `Open: ${n.link}` : null].filter(Boolean).join('\n\n'), entityTable: n.entityTable, entityId: n.entityId });
        } catch { /* recorded in notification_log by notify(); the notice above already landed */ }
      }
    }
    return { created: made.length };
  } catch (e) {
    await run(env, `INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, after_state, source, occurred_at) VALUES (NULL, 'Notifications', 'notification.failed', ?, ?, ?, 'system', ?)`,
      n.entityTable ?? 'user_notifications', n.entityId ?? n.kind, JSON.stringify({ kind: n.kind, error: e instanceof Error ? e.message : String(e) }), nowIso()).catch(() => {});
    return { created: 0 };
  }
}

/** The people a clean is for: the assigned user, the user behind the assigned cleaner on the roster, and every other cleaner listed on it. */
export async function taskPeople(env: Env, taskId: string): Promise<string[]> {
  try {
    const r = await all<{ id: string | null }>(env, `
      SELECT t.assignee_id AS id FROM tasks t WHERE t.id = ? AND t.assignee_id IS NOT NULL
      UNION SELECT c.user_id FROM tasks t JOIN cleaners c ON c.id = t.cleaner_id WHERE t.id = ? AND c.user_id IS NOT NULL`, taskId, taskId);
    // Every cleaner on the job (migration 0122), when that table exists.
    if (await hasColumn(env, 'task_cleaners', 'task_id').catch(() => false)) {
      r.push(...await all<{ id: string | null }>(env, 'SELECT user_id AS id FROM task_cleaners WHERE task_id = ? AND user_id IS NOT NULL', taskId));
    }
    return [...new Set(r.map(x => x.id).filter((x): x is string => !!x))];
  } catch { return []; }
}

/** A repair job names its technician by name; the active technician or housekeeper account with that name, if any. */
export async function technicianFor(env: Env, name: string | null | undefined): Promise<string[]> {
  if (!name?.trim()) return [];
  try {
    const r = await all<{ id: string }>(env, `SELECT id FROM users WHERE is_active = 1 AND role IN ('technician','housekeeper','operations_staff','operations_manager') AND lower(full_name) = lower(?)`, name.trim());
    return r.map(x => x.id);
  } catch { return []; }
}
