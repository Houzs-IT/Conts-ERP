// Owner adjustments (functions/api/owners/[id]/adjustments*) and the owner's access to the Owner Income Report,
// end to end against a running local server on the real-data database:
//   - held -> open (release, dated into a chosen statement month), open -> held, -> settled outside, manual credit/charge
//   - who may change them (management, finance, operations manager) and who may not (operations staff, owners)
//   - a released debt is deducted by the next statement generated for that month, and held / settled ones are not
//   - the Owner Income Report and the old print link: an owner sees only their own, final statements
//   - every change is audited, with no note text in the audit
// Prints counts, states and amounts only, never an owner's name.
//
// Run: 1. BIGDATA_PORT=55456 node scripts/api-checks/hostplatform-import.mjs <data folder> --serve   (leave it running)
//      2. a local server on that database (SESSION_SECRET in .dev.vars), e.g. on :8806
//      3. BIGDATA_PORT=55456 BASE=http://localhost:8806 node scripts/api-checks/owner-adjustments.mjs
// It adds three test accounts and generates September 2026 statements, then puts everything back as it was.
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import postgres from 'postgres';

const PORT = Number(process.env.BIGDATA_PORT ?? 55433);
const BASE = process.env.BASE ?? 'http://localhost:8806';
const SECRET = process.env.SESSION_SECRET
  ?? (existsSync('.dev.vars') ? /SESSION_SECRET\s*=\s*"?([^"\n]+)"?/.exec(readFileSync('.dev.vars', 'utf8'))?.[1] : undefined);
if (!SECRET) { console.error('Set SESSION_SECRET (or run from the repository root with a .dev.vars).'); process.exit(2); }

// PGlite serves one wire connection at a time, so each query opens and closes its own: a connection held open
// across an HTTP call would leave the server's own query waiting forever.
const db = async (strings, ...values) => {
  const c = postgres(`postgres://postgres@127.0.0.1:${PORT}/${process.env.BIGDATA_DB ?? 'postgres'}`, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c(strings, ...values); } finally { await c.end({ timeout: 5 }); }
};
let fails = 0;
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${String(more).slice(0, 300)}`}`); };
const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookieOf = u => {
  const body = Buffer.from(JSON.stringify({ userId: u.id, email: u.email, role: u.role, fullName: u.name, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
  return `tc_session=${body}.${b64(createHmac('sha256', SECRET).update(body).digest())}`;
};
async function call(u, method, path, body) {
  const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { cookie: cookieOf(u), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t, location: r.headers.get('location') };
}

/* ---------- set up: two owners with units, one of them with a held debt; test accounts ---------- */
const t0 = new Date().toISOString();
const [mgmt] = await db`SELECT id, email, full_name AS name, role FROM users WHERE role = 'management' AND is_active = 1 LIMIT 1`;
const [debt] = await db`SELECT a.id, a.owner_id, a.amount, a.occurred_on FROM owner_adjustments a WHERE a.kind = 'opening_debt' AND a.state = 'held'
  AND EXISTS (SELECT 1 FROM units u WHERE u.owner_id = a.owner_id) ORDER BY a.amount DESC LIMIT 1`;
const ownerA = debt.owner_id;
const [{ owner_id: ownerB }] = await db`SELECT u.owner_id FROM units u JOIN reservations r ON r.unit_id = u.id
  WHERE u.owner_id <> ${ownerA} AND r.check_in < '2026-10-01' AND r.check_out > '2026-09-01' AND r.state IN ('confirmed','checked_in','checked_out') LIMIT 1`;
const before = await db`SELECT id, state, occurred_on, statement_id, settled_note FROM owner_adjustments WHERE owner_id IN (${ownerA}, ${ownerB})`;
const ownerUsers = await db`SELECT id, user_id FROM owners WHERE id IN (${ownerA}, ${ownerB})`;
const sept = await db`SELECT count(*)::int AS n FROM owner_statements WHERE period_start = '2026-09-01'`;
if (sept[0].n) { console.error('September 2026 statements already exist in this database: run against a fresh --serve database.'); process.exit(2); }

const mk = (role, tag) => ({ id: `test-${tag}-${crypto.randomUUID()}`, email: `${tag}-${Date.now()}@local.test`, name: `Test ${tag}`, role });
const finance = mk('finance_admin', 'finance'), staff = mk('operations_staff', 'staff'), ownA = mk('owner', 'owner-a'), ownB = mk('owner', 'owner-b');
for (const u of [finance, staff, ownA, ownB]) {
  await db`INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${u.id}, ${u.email}, ${u.name}, 'not-a-login', ${u.role}, 0, 1, ${t0}, ${t0})`;
}
await db`UPDATE owners SET user_id = ${ownA.id} WHERE id = ${ownerA}`;
await db`UPDATE owners SET user_id = ${ownB.id} WHERE id = ${ownerB}`;

const netOf = async ownerId => (await db`SELECT id, net_payout, adjustments_total, state FROM owner_statements WHERE owner_id = ${ownerId} AND period_start = '2026-09-01'`)[0];
const adjOf = async id => (await db`SELECT state, occurred_on, statement_id, settled_note FROM owner_adjustments WHERE id = ${id}`)[0];
const generate = async () => call(mgmt, 'POST', '/api/statements/generate', { period: '2026-09' });

try {
  /* ---------- September before anything is released ---------- */
  let r = await generate();
  check('September statements generate', r.status === 202 && r.json?.count > 0, r.text);
  const stA0 = await netOf(ownerA), stB0 = await netOf(ownerB);
  check('both test owners have a September statement', !!stA0 && !!stB0);
  check('the held debt is not on it', (await adjOf(debt.id)).statement_id === null && (await adjOf(debt.id)).state === 'held');

  /* ---------- who may see and change adjustments ---------- */
  const path = `/api/owners/${encodeURIComponent(ownerA)}/adjustments`;
  r = await call(mgmt, 'GET', path);
  check('management lists the owner\'s adjustments, the held debt among them', r.status === 200 && r.json.data.some(a => a.id === debt.id && a.state === 'held') && r.json.canChange === true, r.text);
  check('...with the held total', r.json?.totals?.held <= debt.amount, JSON.stringify(r.json?.totals));
  r = await call(staff, 'GET', path);
  check('operations staff cannot list them (403)', r.status === 403, r.status);
  r = await call(staff, 'PATCH', `${path}/${debt.id}`, { action: 'release' });
  check('operations staff cannot release (403)', r.status === 403, r.status);
  r = await call(ownA, 'GET', path);
  check('an owner cannot list them, not even their own (403)', r.status === 403, r.status);
  r = await call(ownA, 'PATCH', `${path}/${debt.id}`, { action: 'release' });
  check('an owner cannot release their own debt (403)', r.status === 403, r.status);
  r = await call(mgmt, 'PATCH', `/api/owners/${encodeURIComponent(ownerB)}/adjustments/${debt.id}`, { action: 'release' });
  check('an adjustment is only found under its own owner (404)', r.status === 404, r.status);
  r = await call(finance, 'PATCH', `${path}/${debt.id}`, { action: 'hold' });
  check('a held debt cannot be held again (409)', r.status === 409, r.text);
  r = await call(finance, 'PATCH', `${path}/${debt.id}`, { action: 'release', month: '2026-13' });
  check('a release into a month that does not exist is refused (422)', r.status === 422, r.text);
  check('...and nothing changed', (await adjOf(debt.id)).state === 'held');

  /* ---------- release into September, regenerate, deducted ---------- */
  r = await call(finance, 'PATCH', `${path}/${debt.id}`, { action: 'release', month: '2026-09' });
  check('finance releases the debt into September', r.status === 200 && r.json.state === 'open' && r.json.occurredOn === '2026-09-01', r.text);
  r = await call(finance, 'PATCH', `${path}/${debt.id}`, { action: 'release', month: '2026-09' });
  check('releasing twice is refused (409)', r.status === 409, r.text);
  await generate();
  const stA1 = await netOf(ownerA);
  check('regenerated: September deducts the released debt', stA1.net_payout === stA0.net_payout + debt.amount && stA1.adjustments_total === stA0.adjustments_total + debt.amount,
    `${stA0.net_payout} -> ${stA1.net_payout} (debt ${debt.amount})`);
  check('...and the debt points at that statement', (await adjOf(debt.id)).statement_id === stA1.id);
  r = await call(mgmt, 'GET', path);
  check('the list shows it on the September statement', r.json.data.find(a => a.id === debt.id)?.statement?.period === '2026-09', JSON.stringify(r.json.data.find(a => a.id === debt.id)));
  check('owner B\'s statement did not move', (await netOf(ownerB)).net_payout === stB0.net_payout);

  /* ---------- hold it again while the statement is provisional ---------- */
  r = await call(mgmt, 'PATCH', `${path}/${debt.id}`, { action: 'hold' });
  check('hold while on a provisional statement: allowed, and says to regenerate September', r.status === 200 && r.json.state === 'held' && r.json.regenerate === '2026-09', r.text);
  await generate();
  check('regenerated: the payout is back to what it was', (await netOf(ownerA)).net_payout === stA0.net_payout);

  /* ---------- manual credit and charge ---------- */
  r = await call(finance, 'POST', path, { kind: 'charge', amount: 0, description: 'x', occurredOn: '2026-09-15' });
  check('an amount of RM 0 is refused (422)', r.status === 422 && r.json.error.fields.amount, r.text);
  const otherUnit = (await db`SELECT id FROM units WHERE owner_id = ${ownerB} LIMIT 1`)[0].id;
  r = await call(finance, 'POST', path, { kind: 'charge', amount: 1000, description: 'x', occurredOn: '2026-09-15', unitId: otherUnit });
  check('a unit of another owner is refused (422)', r.status === 422 && r.json.error.fields.unitId, r.text);
  r = await call(staff, 'POST', path, { kind: 'charge', amount: 1000, description: 'x', occurredOn: '2026-09-15' });
  check('operations staff cannot add one (403)', r.status === 403, r.status);
  r = await call(finance, 'POST', path, { kind: 'charge', amount: 12345, description: 'Test charge', occurredOn: '2026-09-15' });
  check('finance adds a manual charge of RM 123.45', r.status === 201 && r.json.id, r.text);
  const charge = r.json.id;
  r = await call(finance, 'POST', path, { kind: 'credit', amount: 5000, description: 'Test credit', occurredOn: '2026-09-20' });
  const credit = r.json?.id;
  check('...and a manual credit of RM 50.00', r.status === 201 && credit, r.text);
  const [c1] = await db`SELECT amount, state, source FROM owner_adjustments WHERE id = ${charge}`;
  check('the charge is stored negative, open, manual', c1.amount === -12345 && c1.state === 'open' && c1.source === 'manual', JSON.stringify(c1));
  await generate();
  check('regenerated: September carries both (-123.45 + 50.00)', (await netOf(ownerA)).net_payout === stA0.net_payout - 12345 + 5000, `${(await netOf(ownerA)).net_payout} vs ${stA0.net_payout}`);

  /* ---------- settle outside ---------- */
  r = await call(finance, 'PATCH', `${path}/${credit}`, { action: 'settle' });
  check('settling without saying where is refused (422)', r.status === 422, r.text);
  r = await call(finance, 'PATCH', `${path}/${credit}`, { action: 'settle', note: 'Paid by transfer, test note' });
  check('the credit is marked settled outside', r.status === 200 && r.json.state === 'settled' && r.json.regenerate === '2026-09', r.text);
  r = await call(finance, 'PATCH', `${path}/${credit}`, { action: 'release' });
  check('a settled one cannot be released (409)', r.status === 409, r.text);
  await generate();
  check('regenerated: only the charge is left on September', (await netOf(ownerA)).net_payout === stA0.net_payout - 12345);

  /* ---------- a final statement freezes what it carries ---------- */
  const stA = await netOf(ownerA);
  r = await call(mgmt, 'POST', '/api/statements/finalise', { statementIds: [stA.id] });
  check('owner A\'s September statement is finalised', r.status === 200 && (await netOf(ownerA)).state === 'finalised', r.text);
  r = await call(mgmt, 'PATCH', `${path}/${charge}`, { action: 'hold' });
  check('a charge on a final statement cannot be held (409)', r.status === 409 && r.json.error.code === 'ON_FINAL_STATEMENT', r.text);
  r = await call(mgmt, 'PATCH', `${path}/${charge}`, { action: 'settle', note: 'x' });
  check('...nor settled outside (409)', r.status === 409, r.text);
  r = await call(mgmt, 'PATCH', `${path}/${debt.id}`, { action: 'release', month: '2026-09' });
  check('the debt cannot be released into September once that statement is final (409)', r.status === 409 && r.json.error.code === 'PERIOD_LOCKED', r.text);
  check('...and stays held', (await adjOf(debt.id)).state === 'held');

  /* ---------- the owner's report: their own, final ones only ---------- */
  const stB = await netOf(ownerB);
  r = await call(ownA, 'GET', `/api/statements/${stA.id}/report`);
  check('owner A opens their final September report', r.status === 200 && r.json.data.statementId === stA.id && r.json.data.units.length > 0, r.text);
  r = await call(ownB, 'GET', `/api/statements/${stA.id}/report`);
  check('owner B cannot open owner A\'s report (404, as if it did not exist)', r.status === 404, r.status);
  r = await call(ownB, 'GET', `/api/statements/${stB.id}/report`);
  check('owner B cannot open their own provisional report (403 not final)', r.status === 403 && r.json.error.code === 'NOT_FINAL', r.text);
  r = await call(ownA, 'GET', `/api/statements/${stA.id}/report?ownerId=${encodeURIComponent(ownerB)}`);
  check('an owner cannot widen their scope with ?ownerId (still only their own)', r.status === 200 && r.json.data.statementId === stA.id, r.status);
  r = await call(ownB, 'GET', `/api/statements/${stA.id}/report?ownerId=${encodeURIComponent(ownerA)}`);
  check('...nor reach another owner\'s with it (404)', r.status === 404, r.status);
  r = await call(staff, 'GET', `/api/statements/${stA.id}/report`);
  check('operations staff cannot open reports (403)', r.status === 403, r.status);
  r = await call(ownA, 'GET', `/api/owner/statements/${stA.id}/pdf`);
  check('the owner portal\'s download now opens the Owner Income Report (302)', r.status === 302 && r.location?.endsWith(`/#/finance/statements/${encodeURIComponent(stA.id)}/report`), `${r.status} ${r.location}`);
  r = await call(ownB, 'GET', `/api/owner/statements/${stA.id}/pdf`);
  check('...and refuses another owner\'s (403)', r.status === 403, r.status);
  r = await call(ownA, 'GET', `/api/owner/statements/${stA.id}/pdf?format=legacy`);
  check('the old print page still answers with ?format=legacy', r.status === 200 && /<html/i.test(r.text), r.status);
  const [paid] = await db`SELECT id FROM owner_statements WHERE owner_id = ${ownerA} AND source = 'owner_workbook' AND state = 'paid' LIMIT 1`;
  if (paid) {
    r = await call(ownA, 'GET', `/api/owner/statements/${paid.id}/pdf`);
    check('a month paid from the owner workbook (no unit figures) keeps the old print page', r.status === 200 && /<html/i.test(r.text), r.status);
  }
  r = await call(ownA, 'GET', `/api/owner/statements/${stA.id}`);
  check('the portal\'s statement breakdown is open to the owner', r.status === 200, r.text);

  /* ---------- the audit trail ---------- */
  const rows = await db`SELECT action, before_state::text AS b, after_state::text AS a FROM audit_log WHERE entity_table = 'owner_adjustments' AND occurred_at >= ${t0}`;
  const by = rows.reduce((m, x) => { m[x.action] = (m[x.action] ?? 0) + 1; return m; }, {});
  check('every change is audited (release 1, hold 1, settle 1, create 2)', by['owner_adjustment.release'] === 1 && by['owner_adjustment.hold'] === 1 && by['owner_adjustment.settle'] === 1 && by['owner_adjustment.create'] === 2, JSON.stringify(by));
  check('...and no note text reaches the audit', !rows.some(x => `${x.b}${x.a}`.includes('test note')));
} finally {
  /* ---------- put everything back ---------- */
  const ids = (await db`SELECT id FROM owner_statements WHERE period_start = '2026-09-01'`).map(s => s.id);
  await db`UPDATE owner_adjustments SET statement_id = NULL WHERE statement_id = ANY(${ids})`;
  await db`DELETE FROM statement_lines WHERE statement_id = ANY(${ids})`;
  await db`DELETE FROM statement_units WHERE statement_id = ANY(${ids})`;
  await db`DELETE FROM owner_statements WHERE id = ANY(${ids})`;
  await db`DELETE FROM guarantee_pool_months WHERE month = '2026-09' AND source = 'generated'`;
  await db`DELETE FROM owner_adjustments WHERE owner_id IN (${ownerA}, ${ownerB}) AND created_at >= ${t0}`;
  for (const a of before) await db`UPDATE owner_adjustments SET state = ${a.state}, occurred_on = ${a.occurred_on}, statement_id = ${a.statement_id}, settled_note = ${a.settled_note} WHERE id = ${a.id}`;
  for (const o of ownerUsers) await db`UPDATE owners SET user_id = ${o.user_id} WHERE id = ${o.id}`;
  await db`DELETE FROM users WHERE id IN (${finance.id}, ${staff.id}, ${ownA.id}, ${ownB.id})`;
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
