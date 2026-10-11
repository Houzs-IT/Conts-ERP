import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { CONTACT_ROLES, guestTags, monthYear, todayAndTomorrow, hasGuestColumns, maskId, MANUAL_TAGS } from '../../_lib/guestList';
import { countryCode } from '../../_lib/hostplatformImport';
import { checkPhone, isIsoDate } from '../../_lib/validate';
import { moneySchema, moneySql } from '../../_lib/bookingMoney';
import { countryJoin, countryName } from '../../_lib/guestCountry';

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
const at = (date: string, time: string) => `${date}T${time}:00+08:00`;
const ID_TYPES = ['mykad', 'passport', 'other'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/guests/:id — one guest's profile: lifetime figures (upcoming stays included), tags, registration details
 *  (the ID number masked to its last four), internal notes, stay history and today/tomorrow movement. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Guest contact details are not available to field roles.', 403);
  const contact = mayWork(session, CONTACT_ROLES);
  const cols = await hasGuestColumns(env);

  const g = await one<any>(env, `SELECT id, full_name, email, phone, country_code, created_at${cols ? ', tags, language, id_type, id_number, date_of_birth, notes, merged_into' : ''} FROM guests WHERE id = ?`, String(params.id));
  if (!g) return fail('NOT_FOUND', 'That guest does not exist.', 404);
  // A merged duplicate opens as the guest it was merged into.
  if (g.merged_into) return json({ redirectTo: g.merged_into }, 200);

  const { today, tomorrow } = todayAndTomorrow();
  const schema = await moneySchema(env);
  const m = moneySql(schema);
  // Every stay, cancelled ones too (listed, not counted), with its money read by the same rules as the reservation
  // drawer (functions/_lib/bookingMoney.ts) and the times the guest actually arrived and left, when someone marked them.
  const every = await all<any>(env, `
    SELECT r.id, r.channel, r.state, r.check_in, r.check_out, r.check_in_time, r.check_out_time, r.guests_count, r.external_ref,
           r.gross_booking_value, r.channel_fee, u.unit_number, u.readiness, p.name AS property_name,
           ${m.expected} AS expected, ${m.received} AS received, ${m.outstanding} AS outstanding,
           ${schema.payments ? `(SELECT MAX(bp2.received_on) FROM booking_payments bp2 WHERE bp2.reservation_id = r.id AND bp2.status = 'received' AND bp2.kind <> 'refund')` : 'NULL'} AS paid_on,
           ${schema.payoutCols ? 'r.payout_date' : 'NULL'} AS payout_date,
           (SELECT MIN(a.occurred_at) FROM audit_log a WHERE a.entity_table = 'reservations' AND a.entity_id = r.id
              AND a.action = 'reservation.status' AND a.after_state LIKE '%"state":"checked_in"%') AS arrived_at,
           (SELECT MAX(a.occurred_at) FROM audit_log a WHERE a.entity_table = 'reservations' AND a.entity_id = r.id
              AND a.action = 'reservation.status' AND a.after_state LIKE '%"state":"checked_out"%') AS left_at,
           (SELECT MIN(t.created_at) FROM tasks t WHERE t.reservation_id = r.id) AS prepared_at,
           (SELECT MAX(n.sent_at) FROM notification_log n WHERE n.template = 'access_details' AND n.entity_id = r.id) AS access_sent_at,
           (SELECT AVG(v.rating) FROM reviews v WHERE v.reservation_id = r.id) AS rating
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id ${m.join}
    WHERE r.guest_id = ? AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.state <> 'inquiry'
    ORDER BY r.check_in DESC`, g.id);
  const mine = every.filter(s => s.state !== 'cancelled' && s.state !== 'no_show');
  const reviews = every.length ? await all<any>(env, `SELECT reservation_id, rating, comment, reply, replied_at, reviewed_at FROM reviews
    WHERE reservation_id IN (${every.map(() => '?').join(', ')}) ORDER BY reviewed_at DESC`, ...every.map(s => s.id)) : [];
  const where = await one<{ iso: string | null; src: string | null }>(env, `SELECT gc.iso, gc.src FROM guests g
    ${countryJoin('gc', { guest: 'g' })} WHERE g.id = ?`, g.id);
  // The stay that matters now: the one under way, else the next one coming.
  const current = mine.find(s => s.state === 'checked_in')
    ?? mine.filter(s => ['confirmed', 'pending'].includes(s.state) && s.check_out >= today).sort((a, b) => a.check_in.localeCompare(b.check_in))[0]
    ?? null;

  const upcoming = mine.filter(s => (s.state === 'confirmed' || s.state === 'pending') && s.check_in >= today);
  const live = mine.some(s => ['confirmed', 'pending', 'checked_in'].includes(s.state) && s.check_out >= today);
  const ratings = mine.map(s => s.rating).filter(x => x !== null).map(Number);

  let movement: Record<string, unknown> | undefined;
  const candidates = mine.flatMap(s => {
    const out: { kind: 'arrival' | 'departure'; day: 'today' | 'tomorrow'; s: any }[] = [];
    if ((s.state === 'confirmed' || s.state === 'pending' || s.state === 'checked_in') && (s.check_in === today || s.check_in === tomorrow)) out.push({ kind: 'arrival', day: s.check_in === today ? 'today' : 'tomorrow', s });
    if ((s.state === 'checked_in' || s.state === 'checked_out') && (s.check_out === today || s.check_out === tomorrow)) out.push({ kind: 'departure', day: s.check_out === today ? 'today' : 'tomorrow', s });
    return out;
  }).sort((a, b) => (a.day === b.day ? (a.kind === 'arrival' ? -1 : 1) : a.day === 'today' ? -1 : 1));
  if (candidates[0]) {
    const { kind, day, s } = candidates[0];
    movement = {
      reservationId: s.id, kind, day,
      checkInAt: at(s.check_in, s.check_in_time), checkOutAt: at(s.check_out, s.check_out_time),
      unitNumber: s.unit_number, propertyName: s.property_name, channel: s.channel,
      nights: nightsBetween(s.check_in, s.check_out), guestsCount: s.guests_count,
      state: s.state, readiness: s.readiness, preparedAt: s.prepared_at, accessSentAt: s.access_sent_at,
    };
  }

  const latest = mine[0]?.channel ?? null;
  const reg = cols ? {
    idType: g.id_type ?? null, idNumberMasked: contact ? maskId(g.id_number) : null, hasIdNumber: !!g.id_number,
    dateOfBirth: contact ? g.date_of_birth ?? null : null, countryCode: g.country_code ?? null,
  } : { idType: null, idNumberMasked: null, hasIdNumber: false, dateOfBirth: null, countryCode: g.country_code ?? null };
  const missing = [!reg.idType && 'ID type', !reg.hasIdNumber && 'ID number', !g.date_of_birth && 'date of birth', !g.country_code && 'nationality'].filter(Boolean) as string[];
  return json({
    id: g.id, fullName: g.full_name,
    email: contact ? g.email : null, phone: contact ? g.phone : null, language: cols ? g.language ?? null : null,
    channel: latest ?? 'direct', tags: guestTags(mine.length, latest, cols ? g.tags : ''), manualTags: cols ? String(g.tags ?? '').split(',').filter(Boolean) : [],
    since: `Guest since ${monthYear(g.created_at)}`,
    stays: mine.length, upcoming: upcoming.length,
    nights: mine.reduce((n, s) => n + nightsBetween(s.check_in, s.check_out), 0),
    lifetimeValue: mine.reduce((n, s) => n + Number(s.gross_booking_value), 0),
    ratingScore: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : null,
    registration: { ...reg, missing, required: live },
    // Where the guest is from: the stored nationality, else the country of their phone.
    country: where?.iso ? { code: where.iso, name: countryName(where.iso), from: where.src } : null,
    currentStayId: current?.id ?? null,
    notes: contact && cols ? g.notes ?? null : null,
    can: { edit: contact && cols, reveal: !!session.manage && cols, merge: contact && cols },
    history: every.map(s => ({
      reservationId: s.id, externalRef: s.external_ref, checkIn: s.check_in, checkOut: s.check_out, unitNumber: s.unit_number, propertyName: s.property_name,
      nights: nightsBetween(s.check_in, s.check_out), channel: s.channel, value: Number(s.gross_booking_value), state: s.state,
      guestsCount: s.guests_count, rating: s.rating == null ? null : Number(Number(s.rating).toFixed(1)),
      checkInTime: s.check_in_time, checkOutTime: s.check_out_time, arrivedAt: s.arrived_at ?? null, leftAt: s.left_at ?? null,
      money: {
        guestTotal: Number(s.gross_booking_value), serviceFee: Number(s.channel_fee), expected: Number(s.expected ?? 0),
        received: Number(s.received ?? 0), outstanding: ['cancelled', 'no_show'].includes(s.state) ? 0 : Number(s.outstanding ?? 0),
        paidOn: s.paid_on ?? (s.payout_date ? String(s.payout_date).slice(0, 10) : null),
      },
      reviews: reviews.filter(v => v.reservation_id === s.id).map(v => ({
        rating: Number(v.rating), comment: v.comment ?? null, reply: v.reply ?? null,
        reviewedAt: String(v.reviewed_at).slice(0, 10), repliedAt: v.replied_at ? String(v.replied_at).slice(0, 10) : null,
      })),
    })),
    ...(movement ? { movement } : {}),
  });
};

/** PATCH /api/guests/:id { fullName?, email?, phone?, language?, countryCode?, idType?, idNumber?, dateOfBirth?, notes?, tags? }
 *  Contact, registration details, internal notes and the manual tags (vip, blacklist). Audited; the ID number itself
 *  never goes into the audit log, only that it changed. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, CONTACT_ROLES)) return fail('FORBIDDEN', 'Only operations and management can change guest details.', 403);
  if (!(await hasGuestColumns(env))) return fail('NOT_READY', 'Guest details are not set up on this database yet (migration 0091).', 503);

  const id = String(params.id);
  const g = await one<any>(env, 'SELECT * FROM guests WHERE id = ?', id);
  if (!g) return fail('NOT_FOUND', 'That guest does not exist.', 404);
  const b = await request.json<any>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to change.', 422);

  const text = (v: unknown, max: number) => (v === null ? null : String(v).trim().slice(0, max) || null);
  const next: Record<string, string | null> = {};
  const errs: Record<string, string> = {};
  if (b.fullName !== undefined) { const v = text(b.fullName, 200); if (!v) errs.fullName = 'Enter the guest name.'; else next.full_name = v; }
  if (b.email !== undefined) { const v = text(b.email, 200); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errs.email = 'Check the email.'; else next.email = v; }
  if (b.phone !== undefined) { checkPhone(errs, 'phone', b.phone, { label: 'Phone' }); if (!errs.phone) next.phone = text(b.phone, 40); }
  if (b.language !== undefined) next.language = text(b.language, 40);
  if (b.countryCode !== undefined) { const v = b.countryCode ? countryCode(String(b.countryCode)) : null; if (b.countryCode && !v) errs.countryCode = 'Pick a country.'; else next.country_code = v; }
  if (b.idType !== undefined) { const v = b.idType || null; if (v && !ID_TYPES.includes(v)) errs.idType = 'Pick MyKad, passport or other.'; else next.id_type = v; }
  if (b.idNumber !== undefined) next.id_number = text(b.idNumber, 40);
  if (b.dateOfBirth !== undefined) {
    const v = b.dateOfBirth || null;
    if (v && (!ISO_DAY.test(v) || !isIsoDate(v) || v > todayAndTomorrow().today || v < '1900-01-01')) errs.dateOfBirth = 'Pick a real date of birth.'; else next.date_of_birth = v;
  }
  if (b.notes !== undefined) next.notes = text(b.notes, 4000);
  if (b.tags !== undefined) {
    const list = Array.isArray(b.tags) ? [...new Set(b.tags.map(String))] : null;
    if (!list || list.some(t => !(MANUAL_TAGS as readonly string[]).includes(t as string))) errs.tags = 'Tags can be VIP and Blacklist.';
    else next.tags = MANUAL_TAGS.filter(t => list.includes(t)).join(',');
  }
  if (Object.keys(errs).length) return fail('VALIDATION', Object.values(errs)[0], 422, errs);

  const changed = Object.entries(next).filter(([k, v]) => (g[k] ?? null) !== (k === 'tags' ? v ?? '' : v));
  if (!changed.length) return json({ id, changed: false });
  await run(env, `UPDATE guests SET ${changed.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...changed.map(([k, v]) => (k === 'tags' ? v ?? '' : v)), id);
  const SECRET = new Set(['id_number', 'date_of_birth', 'notes', 'email', 'phone']);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'guest.update', entityTable: 'guests', entityId: id,
    before: Object.fromEntries(changed.map(([k]) => [k, SECRET.has(k) ? (g[k] ? 'set' : 'empty') : g[k] ?? null])),
    after: Object.fromEntries(changed.map(([k, v]) => [k, SECRET.has(k) ? (v ? 'set' : 'empty') : v])),
  });
  return json({ id, changed: true, fields: changed.map(([k]) => k) });
};

