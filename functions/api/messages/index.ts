import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { notify } from '../../_lib/notify';

/** GET /api/messages/threads — one list across every channel. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const threads = await all<any>(env, `
    SELECT t.*, COALESCE(g.full_name,'') AS guest_name,
           u.unit_number, p.name AS property_name,
           (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) AS last_body
    FROM message_threads t
    LEFT JOIN guests g ON g.id = t.guest_id
    LEFT JOIN reservations r ON r.id = t.reservation_id
    LEFT JOIN units u ON u.id = r.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
    ORDER BY t.last_message_at DESC`);

  const threadId = new URL(request.url).searchParams.get('threadId');
  const messages = threadId
    ? await all<any>(env, 'SELECT * FROM messages WHERE thread_id = ? ORDER BY sent_at', threadId)
    : [];

  return json({
    generatedAt: new Date().toISOString(),
    unread: threads.filter((t: any) => !t.is_read).length,
    threads: threads.map((t: any) => ({
      id: t.id, guestName: t.guest_name || null, subject: t.subject,
      unitNumber: t.unit_number, propertyName: t.property_name,
      channel: t.channel, isRead: !!t.is_read, lastMessageAt: t.last_message_at,
      preview: t.last_body,
    })),
    messages: messages.map((m: any) => ({
      id: m.id, direction: m.direction, body: m.body, sentAt: m.sent_at,
      isAutomated: !!m.is_automated,
    })),
  });
};

/** POST /api/messages { threadId, body } — outbound reply on the guest's channel. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { threadId, body } = await request.json<{ threadId: string; body: string }>();
  if (!body?.trim()) return fail('VALIDATION', 'Write a message before sending.', 422);

  const thread = await one<any>(env, 'SELECT id, channel FROM message_threads WHERE id = ?', threadId);
  if (!thread) return fail('NOT_FOUND', 'That conversation no longer exists.', 404);

  const id = crypto.randomUUID();
  const now = nowIso();
  await run(env, `
    INSERT INTO messages (id, thread_id, direction, sender_id, body, sent_at, is_automated)
    VALUES (?, ?, 'outbound', ?, ?, ?, 0)`, id, threadId, session.userId, body.trim(), now);
  await run(env, 'UPDATE message_threads SET last_message_at = ?, is_read = 1 WHERE id = ?', now, threadId);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'message.send',
    entityTable: 'message_threads', entityId: threadId, after: { channel: thread.channel },
  });
  // Direct bookings reach the guest on WhatsApp. OTA threads stay inside the
  // channel's own inbox, so there is nothing to push — the record is the message.
  let delivery: { state: string; reason?: string } = { state: 'sent' };
  if (thread.channel === 'direct') {
    const guest = await one<{ phone: string | null }>(env, `
      SELECT g.phone FROM message_threads t
      LEFT JOIN guests g ON g.id = t.guest_id WHERE t.id = ?`, threadId);
    if (guest?.phone) {
      delivery = await notify(env, {
        template: 'guest.reply', recipient: guest.phone, channel: 'whatsapp',
        body: body.trim(), entityTable: 'message_threads', entityId: threadId, urgent: true,
      });
    }
  }

  return json({ id, sentAt: now, delivery: delivery.state, reason: delivery.reason }, 201);
};
