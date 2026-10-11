// Performance audit checks (11 Oct 2026), against a local server on the real-sized import:
//   BIGDATA_PORT=55447 node scripts/api-checks/hostplatform-import.mjs <data> --serve
//   node scripts/api-checks/performance.mjs http://127.0.0.1:8807 .dev.vars
// Signs in as dev@local.test with a minted cookie. Writes to that local database only: it generates the current
// month's owner statements, finalises and sends two of them. Each check is about a limit or a batched path the
// audit added; timings are printed, not asserted (they depend on the machine).
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const B = (process.argv[2] ?? 'http://127.0.0.1:8807') + '/api';
const secret = /SESSION_SECRET="?([^"\n]+)"?/.exec(readFileSync(process.argv[3] ?? '.dev.vars', 'utf8'))[1];
const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const body = Buffer.from(JSON.stringify({ userId: 'dev-admin', email: 'dev@local.test', role: 'management', fullName: 'Dev Admin', iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
const cookie = `tc_session=${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
const call = async (method, path, data) => {
  const t0 = performance.now();
  const r = await fetch(B + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, ms: Math.round(performance.now() - t0) };
};
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : ' :: ' + String(x).slice(0, 300)}`); };
const day = n => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const listOf = j => j?.data ?? j?.rows ?? j?.statements ?? j?.payouts ?? [];

// Calendar window: 30 nights answer; more than 92 days is refused instead of reading years of bookings and rates.
let r = await call('GET', `/reservations/calendar?from=${day(0)}&to=${day(29)}`);
check(`calendar: 30 nights answer (${r.ms} ms, ${Math.round(r.text.length / 1024)} KB)`, r.status === 200, r.text);
r = await call('GET', `/reservations/calendar?from=${day(0)}&to=${day(91)}`);
check('calendar: 92 days still answer', r.status === 200, r.text);
r = await call('GET', `/reservations/calendar?from=${day(0)}&to=${day(365)}`);
check('calendar: a year is refused (422)', r.status === 422, r.text);
r = await call('GET', `/reservations/calendar?from=${day(5)}&to=${day(1)}`);
check('calendar: end before start is refused (422)', r.status === 422, r.text);
r = await call('GET', '/reservations/calendar?from=soon&to=later');
check('calendar: words instead of dates are refused (422)', r.status === 422, r.text);

// Schema probes are remembered per worker; the screens that used them answer the same way.
r = await call('GET', '/reservations?view=past');
check(`bookings list answers (${r.ms} ms)`, r.status === 200 && r.json.total > 0, r.text);
const anyBooking = listOf(r.json)[0]?.id;
check('bookings list has rows', !!anyBooking, r.text.slice(0, 300));
if (anyBooking) {
  r = await call('GET', `/reservations/${encodeURIComponent(anyBooking)}`);
  check(`booking detail answers (${r.ms} ms)`, r.status === 200 && r.text.includes(anyBooking), r.text);
}
r = await call('GET', '/guests?sort=recent');
check(`guests list answers (${r.ms} ms)`, r.status === 200 && r.json.total > 0 && r.json.registrationReady === true, r.text);

// Unit page: reads shared within the request give the same page.
r = await call('GET', '/units');
const unitId = listOf(r.json)[0]?.id;
r = await call('GET', `/units/detail?unitId=${encodeURIComponent(unitId)}`);
check(`unit page answers (${r.ms} ms)`, r.status === 200 && 'stays' in r.json, r.text);

// Nav badges: the four reads in parallel give the same fields.
r = await call('GET', '/nav/badges');
check(`nav badges answer (${r.ms} ms)`, r.status === 200 && typeof r.json.today === 'number' && 'approvalsOn' in r.json && Array.isArray(r.json.alerts), r.text);

// Booking import: at most 100 rows per request (the screen sends 50); each row still judged on its own.
const rows = n => Array.from({ length: n }, (_, i) => ({ unitNumber: 'NOPE-PERF', channel: 'direct', checkIn: '2041-01-01', checkOut: '2041-01-02', guest: { fullName: `Perf ${i}` } }));
r = await call('POST', '/reservations/import', { rows: rows(101) });
check('import: 101 rows refused (422)', r.status === 422, r.text);
r = await call('POST', '/reservations/import', { rows: rows(100) });
check(`import: 100 rows taken, each judged on its own (${r.ms} ms)`, r.status === 200 && r.json.created === 0 && r.json.failed.length === 100 && /No unit/.test(r.json.failed[0].reason), r.text);

// Statements: finalise and send in a handful of writes, with the same result as one at a time.
const period = day(0).slice(0, 7);
r = await call('POST', '/statements/generate', { period });
if (r.status === 409) console.log(`skip statements: ${period} is already sent on this database`);
else {
  check(`generate ${period} (${r.ms} ms, ${r.json?.count} statements)`, r.status === 202 || r.status === 200, r.text);
  const list = await call('GET', `/statements?period=${period}&state=provisional&pageSize=200`);
  const prov = listOf(list.json).filter(s => s.state === 'provisional').slice(0, 2).map(s => s.id);
  check('two provisional statements to work with', prov.length === 2, list.text.slice(0, 300));
  r = await call('POST', '/statements/finalise', { statementIds: [...prov, 'no-such-statement'] });
  check(`finalise: two finalised, the unknown one named (${r.ms} ms)`, r.status === 200 && r.json.finalised === 2 && r.json.failed.length === 1 && r.json.failed[0].id === 'no-such-statement', r.text);
  r = await call('POST', '/statements/finalise', { statementIds: prov });
  check('finalise again: nothing changes, both named', r.json.finalised === 0 && r.json.failed.length === 2, r.text);
  r = await call('POST', '/statements/send', { statementIds: prov });
  check(`send: both sent (${r.ms} ms)`, r.status === 200 && r.json.sent === 2, r.text);
  const sent = await call('GET', `/statements?period=${period}&state=sent&pageSize=200`);
  const states = listOf(sent.json).filter(s => prov.includes(s.id)).map(s => s.state);
  check('both now read as sent', states.length === 2 && states.every(s => s === 'sent'), JSON.stringify(states));
  const pay = await call('GET', '/payouts?pageSize=200');
  const mine = listOf(pay.json).filter(p => prov.includes(p.statementId));
  check('send: one payout per sent statement', mine.length === 2, JSON.stringify(listOf(pay.json)[0] ?? pay.json).slice(0, 300));
  const h = await call('GET', `/audit?entityTable=owner_statements&entityId=${encodeURIComponent(prov[0])}&page=1&pageSize=20`);
  check('history: finalise and send recorded on the statement', /finalis/i.test(h.text) && /sent|send/i.test(h.text), h.text.slice(0, 300));
  r = await call('POST', '/statements/send', { statementIds: prov });
  check('send again: nothing sent twice', r.json.sent === 0 && r.json.failed.length === 2, r.text);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
