// Owner, 4 Nov 2026: 「每一个 PDF 的排版是怎样的」. Real PDFs through the four real generators (SO, PO, DO, GR) with a real
// JPEG on the attachment list. The network and the canvas decode are stubbed, as in purchase-order-pdf-photos.test.ts.
// DOC_PHOTOS_PDF_DIR=<folder> writes each PDF there to look at. Setting DOC_PHOTOS_PDF_SRC=<file.jpg> uses a real photo.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoLhcYGRomJygkKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

type File_ = { id: string; kind: string; source: string };
type Listing = { ready: boolean; files: File_[]; lines: Array<{ id: string; files: File_[] }> };

let jpeg: Buffer;
let dataUrl: string;
let listing: Listing = { ready: true, files: [], lines: [] };
const seen: Array<{ type: string; id: string }> = [];

vi.mock('../../../components/doc-attachments/docAttachmentsApi', () => ({
  listDocFiles: async (type: string, id: string) => { seen.push({ type, id }); return listing; },
  fetchDocFileBlob: async () => new NodeBlob([jpeg], { type: 'image/jpeg' }) as unknown as Blob,
}));
vi.mock('./sales-order-queries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadSofaCompartmentArtForPrint: async () => new Map(),
}));

beforeAll(() => {
  jpeg = process.env.DOC_PHOTOS_PDF_SRC ? readFileSync(process.env.DOC_PHOTOS_PDF_SRC) : Buffer.from(TINY_JPEG_B64, 'base64');
  dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => ({ width: 600, height: 800, close() {} });
  const proto = globalThis.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = () => ({ fillStyle: '', fillRect() {}, drawImage() {} });
  proto.toDataURL = () => dataUrl;
});
beforeEach(() => { seen.length = 0; });

const image = (id: string, source = 'upload'): File_ => ({ id, kind: 'image', source });
const many = (prefix: string, n: number): File_[] => Array.from({ length: n }, (_, i) => image(`${prefix}${i}`));

const LINE = '11111111-1111-4111-8111-111111111111';
const item = { id: LINE, item_code: 'TILE-600', description: 'Floor tile', material_name: 'Floor tile', qty: 1, uom: 'UNIT', unit_price_sen: 1000,
  line_total_sen: 1000, qty_received: 1, qty_accepted: 1, qty_rejected: 0, rejection_reason: null, item_group: 'others', variants: {}, photo_urls: [] };

/* Every generator's output as bytes, drawn through the same function its print and preview buttons use. */
const render: Record<string, () => Promise<Buffer>> = {
  so: async () => {
    const { renderSalesOrderInto } = await import('./sales-order-pdf');
    type A = Parameters<typeof renderSalesOrderInto>;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await renderSalesOrderInto(doc, autoTable as unknown as A[1],
      { doc_no: 'TC-SO-1', currency: 'MYR', customer_name: 'TEST', status: 'DRAFT' } as unknown as A[2], [item] as unknown as A[3]);
    return Buffer.from(doc.output('arraybuffer'));
  },
  po: async () => {
    const { purchaseOrderPdfBase64 } = await import('./purchase-order-pdf');
    type A = Parameters<typeof purchaseOrderPdfBase64>;
    return Buffer.from(await purchaseOrderPdfBase64(
      { id: 'po-1', po_number: 'TC-PO-1', supplier_id: null, status: 'SUBMITTED', po_date: '2026-11-04', currency: 'MYR', subtotal_sen: 1000, tax_sen: 0,
        total_sen: 1000, supplier: { code: 'S', name: 'TEST SUPPLIER' } } as unknown as A[0],
      [item] as unknown as A[1],
    ), 'base64');
  },
  do: async () => {
    const { renderDeliveryOrderInto } = await import('./delivery-order-pdf');
    type A = Parameters<typeof renderDeliveryOrderInto>;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await renderDeliveryOrderInto(doc, autoTable as unknown as A[1],
      { id: 'do-1', do_number: 'TC-DO-1', debtor_name: 'TEST', status: 'DRAFT' } as unknown as A[2], [item] as unknown as A[3]);
    return Buffer.from(doc.output('arraybuffer'));
  },
  gr: async () => {
    const { renderGrnInto } = await import('./grn-pdf');
    type A = Parameters<typeof renderGrnInto>;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await renderGrnInto(doc, autoTable, { id: 'gr-1', grn_number: 'TC-GR-1', status: 'POSTED', received_at: '2026-11-04', delivery_note_ref: null, notes: null,
      posted_at: null, supplier: { code: 'S', name: 'TEST SUPPLIER' } } as unknown as A[2], [item] as unknown as A[3]);
    return Buffer.from(doc.output('arraybuffer'));
  },
};

const pagesOf = (raw: string) => (raw.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
const out = (name: string, pdf: Buffer) => {
  const dir = process.env.DOC_PHOTOS_PDF_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.pdf`, pdf);
};

describe.each(['so', 'po', 'do', 'gr'])('%s PDF photos', (kind) => {
  it('adds no photo block and no page when the document has no photos', async () => {
    listing = { ready: true, files: [], lines: [{ id: LINE, files: [] }] };
    const pdf = await render[kind]!();
    const raw = pdf.toString('latin1');
    out(`${kind}-none`, pdf);
    expect(raw).not.toContain('PHOTOS');
    expect(raw).not.toContain('/Subtype /Image');
    expect(pagesOf(raw)).toBe(1);
  });

  it('prints one line photo under ITEM PHOTOS, keyed to its row', async () => {
    listing = { ready: true, files: [], lines: [{ id: LINE, files: [image('a')] }] };
    const pdf = await render[kind]!();
    const raw = pdf.toString('latin1');
    out(`${kind}-one`, pdf);
    expect(raw).toContain('ITEM PHOTOS');
    expect(raw).toContain('Item 1');
    expect(raw).toContain('\\(photo\\)');
    expect(raw).toContain('/Subtype /Image');
  });

  it('prints line and document photos together, however many', async () => {
    listing = { ready: true, files: many('d', 4), lines: [{ id: LINE, files: many('l', 7) }] };
    const pdf = await render[kind]!();
    const raw = pdf.toString('latin1');
    out(`${kind}-several`, pdf);
    expect(raw).toContain('Item 1');
    expect(raw).toContain('Document');
    expect(pagesOf(raw)).toBeGreaterThan(1);
  });

  it('breaks a line with more photos than one page holds', async () => {
    listing = { ready: true, files: [], lines: [{ id: LINE, files: many('l', 14) }] };
    const pdf = await render[kind]!();
    const raw = pdf.toString('latin1');
    out(`${kind}-fourteen`, pdf);
    expect(raw).toContain('Item 1 \\(cont.\\)');
  });

  it('calls it PHOTOS when only the whole document has photos, and leaves videos out', async () => {
    listing = { ready: true, files: [image('d'), { id: 'v', kind: 'video', source: 'upload' }], lines: [{ id: LINE, files: [] }] };
    const pdf = await render[kind]!();
    const raw = pdf.toString('latin1');
    out(`${kind}-document`, pdf);
    expect(raw).toContain('(PHOTOS)');
    expect(raw).not.toContain('\\(photo\\)');
  });
});

describe('the proof photos', () => {
  it('print under their own label on the delivery and the goods receipt', async () => {
    listing = { ready: true, files: [image('pod', 'pod'), image('pod-1', 'pod')], lines: [{ id: LINE, files: [] }] };
    const delivery = (await render.do!()).toString('latin1');
    const receipt = (await render.gr!()).toString('latin1');
    expect(delivery).toContain('Proof of delivery');
    expect(receipt).toContain('Proof of receipt');
  });
});

describe('a document with no address of its own', () => {
  it('a consignment receive (no id) asks for no photos', async () => {
    const { loadDocPdfPhotos } = await import('./pdf-doc-photos');
    const none = await loadDocPdfPhotos('goods_received', undefined);
    expect(seen).toHaveLength(0);
    expect(none.documentGroups).toEqual([]);
    expect(none.lineKeys('x')).toEqual([]);
  });
});
