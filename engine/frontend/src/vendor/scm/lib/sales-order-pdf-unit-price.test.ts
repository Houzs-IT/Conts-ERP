import { afterEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_BRANDING, clearBrandingLogoCache, setBrandingCache } from '../../../lib/branding';
import type { UnitPriceChoice } from './sales-order-pdf';

type JsPdf = import('jspdf').jsPDF;

function captureText(doc: JsPdf): string[] {
  const drawn: string[] = [];
  const original = doc.text.bind(doc);
  vi.spyOn(doc, 'text').mockImplementation(((...args: Parameters<typeof doc.text>) => {
    const [value] = args;
    for (const line of Array.isArray(value) ? value.map(String) : [String(value)]) drawn.push(line.trim());
    return original(...args);
  }) as typeof doc.text);
  return drawn;
}

afterEach(() => {
  setBrandingCache({ ...DEFAULT_BRANDING }, 'HOUZS');
  clearBrandingLogoCache();
  vi.restoreAllMocks();
});

async function printedText(unitPrice: UnitPriceChoice): Promise<string[]> {
  setBrandingCache({ ...DEFAULT_BRANDING, logoR2Key: '' }, 'HOUZS');
  const [{ jsPDF }, { default: autoTable }, { renderSalesOrderInto }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('./sales-order-pdf'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const drawn = captureText(doc);
  await renderSalesOrderInto(doc, autoTable, {
    doc_no: 'TC-SO-2', so_date: '2026-11-19', status: 'RENO_CONFIRMED',
    debtor_code: 'C-1', debtor_name: 'Test Customer', agent: null,
    branding: null, venue: null, ref: null, po_doc_no: null, phone: null,
    address1: '1 Jalan Test', address2: null, address3: null, address4: null,
    mattress_sofa_sen: 0, bedframe_sen: 0, accessories_sen: 0, others_sen: 0,
    local_total_sen: 300000, line_count: 1, currency: 'MYR', note: null, paid_sen_total: 0,
  }, [{
    id: 'a', item_group: 'RENOVATION', item_code: 'RN-WIRING', description: 'Works - Electrical - Looping new socket', uom: 'POINT',
    qty: 2, unit_price_sen: 150000, discount_sen: 0, total_sen: 300000, variants: null,
  }], [], [], {
    rooms: { order: ['Wiring works'], byItem: { a: 'Wiring works' } },
    unitPrice,
  });
  return drawn;
}

describe('sales order PDF: hiding the unit price', () => {
  test('drops the Unit Price column and keeps description, qty, discount and amount', async () => {
    const drawn = await printedText('hide');
    expect(drawn.filter((text) => text.includes('Unit Price'))).toEqual([]);
    expect(drawn.filter((text) => text.includes('RM 1,500.00'))).toEqual([]);
    expect(drawn).toContain('Works - Electrical - Looping new socket');
    expect(drawn).toContain('2 POINT');
    expect(drawn).toContain('Discount');
    expect(drawn.some((text) => text.includes('RM 3,000.00'))).toBe(true);
  });

  test('total prints only qty and the line subtotal', async () => {
    const drawn = await printedText('total');
    expect(drawn.filter((text) => text.includes('Unit Price') || text === 'Discount' || text.includes('RM 1,500.00'))).toEqual([]);
    expect(drawn).toContain('2 POINT');
    expect(drawn).toContain('SubTotal (RM)');
    expect(drawn.some((text) => text.includes('RM 3,000.00'))).toBe(true);
  });

  test('prints the unit price by default', async () => {
    const drawn = await printedText('show');
    expect(drawn).toContain('Unit Price');
    expect(drawn.some((text) => text.includes('RM 1,500.00'))).toBe(true);
  });
});
