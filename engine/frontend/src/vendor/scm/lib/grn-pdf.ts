// Goods Receipt Note PDF — printable for warehouse / supplier reconciliation.
// Dual-code layout (Commander): supplier sees THEIR code first, ours alongside;
// fabric specs show the supplier's colour code with our internal code in ().
//
// 2026-06-19 — adopts the unified "Hookka-tidy" layout shared with SO/PO/DO/SI:
// real letterhead header, the drawInfoColumns info block (SUPPLIER label-gutter +
// GRN DETAILS colon-aligned), and the consistent footer (doc no · portal · page
// n of m) on every page. A4 portrait, pure B&W. No field dropped.
import {
  orderSofaModuleRowsWithinBuilds,
  sortSoLinesByGroupRank,
} from '@2990s/shared/so-line-display';
import { formatPhone } from '@2990s/shared/phone';
import { COMPANY, DOC_TABLE_HEAD_STYLES, DOC_TABLE_STYLES, deliverPdf, drawHeader, drawInfoColumns, drawSignatureBoxes, ensurePdfCjkFont, fmtRm, safeName, fmtDocDate, type PdfAction } from './pdf-common';
import { supplierBlock } from './pdf-party-blocks';
import { loadSupplierDocData, supplierCodeFor, docVariantLine } from './supplier-doc-data';
/* The status WORD comes from the one home for it, never from a caser here:
   what this document prints and what the screen shows must be the same word.
   docs/modules/document-status-vocabulary.md §1. */
import { statusLabel } from './status-pill';
import { renoDetailRows, renoLineNote, type RenoDocInfo } from './renovation-doc-print';
import {
  appendPhotoMarker,
  blobToSquarePdfImage,
  buildPhotoGroups,
  collectPhotoImages,
  drawItemPhotosBlock,
  type PdfPhotoImage,
} from './pdf-item-photos';
import { loadDocPdfPhotos } from './pdf-doc-photos';
import { warehouseLine } from './warehouse-print';

type GrnHeader = {
  /* Row id: the photos are read by it. A consignment receive has none and prints no photos. */
  id?: string | null;
  grn_number: string; status: string;
  received_at: string; delivery_note_ref: string | null;
  notes: string | null; posted_at: string | null;
  supplier_id?: string | null;
  warehouse_id?: string | null;
  supplier?: { code: string; name: string };
  purchase_order?: { id: string; po_number: string };
};
type GrnItem = {
  /* Line id: pairs the line with its renovation room / category (mig 0116). */
  id?: string | null;
  item_code: string; material_name: string;
  qty_received: number; qty_accepted: number; qty_rejected: number;
  rejection_reason: string | null; unit_price_sen: number;
  /* Dual-code extras — all optional so older call sites keep compiling. */
  supplier_sku?: string | null;
  item_group?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
};

/* Draw ONE GRN's content into `doc` (letterhead → info → codes note → table →
   signature → footer). Mirrors renderPurchaseOrderInto: the per-doc supplier
   lookup stays inside, but `new jsPDF` / `doc.save` belong to the caller, so
   several GRNs can share one doc (batch "Export PDF"). The footer loop runs over
   THIS doc's own pages (startPage…current) so a combined doc footers each GRN's
   page span without re-footering earlier GRNs. */
export async function renderGrnInto(
  doc: import('jspdf').jsPDF,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoTable: any,
  header: GrnHeader,
  items: GrnItem[],
  /* renovation: project and each line's room / category (mig 0116). */
  opts?: { docTitle?: string; docNoLabel?: string; renovation?: RenoDocInfo | null },
): Promise<void> {
  /* Before ANY drawing: a customer / supplier name, address or remark that
     carries CJK needs the font embedded up front, or helvetica silently paints
     the whole field as mojibake. No-op for a pure-WinAnsi document. */
  await ensurePdfCjkFont(doc, [header, items]);

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const startPage = doc.getNumberOfPages();

  let y = drawHeader(doc, {
    docTitle: opts?.docTitle ?? 'GOODS RECEIPT NOTE',
    rightMeta: [
      { label: opts?.docNoLabel ?? 'GRN No', value: header.grn_number },
      { label: 'Date', value: fmtDocDate(header.received_at) },
    ],
  });

  /* Load supplier master + dual-code lookups BEFORE the info block so the
     canonical SUPPLIER block can include address / tel / attn / terms — the
     GRN's own header carries only { code, name } (endpoint economy), the
     top-up comes from GET /suppliers/:id. loadSupplierDocData is a single
     parallel round; moving it forward doesn't add a request. */
  const { skuMap, fabricMap, fabricDescMap, supplier: sFull } = await loadSupplierDocData(header.supplier_id, items);
  const supplierAddressLines = [
    sFull?.address,
    sFull?.area,
    [sFull?.postcode, sFull?.state].filter(Boolean).join(' ').trim() || null,
    sFull?.country,
  ].filter(Boolean) as string[];

  const statusText = statusLabel('grn', header.status);
  y = drawInfoColumns(doc, y,
    /* Canonical supplier block via the shared helper — matches PO / PI / PR
       so the four purchasing docs read the same rows in the same order. */
    supplierBlock({
      name: header.supplier?.name ?? sFull?.name,
      code: header.supplier?.code ?? sFull?.code,
      address: supplierAddressLines.join(', '),
      phone: formatPhone(sFull?.phone ?? sFull?.mobile ?? '') || (sFull?.phone ?? sFull?.mobile),
      fax: sFull?.fax,
      email: sFull?.email,
      attention: sFull?.attention ?? sFull?.contact_person,
      paymentTerms: sFull?.payment_terms,
      note: header.notes,
    }),
    {
      title: 'GRN DETAILS',
      rows: [
        [opts?.docNoLabel ?? 'GRN No', header.grn_number],
        ['Received', fmtDocDate(header.received_at)],
        ['DN Ref', header.delivery_note_ref],
        ['PO Ref', header.purchase_order?.po_number],
        ...renoDetailRows(opts?.renovation).slice(0, 1),
        ['Posted', header.posted_at ? fmtDocDate(header.posted_at) : null],
        ['Status', statusText],
      ],
    },
  );

  const receivedAt = await warehouseLine(header.warehouse_id);
  if (receivedAt) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(110);
    doc.text('RECEIVED AT', margin, y); doc.setTextColor(0);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(receivedAt, pageW - margin * 2 - 26) as string[];
    doc.text(lines, margin + 26, y);
    y += lines.length * 4 + 3;
  }

  // Codes note (dual-code lookups already loaded above with the supplier
  // top-up, so the block prints with a full supplier profile in one round).
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(80);
  doc.text('Codes shown are SUPPLIER codes; our reference in second column.', margin, y);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
  y += 4;

  /* Canonical SKU/build order (sofa modules LHF→NA→RHF, mains→accessories→
     services) — mirror the sales side. The shared helper keys on `item_code`;
     GRN lines expose `item_code`, so sort a shimmed view that carries the
     original row back unchanged (render-time only, no persistence touched). */
  const orderedItems = orderSofaModuleRowsWithinBuilds(
    sortSoLinesByGroupRank(
      items.map((it) => ({ ...it, item_code: it.item_code, __row: it })),
      (r) => r.item_group as string | null | undefined,
    ),
  ).map((r) => r.__row);

  /* The goods-received photos, the same block as the SO, PO and DO (owner, 4 Nov 2026): each line's own and those of
     the PO and SO lines it came from, the whole receipt's, and the proof-of-receipt photos. */
  const attached = await loadDocPdfPhotos('goods_received', header.id);
  const photoGroups = [
    ...buildPhotoGroups(orderedItems.map((it) => ({
      code: supplierCodeFor(it, skuMap),
      photoKeys: attached.lineKeys(it.id),
    }))),
    ...attached.documentGroups,
  ];
  const photoImages: Map<string, PdfPhotoImage> = photoGroups.length > 0
    ? await collectPhotoImages(photoGroups, attached.fetch, blobToSquarePdfImage)
    : new Map<string, PdfPhotoImage>();

  const rows = orderedItems.map((it, idx) => {
    const specs = docVariantLine(it, fabricMap, fabricDescMap, { labelled: true });
    const reno = renoLineNote(opts?.renovation, it.id, true);
    const descLines = [it.description ?? it.material_name, reno].filter((s): s is string => Boolean(s));
    const desc = (attached.lineKeys(it.id).length > 0 ? appendPhotoMarker(descLines) : descLines).join('\n');
    return [
      String(idx + 1),
      supplierCodeFor(it, skuMap),
      it.item_code,
      specs ? `${desc}\n${specs}` : desc,
      String(it.qty_received),
      String(it.qty_accepted),
      String(it.qty_rejected),
      it.rejection_reason ?? (it.qty_rejected > 0 ? '—' : ''),
      fmtRm(it.unit_price_sen),
    ];
  });
  autoTable(doc, {
    startY: y,
    head: [['#', 'Supplier Code', 'Our Code', 'Description', 'Recv', 'Acc', 'Rej', 'Reason', 'Unit Price']],
    body: rows,
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { ...DOC_TABLE_STYLES, fontSize: 8.5 },
    headStyles: DOC_TABLE_HEAD_STYLES,
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 24, fontStyle: 'bold' },
      2: { cellWidth: 32 },
      3: { cellWidth: 39 },
      4: { cellWidth: 11, halign: 'right' },
      5: { cellWidth: 11, halign: 'right' },
      6: { cellWidth: 11, halign: 'right' },
      7: { cellWidth: 24 },
      8: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  let lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  if (photoImages.size > 0) {
    const photoRes = drawItemPhotosBlock(doc, photoGroups, photoImages, {
      margin,
      contentW: pageW - margin * 2,
      startY: lastY,
      pageBottom: 272,
      pageTop: margin,
      side: null,
      onNewPage: null,
    });
    if (photoRes.drew) lastY = photoRes.endY + 6;
  }

  drawSignatureBoxes(doc, lastY, 'Warehouse Received By', 'Supplier Driver Signature');

  // Footer: doc no · portal · page n of m on every page of THIS GRN's span.
  const pageCount = doc.getNumberOfPages();
  for (let p = startPage; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(header.grn_number, margin, 290);
    doc.text(`${COMPANY.portalLabel} · ${fmtDocDate(header.received_at)}`, pageW / 2, 290, { align: 'center' });
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin, 290, { align: 'right' });
    doc.setTextColor(0);
  }
}

/* Single GRN → its own file (unchanged behaviour — reused by the GRN detail
   page and PurchaseConsignmentReceiveDetail with its CONSIGNMENT RECEIVE opts). */
export async function generateGrnPdf(
  header: GrnHeader,
  items: GrnItem[],
  opts?: { docTitle?: string; docNoLabel?: string; action?: PdfAction; renovation?: RenoDocInfo | null },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  await renderGrnInto(doc, autoTable, header, items, opts);
  deliverPdf(doc, `${header.grn_number}-${safeName(header.supplier?.name ?? 'supplier')}.pdf`, opts?.action);
}

/* Several GRNs → ONE combined file, each GRN starting on a new page. For the
   batch "Export PDF" action on the Goods Received list. */
export async function generateCombinedGrnPdf(
  docs: Array<{ header: GrnHeader; items: GrnItem[]; renovation?: RenoDocInfo | null }>,
  opts?: { fileName?: string; docTitle?: string; docNoLabel?: string; action?: PdfAction },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let i = 0; i < docs.length; i += 1) {
    if (i > 0) doc.addPage();
    await renderGrnInto(doc, autoTable, docs[i]!.header, docs[i]!.items, { ...opts, renovation: docs[i]!.renovation });
  }
  deliverPdf(doc, opts?.fileName ?? 'goods-received.pdf', opts?.action);
}
