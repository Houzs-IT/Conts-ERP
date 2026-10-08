import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, clashResponseBody, upsertGuest } from '../../_lib/reservations';
import { syncAvailabilityIfLinked } from '../../_lib/channexSync';
import { CONTACT_ROLES, FILTERS, FILTER_WHERE, SORTS, type GuestFilter, guestTag, monthYear, statsCte, todayAndTomorrow } from '../../_lib/guestList';
import { like } from '../../_lib/bookingList';

const OPS = CONTACT_ROLES;

/** GET /api/guests?q=&filter=&sort=&page=&size= — one page of the guest directory with lifetime
 *  figures, plus the count behind each filter. The full profile is GET /api/guests/:id. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Guest contact details are not available to field roles.', 403);
  const contact = mayWork(session, OPS);

  const sp = new URL(request.url).searchParams;
  const rawFilter = sp.get('filter') ?? '';
  const filter: GuestFilter = (FILTERS as readonly string[]).includes(rawFilter) ? rawFilter as GuestFilter : 'all';
  const sortKey = SORTS[sp.get('sort') ?? ''] ? sp.get('sort')! : 'name';
  const size = Number(sp.get('size'));
  const pageSize = [25, 50, 100].includes(size) ? size : 50;
  const q = (sp.get('q') ?? '').trim().slice(0, 80);

  // Contact fields are only searchable by the roles allowed to see them.
  const conds: string[] = [];
  const args: unknown[] = [];
  if (q) {
    const p = like(q);
    const digits = q.replace(/\D/g, '');
    if (contact) {
      conds.push(`(g.full_name ILIKE ? OR g.email ILIKE ? OR g.phone ILIKE ?${digits.length >= 3 ? ` OR regexp_replace(COALESCE(g.phone, ''), '[^0-9]', '', 'g') LIKE ?` : ''})`);
      args.push(p, p, p, ...(digits.length >= 3 ? [`%${digits}%`] : []));
    } else {
      conds.push('g.full_name ILIKE ?');
      args.push(p);
    }
  }
  const where = conds.length ? conds.join(' AND ') : 'TRUE';
  const { today, tomorrow } = todayAndTomorrow();
  const cte = statsCte(today, tomorrow);

  const counts = await one<Record<GuestFilter, number>>(env, `${cte}
    SELECT ${FILTERS.map(f => `COUNT(*) FILTER (WHERE ${FILTER_WHERE[f]}) AS "${f}"`).join(', ')}
    FROM guests g LEFT JOIN s ON s.guest_id = g.id WHERE ${where}`, ...args);
  const total = Number(counts?.[filter] ?? 0);
  const page = Math.min(Math.max(1, Math.floor(Number(sp.get('page')) || 1)), Math.max(1, Math.ceil(total / pageSize)));

  const rows = total ? await all<any>(env, `${cte}
    SELECT g.id, g.full_name, g.email, g.phone, g.created_at,
           COALESCE(s.bookings, 0) AS bookings, COALESCE(s.stays, 0) AS stays, COALESCE(s.nights, 0) AS nights,
           COALESCE(s.value, 0) AS value, s.last_check_in, s.channel
    FROM guests g LEFT JOIN s ON s.guest_id = g.id
    WHERE ${where} AND ${FILTER_WHERE[filter]}
    ORDER BY ${SORTS[sortKey]} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, ...args) : [];

  return json({
    generatedAt: nowIso(), filter, sort: sortKey, page, pageSize, total,
    counts: Object.fromEntries(FILTERS.map(f => [f, Number(counts?.[f] ?? 0)])),
    data: rows.map(g => ({
      id: g.id, fullName: g.full_name,
      email: contact ? g.email : null, phone: contact ? g.phone : null,
      channel: g.channel ?? 'direct', tag: guestTag(Number(g.stays), Number(g.bookings), g.channel),
      since: `Guest since ${monthYear(g.created_at)}`,
      stays: Number(g.stays), nights: Number(g.nights), lifetimeValue: Number(g.value), lastCheckIn: g.last_check_in ?? null,
    })),
  });
};

/** POST /api/guests { fullName, phone, email, unitNumber, propertyName, guestsCount } — a walk-in: guest plus a stay from today. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, OPS)) return fail('FORBIDDEN', 'Only operations and management can add guests.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.fullName?.trim()) return fail('VALIDATION', 'Enter the guest name.', 422, { fullName: 'Enter the guest name.' });

  const unit = await one<{ id: string }>(env, `
    SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.unit_number = ? AND (? = '' OR p.name = ?) LIMIT 1`, String(b.unitNumber ?? ''), String(b.propertyName ?? ''), String(b.propertyName ?? ''));
  if (!unit) return fail('NOT_FOUND', 'Pick a unit that exists.', 404, { unitNumber: 'Pick a unit.' });

  const d = (await one<{ d: string; t: string }>(env, `
    SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d,
           to_char((now() AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 day', 'YYYY-MM-DD') AS t`))!;
  const clash = await findClash(env, unit.id, d.d, d.t, null);
  if (clash) return json(clashResponseBody(clash), 409);

  const guestId = await upsertGuest(env, { fullName: b.fullName, email: b.email, phone: b.phone });
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
    VALUES (?, ?, ?, 'direct', ?, 'confirmed', ?, ?, ?, 0, 'MYR', ?, ?)`,
    id, unit.id, guestId, `WALK-${id.slice(0, 6).toUpperCase()}`, d.d, d.t, b.guestsCount ?? 1, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest.walk_in', entityTable: 'reservations', entityId: id, after: { guestId, unitId: unit.id } });
  await syncAvailabilityIfLinked(env, unit.id, d.d, d.t, false);
  return json({ id: guestId, reservationId: id }, 201);
};
