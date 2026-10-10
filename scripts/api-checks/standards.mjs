// The server half of docs/UI-STANDARDS.md, on a running local app (any data set):
//   API_BASE=http://127.0.0.1:8791 API_EMAIL=dev@local.test API_PASSWORD=... node scripts/api-checks/standards.mjs
// - every failure comes back in the { error: { code, message } } envelope, never a platform page or a stack trace;
// - an endpoint that throws is answered INTERNAL with a plain sentence (functions/api/_middleware.ts);
// - Airbnb / Booking.com / Agoda bookings cannot have their dates changed here (the drawer hides the button);
// - the client wording: friendlyMessage() never shows a status number, SQL or a stack trace.
import { check, done } from './harness.mjs';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8791';
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.API_EMAIL, password: process.env.API_PASSWORD }) });
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
check('signed in', login.status === 200 && cookie.includes('tc_session='), String(login.status));

async function call(method, path, body, opts = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(opts.anon ? {} : { cookie }), 'content-type': 'application/json' }, body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
const plain = (m) => typeof m === 'string' && m.length > 0 && !/\b(SQL|SELECT|syntax|TypeError|stack|undefined|at \w+ \()/i.test(m) && !/\b[45]\d\d\b/.test(m);

let r = await call('GET', '/api/no-such-endpoint');
check('unknown endpoint: JSON 404 envelope', r.status === 404 && r.json?.error?.code === 'NOT_FOUND' && plain(r.json.error.message), r.text.slice(0, 200));

r = await call('GET', '/api/reservations', undefined, { anon: true });
check('signed out: JSON 401 envelope in plain words', r.status === 401 && r.json?.error?.code === 'UNAUTHENTICATED' && plain(r.json.error.message), r.text.slice(0, 200));

r = await call('POST', '/api/auth/login', undefined, { anon: true, raw: '{not json' });
check('a handler that throws: INTERNAL envelope, plain sentence, no stack', r.status === 500 && r.json?.error?.code === 'INTERNAL' && plain(r.json.error.message), r.text.slice(0, 300));

// An OTA booking: no date change from Conts, with the reason in words.
r = await call('GET', '/api/reservations?view=all&size=100');
const ota = (r.json?.data ?? []).find(b => ['airbnb', 'booking_com', 'agoda'].includes(b.channel) && !['cancelled', 'no_show', 'checked_out'].includes(b.state))
  ?? (r.json?.data ?? []).find(b => ['airbnb', 'booking_com', 'agoda'].includes(b.channel));
check('found an Airbnb / Booking.com / Agoda booking to test', !!ota, r.text.slice(0, 200));
if (ota) {
  const d = await call('GET', `/api/reservations/${ota.id}`);
  check('OTA booking: can.changeDates is false with a reason naming the site', d.json?.can?.changeDates === false && /Airbnb|Booking\.com|Agoda|finished|cancelled/.test(d.json?.can?.changeDatesReason ?? ''), JSON.stringify(d.json?.can));
  const p = await call('PATCH', `/api/reservations/${ota.id}/dates`, { checkIn: '2030-01-01', checkOut: '2030-01-03', confirm: true });
  check('OTA booking: a date change is refused (409) in words', p.status === 409 && plain(p.json?.error?.message), p.text.slice(0, 200));
}

// The client's wording rules, run on the real src/lib/api.ts.
const tmp = mkdtempSync(join(tmpdir(), 'std-'));
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
await build({ entryPoints: [join(root, 'src/lib/api.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(tmp, 'api.mjs'), logLevel: 'silent' });
const { friendlyMessage, errorMessage } = await import(pathToFileURL(join(tmp, 'api.mjs')).href);
check('client: status number taken out of a server message', friendlyMessage(502, 'CHANNEX_ERROR', 'Channex refused the read (status 502).') === 'Channex refused the read.');
check('client: SQL replaced by a plain sentence', !/relation|SELECT/.test(friendlyMessage(500, 'INTERNAL', 'relation "pos.units" does not exist')));
check('client: platform error page replaced', /busy or restarting/.test(friendlyMessage(503, undefined, '<html><body>Worker exceeded resource limits</body></html>')));
check('client: a page bug never shows its TypeError', errorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), 'Try again.') === 'Try again.');
check('client: a written message passes through', friendlyMessage(409, 'CONFLICT', 'Those nights are already booked.') === 'Those nights are already booked.');

done();
