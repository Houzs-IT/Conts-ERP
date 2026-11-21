/* A renovation instalment invoice through the ported Sales Invoice print: it keeps Conts' own — the brand letterhead
   (Dream Crafter), the project / unit rows and the line's room — and the brand's bank line is where the customer
   pays; an invoice with no brand keeps the company's payment details. Page numbers count within each invoice of a
   combined print. */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_BRANDING, clearBrandingLogoCache, setBrandingCache } from '../../../lib/branding';
import type { SiHeader, SiItem } from './sales-invoice-pdf';
import type { RenoDocInfo } from './renovation-doc-print';

vi.mock('../../../lib/renovation/api', () => ({
  renoGet: async () => ({
    brands: [{
      brandId: 2, name: 'Dream Crafter', color: '#000', logoR2Key: null, active: true, hasProfile: true,
      companyLines: ['DREAM CRAFTER SDN BHD (1234567-X)', 'No. 1, Jalan Contoh, 50000 Kuala Lumpur'], contactLine: '',
      bankLine: 'Payment shall be made payable to DREAM CRAFTER SDN BHD MBB 5000 1111 2222', termsLines: [], intro: '', signatoryCompany: '',
    }],
  }),
}));

type JsPdf = import('jspdf').jsPDF;
const capture = (doc: JsPdf): string[] => {
  const out: string[] = [];
  const original = doc.text.bind(doc);
  vi.spyOn(doc, 'text').mockImplementation(((...args: Parameters<typeof doc.text>) => {
    const [value] = args;
    for (const line of Array.isArray(value) ? value : [value]) out.push(String(line).trim());
    return original(...args);
  }) as typeof doc.text);
  return out;
};

const LABEL = '2nd Progress Billing for Interior Design & Renovation Works (35% as per Sales Order TC-SO-2611-033)';
const SI: SiHeader = {
  invoice_number: 'TC-SI-2611-007', status: 'SENT', so_doc_no: 'TC-SO-2611-033', debtor_code: null, debtor_name: 'Test Customer',
  invoice_date: '2026-11-20', due_date: null, currency: 'MYR', subtotal_sen: 3_500_000, discount_sen: 0, tax_sen: 0, total_sen: 3_500_000,
  paid_sen: 0, notes: LABEL, branding: 'Dream Crafter',
};
const ITEMS: SiItem[] = [{ id: 'line-1', item_code: 'RENO-PROGRESS', description: LABEL, qty: 1, unit_price_sen: 3_500_000, line_total_sen: 3_500_000 }];
const RENO: RenoDocInfo = {
  ready: true,
  info: { projectId: 7, projectCode: 'RN-2611-001', projectName: 'Vista Harmoni', building: 'Block B', unitNo: 'B-8-2', soDocNos: ['TC-SO-2611-033'], poNumbers: [] },
  lines: {},
};

afterEach(() => {
  setBrandingCache({ ...DEFAULT_BRANDING }, 'HOUZS');
  clearBrandingLogoCache();
  vi.restoreAllMocks();
});

async function render(header: SiHeader, reno: RenoDocInfo | null): Promise<string[]> {
  setBrandingCache({ ...DEFAULT_BRANDING, logoR2Key: '', customerPaymentDetails: 'COMPANY BANK 0000' }, 'HOUZS');
  const [{ jsPDF }, autoTable, { renderSalesInvoiceInto }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable').then((m) => m.default), import('./sales-invoice-pdf'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const draws = capture(doc);
  await renderSalesInvoiceInto(doc, autoTable, header, ITEMS, reno);
  return draws;
}
const joined = (d: string[]) => d.join(' ');

describe('a renovation instalment invoice', () => {
  test("prints under its brand, with the project, unit and the instalment's description, and the brand's bank line", async () => {
    const d = await render(SI, RENO);
    const all = joined(d);
    expect(all).toContain('DREAM CRAFTER SDN BHD');
    expect(all).toContain('RN-2611-001');
    expect(all).toContain('B-8-2');
    expect(all).toContain('2nd Progress Billing');
    expect(all).toContain('35%');
    expect(all).toContain('RM 35,000.00');
    expect(all).toContain('DREAM CRAFTER SDN BHD MBB 5000 1111 2222');
    expect(all).not.toContain('COMPANY BANK 0000');
    expect(/houzs|2990/i.test(all)).toBe(false);
  });

  test("without a brand: the company letterhead and the company's payment details", async () => {
    const d = await render({ ...SI, branding: null }, null);
    expect(joined(d)).toContain('COMPANY BANK 0000');
    expect(joined(d)).not.toContain('MBB 5000');
  });
});

describe('a combined print', () => {
  test('numbers each invoice from Page 1', async () => {
    setBrandingCache({ ...DEFAULT_BRANDING, logoR2Key: '' }, 'HOUZS');
    const [{ jsPDF }, autoTable, { renderSalesInvoiceInto }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable').then((m) => m.default), import('./sales-invoice-pdf'),
    ]);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const draws = capture(doc);
    await renderSalesInvoiceInto(doc, autoTable, { ...SI, branding: null }, ITEMS);
    doc.addPage();
    await renderSalesInvoiceInto(doc, autoTable, { ...SI, branding: null, invoice_number: 'TC-SI-2611-008' }, ITEMS);
    expect(draws.filter((t) => t === 'Page 1 of 1')).toHaveLength(2);
    expect(draws).not.toContain('Page 2 of 2');
  });
});
