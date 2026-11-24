// A renovation PO line prints its category but not its room (owner, 24 Nov 2026).
import { expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
vi.mock('../../../hooks/useBranding', () => ({ ensureBrandingForActiveCompany: async () => {} }));
vi.mock('./sales-order-queries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadSofaCompartmentArtForPrint: async () => new Map(),
}));

type PoArgs = Parameters<typeof import('./purchase-order-pdf').generatePurchaseOrderPdf>;

it('prints the line category and no Room on a renovation PO', async () => {
  const { generatePurchaseOrderPdf } = await import('./purchase-order-pdf');
  const header: PoArgs[0] = {
    id: 'po-1', po_number: 'TC-PO-2611-014', supplier_id: null, status: 'SUBMITTED',
    po_date: '2026-11-24', expected_at: '2026-12-20', currency: 'MYR',
    subtotal_sen: 300000, tax_sen: 0, total_sen: 300000, notes: null,
    source_so_doc_no: 'TC-SO-2611-001', purchase_location_name: 'ON-SITE',
    supplier: { code: '400-B001', name: 'BUILT-IN WORKS SDN BHD' },
  };
  const items: PoArgs[1] = [
    {
      id: 'l1', line_no: 1, item_code: 'RN-KITCHEN_CABINET', material_name: 'Built-in - Kitchen cabinet',
      supplier_sku: 'RN-KITCHEN_CABINET', qty: 1, unit_price_sen: 300000, line_total_sen: 300000, uom: 'FT',
      item_group: 'renovation', variants: {}, notes: 'Tall cabinet, soft-close hinges', delivery_date: '2026-12-10', so_doc_no: 'TC-SO-2611-001',
    },
  ];
  let pdf = '';
  await generatePurchaseOrderPdf(header, items, {
    renovation: {
      ready: true,
      info: null,
      lines: { l1: { room: 'Common area', categoryGroup: 'BUILTIN', subCategory: '' } },
    },
    appendAfter: async (doc) => {
      const bytes = Buffer.from(doc.output('arraybuffer'));
      if (process.env.PO_RENO_PDF_OUT) writeFileSync(process.env.PO_RENO_PDF_OUT, bytes);
      pdf = bytes.toString('latin1');
    },
  });
  expect(pdf).toContain('(Built-in)');
  expect(pdf).toContain('Remark: Tall cabinet');
  expect(pdf).not.toContain('Room:');
  expect(pdf).not.toContain('Common area');
  expect(pdf).not.toContain('Delivery: ');
});
