import { afterEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_BRANDING, clearBrandingLogoCache, setBrandingCache } from '../../../lib/branding';
import { ALL_SO_PDF_COLUMNS, type SoPdfColumns } from './sales-order-pdf';

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

async function printedText(unticked: Partial<SoPdfColumns> = {}): Promise<string[]> {
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
    columns: { ...ALL_SO_PDF_COLUMNS, ...unticked },
  });
  return drawn;
}

describe('sales order PDF: column ticks', () => {
  test('unticking Price drops the Unit Price column and keeps description, qty, discount and amount', async () => {
    const drawn = await printedText({ price: false });
    expect(drawn.filter((text) => text.includes('Unit Price'))).toEqual([]);
    expect(drawn.filter((text) => text.includes('RM 1,500.00'))).toEqual([]);
    expect(drawn).toContain('Works - Electrical - Looping new socket');
    expect(drawn).toContain('2 POINT');
    expect(drawn).toContain('Discount');
    expect(drawn.some((text) => text.includes('RM 3,000.00'))).toBe(true);
  });

  test('unticking Amount blanks the line amount under SubTotal (RM) and keeps the room subtotal and totals', async () => {
    const amounts = (drawn: string[]) => drawn.filter((text) => text.includes('RM 3,000.00')).length;
    const shown = await printedText();
    const drawn = await printedText({ price: false, discount: false, amount: false });
    expect(drawn.filter((text) => text.includes('Unit Price') || text === 'Discount' || text.includes('RM 1,500.00'))).toEqual([]);
    expect(drawn).toContain('2 POINT');
    expect(drawn).toContain('SubTotal (RM)');
    expect(drawn).not.toContain('Amount (RM)');
    expect(drawn).toContain('Subtotal - Wiring works');
    expect(amounts(drawn)).toBe(amounts(shown) - 1);
    expect(amounts(drawn)).toBeGreaterThan(0);
  });

  test('unticking Unit prints the bare qty; unticking Qty prints the unit alone', async () => {
    expect(await printedText({ unit: false })).toContain('2');
    expect(await printedText({ unit: false })).not.toContain('2 POINT');
    const unitOnly = await printedText({ qty: false });
    expect(unitOnly).toContain('POINT');
    expect(unitOnly).toContain('Unit');
  });

  test('unticking Qty and Unit drops the column', async () => {
    const drawn = await printedText({ qty: false, unit: false });
    expect(drawn).not.toContain('Qty');
    expect(drawn).not.toContain('2 POINT');
  });

  test('prints every column by default', async () => {
    const drawn = await printedText();
    expect(drawn).toContain('Unit Price');
    expect(drawn).toContain('Amount (RM)');
    expect(drawn).toContain('2 POINT');
    expect(drawn.some((text) => text.includes('RM 1,500.00'))).toBe(true);
  });
});
