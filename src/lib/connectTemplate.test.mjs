// node --test src/lib/connectTemplate.test.mjs. The pure Houzs Connect push helpers in
// functions/_lib/connectFields.ts: the kind→field mapping, attribute assembly, response handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const {
  CONNECT_COMPANY_SLUG, CONNECT_FIELD_KEYS, buildConnectAttributes, singleLine, formatConnectDate,
  maskSecret, connectAutomations, connectDeliveryOutcome,
} = await import('../../functions/_lib/connectFields.ts');

const RES = { name: 'Tan Wei Jia', phone: '60123456789', unit_no: 'The Conts A-12-03', check_in: '2026-11-20', check_out: '2026-11-23' };
const CREDS = [
  { kind: 'wifi', label: 'TheConts-A12', secret: 'theconts2024' },
  { kind: 'mailbox_pin', label: '17', secret: '4821' },
  { kind: 'main_door_key', label: 'Front door', secret: '1 2 3 4 #' },
  { kind: 'lift_card', label: 'Lift', secret: '*7788' },
];

test('the company slug is the hyphenated one (never change)', () => {
  assert.equal(CONNECT_COMPANY_SLUG, 'the-conts');
});

test('assembles every field from a full reservation + credentials', () => {
  const { name, phone, attributes, missing } = buildConnectAttributes(RES, CREDS);
  assert.equal(name, 'Tan Wei Jia');
  assert.equal(phone, '60123456789');
  assert.deepEqual(attributes, {
    unit_no: 'The Conts A-12-03',
    checkin_date: '2026/11/20',
    checkout_date: '2026/11/23',
    wifi: 'theconts2024',
    wifi_username: 'TheConts-A12',
    mailbox_passcode: '4821',
    mailbox_no: '17',
    maindoor: '1 2 3 4 #',
    maindoor2: '*7788',
  });
  // mailbox (from a mailbox_key label) has no source here, so it is left out and listed as missing.
  assert.deepEqual(missing, ['mailbox']);
});

test('mask hides only the secret-sourced fields', () => {
  const { attributes } = buildConnectAttributes(RES, CREDS, { mask: true });
  // Sensitive (from .secret) → bullets.
  for (const k of ['wifi', 'mailbox_passcode', 'maindoor', 'maindoor2']) {
    assert.match(attributes[k], /^•+$/, `${k} should be masked`);
  }
  // Not sensitive → clear.
  assert.equal(attributes.wifi_username, 'TheConts-A12');
  assert.equal(attributes.mailbox_no, '17');
  assert.equal(attributes.unit_no, 'The Conts A-12-03');
  assert.equal(attributes.checkin_date, '2026/11/20');
});

test('collapses whitespace to a single line', () => {
  const { attributes, name } = buildConnectAttributes(
    { ...RES, name: 'Tan\tWei  Jia' },
    [{ kind: 'main_door_key', label: 'Door', secret: '1 2 3\n4 #' }],
  );
  assert.equal(name, 'Tan Wei Jia');
  assert.equal(attributes.maindoor, '1 2 3 4 #');
  assert.ok(!/[\n\t]/.test(attributes.maindoor));
});

test('includes only keys that have a real value', () => {
  const { attributes, missing } = buildConnectAttributes(RES, []);
  assert.deepEqual(Object.keys(attributes).sort(), ['checkin_date', 'checkout_date', 'unit_no']);
  // Every credential-derived key is missing with no credentials.
  for (const k of ['wifi', 'wifi_username', 'maindoor', 'maindoor2', 'mailbox', 'mailbox_no', 'mailbox_passcode']) {
    assert.ok(missing.includes(k), `${k} should be missing`);
  }
});

test('first matching credential wins per key', () => {
  const creds = [
    { kind: 'smartlock_pin', label: 'Lock', secret: 'FIRST' },
    { kind: 'room_key', label: 'Room', secret: 'SECOND' },
  ];
  assert.equal(buildConnectAttributes(RES, creds).attributes.maindoor, 'FIRST');
});

test('formatConnectDate: ISO date → YYYY/MM/DD, otherwise single-lined', () => {
  assert.equal(formatConnectDate('2026-11-20'), '2026/11/20');
  assert.equal(formatConnectDate('2026-11-20T15:00:00Z'), '2026/11/20');
  assert.equal(formatConnectDate(''), '');
  assert.equal(formatConnectDate('tomorrow  '), 'tomorrow');
});

test('singleLine and maskSecret basics', () => {
  assert.equal(singleLine('  a \n b\t c '), 'a b c');
  assert.equal(singleLine(null), '');
  assert.match(maskSecret('4821'), /^•+$/);
  assert.ok(maskSecret('x').length >= 2);
  assert.ok(maskSecret('x'.repeat(50)).length <= 8);
});

test('connectAutomations parses JSON, CSV, trims and dedupes', () => {
  assert.deepEqual(connectAutomations('["A","B"]'), ['A', 'B']);
  assert.deepEqual(connectAutomations('A, B , A'), ['A', 'B']);
  assert.deepEqual(connectAutomations(''), []);
  assert.deepEqual(connectAutomations(undefined), []);
  assert.deepEqual(connectAutomations('  '), []);
});

test('field key list is exactly the ten Connect keys', () => {
  assert.deepEqual([...CONNECT_FIELD_KEYS], [
    'unit_no', 'mailbox', 'mailbox_no', 'mailbox_passcode',
    'maindoor', 'maindoor2', 'wifi', 'wifi_username', 'checkin_date', 'checkout_date',
  ]);
});

test('connectDeliveryOutcome: 200 with triggered[] is a FAILED send', () => {
  assert.deepEqual(connectDeliveryOutcome({ ok: true, status: 200, body: { ok: true, triggered: [] }, triggered: [] }, 'Check-in').state, 'failed');
  assert.equal(connectDeliveryOutcome({ ok: true, status: 200, body: {}, triggered: ['Check-in'] }, 'Check-in').state, 'sent');
});

test('connectDeliveryOutcome: transport and config errors are failures', () => {
  assert.equal(connectDeliveryOutcome({ ok: false, status: null, body: null, triggered: [], error: 'boom' }, 'X').state, 'failed');
  assert.match(connectDeliveryOutcome({ ok: false, status: 401, body: null, triggered: [] }, 'X').reason, /not set up/i);
  assert.match(connectDeliveryOutcome({ ok: false, status: 503, body: null, triggered: [] }, 'X').reason, /not set up/i);
  assert.equal(connectDeliveryOutcome({ ok: false, status: 400, body: { error: 'missing phone' }, triggered: [] }, 'X').reason, 'missing phone');
});
