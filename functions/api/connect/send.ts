import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole, hasColumn } from '../../_lib/auth';
import { isConnectConfigured, assembleConnectContact, postConnectContact, connectDeliveryOutcome } from '../../_lib/connect';

/** POST /api/connect/send { reservationId | guestId, automation } — fire a Houzs Connect WhatsApp
 *  template for the guest. Routes by the guest's phone (WhatsApp for ANY guest with a number),
 *  not the thread's channel, so OTA guests get the template too. Records an outbound message on the
 *  stay's thread with its delivery state, so the conversation shows it — exactly like deliverMessage.
 *  Inert until CONNECT_WEBHOOK_KEY is set: with no key it refuses before anything is recorded. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Only operations and management can message guests.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to send.', 422);
  const automation = String(b.automation ?? '').trim();
  if (!automation) return fail('VALIDATION', 'Pick which template to send.', 422, { automation: 'Pick a template.' });

  let reservationId: string | null = b.reservationId ?? null;
  if (!reservationId && b.guestId) {
    const r = await one<{ id: string }>(env, `SELECT id FROM reservations WHERE guest_id = ? AND state != 'cancelled' ORDER BY check_in DESC LIMIT 1`, String(b.guestId));
    reservationId = r?.id ?? null;
  }
  if (!reservationId) return fail('NOT_FOUND', 'There is no reservation to send a template for.', 404);

  // Inert guard: nothing is recorded or sent while Connect has no key (feature not live yet).
  if (!isConnectConfigured(env)) return fail('NOT_CONFIGURED', 'Houzs Connect is not set up yet, so no template can be sent. Ask IT to add the Connect key.', 503);

  const assembled = await assembleConnectContact(env, reservationId, { mask: false });
  if (!assembled) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);
  if (!assembled.phone) return fail('VALIDATION', 'This guest has no phone number on file, so there is nowhere to send the WhatsApp template.', 422);

  // The stay's thread (created if there is none), so the send shows in the conversation. The channel
  // on it is for display only — the template always goes to WhatsApp via the guest's phone.
  let thread = await one<{ id: string }>(env, 'SELECT id FROM message_threads WHERE reservation_id = ? ORDER BY last_message_at DESC LIMIT 1', reservationId);
  if (!thread) {
    const r = await one<{ id: string; channel: string; guest_id: string | null }>(env, 'SELECT id, channel, guest_id FROM reservations WHERE id = ?', reservationId);
    if (!r) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);
    const tid = crypto.randomUUID();
    await run(env, `INSERT INTO message_threads (id, reservation_id, guest_id, channel, subject, is_read, last_message_at) VALUES (?, ?, ?, ?, 'Stay', 1, ?)`, tid, r.id, r.guest_id, r.channel, nowIso());
    thread = { id: tid };
  }

  const id = crypto.randomUUID(), now = nowIso();
  const summary = `WhatsApp template “${automation}” sent to the guest via Houzs Connect.`;
  await run(env, `INSERT INTO messages (id, thread_id, direction, sender_id, body, sent_at, is_automated) VALUES (?, ?, 'outbound', ?, ?, ?, 1)`, id, thread.id, session.userId, summary, now);
  await run(env, 'UPDATE message_threads SET last_message_at = ?, is_read = 1 WHERE id = ?', now, thread.id);

  const result = await postConnectContact(env, { phone: assembled.phone, name: assembled.name, automation, attributes: assembled.attributes });
  const outcome = connectDeliveryOutcome(result, automation);

  // A failed send is a visible state on the message, never a silent drop — the same column
  // deliverMessage writes, guarded the same way so a database without migration 0104 still works.
  try {
    if (await hasColumn(env, 'messages', 'delivery_state')) {
      await run(env, 'UPDATE messages SET delivery_state = ?, delivery_error = ? WHERE id = ?',
        outcome.state, outcome.state === 'sent' || !outcome.reason ? null : outcome.reason.slice(0, 500), id);
    }
  } catch { /* the message is saved; the failure is in the audit below */ }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'connect.template_send',
    entityTable: 'reservations', entityId: reservationId,
    after: { automation, delivery: outcome.state, triggered: result.triggered, status: result.status },
  });

  return json({ id, threadId: thread.id, sentAt: now, delivery: outcome.state, reason: outcome.reason }, outcome.state === 'sent' ? 201 : 200);
};
