// Read-only checks for the paged unit bookings, the building-scoped calendar and the portfolio/trend fields.
// Works against any data set. Defaults match harness.mjs (npm run dev on :8788 with the smoke-test secret);
// API_BASE and SESSION_SECRET point it at another local server, e.g. the real-sized import:
//   API_BASE=http://127.0.0.1:8794 SESSION_SECRET=... node scripts/api-checks/units-calendar-scale.mjs
import { createHmac } from 'node:crypto';
import { check, done } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const SECRET = process.env.SESSION_SECRET ?? 'smoke-test-secret-not-real-0123456789';
const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookie = (role) => {
  const body = Buffer.from(JSON.stringify({ userId: `check-${role}`, email: `${role}@check.test`, role, fullName: `Check (${role})`, exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`;
};
async function get(path, role = 'management') {
  const r = await fetch(BASE + path, { headers: { cookie: cookie(role) } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}

// A unit with the most bookings, so paging has something to page.
let r = await get('/api/properties');
check('properties loads', r.status === 200 && r.json.units.length > 0, r.text.slice(0, 200));
const units = r.json.units;
let unit = units[0].id, most = -1;
for (const u of units.slice(0, 40)) {
  const s = await get(`/api/units/stays?unitId=${encodeURIComponent(u.id)}&when=all&pageSize=5`);
  if (s.status === 200 && s.json.total > most) { most = s.json.total; unit = u.id; }
}

r = await get(`/api/units/stays?unitId=${encodeURIComponent(unit)}&when=all&pageSize=5`);
const c = r.json?.counts;
check('stays: counts add up', r.status === 200 && c.upcoming + c.past + c.cancelled === c.all && r.json.total === c.all, JSON.stringify(c));
check('stays: page is capped', r.json.rows.length <= 5, String(r.json.rows.length));
if (r.json.total > 5) {
  const p2 = await get(`/api/units/stays?unitId=${encodeURIComponent(unit)}&when=all&pageSize=5&page=2`);
  check('stays: page 2 is different rows', p2.status === 200 && p2.json.rows.length > 0 && !p2.json.rows.some(x => r.json.rows.some(y => y.id === x.id)), p2.text.slice(0, 200));
}
for (const when of ['upcoming', 'past', 'cancelled']) {
  const w = await get(`/api/units/stays?unitId=${encodeURIComponent(unit)}&when=${when}&pageSize=100`);
  const ok = w.status === 200 && w.json.total === c[when] && w.json.rows.every(s =>
    when === 'cancelled' ? s.state === 'cancelled'
    : s.state !== 'cancelled' && (when === 'upcoming' ? s.checkOut >= w.json.today : s.checkOut < w.json.today));
  check(`stays: ${when} filter`, ok, w.text.slice(0, 200));
}
const up = await get(`/api/units/stays?unitId=${encodeURIComponent(unit)}&when=upcoming&pageSize=100`);
check('stays: upcoming soonest first', up.json.rows.every((s, i, a) => i === 0 || a[i - 1].checkIn <= s.checkIn));
check('stays: money for management', 'totalGross' in up.json && up.json.rows.every(s => 'grossBookingValue' in s), JSON.stringify(up.json.rows[0] ?? {}));
const hk = await get(`/api/units/stays?unitId=${encodeURIComponent(unit)}&when=upcoming`, 'housekeeper');
check('stays: no money for a housekeeper', hk.status === 200 && !('totalGross' in hk.json) && hk.json.rows.every(s => !('grossBookingValue' in s)), hk.text.slice(0, 200));
check('stays: unknown filter 422', (await get(`/api/units/stays?unitId=${encodeURIComponent(unit)}&when=soon`)).status === 422);
check('stays: no unit 422', (await get('/api/units/stays')).status === 422);
check('stays: unknown unit 404', (await get('/api/units/stays?unitId=nope')).status === 404);

const detail = await get(`/api/units/detail?unitId=${encodeURIComponent(unit)}`);
check('detail: stays are current and upcoming only', detail.status === 200 && detail.json.stays.every(s => s.checkOut >= up.json.today), JSON.stringify(detail.json?.stays?.[0] ?? {}));

// Calendar: the whole board, then one building.
const from = up.json.today, to = new Date(Date.parse(from) + 29 * 864e5).toISOString().slice(0, 10);
const all = await get(`/api/reservations/calendar?from=${from}&to=${to}`);
check('calendar: buildings cover every unit', all.status === 200 && all.json.buildings.reduce((n, b) => n + b.units, 0) === all.json.units.length, all.text.slice(0, 200));
check('calendar: every unit names its building', all.json.units.every(u => u.propertyId), '');
const big = [...all.json.buildings].sort((a, b) => b.units - a.units)[0];
const one = await get(`/api/reservations/calendar?from=${from}&to=${to}&property=${encodeURIComponent(big.id)}`);
const ids = new Set(one.json?.units.map(u => u.id));
check('calendar: one building only', one.status === 200 && one.json.units.length === big.units && one.json.units.every(u => u.propertyId === big.id), one.text.slice(0, 200));
check('calendar: its bookings only', one.json.blocks.every(b => ids.has(b.unitId)) && one.json.blocks.length === all.json.blocks.filter(b => ids.has(b.unitId)).length, '');
check('calendar: still lists every building', one.json.buildings.length === all.json.buildings.length, '');
check('calendar: smaller answer for one building', one.text.length < all.text.length || all.json.buildings.length === 1, `${one.text.length} vs ${all.text.length}`);

// Portfolio and trend fields the screens rely on.
const pf = await get('/api/portfolio/performance');
check('portfolio: rows carry nights and building', pf.status === 200 && typeof pf.json.days === 'number' && pf.json.rows.every(x => typeof x.nights === 'number' && x.propertyId), pf.text.slice(0, 200));
const tr = await get('/api/dashboard/trend?range=12m');
check('trend: change compares two complete months', tr.status === 200 && (!tr.json.delta.period || (tr.json.delta.against < tr.json.delta.period && !tr.json.points.find(p => p.period === tr.json.delta.period)?.isCurrent)), JSON.stringify(tr.json?.delta));

done();
