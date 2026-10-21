/* The department on payment voucher and receipt lines (Conts, finance phase 1, spec 3.5). Each expense or income line
   names Rental, Supply chain or Shared; the money side (the bank) is split the same way, so each department's books
   balance on their own and a trial balance per department adds up. One department, one bank line, as before. */
import { describe, expect, test } from 'vitest';
import { pvLines, settlementDepartments, splitByDepartment } from './rules';
import { buildLines } from '../scm/routes/payment-vouchers';

const PV = { pv_number: '2990-MPV-2612-001', payee_name: 'TNB', credit_account_code: '310-0010' };
const NO_SUPPLIER = { code: null, name: null };

describe('splitByDepartment', () => {
  test('sums by department, in the order each first appears; a line without one is Supply chain', () => {
    expect(splitByDepartment([
      { department: 'rental', sen: 300 }, { department: null, sen: 50 }, { department: 'rental', sen: 100 }, { department: 'shared', sen: 20 },
    ])).toEqual([{ department: 'rental', sen: 400 }, { department: 'supply', sen: 50 }, { department: 'shared', sen: 20 }]);
  });
});

describe('pvLines with departments', () => {
  test('each debit keeps its department and the bank is credited per department', () => {
    const lines = pvLines(PV, [
      { description: 'Electricity A-12-3', debit_account_code: '905-0000', myrSen: 30000, department: 'rental' },
      { description: 'Office electricity', debit_account_code: '906-0000', myrSen: 12000, department: 'shared' },
    ], NO_SUPPLIER);
    expect(lines.map((l) => [l.accountCode, l.debitSen, l.creditSen, l.department])).toEqual([
      ['905-0000', 30000, 0, 'rental'],
      ['906-0000', 12000, 0, 'shared'],
      ['310-0010', 0, 30000, 'rental'],
      ['310-0010', 0, 12000, 'shared'],
    ]);
  });

  test('one department: one bank line, as before', () => {
    const lines = pvLines(PV, [
      { description: 'a', debit_account_code: '905-0000', myrSen: 100, department: 'rental' },
      { description: 'b', debit_account_code: '906-0000', myrSen: 200, department: 'rental' },
    ], NO_SUPPLIER);
    expect(lines.filter((l) => l.creditSen > 0)).toEqual([expect.objectContaining({ accountCode: '310-0010', creditSen: 300, department: 'rental' })]);
  });

  test('lines with no department are Supply chain', () => {
    const lines = pvLines(PV, [{ description: 'a', debit_account_code: '905-0000', myrSen: 100 }], NO_SUPPLIER);
    expect(lines.map((l) => l.department)).toEqual(['supply', 'supply']);
  });
});

describe('buildLines keeps the department', () => {
  test('stores each line\'s department; none is Supply chain', () => {
    const built = buildLines([
      { debitAccountCode: '905-0000', amountSen: 100, department: 'rental' },
      { debitAccountCode: '906-0000', amountSen: 200 },
    ]);
    expect('rows' in built && built.rows.map((r) => r.department)).toEqual(['rental', 'supply']);
  });

  test('refuses an unknown department', () => {
    expect(buildLines([{ debitAccountCode: '905-0000', amountSen: 100, department: 'hq' }])).toEqual({ error: 'department_invalid' });
  });
});

/* Settling a bill keeps the bill's departments (Conts, spec 3.5): a supplier payment or a debtor receipt books its
   control and money side in the departments of the bills it settles, in proportion and in whole sen; what it pays
   beyond its bills (an advance, a stock purchase invoice) is Supply chain. */
describe('settlementDepartments', () => {
  test('a settled bill keeps its departments; the rest is Supply chain', () => {
    expect(settlementDepartments(500_000, [
      { sen: 400_000, lines: [{ department: 'rental', sen: 300_000 }, { department: 'shared', sen: 100_000 }] },
    ])).toEqual([{ department: 'rental', sen: 300_000 }, { department: 'shared', sen: 100_000 }, { department: 'supply', sen: 100_000 }]);
  });

  test('a part payment is spread in proportion, in whole sen that add up exactly', () => {
    const parts = settlementDepartments(10_000, [
      { sen: 10_000, lines: [{ department: 'rental', sen: 1 }, { department: 'shared', sen: 1 }, { department: 'rental', sen: 1 }] },
    ]);
    expect(parts.reduce((s, p) => s + p.sen, 0)).toBe(10_000);
    expect(parts).toEqual([{ department: 'rental', sen: 6_667 }, { department: 'shared', sen: 3_333 }]);
  });

  test('no bills: all Supply chain', () => {
    expect(settlementDepartments(1_000, [])).toEqual([{ department: 'supply', sen: 1_000 }]);
  });
});
