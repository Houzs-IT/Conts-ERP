import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { changePct, SupplierPriceRefreshDialog } from './SupplierPriceRefresh';

vi.mock('../../vendor/scm/lib/suppliers-queries', () => ({
  useSupplierPriceRefresh: () => ({
    isLoading: false,
    error: null,
    data: {
      changes: [{ bindingId: 'b1', itemCode: 'HK-1', materialName: 'Hacking', listSen: 1000, listFrom: null, paidSen: 1100, paidOn: '2026-08-10', invoiceNumber: 'PI-001', deltaSen: 100, eligible: true }],
      unitMismatches: [{ bindingId: 'b2', itemCode: 'SCREW', materialName: 'Screw', listSen: 2, listFrom: null, paidSen: 1800, paidOn: '2026-08-10', invoiceNumber: 'PI-001', deltaSen: 1798, eligible: false, reason: 'unit_mismatch', whyNot: 'price moved 900.0x: almost always a per-box vs per-piece mix-up' }],
      refused: [],
      current: 4,
    },
  }),
  useApplySupplierPriceRefresh: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('Update prices from invoices', () => {
  it('shows the change as a percentage', () => {
    expect(changePct({ listSen: 1000, paidSen: 1100 })).toBe('+10.0%');
    expect(changePct({ listSen: 2000, paidSen: 1910 })).toBe('-4.5%');
    expect(changePct({ listSen: 0, paidSen: 500 })).toBe('');
  });

  it('lists the change to apply and the box vs piece row to check, apart', () => {
    const html = renderToStaticMarkup(<SupplierPriceRefreshDialog supplierId="s1" onClose={() => {}} />);
    expect(html).toContain('1 to update · 4 already current');
    expect(html).toContain('1 to check');
    expect(html).toContain('RM 11.00');
    expect(html).toContain('PI-001 · 2026-08-10');
    expect(html).toContain('To check (not updated)');
    expect(html).toContain('per-box vs per-piece');
  });
});
