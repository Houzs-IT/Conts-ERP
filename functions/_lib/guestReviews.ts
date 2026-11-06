import { type Env, all, one, run, audit, nowIso, inDemo } from './db';
import { channexConfigured, channexGuestReview } from './channex';
import { STAY_SQL } from './reviewStays';
import {
  GUEST_REVIEW_WINDOW_DAYS, GUEST_REVIEW_CATEGORIES, ALL_GUEST_REVIEW_TAGS, guestReviewDeadline, badGuestSendAt, fillTemplate,
} from '../../src/lib/reviewRules';

/**
 * The host's review of the guest, Airbnb only (owner, 3 Nov 2026). Airbnb gives both sides GUEST_REVIEW_WINDOW_DAYS
 * after checkout, and shows the guest's review of us only once we have reviewed them (reviews.is_hidden). A review is
 * written by hand (Reviews > Review guests) or by a rule (guest_review_rules, run by the scheduled job), and sent to
 * Airbnb through Channex on the guest's review of that stay (POST /reviews/:id/guest_review). Until Airbnb has opened
 * that review in Channex there is nothing to send it to, so it waits as scheduled and goes on the next run.
 * A Bad guest's review is held to day BAD_GUEST_SEND_DAY. Sending never throws: the outcome is kept on the row.
 */

/** Tries a failed send again on the scheduled run this many times in all, at least RETRY_GAP_MS apart. Retry on the
 *  screen is always allowed while the window is open. */
export const MAX_AUTO_ATTEMPTS = 3;
const RETRY_GAP_MS = 60 * 60e3;
/** The Malaysia date at `d` (the scheduled run passes its own time). */
const mytDay = (d: Date = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
/** Guest reviews one scheduled run sends: each is one outside call (the cron worker has 50). */
const SENDS_PER_RUN = 20;

export interface GuestReviewInput {
  cleanliness: number; communication: number; respect_house_rules: number;
  publicReview: string; privateNote: string; recommend: boolean; tags: string[];
}

/** Checks a review typed on the form. Returns the cleaned values, or the field errors. */
export function readGuestReview(b: any): { ok: true; value: GuestReviewInput } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const rating = (k: string) => {
    const n = Number(b?.[k]);
    if (!Number.isInteger(n) || n < 1 || n > 5) fields[k] = 'Pick 1 to 5 stars.';
    return n;
  };
  const value: GuestReviewInput = {
    cleanliness: rating('cleanliness'), communication: rating('communication'), respect_house_rules: rating('respect_house_rules'),
    publicReview: String(b?.publicReview ?? '').trim(), privateNote: String(b?.privateNote ?? '').trim(),
    recommend: b?.recommend === true, tags: Array.isArray(b?.tags) ? [...new Set(b.tags.map((t: unknown) => String(t)))] as string[] : [],
  };
  if (!value.publicReview) fields.publicReview = 'Write the public review.';
  else if (value.publicReview.length > 1000) fields.publicReview = 'Keep the public review to 1,000 characters.';
  if (value.privateNote.length > 1000) fields.privateNote = 'Keep the private note to 1,000 characters.';
  if (typeof b?.recommend !== 'boolean') fields.recommend = 'Say whether you would host this guest again.';
  const unknownTag = value.tags.find(t => !ALL_GUEST_REVIEW_TAGS.includes(t));
  if (unknownTag) fields.tags = 'One of the tags is not an Airbnb tag.';
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value };
}

/** The Airbnb stays whose review window is open or recently closed, with their guest review. `GS_COLUMNS` is read by
 *  stayOut. A stay counts once its checkout day has come. */
const GS_COLUMNS = `r.id AS reservation_id, r.check_in, r.check_out, r.check_out_time, r.external_ref, r.unit_id, u.unit_number, p.name AS property_name,
  COALESCE(g.full_name, 'Guest') AS guest_name, (COALESCE(g.tags, '') ~ '(^|,)blacklist(,|$)') AS blacklisted,
  rv.id AS review_id, rv.channex_review_id, rv.is_hidden AS their_hidden, rv.rating AS their_rating,
  gr.id, gr.bad_guest, gr.bad_guest_note, gr.state, gr.source, gr.rule_id, gr.cleanliness, gr.communication, gr.respect_house_rules,
  gr.public_review, gr.private_note, gr.recommend, gr.tags, gr.send_after, gr.attempts, gr.last_error, gr.last_attempt_at, gr.sent_at,
  gr.written_at, gr.approved_at, ru.name AS rule_name, wu.full_name AS written_by_name`;
const GS_FROM = `FROM reservations r JOIN units u ON u.id = r.unit_id LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN guests g ON g.id = r.guest_id
  LEFT JOIN guest_reviews gr ON gr.reservation_id = r.id
  LEFT JOIN guest_review_rules ru ON ru.id = gr.rule_id
  LEFT JOIN users wu ON wu.id = gr.written_by
  LEFT JOIN LATERAL (SELECT v.id, v.channex_review_id, v.is_hidden, v.rating FROM reviews v WHERE v.reservation_id = r.id ORDER BY (v.channex_review_id IS NOT NULL) DESC, v.reviewed_at DESC LIMIT 1) rv ON TRUE`;
const AIRBNB_STAY = `r.channel = 'airbnb' AND ${STAY_SQL}`;

const parseTags = (v: unknown): string[] => { const x = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v; return Array.isArray(x) ? x.map(String) : []; };

export function stayOut(r: any, now = Date.now()) {
  const deadline = guestReviewDeadline(r.check_out, r.check_out_time);
  const written = r.state != null;
  return {
    reservationId: r.reservation_id, guestName: r.guest_name, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name ?? null,
    checkIn: r.check_in, checkOut: r.check_out, bookingRef: r.external_ref ?? null,
    deadline, windowOpen: Date.parse(deadline) > now,
    badGuest: Number(r.bad_guest ?? 0) === 1, badGuestNote: r.bad_guest_note ?? null, badGuestSendAt: badGuestSendAt(r.check_out, r.check_out_time),
    blacklisted: !!r.blacklisted,
    // The guest's own review of the stay: whether Airbnb opened it in Channex (needed to send ours) and is hiding it.
    theirReview: r.review_id ? { id: r.review_id, linked: !!r.channex_review_id, hidden: Number(r.their_hidden ?? 0) === 1, rating: r.their_rating == null ? null : Number(r.their_rating) } : null,
    review: written ? {
      id: r.id, state: r.state as 'needs_approval' | 'scheduled' | 'sent' | 'failed', source: r.source as 'manual' | 'rule', ruleName: r.rule_name ?? null,
      cleanliness: r.cleanliness, communication: r.communication, respect_house_rules: r.respect_house_rules,
      publicReview: r.public_review ?? '', privateNote: r.private_note ?? '', recommend: Number(r.recommend) === 1, tags: parseTags(r.tags),
      sendAfter: r.send_after ?? null, attempts: Number(r.attempts ?? 0), lastError: r.last_error ?? null, lastAttemptAt: r.last_attempt_at ?? null,
      sentAt: r.sent_at ?? null, writtenAt: r.written_at ?? null, writtenBy: r.written_by_name ?? null,
    } : null,
  };
}
export type GuestStay = ReturnType<typeof stayOut>;

/** Airbnb stays for the Review guests tab. view: due (window open, not sent), sent, all (checked out in the last 30
 *  days). Newest checkout first. */
export async function guestStays(env: Env, o: { view: 'due' | 'sent' | 'all'; reservationId?: string | null; now?: Date }) {
  const today = mytDay(o.now);
  const lookback = new Date(Date.parse(`${today}T00:00:00Z`) - (o.view === 'due' ? GUEST_REVIEW_WINDOW_DAYS + 1 : 30) * 864e5).toISOString().slice(0, 10);
  const where = [AIRBNB_STAY, 'r.check_out <= ?'], args: unknown[] = [today];
  if (o.reservationId) { where.push('r.id = ?'); args.push(o.reservationId); }
  else { where.push('r.check_out >= ?'); args.push(lookback); }
  if (o.view === 'due') where.push(`gr.state IS DISTINCT FROM 'sent'`);
  if (o.view === 'sent') where.push(`gr.state = 'sent'`);
  const rows = await all<any>(env, `SELECT ${GS_COLUMNS} ${GS_FROM} WHERE ${where.join(' AND ')} ORDER BY r.check_out DESC, r.id LIMIT 300`, ...args);
  const now = (o.now ?? new Date()).getTime();
  const out = rows.map(r => stayOut(r, now));
  return o.view === 'due' && !o.reservationId ? out.filter(s => s.windowOpen) : out;
}

/** One stay with its guest review, or null when it is not a finished Airbnb stay. */
export async function guestStay(env: Env, reservationId: string, now?: Date) {
  const r = await one<any>(env, `SELECT ${GS_COLUMNS}, r.channel, r.state AS res_state ${GS_FROM} WHERE r.id = ?`, reservationId);
  if (!r) return null;
  return { row: r, stay: stayOut(r, (now ?? new Date()).getTime()), airbnb: r.channel === 'airbnb' };
}

/** A template for a public review: random among the three least used active ones, so guests read different words.
 *  Marks it used. Null when there is no active template. */
export async function pickTemplate(env: Env, write = true): Promise<{ id: string; body: string } | null> {
  const few = await all<{ id: string; body: string }>(env, `SELECT id, body FROM guest_review_templates WHERE is_active = 1 ORDER BY use_count, last_used_at NULLS FIRST, id LIMIT 3`);
  if (!few.length) return null;
  const t = few[Math.floor(Math.random() * few.length)];
  if (write) await run(env, 'UPDATE guest_review_templates SET use_count = use_count + 1, last_used_at = ? WHERE id = ?', nowIso(), t.id);
  return t;
}

export type SendResult = { state: 'sent' | 'scheduled' | 'failed'; reason?: string };

/** Sends one written guest review to Airbnb. Never throws: the outcome is written on the row and returned.
 *  scheduled: held for a Bad guest, or Airbnb has not opened the guest's review in Channex yet. */
export async function sendGuestReview(env: Env, id: string, o: { now?: Date; actor?: { id: string | null; label: string } } = {}): Promise<SendResult> {
  const now = o.now ?? new Date();
  const actor = o.actor ?? { id: null, label: 'Scheduled job' };
  try {
    const r = await one<any>(env, `
      SELECT gr.*, res.check_out, res.check_out_time,
        (SELECT v.channex_review_id FROM reviews v WHERE v.reservation_id = gr.reservation_id AND v.channex_review_id IS NOT NULL ORDER BY v.reviewed_at DESC LIMIT 1) AS channex_review_id
      FROM guest_reviews gr JOIN reservations res ON res.id = gr.reservation_id WHERE gr.id = ?`, id);
    if (!r) return { state: 'failed', reason: 'That guest review no longer exists.' };
    if (r.state === 'sent') return { state: 'sent' };
    const deadline = guestReviewDeadline(r.check_out, r.check_out_time);
    const mark = async (state: 'scheduled' | 'failed' | 'sent', reason: string | null, attempted: boolean) => {
      await run(env, `UPDATE guest_reviews SET state = ?, last_error = ?, updated_at = ?,
          attempts = attempts + ?, last_attempt_at = CASE WHEN ?::boolean THEN ? ELSE last_attempt_at END,
          sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE id = ?`,
        state, reason, nowIso(), attempted ? 1 : 0, attempted, now.toISOString(), state, now.toISOString(), id);
    };
    if (Date.parse(deadline) <= now.getTime()) {
      await mark('failed', `Airbnb's ${GUEST_REVIEW_WINDOW_DAYS}-day window closed before it was sent.`, false);
      return { state: 'failed', reason: 'The review window has closed.' };
    }
    if (Number(r.bad_guest) === 1 && Date.parse(badGuestSendAt(r.check_out, r.check_out_time)) > now.getTime()) {
      await run(env, 'UPDATE guest_reviews SET state = ?, send_after = ?, updated_at = ? WHERE id = ?', 'scheduled', badGuestSendAt(r.check_out, r.check_out_time), nowIso(), id);
      return { state: 'scheduled', reason: 'Held for a Bad guest until just before the window closes.' };
    }
    // Demo mode never calls Channex (channex.ts): the review stays in the demo store, waiting, and says so.
    if (inDemo()) {
      await mark('scheduled', 'Demo: saved in the demo store, not sent to Airbnb.', false);
      return { state: 'scheduled', reason: 'Demo: saved, not sent to Airbnb.' };
    }
    if (!r.channex_review_id) {
      await mark('scheduled', 'Waiting for Airbnb to open the guest review of this reservation in Channex. It is sent on the next run after that.', false);
      return { state: 'scheduled', reason: 'Airbnb has not opened the review for this reservation yet.' };
    }
    if (!channexConfigured(env)) {
      await mark('failed', 'Channex is not connected on this system.', true);
      return { state: 'failed', reason: 'Channex is not connected on this system.' };
    }
    const res = await channexGuestReview(env, r.channex_review_id, {
      scores: GUEST_REVIEW_CATEGORIES.map(c => ({ category: c, rating: Number(r[c]) })),
      publicReview: r.public_review ?? '', privateReview: r.private_note ?? '', recommend: Number(r.recommend) === 1, tags: parseTags(r.tags),
    });
    if (res.ok) {
      await mark('sent', null, true);
      await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'guest_review.sent', entityTable: 'guest_reviews', entityId: id, after: { reservationId: r.reservation_id } });
      return { state: 'sent' };
    }
    const reason = res.status === 403 ? 'The Messages & Reviews app is not installed in Channex.' : res.status === 0 ? 'Channex could not be reached.' : `Airbnb refused it (status ${res.status}).`;
    await mark('failed', reason, true);
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.guest_review_failed', entityTable: 'guest_reviews', entityId: id, after: { status: res.status } });
    return { state: 'failed', reason };
  } catch (e) {
    const reason = 'The channel could not be reached. Try again in a moment.';
    await run(env, 'UPDATE guest_reviews SET state = ?, last_error = ?, attempts = attempts + 1, last_attempt_at = ?, updated_at = ? WHERE id = ?', 'failed', reason, now.toISOString(), nowIso(), id).catch(() => {});
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.guest_review_failed', entityTable: 'guest_reviews', entityId: id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    return { state: 'failed', reason };
  }
}

/** When a written review should go: now, or day 13 for a Bad guest. */
export const sendAfterFor = (badGuest: boolean, checkOut: string, checkOutTime: string | null, now = new Date()) => {
  const held = badGuestSendAt(checkOut, checkOutTime);
  return badGuest && Date.parse(held) > now.getTime() ? held : now.toISOString();
};

/** No repair was reported on the unit from check-in to the day after checkout, and nobody flagged the guest. */
const NO_ISSUES_SQL = `NOT EXISTS (SELECT 1 FROM maintenance_issues m WHERE m.unit_id = r.unit_id
    AND substr(m.reported_at, 1, 10) >= r.check_in AND substr(m.reported_at, 1, 10) <= to_char(r.check_out::date + 1, 'YYYY-MM-DD'))`;

export interface SweepReport { written: number; approval: number; sent: number; waiting: number; failed: number; items: string[] }

/**
 * The scheduled run (every 15 minutes, cronJobs.ts guestReviewSweep), also run by "Run rules now":
 *  1. each finished Airbnb stay with an open window and no guest review yet gets one from the first active rule whose
 *     condition it meets: the rule's ratings and a random template, sent (auto) or left for approval. Never for a Bad
 *     guest or a guest on the Blacklist, and never without a template.
 *  2. every review due (scheduled, send_after passed) is sent; failed ones are tried again up to MAX_AUTO_ATTEMPTS.
 */
export async function runGuestReviews(env: Env, o: { now?: Date; dryRun?: boolean } = {}): Promise<SweepReport> {
  const now = o.now ?? new Date();
  const today = mytDay(now);
  const rep: SweepReport = { written: 0, approval: 0, sent: 0, waiting: 0, failed: 0, items: [] };
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (GUEST_REVIEW_WINDOW_DAYS + 1) * 864e5).toISOString().slice(0, 10);

  const rules = await all<any>(env, `SELECT * FROM guest_review_rules WHERE is_active = 1 ORDER BY position, created_at, id`);
  if (rules.length) {
    const stays = await all<any>(env, `
      SELECT r.id, r.check_out, r.check_out_time, COALESCE(g.full_name, 'Guest') AS guest_name, trim(COALESCE(p.name, '') || ' ' || u.unit_number) AS unit_label,
        ${NO_ISSUES_SQL} AS no_issues
      FROM reservations r JOIN units u ON u.id = r.unit_id LEFT JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
      LEFT JOIN guest_reviews gr ON gr.reservation_id = r.id
      WHERE ${AIRBNB_STAY} AND r.check_out BETWEEN ? AND ?
        AND gr.state IS NULL AND COALESCE(gr.bad_guest, 0) = 0 AND COALESCE(g.tags, '') !~ '(^|,)blacklist(,|$)'
      ORDER BY r.check_out, r.id LIMIT 200`, from, today);
    const rows: Record<string, unknown>[] = [];
    let noTemplate = 0;
    const templates = await all<{ id: string; body: string; use_count: number }>(env, `SELECT id, body, use_count FROM guest_review_templates WHERE is_active = 1 ORDER BY use_count, last_used_at NULLS FIRST, id`);
    const uses = new Map(templates.map(t => [t.id, Number(t.use_count)]));
    for (const s of stays) {
      // Its checkout time has passed and the window is still open.
      const checkedOut = Date.parse(guestReviewDeadline(s.check_out, s.check_out_time)) - GUEST_REVIEW_WINDOW_DAYS * 864e5 <= now.getTime();
      if (!checkedOut || Date.parse(guestReviewDeadline(s.check_out, s.check_out_time)) <= now.getTime()) continue;
      const rule = rules.find(ru => ru.condition === 'always' || (ru.condition === 'no_issues' && s.no_issues));
      if (!rule) continue;
      if (!templates.length) { noTemplate++; continue; }
      // Random among the three least used so far, counting the ones this run already picked.
      const least = [...templates].sort((a, b) => (uses.get(a.id)! - uses.get(b.id)!)).slice(0, 3);
      const t = least[Math.floor(Math.random() * least.length)];
      uses.set(t.id, uses.get(t.id)! + 1);
      const auto = rule.mode === 'auto';
      rows.push({
        id: crypto.randomUUID(), reservation_id: s.id, state: auto ? 'scheduled' : 'needs_approval', rule_id: rule.id, template_id: t.id,
        cleanliness: rule.cleanliness, communication: rule.communication, respect_house_rules: rule.respect_house_rules,
        public_review: fillTemplate(t.body, { guest: s.guest_name, unit: s.unit_label }), recommend: rule.recommend, tags: parseTags(rule.tags).length ? parseTags(rule.tags) : null,
        send_after: now.toISOString(),
      });
      rep.items.push(`${auto ? 'write and send' : 'write for approval'}: ${s.guest_name}, ${s.unit_label}, checked out ${s.check_out} (rule "${rule.name}")`);
      if (auto) rep.written++; else rep.approval++;
    }
    if (noTemplate) rep.items.push(`${noTemplate} stays met a rule but no template is active: add one under Templates.`);
    if (rows.length && !o.dryRun) {
      const at = nowIso();
      await run(env, `
        INSERT INTO guest_reviews (id, reservation_id, state, source, rule_id, template_id, cleanliness, communication, respect_house_rules, public_review, recommend, tags, send_after, written_at, created_at, updated_at)
        SELECT x.id, x.reservation_id, x.state, 'rule', x.rule_id, x.template_id, x.cleanliness, x.communication, x.respect_house_rules, x.public_review, x.recommend, x.tags, x.send_after, ?, ?, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, reservation_id text, state text, rule_id text, template_id text, cleanliness int, communication int, respect_house_rules int, public_review text, recommend int, tags jsonb, send_after text)
        ON CONFLICT (reservation_id) DO UPDATE SET state = EXCLUDED.state, source = 'rule', rule_id = EXCLUDED.rule_id, template_id = EXCLUDED.template_id,
          cleanliness = EXCLUDED.cleanliness, communication = EXCLUDED.communication, respect_house_rules = EXCLUDED.respect_house_rules,
          public_review = EXCLUDED.public_review, recommend = EXCLUDED.recommend, tags = EXCLUDED.tags, send_after = EXCLUDED.send_after,
          written_at = EXCLUDED.written_at, updated_at = EXCLUDED.updated_at
        WHERE guest_reviews.state IS NULL AND guest_reviews.bad_guest = 0`, at, at, at, JSON.stringify(rows));
      await run(env, `UPDATE guest_review_templates t SET use_count = t.use_count + x.n, last_used_at = ?
        FROM (SELECT template_id AS id, count(*)::int AS n FROM jsonb_to_recordset(?::text::jsonb) AS y(template_id text) GROUP BY 1) x WHERE t.id = x.id`, at, JSON.stringify(rows));
      await audit(env, { actorId: null, actorLabel: 'Scheduled job', action: 'guest_review.rules_applied', entityTable: 'guest_reviews', entityId: 'sweep', after: { written: rep.written, approval: rep.approval } });
    }
  }

  const due = await all<{ id: string; state: string; guest_name: string }>(env, `
    SELECT gr.id, gr.state, COALESCE(g.full_name, 'Guest') AS guest_name FROM guest_reviews gr
    JOIN reservations r ON r.id = gr.reservation_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE (gr.state = 'scheduled' AND COALESCE(gr.send_after, '') <= ?)
       OR (gr.state = 'failed' AND gr.attempts > 0 AND gr.attempts < ? AND COALESCE(gr.last_attempt_at, '') <= ?)
    ORDER BY gr.send_after NULLS FIRST, gr.id LIMIT ${SENDS_PER_RUN}`, now.toISOString(), MAX_AUTO_ATTEMPTS, new Date(now.getTime() - RETRY_GAP_MS).toISOString());
  if (o.dryRun) {
    rep.items.push(...due.map(d => `${d.state === 'failed' ? 'retry' : 'send'}: guest review for ${d.guest_name}`));
    return rep;
  }
  for (const d of due) {
    const r = await sendGuestReview(env, d.id, { now });
    if (r.state === 'sent') rep.sent++; else if (r.state === 'scheduled') rep.waiting++; else rep.failed++;
    rep.items.push(`${r.state}: guest review for ${d.guest_name}${r.reason ? ` (${r.reason})` : ''}`);
  }
  return rep;
}
