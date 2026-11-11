/* What the owner saw on a printed PO (5 Nov 2026): a long project ran past the page margin, and the page number stopped
   short of it. Measured on the text as drawn, in the same way as document-print-layout.test.ts. */
import { describe, expect, test, vi } from 'vitest';

vi.mock('./sales-order-queries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadSofaCompartmentArtForPrint: async () => new Map(),
}));

const PAGE_W = 210;
const MARGIN = 14;

describe('the printed PO stays inside the page margin', () => {
  test('a long value in the right column wraps', async () => {
    const { jsPDF } = await import('jspdf');
    const { drawInfoColumns } = await import('./pdf-common');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const drawn: Array<{ text: string; x: number }> = [];
    const text = doc.text.bind(doc);
    vi.spyOn(doc, 'text').mockImplementation(((v: string | string[], x: number, y: number, o?: unknown) => {
      for (const t of Array.isArray(v) ? v : [v]) drawn.push({ text: t, x });
      return text(v, x, y, o as never);
    }) as never);
    doc.setFontSize(9);
    drawInfoColumns(doc, 60, { title: 'SUPPLIER', rows: [] }, {
      title: 'PO DETAILS',
      rows: [['Project Name', 'TESTING MS PEACOCK MEDIUM RM37955 WITH A VERY LONG UNIT NAME AND MORE']],
    }, 14);
    const lines = drawn.filter((d) => d.text.includes('TESTING') || d.text.includes('UNIT') || d.text.includes('MORE'));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.x + doc.getTextWidth(l.text)).toBeLessThanOrEqual(PAGE_W - MARGIN + 0.5);
  });
});
