import { type Env, all, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { levelsFor } from '../../_lib/access';
import { phoneCore } from '../../_lib/bookingList';

/** A stored phone as the digits after the Malaysian country code or trunk 0, the way phoneCore() reads a typed one. */
const PHONE_CORE = `regexp_replace(regexp_replace(COALESCE(g.phone, ''), '[^0-9]', '', 'g'), '^(60|0)', '')`;

interface Hit {
  id: string; kind: 'unit' | 'guest' | 'reservation' | 'owner'; label: string; sub: string; target: string;
  channel?: string; state?: string; checkIn?: string; checkOut?: string; ref?: string | null;
}

/** GET /api/search?q= — the palette behind the top bar. Empty query returns a few units.
 *  Bookings match their Airbnb / Booking.com / Agoda reference (reservations.external_ref), the guest's
 *  name, phone or email; guests match name, email or phone (digits only, so "+60 12-345" finds 6012345...).
 *  Each result carries raw fields (dates, state, channel) and the screen formats them. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 60);
  const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
  const core = phoneCore(q);
  const phoneLike = core ? `%${core}%` : null;
  // Every word has to match, so "Skyline D25" finds unit D25-13 in Skyline KL.
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5).map(w => `%${w.replace(/[%_\\]/g, m => '\\' + m)}%`);
  const out: Hit[] = [];
  // Each kind of result follows the role's level for its area, like the screens it opens: a role with no access
  // to Reservations finds no bookings or guests here either. Field and owner accounts never reach this.
  if (isFieldRole(session.role)) return json(out);
  const lv = await levelsFor(env, session.role);
  const sees = (area: string) => session.role === 'management' || lv[area] !== 'none';

  const units = !sees('properties') ? [] : await all<any>(env, `
    SELECT u.id, u.unit_number, u.bedrooms, u.readiness, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE ? = '' OR (${words.map(() => `lower(p.name || ' ' || u.unit_number || ' ' || COALESCE(u.listing_name, '')) LIKE ?`).join(' AND ') || 'FALSE'})
    ORDER BY p.name, u.unit_number LIMIT 6`, q, ...words);
  for (const u of units) {
    out.push({ id: u.id, kind: 'unit', label: `${u.property_name} ${u.unit_number}`, sub: `${u.bedrooms} bedroom${Number(u.bedrooms) === 1 ? '' : 's'}`, state: u.readiness, target: `/properties/units/${encodeURIComponent(u.id)}` });
  }
  if (!q) return json(out);

  // A pasted booking reference is the most common search, so exact reference matches come first.
  const bookings = !sees('reservations') ? [] : await all<any>(env, `
    SELECT r.id, r.external_ref, r.channel, r.check_in, r.check_out, r.state, u.unit_number, p.name AS property_name, g.full_name
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE lower(COALESCE(r.external_ref, '')) LIKE ? OR lower(COALESCE(g.full_name, '')) LIKE ? OR lower(COALESCE(g.email, '')) LIKE ?
       ${phoneLike ? `OR ${PHONE_CORE} LIKE ?` : ''}
    ORDER BY (lower(COALESCE(r.external_ref, '')) = ?) DESC, (r.state IN ('cancelled', 'no_show')) ASC, r.check_in DESC LIMIT 6`,
    like, like, like, ...(phoneLike ? [phoneLike] : []), q);
  for (const r of bookings) {
    const ref = r.external_ref as string | null;
    out.push({
      id: r.id, kind: 'reservation', label: r.full_name ?? 'No guest name', sub: `${r.property_name} ${r.unit_number}`,
      channel: r.channel, state: r.state, checkIn: r.check_in, checkOut: r.check_out, ref,
      // The Bookings list filters by reference (or guest), across every date, so the booking is the one row shown.
      target: ref ? `/reservations/bookings?view=all&ref=${encodeURIComponent(ref)}` : `/reservations/bookings?view=all&guest=${encodeURIComponent(r.full_name ?? '')}`,
    });
  }

  const guests = !sees('reservations') ? [] : await all<any>(env, `
    SELECT g.id, g.full_name, g.email, g.phone FROM guests g
    WHERE lower(g.full_name || ' ' || COALESCE(g.email, '')) LIKE ?
       ${phoneLike ? `OR ${PHONE_CORE} LIKE ?` : ''}
    ORDER BY g.full_name LIMIT 4`, like, ...(phoneLike ? [phoneLike] : []));
  for (const g of guests) out.push({ id: g.id, kind: 'guest', label: g.full_name, sub: g.email || g.phone || 'No contact details', target: `/reservations/guests?g=${encodeURIComponent(g.id)}` });

  if (sees('owners')) {
    const owners = await all<any>(env, `
      SELECT o.id, o.display_name, o.email, (SELECT count(*)::int FROM units u WHERE u.owner_id = o.id) AS units
      FROM owners o WHERE lower(o.display_name || ' ' || COALESCE(o.email, '')) LIKE ? ORDER BY o.display_name LIMIT 4`, like);
    for (const o of owners) out.push({ id: o.id, kind: 'owner', label: o.display_name, sub: `${o.units} unit${Number(o.units) === 1 ? '' : 's'}${o.email ? ` · ${o.email}` : ''}`, target: `/owners/${encodeURIComponent(o.id)}` });
  }
  return json(out);
};
