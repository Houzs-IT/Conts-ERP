// Demo mode's guards (Owner Hub plan, owner, 2 Nov 2026; migration 0199): sample data never reaches the real tables.
//   1. the demo store: demo.v_* show every real row live, plus demo rows; a shadow stands in for its real row there
//      while the real row stays as it was; Clear demo removes demo rows and shadows
//   2. the database rule: a demo- id is refused in pos.reservations, reviews, units, owners and guests, and in the
//      money and channel tables' references (statement lines, payouts, the Channex outbox)
//   3. with API_BASE (a local server on the same database): the Demo switch is for management and sales staff only;
//      a sample reservation shows in Demo mode and nowhere else: never in the owner portal API (/api/owner/*), an
//      owner statement or the reservations export; editing a real reservation in Demo mode leaves pos unchanged;
//      every real write is refused while Demo mode is on; Clear demo empties the store
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

if (process.env.API_BASE) await apiChecks(process.env.API_BASE);
check('no demo- id reached pos.reservations, reviews, units, owners or guests', Number((await sql`select
    (select count(*) from reservations where id like 'demo-%') + (select count(*) from reviews where id like 'demo-%' and id not like 'demo-review-%')
    + (select count(*) from units where id like 'demo-%') + (select count(*) from owners where id like 'demo-%') + (select count(*) from guests where id like 'demo-%') as n`)[0].n) === 0);
await sql.end();
done();

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

  r = await send('management', 'PATCH', `/api/reservations/${realRes.id}`, { state: 'cancelled', reason: 'demo check' });
  check('API: a real write is refused while Demo mode is on', r.status === 409 && r.json?.error?.code === 'DEMO_MODE', `${r.status} ${r.text}`);
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
