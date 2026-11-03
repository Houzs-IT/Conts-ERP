import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { channexConfigured } from '../../_lib/channex';
import { REVIEW_COLUMNS, reviewFrom, reviewOut, cleanColumn, cleanJobsSql } from '../../_lib/reviews';
import { demoOn, tablesFor, sourceSql } from '../../_lib/demo';
import { BAD_REVIEW_MAX, LOW_CLEANLINESS_BELOW, categoryKeySql } from '../../../src/lib/reviewRules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const CHANNELS = ['airbnb', 'booking_com', 'agoda', 'direct'];

/** GET /api/reviews — guest reviews across every channel, with the host's reply where there is one.
 *    ?page=1&pageSize=50       newest first
 *    &rating=1..5              one star rating (rounded, as the stars show it)
 *    &reply=needs_reply|replied|not_posted   not_posted: replied here, but the post to the channel failed
 *    &channel=airbnb|booking_com|agoda|direct   &unitId=<unit>   &propertyId=<building>   &q=<guest, unit or text>
 *    &matched=no               reviews no booking was matched to
 *    &bad=1                    bad reviews only (BAD_REVIEW_MAX stars or fewer)   &from=&to=yyyy-mm-dd   review date
 *    &hidden=1                 Airbnb reviews hidden until the host reviews the guest   &tag=<code>   reviews with that tag
 *    &lowClean=1               cleanliness under LOW_CLEANLINESS_BELOW out of 5   &cleaner=<cleaner id>  stays that cleaner readied
 *  `summary`, `average` and `units` are over every review, whatever the filters, so the header does not change with them. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const url = new URL(request.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 50)));
  const rating = Math.floor(Number(url.searchParams.get('rating')));
  const reply = url.searchParams.get('reply');

  const where: string[] = [], args: unknown[] = [];
  if (rating >= 1 && rating <= 5) { where.push('round(v.rating) = ?'); args.push(rating); }
  if (reply === 'needs_reply') where.push('v.reply IS NULL');
  else if (reply === 'replied') where.push('v.reply IS NOT NULL');
  else if (reply === 'not_posted') where.push(`v.reply_push_state = 'failed'`);
  const channel = url.searchParams.get('channel');
  if (channel && CHANNELS.includes(channel)) { where.push('v.channel = ?'); args.push(channel); }
  const unitId = url.searchParams.get('unitId');
  if (unitId) { where.push('u.id = ?'); args.push(unitId); }
  const propertyId = url.searchParams.get('propertyId');
  if (propertyId) { where.push('p.id = ?'); args.push(propertyId); }
  if (url.searchParams.get('matched') === 'no') where.push('v.reservation_id IS NULL');
  if (url.searchParams.get('bad') === '1') { where.push('v.rating <= ?'); args.push(BAD_REVIEW_MAX); }
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (from && DATE.test(from)) { where.push('substr(v.reviewed_at, 1, 10) >= ?'); args.push(from); }
  if (to && DATE.test(to)) { where.push('substr(v.reviewed_at, 1, 10) <= ?'); args.push(to); }
  if (url.searchParams.get('hidden') === '1') where.push('v.is_hidden = 1');
  const tag = (url.searchParams.get('tag') ?? '').trim().slice(0, 120);
  if (tag) { where.push(`jsonb_exists(COALESCE(v.tags, '[]'::jsonb), ?)`); args.push(tag); }
  if (url.searchParams.get('lowClean') === '1') {
    where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v.scores, '[]'::jsonb)) s WHERE ${categoryKeySql("s->>'category'")} = 'cleanliness' AND (s->>'score')::float / 2 < ?)`);
    args.push(LOW_CLEANLINESS_BELOW);
  }
  const cleaner = (url.searchParams.get('cleaner') ?? '').trim().slice(0, 80);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    where.push(`(COALESCE(g.full_name, v.guest_name, '') ILIKE ? OR COALESCE(v.comment, '') ILIKE ? OR COALESCE(v.reply, '') ILIKE ? OR COALESCE(u.unit_number, '') ILIKE ? OR COALESCE(p.name, '') ILIKE ? OR COALESCE(r.external_ref, '') ILIKE ?)`);
    args.push(like, like, like, like, like, like);
  }
  // Demo mode reads the sample reviews with the real ones (functions/_lib/demo.ts).
  const demo = await demoOn(env, request, session);
  const t = tablesFor(demo);
  const REVIEW_FROM = reviewFrom(t);
  if (cleaner) {
    where.push(`r.id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(${cleanJobsSql('r', t.reservations)}, '[]'::jsonb)) j, jsonb_array_elements(j->'cleaners') c WHERE c->>'id' = ?)`);
    args.push(cleaner);
  }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, filtered, sum, stars, units] = await Promise.all([
    all<any>(env, `SELECT ${REVIEW_COLUMNS}, ${cleanColumn(t)}, ${sourceSql(demo, 'v')} AS demo_source ${REVIEW_FROM} ${cond} ORDER BY v.reviewed_at DESC, v.id DESC LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize),
    one<{ n: number }>(env, `SELECT count(*)::int AS n ${REVIEW_FROM} ${cond}`, ...args),
    one<{ n: number; replied: number; failed: number; unmatched: number; bad: number; hidden: number; a: number | null; air: number | null; air_n: number; bdc: number | null; bdc_n: number }>(env, `
      SELECT count(*)::int AS n, count(*) FILTER (WHERE v.reply IS NOT NULL)::int AS replied, count(*) FILTER (WHERE v.is_hidden = 1)::int AS hidden,
        ROUND(AVG(v.rating) FILTER (WHERE v.channel = 'airbnb')::numeric, 2) AS air, count(*) FILTER (WHERE v.channel = 'airbnb')::int AS air_n,
        ROUND((AVG(v.rating) FILTER (WHERE v.channel = 'booking_com') * 2)::numeric, 2) AS bdc, count(*) FILTER (WHERE v.channel = 'booking_com')::int AS bdc_n,
        count(*) FILTER (WHERE v.reply_push_state = 'failed')::int AS failed, count(*) FILTER (WHERE v.reservation_id IS NULL)::int AS unmatched,
        count(*) FILTER (WHERE v.rating <= ?)::int AS bad, ROUND(AVG(v.rating)::numeric, 2) AS a
      FROM ${t.reviews} v`, BAD_REVIEW_MAX),
    all<{ star: number; n: number }>(env, `SELECT round(v.rating)::int AS star, count(*)::int AS n FROM ${t.reviews} v GROUP BY 1`),
    all<{ id: string; label: string; property_id: string | null; property_name: string | null }>(env, `
      SELECT DISTINCT u.id, trim(COALESCE(p.name, '') || ' ' || u.unit_number) AS label, p.id AS property_id, p.name AS property_name
      ${REVIEW_FROM} WHERE u.id IS NOT NULL ORDER BY label`),
  ]);
  const avg = sum?.a;

  return json({
    generatedAt: new Date().toISOString(), demo,
    average: avg === null || avg === undefined ? null : Number(avg),
    summary: { total: sum?.n ?? 0, replied: sum?.replied ?? 0, notPosted: sum?.failed ?? 0, unmatched: sum?.unmatched ?? 0, bad: sum?.bad ?? 0, hidden: sum?.hidden ?? 0 },
    // Each channel on its own scale: Airbnb out of 5 stars, Booking.com out of 10. `average` above is both, out of 5.
    byChannel: {
      airbnb: { reviews: sum?.air_n ?? 0, average: sum?.air == null ? null : Number(sum.air), max: 5 },
      booking_com: { reviews: sum?.bdc_n ?? 0, average: sum?.bdc == null ? null : Number(sum.bdc), max: 10 },
    },
    badMax: BAD_REVIEW_MAX,
    stars: Object.fromEntries(stars.map(s => [s.star, s.n])),
    page, pageSize, total: filtered?.n ?? 0,
    units: units.map(u => ({ id: u.id, label: u.label, propertyId: u.property_id })),
    buildings: [...new Map(units.filter(u => u.property_id).map(u => [u.property_id, { id: u.property_id, label: u.property_name }])).values()],
    channexConnected: channexConfigured(env),
    data: rows.map(reviewOut),
  });
};
