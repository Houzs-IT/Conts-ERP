import { describe, expect, test } from 'vitest';
import { docTypeOf, parseCsv } from './DocumentFilesImport';

describe('Import document files: the owner\'s folder and CSV', () => {
  test('document type folders and CSV values: short names, full names, any case', () => {
    expect(docTypeOf('PO')).toBe('purchase_order');
    expect(docTypeOf('grn')).toBe('goods_received');
    expect(docTypeOf('GR')).toBe('goods_received');
    expect(docTypeOf('Delivery order')).toBe('delivery_order');
    expect(docTypeOf('purchase_invoice')).toBe('purchase_invoice');
    expect(docTypeOf('DN')).toBe('credit_note');
    expect(docTypeOf('Credit / debit note')).toBe('credit_note');
    expect(docTypeOf('XYZ')).toBeNull();
  });

  test('CSV with quotes, commas inside quotes, blank cells and Windows line ends', () => {
    const rows = parseCsv('file,type,document,line,caption\r\n"a, b.jpg",PO,PO-1,,"Said ""ok"""\r\nc.pdf,DO,DO-2,2,\r\n\r\n');
    expect(rows).toEqual([
      ['file', 'type', 'document', 'line', 'caption'],
      ['a, b.jpg', 'PO', 'PO-1', '', 'Said "ok"'],
      ['c.pdf', 'DO', 'DO-2', '2', ''],
    ]);
  });
});
