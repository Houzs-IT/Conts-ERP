// node --test src/lib/meetingMail.test.mjs. Meeting emails go out through Conts's own mail
// (functions/_lib/meetingMail.ts): collect from the IT Hub with Conts's key, send each one with MAIL_API_KEY,
// report each result. The hub and Resend are faked; what matters is what leaves the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { collectAndSend, sendMeetingMail, mailSoon } = await import('../../functions/_lib/meetingMail.ts');

const MAIL = { id: 7, from: 'The Conts Meetings <hello@theconts.com>', to: ['ana@example.com'], subject: 'Invitation: Weekly', html: '<table></table>', text: 'Weekly' };
function fake(t, answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const h = new Headers(init.headers);
    calls.push({ url: String(url), auth: h.get('Authorization'), reporter: h.get('X-Reporter-Id'), body: init.body ? JSON.parse(String(init.body)) : null });
    return answer(String(url), init);
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const hub = (mail, claimStatus = 200) => (url) => url.endsWith('/mail/claim') ? json({ mail }, claimStatus) : json({ ok: true, updated: 1 });
const ENV = { IT_HUB_URL: 'https://hub.example/', IT_HUB_API_KEY: 'hub_conts_key', MAIL_API_KEY: 're_test' };

test('collects with the hub key, sends each, and reports sent', async (t) => {
  const calls = fake(t, hub([MAIL]));
  const r = await collectAndSend('https://hub.example', 'hub_conts_key', async () => null);
  assert.deepEqual(r, { sent: 1, failed: 0 });
  assert.deepEqual(calls.map(c => c.url), ['https://hub.example/api/v1/sys/meetings/mail/claim', 'https://hub.example/api/v1/sys/meetings/mail/results']);
  assert.equal(calls[0].auth, 'Bearer hub_conts_key');
  assert.equal(calls[0].reporter, 'mail');
  assert.deepEqual(calls[1].body, { results: [{ id: 7, error: null }] });
});

test('a send that fails or throws is reported with its reason, and the rest still go', async (t) => {
  const calls = fake(t, hub([MAIL, { ...MAIL, id: 8 }, { ...MAIL, id: 9 }]));
  const r = await collectAndSend('https://hub.example', 'k', async (m) => {
    if (m.id === 7) return 'Resend answered 403: domain not verified';
    if (m.id === 8) throw new Error('timeout');
    return null;
  });
  assert.deepEqual(r, { sent: 1, failed: 2 });
  assert.deepEqual(calls[1].body.results, [{ id: 7, error: 'Resend answered 403: domain not verified' }, { id: 8, error: 'timeout' }, { id: 9, error: null }]);
});

test('the hub refusing the claim is an error, not a silent zero', async (t) => {
  fake(t, hub([], 401));
  await assert.rejects(collectAndSend('https://hub.example', 'k', async () => null), /401/);
});

test("sends html and text with Conts's mail key, from the address the hub chose", async (t) => {
  const calls = fake(t, (url) => url.includes('resend.com') ? json({ id: 'r1' }) : hub([MAIL])(url));
  assert.deepEqual(await sendMeetingMail(ENV), { sent: 1, failed: 0 });
  const r = calls.find(c => c.url === 'https://api.resend.com/emails');
  assert.deepEqual(r.body, { from: MAIL.from, to: MAIL.to, subject: MAIL.subject, html: MAIL.html, text: MAIL.text });
});

test('no mail key: reported as the reason, not sent; not connected: nothing asked', async (t) => {
  const calls = fake(t, hub([MAIL]));
  assert.deepEqual(await sendMeetingMail({ ...ENV, MAIL_API_KEY: '' }), { sent: 0, failed: 1 });
  assert.match(calls[1].body.results[0].error, /MAIL_API_KEY/);
  const none = fake(t, hub([MAIL]));
  assert.deepEqual(await sendMeetingMail({ MAIL_API_KEY: 're_test' }), { sent: 0, failed: 0 });
  assert.equal(none.length, 0);
});

test('mailSoon hands the run to waitUntil and never throws', async (t) => {
  fake(t, () => { throw new Error('down'); });
  const held = [];
  mailSoon(ENV, (p) => held.push(p));
  assert.equal(held.length, 1);
  await held[0];
});

test('the unread badge sends at most once a minute', async (t) => {
  fake(t, hub([]));
  const { mailFromBadge } = await import('../../functions/_lib/meetingMail.ts');
  const held = [];
  mailFromBadge(ENV, (p) => held.push(p), 1_000_000);
  mailFromBadge(ENV, (p) => held.push(p), 1_030_000);
  mailFromBadge(ENV, (p) => held.push(p), 1_061_000);
  assert.equal(held.length, 2);
  await Promise.all(held);
});
