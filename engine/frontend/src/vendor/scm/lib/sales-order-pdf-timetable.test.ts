/* The project's Export timetable (owner, 17 and 18 Nov 2026): the sales order's PDF with each line's processing and
 * delivery dates, and nothing about money and no signatures. The assertion is on what the generator drew. */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_BRANDING, clearBrandingLogoCache, setBrandingCache } from '../../../lib/branding';

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

async function printed(timetable: boolean): Promise<string[]> {
  setBrandingCache({ ...DEFAULT_BRANDING, logoR2Key: '' }, 'HOUZS');
  const [{ jsPDF }, { default: autoTable }, { renderSalesOrderInto }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('./sales-order-pdf'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const drawn = captureText(doc);
  await renderSalesOrderInto(doc, autoTable, {
    doc_no: 'TC-SO-1', so_date: '2026-11-07', status: 'RENO_CONFIRMED',
    debtor_code: 'C-1', debtor_name: 'Test Customer', agent: null,
    branding: null, venue: null, ref: null, po_doc_no: null, phone: null,
    address1: '1 Jalan Test', address2: null, address3: null, address4: null,
    mattress_sofa_sen: 0, bedframe_sen: 0, accessories_sen: 0, others_sen: 0,
    local_total_sen: 300000, line_count: 1, currency: 'MYR', note: null, paid_sen_total: 0,
  }, [{
    id: 'a', item_group: 'RENOVATION', item_code: 'RN-PAINTING', description: 'Works - Painting', uom: 'LOT',
    qty: 1, unit_price_sen: 300000, discount_sen: 0, total_sen: 300000, variants: null,
  }], [], [], {
    rooms: { order: ['Common area'], byItem: { a: 'Common area' } },
    ...(timetable ? { docTitle: 'TIMETABLE', timetable: { a: { orderOn: '2026-11-09', deliverOn: '2026-11-20' } } } : {}),
  });
  return drawn;
}

describe('sales order PDF: the timetable', () => {
  test('prints the dates and nothing about money or signatures', async () => {
    const drawn = await printed(true);
    expect(drawn).toContain('Processing');
    expect(drawn).toContain('09/11/2026');
    expect(drawn).toContain('20/11/2026');
    for (const word of ['RM', 'Amount', 'Subtotal', 'TOTAL', 'Payment Terms', 'Signature', 'PAYMENTS RECEIVED']) {
      expect(drawn.filter((t) => t.includes(word))).toEqual([]);
    }
  });

  test('the sales order itself still prints its money and signatures', async () => {
    const drawn = await printed(false);
    expect(drawn.some((t) => t.includes('RM 3,000.00'))).toBe(true);
    expect(drawn).toContain('Customer Signature');
  });
});
