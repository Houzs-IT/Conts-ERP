import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

/** GET /api/messages/threads — every conversation across every channel, each with its messages, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'The inbox is for operations and management.', 403);

  const threads = await all<any>(env, `
    SELECT t.*, COALESCE(g.full_name, '') AS guest_name, u.unit_number, p.name AS property_name
    FROM message_threads t
    LEFT JOIN guests g ON g.id = t.guest_id
    LEFT JOIN reservations r ON r.id = t.reservation_id
    LEFT JOIN units u ON u.id = r.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
    ORDER BY t.last_message_at DESC LIMIT 200`);
  const messages = await all<any>(env, `
    SELECT m.* FROM messages m WHERE m.thread_id IN (SELECT id FROM message_threads ORDER BY last_message_at DESC LIMIT 200) ORDER BY m.sent_at`);

  return json({
    generatedAt: nowIso(),
    threads: threads.map(t => {
      const mine = messages.filter(m => m.thread_id === t.id);
      return {
        id: t.id, guestName: t.guest_name || null, subject: t.subject, unitNumber: t.unit_number ?? null, propertyName: t.property_name ?? null,
        channel: t.channel, isRead: !!t.is_read, lastMessageAt: t.last_message_at, preview: mine.at(-1)?.body ?? null,
        // Raw ISO, not pre-formatted here — the frontend's own time() (src/lib/format.ts) does the
        // display formatting. Sending an already-formatted "14:06" made the frontend call
        // new Date("14:06") on it, which is not a valid date, hence "Invalid Date" on screen.
        messages: mine.map(m => ({ id: m.id, direction: m.direction, body: m.body, sentAt: m.sent_at, isAutomated: !!m.is_automated,
          // Only replies sent once migration 0104 is in carry a delivery state; the rest show as before.
          ...(m.delivery_state ? { status: m.delivery_state === 'sent' ? 'sent' : 'undelivered', deliveryReason: m.delivery_error ?? null } : {}) })),
      };
    }),
  });
};
