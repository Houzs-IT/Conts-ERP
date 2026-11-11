import { describe, expect, it } from 'vitest';
import { foldMoney, readStatusMoney, sumByStatus } from './status-money';

const BUCKETS = { draft: ['DRAFT'], outstanding: ['SUBMITTED', 'PARTIAL'], partial: ['PARTIAL'], cancelled: ['CANCELLED'] };

describe('status money', () => {
  it('sums by status (upper case, blank as UNKNOWN) and folds into the tabs, overlaps included', () => {
    const by = sumByStatus([{ status: 'draft', amt: 100 }, { status: 'PARTIAL', amt: 250 }, { status: 'SUBMITTED', amt: 50 }, { status: null, amt: 7 }], (r) => r.amt);
    expect(by).toEqual({ DRAFT: 100, PARTIAL: 250, SUBMITTED: 50, UNKNOWN: 7 });
    expect(foldMoney(by, BUCKETS)).toEqual({ all: 407, draft: 100, outstanding: 300, partial: 250, cancelled: 0 });
  });

  it('reads one grouped aggregate with the given base filters', async () => {
    const selects: string[] = [];
    const base = (sel: string) => { selects.push(sel); return Promise.resolve({ data: [{ status: 'DRAFT', amt: 1500 }, { status: 'CANCELLED', amt: 900 }], error: null }); };
    expect(await readStatusMoney(base, 'total_sen', BUCKETS)).toEqual({ all: 1500, draft: 1500, outstanding: 0, partial: 0, cancelled: 900 });
    expect(selects).toEqual(['status, amt:total_sen.sum()']);
  });

  it('falls back to paging rows when aggregates are off, and a failed read answers undefined', async () => {
    const page = { data: [{ status: 'PARTIAL', total_sen: 400 }], error: null };
    const base = (sel: string) => (sel.includes('.sum()')
      ? Promise.resolve({ data: null, error: { message: 'aggregates disabled' } })
      : { range: (from: number) => Promise.resolve(from === 0 ? page : { data: [], error: null }) });
    expect(await readStatusMoney(base, 'total_sen', BUCKETS)).toMatchObject({ all: 400, outstanding: 400, partial: 400 });
    const broken = () => { throw new Error('boom'); };
    expect(await readStatusMoney(broken, 'total_sen', BUCKETS)).toBeUndefined();
  });
});
