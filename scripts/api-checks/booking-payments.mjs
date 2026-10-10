// Bookings: the five tabs, the to-do cards, recording payments, the money ledger, OTA date lock, booking times and
// the CSV export. Writes a few rows (a far-future direct booking it cancels again, payments it removes again), so run it
// against a local copy, never production:
//   API_BASE=http://127.0.0.1:8821 API_EMAIL=dev@local.test API_PASSWORD=LocalTest1 node scripts/api-checks/booking-payments.mjs
import { check, done } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8821';
const r0 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.API_EMAIL ?? 'dev@local.test', password: process.env.API_PASSWORD ?? 'LocalTest1' }) });
const cookie = r0.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
check('signed in', r0.status === 200, r0.status);

/* ---------- tabs and cards ---------- */
let r = await call('GET', '/api/reservations?view=all&size=25');
const all = r.json;
const c = all.counts;
check('five tabs, and the four live ones add up to All', Object.keys(c).sort().join() === 'all,cancelled,inhouse,past,upcoming' && c.upcoming + c.inhouse + c.past + c.cancelled === c.all, JSON.stringify(c));
check('to-do cards carry a count and an outstanding amount', ['arriving', 'departing', 'unpaid', 'payout'].every(k => typeof all.todos[k]?.count === 'number' && typeof all.todos[k]?.outstanding === 'number'), JSON.stringify(all.todos));
check('All holds no blocks or owner stays', all.data.every(x => x.channel !== 'maintenance_block' && x.channel !== 'owner_stay'));
r = await call('GET', '/api/reservations?view=blocks');
check('an old Blocks link lands on All, still without blocks', r.json.view === 'all' && r.json.data.every(x => x.channel !== 'maintenance_block' && x.channel !== 'owner_stay'), r.text.slice(0, 200));
const ids = {};
for (const v of ['upcoming', 'inhouse', 'past', 'cancelled']) {
  const x = await call('GET', `/api/reservations?view=${v}&size=200`);
  for (const row of x.json.data) ids[row.id] = (ids[row.id] ?? 0) + 1;
}
check('no booking is in two tabs (first 200 of each)', Object.values(ids).every(n => n === 1));
r = await call('GET', '/api/reservations?view=upcoming&size=200');
check('Upcoming holds no one already in house', r.json.data.every(x => x.state !== 'checked_in' && x.state !== 'checked_out'));
r = await call('GET', '/api/reservations?todo=payout&size=200');
check('payout card: booking-site stays that have ended, each still owed money', r.json.data.every(x => ['airbnb', 'booking_com', 'agoda'].includes(x.channel) && x.outstanding > 0), r.text.slice(0, 200));
check('payout card count matches its list', r.json.total === all.todos.payout.count, `${r.json.total} vs ${all.todos.payout.count}`);
r = await call('GET', '/api/reservations?view=all&ch=airbnb&size=25');
check('channel filter', r.json.data.every(x => x.channel === 'airbnb') && r.json.total < all.total, String(r.json.total));
const building = all.buildings?.[0];
if (building) {
  r = await call('GET', `/api/reservations?view=all&building=${building.id}&size=25`);
  check('building filter', r.json.data.every(x => x.propertyName === building.name), building.name);
}
r = await call('GET', '/api/reservations?view=all&from=2026-09-01&to=2026-09-30&size=200');
check('date range: every stay touches the range', r.json.data.every(x => x.checkOut > '2026-09-01' && x.checkIn <= '2026-09-30'), String(r.json.total));

/* ---------- a direct booking: TC reference, unpaid card, record payment ---------- */
const units = (await call('GET', '/api/units')).json.data;
let created = null;
for (const u of units.slice(0, 40)) {
  const x = await call('POST', '/api/reservations', { unitId: u.id, channel: 'direct', guest: { fullName: 'Check Guest Payments' }, checkIn: '2027-11-02', checkOut: '2027-11-05', guestsCount: 2, grossBookingValue: 60000 });
  if (x.status === 201) { created = x.json; break; }
}
check('direct booking created with our own TC-YYMM-#### reference', created && /^TC-\d{4}-\d{4}$/.test(created.externalRef), JSON.stringify(created));
if (created) {
  const id = created.id;
  r = await call('GET', `/api/reservations?todo=unpaid&ref=${created.externalRef}`);
  check('a new unpaid direct booking is on the Direct unpaid card', r.json.total === 1 && r.json.data[0].outstanding === 60000, r.text.slice(0, 200));
  r = await call('POST', `/api/reservations/${id}/payments`, { amount: 20000, receivedOn: '2026-10-01', method: 'Bank transfer', reference: 'CHK-1' });
  check('part payment recorded', r.status === 201 && r.json.kind === 'guest_payment', r.text.slice(0, 200));
  const p1 = r.json?.id;
  r = await call('GET', `/api/reservations/${id}`);
  check('ledger: received 200, outstanding 400', r.json.ledger.received === 20000 && r.json.ledger.outstanding === 40000 && r.json.ledger.expected === 60000, JSON.stringify(r.json.ledger).slice(0, 300));
  r = await call('GET', `/api/reservations?todo=unpaid&ref=${created.externalRef}`);
  check('still on the unpaid card while money is owed', r.json.total === 1 && r.json.data[0].outstanding === 40000, r.text.slice(0, 200));
  r = await call('POST', `/api/reservations/${id}/payments`, { amount: 40000, receivedOn: '2026-10-02', method: 'Cash' });
  const p2 = r.json?.id;
  r = await call('GET', `/api/reservations?todo=unpaid&ref=${created.externalRef}`);
  check('paid in full: off the unpaid card', r.json.total === 0, r.text.slice(0, 200));
  r = await call('POST', `/api/reservations/${id}/payments`, { amount: 0, receivedOn: '2099-01-01' });
  check('refuses a zero amount and a future date, naming both fields', r.status === 422 && r.json.error.fields.amount && r.json.error.fields.receivedOn, r.text.slice(0, 200));
  r = await call('GET', `/api/reservations/${id}/payments`);
  check('payments list', r.status === 200 && r.json.data.length === 2, r.text.slice(0, 200));
  r = await call('DELETE', `/api/reservations/${id}/payments/${p2}`);
  check('a payment typed by mistake can be removed', r.status === 200, r.text.slice(0, 200));
  r = await call('GET', `/api/reservations?todo=unpaid&ref=${created.externalRef}`);
  check('removed: back on the unpaid card', r.json.total === 1, r.text.slice(0, 200));
  r = await call('PATCH', `/api/reservations/${id}/details`, { checkInTime: '12:00', checkOutTime: '14:00', staffNotes: 'Early arrival' });
  r = await call('GET', `/api/reservations/${id}`);
  check('early check-in and late check-out times and notes saved', r.json.checkInTime === '12:00' && r.json.checkOutTime === '14:00' && r.json.staffNotes === 'Early arrival', `${r.json.checkInTime} ${r.json.checkOutTime} ${r.json.staffNotes}`);
  r = await call('PATCH', `/api/reservations/${id}/details`, { checkInTime: '25:00' });
  check('a time that is not HH:MM is refused', r.status === 422);
  r = await call('POST', `/api/reservations/${id}/duplicate`, {});
  check('duplicate gets its own TC reference', r.status === 201 && /^TC-\d{4}-\d{4}$/.test(r.json.externalRef) && r.json.externalRef !== created.externalRef, r.text.slice(0, 200));
  const dup = r.json?.id;
  await call('DELETE', `/api/reservations/${id}/payments/${p1}`);
  for (const x of [id, dup].filter(Boolean)) await call('PATCH', `/api/reservations/${x}`, { state: 'cancelled', reason: 'api check clean-up' });
}

/* ---------- OTA: dates locked, payouts, ledger ---------- */
r = await call('GET', '/api/reservations?view=upcoming&ch=airbnb&size=1');
const ota = r.json.data[0];
if (ota) {
  r = await call('PATCH', `/api/reservations/${ota.id}/dates`, { checkIn: ota.checkIn, checkOut: '2099-01-01', confirm: true });
  check('an Airbnb booking\'s dates cannot be changed here', r.status === 409 && r.json.error.code === 'OTA_LOCKED', r.text.slice(0, 200));
  r = await call('GET', `/api/reservations/${ota.id}`);
  check('the drawer says why', r.json.can.changeDates === false && /Airbnb/.test(r.json.can.changeDatesReason), JSON.stringify(r.json.can));
}
r = await call('GET', '/api/reservations?todo=payout&size=2');
const owed = r.json.data;
if (owed.length) {
  const before = r.json.total;
  r = await call('POST', '/api/reservations/mark-paid-out', { ids: [owed[0].id, 'no-such-id'], receivedOn: '2026-10-05', reference: 'CHK-BULK' });
  check('bulk: one payout recorded for what was outstanding, the unknown id named', r.status === 200 && r.json.recorded === 1 && r.json.total === owed[0].outstanding && r.json.skipped.length === 1, r.text.slice(0, 300));
  r = await call('GET', '/api/reservations?todo=payout&size=2');
  check('bulk: the booking left the payout card', r.json.total === before - 1, `${r.json.total} vs ${before}`);
  r = await call('POST', '/api/reservations/mark-paid-out', { ids: [owed[0].id], receivedOn: '2026-10-05' });
  check('bulk again: nothing outstanding, nothing recorded twice', r.json.recorded === 0 && r.json.skipped[0].reason === 'Nothing outstanding.', r.text.slice(0, 200));
  const pays = (await call('GET', `/api/reservations/${owed[0].id}/payments`)).json.data.filter(p => p.reference === 'CHK-BULK');
  for (const p of pays) await call('DELETE', `/api/reservations/${owed[0].id}/payments/${p.id}`);
}

// Every booking's three sections add up.
r = await call('GET', '/api/reservations?view=all&ch=airbnb&size=40&sort=gross:desc');
let bad = 0, disagree = 0;
for (const x of r.json.data) {
  const d = (await call('GET', `/api/reservations/${x.id}`)).json.ledger;
  const s1 = d.guestLines.reduce((n, l) => n + l.amount, 0);
  if ((d.guestLines.length && s1 !== d.guestTotal) || d.outstanding !== Math.max(d.expected - d.received, 0)) bad++;
  if (d.disagree) disagree++;
}
check('section 1 adds up to the guest total and outstanding = expected - received (40 largest Airbnb bookings)', bad === 0, `${bad} bad`);
console.log(`  of those 40, ${disagree} carry a "Sources disagree" note`);

// The long stay the import check splits into monthly instalments.
r = await call('GET', '/api/reservations?view=all&q=HMPZKRREM2');
if (r.json.data[0]) {
  const d = (await call('GET', `/api/reservations/${r.json.data[0].id}`)).json;
  const L = d.ledger;
  const lines = L.payments.filter(p => p.source === 'owner_workbook');
  console.log(`  HMPZKRREM2: guest total ${L.guestTotal}, expected ${L.expected}, received ${L.received}, outstanding ${L.outstanding}, lines ${lines.map(p => `${p.amount}/${p.status}`).join(', ')}`);
  check('long stay: expected = all instalments, received = the paid one, the other outstanding', lines.length === 2 && L.expected === lines[0].amount + lines[1].amount
    && L.received === lines.filter(p => p.status === 'received')[0].amount && L.outstanding === lines.filter(p => p.status === 'expected')[0].amount, JSON.stringify(L).slice(0, 400));
}

/* ---------- CSV ---------- */
r = await fetch(BASE + '/api/reservations/export?view=all&ch=airbnb', { headers: { cookie } });
const csv = (await r.text()).replace(/^﻿/, '').split('\r\n');
check('CSV carries nationality, the money breakdown and payments', ['Nationality', 'Guest total (RM)', 'Commission (RM)', 'Received (RM)', 'Outstanding (RM)', 'Payments'].every(h => csv[3].includes(`"${h}"`)), csv[3]);
done();
