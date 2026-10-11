// System-level bug classes the sister ERPs (Houzs, Hookka) already hit, proven against a running server
// (docs/audits/system-from-sister-erps.md): double booking under simultaneous requests, a status moved twice at once,
// statement generation clicked twice, unbounded text, spreadsheet formulas in CSV exports, uploaded files served as
// runnable pages, import rows that are not real dates, and "today" taken from a UTC clock.
//
// Run against a local server on the real-size data (hostplatform-import.mjs --serve), signed in as its seeded
// management account:
//   SESSION_SECRET=<.dev.vars secret> API_BASE=http://127.0.0.1:8808 USER_ID=dev-admin node scripts/api-checks/system-correctness.mjs
// The upload checks need the server started with a local R2 bucket (wrangler pages dev ... --r2=MEDIA); without it
// they are reported as skipped.
import { callAsUser, check, done } from './harness.mjs';

const U = { userId: process.env.USER_ID ?? 'dev-admin', email: 'dev@local.test', role: 'management', fullName: 'Audit Bot' };
const c = (m, p, b) => callAsUser(U, m, p, b);
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const mytDay = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
// Far-future nights, different each run, so a re-run on the same database never collides with the last one.
const BASE_DAY = Date.UTC(2031, 0, 1) + ((Date.now() / 1000 | 0) % 2000) * 50 * 864e5;
const runDay = (n) => new Date(BASE_DAY + n * 864e5).toISOString().slice(0, 10);

const units = await c('GET', '/api/units?pageSize=5');
const unitId = units.json?.data?.[0]?.id;
const unitId2 = units.json?.data?.[1]?.id;
check('a unit to book exists', !!unitId && !!unitId2, units.text.slice(0, 200));

// 1. Ten simultaneous bookings for the same nights: exactly one is saved.
{
  const body = (i) => ({ unitId, checkIn: runDay(0), checkOut: runDay(2), channel: 'direct', guestsCount: 2, grossBookingValue: 50000, guest: { fullName: `Race guest ${i}` } });
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => c('POST', '/api/reservations', body(i))));
  const made = rs.filter(r => r.status === 201).length, clash = rs.filter(r => r.status === 409 && r.json?.error?.code === 'DATE_CONFLICT').length;
  check('10 simultaneous bookings for the same nights: exactly 1 saved', made === 1, rs.map(r => r.status).join(','));
  check('the other 9 are told the dates are taken', clash === 9, rs.map(r => r.status).join(','));
}

// 2. Five simultaneous blocks on the same nights: exactly one.
{
  const rs = await Promise.all(Array.from({ length: 5 }, () => c('POST', '/api/blocks', { unitId, from: runDay(4), to: runDay(6), kind: 'maintenance' })));
  check('5 simultaneous blocks on the same nights: exactly 1 saved', rs.filter(r => r.status === 201).length === 1, rs.map(r => r.status).join(','));
}

// 3. A booking checked out three times at once moves once; the other two are told it changed.
{
  // The first unit free tonight.
  const many = await c('GET', '/api/units?pageSize=60');
  let made = { status: 0, json: null };
  for (const u of many.json?.data ?? []) {
    made = await c('POST', '/api/reservations', { unitId: u.id, checkIn: mytDay(0), checkOut: mytDay(1), channel: 'direct', guestsCount: 1, grossBookingValue: 10000, guest: { fullName: 'Status race' } });
    if (made.status === 201) break;
  }
  const id = made.json?.id;
  if (made.status !== 201) console.log('skip status race: no unit is free tonight');
  else {
    const inn = await c('PATCH', `/api/reservations/${id}`, { state: 'checked_in' });
    check('check-in works', inn.status === 200, inn.text.slice(0, 200));
    const rs = await Promise.all([1, 2, 3].map(() => c('PATCH', `/api/reservations/${id}`, { state: 'checked_out' })));
    // A repeat that arrives after the first finished is a harmless no-op (200, no effects); one that raced it is refused
    // (409). Either way the move and its side effects happen once.
    const applied = rs.filter(r => r.status === 200 && r.json?.effects?.readiness === 'dirty').length;
    check('3 simultaneous check-outs: the move and its side effects applied exactly once', applied === 1, rs.map(r => r.status + ' ' + JSON.stringify(r.json?.effects ?? r.json?.error?.code)).join(' | '));
    check('the others are a no-op or 409 CONFLICT', rs.every(r => r.status === 200 || (r.status === 409 && r.json?.error?.code === 'CONFLICT')), rs.map(r => r.status).join(','));
    const hist = await c('GET', `/api/audit?entityTable=reservations&entityId=${id}`);
    const moves = (hist.json?.data ?? []).filter(e => e.action === 'reservation.status' && e.after?.state === 'checked_out').length;
    if (hist.status === 200) check('one check-out in the history, not three', moves === 1, JSON.stringify(hist.json?.data?.map(e => e.action)));
  }
}

// 4. A cancelled booking cannot be reinstated over a stay made on its nights since.
{
  const a = await c('POST', '/api/reservations', { unitId: unitId2, checkIn: runDay(10), checkOut: runDay(12), channel: 'direct', guestsCount: 1, grossBookingValue: 10000, guest: { fullName: 'Reinstate A' } });
  await c('PATCH', `/api/reservations/${a.json?.id}`, { state: 'cancelled', reason: 'Audit check' });
  const b = await c('POST', '/api/reservations', { unitId: unitId2, checkIn: runDay(11), checkOut: runDay(13), channel: 'direct', guestsCount: 1, grossBookingValue: 10000, guest: { fullName: 'Reinstate B' } });
  check('a new stay can take the cancelled nights', b.status === 201, b.text.slice(0, 200));
  const back = await c('PATCH', `/api/reservations/${a.json?.id}`, { state: 'confirmed' });
  check('reinstating the cancelled one over it is refused', back.status === 409 && back.json?.error?.code === 'DATE_CONFLICT', back.text.slice(0, 200));
}

// 5. Statements generated twice at once: both finish, one statement per owner, every statement whole.
{
  const period = mytDay(0).slice(0, 7);
  const rs = await Promise.all([1, 2].map(() => c('POST', '/api/statements/generate', { period })));
  const ok = rs.filter(r => r.status === 202).length, locked = rs.filter(r => r.status === 409).length;
  check('two simultaneous generates: both answer (202, or 409 when the month is already sent)', ok + locked === 2, rs.map(r => r.status + ' ' + r.text.slice(0, 120)).join(' | '));
  if (ok === 2) check('both report the same number of statements', rs[0].json.count === rs[1].json.count, `${rs[0].json.count} vs ${rs[1].json.count}`);
}

// 6. Text limits: a 500,000-character name is refused with the field named; a long note still fits.
{
  const big = 'A'.repeat(500000);
  const r = await c('POST', '/api/reservations', { unitId, checkIn: runDay(20), checkOut: runDay(21), channel: 'direct', guestsCount: 1, guest: { fullName: big } });
  check('a 500,000-character guest name is refused (422)', r.status === 422 && !!r.json?.error?.fields?.['guest.fullName'], r.status + ' ' + r.text.slice(0, 200));
  const o = await c('POST', '/api/owners', { displayName: 'B'.repeat(301), email: 'limit@x.test' });
  check('a 301-character owner name is refused (422)', o.status === 422, o.status + ' ' + o.text.slice(0, 200));
  const n = await c('POST', '/api/reservations', { unitId, checkIn: runDay(22), checkOut: runDay(23), channel: 'direct', guestsCount: 1, guest: { fullName: 'Long note guest' }, notes: 'N'.repeat(1900) });
  check('a 1,900-character note is accepted', n.status === 201, n.status + ' ' + n.text.slice(0, 200));
}

// 7. A guest named like a formula comes out of the CSV export as text.
{
  const evil = '=HYPERLINK("http://example.test","Click")';
  const r = await c('POST', '/api/reservations', { unitId, checkIn: runDay(30), checkOut: runDay(31), channel: 'direct', guestsCount: 1, grossBookingValue: 10000, guest: { fullName: evil } });
  check('booking with a formula-looking guest name saved', r.status === 201, r.text.slice(0, 200));
  const csv = await c('GET', `/api/reservations/export?view=all&guest=${encodeURIComponent('HYPERLINK')}`);
  check('export answers', csv.status === 200, csv.text.slice(0, 200));
  check("the name cell starts with an apostrophe, not =", csv.text.includes(`"'=HYPERLINK(""http://example.test"",""Click"")"`) && !/(^|,)"=HYPERLINK/m.test(csv.text), csv.text.split('\n').find(l => l.includes('HYPERLINK'))?.slice(0, 200));
  const neg = csv.text.split('\n').find(l => l.includes('HYPERLINK')) ?? '';
  check('money and phone cells are left as they are', !neg.includes(`"'-`) && !neg.includes(`"'+6`), neg.slice(0, 200));
}

// 8. Uploaded files: a page or SVG downloads instead of opening as part of the app; a photo still shows inline.
{
  const up = async (name, type, content) => {
    const fd = new FormData();
    fd.append('file', new Blob([content], { type }), name);
    fd.append('kind', 'other'); fd.append('unitId', unitId);
    const { createHmac } = await import('node:crypto');
    const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const body = Buffer.from(JSON.stringify({ ...U, exp: Date.now() + 36e5 })).toString('base64').replace(/=+$/, '');
    const cookie = `tc_session=${body}.${b64(createHmac('sha256', process.env.SESSION_SECRET ?? 'smoke-test-secret-not-real-0123456789').update(body).digest())}`;
    const r = await fetch(BASE + '/api/documents', { method: 'POST', headers: { cookie }, body: fd });
    const j = await r.json().catch(() => null);
    if (r.status !== 201) return { status: r.status, j };
    const d = await fetch(`${BASE}/api/documents/${j.id}/download`, { headers: { cookie } });
    return { status: 201, headers: d.headers };
  };
  const html = await up('evil.html', 'text/html', '<script>alert(document.cookie)</script>');
  if (html.status === 501) console.log('skip uploads: no MEDIA bucket on this server (start it with --r2=MEDIA)');
  else {
    check('an .html upload is stored', html.status === 201, JSON.stringify(html.j));
    check('it downloads as a file, never as a page', html.headers?.get('content-disposition')?.startsWith('attachment') && html.headers?.get('content-type') === 'application/octet-stream', `${html.headers?.get('content-type')} / ${html.headers?.get('content-disposition')}`);
    check('with nosniff and a sandbox policy', html.headers?.get('x-content-type-options') === 'nosniff' && /sandbox/.test(html.headers?.get('content-security-policy') ?? ''), html.headers?.get('content-security-policy'));
    const svg = await up('x.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    check('an SVG downloads too', svg.headers?.get('content-disposition')?.startsWith('attachment'), svg.headers?.get('content-disposition'));
    const png = await up('p.png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex'));
    check('a PNG still opens inline as an image', png.headers?.get('content-type') === 'image/png' && png.headers?.get('content-disposition')?.startsWith('inline'), `${png.headers?.get('content-type')} / ${png.headers?.get('content-disposition')}`);
  }
}

// 9. Reservation import: a row whose dates are not real dates is refused, not stored as text.
{
  const unitNumber = units.json?.data?.[0]?.unitNumber;
  const r = await c('POST', '/api/reservations/import', { rows: [
    { unitNumber, channel: 'direct', guest: { fullName: 'Bad date' }, checkIn: 'soon', checkOut: 'later', guestsCount: 1, grossBookingValue: 100 },
    { unitNumber, channel: 'direct', guest: { fullName: 'Bad money' }, checkIn: runDay(40), checkOut: runDay(41), guestsCount: 1, grossBookingValue: 12.5 },
  ] });
  check('import answers', r.status === 200 || r.status === 201, r.text.slice(0, 200));
  check('both bad rows refused, none created', r.json?.created === 0 && r.json?.failed?.length === 2, JSON.stringify(r.json));
}

// 10. The dashboard opens on this month in Kuala Lumpur.
{
  const k = await c('GET', '/api/dashboard/kpis');
  check('dashboard period is the MYT month', k.json?.period === mytDay(0).slice(0, 7), `${k.json?.period} vs ${mytDay(0).slice(0, 7)}`);
}

// 11. Supply chain numbers: ten stock takes at once all save, each with its own number.
{
  const w = await c('POST', '/api/warehouses', { code: `AU${Date.now() % 100000}`, name: 'Audit warehouse' });
  check('a warehouse to count in', w.status === 201, w.text.slice(0, 200));
  const rs = await Promise.all(Array.from({ length: 10 }, () => c('POST', '/api/stock-takes', { warehouseId: w.json?.id, lines: [{ itemCode: 'AUDIT-1' }] })));
  const nums = rs.filter(r => r.status === 201).map(r => r.json.takeNumber);
  check('10 simultaneous stock takes: all 10 saved', nums.length === 10, rs.map(r => r.status).join(','));
  check('each with its own number', new Set(nums).size === nums.length, nums.join(' '));
}

done();
