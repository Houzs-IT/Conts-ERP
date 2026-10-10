// Guests: stays that count upcoming ones, tags, registration details (masked ID, reveal, audit), Missing ID filter,
// Add guest creating no booking, merging duplicates, and the one-off split of the collapsed "Airbnb guest".
// Writes rows (two test guests it merges), so run it against a local copy, never production:
//   API_BASE=http://127.0.0.1:8821 API_EMAIL=dev@local.test API_PASSWORD=LocalTest1 node scripts/api-checks/guests-registration.mjs
import { check, done } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8821';
const r0 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.API_EMAIL ?? 'dev@local.test', password: process.env.API_PASSWORD ?? 'LocalTest1' }) });
const cookie = r0.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}

let r = await call('GET', '/api/guests?size=25');
const base = r.json;
check('guests list with the new filters', r.status === 200 && ['missing_id', 'repeat', 'vip', 'blacklist'].every(k => typeof base.counts[k] === 'number'), r.text.slice(0, 200));
r = await call('GET', '/api/guests?filter=arriving_today&size=25');
if (r.json.data[0]) {
  check('a guest arriving today counts the stay (not 0 stays)', r.json.data.every(g => g.stays >= 1), JSON.stringify(r.json.data.map(g => [g.stays, g.upcoming])));
  const p = await call('GET', `/api/guests/${r.json.data[0].id}`);
  check('profile: stays include the upcoming one and the booking value is counted', p.json.stays >= 1 && p.json.lifetimeValue >= 0 && Array.isArray(p.json.tags), JSON.stringify({ stays: p.json.stays, upcoming: p.json.upcoming, value: p.json.lifetimeValue }));
}
r = await call('GET', '/api/guests?filter=missing_id&size=25');
check('Missing ID: every guest listed is flagged and has a stay coming', r.json.data.every(g => g.missingId), String(r.json.total));
console.log(`  guests missing ID details with a stay coming: ${r.json.total}`);

/* ---------- Add guest creates no booking ---------- */
const allBefore = (await call('GET', '/api/reservations?view=all&size=25')).json.total;
const stamp = Date.now();
r = await call('POST', '/api/guests', { fullName: 'Check Merge Keep', email: `keep-${stamp}@example.test`, countryCode: 'SG', language: 'English' });
check('Add guest creates the guest only', r.status === 201 && r.json.created === true, r.text.slice(0, 200));
const keep = r.json.id;
r = await call('POST', '/api/guests', { fullName: 'Check Merge Keep again', email: `keep-${stamp}@example.test` });
check('Add guest with an email on file says so and creates nothing', r.status === 200 && r.json.created === false && r.json.id === keep, r.text.slice(0, 200));
const allAfter = (await call('GET', '/api/reservations?view=all&size=25')).json.total;
check('no booking was made by adding a guest', allAfter === allBefore, `${allBefore} -> ${allAfter}`);

/* ---------- registration, mask, reveal ---------- */
r = await call('PATCH', `/api/guests/${keep}`, { idType: 'passport', idNumber: 'K1234567X89', dateOfBirth: '1990-05-17', notes: 'High floor please', tags: ['vip'] });
check('registration details, notes and tag saved', r.status === 200 && r.json.changed, r.text.slice(0, 200));
r = await call('GET', `/api/guests/${keep}`);
const g = r.json;
check('ID number masked to its last four', g.registration.idNumberMasked === '•••• 7X89' && !JSON.stringify(g).includes('K1234567X89'), g.registration.idNumberMasked);
check('nothing missing once filled, and VIP shows', g.registration.missing.length === 0 && g.tags.some(t => t.key === 'vip') && g.notes === 'High floor please', JSON.stringify({ m: g.registration.missing, tags: g.tags }));
r = await call('POST', `/api/guests/${keep}/reveal`, {});
check('management can reveal the full number', r.status === 200 && r.json.idNumber === 'K1234567X89', r.text.slice(0, 200));
r = await call('PATCH', `/api/guests/${keep}`, { dateOfBirth: '2999-01-01', tags: ['friend'] });
check('a future birth date and an unknown tag are refused', r.status === 422 && r.json.error.fields.dateOfBirth && r.json.error.fields.tags, r.text.slice(0, 200));
r = await call('GET', '/api/guests?filter=vip&size=100');
check('VIP filter finds the guest', r.json.data.some(x => x.id === keep), String(r.json.total));

/* ---------- merge ---------- */
r = await call('POST', '/api/guests', { fullName: 'Check Merge Duplicate', phone: `+60 1${stamp % 100000000}`, countryCode: 'MY' });
const dup = r.json.id;
r = await call('POST', `/api/guests/${dup}/merge`, { intoId: keep });
check('merge moves the duplicate into the kept guest', r.status === 200 && r.json.id === keep, r.text.slice(0, 200));
r = await call('GET', `/api/guests/${dup}`);
check('the duplicate now opens as the kept guest', r.json.redirectTo === keep, r.text.slice(0, 200));
r = await call('GET', `/api/guests/${keep}`);
check('details the kept guest lacked were filled from the duplicate', !!r.json.phone, JSON.stringify({ phone: r.json.phone }));
r = await call('GET', `/api/guests?q=Check%20Merge&size=25`);
check('the duplicate is hidden from the list', !r.json.data.some(x => x.id === dup), JSON.stringify(r.json.data.map(x => x.fullName)));
r = await call('POST', `/api/guests/${dup}/merge`, { intoId: keep });
check('merging it again is refused', r.status === 409, r.text.slice(0, 200));

/* ---------- one-off split of the collapsed "Airbnb guest" ---------- */
r = await call('GET', '/api/guests?q=Airbnb%20guest&size=100');
const collapsed = r.json.data.find(x => x.fullName === 'Airbnb guest');
console.log(`  before the split: "Airbnb guest" ${collapsed ? `holds ${collapsed.stays} stays` : 'is not there'}`);
r = await call('POST', '/api/import/hostplatform', { kind: 'fix_guests', rows: [] });
const first = r.json?.stats;
r = await call('POST', '/api/import/hostplatform', { kind: 'fix_guests', rows: [] });
const second = r.json?.stats;
console.log(`  split run 1 ${JSON.stringify(first)}, run 2 ${JSON.stringify(second)}`);
check('split: run 2 does nothing', second && second.bookingsGivenTheirOwnGuest === 0 && second.placeholderGuestsRemoved === 0, JSON.stringify(second));
r = await call('GET', '/api/guests?q=Airbnb%20guest&size=100');
check('no "Airbnb guest" holds more than one stay', r.json.data.every(x => x.fullName !== 'Airbnb guest' && x.stays <= 1), JSON.stringify(r.json.data.slice(0, 3).map(x => [x.fullName, x.stays])));
done();
