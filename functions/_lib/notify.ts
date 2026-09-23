import { type Env, one, run, nowIso } from './db';

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
  const raw = `${s.template}|${s.entityId ?? s.recipient}|${new Date().toISOString().slice(0, 13)}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function notify(env: Env, s: Send): Promise<{ state: 'sent' | 'queued' | 'failed'; reason?: string }> {
  const idem = await key(s);

  const existing = await one<{ state: string }>(env,
    'SELECT state FROM notification_log WHERE idempotency_key = ?', idem);
  if (existing) return { state: existing.state as 'sent' | 'queued' | 'failed', reason: 'already recorded' };

  const id = crypto.randomUUID();
  const queued = !s.urgent && inQuietHours();

  await run(env, `
    INSERT INTO notification_log (id, template, recipient, channel, entity_table, entity_id, idempotency_key, state, queued_at, subject, body)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    id, s.template, s.recipient, s.channel, s.entityTable ?? null, s.entityId ?? null, idem, nowIso(), s.subject ?? null, s.body);

  if (queued) {
    // The scheduled Worker (worker/scheduled.ts) actually sends these at 08:00 using the
    // subject/body just stored above — it must call deliver() below, not just flip the state,
    // or the message is silently never delivered.
    return { state: 'queued', reason: `Quiet hours. Sending at ${nextSendTime().slice(11, 16)} MYT.` };
  }

  try {
    const providerId = await deliver(env, s);
    await run(env, "UPDATE notification_log SET state = 'sent', sent_at = ?, provider_message_id = ? WHERE id = ?",
      nowIso(), providerId, id);
    return { state: 'sent' };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Unknown delivery error';
    // A failed send is a visible state on the related record, never a silent drop.
    await run(env, "UPDATE notification_log SET state = 'failed', error = ? WHERE id = ?", reason, id);
    return { state: 'failed', reason };
  }
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
