import { mayWork } from '../../../_lib/access';
import { type Env, one, json, fail, audit } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { deliverMessage } from '../../../_lib/messageDelivery';

/** POST /api/messages/:id/retry — sends a saved reply that did not reach the guest again, the same way as the first
 *  time (WhatsApp for direct guests, Channex for Airbnb and Booking.com). Only a reply sent from here that is marked
 *  not delivered can be retried; a delivered one is refused, so a double click cannot send it twice. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Only operations and management can message guests.', 403);
  if (!mayWork(session, ['management', 'operations_manager', 'operations_staff'])) return fail('FORBIDDEN', 'You can read messages but not send them.', 403);

  const m = await one<{ id: string; thread_id: string; body: string; direction: string; delivery_state: string | null; is_automated: number; channel: string | null; guest_id: string | null; reservation_id: string | null }>(env, `
    SELECT m.id, m.thread_id, m.body, m.direction, m.delivery_state, m.is_automated, t.channel, t.guest_id, t.reservation_id
    FROM messages m JOIN message_threads t ON t.id = m.thread_id WHERE m.id = ?`, String(params.id));
  if (!m) return fail('NOT_FOUND', 'That message no longer exists.', 404);
  if (m.direction !== 'outbound' || !['failed', 'not_linked'].includes(m.delivery_state ?? '')) {
    return fail('CONFLICT', m.delivery_state === 'sent' ? 'This message was already delivered.' : 'Only a reply that was not delivered can be sent again.', 409);
  }

  const delivery = await deliverMessage(env, {
    thread: { id: m.thread_id, channel: m.channel, guest_id: m.guest_id },
    messageId: m.id, body: m.body, reservationId: m.reservation_id, attempt: Date.now(),
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'message.retry', entityTable: 'message_threads', entityId: m.thread_id, after: { messageId: m.id, delivery: delivery.state } });
  return json({ id: m.id, delivery: delivery.state, reason: delivery.reason ?? null });
};
