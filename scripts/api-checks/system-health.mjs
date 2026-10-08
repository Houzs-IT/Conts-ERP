// System health: the live payload is measured on the request (database, storage, counts, one card per
// integration), the audit feed follows its range and "sensitive only" switch, and only management,
// finance and operations managers can see either. Read-only.
import { call, callAsUser, check, done } from './harness.mjs';

const staff = { userId: '11111111-1111-4111-8111-000000000004', email: 'weiwen@theconts.com', role: 'operations_staff' };
for (const path of ['/api/system/health', '/api/system/health/audit-feed']) {
  let r = await call('GET', path, undefined, 'housekeeper');
  check(`housekeeper refused on ${path} (403)`, r.status === 403, r.text);
  r = await callAsUser(staff, 'GET', path);
  check(`operations staff refused on ${path} (403)`, r.status === 403, r.text);
}

let r = await call('GET', '/api/system/health');
const h = r.json ?? {};
check('database pinged, with a time', r.status === 200 && h.db?.ok === true && Number.isInteger(h.db.latency_ms), r.text.slice(0, 200));
check('storage reported', typeof h.r2?.bound === 'boolean', JSON.stringify(h.r2));
const isCount = n => Number.isInteger(n) && n >= 0;
check('user and audit counts are whole numbers', ['users_active', 'users_invited', 'users_disabled', 'users_locked', 'audit_24h', 'audit_7d', 'sensitive_24h'].every(k => isCount(h.counts?.[k])), JSON.stringify(h.counts));
check('24h audit count is within the 7d count', h.counts.audit_24h <= h.counts.audit_7d && h.counts.sensitive_24h <= h.counts.audit_24h, JSON.stringify(h.counts));
const KEYS = ['email', 'channex', 'bookings', 'queue', 'jobs', 'problems'];
check('one card per integration', KEYS.every(k => h.checks?.some(c => c.key === k)), JSON.stringify(h.checks?.map(c => c.key)));
check('every card has a value, status and plain summary', (h.checks ?? []).every(c => ['ok', 'warning', 'critical', 'off'].includes(c.status) && c.label && c.value && c.summary && !/undefined|null|NaN/.test(c.value + c.summary + (c.detail ?? ''))), JSON.stringify(h.checks));
check('ok is false whenever a card is critical', h.ok === !(h.checks ?? []).some(c => c.status === 'critical'), `${h.ok}`);
check('problems are newest first', Array.isArray(h.problems) && h.problems.every((p, i) => p.what && (i === 0 || h.problems[i - 1].at >= p.at)), JSON.stringify(h.problems?.slice(0, 2)));
console.log(`   db ${h.db?.latency_ms} ms · storage ${JSON.stringify(h.r2)} · ${JSON.stringify(h.counts)}`);
for (const c of h.checks ?? []) console.log(`   ${c.status.padEnd(8)} ${c.label}: ${c.value} | ${c.summary}${c.detail ? ' | ' + c.detail : ''}`);

r = await call('GET', '/api/system/health/audit-feed?range=7d');
const week = r.json ?? {};
check('audit feed lists events newest first', r.status === 200 && week.data?.length > 0 && week.data.every((e, i) => i === 0 || week.data[i - 1].created_at >= e.created_at), r.text.slice(0, 200));
check('audit feed counts by action and by resource', week.summary?.byAction?.length > 0 && week.summary?.byResource?.length > 0 && week.summary.byAction.every(a => a.action && a.n > 0), JSON.stringify(week.summary));
const day = (await call('GET', '/api/system/health/audit-feed?range=24h')).json;
const cutoff = new Date(Date.now() - 864e5).toISOString();
check('24h range only holds the last 24 hours', (day?.data ?? []).every(e => e.created_at >= cutoff), day?.data?.at(-1)?.created_at);
const sens = (await call('GET', '/api/system/health/audit-feed?range=90d&sensitive=1')).json;
check('sensitive only keeps accounts, settings, payouts, deletions and failures', (sens?.data ?? []).every(e => /^(user|account|settings|payout|data)\.|\.delete$|fail/.test(e.action)), JSON.stringify([...new Set((sens?.data ?? []).map(e => e.action))]));
check('each event carries its before/after detail and the range total', week.total >= week.data.length && week.data.every(e => 'before' in e && 'after' in e) && week.data.some(e => e.after && typeof e.after === 'object'), JSON.stringify(week.data?.[0]));
const two = (await call('GET', '/api/system/health/audit-feed?range=90d&limit=2')).json;
check('limit caps the rows but not the total', two?.data?.length === 2 && two.total > 2, `${two?.data?.length} of ${two?.total}`);
r = await call('GET', '/api/system/health/audit-feed?range=1y');
check('unknown range refused (422)', r.status === 422, r.text);
r = await call('GET', '/api/system/health', undefined, 'finance_admin');
check('finance can see it', r.status === 200, r.text.slice(0, 200));

done();
