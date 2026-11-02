import { type Env, one, run, audit } from './db';
import { hasColumn } from './auth';
import { notify } from './notify';
import { pushMessageIfLinked } from './channexMessageSync';

export interface Delivery { state: 'sent' | 'failed' | 'queued' | 'not_linked'; reason?: string }

/** Sends a reply that is already saved to the guest: direct-booking guests on WhatsApp, Airbnb and Booking.com through
 *  Channex into the guest's inbox there. Agoda, and a conversation that did not come through Channex, have nowhere to
 *  push to: saved here only. Keeps the outcome on the message (migration 0104) so Messages still shows it after a
 *  reload. Never throws: the reply is already saved, and a failed send is shown with a Retry instead. */
export async function deliverMessage(env: Env, o: {
  thread: { id: string; channel: string | null; guest_id: string | null };
  messageId: string; body: string; kind?: string | null; reservationId?: string | null; attempt?: number;
}): Promise<Delivery> {
  let delivery: Delivery;
  try {
    if (o.thread.channel === 'direct') {
      const guest = o.thread.guest_id ? await one<{ phone: string | null }>(env, 'SELECT phone FROM guests WHERE id = ?', o.thread.guest_id) : null;
      delivery = guest?.phone
        ? await notify(env, { template: o.kind === 'access_details' ? 'access_details' : 'guest.reply', recipient: guest.phone, channel: 'whatsapp', body: o.body,
            entityTable: o.kind ? 'reservations' : 'message_threads', entityId: o.kind ? (o.reservationId ?? o.thread.id) : o.thread.id, urgent: true,
            idempotencyKey: o.attempt ? `message:${o.messageId}:retry:${o.attempt}` : `message:${o.messageId}` })
        : { state: 'failed', reason: 'This guest has no phone number on file.' };
    } else {
      const pushed = await pushMessageIfLinked(env, o.thread.id, o.messageId, o.body);
      delivery = pushed.state === 'not_linked'
        ? { state: 'not_linked', reason: "This conversation is not linked to the guest's channel, so they will not see this reply there." }
        : pushed;
    }
  } catch (e) {
    delivery = { state: 'failed', reason: 'The channel could not be reached. Try again in a moment.' };
    await audit(env, { actorId: null, actorLabel: 'system', action: 'message.delivery_failed', entityTable: 'message_threads', entityId: o.thread.id, after: { messageId: o.messageId, error: String(e).slice(0, 300) } }).catch(() => {});
  }
  try {
    if (await hasColumn(env, 'messages', 'delivery_state')) {
      const state = ['sent', 'failed', 'queued', 'not_linked'].includes(delivery.state) ? delivery.state : 'failed';
      await run(env, 'UPDATE messages SET delivery_state = ?, delivery_error = ? WHERE id = ?', state, state === 'sent' || !delivery.reason ? null : delivery.reason.slice(0, 500), o.messageId);
    }
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'system', action: 'message.delivery_state_failed', entityTable: 'message_threads', entityId: o.thread.id, after: { messageId: o.messageId, error: String(e).slice(0, 300) } }).catch(() => {});
  }
  return delivery;
}
