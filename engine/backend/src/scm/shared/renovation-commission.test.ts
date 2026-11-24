import { describe, it, expect } from 'vitest';
import {
  contractCommission, contractPortions, monthlySales, salesRateBp, schemeProblems, type CommissionScheme, type ContractMoney,
} from './renovation-commission';

const TIERS = [
  { fromSen: 6_000_000, bp: 50 }, { fromSen: 10_000_000, bp: 100 }, { fromSen: 15_000_000, bp: 150 },
  { fromSen: 20_000_000, bp: 200 }, { fromSen: 25_000_000, bp: 250 }, { fromSen: 30_000_000, bp: 300 },
];
const conts: CommissionScheme = {
  id: 's1', name: 'The Conts', branding: 'The Conts', managerStaffId: 'boss', managerBp: 400, companyPoolBp: 0, tiers: TIERS,
  stages: [
    { label: '2nd payment', kind: 'instalment', value: 2, releaseBp: 5000 },
    { label: 'Last payment', kind: 'collected', value: 10_000, releaseBp: 5000 },
  ],
};
const plan = [{ seq: 1, cumBp: 3000 }, { seq: 2, cumBp: 6000 }, { seq: 3, cumBp: 9000 }, { seq: 4, cumBp: 10_000 }];
const money = (baseSen: number, collectedSen: number): ContractMoney => ({ baseSen, collectedSen, instalments: plan });
const none = new Map<string, number>();

describe('tiers', () => {
  it('the highest tier reached, nothing below the first, never above the manager rate', () => {
    expect(salesRateBp(TIERS, 5_999_999, 400)).toBe(0);
    expect(salesRateBp(TIERS, 6_000_000, 400)).toBe(50);
    expect(salesRateBp(TIERS, 14_000_000, 400)).toBe(100);
    expect(salesRateBp(TIERS, 31_000_000, 400)).toBe(300);
    expect(salesRateBp(TIERS, 31_000_000, 200)).toBe(200);
  });
});

describe('portions', () => {
  it('a VO counts in the month it is dated; credit notes on the order month', () => {
    const p = contractPortions('SO1', '2026-10-05', 10_800_000, 10_000_000, [{ voNo: 'VO1', date: '2026-11-02', netSen: 1_000_000 }]);
    expect(p).toEqual([
      expect.objectContaining({ month: '2026-10', sen: 10_000_000, source: 'SO' }),
      expect.objectContaining({ month: '2026-11', sen: 1_000_000, source: 'VO' }),
      expect.objectContaining({ month: '2026-10', sen: -200_000, source: 'OTHER' }),
    ]);
  });
});

describe('renovation commission', () => {
  it('each month of the order at that month\'s tier; the manager gets the rest of 4%', () => {
    const portions = contractPortions('SO1', '2026-10-05', 11_000_000, 10_000_000, [{ voNo: 'VO1', date: '2026-11-02', netSen: 1_000_000 }]);
    // October: 200k of sales in total (2%); November: 60k (0.5%).
    const sales = new Map([['amy|2026-10', 20_000_000], ['amy|2026-11', 6_000_000]]);
    const r = contractCommission(money(11_000_000, 11_000_000), portions, conts, 'amy', sales, none);
    expect(r.portions.map((p) => [p.month, p.salesBp, p.managerBp, p.salesSen, p.managerSen])).toEqual([
      ['2026-10', 200, 200, 200_000, 200_000],
      ['2026-11', 50, 350, 5_000, 35_000],
    ]);
    expect(r.shares).toEqual([
      expect.objectContaining({ staffId: 'amy', role: 'sales', totalSen: 205_000, earnedSen: 205_000 }),
      expect.objectContaining({ staffId: 'boss', role: 'manager', totalSen: 235_000 }),
    ]);
  });

  it('a manager who opened the order earns the whole manager rate', () => {
    const portions = contractPortions('SO1', '2026-10-05', 10_000_000, 10_000_000, []);
    const r = contractCommission(money(10_000_000, 10_000_000), portions, conts, 'boss', none, none);
    expect(r.shares).toEqual([expect.objectContaining({ staffId: 'boss', role: 'manager', totalSen: 400_000 })]);
  });

  it('nothing is released before the 2nd payment is paid in full; half after it', () => {
    const portions = contractPortions('SO1', '2026-10-05', 10_000_000, 10_000_000, []);
    const sales = new Map([['amy|2026-10', 10_000_000]]);
    expect(contractCommission(money(10_000_000, 5_999_999), portions, conts, 'amy', sales, none).releasedBp).toBe(0);
    const r = contractCommission(money(10_000_000, 6_000_000), portions, conts, 'amy', sales, none);
    expect(r.releasedBp).toBe(5000);
    expect(r.shares[0].earnedSen).toBe(50_000);
  });

  it('flat rate with a company pool (one tier from zero)', () => {
    const mk: CommissionScheme = { ...conts, managerBp: 300, companyPoolBp: 200, tiers: [{ fromSen: 0, bp: 125 }],
      stages: [{ label: '15%', kind: 'collected', value: 1500, releaseBp: 5000 }, { label: '100%', kind: 'collected', value: 10_000, releaseBp: 5000 }] };
    const portions = contractPortions('SO1', '2026-10-05', 10_000_000, 10_000_000, []);
    const r = contractCommission(money(10_000_000, 1_500_000), portions, mk, 'michelle', none, none);
    expect(r.companyPoolSen).toBe(200_000);
    expect(r.shares.map((s) => [s.staffId, s.totalSen, s.earnedSen])).toEqual([['michelle', 125_000, 62_500], ['boss', 175_000, 87_500]]);
  });

  it('what was paid already comes off what can be claimed', () => {
    const portions = contractPortions('SO1', '2026-10-05', 10_000_000, 10_000_000, []);
    const r = contractCommission(money(10_000_000, 10_000_000), portions, conts, 'amy', new Map([['amy|2026-10', 10_000_000]]), new Map([['amy', 60_000]]));
    expect(r.shares[0]).toEqual(expect.objectContaining({ totalSen: 100_000, paidSen: 60_000, claimableSen: 40_000 }));
  });

  it('monthly sales add up every order of the salesperson', () => {
    const s = monthlySales([
      { salespersonId: 'amy', portions: contractPortions('A', '2026-10-01', 5_000_000, 5_000_000, []) },
      { salespersonId: 'amy', portions: contractPortions('B', '2026-10-20', 7_000_000, 6_000_000, [{ voNo: 'V', date: '2026-11-01', netSen: 1_000_000 }]) },
      { salespersonId: null, portions: contractPortions('C', '2026-10-01', 9_000_000, 9_000_000, []) },
    ]);
    expect(s.get('amy|2026-10')).toBe(11_000_000);
    expect(s.get('amy|2026-11')).toBe(1_000_000);
  });

  it('checks a scheme', () => {
    expect(schemeProblems(conts)).toEqual([]);
    expect(schemeProblems({ ...conts, stages: [{ ...conts.stages[0], releaseBp: 3000 }] })).toContain('The payout stages add up to 30.00%; they must add up to 100%.');
    expect(schemeProblems({ ...conts, managerBp: 200 })).toContain('Tier 6: the salesperson rate cannot be more than the manager rate.');
  });
});
