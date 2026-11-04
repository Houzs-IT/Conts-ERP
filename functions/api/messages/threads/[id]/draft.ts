import { type Env, all, one, json, fail, audit } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { THREAD_COLUMNS, THREAD_FROM } from '../../../../_lib/messageThreads';
import { aiConfigured, aiEnabled, draftMessageReply } from '../../../../_lib/aiDraft';

/** How many of the latest messages the draft reads. */
const RECENT = 12;

/** POST /api/messages/threads/:id/draft — an AI draft of the reply to this conversation, for the reply box. Never sent:
 *  the person reads it, changes it and presses Send. Same switch as Reviews: 501 NOT_CONFIGURED without the
 *  ANTHROPIC_API_KEY secret, 409 AI_OFF when Settings has AI draft replies off. Read from the conversation's recent
 *  messages and the unit and stay. Automatic messages are left out, because those carry door codes. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Only operations and management can reply to guests.', 403);
  if (!aiConfigured(env)) return fail('NOT_CONFIGURED', 'AI drafting is not set up. Write the reply yourself, or ask for the AI key to be added.', 501);
  if (!(await aiEnabled(env))) return fail('AI_OFF', 'AI draft replies are turned off in Reviews settings.', 409);
  const id = String(params.id);
  const [t, latest] = await Promise.all([
    one<any>(env, `SELECT ${THREAD_COLUMNS}, r.check_in_time, r.check_out_time, u.bedrooms, u.bathrooms, u.max_guests ${THREAD_FROM} WHERE t.id = ?`, id),
    all<any>(env, `SELECT direction, body, sent_at, is_automated FROM messages WHERE thread_id = ? ORDER BY sent_at DESC, id DESC LIMIT ${RECENT}`, id),
  ]);
  if (!t) return fail('NOT_FOUND', 'That conversation no longer exists.', 404);
  const messages = latest.reverse().filter(m => !m.is_automated).map(m => ({ fromGuest: m.direction === 'inbound', sentAt: m.sent_at, body: String(m.body ?? '') }));
  if (!messages.some(m => m.fromGuest)) return fail('NOTHING_TO_ANSWER', 'The guest has not written anything to answer yet.', 422);
  const out = await draftMessageReply(env, {
    channel: t.channel ?? 'direct', guestName: t.guest_name || 'the guest', unit: [t.property_name, t.unit_number].filter(Boolean).join(' ') || null,
    bedrooms: t.bedrooms ?? null, bathrooms: t.bathrooms ?? null, maxGuests: t.max_guests ?? null,
    stay: t.check_in && t.check_out ? { checkIn: t.check_in, checkOut: t.check_out, checkInTime: t.check_in_time ?? null, checkOutTime: t.check_out_time ?? null, state: t.reservation_state ?? null, guests: t.guests_count ?? null } : null,
    messages,
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: out.ok ? 'message.ai_draft' : 'message.ai_draft_failed', entityTable: 'message_threads', entityId: id, after: out.ok ? { length: out.text.length } : { reason: out.reason } });
  if (!out.ok) return fail('AI_FAILED', out.reason, 502);
  return json({ ok: true, draft: out.text });
};
