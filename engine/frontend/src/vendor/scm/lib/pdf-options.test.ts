/* Ported from Houzs ERP (#5552), narrowed to the papers handed to a customer here:
   - the official receipt, the sales invoice and the deposit invoice spread PDF_COMPRESS, and it really shrinks the file;
   - docPageLabel counts within one document of a batch print. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_BRANDING, clearBrandingLogoCache, setBrandingCache } from '../../../lib/branding';
import { docPageLabel } from './pdf-common';
import { PDF_COMPRESS } from './pdf-options';

afterEach(() => {
  setBrandingCache({ ...DEFAULT_BRANDING }, 'HOUZS');
  clearBrandingLogoCache();
  vi.restoreAllMocks();
});

describe('PDF compression', () => {
  test('every jsPDF the three customer papers construct spreads PDF_COMPRESS', () => {
    for (const f of ['receipt-pdf.ts', 'sales-invoice-pdf.ts', 'deposit-invoice-pdf.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      const made = [...src.matchAll(/new jsPDF\(([^)]*)/g)];
      expect(made.length, f).toBeGreaterThan(0);
      for (const m of made) expect(m[1], f).toContain('...PDF_COMPRESS');
    }
  });

  test('a compressed invoice is smaller than the same invoice uncompressed', async () => {
    setBrandingCache({ ...DEFAULT_BRANDING, logoR2Key: '' }, 'HOUZS');
    const [{ jsPDF }, { default: autoTable }, { renderSalesInvoiceInto }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable'), import('./sales-invoice-pdf'),
    ]);
    const size = async (compress: boolean): Promise<number> => {
      const doc = new jsPDF(compress ? { ...PDF_COMPRESS, unit: 'mm', format: 'a4' } : { unit: 'mm', format: 'a4' });
      await renderSalesInvoiceInto(doc, autoTable, {
        invoice_number: 'TC-SI-2611-001', status: 'SENT', so_doc_no: 'TC-SO-2611-001', debtor_code: null, debtor_name: 'Test Customer',
        invoice_date: '2026-11-20', due_date: null, currency: 'MYR', subtotal_sen: 0, discount_sen: 0, tax_sen: 0, total_sen: 0, paid_sen: 0, notes: null,
      }, Array.from({ length: 60 }, (_, i) => ({ item_code: `L-${i}`, description: `Line ${i}`, qty: 1, unit_price_sen: 100, line_total_sen: 100 })));
      return doc.output('arraybuffer').byteLength;
    };
    expect(await size(true)).toBeLessThan((await size(false)) / 2);
  });
});

describe('batch page numbers', () => {
  test('docPageLabel counts within the document', () => {
    expect(docPageLabel(3, 3, 4)).toBe('Page 1 of 2');
    expect(docPageLabel(4, 3, 4)).toBe('Page 2 of 2');
    expect(docPageLabel(1, 1, 1)).toBe('Page 1 of 1');
  });
});
