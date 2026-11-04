import { type Env, all, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { levelsFor } from '../../_lib/access';
import { quickSearch } from '../../_lib/bookingList';
import { guestSearch } from '../../_lib/guestList';
import { engineSearchOpen, mayUseScmEngine, scmEngineConfigured, searchEngine, type EngineSearch } from '../../_lib/scmEngine';
import { menuPathFor } from '../../../src/lib/scmEngine';

/** The supply chain kinds, read by the engine (engine/backend/src/services/renovation/renovationSearch.ts). */
const ENGINE_KINDS = ['project', 'customer', 'quotation', 'sales_order', 'delivery_order', 'sales_invoice', 'purchase_order', 'grn',
  'purchase_invoice', 'supplier', 'product', 'service_case'] as const;

interface Hit {
  id: string; kind: string; label: string; sub: string; target: string;
  channel?: string; state?: string; checkIn?: string; checkOut?: string; ref?: string | null; date?: string | null;
}

/** Results shown per kind in the box; one more is read so the box knows to offer "See all". */
const SHOWN = 5;
/** "See all" for one kind. */
const ALL = 50;

/** The menu address that shows an engine screen, with the screen itself in ?engine= (App.tsx opens it inside the frame).
 *  A screen with no menu entry of its own (a service case) opens under the list it belongs to. */
function engineTarget(path: string): string | null {
  const menu = menuPathFor(path) ?? (path.startsWith('/assr/') ? '/service/cases' : null);
  return menu ? `${menu}?engine=${encodeURIComponent(path)}` : null;
}

/** GET /api/search?q=[&kind=] — the box behind the top bar (and Ctrl/Cmd+K). Empty query returns a few units.
 *  Rental records are read here: bookings by their Airbnb / Booking.com / Agoda reference (reservations.external_ref),
 *  the guest's name, phone or email; guests by name, email or phone (digits only, so "+60 12-345" finds 6012345...);
 *  units and buildings by name (every word must match, and "D2513" finds D25-13); owners; maintenance jobs.
 *  Supply chain records (projects, customers, quotations, orders, deliveries, invoices, purchase orders, goods received,
 *  suppliers, products, service cases) are asked of the engine on the person's behalf. Every kind follows the person's
 *  level in its area, like the screen it opens. Up to SHOWN + 1 of each kind (the screen shows SHOWN and offers "See
 *  all"); with kind=, up to ALL of that kind alone. Each result carries raw fields and the screen formats them. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').trim().toLowerCase().slice(0, 60);
  const only = params.get('kind');
  const want = (k: string) => !only || only === k;
  const n = (only ? ALL : SHOWN) + 1;
  const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
  // Every word has to match, so "Skyline D25" finds unit D25-13 in Skyline KL.
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5).map(w => `%${w.replace(/[%_\\]/g, m => '\\' + m)}%`);
  // The letters and digits alone, so "d2513" or "D25 13" finds unit D25-13.
  const compact = q.replace(/[^a-z0-9]+/g, '');
  const key = compact.length >= 3 ? `%${compact}%` : '';
  const out: Hit[] = [];
  // Field and owner accounts never reach this (the middleware refuses them); the check stays for safety.
  if (isFieldRole(session.role)) return json(out);
  const lv = await levelsFor(env, session);
  const sees = (area: string) => session.role === 'management' || (lv[area] ?? 'none') !== 'none';

  // The engine is asked first so its answer is on the way while the rental records are read.
  const engineAsked = q && mayUseScmEngine(session) && scmEngineConfigured(env) && engineSearchOpen(lv)
    && (!only || (ENGINE_KINDS as readonly string[]).includes(only));
  const engineRead: Promise<EngineSearch | null> = engineAsked ? searchEngine(env, session, lv, q, { only, limit: n }) : Promise.resolve(null);

  const unitWords = words.map(() => `lower(p.name || ' ' || u.unit_number || ' ' || COALESCE(u.listing_name, '')) LIKE ?`).join(' AND ');
  const unitsRead = !sees('properties') || !want('unit') ? [] : all<any>(env, `
    SELECT u.id, u.unit_number, u.bedrooms, u.readiness, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE ? = '' OR (${unitWords || 'FALSE'})${key ? ` OR regexp_replace(lower(u.unit_number), '[^a-z0-9]+', '', 'g') LIKE ?` : ''}
    ORDER BY p.name, u.unit_number LIMIT ${q ? n : 6}`, q, ...words, ...(key ? [key] : []));

  const buildingsRead = !q || !sees('properties') || !want('building') ? [] : all<any>(env, `
    SELECT p.id, p.name, p.city, (SELECT count(*)::int FROM units u WHERE u.property_id = p.id) AS units
    FROM properties p
    WHERE ${words.map(() => `lower(p.name || ' ' || COALESCE(p.address_line, '') || ' ' || COALESCE(p.city, '')) LIKE ?`).join(' AND ') || 'FALSE'}
    ORDER BY p.name LIMIT ${n}`, ...words);

  // A pasted booking reference is the most common search, so exact reference matches come first. The words are read
  // the way the Reservations search box reads them: a name in any order, any reference, a phone in any format.
  const rq = quickSearch(q, false);
  const bookingsRead = !q || !sees('reservations') || !want('reservation') ? [] : all<any>(env, `
    SELECT r.id, r.external_ref, r.channel, r.check_in, r.check_out, r.state, u.unit_number, p.name AS property_name, g.full_name
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.channel NOT IN ('maintenance_block', 'owner_stay') AND ${rq.map(c => c.sql).join(' AND ') || 'FALSE'}
    ORDER BY (lower(COALESCE(r.external_ref, '')) = ?) DESC, (r.state IN ('cancelled', 'no_show')) ASC, r.check_in DESC LIMIT ${n}`,
    ...rq.flatMap(c => c.args), q);

  const gq = guestSearch(q, true);
  const guestsRead = !q || !sees('reservations') || !want('guest') ? [] : all<any>(env, `
    SELECT g.id, g.full_name, g.email, g.phone FROM guests g
    WHERE ${gq.sql}
    ORDER BY g.full_name LIMIT ${n}`, ...gq.args);

  const ownersRead = !q || !sees('owners') || !want('owner') ? [] : all<any>(env, `
    SELECT o.id, o.display_name, o.email, (SELECT count(*)::int FROM units u WHERE u.owner_id = o.id) AS units
    FROM owners o WHERE lower(o.display_name || ' ' || COALESCE(o.email, '') || ' ' || COALESCE(o.phone, '')) LIKE ?
    ORDER BY o.display_name LIMIT ${n}`, like);

  const jobsRead = !q || !sees('operations') || !want('maintenance') ? [] : all<any>(env, `
    SELECT m.id, m.title, m.state, m.reported_at, u.unit_number, p.name AS property_name
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    WHERE ${words.map(() => `lower(m.title || ' ' || COALESCE(m.vendor_name, '') || ' ' || p.name || ' ' || u.unit_number) LIKE ?`).join(' AND ') || 'FALSE'}
    ORDER BY (m.state = 'resolved') ASC, m.reported_at DESC LIMIT ${n}`, ...words);

  const [units, buildings, bookings, guests, owners, jobs, engine] = await Promise.all([unitsRead, buildingsRead, bookingsRead, guestsRead, ownersRead, jobsRead, engineRead]);
  for (const u of units) {
    out.push({ id: u.id, kind: 'unit', label: `${u.property_name} ${u.unit_number}`, sub: `${u.bedrooms} bedroom${Number(u.bedrooms) === 1 ? '' : 's'}`, state: u.readiness, target: `/properties/units/${encodeURIComponent(u.id)}` });
  }
  for (const b of buildings) {
    out.push({ id: b.id, kind: 'building', label: b.name, sub: `${b.units} unit${Number(b.units) === 1 ? '' : 's'}${b.city ? ` · ${b.city}` : ''}`, target: `/properties/units?q=${encodeURIComponent(b.name)}` });
  }
  for (const r of bookings) {
    const ref = r.external_ref as string | null;
    out.push({
      id: r.id, kind: 'reservation', label: r.full_name ?? 'No guest name', sub: `${r.property_name} ${r.unit_number}`,
      channel: r.channel, state: r.state, checkIn: r.check_in, checkOut: r.check_out, ref,
      // The Bookings list filters by reference (or guest), across every date, so the booking is the one row shown.
      target: (ref ? `/reservations/bookings?view=all&ref=${encodeURIComponent(ref)}` : `/reservations/bookings?view=all&guest=${encodeURIComponent(r.full_name ?? '')}`) + `&open=${encodeURIComponent(r.id)}`,
    });
  }
  for (const g of guests) out.push({ id: g.id, kind: 'guest', label: g.full_name, sub: g.email || g.phone || 'No contact details', target: `/reservations/guests?g=${encodeURIComponent(g.id)}` });
  for (const o of owners) out.push({ id: o.id, kind: 'owner', label: o.display_name, sub: `${o.units} unit${Number(o.units) === 1 ? '' : 's'}${o.email ? ` · ${o.email}` : ''}`, target: `/owners/${encodeURIComponent(o.id)}` });
  for (const m of jobs) out.push({ id: m.id, kind: 'maintenance', label: m.title, sub: `${m.property_name} ${m.unit_number}`, state: m.state, date: m.reported_at, target: `/operations/maintenance?id=${encodeURIComponent(m.id)}` });

  if (engine) {
    for (const h of engine.hits) {
      if (!(ENGINE_KINDS as readonly string[]).includes(h.kind)) continue;
      // A customer opens their projects; someone who sees sales but not projects gets the sales order list instead.
      const target = h.kind === 'customer' && !sees('projects') ? '/sales/orders' : engineTarget(h.path);
      if (target) out.push({ id: String(h.id), kind: h.kind, label: h.label, sub: h.sub, date: h.date, target });
    }
    // Never a silent gap: a supply chain search that could not run says so, instead of reading as "no matches".
    if (engine.failed || engine.degraded.length) {
      out.push({ id: 'engine', kind: 'notice', label: 'Some supply chain records could not be searched just now', sub: 'Try again in a moment. The results shown are not complete.', target: '' });
    }
  }
  return json(out);
};

