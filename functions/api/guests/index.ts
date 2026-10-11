import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { CONTACT_ROLES, FILTERS, filterWhere, guestSort, type GuestFilter, guestTags, monthYear, statsCte, todayAndTomorrow, hasGuestColumns, MISSING_ID } from '../../_lib/guestList';
import { like } from '../../_lib/bookingList';
import { countryCode } from '../../_lib/hostplatformImport';
import { checkPhone, invalid, type Fields } from '../../_lib/validate';

const OPS = CONTACT_ROLES;

/** GET /api/guests?q=&filter=&sort=<key>[:asc|desc]&page=&size= — one page of the guest directory with lifetime
 *  figures, plus the count behind each filter. The full profile is GET /api/guests/:id. Merged duplicates are hidden. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Guest contact details are not available to cleaners and technicians.', 403);
  const contact = mayWork(session, OPS);
  const cols = await hasGuestColumns(env);

  const sp = new URL(request.url).searchParams;
  const rawFilter = sp.get('filter') ?? '';
  const filter: GuestFilter = (FILTERS as readonly string[]).includes(rawFilter) ? rawFilter as GuestFilter : 'all';
  const sort = guestSort(sp.get('sort'));
  const size = Number(sp.get('size'));
  // export=1: the table's Export reads every matching guest in pages of up to 1,000.
  const pageSize = sp.get('export') === '1' && Number.isInteger(size) && size >= 1 && size <= 1000 ? size : [25, 50, 100].includes(size) ? size : 50;
  const q = (sp.get('q') ?? '').trim().slice(0, 80);
  const except = (sp.get('except') ?? '').slice(0, 80);

  // Contact fields are only searchable by the roles allowed to see them.
  const conds: string[] = cols ? ['g.merged_into IS NULL'] : [];
  const args: unknown[] = [];
  if (except) { conds.push('g.id <> ?'); args.push(except); }
  if (q) {
    const p = like(q);
    const digits = q.replace(/\D/g, '');
    if (contact) {
      conds.push(`(g.full_name ILIKE ? OR g.email ILIKE ? OR g.phone ILIKE ?${digits.length >= 3 ? ` OR regexp_replace(COALESCE(g.phone, ''), '[^0-9]', '', 'g') LIKE ?` : ''}
        OR EXISTS (SELECT 1 FROM reservations rr WHERE rr.guest_id = g.id AND rr.external_ref ILIKE ?))`);
      args.push(p, p, p, ...(digits.length >= 3 ? [`%${digits}%`] : []), p);
    } else {
      conds.push('g.full_name ILIKE ?');
      args.push(p);
    }
  }
  const where = conds.length ? conds.join(' AND ') : 'TRUE';
  const { today, tomorrow } = todayAndTomorrow();
  const cte = statsCte(today, tomorrow);

  const counts = await one<Record<GuestFilter, number>>(env, `${cte}
    SELECT ${FILTERS.map(f => `COUNT(*) FILTER (WHERE ${filterWhere(f, cols)}) AS "${f}"`).join(', ')}
    FROM guests g LEFT JOIN s ON s.guest_id = g.id WHERE ${where}`, ...args);
  const total = Number(counts?.[filter] ?? 0);
  const page = Math.min(Math.max(1, Math.floor(Number(sp.get('page')) || 1)), Math.max(1, Math.ceil(total / pageSize)));

  const rows = total ? await all<any>(env, `${cte}
    SELECT g.id, g.full_name, g.email, g.phone, g.created_at, g.country_code,
           ${cols ? `g.tags, (COALESCE(s.live, false) AND ${MISSING_ID}) AS missing_id` : `'' AS tags, false AS missing_id`},
           COALESCE(s.stays, 0) AS stays, COALESCE(s.upcoming, 0) AS upcoming, COALESCE(s.nights, 0) AS nights,
           COALESCE(s.value, 0) AS value, s.last_check_in, s.channel
    FROM guests g LEFT JOIN s ON s.guest_id = g.id
    WHERE ${where} AND ${filterWhere(filter, cols)}
    ORDER BY ${sort.sql} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, ...args) : [];

  return json({
    generatedAt: nowIso(), filter, sort: `${sort.key}:${sort.dir}`, page, pageSize, total, registrationReady: cols,
    counts: Object.fromEntries(FILTERS.map(f => [f, Number(counts?.[f] ?? 0)])),
    data: rows.map(g => ({
      id: g.id, fullName: g.full_name,
      email: contact ? g.email : null, phone: contact ? g.phone : null, countryCode: g.country_code ?? null,
      channel: g.channel ?? 'direct', tags: guestTags(Number(g.stays), g.channel, g.tags), missingId: !!g.missing_id,
      since: `Guest since ${monthYear(g.created_at)}`,
      stays: Number(g.stays), upcoming: Number(g.upcoming), nights: Number(g.nights), lifetimeValue: Number(g.value), lastCheckIn: g.last_check_in ?? null,
    })),
  });
};

/** POST /api/guests { fullName, phone?, email?, countryCode?, language? } — the guest's record only. A stay is booked
 *  separately (Book a stay), with its own unit and dates: this never creates a booking. A guest with the same email
 *  or phone already on file is not duplicated; the answer says which happened. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, OPS)) return fail('FORBIDDEN', 'Only operations and management can add guests.', 403);

  const b = await request.json<any>().catch(() => null);
  const fullName = typeof b?.fullName === 'string' ? b.fullName.trim().slice(0, 200) : '';
  if (!fullName) return fail('VALIDATION', 'Enter the guest name.', 422, { fullName: 'Enter the guest name.' });
  const email = typeof b.email === 'string' && b.email.trim() ? b.email.trim().slice(0, 200) : null;
  const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 40) : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('VALIDATION', 'That email does not look right.', 422, { email: 'Check the email.' });
  const fields: Fields = {};
  checkPhone(fields, 'phone', b.phone, { label: 'Phone' });
  const bad = invalid(fields); if (bad) return bad;

  const found = email
    ? await one<{ id: string; full_name: string }>(env, 'SELECT id, full_name FROM guests WHERE lower(email) = lower(?) ORDER BY created_at LIMIT 1', email)
    : phone ? await one<{ id: string; full_name: string }>(env, 'SELECT id, full_name FROM guests WHERE phone = ? ORDER BY created_at LIMIT 1', phone) : null;
  if (found) return json({ id: found.id, created: false, existingName: found.full_name });

  const id = crypto.randomUUID(), now = nowIso();
  const cc = b.countryCode ? countryCode(String(b.countryCode)) : null;
  await run(env, 'INSERT INTO guests (id, full_name, email, phone, country_code, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, fullName, email, phone, cc, now);
  if (typeof b.language === 'string' && b.language.trim() && await hasGuestColumns(env)) {
    await run(env, 'UPDATE guests SET language = ? WHERE id = ?', b.language.trim().slice(0, 40), id);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest.create', entityTable: 'guests', entityId: id, after: { hasEmail: !!email, hasPhone: !!phone } });
  return json({ id, created: true }, 201);
};
