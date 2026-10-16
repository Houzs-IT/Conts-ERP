// Leftovers of the owner's 11 Oct requests: "Cancelled this month" by the day a reservation was cancelled (migration
// 0124 reservations.cancelled_at), every cleaner of a job on the unit's Jobs tab and in the work-list cleaner filter
// (task_cleaners, 0122), and the unit Overview's open maintenance count past the latest 12. Run on a fresh demo
// database (node scripts/dev-pglite.mjs) behind npm run dev; adds its own rows, safe to re-run.
import { call, check, done } from './harness.mjs';

const MYT = (days = 0) => new Date(Date.now() + 8 * 3600e3 + days * 864e5).toISOString().slice(0, 10);
const today = MYT();
const monthStart = `${today.slice(0, 7)}-01`;
const next = new Date(`${monthStart}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
const monthEnd = new Date(next.getTime() - 864e5).toISOString().slice(0, 10);
const run = Date.now().toString(36);

// 1. Cancelled this month: a stay months ahead, cancelled today, is in it; reinstated, it is not.
const units = (await call('GET', '/api/units?size=50')).json?.data ?? [];
const unit = units[units.length - 1];
// A free fortnight months ahead (each run tries later dates, so re-runs find room).
let r, made = null;
for (let off = 150 + Math.floor(Math.random() * 100); !made && off < 700; off += 7) {
  for (const u of units) {
    const x = await call('POST', '/api/reservations', { unitId: u.id, channel: 'direct', guest: { fullName: `Cancel test ${run}` }, checkIn: MYT(off), checkOut: MYT(off + 3), guestsCount: 1, grossBookingValue: 30000 });
    if (x.status === 201) { made = x; break; }
  }
}
r = made ?? { status: 0, text: 'no free unit' };
check('booking made', r.status === 201, r.text);
const id = r.json?.id;
const inMonth = async () => {
  const l = await call('GET', `/api/reservations?view=cancelled&cancelledFrom=${monthStart}&cancelledTo=${monthEnd}&size=200`);
  return { ok: l.status === 200, has: (l.json?.data ?? []).some(x => x.id === id), text: l.text };
};
let l = await inMonth();
check('not cancelled yet: not in Cancelled this month', l.ok && !l.has, l.text.slice(0, 200));
r = await call('POST', `/api/reservations/${id}/cancel`, { reason: 'Guest changed plans' });
check('cancel', r.status === 200, r.text);
l = await inMonth();
check('cancelled today, stay months ahead: in Cancelled this month', l.has, l.text.slice(0, 200));
const old = await call('GET', `/api/reservations?view=cancelled&cancelledFrom=${MYT(-400).slice(0, 8)}01&cancelledTo=${MYT(-370)}&size=200`);
check('not in a month long gone', old.status === 200 && !(old.json?.data ?? []).some(x => x.id === id), old.text.slice(0, 200));
r = await call('PATCH', `/api/reservations/${id}`, { state: 'confirmed', reason: 'Guest came back' });
check('reinstate', r.status === 200, r.text);
l = await inMonth();
check('reinstated: out of Cancelled this month', !l.has, l.text.slice(0, 200));
r = await call('POST', `/api/reservations/${id}/cancel`, { reason: 'Gone again' });
l = await inMonth();
check('cancelled again: back in', r.status === 200 && l.has, l.text.slice(0, 200));

// The seeded company view asks for the cancellation date.
r = await call('GET', '/api/table-layouts?table=bookings');
const seed = (r.json?.company ?? []).find(v => v.id === 'seed.bookings.cancelled-this-month');
check('seeded view filters by cancellation date', seed && seed.layout.filters.cancelledFrom === '@month_start' && seed.layout.filters.cancelledTo === '@month_end' && !seed.layout.filters.from, JSON.stringify(seed ?? r.json).slice(0, 300));

// 2. Several cleaners on one job: the unit's Jobs tab names all of them; the filter lists and finds the second one.
const a = (await call('POST', '/api/housekeeping/cleaners', { name: `Crew A ${run}`, employmentType: 'outsourced', vendorName: 'Test Crew' })).json?.id;
const b = (await call('POST', '/api/housekeeping/cleaners', { name: `Crew B ${run}`, employmentType: 'outsourced', vendorName: 'Test Crew' })).json?.id;
r = await call('POST', '/api/housekeeping/tasks', { unitId: unit.id, date: today, kind: 'turnover', cleanerIds: [a, b] });
check('job with two cleaners', r.status === 201, r.text);
const job = r.json?.id;
r = await call('GET', `/api/units/jobs?unitId=${encodeURIComponent(unit.id)}`);
const row = (r.json?.cleaning ?? []).find(x => x.id === job);
check('Jobs tab names both cleaners', row && row.assigneeName === `Crew A ${run}, Crew B ${run}` && row.cleaners?.length === 2 && row.status === 'waiting', JSON.stringify(row));
r = await call('GET', '/api/tasks/facets');
const fb = (r.json?.assignees ?? []).find(x => x.key === `c:${b}`);
check('cleaner filter lists the second cleaner', fb && fb.count >= 1, JSON.stringify(r.json?.assignees ?? r.json).slice(0, 300));
r = await call('GET', `/api/tasks?assignee=c:${b}&state=active`);
check('filtering by the second cleaner finds the job', JSON.stringify(r.json).includes(job), r.text.slice(0, 200));

// 3. Overview counts every open maintenance job, not the latest 12.
for (let i = 0; i < 13; i++) await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Count test ${run} ${i}` });
r = await call('GET', `/api/units/detail?unitId=${encodeURIComponent(unit.id)}`);
const listed = (r.json?.maintenance ?? []).filter(m => m.state !== 'resolved').length;
check('open maintenance count past the latest 12', r.json?.openMaintenanceCount >= 13 && listed <= 12, `count ${r.json?.openMaintenanceCount}, listed ${listed} :: ${r.text.slice(0, 200)}`);

done();
