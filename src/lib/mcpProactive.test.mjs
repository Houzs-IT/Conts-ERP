// node --test src/lib/mcpProactive.test.mjs. AI Connector round 4d for The Conts: the morning brief email (D1), urgent
// alerts (D2) and the Monday data gaps (D4). The pure logic in functions/_lib/mcpProactive.ts (opt-in, when a brief is
// due, the alert rules, the debounce, the HTML builder), plus source checks that every run is AS THE PERSON, bounded,
// idempotent and logged without the email body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const P = await import('../../functions/_lib/mcpProactive.ts');
const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const O = 'https://erp.example';
const TODAY = '2026-11-27'; // a Friday
const at = iso => P.mytNow(new Date(iso));

/* ---------- time ---------- */

test('mytNow: Malaysia wall clock (UTC+8), weekday, minutes', () => {
  assert.deepEqual(P.mytNow(new Date('2026-11-30T00:15:00Z')), { day: '2026-11-30', hhmm: '08:15', minutes: 8 * 60 + 15, weekday: 1 });
  assert.equal(P.mytNow(new Date('2026-11-29T16:30:00Z')).day, '2026-11-30');
  assert.equal(P.plusDays('2026-03-01', -1), '2026-02-28');
});

/* ---------- opt-in ---------- */

test('opt-in: defaults are OFF (08:00, weekdays); good input accepted, unknown keys ignored', () => {
  assert.deepEqual(P.DEFAULT_SUBSCRIPTION, { briefEnabled: false, briefTime: '08:00', briefDays: 'weekdays', alertsEnabled: false });
  assert.deepEqual(P.parseSubscriptionInput({ briefEnabled: true, briefTime: '07:30', briefDays: 'daily', alertsEnabled: true, userId: 'someone-else' }, 'u1'),
    { ok: true, value: { userId: 'u1', briefEnabled: true, briefTime: '07:30', briefDays: 'daily', alertsEnabled: true } });
  const d = P.parseSubscriptionInput({ briefEnabled: true }, 'u1');
  assert.ok(d.ok && d.value.briefTime === '08:00' && d.value.alertsEnabled === false);
});

test('opt-in: refuses times off the half hour, unknown days, non-boolean switches, non-objects', () => {
  for (const briefTime of ['8:00', '08:15', '24:00', '08:00:00', '', 'abc']) assert.equal(P.parseSubscriptionInput({ briefTime }, 'u').ok, false, briefTime);
  assert.equal(P.parseSubscriptionInput({ briefDays: 'weekends' }, 'u').ok, false);
  assert.equal(P.parseSubscriptionInput({ briefEnabled: 'yes' }, 'u').ok, false);
  assert.equal(P.parseSubscriptionInput({ alertsEnabled: 1 }, 'u').ok, false);
  assert.equal(P.parseSubscriptionInput(null, 'u').ok, false);
  assert.equal(P.parseSubscriptionInput([], 'u').ok, false);
});

test('opt-in: rows read snake_case or camelCase, integers or booleans; junk falls back to defaults', () => {
  assert.deepEqual(P.subscriptionFromRow({ user_id: 'u', brief_enabled: 1, brief_time: '06:30', brief_days: 'daily', alerts_enabled: 0 }),
    { userId: 'u', briefEnabled: true, briefTime: '06:30', briefDays: 'daily', alertsEnabled: false });
  assert.deepEqual(P.subscriptionFromRow({ userId: 'u', briefEnabled: true, briefTime: 'bad', briefDays: 'x', alertsEnabled: true }),
    { userId: 'u', briefEnabled: true, briefTime: '08:00', briefDays: 'weekdays', alertsEnabled: true });
});

const sub = (o = {}) => ({ userId: 'u1', briefEnabled: true, briefTime: '08:00', briefDays: 'weekdays', alertsEnabled: false, lastAlertCheckAt: '', ...o });

test('isBriefDue: only when opted in, at/after the time, within 4 hours, weekdays unless daily', () => {
  assert.equal(P.isBriefDue(sub(), at('2026-11-30T00:00:00Z')), true); // Mon 08:00
  assert.equal(P.isBriefDue(sub(), at('2026-11-29T23:45:00Z')), false); // 07:45
  assert.equal(P.isBriefDue(sub(), at('2026-11-30T03:45:00Z')), true); // 11:45
  assert.equal(P.isBriefDue(sub(), at('2026-11-30T04:00:00Z')), false); // 12:00, past the cutoff
  assert.equal(P.isBriefDue(sub(), at('2026-11-28T01:00:00Z')), false); // Saturday
  assert.equal(P.isBriefDue(sub({ briefDays: 'daily' }), at('2026-11-28T01:00:00Z')), true);
  assert.equal(P.isBriefDue(sub({ briefEnabled: false }), at('2026-11-30T00:00:00Z')), false, 'off = never');
  assert.equal(P.isMonday(at('2026-11-30T00:00:00Z')), true);
});

test('pickTickWork: skips people briefed today, caps per tick; alerts only 07-20, least recently checked first, 25-minute gap', () => {
  const now = at('2026-11-30T00:30:00Z');
  const ms = Date.parse('2026-11-30T00:30:00Z');
  const many = Array.from({ length: P.PROACTIVE_CONFIG.maxBriefsPerTick + 5 }, (_, i) => sub({ userId: `u${i}` }));
  const w = P.pickTickWork(many, now, new Set(['u0']), ms);
  assert.equal(w.briefs.length, P.PROACTIVE_CONFIG.maxBriefsPerTick);
  assert.ok(!w.briefs.some(s => s.userId === 'u0'));
  const a = [
    sub({ userId: 'recent', briefEnabled: false, alertsEnabled: true, lastAlertCheckAt: new Date(ms - 10 * 60_000).toISOString() }),
    sub({ userId: 'old', briefEnabled: false, alertsEnabled: true, lastAlertCheckAt: new Date(ms - 3 * 3600_000).toISOString() }),
    sub({ userId: 'never', briefEnabled: false, alertsEnabled: true }),
    sub({ userId: 'off', briefEnabled: false, alertsEnabled: false }),
  ];
  assert.deepEqual(P.pickTickWork(a, now, new Set(), ms).alerts.map(s => s.userId), ['never', 'old']);
  assert.deepEqual(P.pickTickWork(a, at('2026-11-30T13:00:00Z'), new Set(), ms).alerts, [], '21:00 MYT: no alert checks');
});

/* ---------- alerts ---------- */

const inputs = (o = {}) => ({
  today: TODAY, origin: O, canSeeFinance: true,
  exceptions: { exceptions: [
    { id: 'risk-t1', tone: 'critical', unitLabel: 'Tower A 12-3', nextGuestAt: '15:00', minutesLeft: 90, readiness: 'dirty', assigned: true, action: { taskId: 't1' } },
    { id: 'risk-t2', unitLabel: 'Tower A 12-4', minutesLeft: 120, readiness: 'ready', assigned: false, action: { taskId: 't2' } },
    { id: 'risk-t3', unitLabel: 'Tower B 1-1', minutesLeft: 300, readiness: 'dirty', assigned: false, action: { taskId: 't3' } }, // beyond 3 hours
    { id: 'risk-t4', unitLabel: 'Tower B 1-2', minutesLeft: -20, readiness: 'dirty', assigned: false }, // already past
    { id: 'risk-t5', unitLabel: 'Tower B 1-3', minutesLeft: 60, readiness: 'ready', assigned: true }, // ready and assigned
    { id: 'blocked-1', title: 'Unit blocked for maintenance' }, // not a check-in row
  ] },
  maintenance: { issues: [
    { id: 'm1', title: 'Leaking tap', state: 'open', dueOn: '2026-11-23', propertyName: 'Tower A', unitNumber: '12-3' }, // 4 days: newly past 3
    { id: 'm2', title: 'Aircon', state: 'open', dueOn: '2026-11-24' }, // 3 days: not MORE than 3
    { id: 'm3', title: 'Old', state: 'open', dueOn: '2026-11-01' }, // long overdue, not newly
    { id: 'm4', title: 'Done', state: 'resolved', dueOn: '2026-11-23' },
  ] },
  guestsOwing: { rows: [
    { id: 'r1', guestName: 'Ali', externalRef: 'HM1', checkIn: '2026-10-27', outstanding: 150_000, propertyName: 'Tower A', unitNumber: '12-3' }, // 31 days, RM 1,500
    { id: 'r2', guestName: 'Bo', checkIn: '2026-10-27', outstanding: 50_000 }, // below RM 1,000
    { id: 'r3', guestName: 'Cy', checkIn: '2026-10-01', outstanding: 500_000 }, // long past, not newly
  ] },
  invoices: { data: [
    { id: 'si1', invoiceNumber: 'INV-1', customerName: 'Acme', status: 'SENT', dueDate: '2026-10-26', outstandingSen: 200_000 }, // 32 days
    { id: 'si2', invoiceNumber: 'INV-2', status: 'PAID', dueDate: '2026-10-26', outstandingSen: 200_000 },
  ] },
  ...o,
});

test('computeAlerts: check-in within 3 h not ready / no cleaner; maintenance newly > 3 days; arrears newly > 30 days above RM 1,000', () => {
  const a = P.computeAlerts(inputs());
  assert.deepEqual(a.map(x => x.key), ['checkin:t1', 'checkin:t2', 'maintenance:m1', 'arrears:res:r1', 'arrears:si:si1']);
  assert.match(a[0].detail, /unit dirty/);
  assert.match(a[1].detail, /no cleaner assigned/);
  assert.equal(a[0].link, `${O}/operations/cleaning?task=t1`);
  assert.equal(a[2].link, `${O}/operations/maintenance?id=m1`);
  assert.match(a[3].title, /RM 1,500\.00/);
  assert.equal(a[3].link, `${O}/reservations/bookings?view=all&open=r1`);
});

test('computeAlerts: older exceptions without minutesLeft still work from "Due in N min" and the detail', () => {
  const a = P.computeAlerts(inputs({ maintenance: null, guestsOwing: null, invoices: null, exceptions: { exceptions: [
    { id: 'risk-t9', slaLabel: 'Due in 45 min', detail: 'Tower C 2-2 is dirty with no cleaner assigned. Guest arrives 14:00.', action: { taskId: 't9' } },
  ] } }));
  assert.deepEqual(a.map(x => x.key), ['checkin:t9']);
});

test('computeAlerts RBAC: no Finance access = no arrears alert at all, even if the reads came back', () => {
  const a = P.computeAlerts(inputs({ canSeeFinance: false }));
  assert.ok(!a.some(x => x.kind === 'arrears'), JSON.stringify(a.map(x => x.key)));
});

test('computeAlerts RBAC: an amount the ERP hid from the person never passes the threshold', () => {
  const a = P.computeAlerts(inputs({
    guestsOwing: { rows: [{ id: 'r1', checkIn: '2026-10-27' }] }, // outstanding removed
    invoices: { data: [{ id: 'si1', status: 'SENT', dueDate: '2026-10-26', outstandingSen: null }] },
  }));
  assert.ok(!a.some(x => x.kind === 'arrears'));
});

test('computeAlerts: a list the person cannot read (null) yields nothing', () => {
  assert.deepEqual(P.computeAlerts({ today: TODAY, origin: O, canSeeFinance: true, exceptions: null, maintenance: null, guestsOwing: null, invoices: null }), []);
});

/* ---------- debounce ---------- */

test('debounce: a key sent today is never resent; newly overdue / arrears once in their window; duplicates collapse', () => {
  const a = P.computeAlerts(inputs());
  assert.equal(P.alertsToSend(a, new Map(), TODAY).length, a.length);
  assert.deepEqual(P.alertsToSend(a, new Map(a.map(x => [x.key, TODAY])), TODAY), [], 'all sent today -> none');
  const y = new Map(a.map(x => [x.key, P.plusDays(TODAY, -1)]));
  assert.deepEqual(P.alertsToSend(a, y, TODAY).map(x => x.key), ['checkin:t1', 'checkin:t2'], 'yesterday: a check-in may alert again (a new day), maintenance / arrears not');
  const two = new Map(a.map(x => [x.key, P.plusDays(TODAY, -2)]));
  assert.equal(P.alertsToSend(a, two, TODAY).length, a.length, 'outside the window (2 days) a key may send again');
  assert.equal(P.alertsToSend([a[0], a[0]], new Map(), TODAY).length, 1);
  assert.equal(P.debounceSince(TODAY), P.plusDays(TODAY, -P.PROACTIVE_CONFIG.alerts.newlyWindowDays));
});

test('debounce over two days: a maintenance job alerted on day 4 is not alerted again on day 5', () => {
  const job = { maintenance: { issues: [{ id: 'm1', title: 'x', state: 'open', dueOn: '2026-11-23' }] }, exceptions: null, guestsOwing: null, invoices: null };
  const day1 = P.computeAlerts(inputs({ ...job, today: '2026-11-27' }));
  assert.equal(day1.length, 1);
  const day2 = P.computeAlerts(inputs({ ...job, today: '2026-11-28' }));
  assert.equal(day2.length, 1, 'still inside the newly window');
  assert.deepEqual(P.alertsToSend(day2, new Map([['maintenance:m1', '2026-11-27']]), '2026-11-28'), []);
  assert.equal(P.computeAlerts(inputs({ ...job, today: '2026-11-29' })).length, 0, 'day 6: past the window, never again');
});

/* ---------- the HTML builder ---------- */

const brief = {
  date: TODAY, for: 'Lim Ah Kow',
  sections: [
    { section: 'My jobs overdue or due in 3 days', count: 7, top: [1, 2, 3, 4, 5].map(i => ({ title: `Clean <${i}>`, detail: 'Tower A 12-3 · open', due: `${i} days late`, link: `${O}/operations/tasks` })) },
    { section: 'Mail Center: emails waiting for your reply', count: 2, top: [{ title: 'Quote?', detail: 'from x', link: `${O}/mail` }, { title: 'Evil', link: 'javascript:alert(1)' }] },
  ],
  noAccess: 'Your account does not have access to: Purchase orders. Those are left out.',
};

test('buildBriefEmail: sections with counts, top 5 linked, "and N more", escaped, unsubscribe + settings links', () => {
  const m = P.buildBriefEmail({ brief, name: 'Lim Ah Kow', date: TODAY, settingsUrl: `${O}/system/ai-connector`, unsubscribeUrl: `${O}/api/mcp/proactive/unsubscribe?t=abc` });
  assert.equal(m.subject, 'Your Conts morning brief: 9 items · 2026-11-27');
  assert.equal(m.items, 9);
  assert.match(m.html, /Good morning, Lim\./);
  assert.match(m.html, /My jobs overdue or due in 3 days/);
  assert.match(m.html, /href="https:\/\/erp\.example\/operations\/tasks"/);
  assert.match(m.html, /\.\.\.and 2 more\./);
  assert.match(m.html, /Clean &lt;1&gt;/);
  assert.ok(!m.html.includes('<1>'), 'escaped');
  assert.ok(!m.html.includes('javascript:'), 'non-http links are never rendered');
  assert.match(m.html, /Purchase orders\. Those are left out\./);
  assert.match(m.html, /href="https:\/\/erp\.example\/api\/mcp\/proactive\/unsubscribe\?t=abc"[^>]*>Unsubscribe<\/a>/);
  assert.match(m.html, /system\/ai-connector/);
  assert.ok(!/Data gaps to fill/.test(m.html), 'no gaps section unless given');
  assert.match(m.text, /My jobs overdue or due in 3 days: 7/);
  assert.match(m.text, /Unsubscribe: https:\/\/erp\.example/);
});

test('buildBriefEmail: data gaps section (Monday / test), [Test] in the subject, an empty brief says so', () => {
  const gaps = { gaps: [{ gap: 'Units without an owner', count: 6, examples: ['Tower A 1-1', 'Tower A 1-2', 'a', 'b', 'c', 'd'], link: `${O}/properties/units` }, { gap: 'Nothing here', count: 0, examples: [] }] };
  const m = P.buildBriefEmail({ brief, gaps, name: '', date: TODAY, settingsUrl: `${O}/s`, unsubscribeUrl: `${O}/u`, test: true });
  assert.match(m.subject, /^\[Test\] /);
  assert.match(m.html, /Data gaps to fill/);
  assert.match(m.html, /Units without an owner/);
  assert.ok(!m.html.includes('Nothing here'), 'a gap with nothing missing is left out');
  assert.match(m.html, /\.\.\.and 1 more\./);
  assert.match(m.html, /Good morning, there\./);
  const e = P.buildBriefEmail({ brief: { sections: [] }, name: 'A', date: TODAY, settingsUrl: '', unsubscribeUrl: '' });
  assert.match(e.subject, /0 items/);
  assert.match(e.html, /nothing needs a look today/);
});

test('buildAlertEmail: grouped by kind, capped lines with "and N more", escaped', () => {
  const alerts = Array.from({ length: 12 }, (_, i) => ({ key: `maintenance:${i}`, kind: 'maintenance', title: `Job ${i}`, detail: '<b>x</b>', link: `${O}/operations/maintenance?id=${i}` }));
  const m = P.buildAlertEmail({ alerts, date: TODAY, settingsUrl: `${O}/s`, unsubscribeUrl: `${O}/u` });
  assert.equal(m.subject, 'Conts alert: 12 new items need attention');
  assert.match(m.html, /Maintenance newly overdue/);
  assert.equal((m.html.match(/<li /g) || []).length, P.PROACTIVE_CONFIG.alerts.maxLinesPerEmail);
  assert.match(m.html, /\.\.\.and 2 more\./);
  assert.ok(!m.html.includes('<b>x</b>'));
  assert.match(m.html, />Unsubscribe</);
  assert.equal(P.escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('thresholds: one config, shown read-only in words (RM, not sen); money thresholds are integer sen', () => {
  const t = P.thresholdsForDisplay();
  assert.ok(t.some(r => /RM 1,000\.00/.test(r.value)));
  assert.ok(Number.isInteger(P.PROACTIVE_CONFIG.alerts.arrearsMinSen));
});

/* ---------- wiring: as the person, bounded, idempotent, logged without the body ---------- */

test('run: brief = daily_brief (+ data_gaps) via runToolAs on the person\'s own token, revoked in finally; alerts via readAsPerson', () => {
  const r = read('functions/_lib/mcpProactiveRun.ts');
  assert.match(r, /runToolAs\(c\.request, c\.env, c\.waitUntil, id, token, 'daily_brief', \{\}\)/);
  assert.match(r, /runToolAs\(c\.request, c\.env, c\.waitUntil, id, token, 'data_gaps', \{\}\)/);
  assert.match(r, /issueTokens\(c\.env, userId, BRIEF_CLIENT_ID, TOKEN_TTL_MS\)/);
  assert.match(r, /resolveAccessToken\(c\.env, tok\.accessToken\)/, 'the token is checked like any AI app\'s (approved, active, desk)');
  assert.match(r, /finally \{\s*await revokeToken\(c\.env, tok\.tokenId, null\)/);
  assert.match(r, /readAsPerson\(c\.request, c\.env, c\.waitUntil, token, path, q\)/);
  assert.match(r, /level\('finance'\)\) !== 'none'/, 'arrears only for Finance access');
  assert.match(r, /finance \? read\('\/api\/sales-invoices'\)/);
  assert.match(r, /claimKeys\(c\.env, s\.userId, \['brief'\], now\.day\)/, 'brief claimed before it is built');
  assert.match(r, /claimKeys\(c\.env, s\.userId, fresh\.map/, 'alert keys claimed before sending');
  assert.match(r, /notify\(env, \{/, 'the ERP\'s existing outbox');
  assert.ok(!/fetch\(\s*['"`]https?:/.test(r), 'no direct mail-provider call');
  for (const l of r.match(/logSend\([^;]+;/g) || []) assert.ok(!/html|text:|subject/.test(l), l);
  const srv = read('functions/_lib/mcpServer.ts');
  assert.match(srv, /export function runToolAs[\s\S]{0,200}return callTool\(request, env, waitUntil, id, token, name, args\)/);
  assert.match(srv, /export async function readAsPerson[\s\S]{0,200}readValue\(request, env, waitUntil, token, path, query\)/);
});

test('store: the brief claim is per person per day; the send log has no body or subject column; only allowed accounts', () => {
  const sql = read('migrations-pg/0397_mcp_brief_alerts.sql');
  assert.match(sql, /PRIMARY KEY \(user_id, alert_key, day\)/);
  const sends = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS mcp_proactive_sends'), sql.indexOf('mcp_proactive_sends_user_idx'));
  assert.ok(!/body|html|subject/.test(sends), 'the send log never stores the email');
  assert.ok(!/DROP (TABLE|COLUMN)|DELETE FROM|UPDATE \w+ SET|ALTER COLUMN/i.test(sql.replace(/^--.*$/gm, '')), 'additive only');
  const s = read('functions/_lib/mcpProactiveStore.ts');
  assert.match(s, /ON CONFLICT \(user_id, alert_key, day\) DO NOTHING RETURNING alert_key/);
  assert.match(s, /u\.is_active = 1/);
  assert.match(s, /u\.role = 'management' OR EXISTS \(SELECT 1 FROM mcp_access a WHERE a\.user_id = u\.id\)/);
});

test('tick: knocked every 15 minutes by the cron worker with the IT Hub key; public route checks the key itself', () => {
  const cron = read('functions/_lib/cronJobs.ts');
  assert.match(cron, /\[CRON\.quarterHour\]: \[[^\]]*aiBriefTick/);
  assert.match(cron, /\/api\/mcp\/proactive\/tick/);
  const t = read('functions/api/mcp/proactive/tick.ts');
  assert.match(t, /timingSafeEqualStr\(given, key\)/);
  const mw = read('functions/api/_middleware.ts');
  assert.match(mw, /'POST \/api\/mcp\/proactive\/tick'/);
  assert.ok(read('functions/_lib/mcpAccess.ts').includes("'/api/mcp', // the connector itself"), 'an AI app can never read the tick or the brief routes');
});

test('unsubscribe: GET only shows a button (link scanners), POST with the token does it', () => {
  const r = read('functions/api/mcp/proactive/unsubscribe.ts');
  const get = r.slice(r.indexOf('export const onRequestGet'), r.indexOf('export const onRequestPost'));
  assert.ok(!/unsubscribeWithToken/.test(get), 'GET never unsubscribes');
  assert.match(get, /<form method="post"/);
  assert.match(r.slice(r.indexOf('export const onRequestPost')), /unsubscribeWithToken\(env, t\)/);
});

test('settings: own row only; test brief to the own address only, rate-limited; the rate limit ignores the brief client', () => {
  const b = read('functions/api/ai-connector/brief.ts');
  assert.match(b, /parseSubscriptionInput\(await request\.json\(\)\.catch\(\(\) => null\), person\.session\.userId\)/);
  const t = read('functions/api/ai-connector/brief/test.ts');
  assert.match(t, /to: person\.email/);
  assert.match(t, /TEST_GAP_MS = 10 \* 60_000/);
  assert.match(t, /429/);
  assert.match(read('functions/_lib/mcpMore.ts'), /client_id IS DISTINCT FROM '\$\{BRIEF_CLIENT_ID\}'/);
  assert.match(read('src/pages/AiConnectorPage.tsx'), /<AiBriefSettings/);
});
