import { describe, expect, it } from 'vitest';
import { distinctNames, readDistinctCustomerNames } from './customer-names';

describe('Customer Name funnel choices (audit 20 Nov 2026)', () => {
  it('distinct, trimmed, blanks dropped, first spelling kept', () => {
    expect(distinctNames([{ debtor_name: 'Ada' }, { debtor_name: ' Ada ' }, { debtor_name: null }, { debtor_name: '' }, { debtor_name: 'Bo' }]))
      .toEqual(['Ada', 'Bo']);
  });

  it('reads page by page past the 1000-row cap, and reports a failed read', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ debtor_name: `C${String(i % 1200).padStart(4, '0')}` }));
    const ranges: Array<[number, number]> = [];
    const ok = await readDistinctCustomerNames((from, to) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    });
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(ok.names).toHaveLength(1200);
    const bad = await readDistinctCustomerNames(() => Promise.resolve({ data: null, error: { message: 'boom' } }));
    expect(bad).toEqual({ names: [], error: 'boom' });
  });
});
