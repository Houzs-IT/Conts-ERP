import { describe, expect, it } from 'vitest';
import { DR_SEARCH_COLS, pageRange, parseReturnListPage, returnSearchOr } from './return-list-page';

const q = (o: Record<string, string>) => (k: string) => o[k];

describe('parseReturnListPage', () => {
  it('no page = the list as before', () => {
    expect(parseReturnListPage(q({}))).toBeNull();
  });
  it('reads page, caps pageSize, cleans the search', () => {
    expect(parseReturnListPage(q({ page: '2', pageSize: '500', q: ' tan* ' }))).toEqual({ page: 2, pageSize: 100, q: 'tan' });
  });
  it('a bad page or size falls back to the first page of 30', () => {
    expect(parseReturnListPage(q({ page: '-1', pageSize: 'x' }))).toEqual({ page: 0, pageSize: 30, q: '' });
  });
});

describe('pageRange', () => {
  it('maps a page to its rows', () => {
    expect(pageRange({ page: 0, pageSize: 30, q: '' })).toEqual([0, 29]);
    expect(pageRange({ page: 2, pageSize: 30, q: '' })).toEqual([60, 89]);
  });
});

describe('returnSearchOr', () => {
  it('no search, no filter', () => {
    expect(returnSearchOr(DR_SEARCH_COLS, '')).toBeNull();
  });
  it('every column by text, plus supplier ids', () => {
    expect(returnSearchOr(['return_number', 'reason'], 'abc', ['s1', 's2']))
      .toBe('return_number.ilike.%abc%,reason.ilike.%abc%,supplier_id.in.(s1,s2)');
  });
  it('the delivery-return search covers the reference and the DO number', () => {
    const or = returnSearchOr(DR_SEARCH_COLS, 'x')!;
    for (const col of ['ref', 'customer_so_no', 'do_doc_no', 'debtor_name']) expect(or).toContain(`${col}.ilike.%x%`);
  });
});
