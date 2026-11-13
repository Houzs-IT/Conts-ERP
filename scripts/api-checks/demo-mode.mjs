// Demo mode's guards (Owner Hub plan, owner, 2 Nov 2026; migration 0199): sample data never reaches the real tables.
//   1. the demo store: demo.v_* show every real row live, plus demo rows; a shadow stands in for its real row there
//      while the real row stays as it was; Clear demo removes demo rows and shadows
//   2. the database rule: a demo- id is refused in pos.reservations, reviews, units, owners and guests, and in the
//      money and channel tables' references (statement lines, payouts, the Channex outbox)
//   3. with API_BASE (a local server on the same database): the Demo switch is for management and sales staff only;
//      a sample reservation shows in Demo mode and nowhere else: never in the owner portal API (/api/owner/*), an
//      owner statement or the reservations export; editing a real reservation in Demo mode leaves pos unchanged;
//      Clear demo empties the store
//   4. the whole system (migration 0203): demo_pos has every pos table and column; writes through it land in the
//      store; with API_BASE, the normal screens' actions (add owner, unit, reservation, maintenance job, cancel a real
//      reservation) work in Demo and reach nothing in pos; Owners, Units, Reservations, Guests, Maintenance, Calendar
//      show the demo rows and live does not; Dashboard, Analytics and Performance count them; real-only actions
//      (finalise, send, payouts, Channex sync, users) are refused; the owner portal API and the units export are unchanged
//
// Run against a throwaway database (scripts/ci-api-db.mjs, or scripts/dev-pglite.mjs) as its owner:
//   DB_URL=postgres://postgres@127.0.0.1:5432/ci [API_BASE=http://localhost:8788] node scripts/api-checks/demo-mode.mjs
// It adds demo rows and clears them again; real rows are only read.
import postgres from 'postgres';
import { check, done, cookieFor } from './harness.mjs';

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
check('editing a real reservation in Demo mode makes a shadow under the real id', shadowId === res.id, shadowId);
await sql`update demo.reservations set notes = 'changed in demo', gross_booking_value = 1 where id = ${shadowId}`;
const [seen] = await sql`select notes, gross_booking_value, demo_source, demo_id from demo.v_reservations where id = ${res.id}`;
check('Demo mode shows the shadow under the real id', seen?.notes === 'changed in demo' && seen.demo_source === 'shadow' && seen.demo_id === res.id, JSON.stringify(seen));
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
// The whole-system overlay (migration 0203): demo_pos has every pos table, with every pos column, so a Demo mode
// request's unqualified SQL lands there. A migration that forgot `select demo.sync()` fails here.
const missing = await sql`select t.tablename from pg_tables t where t.schemaname = 'pos'
  and not exists (select 1 from pg_views v where v.schemaname = 'demo_pos' and v.viewname = t.tablename)`;
check('demo_pos has a view for every pos table', missing.length === 0, missing.map(x => x.tablename).join(', '));
const stale = await sql`select c.table_name, c.column_name from information_schema.columns c where c.table_schema = 'pos'
  and c.table_name in (select tablename from pg_tables where schemaname = 'pos')
  and not exists (select 1 from information_schema.columns d where d.table_schema = 'demo_pos' and d.table_name = c.table_name and d.column_name = c.column_name)`;
check('every demo_pos view has every column of its pos table (demo.sync ran after the last migration)', stale.length === 0, stale.slice(0, 5).map(x => `${x.table_name}.${x.column_name}`).join(', '));

// Writing through demo_pos: insert, update and delete land in the store; pos stays as it was.
const [task] = await sql`select id, title from tasks order by id limit 1`;
const [own] = await sql`select id, display_name from owners order by id limit 1`;
const overlay = await sql.begin(async (tx) => {
  await tx`set local search_path = demo_pos, pos`;
  await tx`update owners set display_name = 'Owner renamed in demo' where id = ${own.id}`;
  await tx`insert into audit_log (actor_label, action, entity_table, entity_id, occurred_at) values ('demo-mode check', 'demo.check', 'owners', ${own.id}, ${stamp})`;
  if (task) await tx`delete from tasks where id = ${task.id}`;
  const [o] = await tx`select display_name, demo_source from owners where id = ${own.id}`;
  const [t] = task ? await tx`select count(*)::int n from tasks where id = ${task.id}` : [{ n: 0 }];
  const [a] = await tx`select count(*)::int n from audit_log where action = 'demo.check'`;
  let refusedLive = '';
  await tx.savepoint((sp) => sp`update payouts set id = id`).catch((err) => { refusedLive = err.message; });
  return { o, t: t.n, a: a.n, refusedLive };
});
check('demo_pos: a real owner edited in Demo shows the change, marked shadow', overlay.o?.display_name === 'Owner renamed in demo' && overlay.o.demo_source === 'shadow', JSON.stringify(overlay.o));
check('demo_pos: a real task removed in Demo is gone there', overlay.t === 0);
check('demo_pos: History written in Demo shows there', overlay.a === 1);
check('demo_pos: a live-only table (payouts) refuses a change in Demo', /^Demo: /.test(overlay.refusedLive) || !(await sql`select 1 from payouts limit 1`).length, overlay.refusedLive);
check('pos is unchanged: the owner, the task and History', (await sql`select display_name from owners where id = ${own.id}`)[0].display_name === own.display_name
  && (!task || (await sql`select count(*)::int n from tasks where id = ${task.id}`)[0].n === 1)
  && (await sql`select count(*)::int n from audit_log where action = 'demo.check'`)[0].n === 0);

const cleared = (await sql`select demo.clear() as c`)[0].c;
check('Clear demo removes demo rows and shadows', cleared.reservations === 2 && cleared.guests === 1, JSON.stringify(cleared));
check('...and Demo mode shows the real reservations only', await count('demo.v_reservations') === real);

if (process.env.API_BASE) await apiChecks(process.env.API_BASE);
check('no demo- id reached pos.reservations, reviews, units, owners or guests', Number((await sql`select
    (select count(*) from reservations where id like 'demo-%') + (select count(*) from reviews where id like 'demo-%' and id not like 'demo-review-%')
    + (select count(*) from units where id like 'demo-%') + (select count(*) from owners where id like 'demo-%') + (select count(*) from guests where id like 'demo-%') as n`)[0].n) === 0);
await sql.end();
done();

/** The whole system in Demo mode (owner, 3 Nov 2026; migration 0203): every screen's endpoint shows the demo rows and
 *  live does not; the normal screens' own actions work in Demo and write only to the store; real-only actions are
 *  refused; the guarded paths (owner portal, exports, outbox, messages out) never see or send demo data. */
async function wholeSystem(send, strip, unitId, realOwnerId) {
  const posCounts = async () => (await sql`select (select count(*) from reservations) r, (select count(*) from owners) o, (select count(*) from units) u,
    (select count(*) from guests) g, (select count(*) from tasks) t, (select count(*) from maintenance_issues) m, (select count(*) from owner_statements) s,
    (select count(*) from audit_log where action <> 'owner.view_as') a, (select count(*) from channex_outbox) x, (select count(*) from notification_log) n`)[0];
  const sumBefore = await send('management', 'GET', `/api/owner/summary?ownerId=${encodeURIComponent(realOwnerId)}`, undefined, false);
  const exportBefore = await send('management', 'GET', '/api/units/export', undefined, false);
  const before = await posCounts();

  // Actions on the normal screens, Demo on.
  let r = await send('management', 'POST', '/api/owners', { displayName: 'Whole System Demo Owner', email: 'whole.demo@example.com', phone: '+60123450001' });
  const ownerId = r.json?.id;
  check('Demo: Owners > Add owner works and makes a demo- id', r.status === 201 && ownerId?.startsWith('demo-'), `${r.status} ${r.text.slice(0, 200)}`);
  const [building] = await sql`select id from properties order by id limit 1`;
  r = await send('management', 'POST', '/api/units', { buildingId: building.id, ownerId, unitCode: 'WS-DEMO-1' });
  const newUnit = r.json?.id;
  check('Demo: Units > Add unit for the demo owner works', r.status === 201 && String(newUnit).startsWith('demo-'), `${r.status} ${r.text.slice(0, 200)}`);
  r = await send('management', 'PATCH', `/api/units/${unitId}`, { listingName: 'Whole system demo listing' });
  check('Demo: editing a real unit works', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  // A stay that has started (yesterday to tomorrow), so this month's KPIs and charts count it.
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  let resId = null;
  for (const [ci, co] of [[day(-1), day(1)], [day(-3), day(-1)], [day(1), day(3)]]) {
    for (const x of await sql`select id from units where purpose = 'rental' order by id`) {
      r = await send('management', 'POST', '/api/reservations', { unitId: x.id, channel: 'direct', checkIn: ci, checkOut: co, guestsCount: 2, grossBookingValue: 4321000, guest: { fullName: 'Whole System Guest' } });
      if (r.status === 201) { resId = r.json.id; break; }
    }
    if (resId) break;
  }
  check('Demo: Reservations > New reservation works and makes a demo- id', !!resId && resId.startsWith('demo-'), `${r.status} ${r.text.slice(0, 200)}`);
  r = await send('management', 'POST', '/api/maintenance/issues', { unitId, title: 'Whole system demo leak', category: 'plumbing', urgency: 'normal', source: 'staff' });
  const jobId = r.json?.id;
  check('Demo: Maintenance > Add job works', r.status === 201 && jobId?.startsWith('demo-'), `${r.status} ${r.text.slice(0, 200)}`);
  const [realRes] = await sql`select id, state from reservations where state = 'confirmed' and channel not in ('maintenance_block','owner_stay') order by id limit 1`;
  if (realRes) {
    r = await send('management', 'PATCH', `/api/reservations/${realRes.id}`, { state: 'cancelled', reason: 'whole system demo' });
    check('Demo: cancelling a real reservation works in Demo', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
    check('...and the real reservation is still confirmed', (await sql`select state from reservations where id = ${realRes.id}`)[0].state === 'confirmed');
  }

  // Every covered screen: Demo shows the demo rows, live does not.
  const both = async (path) => [await send('management', 'GET', path), await send('management', 'GET', path, undefined, false)];
  const shows = async (label, path, needle) => {
    const [on, off] = await both(path);
    check(`Demo: ${label} shows the demo row; live does not`, on.status === 200 && off.status === 200 && on.text.includes(needle) && !off.text.includes(needle), `${on.status}/${off.status}`);
  };
  await shows('Owners (A) list', '/api/owners?pageSize=500', ownerId);
  const [pOn, pOff] = await both(`/api/owners/${encodeURIComponent(ownerId)}/pnl`);
  check('Demo: the demo owner profile (P&L tab) opens in Demo, not live', pOn.status === 200 && pOff.status !== 200, `${pOn.status}/${pOff.status} ${pOn.text.slice(0, 120)}`);
  await shows('Unit profile', `/api/units/detail?unitId=${unitId}`, 'Whole system demo listing');
  await shows('Reservations', '/api/reservations?view=all&q=Whole%20System%20Guest', resId);
  await shows('Guests', '/api/guests?q=Whole%20System', 'Whole System Guest');
  await shows('Maintenance', '/api/maintenance/issues', jobId);
  await shows('Calendar', `/api/reservations/calendar?from=${day(-5)}&to=${day(5)}`, resId);
  const differs = async (label, path) => {
    const [on, off] = await both(path);
    check(`Demo: ${label} counts the demo reservation (Demo and live differ)`, on.status === 200 && off.status === 200 && strip(on.json) !== strip(off.json), `${on.status}/${off.status}`);
  };
  await differs('Dashboard KPIs', '/api/dashboard/kpis');
  await differs('Analytics', '/api/analytics');
  await differs('Performance', '/api/portfolio/performance');
  await shows('Units list', '/api/units', 'WS-DEMO-1');

  // Real-only actions are refused in Demo; the guarded paths never see demo data.
  for (const [m, path] of [['POST', '/api/statements/finalise'], ['POST', '/api/statements/unlock-final'], ['POST', '/api/statements/send'], ['POST', '/api/payouts/run'], ['POST', '/api/integrations/channex/full-sync'], ['POST', '/api/users']]) {
    r = await send('management', m, path, {});
    check(`Demo: ${path} is refused (real-only)`, r.status === 409 && r.json?.error?.code === 'DEMO_MODE', `${r.status} ${r.text.slice(0, 120)}`);
  }
  const after = await posCounts();
  const sumAfter = await send('management', 'GET', `/api/owner/summary?ownerId=${encodeURIComponent(realOwnerId)}`);
  check('Guard: the owner portal API is the same with Demo on', sumAfter.status === 200 && strip(sumAfter.json) === strip(sumBefore.json));
  const exportAfter = await send('management', 'GET', '/api/units/export');
  check('Guard: the units export is the same with Demo on (no demo note)', exportAfter.status === 200 && exportAfter.text === exportBefore.text);
  check('Guard: nothing reached pos (reservations, owners, units, guests, tasks, jobs, statements, History, Channex outbox, messages)',
    JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  check('Guard: the demo store holds the work', Number((await sql`select (select count(*) from demo.owners where id = ${ownerId}) + (select count(*) from demo.maintenance_issues where id = ${jobId})
    + (select count(*) from demo.audit_log) as n`)[0].n) >= 3);
}

async function apiChecks(BASE) {
  const send = async (role, method, path, body, demo = true) => {
    const r = await fetch(BASE + path, { method, headers: { cookie: `${cookieFor(role)}${demo ? '; tc_demo=1' : ''}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t, cookie: r.headers.get('set-cookie') ?? '' };
  };
  const strip = (j) => JSON.stringify(j, (k, v) => (k === 'generatedAt' ? undefined : v));

  let r = await send('management', 'POST', '/api/demo', { on: true }, false);
  check('API: management may turn Demo mode on (the cookie is set)', r.status === 200 && /tc_demo=1/.test(r.cookie), `${r.status} ${r.text}`);
  for (const role of ['operations_staff', 'finance_admin', 'housekeeper']) {
    r = await send(role, 'POST', '/api/demo', { on: true }, false);
    check(`API: ${role} may not turn Demo mode on`, r.status === 403, `${r.status} ${r.text}`);
  }
  // Sales staff may (owner, 2 Nov 2026): the same operations account, moved into the Sales department for a moment.
  const opsId = '11111111-1111-4111-8111-000000000004';
  const [placed] = await sql`select department_id, position_id, department, position, side from users where id = ${opsId}`;
  const [sales] = await sql`select d.id, d.name, d.side, p.id as position_id, p.name as position from departments d join positions p on p.department_id = d.id where d.name = 'Sales' order by p.name limit 1`;
  if (placed && sales) {
    await sql`update users set department_id = ${sales.id}, position_id = ${sales.position_id}, department = ${sales.name}, position = ${sales.position}, side = 'both' where id = ${opsId}`;
    r = await send('operations_staff', 'POST', '/api/demo', { on: true }, false);
    check('API: a desk account in the Sales department may turn Demo mode on', r.status === 200, `${r.status} ${r.text}`);
    await sql`update users set department_id = ${placed.department_id}, position_id = ${placed.position_id}, department = ${placed.department}, position = ${placed.position}, side = ${placed.side} where id = ${opsId}`;
  }

  // An owner with a final statement, one of their units, and a free night in that statement's month.
  const [st] = await sql`select s.id, s.owner_id, substr(s.period_start, 1, 7) as period from owner_statements s
    where s.state in ('finalised','sent','paid') and exists (select 1 from units u where u.owner_id = s.owner_id) order by s.period_start desc limit 1`;
  const [u] = await sql`select id from units where owner_id = ${st.owner_id} order by id limit 1`;
  const ownerQs = `ownerId=${encodeURIComponent(st.owner_id)}`;
  const sumBefore = await send('management', 'GET', `/api/owner/summary?${ownerQs}&period=${st.period}`, undefined, false);
  const stBefore = await send('management', 'GET', `/api/owner/statements/${st.id}?${ownerQs}`, undefined, false);
  const exportBefore = await send('management', 'GET', '/api/reservations/export?view=all', undefined, false);
  let made = null;
  for (let d = 1; d <= 27 && !made; d++) {
    const ci = `${st.period}-${String(d).padStart(2, '0')}`, co = `${st.period}-${String(d + 1).padStart(2, '0')}`;
    r = await send('management', 'POST', '/api/demo/reservations', { unitId: u.id, guestName: 'Demo Check Guest', channel: 'direct', checkIn: ci, checkOut: co, guestsCount: 2, grossBookingValue: 777700 });
    if (r.status === 201) made = r.json.id;
  }
  check('API: a sample reservation is created in Demo mode', !!made && made.startsWith('demo-r-'), r.text);
  r = await send('management', 'POST', '/api/demo/reservations', { unitId: u.id }, false);
  check('API: sample data needs Demo mode on (409 without it)', r.status === 409, `${r.status}`);

  const listOn = await send('management', 'GET', '/api/reservations?view=all&q=Demo%20Check%20Guest');
  check('API: Demo mode lists the sample reservation, marked sample', !!listOn.json?.data?.some(x => x.id === made && x.sample === 'demo'), listOn.text.slice(0, 300));
  const listOff = await send('management', 'GET', '/api/reservations?view=all&q=Demo%20Check%20Guest', undefined, false);
  check('API: live mode does not list it', listOff.status === 200 && !listOff.json?.data?.some(x => x.id === made), listOff.text.slice(0, 300));
  const notAllowed = await send('operations_staff', 'GET', '/api/reservations?view=all&q=Demo%20Check%20Guest');
  check('API: the Demo cookie means nothing for someone who may not use it', notAllowed.status === 200 && !notAllowed.json?.data?.some(x => x.id === made), `${notAllowed.status}`);

  const sumAfter = await send('management', 'GET', `/api/owner/summary?${ownerQs}&period=${st.period}`);
  const stAfter = await send('management', 'GET', `/api/owner/statements/${st.id}?${ownerQs}`);
  const exportAfter = await send('management', 'GET', '/api/reservations/export?view=all');
  check('API: the owner portal summary is the same in Demo mode (no sample reservation in /api/owner/*)', sumAfter.status === 200 && strip(sumAfter.json) === strip(sumBefore.json), `${sumAfter.status} ${strip(sumAfter.json).slice(0, 200)}`);
  check('API: the owner statement is the same in Demo mode', stAfter.status === stBefore.status && strip(stAfter.json) === strip(stBefore.json), `${stAfter.status}`);
  check('API: the reservations export never carries a sample reservation', exportAfter.status === 200 && !exportAfter.text.includes('Demo Check Guest') && exportAfter.text.length === exportBefore.text.length, `${exportAfter.status}`);

  // Editing a real reservation in Demo mode: a shadow, pos unchanged.
  const [realRes] = await sql`select id, guests_count, notes from reservations where state not in ('cancelled','no_show') and channel not in ('maintenance_block','owner_stay') order by id limit 1`;
  r = await send('management', 'PATCH', `/api/demo/reservations/${realRes.id}`, { notes: 'Edited in demo check', guestsCount: 9 });
  check('API: editing a real reservation in Demo mode saves', r.status === 200 && r.json?.shadow === true, `${r.status} ${r.text}`);
  const [after] = await sql`select guests_count, notes from reservations where id = ${realRes.id}`;
  check('API: ...and the real reservation is unchanged', Number(after.guests_count) === Number(realRes.guests_count) && after.notes === realRes.notes);
  const detail = await send('management', 'GET', `/api/reservations/${realRes.id}`);
  check('API: Demo mode shows the edited copy, marked', detail.json?.notes === 'Edited in demo check' && detail.json?.sample === 'shadow', detail.text.slice(0, 200));
  const detailLive = await send('management', 'GET', `/api/reservations/${realRes.id}`, undefined, false);
  check('API: live mode shows the real reservation', detailLive.json?.notes === realRes.notes && !detailLive.json?.sample);

  await wholeSystem(send, strip, u.id, st.owner_id);
  r = await send('management', 'POST', '/api/demo/reviews', { unitId: u.id, channel: 'airbnb', rating: 5, comment: 'Demo check review', reviewedAt: `${st.period}-15` });
  check('API: a sample review is created', r.status === 201, r.text);
  const reviews = await send('management', 'GET', '/api/reviews');
  check('API: Demo mode shows the sample review, marked', !!reviews.json?.data?.some(x => x.comment === 'Demo check review' && x.sample === 'demo'));
  const reviewsLive = await send('management', 'GET', '/api/reviews', undefined, false);
  check('API: live mode does not', !reviewsLive.json?.data?.some(x => x.comment === 'Demo check review'));

  // The sample owner portal: sample owners only, every answer marked sample, nothing reaching the real portal.
  const unitsBefore = Number((await sql`select count(*)::int n from units`)[0].n);
  r = await send('management', 'POST', '/api/demo/owners', { name: 'Check Sample Owner', unitIds: [u.id], fill: true }, false);
  check('API: a sample owner is made with sample reservations', r.status === 201 && r.json?.id?.startsWith('demo-o-') && r.json.reservations > 0, `${r.status} ${r.text}`);
  const sampleOwner = r.json?.id;
  r = await send('operations_staff', 'POST', '/api/demo/owners', { name: 'X', unitIds: [u.id] }, false);
  check('API: someone not allowed cannot make a sample owner', r.status === 403, `${r.status}`);
  check('API: real units are untouched by a sample owner', Number((await sql`select count(*)::int n from units`)[0].n) === unitsBefore
    && Number((await sql`select count(*)::int n from units where owner_id = ${sampleOwner}`)[0].n) === 0);
  const q = `ownerId=${encodeURIComponent(sampleOwner)}`;
  const portal = {};
  for (const ep of ['summary', 'trend?months=8', 'property-health', 'documents']) {
    portal[ep] = await send('management', 'GET', `/api/demo/portal/${ep}${ep.includes('?') ? '&' : '?'}${q}`, undefined, false);
    check(`API: sample portal ${ep.split('?')[0]} answers with sample: true`, portal[ep].status === 200 && portal[ep].json?.sample === true, `${portal[ep].status} ${portal[ep].text.slice(0, 200)}`);
  }
  check('API: the sample summary lists only the sample owner units', portal.summary.json?.units?.every(x => x.id.startsWith('demo-u-') && / \(sample\)$/.test(x.label)), JSON.stringify(portal.summary.json?.units));
  const sid = portal.summary.json?.statementId || portal.documents.json?.data?.[0]?.refId;
  r = await send('management', 'GET', `/api/demo/portal/statements/${encodeURIComponent(sid)}?${q}`, undefined, false);
  check('API: a sample statement answers with sample: true', r.status === 200 && r.json?.sample === true && r.json.units?.length === 1, `${r.status} ${r.text.slice(0, 200)}`);
  r = await send('management', 'GET', `/api/demo/portal/statements/${encodeURIComponent(sid)}/pdf?${q}`, undefined, false);
  check('API: the sample statement PDF carries SAMPLE DATA', r.status === 200 && r.text.includes('SAMPLE DATA') && r.text.includes('Sample data'), `${r.status}`);
  r = await send('management', 'GET', `/api/demo/portal/summary?ownerId=${encodeURIComponent(st.owner_id)}`, undefined, false);
  check('API: the sample portal never serves a real owner', r.status === 422, `${r.status} ${r.text.slice(0, 120)}`);
  r = await send('operations_staff', 'GET', `/api/demo/portal/summary?${q}`, undefined, false);
  check('API: the sample portal is refused to someone not allowed', r.status === 403, `${r.status}`);
  const sumWithSample = await send('management', 'GET', `/api/owner/summary?${ownerQs}&period=${st.period}`, undefined, false);
  check('API: the real owner portal is unchanged by a sample owner on a copy of their unit', strip(sumWithSample.json) === strip(sumBefore.json));
  r = await send('management', 'DELETE', `/api/demo/owners/${encodeURIComponent(sampleOwner)}`, undefined, false);
  check('API: a sample owner can be removed', r.status === 200, r.text);
  check('API: ...with their sample units and reservations', Number((await sql`select (select count(*) from demo.units where owner_id = ${sampleOwner})
    + (select count(*) from demo.owners where id = ${sampleOwner}) as n`)[0].n) === 0);

  r = await send('management', 'DELETE', '/api/demo');
  check('API: Clear demo', r.status === 200 && r.json?.cleared?.reservations >= 2, r.text);
  check('API: the store is empty afterwards', Number((await sql`select (select count(*) from demo.reservations) + (select count(*) from demo.reviews) + (select count(*) from demo.guests) as n`)[0].n) === 0);
}
