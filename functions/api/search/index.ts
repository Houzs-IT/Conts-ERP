import { type Env, all, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

/** GET /api/search?q= — the palette behind the top bar. Empty query returns a few recent units. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 60);
  const like = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
  const out: { id: string; label: string; sub: string; kind: string; target: string }[] = [];

  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.bedrooms, u.readiness, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE ? = '' OR lower(p.name || ' ' || u.unit_number) LIKE ?
    ORDER BY p.name, u.unit_number LIMIT 6`, q, like);
  for (const u of units) {
    out.push({ id: u.id, kind: 'unit', label: `${u.property_name} ${u.unit_number}`, sub: `Unit · ${u.bedrooms}BR · ${String(u.readiness).replace('_', ' ')}`, target: `/properties/units/${u.id}` });
  }
  if (!q || isFieldRole(session.role)) return json(out);

  const guests = await all<any>(env, `SELECT id, full_name, email FROM guests WHERE lower(full_name || ' ' || COALESCE(email, '')) LIKE ? ORDER BY full_name LIMIT 4`, like);
  for (const g of guests) out.push({ id: g.id, kind: 'guest', label: g.full_name, sub: `Guest${g.email ? ` · ${g.email}` : ''}`, target: '/reservations/guests' });

  const bookings = await all<any>(env, `
    SELECT r.id, r.check_in, r.check_out, r.state, u.unit_number, p.name AS property_name, g.full_name
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE lower(COALESCE(g.full_name, '') || ' ' || COALESCE(r.external_ref, '')) LIKE ?
    ORDER BY r.check_in DESC LIMIT 4`, like);
  for (const r of bookings) out.push({ id: r.id, kind: 'reservation', label: `${r.full_name ?? 'Reservation'} · ${r.check_in}`, sub: `Reservation · ${r.property_name} ${r.unit_number} · ${String(r.state).replace('_', ' ')}`, target: '/reservations/bookings' });

  if (session.manage || session.role === 'operations_manager') {
    const owners = await all<any>(env, `SELECT id, display_name, email FROM owners WHERE lower(display_name || ' ' || email) LIKE ? ORDER BY display_name LIMIT 4`, like);
    for (const o of owners) out.push({ id: o.id, kind: 'owner', label: o.display_name, sub: `Owner · ${o.email}`, target: '/owners' });
  }
  return json(out);
};
