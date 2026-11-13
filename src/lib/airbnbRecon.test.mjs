// node --test src/lib/airbnbRecon.test.mjs. Airbnb reconciliation: reading Airbnb's CSV and sorting each booking by
// rule (chew's spec, 10 Nov 2026, section 8: real October 2026 bookings, with chew's answers the same day).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAirbnbRows, usDate, senOf } from '../../functions/_lib/airbnbCsv.ts';
import { classify, reconcileMonth } from '../../functions/_lib/airbnbRecon.ts';

const ctx = { month: '2026-10', today: '2026-11-10' };
let n = 0;
/** One Airbnb line; amounts in RM as in the CSV. */
const tx = (type, code, amount, o = {}) => ({
  id: `t${++n}`, txnDate: o.date ?? '2026-10-10', type, code, startDate: o.start ?? '2026-10-10', endDate: o.end ?? '2026-10-13',
  nights: o.nights ?? 3, guest: 'Guest', listing: 'Listing', details: o.details ?? null, amount: Math.round(amount * 100), paidOut: 0,
});
const res = (code, amount, o) => tx('Reservation', code, amount, o);
const resolution = (code, amount, o) => tx('Resolution Payout', code, amount, { details: 'Resolution payout for resolution CLA-X', ...o });
const aircover = (code, amount, o) => tx('Resolution Payout', code, amount, { details: 'AirCover damage reimbursement for resolution CLSF-1', ...o });
const stay = (code, net, o = {}) => ({
  id: `r-${code}-${o.unit ?? 1}`, code, unitId: `u${o.unit ?? 1}`, unit: `D-49-0${o.unit ?? 1}`, guest: 'Guest',
  checkIn: o.checkIn ?? '2026-10-10', checkOut: o.checkOut ?? '2026-10-13', state: o.state ?? 'checked_out', net: Math.round(net * 100),
});

test('reads Airbnb dates (month/day/year) and amounts into sen', () => {
  assert.equal(usDate('10/04/2026'), '2026-10-04');
  assert.equal(usDate('1/9/2026'), '2026-01-09');
  assert.equal(usDate(''), null);
  assert.equal(usDate('2026-10-04'), undefined);
  assert.equal(senOf('1,477.60'), 147760);
  assert.equal(senOf('-42.09'), -4209);
  assert.equal(senOf(''), null);
  assert.equal(senOf('abc'), undefined);
});

const HEAD = ['Date', 'Arriving by date', 'Type', 'Confirmation code', 'Booking date', 'Start date', 'End date', 'Nights', 'Guest', 'Listing',
  'Details', 'Reference code', 'Currency', 'Amount', 'Paid out', 'Service fee', 'Fast pay fee', 'Cleaning fee', 'Gross earnings', 'Airbnb remitted tax', 'Earnings year'];
const csvRow = cells => Object.fromEntries(HEAD.map((h, i) => [h, cells[i] ?? '']));
const RES = csvRow(['10/29/2026', '', 'Reservation', 'HMQB5SZBM5', '10/03/2026', '10/28/2026', '11/01/2026', '4', 'Mimi Chai', 'Mori Minimal Stay', '', '', 'MYR', '386.66', '', '77.74', '', '99.00', '464.40', '0.00', '2026']);
const PAYOUT = csvRow(['10/30/2026', '11/02/2026', 'Payout', '', '', '', '', '', '', '', 'Transfer to 1234', '', 'MYR', '', '4,512.30']);

test('a CSV line becomes one transaction with a key that finds it again', () => {
  const { txns, errors } = readAirbnbRows([RES, PAYOUT]);
  assert.deepEqual(errors, []);
  assert.equal(txns.length, 2);
  assert.equal(txns[0].code, 'HMQB5SZBM5');
  assert.equal(txns[0].amount, 38666);
  assert.equal(txns[0].startDate, '2026-10-28');
  assert.equal(txns[0].nights, 4);
  assert.equal(txns[1].type, 'Payout');
  assert.equal(txns[1].paidOut, 451230);
  assert.equal(txns[1].arrivingBy, '2026-11-02');
  // The same file again gives the same keys, so nothing is recorded twice (chew: "duplicate 的不要录到两次").
  assert.deepEqual(readAirbnbRows([RES, PAYOUT]).txns.map(t => t.dedupeKey), txns.map(t => t.dedupeKey));
});

test('two identical lines in one file are both kept, and found again on a second upload', () => {
  const once = readAirbnbRows([RES, RES]).txns.map(t => t.dedupeKey);
  assert.equal(new Set(once).size, 2);
  assert.deepEqual(readAirbnbRows([RES, RES]).txns.map(t => t.dedupeKey), once);
  assert.ok(once.includes(readAirbnbRows([RES]).txns[0].dedupeKey), 'the first is the same key as in a file that has it once');
});

test('a file without Airbnb columns is refused, and a bad line is named', () => {
  const wrong = readAirbnbRows([{ Reference: 'HMQB5SZBM5', 'Guest total (RM)': '464.40' }]);
  assert.equal(wrong.txns.length, 0);
  assert.match(wrong.errors[0].message, /not an Airbnb transaction file/);
  const bad = readAirbnbRows([RES, { ...RES, Amount: 'abc', _row: 3 }]);
  assert.deepEqual(bad.errors, [{ line: 3, message: 'An amount or a date cannot be read.' }]);
  assert.equal(readAirbnbRows([RES, csvRow([])]).txns.length, 1, 'a blank line is skipped');
});

// chew's spec section 8, with the system amounts of the spec's export.
test('R1 equal: HMQB5SZBM5', () => {
  const l = classify('HMQB5SZBM5', [res('HMQB5SZBM5', 386.66)], [stay('HMQB5SZBM5', 386.66)], ctx);
  assert.equal(l.rule, 'R1');
  assert.equal(l.action, 'none');
  assert.equal(l.needsConfirm, false);
  assert.equal(l.difference, 0);
});

test('R2 extra charge inside the booking is split out: HMMKXRNCPY', () => {
  const l = classify('HMMKXRNCPY', [res('HMMKXRNCPY', 715.19), resolution('HMMKXRNCPY', 250.01), aircover('HMMKXRNCPY', 9.99)], [stay('HMMKXRNCPY', 965.20)], ctx);
  assert.equal(l.rule, 'R2');
  assert.equal(l.action, 'set_amount');
  assert.equal(l.newAmount, 71519, 'the booking keeps the room (chew: 拆出来)');
  assert.deepEqual(l.income.map(i => [i.kind, i.amount]).sort(), [['additional_charge', 25001], ['aircover', 999]]);
  assert.equal(l.needsConfirm, true);
});

test('R3 cancelled and fully refunded: HM3NEJ9PW4', () => {
  const rows = () => [res('HM3NEJ9PW4', 1477.60), tx('Adjustment', 'HM3NEJ9PW4', -1477.60)];
  const missing = classify('HM3NEJ9PW4', rows(), [], ctx);
  assert.equal(missing.rule, 'R3');
  assert.equal(missing.action, 'none');
  assert.equal(missing.needsConfirm, false);
  const cancelled = classify('HM3NEJ9PW4', rows(), [stay('HM3NEJ9PW4', 1477.60, { state: 'cancelled' })], ctx);
  assert.equal(cancelled.rule, 'R3');
  assert.equal(cancelled.action, 'none');
  const live = classify('HM3NEJ9PW4', rows(), [stay('HM3NEJ9PW4', 1477.60, { state: 'confirmed' })], ctx);
  assert.equal(live.rule, 'R3');
  assert.equal(live.action, 'cancel');
  assert.equal(live.newAmount, 0);
});

test('R4 recovered from Airbnb goes to the company: HMY8ZD3RBC', () => {
  const l = classify('HMY8ZD3RBC', [res('HMY8ZD3RBC', 3563.98), tx('Adjustment', 'HMY8ZD3RBC', -2794.50), resolution('HMY8ZD3RBC', 2794.50)], [stay('HMY8ZD3RBC', 1846.27)], ctx);
  assert.equal(l.rule, 'R4');
  assert.equal(l.newAmount, 76948, 'the owner’s booking is 769.48');
  assert.deepEqual(l.income.map(i => [i.kind, i.amount]), [['recovered', 279450]]);
});

test('R5 equal after the adjustment', () => {
  const l = classify('HMM39TAH2S', [res('HMM39TAH2S', 1178.54), tx('Adjustment', 'HMM39TAH2S', -995.01)], [stay('HMM39TAH2S', 183.53)], ctx);
  assert.equal(l.rule, 'R5');
  assert.equal(l.action, 'none');
  assert.equal(l.needsConfirm, true, 'the spec asks for a confirmation only');
});

test('a long stay paid in one go is compared whole (chew: Airbnb mostly pays at once): HMFA323EHS', () => {
  const o = { start: '2026-09-03', end: '2026-10-31', nights: 58 };
  const l = classify('HMFA323EHS', [res('HMFA323EHS', 6580.77, o), resolution('HMFA323EHS', 99.99, o), resolution('HMFA323EHS', 99.99, o)], [stay('HMFA323EHS', 6235.72)], ctx);
  assert.equal(l.rule, 'R8');
  assert.equal(l.newAmount, 658077);
  assert.deepEqual(l.income.map(i => i.amount), [9999, 9999]);
});

test('R6 only for a long stay Airbnb has really paid part of', () => {
  const o = { start: '2026-10-01', end: '2026-12-01', nights: 61 };
  const l = classify('HMLONG0001', [res('HMLONG0001', 3000, o)], [stay('HMLONG0001', 6000)], ctx);
  assert.equal(l.rule, 'R6');
  assert.equal(l.action, 'wait');
  assert.equal(l.needsConfirm, false);
  // Its next payment in a later file makes the whole booking equal.
  const later = classify('HMLONG0001', [res('HMLONG0001', 3000, o), res('HMLONG0001', 3000, { ...o, date: '2026-11-02' })], [stay('HMLONG0001', 6000)], { month: '2026-11', today: '2026-12-10' });
  assert.equal(later.rule, 'R1');
});

test('R7 extend paid in parts, likely: HMQFZYBTXQ', () => {
  const l = classify('HMQFZYBTXQ', [res('HMQFZYBTXQ', 237.71, { date: '2026-10-27' }), res('HMQFZYBTXQ', 59.95, { date: '2026-10-28' })], [stay('HMQFZYBTXQ', 237.71)], ctx);
  assert.equal(l.rule, 'R7');
  assert.equal(l.sure, 'likely');
  assert.equal(l.newAmount, 29766);
  assert.deepEqual(l.payments.map(p => [p.date, p.amount]), [['2026-10-27', 23771], ['2026-10-28', 5995]]);
});

test('R7 extended four times needs a closer look: HMWNQNS99R', () => {
  const rows = [['2026-10-04', 780.64], ['2026-10-06', 158.99], ['2026-10-11', 317.97], ['2026-10-13', 211.98]].map(([date, a]) => res('HMWNQNS99R', a, { date, nights: 13 }));
  const l = classify('HMWNQNS99R', rows, [stay('HMWNQNS99R', 939.63)], ctx);
  assert.equal(l.rule, 'R7');
  assert.equal(l.sure, 'look');
  assert.equal(l.newAmount, 146958);
});

test('R8 extended before check-in: HMCBH9QE4N', () => {
  const l = classify('HMCBH9QE4N', [res('HMCBH9QE4N', 789.72)], [stay('HMCBH9QE4N', 621.87, { state: 'confirmed' })], ctx);
  assert.equal(l.rule, 'R8');
  assert.equal(l.newAmount, 78972);
});

test('R9 not in the system, stay started last month: HM325S42HB', () => {
  const l = classify('HM325S42HB', [res('HM325S42HB', 161.45, { date: '2026-10-01', start: '2026-09-30', end: '2026-10-01', nights: 1 })], [], ctx);
  assert.equal(l.rule, 'R9');
  assert.equal(l.action, 'check');
});

test('R10 cancelled but paid is company income, confirmed one by one: HMJMHZBQPQ', () => {
  const rows = () => [res('HMJMHZBQPQ', 235.58, { date: '2026-10-19', start: '2026-10-18', end: '2026-10-20', nights: 2 })];
  const missing = classify('HMJMHZBQPQ', rows(), [], ctx);
  assert.equal(missing.rule, 'R10');
  assert.deepEqual(missing.income.map(i => [i.kind, i.amount]), [['cancelled_paid', 23558]]);
  assert.equal(missing.needsConfirm, true);
  const cancelled = classify('HMJMHZBQPQ', rows(), [stay('HMJMHZBQPQ', 235.58, { state: 'cancelled' })], ctx);
  assert.equal(cancelled.rule, 'R10');
  assert.deepEqual(cancelled.income.map(i => [i.kind, i.amount]), [['cancelled_paid', 23558]]);
});

test('R11 not in the system, stay not over: HM5MEMWNA5', () => {
  const l = classify('HM5MEMWNA5', [res('HM5MEMWNA5', 3994.36, { date: '2026-10-30', start: '2026-10-29', end: '2026-11-17', nights: 19 })], [], ctx);
  assert.equal(l.rule, 'R11');
});

test('R13 money for a stay paid before these files: AirCover is company income, a refund is looked at', () => {
  const o = { start: '2026-09-29', end: '2026-10-12', nights: 13 };
  const air = classify('HM2A82K49A', [aircover('HM2A82K49A', 159.49, o)], [stay('HM2A82K49A', 1200)], ctx);
  assert.equal(air.rule, 'R13');
  assert.deepEqual(air.income.map(i => [i.kind, i.amount]), [['aircover', 15949]]);
  assert.equal(air.needsConfirm, true);
  assert.equal(air.difference, null);
  const refund = classify('HMKNPJT5NK', [tx('Resolution Adjustment', 'HMKNPJT5NK', -289.74), tx('Resolution Adjustment', 'HMKNPJT5NK', -58.26)], [stay('HMKNPJT5NK', 800)], ctx);
  assert.equal(refund.rule, 'R13');
  assert.equal(refund.action, 'check');
  assert.match(refund.suggestion, /RM 348\.00/);
});

test('a refund to the guest after the system amount is named, not a mystery', () => {
  const l = classify('HMZFHHMB2D', [res('HMZFHHMB2D', 300.40), tx('Resolution Adjustment', 'HMZFHHMB2D', -42.09)], [stay('HMZFHHMB2D', 300.40)], ctx);
  assert.equal(l.rule, 'R99');
  assert.match(l.suggestion, /took back RM 42\.09/);
  assert.match(l.suggestion, /RM 258\.31/);
  assert.equal(l.difference, 4209, 'the difference is against what Airbnb kept, so the refund shows');
  assert.equal(l.newAmount, 25831, 'confirming may set the reservation to what Airbnb kept (chew: 每笔自己看)');
  const r5 = classify('HMM39TAH2S', [res('HMM39TAH2S', 1178.54), tx('Adjustment', 'HMM39TAH2S', -995.01)], [stay('HMM39TAH2S', 183.53)], ctx);
  assert.equal(r5.difference, 0, 'equal after the adjustment shows no difference');
});

test('a code over two units adds their nets', () => {
  const l = classify('HMTWO00001', [res('HMTWO00001', 500)], [stay('HMTWO00001', 250, { unit: 1 }), stay('HMTWO00001', 250, { unit: 2 })], ctx);
  assert.equal(l.rule, 'R1');
  assert.equal(l.systemNet, 50000);
});

test('the month: every code with a line in it, check-ins not paid yet, and the bank transfers', () => {
  const txns = [
    res('HMQB5SZBM5', 386.66, { date: '2026-10-29' }),
    aircover('HMOLD00001', 10, { date: '2026-10-25', start: '2026-09-01', end: '2026-09-04' }),
    res('HMOLD00001', 900, { date: '2026-09-02', start: '2026-09-01', end: '2026-09-04' }),
    aircover('HMOLD00002', 5, { date: '2026-10-26', start: '2026-08-01', end: '2026-08-04' }),
    { ...tx('Payout', null, 0, { date: '2026-10-30' }), paidOut: 40166 },
    res('HMPAIDSEP1', 100, { date: '2026-09-29' }),
  ];
  const stays = [
    stay('HMQB5SZBM5', 386.66, { checkIn: '2026-10-28' }),
    stay('HMOLD00001', 900, { checkIn: '2026-09-01' }),
    stay('HMOLD00002', 700, { checkIn: '2026-08-01' }),
    stay('HMNOTPAID1', 420, { checkIn: '2026-10-31', state: 'confirmed' }),
    stay('HMPAIDSEP1', 100, { checkIn: '2026-10-02' }),
    stay('HMCANCEL01', 300, { checkIn: '2026-10-05', state: 'cancelled' }),
  ];
  const m = reconcileMonth('2026-10', txns, stays, '2026-11-10');
  // HMOLD00001's September payment was uploaded too, so the booking is compared whole: equal, with October's AirCover
  // as company income. HMOLD00002 has no booking payment in any file.
  assert.deepEqual(m.lines.map(l => [l.code, l.rule]), [['HMOLD00001', 'R1'], ['HMQB5SZBM5', 'R1'], ['HMNOTPAID1', 'R12'], ['HMOLD00002', 'R13']]);
  const old = m.lines.find(l => l.code === 'HMOLD00001');
  assert.equal(old.payments[0].inMonth, false);
  assert.equal(old.needsConfirm, true, 'its AirCover money is to be recorded');
  assert.match(old.suggestion, /^Equal\. Nothing to do\. Also record RM 10\.00 as company income \(AirCover\)\.$/);
  assert.equal(m.totals.bank, 40166);
  assert.equal(m.totals.money, 40166, 'the transfers are made of the month’s coded lines');
  assert.equal(m.totals.income.aircover, 1500);
  assert.equal(m.totals.needsConfirm, 2);
  assert.equal(m.payouts.length, 1);
  assert.deepEqual(m.summary.map(s => [s.rule, s.count]), [['R1', 2], ['R12', 1], ['R13', 1]]);
});
