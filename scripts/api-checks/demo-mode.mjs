// Demo mode's guards (Owner Hub plan, owner, 2 Nov 2026; migration 0199): sample data never reaches the real tables.
//   1. the demo store: demo.v_* show every real row live, plus demo rows; a shadow stands in for its real row there
//      while the real row stays as it was; Clear demo removes demo rows and shadows
//   2. the database rule: a demo- id is refused in pos.reservations, reviews, units, owners and guests, and in the
//      money and channel tables' references (statement lines, payouts, the Channex outbox)
//
// Run against a throwaway database (scripts/ci-api-db.mjs, or scripts/dev-pglite.mjs) as its owner:
//   DB_URL=postgres://postgres@127.0.0.1:5432/ci node scripts/api-checks/demo-mode.mjs
// It adds demo rows and clears them again; real rows are only read.
import postgres from 'postgres';
import { check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to a local database.'); process.exit(2); }
const sql = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
// Each refused write on its own connection: a PGlite stand-in can hand an error to the next query on a shared one.
const refused = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { await c.unsafe(text, values); return ''; } catch (e) { return e.message; } finally { await c.end({ timeout: 5 }); }
};
const RULE = /Sample data cannot be saved/;
const stamp = new Date().toISOString();

await sql`select demo.clear()`;
const count = async (t) => Number((await sql.unsafe(`select count(*)::int n from ${t}`))[0].n);
const [real, view] = [await count('reservations'), await count('demo.v_reservations')];
check('demo starts empty: the view is exactly the real reservations', real > 0 && real === view, `${real} vs ${view}`);
for (const t of ['reviews', 'units', 'owners', 'guests']) {
  check(`demo.v_${t} is exactly pos.${t} while demo is empty`, await count(t) === await count(`demo.v_${t}`));
}

const [unit] = await sql`select id, property_id from units order by id limit 1`;
const [res] = await sql`select id, notes, gross_booking_value from reservations order by id limit 1`;
await sql`insert into demo.guests (id, full_name, created_at) values ('demo-g-check', 'Sample Guest', ${stamp})`;
await sql`insert into demo.reservations (id, unit_id, guest_id, channel, check_in, check_out, gross_booking_value, created_at, updated_at, demo_by)
  values ('demo-r-check', ${unit.id}, 'demo-g-check', 'direct', '2026-12-10', '2026-12-12', 50000, ${stamp}, ${stamp}, 'demo-mode check')`;
check('a demo reservation shows in demo.v_reservations', await count('demo.v_reservations') === real + 1);
check('...marked demo', (await sql`select demo_source from demo.v_reservations where id = 'demo-r-check'`)[0]?.demo_source === 'demo');
check('...and is not in pos.reservations', (await sql`select count(*)::int n from reservations where id like 'demo-%'`)[0].n === 0);

// A real row arriving while demo has rows shows at once (read live, never copied).
const before = await count('demo.v_reservations');
await sql`insert into reservations (id, unit_id, channel, check_in, check_out, created_at, updated_at)
  values ('check-live-1', ${unit.id}, 'direct', '2027-01-10', '2027-01-11', ${stamp}, ${stamp})`;
check('a new real reservation shows in Demo mode at once', await count('demo.v_reservations') === before + 1);
await sql`delete from reservations where id = 'check-live-1'`;

const shadowId = (await sql`select demo.shadow('reservations', ${res.id}, 'demo-mode check') as id`)[0].id;
check('editing a real reservation in Demo mode makes a shadow', shadowId === `demo-s-${res.id}`, shadowId);
await sql`update demo.reservations set notes = 'changed in demo', gross_booking_value = 1 where id = ${shadowId}`;
const [seen] = await sql`select notes, gross_booking_value, demo_source, demo_id from demo.v_reservations where id = ${res.id}`;
check('Demo mode shows the shadow under the real id', seen?.notes === 'changed in demo' && seen.demo_source === 'shadow' && seen.demo_id === shadowId, JSON.stringify(seen));
const [live] = await sql`select notes, gross_booking_value from reservations where id = ${res.id}`;
check('live is unchanged', live.notes === res.notes && Number(live.gross_booking_value) === Number(res.gross_booking_value));
check('the reservation appears once in Demo mode', (await sql`select count(*)::int n from demo.v_reservations where id = ${res.id}`)[0].n === 1);

let e = await refused(`insert into reservations (id, unit_id, channel, check_in, check_out, created_at, updated_at) values ('demo-x', $1, 'direct', '2027-02-01', '2027-02-02', $2, $3)`, unit.id, stamp, stamp);
check('the rule refuses a demo reservation in pos.reservations', RULE.test(e), e);
e = await refused(`update reservations set guest_id = 'demo-g-check' where id = $1`, res.id);
check('the rule refuses a demo guest on a real reservation', RULE.test(e), e);
e = await refused(`insert into reviews (id, unit_id, channel, rating, reviewed_at) values ('demo-v-x', $1, 'airbnb', 5, '2026-11-01')`, unit.id);
check('the rule refuses a demo review in pos.reviews', RULE.test(e), e);
e = await refused(`update units set owner_id = 'demo-o-x' where id = $1`, unit.id);
check('the rule refuses a demo owner on a real unit', RULE.test(e), e);
e = await refused(`insert into owners (id, display_name, email, created_at, updated_at) values ('demo-o-x', 'X', 'x@example.com', $1, $2)`, stamp, stamp);
check('the rule refuses a demo owner in pos.owners', RULE.test(e), e);
e = await refused(`insert into guests (id, full_name, created_at) values ('demo-g-x', 'X', $1)`, stamp);
check('the rule refuses a demo guest in pos.guests', RULE.test(e), e);
e = await refused(`insert into channex_outbox (unit_id) values ('demo-u-x')`);
check('the Channex outbox refuses a demo unit', RULE.test(e), e);
e = await refused(`update statement_lines set reservation_id = 'demo-r-check' where id = (select id from statement_lines limit 1)`);
check('statement lines refuse a demo reservation', RULE.test(e) || !(await sql`select 1 from statement_lines limit 1`).length, e);
e = await refused(`update payouts set owner_id = 'demo-o-x' where id = (select id from payouts limit 1)`);
check('payouts refuse a demo owner', RULE.test(e) || !(await sql`select 1 from payouts limit 1`).length, e);
e = await refused(`insert into demo.reviews (id, unit_id, channel, rating, reviewed_at) values ('no-prefix', $1, 'airbnb', 5, '2026-11-01')`, unit.id);
check('a demo table refuses an id without demo-', /check constraint/.test(e), e);

const cleared = (await sql`select demo.clear() as c`)[0].c;
check('Clear demo removes demo rows and shadows', cleared.reservations === 2 && cleared.guests === 1, JSON.stringify(cleared));
check('...and Demo mode shows the real reservations only', await count('demo.v_reservations') === real);
await sql.end();
done();
