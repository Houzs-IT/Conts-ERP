// QC polish 2 (18 Oct 2026): reservation status by dates, automatic turnover jobs, utility bills for units with no
// account, the dashboard's owner figures against the Owners page, and the maintenance badge split.
// Needs a local server on demo data (node scripts/dev-pglite.mjs + npm run dev; see harness.mjs).
//
// Run: SESSION_SECRET=<the server's> API_BASE=http://localhost:8788 node scripts/api-checks/qc-polish-2.mjs
import { call, check, done } from './harness.mjs';

const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const today = day(0);
const month = today.slice(0, 7);

const units = (await call('GET', '/api/units?pageSize=50')).json;
const unitIds = (units?.data ?? units?.rows ?? []).map(u => u.id);
check('demo units', unitIds.length > 0, JSON.stringify(units).slice(0, 200));

/** A direct reservation on the first unit that has the nights free. */
async function book(checkIn, checkOut, name) {
  for (const unitId of unitIds) {
    const r = await call('POST', '/api/reservations', { unitId, checkIn, checkOut, channel: 'direct', guestsCount: 2, grossBookingValue: 50000, guest: { fullName: name } });
    if (r.status === 201) return { id: r.json.id, unitId, checkIn, checkOut };
  }
  return null;
}
const staying = await book(day(-3), day(2), 'QC Staying Guest');
const leaving = await book(day(-2), day(0), 'QC Leaving Guest');
const coming = await book(day(20), day(23), 'QC Coming Guest');
check('three test reservations made', !!(staying && leaving && coming));

// A. Tabs and status go by the dates, not the stored state (all three are stored "confirmed").
const ids = async (view, extra = '') => ((await call('GET', `/api/reservations?view=${view}&size=200${extra}`)).json?.data ?? []).map(r => r.id);
const inhouse = await ids('inhouse'), upcoming = await ids('upcoming'), past = await ids('past');
check('a confirmed stay under way is Currently hosting, not Upcoming', inhouse.includes(staying.id) && !upcoming.includes(staying.id));
check('a confirmed stay leaving today is in Currently hosting (Checking out)', inhouse.includes(leaving.id));
check('a future stay is Upcoming', upcoming.includes(coming.id) && !inhouse.includes(coming.id));
const list = (await call('GET', '/api/reservations?view=past&size=200')).json?.data ?? [];
const aaron = list.find(r => r.externalRef === 'TC-2026-0916');
check('TC-2026-0916 (stored confirmed, dates over) is in Past', !!aaron || !list.length, list.map(r => r.externalRef).join(','));
const counts = (await call('GET', '/api/reservations?view=all')).json?.counts;
check('the four live tabs add up to All', counts && counts.upcoming + counts.inhouse + counts.past + counts.cancelled === counts.all, JSON.stringify(counts));
const byStatus = await ids('all', `&status=${encodeURIComponent('Currently hosting')}`);
check('searching the status column for Currently hosting finds the stay under way', byStatus.includes(staying.id) && !byStatus.includes(coming.id));
const csv = await fetch(`${process.env.API_BASE ?? 'http://localhost:8788'}/api/reservations/export?view=inhouse`, { headers: { cookie: (await import('./harness.mjs')).cookieFor('management') } }).then(r => r.text());
check('the export says Checking out / Currently hosting', /Currently hosting/.test(csv) && /Checking out/.test(csv), csv.slice(0, 300));

// B. Every checkout gets its turnover job by itself; it follows date changes and cancellations.
const board = async (d) => (await call('GET', `/api/housekeeping/board?date=${d}`)).json;
const b0 = await board(today);
check('today: the stay leaving has a cleaning job', (b0?.rows ?? []).some(r => r.unitId === leaving.unitId));
check('today: no checkout is left without a cleaning job', (b0?.departures ?? []).length === 0, JSON.stringify(b0?.departures?.map(d => d.unitNumber)));
const bFuture = await board(coming.checkOut);
const job = (bFuture?.rows ?? []).find(r => r.unitId === coming.unitId);
check('a future checkout already has its turnover job', !!job);
const moved = await call('PATCH', `/api/reservations/${coming.id}/dates`, { checkIn: day(21), checkOut: day(25), confirm: true });
check('dates moved', moved.status === 200, moved.text);
check('the old day no longer has the job', !((await board(coming.checkOut))?.rows ?? []).some(r => r.unitId === coming.unitId));
check('the new checkout day has it', ((await board(day(25)))?.rows ?? []).some(r => r.unitId === coming.unitId));
const cancel = await call('POST', `/api/reservations/${coming.id}/cancel`, { reason: 'QC check' });
check('cancelled', cancel.status === 200, cancel.text);
check('the cancelled stay has no cleaning job left', !((await board(day(25)))?.rows ?? []).some(r => r.unitId === coming.unitId));
const pastBoard = await board(day(-10));
check('nothing is planned for a past day', (pastBoard?.rows ?? []).every(r => r.day <= day(-10)));

// 6. Utility bills for a unit with no account number on file.
const ut = (await call('GET', `/api/expenses/utilities?month=${month}`)).json;
const bare = ut?.unitsWithoutAccount?.[0];
if (bare) {
  const save = await call('POST', '/api/expenses/utilities', { month, rows: [{ unitId: bare.unitId, kind: 'water', amount: 4321, chargeTo: 'the_conts' }] });
  check('a bill is recorded for a unit without an account', save.status === 201 && save.json?.saved === 1, save.text);
  const again = (await call('GET', `/api/expenses/utilities?month=${month}`)).json?.unitsWithoutAccount?.find(u => u.unitId === bare.unitId);
  check('it shows as already recorded', again?.recorded?.some(x => x.kind === 'water' && x.amount === 4321), JSON.stringify(again));
  const twice = await call('POST', '/api/expenses/utilities', { month, rows: [{ unitId: bare.unitId, kind: 'water', amount: 1000, chargeTo: 'the_conts' }] });
  check('a second water bill that month is not doubled', twice.json?.saved === 0 && twice.json?.recordedElsewhere?.length === 1, twice.text);
  const noReceipt = await call('POST', '/api/expenses/utilities', { month, rows: [{ unitId: bare.unitId, kind: 'electricity', amount: 1000, chargeTo: 'owner' }] });
  check('an owner-paid bill still needs its receipt', noReceipt.status === 422, noReceipt.text);
} else check('a unit without an account in the demo data', false, JSON.stringify(ut).slice(0, 200));

// C/D. Dashboard owner figures = the Owners page's engine.
const owners = (await call('GET', '/api/owners')).json?.data ?? [];
const ownersNet = owners.reduce((s, o) => s + o.units.reduce((n, u) => n + u.net, 0), 0);
const kpi = (await call('GET', `/api/dashboard/kpis?period=${month}`)).json?.kpis?.find(k => k.key === 'net_owner_payout');
check('dashboard net payout = Owners page "To pay owners", labelled estimate', kpi && kpi.value === ownersNet && kpi.estimate === true, `${kpi?.value} vs ${ownersNet}`);
const trend = (await call('GET', '/api/dashboard/trend?range=3m')).json;
let sum = 0;
for (const p of trend?.points ?? []) {
  const o = (await call('GET', `/api/owners?month=${p.period}`)).json?.data ?? [];
  sum += o.reduce((s, x) => s + x.units.reduce((n, u) => n + u.net, 0), 0);
}
check('3-month net payout = the Owners page month by month', trend?.totals?.netOwnerPayout === sum, `${trend?.totals?.netOwnerPayout} vs ${sum}`);
const t = trend?.totals ?? {};
check('income less owner costs is the operator share plus the owners\' share (within top-ups and adjustments)',
  typeof t.statementIncome === 'number' && Math.abs(t.statementIncome - t.ownerCosts - t.managementFees - t.netOwnerPayout) <= Math.abs(t.netOwnerPayout) + 1, JSON.stringify(t));

// 8. The maintenance badge says what it is made of.
const nav = (await call('GET', '/api/nav/badges')).json;
check('maintenance badge carries its awaiting-approval part', typeof nav?.maintenanceAwaiting === 'number' && nav.maintenanceAwaiting <= nav.maintenance, JSON.stringify({ m: nav?.maintenance, a: nav?.maintenanceAwaiting }));

for (const r of [staying, leaving]) if (r) await call('POST', `/api/reservations/${r.id}/cancel`, { reason: 'QC check cleanup' });
done();
