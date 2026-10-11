import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, clashResponseBody, upsertGuest, nextBookingRef, holdOnChannels, withUnitLock } from '../../_lib/reservations';
import { VIEWS, TODOS, FACETS, fromSql, columnsSql, parseListQuery, viewWhere, todoWhere, toRow } from '../../_lib/bookingList';
import { countryName } from '../../_lib/guestCountry';
import { moneySchema, moneySql } from '../../_lib/bookingMoney';
import { checkSen, checkInt, checkDate, checkPhone, invalid, type Fields } from '../../_lib/validate';
import { bookingNotice } from '../../_lib/notices';

/** GET /api/reservations?view=&todo=&ch=&building=&st=&country=&from=&to=&nightsMin=&nightsMax=&page=&size=&sort=&q=&ref=&guest=&unit=&stay=&gross=&status=
 *  One page of the Bookings list; each tab's count and each to-do card's count and amount under the same searches
 *  and filters; and the totals of the whole filtered set (not just the page). Blocks and owner stays are not listed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Bookings are not available to field roles.', 403);

  const q = parseListQuery(new URL(request.url));
  const schema = await moneySchema(env);
  const m = moneySql(schema);
  const todo = q.todo ? todoWhere(q.todo, q.today, schema) : 'TRUE';
  const current = `${viewWhere(q.view, q.today)} AND ${todo}`;
  const sums = await one<Record<string, number>>(env, `
    SELECT ${VIEWS.map(v => `COUNT(*) FILTER (WHERE ${viewWhere(v, q.today)} AND ${todo}) AS "v_${v}"`).join(',\n           ')},
           ${TODOS.map(t => `COUNT(*) FILTER (WHERE ${todoWhere(t, q.today, schema)}) AS "t_${t}", COALESCE(SUM(${m.outstanding}) FILTER (WHERE ${todoWhere(t, q.today, schema)}), 0) AS "o_${t}"`).join(',\n           ')},
           COUNT(*) FILTER (WHERE ${current}) AS n,
           COALESCE(SUM(r.check_out::date - r.check_in::date) FILTER (WHERE ${current}), 0) AS nights,
           COALESCE(SUM(r.gross_booking_value) FILTER (WHERE ${current}), 0) AS gross,
           COALESCE(SUM(r.channel_fee) FILTER (WHERE ${current}), 0) AS fees,
           COALESCE(SUM(${m.outstanding}) FILTER (WHERE ${current} AND r.state NOT IN ('cancelled','no_show')), 0) AS outstanding
    ${fromSql(schema)} WHERE ${q.where}`, ...q.args);

  const total = Number(sums?.n ?? 0);
  const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));
  const rows = total ? await all<any>(env, `
    SELECT ${columnsSql(schema)} ${fromSql(schema)} WHERE ${q.where} AND ${current}
    ORDER BY ${q.orderBy} LIMIT ${q.pageSize} OFFSET ${(page - 1) * q.pageSize}`, ...q.args) : [];

  // What each filter can pick from, with how many bookings each choice would show under everything else on screen
  // (the tab, the card, the search and the other filters), so the Filter panel offers the data's own values.
  const FACET_SQL: Record<typeof FACETS[number], string> = { ch: 'r.channel', building: 'u.property_id', st: 'r.state', country: 'gc.iso' };
  const facetRows = await Promise.all(FACETS.map(f => {
    const w = q.whereExcept(f);
    return all<{ v: string | null; n: number }>(env, `SELECT ${FACET_SQL[f]} AS v, COUNT(*) AS n ${fromSql(schema)}
      WHERE ${w.where} AND ${current} GROUP BY 1 ORDER BY 2 DESC LIMIT 300`, ...w.args);
  }));
  const facets = Object.fromEntries(FACETS.map((f, i) => [f, facetRows[i].map(r => ({ value: r.v ?? 'none', count: Number(r.n) }))]));
  facets.country = facets.country.map(c => ({ ...c, label: c.value === 'none' ? 'Not known' : countryName(c.value) ?? c.value }));
  const buildings = await all<{ id: string; name: string }>(env, 'SELECT id, name FROM properties ORDER BY name');
  return json({
    generatedAt: nowIso(), today: q.today, view: q.view, todo: q.todo, filters: q.filters, page, pageSize: q.pageSize, total,
    counts: Object.fromEntries(VIEWS.map(v => [v, Number(sums?.[`v_${v}`] ?? 0)])),
    todos: Object.fromEntries(TODOS.map(t => [t, { count: Number(sums?.[`t_${t}`] ?? 0), outstanding: Number(sums?.[`o_${t}`] ?? 0) }])),
    totals: { bookings: total, nights: Number(sums?.nights ?? 0), gross: Number(sums?.gross ?? 0), fees: Number(sums?.fees ?? 0), outstanding: Number(sums?.outstanding ?? 0) },
    paymentsReady: schema.payments,
    buildings,
    facets,
    data: rows.map(toRow),
  });
};

const CHANNELS = ['airbnb', 'booking_com', 'agoda', 'direct', 'owner_stay'];
const OTA = ['airbnb', 'booking_com', 'agoda'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** POST /api/reservations { unitId, channel, guest | guestId, checkIn, checkOut, guestsCount, grossBookingValue, externalRef?, notes? }
 *  A direct booking or an owner stay gets our own TC-YYMM-#### reference; a booking-site booking typed in by hand
 *  keeps the site's reference when one is given. The nights are closed on the booking sites (when the unit is linked). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot create reservations.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.unitId || !b.checkIn || !b.checkOut) return fail('VALIDATION', 'Unit and dates are required.', 422);
  const fields: Fields = {};
  checkDate(fields, 'checkIn', b.checkIn, { label: 'Check-in', required: true });
  checkDate(fields, 'checkOut', b.checkOut, { label: 'Check-out', required: true });
  checkInt(fields, 'guestsCount', b.guestsCount, { label: 'Guests', min: 1 });
  checkSen(fields, 'grossBookingValue', b.grossBookingValue, { label: 'Guest total' });
  checkPhone(fields, 'guest.phone', b.guest?.phone, { label: 'Phone' });
  const bad = invalid(fields); if (bad) return bad;
  if (b.checkOut <= b.checkIn) return fail('VALIDATION', 'Check-out must be after check-in.', 422, { checkOut: 'Check-out must be after check-in.' });
  const channel = b.channel ?? 'direct';
  if (!CHANNELS.includes(channel)) return fail('VALIDATION', 'Unknown channel.', 422, { channel: 'Pick a channel.' });
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', b.unitId))) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  for (const k of ['checkInTime', 'checkOutTime'] as const) if (b[k] != null && !TIME.test(String(b[k]))) return fail('VALIDATION', 'Times are HH:MM.', 422, { [k]: 'Use HH:MM, e.g. 15:00.' });

  const id = crypto.randomUUID(), now = nowIso();
  const siteRef = typeof b.externalRef === 'string' && b.externalRef.trim() ? b.externalRef.trim().slice(0, 60) : null;
  const staffNotes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 2000) : null;
  const saved = await withUnitLock(env, b.unitId, async tx => {
    const clash = await findClash(tx, b.unitId, b.checkIn, b.checkOut, null);
    if (clash) return { clash, ref: '' };
    const guestId = b.guest?.fullName ? await upsertGuest(tx, b.guest) : (b.guestId ?? null);
    const ref = OTA.includes(channel) && siteRef ? siteRef : await nextBookingRef(tx, id);
    await run(tx, `
      INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, check_in_time, check_out_time, guests_count, gross_booking_value, currency, created_at, updated_at, staff_notes)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, 'MYR', ?, ?, ?)`,
      id, b.unitId, channel === 'owner_stay' && !b.guest?.fullName ? null : guestId, channel, ref, b.checkIn, b.checkOut,
      b.checkInTime ?? '15:00', b.checkOutTime ?? '11:00',
      b.guestsCount ?? 1, channel === 'owner_stay' ? 0 : Math.max(0, Math.round(Number(b.grossBookingValue) || 0)), now, now, staffNotes);
    return { clash: null, ref };
  });
  if (saved.clash) return json(clashResponseBody(saved.clash), 409);
  const ref = saved.ref;

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.create', entityTable: 'reservations', entityId: id, after: { unitId: b.unitId, checkIn: b.checkIn, checkOut: b.checkOut, channel, externalRef: ref } });
  const sync = await holdOnChannels(env, b.unitId, b.checkIn, b.checkOut, false, id);
  await bookingNotice(env, id, 'created', session.userId);
  return json({ id, externalRef: ref, effects: { channel: sync } }, 201);
};
