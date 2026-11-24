/* The Official Receipt print (the owner's Claude Design, batch 5 §9: A5
   landscape, half an A4 sheet) — what it DRAWS, captured off `doc.text` the way
   credit-note-pdf.test.ts does. Pinned: OFFICIAL RECEIPT with its number and
   date; RECEIVED FROM beside PAYMENT DETAILS (method, paid on, the order, who
   confirmed the money — or the counter, for cash); the one line `Payment for
   sales order <SO>`; AMOUNT RECEIVED; the words; Received by and the chop —
   inside the half sheet; a draft's DRAFT and a cancelled one's CANCELLED; a
   sales invoice's payment never prints the invoice's id as an order. */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_BRANDING, clearBrandingLogoCache, setBrandingCache } from '../../../lib/branding';
import type { ReceiptPdfData } from './receipt-pdf';

type JsPdf = import('jspdf').jsPDF;
type TextDraw = { text: string; y: number };
function captureTextDraws(doc: JsPdf): TextDraw[] {
  const draws: TextDraw[] = [];
  const original = doc.text.bind(doc);
  vi.spyOn(doc, 'text').mockImplementation(((...args: Parameters<typeof doc.text>) => {
    const [value, , y] = args;
    if (typeof y === 'number') {
      const lines = Array.isArray(value) ? value.map(String) : [String(value)];
      for (const line of lines) draws.push({ text: line.trim(), y });
    }
    return original(...args);
  }) as typeof doc.text);
  return draws;
}
afterEach(() => {
  setBrandingCache({ ...DEFAULT_BRANDING }, 'HOUZS');
  clearBrandingLogoCache();
  vi.restoreAllMocks();
});

const OR: ReceiptPdfData = {
  or_number: 'TC-OR-2610-031', status: 'FORMAL', doc_no: 'TC-SO-2610-011', customer_name: 'Larding Chen',
  method: 'transfer', amount_sen: 111_500, paid_at: '2026-10-13', issued_at: '2026-10-14T02:00:00Z', issued_by: 'Ivy',
};

async function render(over: Partial<ReceiptPdfData> = {}): Promise<{ draws: TextDraw[]; doc: JsPdf }> {
  setBrandingCache({ ...DEFAULT_BRANDING, logoR2Key: '' }, 'HOUZS');
  const [{ jsPDF }, autoTable, { renderReceiptInto }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable').then((m) => m.default), import('./receipt-pdf'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'landscape' });
  const draws = captureTextDraws(doc);
  renderReceiptInto(doc, autoTable as unknown as Parameters<typeof renderReceiptInto>[1], { ...OR, ...over });
  return { draws, doc };
}
/* Joined, because a long value in the right info column now wraps onto a second line (drawInfoColumns). */
const has = (draws: TextDraw[], needle: string): boolean => draws.map((d) => d.text).join(' ').includes(needle);

describe('the official receipt — A5 landscape', () => {
  test('who paid, how and when, for which order, who confirmed it; the amount in a line, in figures and in words', async () => {
    const { draws, doc } = await render({ address_lines: ['12 Jalan Satu', '46000 Petaling Jaya'], phone: '012-345 6789', email: 'larding@example.com' });
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(148, 0);
    expect(has(draws, 'OFFICIAL RECEIPT')).toBe(true);
    expect(has(draws, 'OR No: TC-OR-2610-031')).toBe(true);
    expect(has(draws, 'RECEIVED FROM')).toBe(true);
    expect(has(draws, 'Larding Chen')).toBe(true);
    expect(has(draws, '12 Jalan Satu')).toBe(true);
    expect(has(draws, 'larding@example.com')).toBe(true);
    expect(has(draws, 'PAYMENT DETAILS')).toBe(true);
    expect(has(draws, ': 13/10/2026')).toBe(true);
    expect(has(draws, ': TC-SO-2610-011')).toBe(true);
    expect(has(draws, ': Ivy · 14/10/2026')).toBe(true);
    expect(has(draws, 'Payment for sales order TC-SO-2610-011')).toBe(true);
    expect(has(draws, 'AMOUNT RECEIVED')).toBe(true);
    expect(has(draws, 'RM 1,115.00')).toBe(true);
    expect(has(draws, 'RINGGIT (IN WORDS)')).toBe(true);
    expect(has(draws, 'RINGGIT MALAYSIA ONE THOUSAND ONE HUNDRED')).toBe(true);
    expect(has(draws, 'Received by')).toBe(true);
    expect(has(draws, 'Company chop')).toBe(true);
    expect(has(draws, 'DRAFT')).toBe(false);
    /* Everything sits inside the half sheet. */
    expect(Math.max(...draws.map((d) => d.y))).toBeLessThan(148);
  });

  test('cash is received at the counter; a draft prints with no status and no watermark (chew, 24 Nov 2026)', async () => {
    const cash = await render({ method: 'cash', issued_by: null });
    expect(has(cash.draws, 'Cash received at the counter · 14/10/2026')).toBe(true);
    const draft = await render({ status: 'DRAFT', issued_at: null, issued_by: null });
    expect(has(draft.draws, 'Draft')).toBe(false);
    expect(has(draft.draws, 'Status')).toBe(false);
    expect(draft.draws.some((d) => d.text === 'DRAFT')).toBe(false);
  });

  test('a cancelled receipt prints CANCELLED with its reason; a sales invoice payment prints its order, never the invoice id', async () => {
    const cancelled = await render({ status: 'CANCELLED', cancel_reason: 'Payment on TC-SO-2610-011 deleted' });
    expect(has(cancelled.draws, 'Cancelled · Payment on TC-SO-2610-011 deleted')).toBe(true);
    expect(cancelled.draws.some((d) => d.text === 'CANCELLED')).toBe(true);
    const si = await render({ payment_source: 'SIPAY', doc_no: '6f1c0d52-0000-4000-8000-000000000001', sales_order: null });
    expect(has(si.draws, '6f1c0d52')).toBe(false);
    expect(has(si.draws, 'Payment received')).toBe(true);
    const siWithOrder = await render({ payment_source: 'SIPAY', doc_no: '6f1c0d52-0000-4000-8000-000000000001', sales_order: 'TC-SO-2610-020' });
    expect(has(siWithOrder.draws, 'Payment for sales order TC-SO-2610-020')).toBe(true);
  });
});

describe('Conts: the receipt names the invoice the money is for, and prints under the order brand', () => {
  test('an invoice beside the SO (chew, 21 Nov 2026); without one, the SO alone', async () => {
    const both = await render({ invoice_no: 'TC-SI-2611-007', doc_no: 'TC-SO-2611-033' });
    // The order and the invoice on lines of their own (chew, 21 Nov 2026).
    expect(has(both.draws, ': TC-SO-2611-033')).toBe(true);
    expect(has(both.draws, ': TC-SI-2611-007')).toBe(true);
    expect(has(both.draws, ': TC-SO-2611-033 · Invoice TC-SI-2611-007')).toBe(false);
    expect(has(both.draws, 'Payment for sales order TC-SO-2611-033 · Invoice TC-SI-2611-007')).toBe(true);
    const camel = await render({ invoiceNo: 'TC-SI-2611-008', doc_no: 'TC-SO-2611-034' });
    expect(has(camel.draws, ': TC-SI-2611-008')).toBe(true);
    const soOnly = await render({ invoice_no: null, doc_no: 'TC-SO-2611-035' });
    expect(has(soOnly.draws, ': TC-SO-2611-035')).toBe(true);
    expect(has(soOnly.draws, 'Invoice')).toBe(false);
  });

  test("an invoice payment's doc_no is the invoice number in Conts: it prints as the invoice, beside its order", async () => {
    const si = await render({ payment_source: 'SIPAY', doc_no: 'TC-SI-2611-009', sales_order: 'TC-SO-2611-036' });
    expect(has(si.draws, 'Payment for sales order TC-SO-2611-036 · Invoice TC-SI-2611-009')).toBe(true);
    const noOrder = await render({ payment_source: 'SIPAY', doc_no: 'TC-SI-2611-010', sales_order: null });
    expect(has(noOrder.draws, 'Payment for Invoice TC-SI-2611-010')).toBe(true);
  });

  test("the brand's letterhead when the order carries one; never a Houzs name", async () => {
    setBrandingCache({ ...DEFAULT_BRANDING, logoR2Key: '' }, 'HOUZS');
    const [{ jsPDF }, autoTable, { renderReceiptInto }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable').then((m) => m.default), import('./receipt-pdf'),
    ]);
    const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'landscape' });
    const draws = captureTextDraws(doc);
    renderReceiptInto(doc, autoTable as unknown as Parameters<typeof renderReceiptInto>[1], OR,
      { name: 'Dream Crafter', logo: null, lines: ['DREAM CRAFTER SDN BHD', 'Kuala Lumpur'] });
    expect(has(draws, 'DREAM CRAFTER SDN BHD')).toBe(true);
    expect(draws.some((d) => /houzs|2990/i.test(d.text))).toBe(false);
  });
});
