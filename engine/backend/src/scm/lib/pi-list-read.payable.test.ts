import { describe, it, expect } from 'vitest';
import { readSupplierPayablePis, PI_PAYABLE_STATUSES } from './pi-list-read';

/* Payment vouchers' Apply to PI (audit 20 Nov 2026, item 5): the plain list returns the newest 500 invoices of every
   supplier, so a supplier's older unpaid invoices were missing. This read filters on the server, for one supplier,
   in the active company, and pages through every match. */

type Row = { id: string; total_sen: number; paid_sen: number };

function fakeFrom(pages: Row[][]) {
  const calls: Array<{ m: string; args: unknown[] }> = [];
  let page = 0;
  const from = () => {
    const self: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'order'] as const) {
      self[m] = (...args: unknown[]) => { calls.push({ m, args }); return self; };
    }
    self.range = (a: number, b: number) => {
      calls.push({ m: 'range', args: [a, b] });
      return Promise.resolve({ data: pages[page++] ?? [], error: null });
    };
    return self;
  };
  return { from, calls };
}

const ctx = { get: (k: string) => (k === 'companyId' ? 7 : undefined) } as { get(key: string): unknown };

describe('readSupplierPayablePis', () => {
  it('asks for one supplier, payable statuses and the active company, oldest first', async () => {
    const { from, calls } = fakeFrom([[{ id: 'a', total_sen: 100, paid_sen: 0 }]]);
    const out = await readSupplierPayablePis(from, ctx, 'sup-1');
    expect(out.error).toBeNull();
    expect(out.rows.map((r) => r.id)).toEqual(['a']);
    expect(calls).toContainEqual({ m: 'eq', args: ['supplier_id', 'sup-1'] });
    expect(calls).toContainEqual({ m: 'in', args: ['status', PI_PAYABLE_STATUSES] });
    expect(calls).toContainEqual({ m: 'eq', args: ['company_id', 7] });
    expect(calls).toContainEqual({ m: 'order', args: ['invoice_date', { ascending: true }] });
  });

  it('drops invoices already paid in full', async () => {
    const { from } = fakeFrom([[
      { id: 'owing', total_sen: 100, paid_sen: 40 },
      { id: 'paid', total_sen: 100, paid_sen: 100 },
    ]]);
    const out = await readSupplierPayablePis(from, ctx, 'sup-1');
    expect(out.rows.map((r) => r.id)).toEqual(['owing']);
  });

  it('reads past the first 1,000 rows, so an old unpaid invoice is not cut off', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, total_sen: 10, paid_sen: 10 }));
    const { from, calls } = fakeFrom([full, [{ id: 'old-unpaid', total_sen: 50, paid_sen: 0 }]]);
    const out = await readSupplierPayablePis(from, ctx, 'sup-1');
    expect(out.rows.map((r) => r.id)).toEqual(['old-unpaid']);
    expect(calls.filter((c) => c.m === 'range').map((c) => c.args)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('reports a failed read instead of an empty list', async () => {
    const from = () => {
      const self: Record<string, unknown> = {};
      for (const m of ['eq', 'in', 'order']) self[m] = () => self;
      self.range = () => Promise.resolve({ data: null, error: { message: 'boom' } });
      return self;
    };
    expect(await readSupplierPayablePis(from, ctx, 'sup-1')).toEqual({ rows: [], truncated: false, error: 'boom' });
  });
});
