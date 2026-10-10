// Every endpoint behind a converted number/money/date/phone field refuses bad input with a field-level 422,
// and still accepts a good value. Read-only against data except where a good value is saved and put back.
//
// Run: 1. BIGDATA_PORT=55436 node scripts/api-checks/hostplatform-import.mjs <data folder> --serve   (leave it running)
//      2. a local server on that database (SESSION_SECRET in .dev.vars), e.g. on :8796
//      3. BASE=http://localhost:8796 node scripts/api-checks/input-validation.mjs
// Signs in as the local dev account (dev@local.test), which exists only in the imported local database.
const BASE = process.env.BASE ?? 'http://localhost:8796';
const EMAIL = process.env.CHECK_EMAIL ?? 'dev@local.test';
const PASSWORD = process.env.CHECK_PASSWORD ?? 'LocalTest1';

let fails = 0, passes = 0;
const check = (name, ok, more = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${String(more).slice(0, 300)}`}`); };

const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
if (login.status !== 200 || !cookie) { console.error(`sign-in failed (${login.status})`); process.exit(2); }

async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}

/** Expect a 422 whose error.fields names `field`. */
async function refuses(name, method, path, body, field) {
  const r = await call(method, path, body);
  check(`${name} -> 422 on ${field}`, r.status === 422 && !!r.json?.error?.fields?.[field], `${r.status} ${r.text}`);
}

// Settings: whole numbers, ranges and the phone.
await refuses('settings lockout minutes 12.5', 'PUT', '/api/settings', { security: { lockoutMinutes: 12.5 } }, 'security.lockoutMinutes');
await refuses('settings lockout minutes 0', 'PUT', '/api/settings', { security: { lockoutMinutes: 0 } }, 'security.lockoutMinutes');
await refuses('settings cleaning window empty', 'PUT', '/api/settings', { operations: { cleaningWindowHours: null } }, 'operations.cleaningWindowHours');
await refuses('settings misc charge in ringgit (12.3)', 'PUT', '/api/settings', { report: { miscChargeMonthly: 12.3 } }, 'report.miscChargeMonthly');
await refuses('settings fee 150%', 'PUT', '/api/settings', { locale: { managementFeePct: 150 } }, 'locale.managementFeePct');
await refuses('settings support phone letters', 'PUT', '/api/settings', { company: { supportPhone: 'call me' } }, 'company.supportPhone');
await refuses('settings support phone too short', 'PUT', '/api/settings', { company: { supportPhone: '+60 12' } }, 'company.supportPhone');
await refuses('settings check-in 25:00', 'PUT', '/api/settings', { operations: { checkIn: '25:00' } }, 'operations.checkIn');
{
  const before = (await call('GET', '/api/settings')).json;
  const r = await call('PUT', '/api/settings', { report: { miscChargeMonthly: 1230 }, company: { supportPhone: '+60 17-465 8868' } });
  const after = (await call('GET', '/api/settings')).json;
  check('settings accepts RM 12.30 as 1230 sen and a +60 phone', r.status === 200 && after?.report?.miscChargeMonthly === 1230, `${r.status} ${r.text}`);
  await call('PUT', '/api/settings', { report: { miscChargeMonthly: before.report.miscChargeMonthly }, company: { supportPhone: before.company.supportPhone } });
}

// Forms behind the converted fields. Every body below is refused before anything is written.
const unitId = (await call('GET', '/api/units?limit=1')).json?.data?.[0]?.id;
check('a unit to test against', !!unitId);
const stay = { unitId, checkIn: '2027-01-10', checkOut: '2027-01-12', guestsCount: 2, guest: { fullName: 'Input Check' } };
await refuses('booking with 31 February', 'POST', '/api/reservations', { ...stay, checkIn: '2027-02-31' }, 'checkIn');
await refuses('booking total in ringgit (450.5)', 'POST', '/api/reservations', { ...stay, grossBookingValue: 450.5 }, 'grossBookingValue');
await refuses('booking with 0 guests', 'POST', '/api/reservations', { ...stay, guestsCount: 0 }, 'guestsCount');
await refuses('booking phone with letters', 'POST', '/api/reservations', { ...stay, guest: { fullName: 'Input Check', phone: 'abc' } }, 'guest.phone');
await refuses('expense negative amount', 'POST', '/api/expenses', { unitId, category: 'repair', amount: -500, incurredOn: '2026-10-01' }, 'amount');
await refuses('expense float amount', 'POST', '/api/expenses', { unitId, category: 'repair', amount: 12.3, incurredOn: '2026-10-01' }, 'amount');
await refuses('expense date not a date', 'POST', '/api/expenses', { unitId, category: 'repair', amount: 1230, incurredOn: '10/01/2026' }, 'incurredOn');
await refuses('product price in ringgit', 'POST', '/api/products', { code: 'INPUT-CHECK', name: 'Input check', category: 'SOFA', basePriceSen: 99.9 }, 'basePriceSen');
await refuses('night rate on a bad date', 'PUT', '/api/rates', { unitId, channel: 'web', date: '2026-13-01', rate: 25000 }, 'date');

console.log(`\ninput-validation: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
