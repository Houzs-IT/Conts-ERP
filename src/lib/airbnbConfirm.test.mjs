// node --test src/lib/airbnbConfirm.test.mjs. Airbnb reconciliation step 2: what confirming a reservation changes
// (chew, 11 Nov 2026): the reservation's guest total for Airbnb's net, and the owner's share for final months.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustmentText, bulkEligible, checkIncomeType, incomeKey, netOf, openMonthFrom, ownerShareOfChange, planLine, splitNet, stayMonths, undoProblem } from '../../functions/_lib/airbnbConfirm.ts';

// HMQFZYBTXQ, S-30-12: guest total RM 281.96, Airbnb's fee RM 44.25, so RM 237.71 net; Airbnb paid RM 297.66.
const stay = (over = {}) => ({ id: 'r1', unitId: 'u1', checkIn: '2026-10-26', checkOut: '2026-10-30', state: 'checked_out', gross: 28_196, fee: 4_425, ...over });
const none = () => new Set();
const oct = () => new Set(['2026-10']);
const pct70 = () => 70;

test('the months a stay has nights in', () => {
  assert.deepEqual(stayMonths('2026-10-26', '2026-10-30'), ['2026-10']);
  assert.deepEqual(stayMonths('2026-10-29', '2026-11-02'), ['2026-10', '2026-11']);
  assert.deepEqual(stayMonths('2026-10-31', '2026-11-01'), ['2026-10']);
  assert.deepEqual(stayMonths('2026-12-30', '2027-01-03'), ['2026-12', '2027-01']);
});

test('a new net is shared over a code’s units by their nets now, to the sen', () => {
  assert.deepEqual([...splitNet(29_766, [{ id: 'a', net: 23_771 }])], [['a', 29_766]]);
  assert.deepEqual([...splitNet(60_001, [{ id: 'a', net: 25_000 }, { id: 'b', net: 25_000 }])], [['a', 30_001], ['b', 30_000]]);
  assert.deepEqual([...splitNet(1_000, [{ id: 'a', net: 0 }, { id: 'b', net: 0 }])], [['a', 500], ['b', 500]]);
});

test('the owner’s share of a change, for final months only, by the owner’s percentage', () => {
  assert.deepEqual(ownerShareOfChange(5_995, stay(), oct(), pct70), { sen: 4_197, months: ['2026-10'] });
  assert.deepEqual(ownerShareOfChange(5_995, stay(), none(), pct70), { sen: 0, months: [] });
  // Fixed rent, master lease, long-term let: the owner's income does not follow the stay.
  assert.deepEqual(ownerShareOfChange(5_995, stay(), oct(), () => null), { sen: 0, months: [] });
  // Before Oct 2026 statements read collected revenue, so a change to the net gives nothing there.
  assert.deepEqual(ownerShareOfChange(5_995, stay({ checkIn: '2026-09-26', checkOut: '2026-09-30' }), new Set(['2026-09']), pct70), { sen: 0, months: [] });
});

test('a stay over two months: only the final month’s nights', () => {
  // 29 Oct to 2 Nov: 3 nights in October, 1 in November; October final.
  const s = stay({ checkIn: '2026-10-29', checkOut: '2026-11-02' });
  assert.deepEqual(ownerShareOfChange(4_000, s, oct(), pct70), { sen: 2_100, months: ['2026-10'] });
  assert.deepEqual(ownerShareOfChange(4_000, s, new Set(['2026-10', '2026-11']), pct70), { sen: 2_800, months: ['2026-10', '2026-11'] });
});

test('set the amount: the guest total moves so the net is Airbnb’s; the fee stays', () => {
  const open = planLine({ code: 'HMQFZYBTXQ', action: 'set_amount', newAmount: 29_766 }, [stay()], '2026-11-11', none, pct70);
  assert.equal(open.ok, true);
  assert.deepEqual(open.changes, [{ id: 'r1', unitId: 'u1', before: { gross: 28_196, state: 'checked_out' }, after: { gross: 34_191, state: 'checked_out' }, openMonths: ['2026-10'] }]);
  assert.equal(netOf({ gross: 34_191, fee: 4_425 }), 29_766);
  assert.deepEqual(open.shares, [], 'October still open: the statement follows when generated');
  const final = planLine({ code: 'HMQFZYBTXQ', action: 'set_amount', newAmount: 29_766 }, [stay()], '2026-11-11', oct, pct70);
  assert.deepEqual(final.shares, [{ unitId: 'u1', reservationId: 'r1', sen: 4_197, months: ['2026-10'], onMonth: '2026-11' }]);
  assert.deepEqual(final.changes[0].openMonths, [], 'October was final: the share goes on November instead');
});

test('a month whose income is locked is neither open nor final: no statement to generate again, no flat share', () => {
  const lockedOct = () => new Set(['2026-10']);
  const p = planLine({ code: 'HMQFZYBTXQ', action: 'set_amount', newAmount: 29_766 }, [stay()], '2026-11-11', none, pct70, lockedOct);
  assert.equal(p.ok, true);
  assert.deepEqual(p.changes[0].openMonths, [], 'October is locked: its statement keeps the locked income');
  assert.deepEqual(p.shares, [], 'the late difference is worked out through the contract by the lock, not as a flat share');
  const across = planLine({ code: 'HMACROSS', action: 'set_amount', newAmount: 60_000 }, [stay({ checkIn: '2026-10-30', checkOut: '2026-11-02' })], '2026-11-11', none, pct70, lockedOct);
  assert.deepEqual(across.changes[0].openMonths, ['2026-11'], 'November is open: it follows when generated');
});

test('set the amount over two units, and leave a cancelled one alone', () => {
  const p = planLine({ code: 'HMTWO', action: 'set_amount', newAmount: 60_000 }, [
    stay({ id: 'a', unitId: 'u1', gross: 30_000, fee: 5_000 }), stay({ id: 'b', unitId: 'u2', gross: 30_000, fee: 5_000 }), stay({ id: 'c', state: 'cancelled' }),
  ], '2026-11-11', none, pct70);
  assert.deepEqual(p.changes.map(c => [c.id, c.after.gross]), [['a', 35_000], ['b', 35_000]]);
});

test('cancel: a past stay is marked cancelled and a final month gives the owner’s share back; one to come is refused', () => {
  const past = planLine({ code: 'HMX', action: 'cancel', newAmount: 0 }, [stay()], '2026-11-11', oct, pct70);
  assert.deepEqual(past.changes.map(c => c.after.state), ['cancelled']);
  assert.deepEqual(past.shares.map(s => s.sen), [-16_640]);
  const toCome = planLine({ code: 'HMY', action: 'cancel', newAmount: 0 }, [stay({ checkIn: '2026-11-20', checkOut: '2026-11-23', state: 'confirmed' })], '2026-11-11', none, pct70);
  assert.equal(toCome.ok, false);
  assert.match(toCome.message, /Cancel it on the reservation itself/);
});

test('a line with nothing to change on its reservation changes none', () => {
  for (const action of ['none', 'check', 'wait']) {
    const p = planLine({ code: 'HMZ', action, newAmount: null }, [stay()], '2026-11-11', oct, pct70);
    assert.deepEqual([p.ok, p.changes, p.shares], [true, [], []]);
  }
});

test('the open month a final month’s share goes on', () => {
  assert.equal(openMonthFrom('2026-10', new Set(['2026-10'])), '2026-11');
  assert.equal(openMonthFrom('2026-11', new Set(['2026-11', '2026-12'])), '2027-01');
  assert.equal(openMonthFrom('2026-11', new Set()), '2026-11');
});

test('nothing to set, and a stay before Oct 2026, are refused', () => {
  assert.equal(planLine({ code: 'HMNEG', action: 'set_amount', newAmount: -500 }, [stay()], '2026-11-11', none, pct70).ok, false);
  // 29 Sep to 2 Oct: September's statement read the money collected, which a cancellation would take off whole.
  const sep = planLine({ code: 'HMSEP', action: 'cancel', newAmount: 0 }, [stay({ checkIn: '2026-09-29', checkOut: '2026-10-02' })], '2026-11-11', none, pct70);
  assert.equal(sep.ok, false);
  assert.match(sep.message, /nights before Oct 2026/);
});

test('only lines that just record company income are confirmed together; R10 one by one', () => {
  assert.equal(bulkEligible({ needsConfirm: true, action: 'none', rule: 'R13' }), true);
  assert.equal(bulkEligible({ needsConfirm: true, action: 'none', rule: 'R5' }), true);
  assert.equal(bulkEligible({ needsConfirm: true, action: 'none', rule: 'R10' }), false);
  assert.equal(bulkEligible({ needsConfirm: true, action: 'set_amount', rule: 'R2' }), false);
  assert.equal(bulkEligible({ needsConfirm: true, action: 'check', rule: 'R99' }), false);
  assert.equal(bulkEligible({ needsConfirm: false, action: 'none', rule: 'R1' }), false);
  assert.equal(incomeKey({ txnIds: ['t1', 't2'] }), 't1,t2');
});

// chew's types, 11 Nov 2026: Additional charge (Early check-in / late checkout, Pickup, Others), Compensation, AirCover…
const types = [
  { id: 'add', parentId: null, name: 'Additional charge', active: true },
  { id: 'early', parentId: 'add', name: 'Early check-in / late checkout', active: true },
  { id: 'pickup', parentId: 'add', name: 'Pickup', active: true },
  { id: 'old', parentId: 'add', name: 'Laundry', active: false },
  { id: 'comp', parentId: null, name: 'Compensation', active: true },
  { id: 'air', parentId: null, name: 'AirCover', active: false },
];

test('a company income line needs an active type, and a sub-type when its type has any', () => {
  assert.deepEqual(checkIncomeType(types, 'comp', null), { ok: true, typeId: 'comp', subTypeId: null });
  assert.deepEqual(checkIncomeType(types, 'comp', 'pickup'), { ok: true, typeId: 'comp', subTypeId: null }, 'a sub-type of another type is dropped');
  assert.deepEqual(checkIncomeType(types, 'add', 'pickup'), { ok: true, typeId: 'add', subTypeId: 'pickup' });
  assert.match(checkIncomeType(types, 'add', null).message, /kind of Additional charge/);
  assert.match(checkIncomeType(types, 'add', 'old').message, /kind of Additional charge/, 'an inactive sub-type is not one to choose');
  assert.match(checkIncomeType(types, 'air', null).message, /AirCover is inactive/);
  assert.match(checkIncomeType(types, null, null).message, /choose its type/);
  assert.match(checkIncomeType(types, 'pickup', null).message, /choose its type/, 'a sub-type is not a type');
});

test('how the owner’s statement names the share', () => {
  assert.equal(adjustmentText('HMQFZYBTXQ', 'set_amount', ['2026-10']), 'Airbnb reservation HMQFZYBTXQ: amount corrected after the Oct 2026 statement');
  assert.equal(adjustmentText('HMX', 'cancel', ['2026-10', '2026-11']), 'Airbnb reservation HMX: refunded to the guest after the Oct 2026 and Nov 2026 statement');
});

test('undo: refused once the reservation moved on, a statement with the change is final, or the owner’s share is', () => {
  const applied = {
    changes: [{ id: 'r1', unitId: 'u1', before: { gross: 28_196, state: 'checked_out' }, after: { gross: 34_191, state: 'checked_out' }, openMonths: ['2026-10'] }],
    shares: [{ unitId: 'u1', reservationId: 'r1', sen: 4_197, months: ['2026-09'], onMonth: '2026-11', adjustmentId: 'a1' }],
    incomeIds: [],
  };
  const as = (gross, state = 'checked_out') => new Map([['r1', { gross, state }]]);
  const fine = { stays: as(34_191), finalMonthsOf: none, adjustments: new Map([['a1', { state: 'open', final: false }]]) };
  assert.equal(undoProblem(applied, fine), null);
  assert.match(undoProblem(applied, { ...fine, stays: as(35_000) }), /changed since it was confirmed/);
  assert.match(undoProblem(applied, { ...fine, finalMonthsOf: oct }), /Oct 2026 owner statement is final now/);
  assert.match(undoProblem(applied, { ...fine, adjustments: new Map([['a1', { state: 'open', final: true }]]) }), /credit it made is on a final statement/);
  assert.match(undoProblem(applied, { ...fine, adjustments: new Map([['a1', { state: 'settled', final: false }]]) }), /held or settled/);
  assert.equal(undoProblem(applied, { ...fine, adjustments: new Map() }), null, 'a credit removed by hand is simply gone');
  assert.equal(undoProblem({ changes: [], shares: [], incomeIds: [] }, fine), null, 'kept as it is: nothing to put back');
});

test('a confirmed change on a final month is posted past a month whose O2 is locked', () => {
  // October is final, so the owner's share of the change goes on the next open month; November's O2 is locked for the
  // unit (owner statement close), so that is December.
  const novO2 = () => new Set(['2026-11']);
  const p = planLine({ code: 'HMQFZYBTXQ', action: 'set_amount', newAmount: 29_766 }, [stay()], '2026-11-11', oct, pct70, none, novO2);
  assert.deepEqual(p.shares, [{ unitId: 'u1', reservationId: 'r1', sen: 4_197, months: ['2026-10'], onMonth: '2026-12' }]);
});
