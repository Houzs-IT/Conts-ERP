import { describe, expect, it } from 'vitest';
import { copiedHeader } from './renovationQuotationChrome';
import type { DocHeader } from '../../lib/renovation/api';

const source: DocHeader = {
  printFormat: 'DETAILED' as DocHeader['printFormat'],
  attention: 'Mr Tan', customerName: 'Tan Ah Kow', customerPhone: '0123456789', customerEmail: 'tan@example.com',
  building: 'Skyline Embassy', unitNo: 'A-12-3', preparedBy: 'Lee', docDate: '2026-10-01', lastAmended: '2026-10-05',
  validUntil: '2026-10-31', intro: 'Thank you for choosing us.', termsNote: '50% deposit', termTemplateId: null,
  docDiscountSen: 50000, docDiscountLabel: 'Opening promo', promoLines: [{ text: 'Free curtain' }], brandId: 2,
  siteAddress: 'Jalan 1', propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: 3, bathrooms: 2,
  builtUpSqft: 1200, landAreaSqft: null, landSize: '', salespersonId: 'EMP-0001', state: 'Selangor', city: 'Shah Alam',
  postcode: '40000', country: 'Malaysia', salesLocation: 'Showroom',
};

describe('copiedHeader', () => {
  const out = copiedHeader(source, 2);

  it('clears who the customer is and where the work is', () => {
    for (const k of ['attention', 'customerName', 'customerPhone', 'customerEmail', 'building', 'unitNo', 'siteAddress', 'propertyType', 'layoutLabel', 'state', 'city', 'postcode'] as const) {
      expect(out[k]).toBe('');
    }
    expect([out.bedrooms, out.bathrooms, out.builtUpSqft]).toEqual([null, null, null]);
  });

  it('restarts the dates', () => {
    expect(out.docDate).not.toBe('2026-10-01');
    expect(out.lastAmended).toBeNull();
    expect(out.validUntil).toBeNull();
  });

  it("keeps the package's wording, discount and print setup", () => {
    expect(out.intro).toBe(source.intro);
    expect(out.termsNote).toBe(source.termsNote);
    expect(out.docDiscountSen).toBe(50000);
    expect(out.promoLines).toEqual(source.promoLines);
    expect(out.printFormat).toBe(source.printFormat);
    expect(out.brandId).toBe(2);
  });
});
