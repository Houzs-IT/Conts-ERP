/* In-house work closes by Complete; a Built-in PO to In-house has no production order and is received by hand. */
import { describe, expect, it } from 'vitest';
import { inHouseReceiptRefused } from './grn-from-po-core';
import { takesOnSiteDefault } from './po-grouping';

const INHOUSE = 'in-house';
const sb = (orderPos: string[]) => ({
  from: (table: string) => ({
    select: () => (table === 'suppliers'
      ? { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: INHOUSE } }) }), maybeSingle: async () => ({ data: { id: INHOUSE } }) }) }
      : { in: async (_c: string, ids: string[]) => ({ data: ids.filter((i) => orderPos.includes(i)).map((source_po_id) => ({ source_po_id })), error: null }) }),
  }),
});
const c = { get: () => 1 };

describe('inHouseReceiptRefused', () => {
  it('lets an outside supplier through', async () => {
    expect(await inHouseReceiptRefused(sb([]), c, 'acme', [])).toBe(false);
  });
  it('refuses a blank receipt to our own team', async () => {
    expect(await inHouseReceiptRefused(sb([]), c, INHOUSE, [])).toBe(true);
  });
  it('refuses a PO with a production order', async () => {
    expect(await inHouseReceiptRefused(sb(['po1']), c, INHOUSE, ['po1'])).toBe(true);
  });
  it('lets a Built-in PO with no production order through', async () => {
    expect(await inHouseReceiptRefused(sb(['other']), c, INHOUSE, ['po1'])).toBe(false);
  });
});

describe('takesOnSiteDefault', () => {
  const bound = (code: string) => code === 'WORK';
  it('a Works PO to In-house with no location goes On-site, so its order is made', () => {
    expect(takesOnSiteDefault({ warehouseId: null, supplierId: INHOUSE, itemCodes: ['WORK'] }, INHOUSE, bound)).toBe(true);
  });
  it('keeps a chosen location, an outside supplier and ordinary goods as they were', () => {
    expect(takesOnSiteDefault({ warehouseId: 'blk', supplierId: INHOUSE, itemCodes: ['WORK'] }, INHOUSE, bound)).toBe(false);
    expect(takesOnSiteDefault({ warehouseId: null, supplierId: 'acme', itemCodes: ['WORK'] }, INHOUSE, bound)).toBe(false);
    expect(takesOnSiteDefault({ warehouseId: null, supplierId: INHOUSE, itemCodes: ['SOFA'] }, INHOUSE, bound)).toBe(false);
  });
});
