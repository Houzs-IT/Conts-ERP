// node --test src/lib/mcpWrite.test.mjs. AI Connector round 4b (write actions: functions/_lib/mcpWrite.ts, the fence in
// mcpActions.ts, migration 0396) and round 4c (functions/_lib/mcpVisibility.ts, the role prompts in mcpQuick.ts, the
// daily brief's waiting threads in mcpMore.ts).
// The write path runs against a stand-in ERP that applies the session middleware's module gate the way the real one
// does (a view-only account gets the ERP's own 403 on the PATCH), and a stand-in Mail Center.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const A = await import('../../functions/_lib/mcpActions.ts');
const W = await import('../../functions/_lib/mcpWrite.ts');
const V = await import('../../functions/_lib/mcpVisibility.ts');
const Q = await import('../../functions/_lib/mcpQuick.ts');
const M = await import('../../functions/_lib/mcpMore.ts');

const NOW = Date.parse('2026-11-27T02:00:00Z'); // 10:00 Malaysia time
const O = 'https://erp.example';

/* ---------- the fence ---------- */

test('fence: the two note routes are allow-listed by pattern, nothing next to them is', () => {
  assert.equal(A.isAllowlisted('PATCH', '/api/reservations/r_1/details'), true);
  assert.equal(A.isAllowlisted('patch', '/api/housekeeping/tasks/t-9'), true);
  for (const [m, p] of [['PATCH', '/api/reservations/r1'], ['POST', '/api/reservations/r1/cancel'], ['PATCH', '/api/reservations/r1/dates'], ['PUT', '/api/reservations/r1/details'],
    ['PATCH', '/api/housekeeping/tasks/t1/assign'], ['POST', '/api/housekeeping/tasks/t1'], ['PATCH', '/api/maintenance/issues/m1'], ['PATCH', '/api/reservations/../users/details'],
    ['PATCH', '/api/reservations/a/b/details'], ['POST', '/api/payouts'], ['POST', '/api/statements/finalise']]) {
    assert.equal(A.isAllowlisted(m, p), false, `${m} ${p}`);
  }
});

test('fence: a note permit lets through only a body with the note field, as a string', () => {
  const permit = { userId: 'u1', method: 'PATCH', path: '/api/reservations/r1/details', exp: NOW + 60_000, fence: 'reservation_note' };
  const base = { method: 'PATCH', path: '/api/reservations/r1/details', innerOk: true, actionId: 'mcpx_aaaaaaaaaaaaaaaaaaaa', permit, userId: 'u1', now: NOW };
  assert.equal(A.connectorDecision({ ...base, body: { staffNotes: 'a\n[Note …]' } }), 'write');
  for (const body of [undefined, null, {}, [], { staffNotes: 'x', checkInTime: '15:00' }, { selfCheckIn: true }, { staffNotes: null }, { checkOutTime: '12:00' }]) {
    assert.equal(A.connectorDecision({ ...base, body }), 'refuse', JSON.stringify(body));
  }
  const task = { ...permit, path: '/api/housekeeping/tasks/t1', fence: 'cleaning_note' };
  const tb = { ...base, path: '/api/housekeeping/tasks/t1', permit: task };
  assert.equal(A.connectorDecision({ ...tb, body: { instructions: 'Use the side door' } }), 'write');
  for (const body of [{ instructions: 'x', amount: 1 }, { kind: 'deep_clean' }, { day: '2026-12-01' }, { title: 'x' }]) assert.equal(A.connectorDecision({ ...tb, body }), 'refuse', JSON.stringify(body));
  // A permit for one record does not open another, and a meeting permit (no fence) is unchanged.
  assert.equal(A.connectorDecision({ ...base, path: '/api/reservations/r2/details', body: { staffNotes: 'x' } }), 'refuse');
  assert.equal(A.actionBodyAllowed(undefined, { anything: 1 }), true);
  assert.equal(A.actionBodyAllowed('mail_reply', { text: 'Hi', afterMessageId: 'm1' }), true);
  assert.equal(A.actionBodyAllowed('mail_reply', { text: 'Hi', afterMessageId: 'm1', force: true }), false, 'the reply guard is never forced');
  assert.equal(A.actionBodyAllowed('mail_reply', { text: 'Hi', to: 'x@y.com' }), false);
});

test('migration 0396 on real SQL: the new kinds store, others are still refused; peek reads without claiming', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  await db.exec("INSERT INTO users VALUES ('u1')");
  const strip = (f) => fs.readFileSync(new URL(`../../migrations-pg/${f}`, import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(set local|select demo\.sync|GRANT |ALTER TABLE .* OWNER TO)/i.test(l)).join('\n');
  await db.exec(strip('0380_mcp_pending_actions.sql'));
  const q = async (sql, ...args) => { let i = 0; return (await db.query(sql.replace(/\?/g, () => `$${++i}`), args)).rows; };
  const iso = (t) => new Date(t).toISOString();
  await assert.rejects(() => q(A.PENDING_SQL.insert, 'x0', 't1', 'u1', 'reservation_note', '{}', 's', iso(NOW), iso(NOW + 1e6)), /check/i, 'before 0396');
  await db.exec(strip('0396_mcp_write_actions.sql'));
  for (const [id, kind] of [['x1', 'reservation_note'], ['x2', 'cleaning_note'], ['x3', 'mail_reply'], ['x4', 'meeting'], ['x5', 'email']]) {
    await q(A.PENDING_SQL.insert, id, 't1', 'u1', kind, '{}', 's', iso(NOW), iso(NOW + A.ACTION_TTL_MS));
  }
  await assert.rejects(() => q(A.PENDING_SQL.insert, 'z', 't1', 'u1', 'payout', '{}', 's', iso(NOW), iso(NOW + 1e6)), /check/i);
  assert.deepEqual((await q(A.PENDING_SQL.peek, 'x1', 't1', 'u1', iso(NOW))).map(r => r.kind), ['reservation_note']);
  assert.equal((await q(A.PENDING_SQL.peek, 'x1', 't9', 'u1', iso(NOW))).length, 0, 'another connection');
  assert.equal((await q(A.PENDING_SQL.consume, iso(NOW), 'x1', 't1', 'u1', iso(NOW))).length, 1, 'peek claimed nothing');
  assert.equal((await q(A.PENDING_SQL.peek, 'x1', 't1', 'u1', iso(NOW))).length, 0, 'used');
  await db.close();
});

/* ---------- the stand-in ERP ---------- */

/** `role`: manager (edit everywhere), viewer (Reservations / Cleaning view only: the gate says no and the ERP's own
 *  PATCH answers 403), nomail (no Mail Center). `opened`: whether the person's Mail Center was ever opened. */
function erp({ role = 'manager', opened = true, main = true, switches = { mail_reply: true, note: true }, ready = true, replyStatus = 200 } = {}) {
  const st = {
    reservations: { r1: { id: 'r1', externalRef: 'HM123', guestName: 'Ann Lee', propertyName: 'Vortex', unitNumber: 'A-12-03', checkIn: '2026-12-01', checkOut: '2026-12-04', state: 'confirmed', staffNotes: 'VIP guest' } },
    tasks: { t1: { id: 't1', kind: 'turnover', state: 'open', propertyName: 'Vortex', unitNumber: 'A-12-03', instructions: null } },
    threads: [
      { id: 'th1', subject: 'Late check-in?', mailbox: 'hello@theconts.com', fromEmail: 'guest@x.com', fromName: 'Ann', lastAt: '2026-11-26T10:00:00Z', snippet: 'Can we arrive at 11pm?', newestMessageId: 'm7' },
    ],
    pending: new Map(), writes: [], replies: [], audits: [], signOns: 0, opened, main, switches, ready,
  };
  const viewOnly = role === 'viewer';
  let n = 0;
  const deps = {
    userName: 'Lim Wei', origin: O,
    read: async (path, q = {}) => {
      if (path === '/api/supply-chain/mail-waiting') {
        if (role === 'nomail') return { ok: false, status: 403, message: 'Not available to your role.' };
        if (!st.opened) return { ok: true, status: 200, value: { count: null, opened: false, note: 'Mail Center not opened yet.' } };
        return { ok: true, status: 200, value: { count: st.threads.length, opened: true, ...(q.list === '1' ? { threads: st.threads } : {}) } };
      }
      let m = /^\/api\/reservations\/([^/]+)$/.exec(path);
      if (m) return st.reservations[m[1]] ? { ok: true, status: 200, value: structuredClone(st.reservations[m[1]]) } : { ok: false, status: 404, message: 'not found' };
      m = /^\/api\/housekeeping\/tasks\/([^/]+)$/.exec(path);
      if (m) return st.tasks[m[1]] ? { ok: true, status: 200, value: structuredClone(st.tasks[m[1]]) } : { ok: false, status: 404, message: 'not found' };
      if (path === '/api/search') return { ok: true, status: 200, value: Object.values(st.reservations).filter(r => r.externalRef.toLowerCase().includes(String(q.q).toLowerCase())).map(r => ({ kind: 'reservation', id: r.id, ref: r.externalRef, label: r.externalRef })) };
      return { ok: false, status: 404, message: 'unknown' };
    },
    canWrite: async (method, path) => (method === 'PATCH' ? !viewOnly : role !== 'nomail' && !!path),
    ready: async () => st.ready,
    mainOn: async () => st.main,
    switches: async () => ({ ...st.switches }),
    createPending: async (kind, payload, summary) => { const id = `mcpx_test${String(++n).padStart(16, '0')}`; st.pending.set(id, { id, kind, payload, summary, used: false }); return { id, expiresAt: new Date(NOW + 600_000).toISOString() }; },
    peekPending: async (id) => (st.pending.get(id) && !st.pending.get(id).used ? st.pending.get(id).kind : null),
    consumePending: async (id) => { const p = st.pending.get(id); if (!p || p.used) return null; p.used = true; return p; },
    finishPending: async (id, outcome, result) => { st.pending.get(id).outcome = outcome; st.pending.get(id).result = result; },
    confirmedToday: async () => [...st.pending.values()].filter(p => p.used).length,
    write: async (actionId, req) => {
      st.writes.push({ actionId, ...req });
      // The ERP's own session middleware: View refuses writes.
      if (viewOnly) return { status: 403, body: { error: { code: 'FORBIDDEN', message: 'Your access to Reservations is view only.' } } };
      const m = /^\/api\/(reservations|housekeeping\/tasks)\/([^/]+)/.exec(req.path);
      if (m[1] === 'reservations') st.reservations[m[2]].staffNotes = req.body.staffNotes; else st.tasks[m[2]].instructions = req.body.instructions;
      return { status: 200, body: { ok: true } };
    },
    engineReply: async (actionId, threadId, body) => {
      st.signOns++;
      st.replies.push({ actionId, threadId, body });
      if (replyStatus === 409) return { status: 409, body: { code: 'already_replied', by: 'Siti', at: '2026-11-27T01:59:00Z', error: 'Siti already replied.' } };
      return { status: replyStatus, body: { ok: true, messageId: 'out1', queued: false } };
    },
    audit: async (action, table, id, after) => { st.audits.push({ action, table, id, after }); },
    now: () => NOW,
  };
  return { st, deps };
}

const note = (o = {}) => ({ target_type: 'reservation', number_or_id: 'HM123', note: 'Guest asked for an extra towel set', ...o });

/* ---------- propose writes nothing; confirm writes once ---------- */

test('propose_note writes nothing: one pending action, a summary, no ERP write', async () => {
  const { st, deps } = erp();
  const o = await W.proposeWrite(deps, 'propose_note', note());
  assert.equal(o.ok, true, o.message);
  assert.match(o.body.confirmationId, /^mcpx_/);
  assert.match(o.body.summary, /staff notes of reservation HM123.*Ann Lee/s);
  assert.match(o.body.summary, /extra towel/);
  assert.equal(st.writes.length, 0);
  assert.equal(st.pending.size, 1);
  assert.equal(st.reservations.r1.staffNotes, 'VIP guest');
  assert.doesNotMatch(o.target, /towel/, 'the call log never carries the note text');
});

test('confirm_action writes once, through the reservation route, appending to what is stored at confirm time', async () => {
  const { st, deps } = erp();
  const o = await W.proposeWrite(deps, 'propose_note', note());
  st.reservations.r1.staffNotes = 'VIP guest\nColleague: late arrival'; // added between the proposal and the yes
  const c = await W.confirmWrite(deps, o.body.confirmationId);
  assert.equal(c.ok, true, c.message);
  assert.match(c.message, /Note added to reservation HM123/);
  assert.equal(st.writes.length, 1);
  assert.deepEqual(Object.keys(st.writes[0].body), ['staffNotes']);
  assert.equal(st.writes[0].method, 'PATCH');
  assert.equal(st.writes[0].path, '/api/reservations/r1/details');
  assert.equal(st.writes[0].fence, 'reservation_note');
  assert.equal(st.reservations.r1.staffNotes, 'VIP guest\nColleague: late arrival\n[Note 2026-11-27 Lim Wei (via AI Connector): Guest asked for an extra towel set]');
  assert.equal(st.audits.length, 1);
  assert.equal(st.audits[0].action, 'ai_connector.reservation_note');
  assert.doesNotMatch(JSON.stringify(st.audits), /towel/, 'the audit row names the record, not the text');
  const again = await W.confirmWrite(deps, o.body.confirmationId);
  assert.equal(again, null, 'a used confirmation is no longer a write action here (confirm_action then answers "not open")');
  assert.equal(st.writes.length, 1, 'still one write');
});

test('a cleaning job note goes to its notes for the cleaner, and only there', async () => {
  const { st, deps } = erp();
  const o = await W.proposeWrite(deps, 'propose_note', { target_type: 'cleaning_job', number_or_id: 'cleaning:t1', note: 'Key is with the guard' });
  assert.equal(o.ok, true, o.message);
  assert.match(o.body.summary, /notes for the cleaner.*field app/s);
  const c = await W.confirmWrite(deps, o.body.confirmationId);
  assert.equal(c.ok, true);
  assert.deepEqual(st.writes.map(w => [w.path, Object.keys(w.body)]), [['/api/housekeeping/tasks/t1', ['instructions']]]);
  assert.match(st.tasks.t1.instructions, /^\[Note 2026-11-27 Lim Wei \(via AI Connector\): Key is with the guard\]$/);
});

test('notes: bad input, maintenance, a note that would not fit, a reservation not found', async () => {
  const { st, deps } = erp();
  assert.match((await W.proposeWrite(deps, 'propose_note', note({ target_type: 'maintenance' }))).message, /Maintenance jobs have no notes field/);
  assert.match((await W.proposeWrite(deps, 'propose_note', note({ note: ' ' }))).message, /Write the note/);
  assert.match((await W.proposeWrite(deps, 'propose_note', note({ note: 'x'.repeat(501) }))).message, /at most 500/);
  assert.match((await W.proposeWrite(deps, 'propose_note', note({ number_or_id: 'NOPE' }))).message, /No reservation matches/);
  assert.match((await W.proposeWrite(deps, 'propose_note', note({ number_or_id: 'cleaning:t1' }))).message, /is a cleaning job/);
  st.reservations.r1.staffNotes = 'x'.repeat(1990);
  assert.match((await W.proposeWrite(deps, 'propose_note', note())).message, /over 2,000 characters/);
  assert.equal(st.pending.size, 0);
  assert.equal(st.writes.length, 0);
});

/* ---------- switches ---------- */

test('switched off: main switch, the action\'s own switch, not set up; a switch turned off after the proposal refuses the yes without using it up', async () => {
  for (const [cfg, re] of [[{ main: false }, /AI actions are switched off/], [{ switches: { mail_reply: true, note: false } }, /"Add notes to reservations and cleaning jobs" is switched off/], [{ ready: false }, /migration 0396/]]) {
    const { st, deps } = erp(cfg);
    const o = await W.proposeWrite(deps, 'propose_note', note());
    assert.equal(o.ok, false);
    assert.match(o.message, re);
    assert.equal(st.pending.size, 0);
  }
  const { st, deps } = erp();
  const o = await W.proposeWrite(deps, 'propose_note', note());
  st.switches.note = false;
  const c = await W.confirmWrite(deps, o.body.confirmationId);
  assert.equal(c.ok, false);
  assert.equal(c.status, 403);
  assert.match(c.message, /switched off/);
  assert.equal(st.writes.length, 0);
  assert.equal(await deps.peekPending(o.body.confirmationId), 'reservation_note', 'not used up');
  st.main = false;
  assert.match((await W.confirmWrite(deps, o.body.confirmationId)).message, /AI actions are switched off/);
  st.main = true; st.switches.note = true;
  assert.equal((await W.confirmWrite(deps, o.body.confirmationId)).ok, true, 'switched back on, the same yes works once');
  // The mail switch alone does not open notes, and the other way round.
  const m = erp({ switches: { mail_reply: false, note: true } });
  assert.match((await W.proposeWrite(m.deps, 'propose_mail_reply', { thread_id: 'th1', body: 'Hi' })).message, /"Reply to Mail Center emails" is switched off/);
});

/* ---------- permission: the ERP decides ---------- */

test('without permission: the gate refuses the proposal; past the gate, the ERP\'s own 403 is said as the ERP\'s refusal', async () => {
  const { st, deps } = erp({ role: 'viewer' });
  const o = await W.proposeWrite(deps, 'propose_note', note());
  assert.equal(o.ok, false);
  assert.equal(o.status, 403);
  assert.match(o.message, /Not available to your role/);
  assert.equal(st.pending.size, 0);
  // Access changed between the proposal and the yes: the ERP's own PATCH answers 403, and that is what the person hears.
  const ok = erp();
  const p = await W.proposeWrite(ok.deps, 'propose_note', note());
  const viewer = erp({ role: 'viewer' });
  viewer.st.pending = ok.st.pending;
  const c = await W.confirmWrite(viewer.deps, p.body.confirmationId);
  assert.equal(c.ok, false);
  assert.equal(c.status, 403);
  assert.match(c.message, /the ERP refused it for your account \(Your access to Reservations is view only\.\)/);
  assert.equal(viewer.st.reservations.r1.staffNotes, 'VIP guest');
  const nomail = erp({ role: 'nomail' });
  assert.match((await W.proposeWrite(nomail.deps, 'propose_mail_reply', { thread_id: 'th1', body: 'Hi' })).message, /Not available to your role/);
});

/* ---------- Mail Center reply ---------- */

test('mail reply: shows who it goes to, stores afterMessageId, sends exactly { text, afterMessageId } once, never force', async () => {
  const { st, deps } = erp();
  const o = await W.proposeWrite(deps, 'propose_mail_reply', { thread_id: 'th1', body: 'Yes, 11pm is fine. The guard has your key.' });
  assert.equal(o.ok, true, o.message);
  assert.match(o.body.summary, /From: hello@theconts\.com\nTo: Ann <guest@x\.com>\nSubject: Re: Late check-in\?/);
  assert.match(o.body.summary, /reply guard/);
  assert.equal(st.signOns, 0, 'no Mail Center sign-on at propose');
  assert.doesNotMatch(o.target, /11pm/);
  const c = await W.confirmWrite(deps, o.body.confirmationId);
  assert.equal(c.ok, true, c.message);
  assert.match(c.message, /Reply sent to guest@x\.com/);
  assert.deepEqual(st.replies, [{ actionId: o.body.confirmationId, threadId: 'th1', body: { text: 'Yes, 11pm is fine. The guard has your key.', afterMessageId: 'm7' } }]);
  assert.equal(st.audits[0].action, 'ai_connector.mail_reply');
  assert.equal(st.audits[0].after.to, 'guest@x.com');
  assert.doesNotMatch(JSON.stringify(st.audits), /11pm/);
});

test('mail reply: a colleague replied first (409) is not sent and says who', async () => {
  const { deps } = erp({ replyStatus: 409 });
  const o = await W.proposeWrite(deps, 'propose_mail_reply', { thread_id: 'th1', body: 'Hi' });
  const c = await W.confirmWrite(deps, o.body.confirmationId);
  assert.equal(c.ok, false);
  assert.match(c.message, /Not sent: Siti already replied/);
});

test('mail reply: never provisions a mailbox; only emails waiting for the person; an engine without the list', async () => {
  const closed = erp({ opened: false });
  const o = await W.proposeWrite(closed.deps, 'propose_mail_reply', { thread_id: 'th1', body: 'Hi' });
  assert.equal(o.ok, false);
  assert.equal(o.message, W.OPEN_MAIL_FIRST);
  // Opened at propose, then (say) the mailbox was closed before the yes: no sign-on at all.
  const { st, deps } = erp();
  const p = await W.proposeWrite(deps, 'propose_mail_reply', { thread_id: 'th1', body: 'Hi' });
  st.opened = false;
  const c = await W.confirmWrite(deps, p.body.confirmationId);
  assert.equal(c.ok, false);
  assert.match(c.message, /Open Mail Center in the ERP first/);
  assert.equal(st.signOns, 0);
  // Not waiting for this person: refused, with the ones that are.
  st.opened = true;
  const nw = await W.proposeWrite(deps, 'propose_mail_reply', { thread_id: 'th9', body: 'Hi' });
  assert.equal(nw.status, 404);
  assert.match(nw.message, /not one waiting for your reply.*th1 "Late check-in\?"/s);
  assert.deepEqual(W.readWaiting({ count: 3, opened: true }), { kind: 'not_listed' });
  assert.equal(W.readWaiting({ count: null, opened: false, note: 'x' }).kind, 'not_opened');
  const noGuard = W.buildMailReply({ thread_id: 'th1', body: 'Hi' }, [{ ...st.threads[0], newestMessageId: null }]);
  assert.equal(noGuard.ok, false, 'no afterMessageId means no reply guard, so it is refused');
});

test('describeWrite: plain outcomes', () => {
  assert.match(W.describeWrite('mail_reply', 200, { ok: true, queued: true }, 'a@b.com').message, /queued/);
  assert.match(W.describeWrite('mail_reply', 404, { error: 'Thread not found' }, 'a@b.com').message, /not in your mailboxes/);
  assert.match(W.describeWrite('cleaning_note', 404, {}, 'A-1').message, /no longer exists/);
  assert.match(W.describeWrite('reservation_note', 422, { error: { message: 'Nothing to change.' } }, 'HM1').message, /Nothing to change/);
  assert.equal(W.switchForKind('cleaning_note'), 'note');
  assert.equal(W.isWriteKind('meeting'), false);
});

/* ---------- 4c: visibility, structured output, links, cache, prompts ---------- */

test('P1: a read tool is listed only when its endpoints pass the gate; no-access text names them', async () => {
  const ops = new Set(['/api/reservations', '/api/tasks', '/api/reservations/calendar']);
  const can = async (p) => ops.has(p);
  assert.equal(await V.readToolAllowed('reservations_summary', can), true);
  assert.equal(await V.readToolAllowed('owner_statement_summary', can), false);
  assert.equal(await V.readToolAllowed('payables_summary', can), false);
  assert.equal(await V.readToolAllowed('housekeeping_today', can), true, 'any one of its reads');
  assert.equal(await V.readToolAllowed('company_report', can), true, 'reservations is one of its reads');
  assert.equal(await V.readToolAllowed('search', async () => false), true, 'no entry: always listed');
  assert.equal(await V.readToolAllowed('attendance_today', can), false);
  assert.match(V.noAccessText('payables_summary'), /Not available to your role.*purchase invoices, finance/);
  for (const t of V.STRUCTURED_TOOLS) assert.ok(V.TOOL_PAGES[t], `${t} has an ERP page`);
});

test('P3 + P5: structured answer keeps the JSON, adds the ERP link, record links and RM; a hidden figure stays null', () => {
  const v = V.parseQuickText(JSON.stringify({ total: 2, rows: [{ reservationId: 'r1', amountSen: 12345 }, { unitId: 'u1', url: 'https://x/keep' }, { ownerId: 'o1', paidSen: null }] }));
  const out = V.withLinksAndRm('arrears_summary', v, O);
  assert.equal(out.erpLink, `${O}/reservations/bookings`);
  assert.deepEqual(out.rows[0], { reservationId: 'r1', amountRm: 123.45, url: `${O}/reservations/bookings?view=all&open=r1` });
  assert.equal(out.rows[1].url, 'https://x/keep');
  assert.deepEqual(out.rows[2], { ownerId: 'o1', paidRm: null, url: `${O}/owners/o1` });
  assert.equal(V.parseQuickText('Not available to your role.'), null);
  assert.equal(V.parseQuickText('[1,2]'), null);
  assert.equal(V.withLinksAndRm('daily_brief', { link: 'x' }, O).erpLink, undefined, 'an answer with its own link keeps it');
});

test('P4: the cache key is person + role + tool + arguments (order-free); entries lapse after 60 s and the map stays bounded', () => {
  assert.equal(V.cacheKey('u1', 'operations', 'channel_mix', { period: 'month', a: 1 }), V.cacheKey('u1', 'operations', 'channel_mix', { a: 1, period: 'month' }));
  assert.notEqual(V.cacheKey('u1', 'operations', 'channel_mix', {}), V.cacheKey('u2', 'operations', 'channel_mix', {}));
  assert.notEqual(V.cacheKey('u1', 'operations', 'channel_mix', {}), V.cacheKey('u1', 'management', 'channel_mix', {}));
  assert.equal(V.cacheKey('u1', 'r', 'today_summary', {}), null, 'live answers are not cached');
  assert.equal(V.cacheKey('u1', 'r', 'propose_note', {}), null);
  const c = new V.AnswerCache(60_000, 2);
  c.set('a', 1, 0);
  assert.equal(c.get('a', 59_999), 1);
  assert.equal(c.get('a', 60_000), null);
  c.set('a', 1, 0); c.set('b', 2, 0); c.set('c', 3, 0);
  assert.equal(c.size, 2);
  assert.equal(c.get('a', 1), null, 'oldest dropped');
});

test('P2: five role prompts, each tied to tools and expanding to a question that names them', () => {
  for (const name of ['owner_morning_report', 'operations_review', 'reservations_revenue_review', 'finance_review', 'owner_relations_review']) {
    assert.ok(Q.PROMPTS.some(p => p.name === name), name);
    const tools = Q.PROMPT_TOOLS[name];
    assert.ok(tools?.length, name);
    const t = Q.promptText(name, {});
    for (const tool of tools) assert.ok(t.includes(tool), `${name} names ${tool}`);
  }
  for (const p of Q.PROMPTS) assert.ok(Q.PROMPT_TOOLS[p.name], `${p.name} has tools`);
  assert.match(Q.promptText('finance_review', { month: '2026-10' }), /month: "2026-10"/);
  assert.match(Q.promptText('owner_relations_review', { owner: 'Tan' }), /owner: "Tan"/);
  assert.match(Q.promptText('reservations_revenue_review', { period: 'junk' }), /period: "month"/);
});

test('daily brief: waiting Mail Center emails are listed with their threadId (the old count-only line otherwise)', () => {
  const base = { today: '2026-11-27', origin: O, name: 'Lim', badges: null, tasks: null, approvals: null, salesOrders: null, purchaseOrders: null, maintenance: null, noAccess: [] };
  const b = M.buildBrief({ ...base, mail: { count: 2, opened: true, threads: [{ id: 'th1', subject: 'Late check-in?', fromName: 'Ann', fromEmail: 'g@x.com', mailbox: 'hello@theconts.com', lastAt: '2026-11-26T10:00:00Z' }] } });
  const s = b.sections.find(x => x.section.startsWith('Mail Center'));
  assert.equal(s.count, 2);
  assert.equal(s.top[0].threadId, 'th1');
  assert.match(s.top[0].detail, /from Ann/);
  const old = M.buildBrief({ ...base, mail: { count: 3, opened: true } });
  assert.match(old.sections[0].top[0].title, /3 email threads waiting/);
});
