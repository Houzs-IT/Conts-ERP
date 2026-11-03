import { tablesFor, sampleOf, type Tables } from './demo';
import {
  nativeOverall, nativeCategory, categoryKey, categoryLabel, tagInfo, LOW_CLEANLINESS_BELOW, AIRBNB_CATEGORIES,
} from '../../src/lib/reviewRules';

/** A review as every screen shows it: the Reviews page, the reservation drawer and the unit page. A review with no
 *  booking behind it has no stay dates; one with no unit either came from a listing shared by several units. */
export const REVIEW_COLUMNS = `v.id, v.channel, v.rating, v.comment, v.reviewed_at, v.reply, v.replied_at, v.channel_reply, v.scores,
  v.reply_push_state, v.reply_push_error, v.channex_review_id, v.reservation_id, v.is_hidden, v.tags,
  u.id AS unit_id, u.unit_number, p.id AS property_id, p.name AS property_name,
  COALESCE(g.full_name, v.guest_name) AS guest_name, r.check_in, r.check_out, r.external_ref`;

/** The day a clean job is for, in Malaysia: its planned time, else its deadline, else when it was made. */
export const TASK_DAY_SQL = (a: string) => `to_char((COALESCE(${a}.scheduled_for, ${a}.due_at, ${a}.created_at))::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;

/** The clean jobs that readied the unit for reservation `r` (owner, 3 Nov 2026: link a low cleanliness score to the
 *  turnover before the guest's check-in and its cleaners): every turnover, deep or light clean on the unit from the
 *  previous guest's checkout (at most 14 days back) up to this check-in, with each job's cleaners (task_cleaners,
 *  else the job's one cleaner). A JSON list, or null when there is none. */
export const cleanJobsSql = (r: string, reservations: string) => `(
  SELECT jsonb_agg(jsonb_build_object('taskId', tk.id, 'kind', tk.kind, 'state', tk.state, 'day', tk.day,
    'cleaners', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('id', COALESCE(tc.cleaner_id, 'u:' || tc.user_id), 'name', COALESCE(cl.full_name, us.full_name, 'Cleaner')) ORDER BY tc.position)
         FROM task_cleaners tc LEFT JOIN cleaners cl ON cl.id = tc.cleaner_id LEFT JOIN users us ON us.id = tc.user_id WHERE tc.task_id = tk.id),
      CASE WHEN tk.cleaner_id IS NOT NULL OR tk.assignee_id IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
        'id', COALESCE(tk.cleaner_id, 'u:' || tk.assignee_id),
        'name', COALESCE((SELECT full_name FROM cleaners WHERE id = tk.cleaner_id), (SELECT full_name FROM users WHERE id = tk.assignee_id), 'Cleaner'))) END,
      '[]'::jsonb)) ORDER BY tk.day, tk.id)
  FROM (SELECT x.*, ${TASK_DAY_SQL('x')} AS day FROM tasks x WHERE x.unit_id = ${r}.unit_id AND x.kind IN ('turnover','deep_clean','light_clean')) tk
  WHERE tk.day <= ${r}.check_in
    AND tk.day >= COALESCE((SELECT max(px.check_out) FROM ${reservations} px WHERE px.unit_id = ${r}.unit_id AND px.id <> ${r}.id
          AND px.check_out <= ${r}.check_in AND px.state NOT IN ('cancelled','no_show','inquiry','pending')),
        to_char(${r}.check_in::date - 14, 'YYYY-MM-DD')))`;

/** `t`: the pos tables, or in Demo mode the combined views (functions/_lib/demo.ts). `clean` adds the clean jobs
 *  before the stay as column clean_jobs (only on the page of rows, not on counts). */
export const reviewFrom = (t: Tables = tablesFor(false)) => `FROM ${t.reviews} v
  LEFT JOIN ${t.reservations} r ON r.id = v.reservation_id
  LEFT JOIN ${t.units} u ON u.id = COALESCE(v.unit_id, r.unit_id)
  LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN ${t.guests} g ON g.id = r.guest_id`;
export const REVIEW_FROM = reviewFrom();
export const cleanColumn = (t: Tables = tablesFor(false)) => `CASE WHEN r.id IS NULL THEN NULL ELSE ${cleanJobsSql('r', t.reservations)} END AS clean_jobs`;

const parse = (v: unknown) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };

export interface CleanJob { taskId: string; kind: string; state: string; day: string; cleaners: { id: string; name: string }[] }

/** Category scores with our names, each out of 10 as stored and on the channel's own scale. Airbnb's six come first,
 *  in Airbnb's order. */
export function categoriesOf(channel: string, raw: unknown) {
  const list = parse(raw);
  if (!Array.isArray(list)) return [];
  const order = (k: string) => { const i = (AIRBNB_CATEGORIES as readonly string[]).indexOf(k); return i < 0 ? 99 : i; };
  return list
    .map((s: any) => ({ key: categoryKey(String(s?.category ?? '')), score10: Number(s?.score) }))
    .filter(s => s.key && Number.isFinite(s.score10))
    .sort((a, b) => order(a.key) - order(b.key))
    .map(s => ({ key: s.key, label: categoryLabel(s.key), score10: s.score10, native: nativeCategory(channel, s.score10), outOf5: Math.round(s.score10 * 5) / 10 }));
}

export function reviewOut(r: any) {
  const categories = categoriesOf(r.channel, r.scores);
  const tags = parse(r.tags);
  const clean = categories.find(c => c.key === 'cleanliness');
  const jobs = parse(r.clean_jobs);
  return {
    id: r.id, ...(sampleOf(r.demo_source) ? { sample: sampleOf(r.demo_source) } : {}), channel: r.channel, rating: Number(r.rating), comment: r.comment ?? null, reviewedAt: String(r.reviewed_at).slice(0, 10),
    // The score on the channel's own scale: Airbnb 1-5 stars, Booking.com out of 10. `rating` stays 0-5 for averages.
    native: nativeOverall(r.channel, Number(r.rating)),
    guestName: r.guest_name || 'Guest', unitId: r.unit_id ?? null, unitNumber: r.unit_number ?? null, propertyId: r.property_id ?? null, propertyName: r.property_name ?? null,
    reservationId: r.reservation_id ?? null, checkIn: r.check_in ?? null, checkOut: r.check_out ?? null, bookingRef: r.external_ref ?? null,
    reply: r.reply ?? null, repliedAt: r.replied_at ? String(r.replied_at).slice(0, 10) : null,
    // The reply as it stands on the channel's site, when it differs from the one kept here.
    channelReply: r.channel_reply && r.channel_reply !== r.reply ? r.channel_reply : null,
    scores: categories.map(c => ({ category: c.label, score: c.score10 })),
    categories,
    tags: Array.isArray(tags) ? tags.map((x: unknown) => tagInfo(String(x))) : [],
    // Airbnb shows the review only once the host has reviewed the guest.
    hidden: Number(r.is_hidden ?? 0) === 1,
    lowCleanliness: !!clean && clean.outOf5 < LOW_CLEANLINESS_BELOW,
    cleanJobs: Array.isArray(jobs) ? jobs as CleanJob[] : null,
    linked: !!r.channex_review_id,
    replyPost: r.reply_push_state ? { state: r.reply_push_state as 'sent' | 'failed', reason: r.reply_push_error ?? null } : null,
  };
}
export type ReviewOut = ReturnType<typeof reviewOut>;
