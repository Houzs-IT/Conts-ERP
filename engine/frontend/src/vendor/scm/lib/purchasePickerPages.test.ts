import { describe, expect, it } from 'vitest';
import { outstandingGrnPageUrl, outstandingPoPageUrl } from './suppliers-queries';

/* The paged picker reads (audit 20 Nov 2026): one page of whole documents, the cursor and the search passed to the
   server as the backend's lib/doc-batch-page.ts reads them. */
describe('outstandingPoPageUrl', () => {
  it('first page: the limit only', () => {
    expect(outstandingPoPageUrl('', null, null)).toBe('/grns/outstanding-po-items?limit=100');
  });
  it('carries the cursor, the trimmed search and the supplier', () => {
    expect(outstandingPoPageUrl(' sofa ', 'HC-PO-0100', 'sup-1'))
      .toBe('/grns/outstanding-po-items?limit=100&cursor=HC-PO-0100&q=sofa&supplierId=sup-1');
  });
});

describe('outstandingGrnPageUrl', () => {
  it('first page: the limit only', () => {
    expect(outstandingGrnPageUrl('', null)).toBe('/purchase-invoices/outstanding-grn-items?limit=100');
  });
  it('carries the cursor and the search', () => {
    expect(outstandingGrnPageUrl('akemi (q)', 'HC-GRN-2609-066', 50))
      .toBe('/purchase-invoices/outstanding-grn-items?limit=50&cursor=HC-GRN-2609-066&q=akemi+%28q%29');
  });
});
