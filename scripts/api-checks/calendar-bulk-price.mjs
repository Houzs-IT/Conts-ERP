// Bulk price change from the Calendar (ticked units -> POST /api/rates/bulk, a few units per request):
//   - field roles are refused (403); operations managers and management may
//   - dryRun writes nothing and reports each unit's price now and after
//   - a save writes one row per unit, night and channel, Fri/Sat at the weekend price, and audits the change
//     (old and new prices, the units, the batch id the screen sends with every request of one change)
//   - a weekend price without a nightly price, and a request over the row cap, are refused
// Run against a local server on a throwaway database (seed users from harness.mjs), e.g.
//   API_BASE=http://127.0.0.1:8797 node scripts/api-checks/calendar-bulk-price.mjs
import { call, check, done } from './harness.mjs';

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const wd = d => new Date(`${d}T00:00:00Z`).getUTCDay();
let MON = null; for (let n = 200; !MON; n++) if (wd(day(n)) === 1) MON = day(n);
const LAST = add(MON, 13);   // two whole weeks: 4 Fri/Sat nights, 10 others
const FRI = add(MON, 4), TUE = add(MON, 1);

let r = await call('GET', `/api/reservations/calendar?from=${MON}&to=${LAST}`);
check('calendar loads', r.status === 200, r.text.slice(0, 200));
const units = (r.json?.units ?? []).slice(0, 2);
check('two units to price', units.length === 2);
const ids = units.map(u => u.id);
const rateAt = (cal, u, c, d) => cal.rates?.[`${u}:${c}:${d}`];
const before = r.json;

const body = { unitIds: ids, channels: ['web'], weekdays: null, lines: [{ from: MON, to: LAST, baseRate: 61100, weekendRate: 74400 }] };

/* ---------- who may ---------- */
for (const role of ['operations_staff', 'housekeeper']) {
  r = await call('POST', '/api/rates/bulk', body, role);
  // The demo data (scripts/local-demo-setup.mjs) has no operations_staff account; seed.sql does.
  if (r.status === 401) { console.log(`skip ${role}: no such seeded user in this database`); continue; }
  check(`${role} is refused (403)`, r.status === 403, r.text);
}
r = await call('POST', '/api/rates/bulk', { ...body, dryRun: true }, 'operations_manager');
check('an operations manager may (dry run, 200)', r.status === 200, r.text);

/* ---------- dry run ---------- */
r = await call('POST', '/api/rates/bulk', { ...body, dryRun: true });
check('dry run answers', r.status === 200 && r.json?.dryRun === true && r.json?.written === 0, r.text);
check('dry run counts 2 units x 14 nights = 28 rows', r.json?.rows === 28 && r.json?.nights === 14, r.text);
const ch = r.json?.changes ?? [];
check('dry run reports old -> new per unit', ch.length === 2 && ch.every(c => c.channel === 'web' && c.nights === 14 && c.newMin === 61100 && c.newMax === 74400 && c.oldMin > 0), JSON.stringify(ch));
r = await call('GET', `/api/reservations/calendar?from=${MON}&to=${LAST}`);
check('dry run wrote nothing', ids.every(u => rateAt(r.json, u, 'web', TUE) === rateAt(before, u, 'web', TUE)), JSON.stringify(ids.map(u => [rateAt(before, u, 'web', TUE), rateAt(r.json, u, 'web', TUE)])));

/* ---------- refusals ---------- */
r = await call('POST', '/api/rates/bulk', { unitIds: ids, lines: [{ from: MON, to: LAST, weekendRate: 74400 }] });
check('a weekend price alone is refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/rates/bulk', { unitIds: ids, lines: [{ from: MON, to: LAST, baseRate: 61100, weekendRate: 0 }] });
check('a zero weekend price is refused (422)', r.status === 422, r.text);
const big = Array.from({ length: 20 }, () => ({ from: MON, to: add(MON, 499), baseRate: 61100 }));
r = await call('POST', '/api/rates/bulk', { unitIds: ids, channels: ['web', 'airbnb', 'booking_com', 'agoda'], lines: big });
check('over the row cap is refused before anything is written (413)', r.status === 413, r.text.slice(0, 200));

/* ---------- save ---------- */
const batch = `check-${Date.now()}`;
r = await call('POST', '/api/rates/bulk', { ...body, batch });
check('saved', r.status === 200 && r.json?.written === 28, r.text);
check('save reports the same old -> new', (r.json?.changes ?? []).length === 2, r.text);
r = await call('GET', `/api/reservations/calendar?from=${MON}&to=${LAST}`);
check('weekday nights at the nightly price (611)', ids.every(u => rateAt(r.json, u, 'web', TUE) === 61100), JSON.stringify(ids.map(u => rateAt(r.json, u, 'web', TUE))));
check('Fri and Sat at the weekend price (744)', ids.every(u => rateAt(r.json, u, 'web', FRI) === 74400 && rateAt(r.json, u, 'web', add(FRI, 1)) === 74400), JSON.stringify(ids.map(u => rateAt(r.json, u, 'web', FRI))));
check('every night of the range written', ids.every(u => Array.from({ length: 14 }, (_, i) => rateAt(r.json, u, 'web', add(MON, i))).every(x => x === 61100 || x === 74400)));

/* ---------- audit ---------- */
r = await call('GET', `/api/audit?entityTable=units&entityId=${encodeURIComponent(`bulk:${batch}`)}`);
const rows = r.json?.data ?? r.json?.entries ?? r.json?.rows ?? [];
check('one audit entry for the change', r.status === 200 && rows.length === 1, r.text.slice(0, 300));
const e = rows[0] ?? {};
const after = typeof e.after === 'string' ? JSON.parse(e.after) : (e.after ?? e.afterState ?? e.after_state);
const was = typeof e.before === 'string' ? JSON.parse(e.before) : (e.before ?? e.beforeState ?? e.before_state);
check('audit names the action, the units and the batch', e.action === 'rate.bulk' && ids.every(id => after?.unitIds?.includes(id)) && after?.batch === batch, JSON.stringify(e).slice(0, 400));
check('audit keeps old and new prices per unit', was?.prices?.length === 2 && after?.prices?.every(p => p.min === 61100 && p.max === 74400), JSON.stringify({ was, now: after?.prices }));

/* ---------- a percentage starts from the night saved above ---------- */
r = await call('POST', '/api/rates/bulk', { unitIds: ids, channels: ['web'], lines: [{ from: TUE, to: TUE, adjustPct: 10 }], dryRun: true });
check('a +10% dry run starts from the saved night (611 -> 672)', (r.json?.changes ?? []).every(c => c.oldMin === 61100 && c.newMin === 67200), JSON.stringify(r.json?.changes));

done();
