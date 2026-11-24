import { describe, expect, test } from 'vitest';
import { outstandingSoPageUrl } from './suppliers-queries';

const params = (url: string) => Object.fromEntries(new URL(url, 'http://x').searchParams);

describe('outstandingSoPageUrl — the PO-from-SO picker asks the server for one page', () => {
  test('first page with nothing set asks only for a page size', () => {
    expect(params(outstandingSoPageUrl({ q: '', category: 'all', dateField: 'soDate', dateFrom: '', dateTo: '' }, null)))
      .toEqual({ limit: '100' });
  });
  test('search, category, date range and cursor all go to the server', () => {
    expect(params(outstandingSoPageUrl({ q: ' Oak & co ', category: 'SOFA', dateField: 'delivery', dateFrom: '2026-11-01', dateTo: '' }, 'abc')))
      .toEqual({ limit: '100', cursor: 'abc', q: 'Oak & co', category: 'SOFA', dateField: 'delivery', dateFrom: '2026-11-01' });
  });
  test('ticked server funnels and the sort go to the server; empty funnels do not', () => {
    expect(params(outstandingSoPageUrl({
      q: '', category: 'all', dateField: 'soDate', dateFrom: '', dateTo: '',
      cols: { project: ['KL 48 B-2', '(none)'], debtorName: [] }, sort: { key: 'project', dir: 'desc' },
    }, null))).toEqual({ limit: '100', cols: JSON.stringify({ project: ['KL 48 B-2', '(none)'] }), sort: 'project:desc' });
  });
  test('a sofa set is read by its SO number', () => {
    expect(params(outstandingSoPageUrl({ docNo: 'HC-SO-1' }, null, 200))).toEqual({ limit: '200', docNo: 'HC-SO-1' });
  });
});
