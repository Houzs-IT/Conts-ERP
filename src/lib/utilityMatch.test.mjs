// node --test src/lib/utilityMatch.test.mjs (npm test). Which unit a scanned utility bill page is for (spec
// 2026-10-27-utility-bills-design §5.3-5.4; plan 2026-11-02-utility-bill-scan Task 3). Green only on a decisive clue or two
// strong ones that no other account shares; a building or owner name alone is never green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchBill, accountNoMatches } from './utilityMatch.ts';

const read = (o = {}) => ({ kind: 'electricity', billMonth: '2026-10', currentChargesSen: 13118, accountNoVisible: null, accountNoFull: null, depositSen: null, buildingName: null, ownerName: null, meterPrevious: null, ...o });
const acct = (id, o = {}) => ({ accountId: id, unitId: `U-${id}`, kind: 'electricity', accountNo: null, depositSen: null, building: null, ownerName: null, lastMeterReading: null, ...o });
const A = acct('A', { accountNo: '210401094502', depositSen: 99838, building: 'Agile', ownerName: 'Tan Ah Kow' });
const B = acct('B', { accountNo: '210485439902', depositSen: 50000, building: 'Agile', ownerName: 'Tan Ah Kow' });

test('a masked number matches on the digits it shows, whatever the mask length', () => {
  assert.equal(accountNoMatches('2104010945XX02', '210401094502'), true);
  assert.equal(accountNoMatches('2104010945XX02', '210485439902'), false);
  assert.equal(accountNoMatches('21XX', '210401094502'), false, 'too few digits shown to count');
});
test('the full account number is decisive -> green', () => {
  const m = matchBill(read({ accountNoFull: '210401094502' }), [A, B], []);
  assert.equal(m.colour, 'green'); assert.equal(m.accountId, 'A');
});
test('the visible pattern and the deposit -> green', () => {
  const m = matchBill(read({ accountNoVisible: '2104010945XX02', depositSen: 99838 }), [A, B], []);
  assert.equal(m.colour, 'green'); assert.equal(m.accountId, 'A');
  assert.match(m.reasons.join(' '), /2104010945XX02/);
});
test('the visible pattern alone -> amber', () => {
  const m = matchBill(read({ accountNoVisible: '2104010945XX02' }), [A, B], []);
  assert.equal(m.colour, 'amber'); assert.equal(m.accountId, 'A');
});
test('building and owner name only -> amber, never green', () => {
  const m = matchBill(read({ buildingName: 'AGILE BUKIT BINTANG', ownerName: 'TAN AH KOW' }), [A], []);
  assert.equal(m.colour, 'amber');
});
test('one strong clue each on two accounts -> amber listing both', () => {
  const m = matchBill(read({ accountNoVisible: '2104010945XX02', depositSen: 50000 }), [A, B], []);
  assert.equal(m.colour, 'amber'); assert.equal(m.accountId, null);
  assert.deepEqual(m.candidates.map(c => c.accountId).sort(), ['A', 'B']);
});
test('two strong clues on one account but a strong clue on another too -> amber', () => {
  const m = matchBill(read({ accountNoVisible: '2104010945XX02', depositSen: 99838, meterPrevious: 4410 }), [A, { ...B, lastMeterReading: 4410 }], []);
  assert.equal(m.colour, 'amber');
});
test('nothing -> red; a different kind of account never matches', () => {
  assert.equal(matchBill(read(), [A, B], []).colour, 'red');
  assert.equal(matchBill(read({ kind: 'water', accountNoFull: '210401094502' }), [A], []).colour, 'red');
});
test('no amount or no month -> red, whatever matched', () => {
  const m = matchBill(read({ accountNoFull: '210401094502', currentChargesSen: null }), [A], []);
  assert.equal(m.colour, 'red'); assert.match(m.reasons.join(' '), /could not be read/i);
});
test('the same unit, kind and month already recorded -> Already recorded', () => {
  const m = matchBill(read({ accountNoFull: '210401094502' }), [A], [{ unitId: 'U-A', kind: 'electricity', billMonth: '2026-10', amountSen: 13000 }]);
  assert.equal(m.alreadyRecorded, true); assert.ok(m.reasons.includes('Already recorded'));
});
test('three times the usual -> amber with Much higher than usual', () => {
  const recent = ['2026-07', '2026-08', '2026-09'].map(billMonth => ({ unitId: 'U-A', kind: 'electricity', billMonth, amountSen: 4000 }));
  const m = matchBill(read({ accountNoFull: '210401094502', currentChargesSen: 12000 }), [A], recent);
  assert.equal(m.colour, 'amber'); assert.ok(m.reasons.includes('Much higher than usual'));
});
// chew 3 Nov 2026: what is recorded is Caj Semasa (current charges). On the September run it was often read as 0 when
// the page was hard to read, so a 0 is never green; an amount due alone (it carries arrears) records nothing.
test('current charges read as 0 -> amber, never green', () => {
  const m = matchBill(read({ accountNoFull: '210401094502', currentChargesSen: 0 }), [A], []);
  assert.equal(m.colour, 'amber'); assert.match(m.reasons.join(' '), /current charges read as 0/i);
});
test('an amount due without current charges -> red', () => {
  const m = matchBill(read({ accountNoFull: '210401094502', currentChargesSen: null, amountDueSen: 52735 }), [A], []);
  assert.equal(m.colour, 'red');
});
