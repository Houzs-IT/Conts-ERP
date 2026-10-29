import { describe, expect, test } from 'vitest';
import { floatBalance, topUpAmount, lowBalance, resolveFloatId, lineDepartment, receiptCountsForLimit } from './petty-cash';

describe('floatBalance', () => {
  test('money paid in, less every receipt that is not replaced', () => {
    expect(floatBalance([{ kind: 'PAID_IN', amountSen: 100000 }],
      [{ amountSen: 4500, status: 'HANDED_IN' }, { amountSen: 2000, status: 'REPLACED' }])).toBe(95500);
  });
  test('a repayment adds back once; money returned to finance comes off', () => {
    const events = [{ kind: 'PAID_IN' as const, amountSen: 100000 }, { kind: 'REPAID' as const, amountSen: 4500 }, { kind: 'RETURNED' as const, amountSen: 10000 }];
    expect(floatBalance(events, [{ amountSen: 4500, status: 'REPAID' }])).toBe(90000);
  });
  test('rejected, written off, checked and topped-up receipts all spent the cash', () => {
    const rs = (['REJECTED', 'WRITTEN_OFF', 'CHECKED', 'TOPPED_UP'] as const).map(status => ({ amountSen: 1000, status }));
    expect(floatBalance([{ kind: 'PAID_IN', amountSen: 5000 }], rs)).toBe(1000);
  });
  test('it can go below zero', () => {
    expect(floatBalance([{ kind: 'PAID_IN', amountSen: 100000 }], [{ amountSen: 112000, status: 'HANDED_IN' }])).toBe(-12000);
  });
});

describe('topUpAmount', () => {
  test('brings the float back to its amount', () => {
    expect(topUpAmount(100000, -12000)).toBe(112000);
    expect(topUpAmount(100000, 100000)).toBe(0);
    expect(topUpAmount(100000, 120000)).toBe(0);
  });
});

describe('lowBalance', () => {
  test('below the warning share of the float', () => {
    expect(lowBalance(100000, 19999, 20)).toBe(true);
    expect(lowBalance(100000, 20000, 20)).toBe(false);
    expect(lowBalance(0, 0, 20)).toBe(false);
  });
});

describe('resolveFloatId', () => {
  const byDept = new Map([['maint', 'F1'], ['clean', 'F2']]);
  test('an override wins, then the department, then none', () => {
    expect(resolveFloatId('u1', 'maint', new Map([['u1', 'F2']]), byDept)).toBe('F2');
    expect(resolveFloatId('u1', 'maint', new Map(), byDept)).toBe('F1');
    expect(resolveFloatId('u1', 'office', new Map(), byDept)).toBeNull();
    expect(resolveFloatId('u1', null, new Map(), byDept)).toBeNull();
  });
});

describe('lineDepartment', () => {
  test('the department side gives the line department', () => {
    expect(lineDepartment('conts')).toBe('rental');
    expect(lineDepartment('dream_crafter')).toBe('supply');
    expect(lineDepartment('both')).toBe('shared');
    expect(lineDepartment(null)).toBe('shared');
  });
});

describe('receiptCountsForLimit', () => {
  test('counted until its own pay-back voucher has posted', () => {
    expect(receiptCountsForLimit({ status: 'CHECKED', floatId: null })).toBe(true);
    expect(receiptCountsForLimit({ status: 'PAID_BACK', floatId: null })).toBe(false);
  });
  test('a rejection on a float counts until repaid or written off; one finance never paid, never; replaced never', () => {
    expect(receiptCountsForLimit({ status: 'REJECTED', floatId: 'F1' })).toBe(true);
    expect(receiptCountsForLimit({ status: 'REJECTED', floatId: null })).toBe(false);
    expect(receiptCountsForLimit({ status: 'REPAID', floatId: 'F1' })).toBe(false);
    expect(receiptCountsForLimit({ status: 'WRITTEN_OFF', floatId: 'F1' })).toBe(false);
    expect(receiptCountsForLimit({ status: 'REPLACED', floatId: 'F1' })).toBe(false);
    expect(receiptCountsForLimit({ status: 'HANDED_IN', floatId: 'F1' })).toBe(true);
  });
});
