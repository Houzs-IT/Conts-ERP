import { mayWork } from '../../../_lib/access';
import { type Env, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { guestStay } from '../../../_lib/guestReviews';
import { badGuestSendAt, BAD_GUEST_SEND_DAY } from '../../../../src/lib/reviewRules';

/** POST /api/reviews/guest-reviews/bad-guest { reservationId, badGuest: true|false, note } — marks an Airbnb stay's
 *  guest as a Bad guest (owner, 3 Nov 2026). No rule ever reviews them; the review written by hand is held and sent on
 *  day BAD_GUEST_SEND_DAY after checkout, just before the window closes, so the guest cannot answer it with a review
 *  of their own. Clearing the flag lets a held review go on the next run. A review already sent is not affected. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can mark a Bad guest.', 403);
  const b = await request.json<any>().catch(() => null);
  const reservationId = String(b?.reservationId ?? '');
  if (!reservationId || typeof b?.badGuest !== 'boolean') return fail('VALIDATION', 'Pick the reservation and say whether the guest is a Bad guest.', 422);
  const note = String(b?.note ?? '').trim().slice(0, 500) || null;
  const found = await guestStay(env, reservationId);
  if (!found) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);
  if (!found.airbnb) return fail('NOT_AIRBNB', 'Only Airbnb lets hosts review guests.', 422);
  const on = b.badGuest as boolean;
  const at = nowIso();
  const held = badGuestSendAt(found.row.check_out, found.row.check_out_time);
  await run(env, `
    INSERT INTO guest_reviews (id, reservation_id, bad_guest, bad_guest_note, bad_guest_by, bad_guest_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (reservation_id) DO UPDATE SET bad_guest = EXCLUDED.bad_guest, bad_guest_note = EXCLUDED.bad_guest_note,
      bad_guest_by = EXCLUDED.bad_guest_by, bad_guest_at = EXCLUDED.bad_guest_at, updated_at = EXCLUDED.updated_at,
      -- A review written but not sent moves to day ${BAD_GUEST_SEND_DAY} (flag on) or goes on the next run (flag off).
      send_after = CASE WHEN guest_reviews.state IN ('scheduled', 'needs_approval') THEN (CASE WHEN EXCLUDED.bad_guest = 1 THEN ? ELSE ? END) ELSE guest_reviews.send_after END,
      -- A review a rule wrote before the flag waits for someone to look again.
      state = CASE WHEN EXCLUDED.bad_guest = 1 AND guest_reviews.source = 'rule' AND guest_reviews.state = 'scheduled' THEN 'needs_approval' ELSE guest_reviews.state END`,
    crypto.randomUUID(), reservationId, on ? 1 : 0, on ? note : null, on ? session.userId : null, on ? at : null, at, at, held, at);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: on ? 'guest_review.bad_guest_marked' : 'guest_review.bad_guest_cleared', entityTable: 'reservations', entityId: reservationId, after: { note } });
  return json({ ok: true, stay: (await guestStay(env, reservationId))?.stay ?? null });
};
