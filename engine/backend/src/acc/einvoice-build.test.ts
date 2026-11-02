import { describe, expect, it } from 'vitest';
import { buildEInvoice, lhdnStateCode, type EInvoiceBuyer, type EInvoiceDoc } from './einvoice-build';
import { EINVOICE_DEFAULTS, type EInvoiceSettings } from './einvoice-settings';

const S: EInvoiceSettings = {
  ...EINVOICE_DEFAULTS,
  seller: {
    tin: 'C12345678901', brn: '202001012345', sstNo: '', msicCode: '43301', activityDesc: 'Interior renovation works',
    address1: '1 Jalan Contoh', address2: '', city: 'Kuala Lumpur', postcode: '50000', stateCode: '14', phone: '+60312345678', email: 'acc@example.com',
  },
};
const DOC: EInvoiceDoc = { kind: 'INVOICE', number: 'SI-2611-0001', date: '2026-11-03', description: '1st Progress Billing for Interior Design & Renovation Works', amountSen: 1000000, references: [] };
const BUYER: EInvoiceBuyer = {
  name: 'MS LEE (SKYLINE D-25-13)', tin: 'IG12345678901', idType: 'NRIC', idNumber: '900101145678', sstNo: null,
  address1: 'D-25-13 Skyline Residence', address2: null, city: 'Kuala Lumpur', postcode: '50450', state: 'W.P. Kuala Lumpur',
  country: 'Malaysia', phone: '0123456789', email: null,
};

describe('buildEInvoice', () => {
  it('invoice with full buyer is READY', () => {
    const r = buildEInvoice(DOC, BUYER, S);
    expect(r.ok).toBe(true);
    const p = r.payload as Record<string, any>;
    expect(p).toMatchObject({ invoiceTypeCode: '01', id: 'SI-2611-0001', issueDate: '2026-11-03', currency: 'MYR' });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ classification: '022', taxType: '06', quantity: 1, unitPrice: '10000.00', subtotal: '10000.00', taxAmount: '0.00', totalExcludingTax: '10000.00' });
    expect(p.totals).toEqual({ excludingTax: '10000.00', includingTax: '10000.00', payable: '10000.00' });
    expect(p.supplier).toMatchObject({ tin: 'C12345678901', brn: '202001012345', sstNo: 'NA', msicCode: '43301', address: { stateCode: '14', country: 'MYS' } });
    expect(p.buyer).toMatchObject({ tin: 'IG12345678901', idType: 'NRIC', idNumber: '900101145678', address: { stateCode: '14', country: 'MYS' } });
  });

  it('individual with NRIC only uses general TIN', () => {
    const r = buildEInvoice(DOC, { ...BUYER, tin: null }, S);
    expect(r.ok).toBe(true);
    expect((r.payload as any).buyer).toMatchObject({ tin: 'EI00000000010', idType: 'NRIC', idNumber: '900101145678' });
  });

  it('foreign buyer with passport uses EI00000000020', () => {
    const r = buildEInvoice(DOC, { ...BUYER, tin: null, idType: 'PASSPORT', idNumber: 'A1234567', country: 'Singapore', state: null }, S);
    expect(r.ok).toBe(true);
    expect((r.payload as any).buyer).toMatchObject({ tin: 'EI00000000020', idType: 'PASSPORT', address: { stateCode: '17' } });
  });

  it('missing items listed in plain words', () => {
    const r = buildEInvoice(DOC, { ...BUYER, tin: null, idType: null, idNumber: null, address1: null, phone: null }, S);
    expect(r).toMatchObject({ ok: false, missing: ['buyer ID number', 'buyer address', 'buyer phone'] });
  });

  it('a company buyer without a TIN is missing its TIN', () => {
    const r = buildEInvoice(DOC, { ...BUYER, tin: null, idType: 'BRN', idNumber: '202001012345' }, S);
    expect(r).toMatchObject({ ok: false, missing: ['buyer TIN'] });
  });

  it('seller gaps are listed after the buyer ones', () => {
    const r = buildEInvoice(DOC, { ...BUYER, phone: null }, { ...S, seller: { ...S.seller, msicCode: '' } });
    expect(r).toMatchObject({ ok: false, missing: ['buyer phone', 'seller MSIC code'] });
  });

  it('buyer SST defaults to NA', () => {
    expect((buildEInvoice(DOC, BUYER, S).payload as any).buyer.sstNo).toBe('NA');
    expect((buildEInvoice(DOC, { ...BUYER, sstNo: 'W10-1808-31000001' }, S).payload as any).buyer.sstNo).toBe('W10-1808-31000001');
  });

  it("credit note carries type 02 and its references", () => {
    const r = buildEInvoice({ ...DOC, kind: 'CREDIT_NOTE', number: 'CN-2611-0001', amountSen: 600000, references: ['SI-2611-0001'] }, BUYER, S);
    expect(r.ok).toBe(true);
    expect(r.payload).toMatchObject({ invoiceTypeCode: '02', billingReferences: ['SI-2611-0001'], totals: { payable: '6000.00' } });
  });

  it('state names map to LHDN codes', () => {
    expect(lhdnStateCode('Selangor')).toBe('10');
    expect(lhdnStateCode('SELANGOR DARUL EHSAN')).toBe('10');
    expect(lhdnStateCode('Kuala Lumpur')).toBe('14');
    expect(lhdnStateCode('W.P. Kuala Lumpur')).toBe('14');
    expect(lhdnStateCode('Wilayah Persekutuan Kuala Lumpur')).toBe('14');
    expect(lhdnStateCode('KL')).toBe('14');
    expect(lhdnStateCode('Johor')).toBe('01');
    expect(lhdnStateCode('Johor Darul Takzim')).toBe('01');
    expect(lhdnStateCode('Penang')).toBe('07');
    expect(lhdnStateCode('Pulau Pinang')).toBe('07');
    expect(lhdnStateCode('Putrajaya')).toBe('16');
    expect(lhdnStateCode('Labuan')).toBe('15');
    expect(lhdnStateCode('Melaka')).toBe('04');
    expect(lhdnStateCode('Malacca')).toBe('04');
    expect(lhdnStateCode('Negeri Sembilan')).toBe('05');
    expect(lhdnStateCode('Mars')).toBeNull();
    expect(lhdnStateCode(null)).toBeNull();
    const r = buildEInvoice(DOC, { ...BUYER, state: 'Mars' }, S);
    expect(r).toMatchObject({ ok: false, missing: ['buyer state'] });
  });

  it('description over 300 characters is a missing item, never cut here', () => {
    const r = buildEInvoice({ ...DOC, description: 'x'.repeat(301) }, BUYER, S);
    expect(r).toMatchObject({ ok: false, missing: ['description over 300 characters'] });
  });

  it('a zero or negative amount is refused', () => {
    expect(buildEInvoice({ ...DOC, amountSen: 0 }, BUYER, S)).toMatchObject({ ok: false, missing: ['amount above zero'] });
  });
});
