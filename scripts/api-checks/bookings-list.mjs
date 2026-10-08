// Read-only checks of the paged Bookings and Guests lists. They hold on any data set, so besides the
// seeded local server they can run against a copy of real data:
//   API_BASE=http://127.0.0.1:8791 API_EMAIL=dev@local.test API_PASSWORD=... node scripts/api-checks/bookings-list.mjs
import { call as harnessCall, check, done } from './harness.mjs';

const BASE = process.env.API_BASE;
let cookie = '';
if (BASE && process.env.API_EMAIL) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.API_EMAIL, password: process.env.API_PASSWORD }) });
  cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
async function get(path, role) {
  if (!BASE || role) return harnessCall('GET', path, undefined, role);
  const r = await fetch(BASE + path, { headers: { cookie } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t, headers: r.headers };
}

let r = await get('/api/reservations?view=all&size=25');
const all = r.json;
check('all: a page of at most 25 with counts and totals', r.status === 200 && all.data.length <= 25 && all.total === all.counts.all && all.totals.bookings === all.total, r.text.slice(0, 300));
check('upcoming + past + cancelled = all', all.counts.upcoming + all.counts.past + all.counts.cancelled === all.counts.all, JSON.stringify(all.counts));

r = await get('/api/reservations');
check('default view is upcoming, soonest check-in first', r.json.view === 'upcoming' && r.json.data.every((x, i, a) => i === 0 || a[i - 1].checkIn <= x.checkIn), r.text.slice(0, 200));

const lastPage = Math.max(1, Math.ceil(all.total / 25));
r = await get(`/api/reservations?view=all&size=25&page=${lastPage}`);
check('last page holds the remainder', r.json.page === lastPage && r.json.data.length === all.total - (lastPage - 1) * 25, `${r.json.page} ${r.json.data.length}`);
r = await get('/api/reservations?view=all&size=25&page=99999');
check('a page past the end clamps to the last page', r.json.page === lastPage, String(r.json.page));

r = await get('/api/reservations?view=blocks');
check('blocks tab only holds blocks and owner stays', r.json.data.every(x => x.channel === 'maintenance_block' || x.channel === 'owner_stay'), r.text.slice(0, 200));
r = await get('/api/reservations?view=cancelled');
check('cancelled tab only holds cancelled or no-show', r.json.data.every(x => x.state === 'cancelled' || x.state === 'no_show'), r.text.slice(0, 200));

const sample = all.data.find(x => x.externalRef);
if (sample) {
  r = await get(`/api/reservations?view=all&ref=${encodeURIComponent(sample.externalRef)}`);
  check('reference search finds the booking across every page', r.json.data.some(x => x.id === sample.id) && r.json.total <= all.total, r.text.slice(0, 200));
  r = await get(`/api/reservations/${sample.id}`);
  check('single booking read', r.status === 200 && r.json.id === sample.id && 'channelFee' in r.json, r.text.slice(0, 200));
}
r = await get('/api/reservations?view=all&guest=%25');
check('a % in a search is matched literally', r.status === 200 && r.json.total < all.total || all.total === 0, String(r.json?.total));
r = await get('/api/reservations?view=all&sort=gross:desc&size=25');
check('sort by gross descending', r.json.data.every((x, i, a) => i === 0 || a[i - 1].grossBookingValue >= x.grossBookingValue), '');

r = await get('/api/reservations/export?view=all');
const lines = r.text.replace(/^﻿/, '').split('\r\n');
check('CSV export holds every filtered booking, not one page', r.status === 200 && lines.length - 4 === all.total, `${lines.length - 4} vs ${all.total}`);

r = await get('/api/guests?size=25');
const g = r.json;
check('guests: one page with filter counts', r.status === 200 && g.data.length <= 25 && g.total === g.counts.all, r.text.slice(0, 300));
check('guest rows carry no stay history', g.data.every(x => !('history' in x)), '');
if (g.data[0]) {
  const name = g.data[0].fullName.slice(0, 4);
  r = await get(`/api/guests?q=${encodeURIComponent(name)}`);
  check('guest search narrows and keeps the match', r.json.data.some(x => x.id === g.data[0].id) && r.json.total <= g.total, r.text.slice(0, 200));
  r = await get(`/api/guests/${g.data[0].id}`);
  check('guest profile', r.status === 200 && Array.isArray(r.json.history) && r.json.stays === g.data[0].stays, r.text.slice(0, 200));
}
r = await get('/api/guests?filter=arriving_today');
check('arriving filter count matches its list', r.json.total === r.json.counts.arriving_today, r.text.slice(0, 200));

if (!BASE) {
  r = await get('/api/reservations/export', 'housekeeper');
  check('field role cannot export bookings', r.status === 403, r.text);
}
done();
