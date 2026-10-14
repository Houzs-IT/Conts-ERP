// A booking from a booking site reaches its owner statement (functions/_lib/channexBookingSync.ts sets collected_revenue).
// Feeds one Airbnb booking and one change to it through the real booking sync, with Channex's answers stubbed, then
// builds that unit's month with the owner-statement rules. Throwaway database only:
//   1. PORT=55461 node scripts/dev-pglite.mjs            (leave it running)
//   2. npx tsx scripts/api-checks/channex-collected-revenue.mjs [postgres://pos_app:local@127.0.0.1:55461/postgres]
import { all, run } from '../../functions/_lib/db.ts';
import { processChannexBookingFeed } from '../../functions/_lib/channexBookingSync.ts';
import { loadInputs, computeMonth, statementSettings } from '../../functions/_lib/ownerStatement.ts';

const url = process.argv[2] ?? 'postgres://pos_app:local@127.0.0.1:55461/postgres';
if (!/@(127\.0\.0\.1|localhost):/.test(url)) { console.error('Refused: local database only.'); process.exit(2); }
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}`); };

// The app's own database helper throughout: PGlite takes one connection at a time.
const env = { HYPERDRIVE: { connectionString: url }, CHANNEX_API_KEY: 'stub', CHANNEX_BASE_URL: 'http://channex.stub' };
const [unit] = await all(env, 'SELECT id FROM units WHERE owner_id IS NOT NULL ORDER BY unit_number LIMIT 1');
await run(env, "UPDATE units SET channex_property_id = 'cx-prop-test', channex_room_type_id = 'cx-room-test', channex_rate_plan_id = 'cx-rate-test' WHERE id = ?", unit.id);

// What Channex would send: Airbnb's amount is the host payout; the host fee is in the notes (channexAmounts.ts).
let feed = [];
const revision = (id, checkOut, payout, fee) => ({ id, attributes: {
  booking_id: 'cx-booking-test', property_id: 'cx-prop-test', status: 'new', ota_name: 'AirBNB', ota_reservation_code: 'HMTEST01',
  arrival_date: '2031-03-10', departure_date: checkOut, currency: 'MYR', amount: payout,
  notes: `Listing Cancellation Payout: ${payout}\nListing Cancellation Host Fee: ${fee}`,
  customer: { name: 'Test', surname: 'Guest' }, occupancy: { adults: 2 },
  rooms: [{ room_type_id: 'cx-room-test', amount: payout, occupancy: { adults: 2 } }],
} });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = String(input);
  if (!u.startsWith('http://channex.stub')) return realFetch(input, init);
  const body = u.includes('/booking_revisions/feed') ? { data: feed } : { data: {} };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const reservation = async () => (await all(env, "SELECT gross_booking_value, channel_fee, collected_revenue, state FROM reservations WHERE channex_booking_id = 'cx-booking-test'"))[0];
const marchIncome = async () => {
  // loadInputs asks for four things at once; PGlite serves one connection at a time, so they queue here.
  let chain = Promise.resolve();
  const q = (text, ...args) => { const p = chain.then(() => all(env, text, ...args)); chain = p.catch(() => {}); return p; };
  const settings = await statementSettings(q);
  const inputs = await loadInputs(q, '2031-03-01', '2031-04-01', { unitId: unit.id });
  const [month] = computeMonth('2031-03', inputs, settings, 'open');
  return month?.lines?.filter(l => l.type === 'gross').reduce((n, l) => n + Number(l.amount), 0) ?? 0;
};
const lastSkip = async () => (await all(env, "SELECT after_state FROM audit_log WHERE action = 'channex.booking_skipped' ORDER BY occurred_at DESC LIMIT 1"))[0]?.after_state;

try {
  feed = [revision('rev-1', '2031-03-13', '312.21', '62.79')];
  const first = await processChannexBookingFeed(env);
  const r1 = await reservation();
  check('the booking comes in', first.processed === 1 && !!r1, `${JSON.stringify(first)} ${JSON.stringify(await lastSkip())}`);
  check('booking value is payout + host fee (RM 375.00), fee RM 62.79', Number(r1?.gross_booking_value) === 37500 && Number(r1?.channel_fee) === 6279, JSON.stringify(r1));
  check('collected revenue is the payout, RM 312.21', Number(r1?.collected_revenue) === 31221, JSON.stringify(r1));
  const income1 = await marchIncome();
  check('the owner statement for March counts the payout as income', Math.round(income1) === 31221, `income ${income1}`);

  feed = [revision('rev-2', '2031-03-14', '416.28', '83.72')];
  await processChannexBookingFeed(env);
  const r2 = await reservation();
  check('a change to the stay updates the collected revenue (RM 416.28)', Number(r2?.collected_revenue) === 41628, JSON.stringify(r2));
  const income2 = await marchIncome();
  check('and the statement follows it', Math.round(income2) === 41628, `income ${income2}`);
} finally {
  await run(env, "DELETE FROM reservations WHERE channex_booking_id = 'cx-booking-test'").catch(() => {});
  await run(env, 'UPDATE units SET channex_property_id = NULL, channex_room_type_id = NULL, channex_rate_plan_id = NULL WHERE id = ?', unit.id).catch(() => {});
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
