import { describe, expect, it } from 'vitest';
import { onsiteConfirmKind } from './onsite-twin-queries';

describe('which phone actions raise an on-site partner', () => {
  it('confirming a delivery and posting a receipt do', () => {
    expect(onsiteConfirmKind('delivery-orders-mfg', 'next')).toBe('do');
    expect(onsiteConfirmKind('grns', 'post')).toBe('grn');
  });
  it('a cancel or another module does not', () => {
    expect(onsiteConfirmKind('delivery-orders-mfg', 'cancel')).toBeNull();
    expect(onsiteConfirmKind('grns', 'cancel')).toBeNull();
    expect(onsiteConfirmKind('sales-invoices', 'next')).toBeNull();
  });
});
