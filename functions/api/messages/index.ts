import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole, hasColumn } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { pushMessageIfLinked } from '../../_lib/channexMessageSync';

/** POST /api/messages — send a message to a guest. Name the conversation one of four ways:
 *    { threadId, body }              an existing thread
 *    { reservationId, body }         the thread for that stay (created if there is none)
 *    { guestId, body }               the thread for that guest's latest stay
 *    { taskId, channel?, body }      the guest arriving next at the task's unit
 *  { reservationId, kind: 'access_details' } sends the unit's access instruction instead of typed text.
 *  Direct-booking guests are reached on WhatsApp; other channels keep the conversation in their own inbox. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Only operations and management can message guests.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Write a message before sending.', 422);

  let reservationId: string | null = b.reservationId ?? null;
  if (!b.threadId && !reservationId && b.taskId) {
    const t = await one<{ id: string }>(env, `
      SELECT r.id FROM tasks k JOIN reservations r ON r.unit_id = k.unit_id
      WHERE k.id = ? AND r.state IN ('confirmed','pending','checked_in') AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.check_out >= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')
      ORDER BY r.check_in LIMIT 1`, String(b.taskId));
    reservationId = t?.id ?? null;
  }
  if (!b.threadId && !reservationId && b.guestId) {
    const r = await one<{ id: string }>(env, `SELECT id FROM reservations WHERE guest_id = ? AND state != 'cancelled' ORDER BY check_in DESC LIMIT 1`, String(b.guestId));
    reservationId = r?.id ?? null;
  }

  let thread = b.threadId ? await one<any>(env, 'SELECT id, channel, guest_id FROM message_threads WHERE id = ?', String(b.threadId)) : null;
  if (!thread && reservationId) {
    thread = await one<any>(env, 'SELECT id, channel, guest_id FROM message_threads WHERE reservation_id = ? ORDER BY last_message_at DESC LIMIT 1', reservationId);
    if (!thread) {
      const r = await one<any>(env, 'SELECT id, channel, guest_id FROM reservations WHERE id = ?', reservationId);
      if (!r) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);
      const id = crypto.randomUUID();
      await run(env, `INSERT INTO message_threads (id, reservation_id, guest_id, channel, subject, is_read, last_message_at) VALUES (?, ?, ?, ?, 'Stay', 1, ?)`, id, r.id, r.guest_id, r.channel, nowIso());
      thread = { id, channel: r.channel, guest_id: r.guest_id };
    }
  }
  if (!thread) return fail('NOT_FOUND', 'There is no conversation to send this to.', 404);

  let body = String(b.body ?? '').trim();
  if (b.kind === 'access_details' && reservationId) {
    const a = await one<{ instruction: string }>(env, `
      SELECT c.instruction FROM access_credentials c JOIN reservations r ON r.unit_id = c.unit_id WHERE r.id = ? ORDER BY c.updated_at DESC LIMIT 1`, reservationId);
    if (!a) return fail('NOT_FOUND', 'There are no access details on file for this unit.', 404);
    body = `Your access details: ${a.instruction}`;
  }
  if (!body) return fail('VALIDATION', 'Write a message before sending.', 422, { body: 'Write a message.' });
  if (body.length > 2000) return fail('VALIDATION', 'That message is too long.', 422);

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO messages (id, thread_id, direction, sender_id, body, sent_at, is_automated) VALUES (?, ?, 'outbound', ?, ?, ?, ?)`, id, thread.id, session.userId, body, now, b.kind ? 1 : 0);
  await run(env, 'UPDATE message_threads SET last_message_at = ?, is_read = 1 WHERE id = ?', now, thread.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'message.send', entityTable: 'message_threads', entityId: thread.id, after: { channel: thread.channel, kind: b.kind ?? 'text' } });

  let delivery: { state: string; reason?: string } = { state: 'sent' };
  if (thread.channel === 'direct') {
    const guest = thread.guest_id ? await one<{ phone: string | null }>(env, 'SELECT phone FROM guests WHERE id = ?', thread.guest_id) : null;
    delivery = guest?.phone
      ? await notify(env, { template: b.kind === 'access_details' ? 'access_details' : 'guest.reply', recipient: guest.phone, channel: 'whatsapp', body, entityTable: b.kind ? 'reservations' : 'message_threads', entityId: b.kind ? (reservationId ?? thread.id) : thread.id, urgent: true, idempotencyKey: `message:${id}` })
      : { state: 'failed', reason: 'This guest has no phone number on file.' };
  } else {
    // Airbnb/Booking.com: pushed to the guest's own inbox on that platform. Agoda, and any
    // conversation that hasn't come through Channex, has nowhere to push to — saved here only.
    const pushed = await pushMessageIfLinked(env, thread.id, id, body);
    delivery = pushed.state === 'sent'
      ? { state: 'sent' }
      : { state: 'not_linked', reason: pushed.reason ?? "This guest's messages are not linked to the channel, so they will not see this reply there." };
  }
  // Kept on the message (migration 0104) so the Inbox still shows "Not delivered" after a reload. Never fails the
  // reply, which is already saved and sent.
  try {
    if (await hasColumn(env, 'messages', 'delivery_state')) {
      const state = ['sent', 'failed', 'queued', 'not_linked'].includes(delivery.state) ? delivery.state : 'failed';
      await run(env, 'UPDATE messages SET delivery_state = ?, delivery_error = ? WHERE id = ?', state, state === 'sent' || !delivery.reason ? null : delivery.reason.slice(0, 500), id);
    }
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'system', action: 'message.delivery_state_failed', entityTable: 'message_threads', entityId: thread.id, after: { messageId: id, error: String(e).slice(0, 300) } }).catch(() => {});
  }
  return json({ id, threadId: thread.id, sentAt: now, delivery: delivery.state, reason: delivery.reason }, 201);
};
