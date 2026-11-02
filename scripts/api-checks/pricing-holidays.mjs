// Pricing levels, channel prices and the shared public holiday list (migration 0202):
//   - priority: custom price > holiday price > weekend price > nightly price, a unit with no holiday price sells a holiday
//     at its weekend or nightly price, and "the night before a holiday" follows the unit's switch
//   - a channel priced % above direct, RM above direct, or with fixed prices of its own, per level
//   - adding, moving and removing a holiday re-queues exactly those nights for the units it applies to (by state)
//   - batch edit: dry run shows old -> new and stores nothing; a save stores every unit, audits once; field roles refused
//   - HR leave still reads the list (staff days off only), and its older PUT keeps working
// Needs a local server on a throwaway database (seed users from harness.mjs) started with CHANNEX_API_KEY set to any
// dummy value and CHANNEX_BASE_URL pointing nowhere (e.g. http://127.0.0.1:9), so Channex rows are queued but never
// sent, and DB_URL for that database (default: scripts/dev-pglite.mjs on 55441). e.g.
//   API_BASE=http://127.0.0.1:8846 node scripts/api-checks/pricing-holidays.mjs
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL ?? 'postgres://pos_app:local@127.0.0.1:55441/postgres';
const sql = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const wd = d => new Date(`${d}T00:00:00Z`).getUTCDay();
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
// A Monday well ahead and away from the built-in holiday lists' dates in that week.
let MON = null; for (let n = 40; !MON; n++) { const d = add(today, n); if (wd(d) === 1) MON = d; }
const TUE = add(MON, 1), WED = add(MON, 2), THU = add(MON, 3), FRI = add(MON, 4), SAT = add(MON, 5);
const NEXT_TUE = add(MON, 8);

/* ---------- setup: two units in different states ---------- */
const units = await sql(`SELECT u.id, p.state FROM pos.units u JOIN pos.properties p ON p.id = u.property_id WHERE u.purpose = 'rental' OR u.purpose IS NULL ORDER BY p.state, u.unit_number`)
  .catch(() => sql(`SELECT u.id, p.state FROM pos.units u JOIN pos.properties p ON p.id = u.property_id ORDER BY p.state, u.unit_number`));
const A = units.find(u => u.state === 'Selangor')?.id, B = units.find(u => u.state === 'Kuala Lumpur')?.id;
check('a Selangor and a Kuala Lumpur unit in the demo data', !!A && !!B, JSON.stringify(units.slice(0, 5)));
// What these units looked like, put back at the end so later checks see the demo data unchanged.
const keptUnits = await sql(`SELECT id, base_rate, weekend_rate, holiday_rate, holiday_eve, cost_floor FROM pos.units WHERE id = ANY($1)`, [A, B]);
const keptRules = await sql(`SELECT unit_id, channel, uplift, mode, percent, fixed_base, fixed_weekend, fixed_holiday, updated_at FROM pos.channel_uplifts WHERE unit_id = ANY($1)`, [A, B]);
// Clean slate for this week and these units.
await sql(`DELETE FROM pos.public_holidays WHERE holiday_date BETWEEN $1 AND $2`, add(MON, -1), add(MON, 9));
await sql(`DELETE FROM pos.channel_rates WHERE unit_id = ANY($1) AND rate_date BETWEEN $2 AND $3`, [A, B], add(MON, -1), add(MON, 9));
await sql(`DELETE FROM pos.channel_uplifts WHERE unit_id = ANY($1)`, [A, B]);

let r;
for (const [u, body] of [[A, { baseRate: 20000 }], [A, { weekendRate: 26000 }], [A, { holidayRate: 35000 }], [A, { holidayEve: false }], [B, { baseRate: 18000 }], [B, { weekendRate: 22000 }], [B, { holidayRate: null }]]) {
  r = await call('PUT', '/api/rates', { unitId: u, ...body });
  check(`PUT /rates ${JSON.stringify(body)}`, r.status === 200, r.text);
}
r = await call('PUT', '/api/rates', { unitId: A, holidayRate: 0 });
check('a zero holiday price is refused (422)', r.status === 422, r.text);

/* ---------- holidays: add, permissions ---------- */
r = await call('POST', '/api/holidays', { date: TUE, name: 'Check holiday (all states)', state: null }, 'housekeeper');
check('a cleaner may not change the holiday list (403)', r.status === 403, r.text);
r = await call('POST', '/api/holidays', { date: TUE, name: 'Check holiday (all states)', state: null });
check('holiday added for all states (201)', r.status === 201 && r.json?.data?.staffDayOff === true, r.text);
const H_TUE = r.json?.data?.id;
r = await call('POST', '/api/holidays', { date: TUE, name: 'Again', state: null });
check('the same day and state twice is refused (409)', r.status === 409, r.text);
r = await call('POST', '/api/holidays', { date: SAT, name: 'Check Saturday holiday', state: null });
check('a Saturday holiday added', r.status === 201, r.text);
r = await call('POST', '/api/holidays', { date: THU, name: 'Check Selangor day', state: 'Selangor' });
check('a state holiday is not a staff day off by default', r.status === 201 && r.json?.data?.staffDayOff === false, r.text);
const H_THU = r.json?.data?.id;
r = await call('POST', '/api/holidays', { date: WED, name: 'Bad state', state: 'Atlantis' });
check('an unknown state is refused (422)', r.status === 422, r.text);

/* ---------- priority across levels ---------- */
const cal = async () => (await call('GET', `/api/reservations/calendar?from=${MON}&to=${NEXT_TUE}`)).json;
const price = (c, u, ch, d) => {
  const own = c.rates?.[`${u}:${ch}:${d}`];
  if (own != null) return own;
  const lp = c.levelPrices?.[`${u}:${ch}`];
  if (!lp) return null;
  if (c.holidayNights?.[u]?.includes(d) && lp.holiday != null) return lp.holiday;
  return wd(d) === 5 || wd(d) === 6 ? lp.weekend : lp.base;
};
let c = await cal();
check('Monday at the nightly price (200)', price(c, A, 'web', MON) === 20000, price(c, A, 'web', MON));
check('Friday at the weekend price (260)', price(c, A, 'web', FRI) === 26000, price(c, A, 'web', FRI));
check('holiday Tuesday at the holiday price (350)', price(c, A, 'web', TUE) === 35000, price(c, A, 'web', TUE));
check('holiday Saturday: holiday beats weekend (350)', price(c, A, 'web', SAT) === 35000, price(c, A, 'web', SAT));
check('Selangor holiday applies to the Selangor unit (350)', price(c, A, 'web', THU) === 35000, price(c, A, 'web', THU));
check('...and not to the Kuala Lumpur unit (180)', price(c, B, 'web', THU) === 18000, price(c, B, 'web', THU));
check('no holiday price: holiday Tuesday at nightly (180)', price(c, B, 'web', TUE) === 18000, price(c, B, 'web', TUE));
check('no holiday price: holiday Saturday at weekend (220)', price(c, B, 'web', SAT) === 22000, price(c, B, 'web', SAT));
check('eve off: the Monday before stays nightly', !c.holidayNights?.[A]?.includes(MON));
r = await call('PUT', '/api/rates', { unitId: A, channel: 'web', date: TUE, rate: 50000 });
c = await cal();
check('a custom price beats the holiday price (500)', price(c, A, 'web', TUE) === 50000, price(c, A, 'web', TUE));
await sql(`DELETE FROM pos.channel_rates WHERE unit_id = $1 AND rate_date = $2`, A, TUE);
r = await call('PUT', '/api/rates', { unitId: A, holidayEve: true });
c = await cal();
check('eve on: the Monday before a holiday takes the holiday price (350)', price(c, A, 'web', MON) === 35000, price(c, A, 'web', MON));
check('eve on: Wednesday (before the Selangor Thursday) too', price(c, A, 'web', WED) === 35000, price(c, A, 'web', WED));

/* ---------- channel prices: default, %, RM, fixed ---------- */
c = await cal();
check('Booking.com default: 18% above direct (236 nightly, 413 holiday)', c.levelPrices[`${A}:booking_com`].base === 23600 && c.levelPrices[`${A}:booking_com`].holiday === 41300, JSON.stringify(c.levelPrices[`${A}:booking_com`]));
r = await call('PUT', '/api/rates', { unitId: A, rule: { channel: 'booking_com', mode: 'percent', percent: 10 } });
check('Booking.com set to 10% above direct', r.status === 200, r.text);
r = await call('PUT', '/api/rates', { unitId: A, rule: { channel: 'airbnb', mode: 'fixed', fixedBase: 30000, fixedHoliday: 45000 } });
check('Airbnb set to fixed prices', r.status === 200, r.text);
r = await call('PUT', '/api/rates', { unitId: A, channel: 'agoda', uplift: 1500 });
check('Agoda set to RM 15 above direct (older body)', r.status === 200, r.text);
r = await call('PUT', '/api/rates', { unitId: A, rule: { channel: 'airbnb', mode: 'fixed', fixedBase: 0 } });
check('a fixed price of RM 0 is refused (422)', r.status === 422, r.text);
r = await call('GET', '/api/pricing/rules');
const ua = r.json?.units?.find(u => u.unitId === A);
const L = ua?.levels ?? {};
check('Pricing shows the levels per channel', !!ua && L.web.base === 20000 && L.web.weekend === 26000 && L.web.holiday === 35000, JSON.stringify(L.web));
check('Booking.com 10%: 220 / 286 / 385', L.booking_com?.base === 22000 && L.booking_com?.weekend === 28600 && L.booking_com?.holiday === 38500, JSON.stringify(L.booking_com));
check('Airbnb fixed: 300 / 300 (weekend falls back) / 450', L.airbnb?.base === 30000 && L.airbnb?.weekend === 30000 && L.airbnb?.holiday === 45000, JSON.stringify(L.airbnb));
check('Agoda RM 15: 215 / 275 / 365', L.agoda?.base === 21500 && L.agoda?.weekend === 27500 && L.agoda?.holiday === 36500, JSON.stringify(L.agoda));
check('the rule reads back', ua?.rates?.find(x => x.channel === 'booking_com')?.mode === 'percent' && ua?.rates?.find(x => x.channel === 'airbnb')?.mode === 'fixed');
c = await cal();
check('Calendar: Airbnb fixed holiday Saturday (450); Booking.com Friday, eve of that holiday, at its holiday price (385)', price(c, A, 'airbnb', SAT) === 45000 && price(c, A, 'booking_com', FRI) === 38500, `${price(c, A, 'airbnb', SAT)} ${price(c, A, 'booking_com', FRI)}`);

/* ---------- holiday changes re-queue the right nights ---------- */
await sql(`UPDATE pos.units SET channex_property_id = 'chk-prop', channex_room_type_id = 'chk-room', channex_rate_plan_id = 'chk-web',
  channex_rate_plan_airbnb = 'chk-airbnb', channex_rate_plan_booking_com = 'chk-bcom', channex_rate_plan_agoda = 'chk-agoda' WHERE id = $1`, A);
const outbox = () => sql(`SELECT rate_plan_id, date_from, date_to, rate::float AS rate FROM pos.channex_outbox WHERE unit_id = $1 AND kind = 'restrictions' AND status IN ('queued','sending') ORDER BY date_from, rate_plan_id`, A);
await sql(`DELETE FROM pos.channex_outbox WHERE unit_id = $1`, A);
r = await call('POST', '/api/holidays', { date: NEXT_TUE, name: 'Check moving holiday', state: null });
check('holiday added, units queued', r.status === 201 && r.json?.queued >= 1, r.text);
const H_NEXT = r.json?.data?.id;
let rows = await outbox();
const at = (plan, d) => rows.find(x => x.rate_plan_id === plan && x.date_from <= d && x.date_to >= d)?.rate;
check('queued only the holiday night and its eve (Mon and Tue), 4 plans each', rows.length === 8 && rows.every(x => x.date_from === x.date_to && [add(NEXT_TUE, -1), NEXT_TUE].includes(x.date_from)), JSON.stringify(rows));
check('direct 350, Booking.com 385, Airbnb 450, Agoda 365 on the holiday', at('chk-web', NEXT_TUE) === 350 && at('chk-bcom', NEXT_TUE) === 385 && at('chk-airbnb', NEXT_TUE) === 450 && at('chk-agoda', NEXT_TUE) === 365, JSON.stringify(rows));
await sql(`DELETE FROM pos.channex_outbox WHERE unit_id = $1`, A);
r = await call('POST', '/api/holidays', { date: add(NEXT_TUE, 1), name: 'Check Penang day', state: 'Penang' });
rows = await outbox();
check('a Penang holiday queues nothing for a Selangor unit', r.status === 201 && rows.length === 0, JSON.stringify(rows));
const H_PEN = r.json?.data?.id;
r = await call('DELETE', `/api/holidays/${H_NEXT}`);
rows = await outbox();
check('removing it queues the normal prices again (direct 200 Tue, Booking.com 220)', r.status === 200 && at('chk-web', NEXT_TUE) === 200 && at('chk-bcom', NEXT_TUE) === 220, JSON.stringify(rows));
await sql(`DELETE FROM pos.channex_outbox WHERE unit_id = $1`, A);
r = await call('PUT', `/api/holidays/${H_THU}`, { date: FRI });
rows = await outbox();
check('moving the Selangor holiday Thu -> Fri re-queues both (Fri now 350 direct)', r.status === 200 && at('chk-web', FRI) === 350 && at('chk-web', THU) !== undefined, JSON.stringify(rows));
await sql(`UPDATE pos.units SET channex_property_id = NULL, channex_room_type_id = NULL, channex_rate_plan_id = NULL, channex_rate_plan_airbnb = NULL, channex_rate_plan_booking_com = NULL, channex_rate_plan_agoda = NULL WHERE id = $1`, A);
await sql(`DELETE FROM pos.channex_outbox WHERE unit_id = $1`, A);

/* ---------- batch edit ---------- */
const batch = { unitIds: [A, B], ops: [{ channel: 'web', level: 'base', action: 'pct', value: 10 }, { channel: 'booking_com', level: 'weekend', action: 'set', value: 40000 }, { channel: 'web', level: 'holiday', action: 'set', value: 33000 }] };
r = await call('POST', '/api/pricing/batch', { ...batch, dryRun: true }, 'housekeeper');
check('a cleaner may not batch edit (403)', r.status === 403, r.text);
r = await call('POST', '/api/pricing/batch', { ...batch, dryRun: true });
const pa = r.json?.units?.find(u => u.unitId === A), pb = r.json?.units?.find(u => u.unitId === B);
const line = (u, ch, lv) => u?.changes?.prices?.find(p => p.channel === ch && p.level === lv);
check('dry run answers for both units', r.status === 200 && r.json?.dryRun === true && r.json?.changed === 2, r.text.slice(0, 300));
check('A nightly 200 -> 220, holiday 350 -> 330', line(pa, 'web', 'base')?.from === 20000 && line(pa, 'web', 'base')?.to === 22000 && line(pa, 'web', 'holiday')?.to === 33000, JSON.stringify(pa?.changes));
check('A Booking.com (10%) follows the new nightly: 220 -> 242; weekend fixed 400', line(pa, 'booking_com', 'base')?.to === 24200 && line(pa, 'booking_com', 'weekend')?.to === 40000, JSON.stringify(pa?.changes?.prices?.filter(p => p.channel === 'booking_com')));
check('A Airbnb fixed is not moved by the direct change', !line(pa, 'airbnb', 'base'), JSON.stringify(line(pa, 'airbnb', 'base')));
// Direct changes go first, so B's Booking.com switches to fixed from the new direct prices: nightly 198 + 18%.
check('B (default 18%) switches Booking.com to fixed from the new direct: 233.64 nightly, 400 weekend', line(pb, 'web', 'base')?.to === 19800 && line(pb, 'booking_com', 'base')?.to === 23364 && line(pb, 'booking_com', 'weekend')?.to === 40000, JSON.stringify(pb?.changes));
r = await call('GET', '/api/pricing/rules');
check('dry run stored nothing', r.json?.units?.find(u => u.unitId === A)?.baseRate === 20000);
r = await call('POST', '/api/pricing/batch', batch);
check('batch saved for 2 units', r.status === 200 && r.json?.changed === 2, r.text.slice(0, 300));
r = await call('GET', '/api/pricing/rules');
const sa = r.json?.units?.find(u => u.unitId === A), sb = r.json?.units?.find(u => u.unitId === B);
check('saved: A 220 / holiday 330, B 198 / holiday 330, B Booking.com fixed weekend 400', sa?.baseRate === 22000 && sa?.holidayRate === 33000 && sb?.baseRate === 19800 && sb?.holidayRate === 33000 && sb?.levels?.booking_com?.weekend === 40000 && sb?.rates?.find(x => x.channel === 'booking_com')?.mode === 'fixed', JSON.stringify({ a: sa?.levels?.web, b: sb?.levels }));
r = await call('GET', `/api/audit?entityTable=units&entityId=${encodeURIComponent('batch:2')}`);
const entries = r.json?.data ?? r.json?.entries ?? r.json?.rows ?? [];
check('one History entry for the batch', r.status === 200 && entries.some(e => e.action === 'pricing.batch'), r.text.slice(0, 200));
r = await call('POST', '/api/pricing/batch', { unitIds: [A], ops: [{ channel: 'web', level: 'base', action: 'clear' }] });
check('emptying the nightly price is refused (422)', r.status === 422, r.text);

r = await call('PUT', '/api/rates', { unitId: B, channel: 'booking_com', uplift: 2000 });
r = await call('GET', '/api/pricing/rules');
const rb = r.json?.units?.find(u => u.unitId === B);
check('an RM amount (older body) replaces fixed prices: B Booking.com back to direct + RM 20', rb?.rates?.find(x => x.channel === 'booking_com')?.mode === 'amount' && rb?.levels?.booking_com?.base === 21800, JSON.stringify(rb?.levels?.booking_com));

/* ---------- HR still reads the list ---------- */
const year = TUE.slice(0, 4);
r = await call('GET', `/api/leaves?year=${year}`);
const hrDays = (r.json?.holidays ?? []).map(h => h.date);
check('HR leave reads the shared list: all-state staff days off in', r.status === 200 && hrDays.includes(TUE) && hrDays.includes(SAT), JSON.stringify(hrDays).slice(0, 300));
check('...and leaves out the Penang and Selangor pricing-only days', !hrDays.includes(add(NEXT_TUE, 1)) && !hrDays.includes(FRI), JSON.stringify(hrDays));
r = await call('PUT', `/api/holidays/${H_PEN}`, { staffDayOff: true });
r = await call('GET', `/api/leaves?year=${year}`);
check('marking one a staff day off puts it on HR\'s list', (r.json?.holidays ?? []).some(h => h.date === add(NEXT_TUE, 1)));
r = await call('GET', '/api/holidays?year=' + year);
const before = r.json?.data ?? [];
check('GET /holidays lists them with states and unit counts', r.status === 200 && before.some(h => h.id === H_TUE) && r.json?.states?.includes('Penang') && typeof r.json?.totalUnits === 'number', r.text.slice(0, 200));
const allStates = before.filter(h => h.state === null).map(h => ({ date: h.date, name: h.name }));
r = await call('PUT', '/api/leaves/holidays', [...allStates.filter(h => h.date !== SAT)]);
r = await call('GET', '/api/holidays?year=' + year);
check('HR\'s older PUT sets the all-state entries (Saturday gone) and keeps state ones', r.json?.data?.every(h => h.date !== SAT || h.state !== null) && r.json?.data?.some(h => h.id === H_PEN), JSON.stringify(r.json?.data?.map(h => [h.date, h.state])));

/* ---------- Malaysia starting list ---------- */
await sql(`DELETE FROM pos.public_holidays WHERE holiday_date LIKE '2027-%' AND state IS NULL`);
r = await call('POST', '/api/holidays/load', { year: 2027, dryRun: true });
check('2027 dry run: 15 new, nothing stored', r.status === 200 && r.json?.items?.length === 15 && r.json.items.every(i => i.status === 'new'), r.text.slice(0, 200));
r = await call('POST', '/api/holidays/load', { year: 2027 });
check('2027 loaded: 15 added', r.status === 200 && r.json?.added === 15, r.text.slice(0, 200));
r = await call('POST', '/api/holidays/load', { year: 2027, dryRun: true });
check('loading again adds nothing', r.json?.items?.every(i => i.status === 'on_list'));
r = await call('POST', '/api/holidays/load', { year: 2031 });
check('no built-in list for 2031 (422)', r.status === 422, r.text);

// Tidy up this run's week and put the two units back.
await sql(`DELETE FROM pos.public_holidays WHERE holiday_date BETWEEN $1 AND $2`, add(MON, -1), add(MON, 9));
await sql(`DELETE FROM pos.channel_rates WHERE unit_id = ANY($1) AND rate_date BETWEEN $2 AND $3`, [A, B], add(MON, -1), add(MON, 9));
for (const u of keptUnits) await sql(`UPDATE pos.units SET base_rate = $2, weekend_rate = $3, holiday_rate = $4, holiday_eve = $5, cost_floor = $6 WHERE id = $1`, u.id, u.base_rate, u.weekend_rate, u.holiday_rate, u.holiday_eve, u.cost_floor);
await sql(`DELETE FROM pos.channel_uplifts WHERE unit_id = ANY($1)`, [A, B]);
for (const x of keptRules) await sql(`INSERT INTO pos.channel_uplifts (unit_id, channel, uplift, mode, percent, fixed_base, fixed_weekend, fixed_holiday, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  x.unit_id, x.channel, x.uplift, x.mode, x.percent, x.fixed_base, x.fixed_weekend, x.fixed_holiday, x.updated_at);
done();
