import { tablesFor, sampleOf, type Tables } from './demo';

/** A review as every screen shows it: the Reviews page, the reservation drawer and the unit page. A review with no
 *  booking behind it has no stay dates; one with no unit either came from a listing shared by several units. */
export const REVIEW_COLUMNS = `v.id, v.channel, v.rating, v.comment, v.reviewed_at, v.reply, v.replied_at, v.channel_reply, v.scores,
  v.reply_push_state, v.reply_push_error, v.channex_review_id, v.reservation_id,
  u.id AS unit_id, u.unit_number, p.id AS property_id, p.name AS property_name,
  COALESCE(g.full_name, v.guest_name) AS guest_name, r.check_in, r.check_out, r.external_ref`;

/** `t`: the pos tables, or in Demo mode the combined views (functions/_lib/demo.ts). */
export const reviewFrom = (t: Tables = tablesFor(false)) => `FROM ${t.reviews} v
  LEFT JOIN ${t.reservations} r ON r.id = v.reservation_id
  LEFT JOIN ${t.units} u ON u.id = COALESCE(v.unit_id, r.unit_id)
  LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN ${t.guests} g ON g.id = r.guest_id`;
export const REVIEW_FROM = reviewFrom();

const parse = (v: unknown) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };

export function reviewOut(r: any) {
  const scores = parse(r.scores);
  return {
    id: r.id, ...(sampleOf(r.demo_source) ? { sample: sampleOf(r.demo_source) } : {}), channel: r.channel, rating: Number(r.rating), comment: r.comment ?? null, reviewedAt: String(r.reviewed_at).slice(0, 10),
    guestName: r.guest_name || 'Guest', unitId: r.unit_id ?? null, unitNumber: r.unit_number ?? null, propertyId: r.property_id ?? null, propertyName: r.property_name ?? null,
    reservationId: r.reservation_id ?? null, checkIn: r.check_in ?? null, checkOut: r.check_out ?? null, bookingRef: r.external_ref ?? null,
    reply: r.reply ?? null, repliedAt: r.replied_at ? String(r.replied_at).slice(0, 10) : null,
    // The reply as it stands on the channel's site, when it differs from the one kept here.
    channelReply: r.channel_reply && r.channel_reply !== r.reply ? r.channel_reply : null,
    scores: Array.isArray(scores) ? scores as { category: string; score: number }[] : [],
    linked: !!r.channex_review_id,
    replyPost: r.reply_push_state ? { state: r.reply_push_state as 'sent' | 'failed', reason: r.reply_push_error ?? null } : null,
  };
}
