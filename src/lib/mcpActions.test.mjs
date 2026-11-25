// node --test src/lib/mcpActions.test.mjs. AI Connector actions, document flow and PDF links (owner, 26 Nov 2026):
// the write fence (a plain connector token can never write), the single-use permit, the pending-action lifecycle on
// real SQL (PGlite, the 0380 migration), meeting and email checks, flow shaping and the signed download links
// (functions/_lib/mcpActions.ts, mcpInner.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const A = await import('../../functions/_lib/mcpActions.ts');
const { grantActionPermit, takeActionPermit } = await import('../../functions/_lib/mcpInner.ts');

const NOW = Date.parse('2026-11-26T02:00:00Z'); // 10:00 Malaysia time
const okPermit = { userId: 'u1', method: 'POST', path: '/api/meetings/meetings', exp: NOW + 60_000 };
const base = { method: 'POST', path: '/api/meetings/meetings', innerOk: true, actionId: 'mcpx_aaaaaaaaaaaaaaaaaaaa', permit: okPermit, userId: 'u1', now: NOW };

test('write fence: a plain connector token POST (no inner secret) is refused', () => {
  assert.equal(A.connectorDecision({ ...base, innerOk: false }), 'refuse');
  assert.equal(A.connectorDecision({ ...base, innerOk: false, actionId: '', permit: null }), 'refuse');
  for (const m of ['PUT', 'PATCH', 'DELETE']) assert.equal(A.connectorDecision({ ...base, method: m, innerOk: false }), 'refuse');
});

test('write fence: reads from the tool runner pass; a write needs the action id, a permit and an allow-listed path', () => {
  assert.equal(A.connectorDecision({ ...base, method: 'GET', actionId: '', permit: null }), 'read');
  assert.equal(A.connectorDecision({ ...base, method: 'GET', innerOk: false }), 'refuse');
  assert.equal(A.connectorDecision(base), 'write');
  assert.equal(A.connectorDecision({ ...base, path: '/api/meetings/meetings/' }), 'write');
  assert.equal(A.connectorDecision({ ...base, actionId: '' }), 'refuse');
  assert.equal(A.connectorDecision({ ...base, permit: null }), 'refuse');
  assert.equal(A.connectorDecision({ ...base, permit: { ...okPermit, userId: 'u2' } }), 'refuse', 'another person');
  assert.equal(A.connectorDecision({ ...base, permit: { ...okPermit, exp: NOW } }), 'refuse', 'expired');
  assert.equal(A.connectorDecision({ ...base, method: 'PATCH' }), 'refuse', 'other method');
  // A permit for the meeting route does not open the email route, and nothing opens a route off the list.
  assert.equal(A.connectorDecision({ ...base, path: '/api/supply-chain/engine-session' }), 'refuse');
  for (const p of ['/api/reservations', '/api/statements/finalise', '/api/payouts', '/api/meetings/meetings/1/cancel', '/api/users']) {
    assert.equal(A.connectorDecision({ ...base, path: p, permit: { ...okPermit, path: p } }), 'refuse', p);
  }
});

test('the allow-list is exactly booking a meeting and the Mail Center sign-on', () => {
  assert.deepEqual(A.ACTION_ALLOWLIST.map(([m, p]) => `${m} ${p}`), ['POST /api/meetings/meetings', 'POST /api/supply-chain/engine-session']);
  assert.equal(A.isAllowlisted('post', '/api/meetings/meetings?x=1'), true);
  assert.equal(A.isAllowlisted('GET', '/api/meetings/meetings'), false);
});

test('permits are single use', () => {
  grantActionPermit('mcpx_permit_test_123456', { userId: 'u1', method: 'post', path: '/api/meetings/meetings' });
  const p = takeActionPermit('mcpx_permit_test_123456');
  assert.equal(p?.method, 'POST');
  assert.equal(p?.userId, 'u1');
  assert.equal(takeActionPermit('mcpx_permit_test_123456'), null);
  assert.equal(takeActionPermit('never-granted'), null);
});

test('parseWhen: plain times are Malaysia time; offsets kept; nonsense refused', () => {
  assert.equal(A.parseWhen('2026-11-27 14:00'), Date.parse('2026-11-27T06:00:00Z'));
  assert.equal(A.parseWhen('2026-11-27T14:00'), Date.parse('2026-11-27T06:00:00Z'));
  assert.equal(A.parseWhen('2026-11-27T14:00:00Z'), Date.parse('2026-11-27T14:00:00Z'));
  assert.equal(A.parseWhen('2026-11-27T14:00+08:00'), Date.parse('2026-11-27T06:00:00Z'));
  for (const bad of ['', 'tomorrow 2pm', '2026-02-30 10:00', '2026-11-27 25:00', '2026-11-27']) assert.equal(A.parseWhen(bad), null, bad);
  assert.equal(A.mytLabel(Date.parse('2026-11-27T06:00:00Z')), 'Fri 27 Nov 2026, 14:00');
});

const DIR = {
  me: 'conts:1',
  rooms: [{ id: 3, name: 'Board', location: 'Level 2', active: true }, { id: 4, name: 'Small', active: true }, { id: 5, name: 'Old', active: false }],
  people: [
    { key: 'conts:1', name: 'Me Myself', email: 'me@theconts.com' },
    { key: 'conts:2', name: 'Adrian Lee', email: 'adrian@theconts.com', department: 'Ops' },
    { key: 'houzs:9', name: 'Adrian Tan', email: 'adrian.tan@houzs.com', department: 'IT' },
    { key: 'hookka:4', name: 'Mei Ling', email: 'mei@hookka.com' },
  ],
};

test('propose_meeting: resolves people, outside guests and the room into the Meetings page body', () => {
  const p = A.proposeMeeting({ title: '  Weekly  sync ', start: '2026-11-27 14:00', attendees: ['Mei Ling', 'adrian@theconts.com', 'guest@gmail.com', 'me@theconts.com'], room: 'board', notes: 'Agenda' }, DIR, NOW);
  assert.equal(p.ok, true);
  assert.deepEqual(p.payload, {
    title: 'Weekly sync', start: '2026-11-27T06:00:00.000Z', end: '2026-11-27T07:00:00.000Z', roomId: 3, organizer: 'conts:1',
    attendees: ['hookka:4', 'conts:2'], videoType: 'none', videoUrl: '', notes: 'Agenda', guestEmails: ['guest@gmail.com'],
    reminders: [{ min: 15, ch: ['erp', 'email'] }], repeat: 'none', repeatUntil: null,
  });
  assert.match(p.summary, /Fri 27 Nov 2026, 14:00 to 15:00/);
  assert.match(p.summary, /Board, Level 2/);
  assert.match(p.summary, /guest@gmail.com \(outside guest\)/);
  assert.match(p.target, /^meeting: "Weekly sync"/);
});

test('propose_meeting: ambiguous or unknown names, a past time, bad room and bad order are refused with reasons', () => {
  const p = A.proposeMeeting({ title: 'X', start: '2026-11-26 08:00', end: '2026-11-26 07:00', attendees: ['Adrian', 'Nobody Here'], room: 'Old' }, DIR, NOW);
  assert.equal(p.ok, false);
  const all = p.problems.join('\n');
  assert.match(all, /"Adrian" matches 2 people/);
  assert.match(all, /"Nobody Here" is not in the staff directory/);
  assert.match(all, /end after it starts/);
  assert.match(all, /in the past/);
  assert.match(all, /no meeting room "Old"/);
  assert.equal(A.proposeMeeting({ start: '2026-11-27 14:00' }, DIR, NOW).ok, false, 'no title');
  assert.equal(A.proposeMeeting({ title: 'X', start: '2026-11-27 08:00', end: '2026-11-27 21:00' }, DIR, NOW).ok, false, 'over 12 h');
});

test('propose_email: Mail Center Compose rules, defaults and the log target without the body', () => {
  const p = A.proposeEmail({ to: ['A@x.com', 'b@y.com'], cc: 'b@y.com; c@z.com', subject: 'Hello\nthere', body: 'Line 1\r\nLine 2' }, 'Me@TheConts.com');
  assert.equal(p.ok, true);
  assert.deepEqual(p.payload, { fromAddress: 'me@theconts.com', to: ['a@x.com', 'b@y.com'], cc: ['c@z.com'], subject: 'Hello there', text: 'Line 1\nLine 2' });
  assert.match(p.summary, /From: me@theconts.com/);
  assert.match(p.summary, /Line 1\nLine 2/);
  assert.equal(p.target, 'email: to a@x.com +2, "Hello there"');
  assert.doesNotMatch(p.target, /Line 1/);
  const bad = A.proposeEmail({ to: ['nope'], subject: '', body: '' }, '');
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /Not a valid email address: nope/);
  assert.match(bad.problems.join('\n'), /from_mailbox/);
  assert.match(bad.problems.join('\n'), /subject/);
  assert.equal(A.proposeEmail({ to: [], subject: 's', body: 'b' }, 'me@x.com').ok, false);
  assert.equal(A.proposeEmail({ to: ['a@x.com'], subject: 's', body: 'b', from_mailbox: 'sales@theconts.com' }, 'me@x.com').payload.fromAddress, 'sales@theconts.com');
});

test('confirmation ids', () => {
  assert.equal(A.validConfirmationId('mcpx_abcdefghijklmnopqrstuv'), true);
  for (const bad of ['', 'mcpx_short', "mcpx_abcdefghijklmnop'--", 'mcpa_abcdefghijklmnopqrstuv']) assert.equal(A.validConfirmationId(bad), false, bad);
});

test('conflict text names the busy room, people and the suggestion', () => {
  const t = A.conflictText({ conflict: { room: { title: 'Interview', organizer: 'HR' }, people: [{ key: 'conts:2', meeting: { title: 'Site visit' } }], rules: ['Outside opening hours'] }, suggestTime: '2026-11-27T07:00:00Z', suggestRooms: [{ name: 'Small' }] }, DIR);
  assert.match(t, /meeting room is taken by "Interview" \(HR\)/);
  assert.match(t, /Adrian Lee is busy with "Site visit"/);
  assert.match(t, /Outside opening hours/);
  assert.match(t, /Fri 27 Nov 2026, 15:00/);
  assert.match(t, /free then: Small/);
});

test('stay months and the reservation flow', () => {
  assert.deepEqual(A.stayMonths('2026-11-29', '2026-12-02'), ['2026-11', '2026-12']);
  assert.deepEqual(A.stayMonths('2026-11-29', '2026-12-01'), ['2026-11']);
  assert.deepEqual(A.stayMonths('bad', 'x'), []);
  const f = A.reservationFlow({
    origin: 'https://erp.example',
    reservation: { id: 'r1', externalRef: 'HM123', state: 'checked_out', checkIn: '2026-11-29', checkOut: '2026-12-02', guestName: 'Ali', propertyName: 'Vista', unitNumber: 'A-1', money: { gross: 123450 },
      documents: [{ id: 'd1', type: 'invoice', docNo: 'INV-0001', amount: 123450, issuedAt: '2026-11-29T01:00:00Z', voidedAt: null, pdf: '/api/guest-documents/d1/pdf' }] },
    payments: { data: [{ id: 'p1', amount: 100000, receivedOn: '2026-11-30', status: 'received', kind: 'payment', reference: 'FPX1', method: 'transfer' }] },
    unit: { owner: { id: 'o1', name: 'Tan' } },
    statements: [
      { period: '2026-11', body: { data: [{ id: 's1', ownerId: 'o1', period: '2026-11', state: 'sent', netPayout: 50000, periodEnd: '2026-11-30', ownerName: 'Tan' }, { id: 's9', ownerId: 'o2', period: '2026-11' }] } },
      { period: '2026-12', body: { data: [] } },
    ],
    refused: [],
  });
  assert.deepEqual(f.start, { type: 'Reservation', number: 'HM123', status: 'checked_out', date: '2026-11-29', amountRM: 1234.5, url: 'https://erp.example/reservations/bookings?view=all&open=r1', note: 'Ali · Vista A-1 · 2026-11-29 to 2026-12-02' });
  assert.deepEqual(f.chain.map(l => `${l.type}|${l.number}|${l.amountRM}`), ['Guest invoice|INV-0001|1234.5', 'Payment|FPX1|1000', 'Owner|Tan|null', 'Owner statement|Tan 2026-11|500']);
  assert.equal(f.chain[3].url, 'https://erp.example/finance/statements/s1/report');
  assert.match(f.notes.join(' '), /No owner statement for Tan for 2026-12/);
});

test('reservation flow without finance access: money parts absent and the refusal said', () => {
  const f = A.reservationFlow({ origin: 'o', reservation: { id: 'r1', externalRef: 'X', documents: [] }, payments: null, unit: null, statements: [], refused: ['Payments, invoices and receipts are not available to your role.'] });
  assert.equal(f.chain.length, 0);
  assert.equal(f.start.amountRM, null);
  assert.deepEqual(f.notes, ['Payments, invoices and receipts are not available to your role.']);
});

test('signed export links: valid, tampered, foreign key and expired', async () => {
  const key = 'mcp-exports/2026-11-26/abc/Owner statement.pdf';
  const qs = await A.signExport('secret-1', key, NOW + 1000);
  const q = new URLSearchParams(qs);
  assert.equal(q.get('k'), key);
  assert.equal(await A.verifyExport('secret-1', q.get('k'), q.get('e'), q.get('s'), NOW), 'ok');
  assert.equal(await A.verifyExport('secret-1', q.get('k'), q.get('e'), q.get('s'), NOW + 2000), 'expired');
  assert.equal(await A.verifyExport('secret-2', q.get('k'), q.get('e'), q.get('s'), NOW), 'bad');
  assert.equal(await A.verifyExport('secret-1', key, String(NOW + 99_000), q.get('s'), NOW), 'bad', 'expiry changed');
  assert.equal(await A.verifyExport('secret-1', 'receipts/x.pdf', q.get('e'), q.get('s'), NOW), 'bad', 'outside mcp-exports');
  assert.equal(await A.verifyExport('', key, q.get('e'), q.get('s'), NOW), 'bad');
  assert.equal(A.safeFileName('Owner statement Tan/Ah "Kow" 2026-11'), 'Owner statement Tan Ah Kow 2026-11');
});

test('pending-action lifecycle on real SQL: single use, lapse, wrong owner, cancel, daily count', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  await db.exec("INSERT INTO users VALUES ('u1'), ('u2')");
  const migration = fs.readFileSync(new URL('../../migrations-pg/0380_mcp_pending_actions.sql', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(set local|select demo\.sync|GRANT |ALTER TABLE .* OWNER TO)/i.test(l)).join('\n');
  await db.exec(migration);
  const q = async (sql, ...args) => { let i = 0; return (await db.query(sql.replace(/\?/g, () => `$${++i}`), args)).rows; };
  const iso = (t) => new Date(t).toISOString();
  const add = (id, user, token, exp) => q(A.PENDING_SQL.insert, id, token, user, 'meeting', '{"title":"x"}', 'Book x', iso(NOW), iso(exp));
  await add('a1', 'u1', 't1', NOW + A.ACTION_TTL_MS);
  await add('a2', 'u1', 't1', NOW - 1);
  await add('a3', 'u1', 't1', NOW + A.ACTION_TTL_MS);

  assert.equal((await q(A.PENDING_SQL.consume, iso(NOW), 'a1', 't1', 'u2', iso(NOW))).length, 0, 'another person');
  assert.equal((await q(A.PENDING_SQL.consume, iso(NOW), 'a1', 't9', 'u1', iso(NOW))).length, 0, 'another connection');
  const got = await q(A.PENDING_SQL.consume, iso(NOW), 'a1', 't1', 'u1', iso(NOW));
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, 'meeting');
  assert.equal((await q(A.PENDING_SQL.consume, iso(NOW), 'a1', 't1', 'u1', iso(NOW))).length, 0, 'second confirm');
  assert.equal((await q(A.PENDING_SQL.consume, iso(NOW), 'a2', 't1', 'u1', iso(NOW))).length, 0, 'lapsed');
  await q(A.PENDING_SQL.finish, 'done', 'Booked', 'a1');

  assert.equal((await q(A.PENDING_SQL.cancel, iso(NOW), 'a3', 't1', 'u1')).length, 1);
  assert.equal((await q(A.PENDING_SQL.consume, iso(NOW), 'a3', 't1', 'u1', iso(NOW))).length, 0, 'cancelled cannot be confirmed');
  assert.equal((await q(A.PENDING_SQL.cancel, iso(NOW), 'a3', 't1', 'u1')).length, 0, 'cancel twice');

  const [{ n }] = await q(A.PENDING_SQL.countDay, 'u1', iso(NOW - 24 * 3600_000));
  assert.equal(n, 1, 'only the confirmed one counts toward the daily limit');
  await assert.rejects(() => q("INSERT INTO mcp_pending_actions (id, token_id, user_id, kind, payload_json, summary, created_at, expires_at) VALUES ('z', 't', 'u1', 'order', '{}', 's', 'x', 'y')"), /check/i);
  await db.close();
});
