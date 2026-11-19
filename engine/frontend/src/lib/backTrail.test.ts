import { describe, expect, test } from 'vitest';
import { backFrom, isPassThrough, recordVisit } from './backTrail';

const walk = (pages: string[]) => pages.reduce<string[]>((t, p) => recordVisit(t, p), []);

describe('Back goes to where the page was opened from', () => {
  test('a new voucher saved: Back from it returns to the list it was started from, not to the blank form', () => {
    const t = walk(['/scm/payment-vouchers?status=DRAFT', '/scm/payment-vouchers/new?type=ap', '/scm/payment-vouchers/pv-9']);
    expect(backFrom(t, '/scm/payment-vouchers/pv-9')?.to).toBe('/scm/payment-vouchers?status=DRAFT');
  });
  test('opened from the supplier ledger: Back returns to the ledger, through an edit on the way', () => {
    const t = walk(['/scm/supplier-ledger?s=400-T001', '/scm/payment-vouchers/pv-1', '/scm/payment-vouchers/pv-1?edit=1', '/scm/payment-vouchers/pv-1']);
    expect(backFrom(t, '/scm/payment-vouchers/pv-1')).toEqual({ to: '/scm/supplier-ledger?s=400-T001', trail: ['/scm/supplier-ledger?s=400-T001'] });
  });
  test('a list keeps its latest filter; nothing behind a page means no answer (its own list is used)', () => {
    const t = walk(['/scm/ap-invoices', '/scm/ap-invoices?kind=ap', '/scm/ap-invoices/x']);
    expect(t).toEqual(['/scm/ap-invoices?kind=ap', '/scm/ap-invoices/x']);
    expect(backFrom(['/scm/ap-invoices/x'], '/scm/ap-invoices/x')).toBeNull();
  });
  test('the forms passed through', () => {
    expect(isPassThrough('/scm/payment-vouchers/new?type=ap')).toBe(true);
    expect(isPassThrough('/scm/payment-vouchers/scan')).toBe(true);
    expect(isPassThrough('/scm/payment-vouchers/pv-1?print=1')).toBe(true);
    expect(isPassThrough('/scm/payment-vouchers/new/from-request')).toBe(true);
    expect(isPassThrough('/scm/payment-vouchers?status=DRAFT')).toBe(false);
  });
});
