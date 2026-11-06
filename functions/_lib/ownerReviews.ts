import { type Env, all, one } from './db';
import { REVIEW_COLUMNS, REVIEW_FROM, reviewOut } from './reviews';
import { categoryAverages } from './reviewStats';
import { BAD_REVIEW_MAX } from '../../src/lib/reviewRules';

/**
 * One owner's reviews, for the owner portal (owner, 3 Nov 2026). The portal's own pages call GET /api/owner/reviews,
 * or this helper directly. Owner-safe: only the guest's public review, its score on the channel's own scale (Airbnb
 * 1-5 stars, Booking.com out of 10), category scores, Airbnb tags and the public reply. Never the cleaner, the clean
 * jobs, internal reply errors, Bad guest flags or our review of the guest. Hidden Airbnb reviews are left out: Airbnb
 * does not show them yet either.
 */
export interface OwnerReviewsOptions { unitId?: string | null; page?: number; pageSize?: number }

export async function ownerReviews(env: Env, ownerId: string, o: OwnerReviewsOptions = {}) {
  const page = Math.max(1, Math.floor(o.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(o.pageSize ?? 20)));
  const where = ['u.owner_id = ?', 'v.is_hidden = 0'], args: unknown[] = [ownerId];
  if (o.unitId) { where.push('u.id = ?'); args.push(o.unitId); }
  const cond = `WHERE ${where.join(' AND ')}`;
  const [rows, sum, units] = await Promise.all([
    all<any>(env, `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} ${cond} ORDER BY v.reviewed_at DESC, v.id DESC LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize),
    one<{ n: number; a: number | null; air: number | null; air_n: number; bdc: number | null; bdc_n: number }>(env, `
      SELECT count(*)::int AS n, ROUND(AVG(v.rating)::numeric, 2) AS a,
        ROUND(AVG(v.rating) FILTER (WHERE v.channel = 'airbnb')::numeric, 2) AS air, count(*) FILTER (WHERE v.channel = 'airbnb')::int AS air_n,
        ROUND((AVG(v.rating) FILTER (WHERE v.channel = 'booking_com') * 2)::numeric, 2) AS bdc, count(*) FILTER (WHERE v.channel = 'booking_com')::int AS bdc_n
      ${REVIEW_FROM} ${cond}`, ...args),
    all<{ id: string; label: string }>(env, `SELECT u.id, trim(COALESCE(p.name, '') || ' ' || u.unit_number) AS label FROM units u LEFT JOIN properties p ON p.id = u.property_id WHERE u.owner_id = ? ORDER BY 2`, ownerId),
  ]);
  const unitIds = new Set(units.map(u => u.id));
  const cats = o.unitId && unitIds.has(o.unitId) ? await categoryAverages(env, 'all', { unitId: o.unitId }) : null;
  return {
    total: sum?.n ?? 0, page, pageSize,
    // Out of 5 over both channels; byChannel gives each on its own scale.
    average: sum?.a == null ? null : Number(sum.a),
    byChannel: {
      airbnb: { reviews: sum?.air_n ?? 0, average: sum?.air == null ? null : Number(sum.air), max: 5 },
      booking_com: { reviews: sum?.bdc_n ?? 0, average: sum?.bdc == null ? null : Number(sum.bdc), max: 10 },
    },
    categories: cats?.get('all') ?? null,
    badMax: BAD_REVIEW_MAX,
    units,
    data: rows.map(r => {
      const x = reviewOut(r);
      return {
        id: x.id, channel: x.channel, rating: x.rating, native: x.native, reviewedAt: x.reviewedAt, guestName: x.guestName.split(/\s+/)[0],
        unitId: x.unitId, unitLabel: [x.propertyName, x.unitNumber].filter(Boolean).join(' '), checkIn: x.checkIn, checkOut: x.checkOut,
        comment: x.comment, categories: x.categories, tags: x.tags, reply: x.channelReply ?? x.reply, repliedAt: x.repliedAt,
      };
    }),
  };
}
export type OwnerReviews = Awaited<ReturnType<typeof ownerReviews>>;
