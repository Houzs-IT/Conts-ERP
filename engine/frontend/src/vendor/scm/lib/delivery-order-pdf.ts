// ----------------------------------------------------------------------------
// Delivery Order PDF — customer-facing signed POD.
//
// Conts (owner, 24 Oct 2026): DOs go through a normal A4 printer, not the
// dot-matrix the Houzs build of 2026-09-08 was made for, so the sheet is A4 and
// the letterhead is the one every Conts document prints
// (lib/renovation/renovation-doc-theme.ts). The rest of that build stays: black
// ink only, one sans family at the DO_SIZE scale for the body, the info panel,
// the table and the signatures pinned to the bottom. A long DO may run onto a
// second page.
//
// Page anatomy (A4 portrait, padding 14/14/12mm): header → info panel →
// items table (the flexing item) → signature → footer. The signature and
// footer are pinned to the BOTTOM of the last page, so a 3-line DO and a
// 30-line DO both close the same way; the table absorbs the slack and repeats
// its header on every page it spills onto.
// ----------------------------------------------------------------------------

import { formatPhone } from '@2990s/shared/phone';
import {
  COMPANY,
  deliverPdf,
  ensurePdfCjkFont,
  fmtDocDate,
  letterheadLines,
  safeName,
  type PdfAction,
} from './pdf-common';
import {
  getBrandingCompanyCode,
  getBrandingLogoCache,
  HOUZS_COMPANY_CODE,
  type BrandingLogo,
} from '../../../lib/branding';
import { DO_SIZE as S, DO_THEME as T, SANS, pt, type Rgb } from './delivery-order-theme';
import { docVariantLine, loadCustomerFabricMaps } from './supplier-doc-data';
import { stripBookText } from './book-text';
import { drawQrIntoPdf } from './pdf-qr';
import { DOC_THEME, drawDocLetterheadAt } from '../../../lib/renovation/renovation-doc-theme';
/* Owner spec 2026-08 — photos follow the line onto the printed document
   (SO → PO → DO). Same shared block the SO/PO PDFs print through; keys are
   the SO-carried `photo_urls` (mig 20260828T0746). All generated strings are
   WinAnsi by rule (pdf-item-photos.ts header). */
import {
  appendPhotoMarker,
  blobToSquarePdfImage,
  buildPhotoGroups,
  collectPhotoImages,
  drawItemPhotosBlock,
  fetchLinePhotoForPdf,
  photoKeyOwners,
  photoKeysOf,
  type PdfPhotoImage,
} from './pdf-item-photos';
import { fetchDoItemPhotoBlob } from './sales-order-queries';
import { renoDetailRows, renoLineNote, type RenoDocInfo } from './renovation-doc-print';

type DoHeader = {
  /* Row id — the photo proxy route is keyed by it. Optional so the
     Consignment Note reuse (which has no DO row) stays valid; absent is the
     STRICTER direction: no photo fetch, the block simply does not print. */
  id?: string | null;
  do_number: string;
  status: string;
  /* When set, the header carries a "scan to mark loaded" QR encoding
     /scm/do-load?id=<this>. EXPLICIT opt-in by name, not a generic id: the
     Consignment Note print reuses this renderer, and a CN must never grow a
     control that flips a DELIVERY ORDER's status. Only the DO surfaces set it. */
  /* The PUBLIC scan token (64 hex), stamped by armDoScanToken. Not a row id:
     the QR encodes /d/<token>, which opens with no login, because a driver has
     no account (owner: 「就跟hookka一样」). Absent = print no QR. */
  scanToken?: string | null;
  do_date: string;
  so_doc_no: string | null;
  debtor_code: string | null;
  debtor_name: string;
  expected_delivery_at: string | null;
  dispatched_at: string | null;
  signed_at: string | null;
  delivered_at: string | null;
  driver_name: string | null;
  vehicle: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  phone: string | null;
  notes: string | null;
  m3_total_milli: number | null;
  /* The customer's OWN reference for this order. Houzs prints it beside our SO
     number; 2990 does not (owner 2026-08-07). Resolution mirrors the DO detail
     page's refOf() so the document and the screen never disagree. All optional:
     the Consignment Note reuse passes a header without them. */
  po_doc_no?: string | null;
  customer_so_no?: string | null;
  ref?: string | null;
  /* Resolved salesperson display name for the DELIVERY DETAILS block. The PDF
     cannot run the staff lookup, so the caller passes the same name it shows on
     screen (salesperson_name, else the staff-lookup of agent / salesperson_id).
     Optional: blank / absent ⇒ the row is omitted, like Driver / Vehicle. */
  salesperson?: string | null;
};

type DoItem = {
  /* Line row id — pairs with DoHeader.id on the photo proxy route. Optional
     for the same CN reuse; absent = that line fetches no photos (stricter). */
  id?: string | null;
  item_code: string;
  description: string | null;
  qty: number;
  m3_milli: number | null;
  unit_price_sen: number;
  /* Variant info snapshotted from the SO (migration 0058) — drives the unified
     variant line so DO/Consignment Note read like SO/PO/etc. */
  item_group?: string | null;
  variants?: Record<string, unknown> | null;
  /* Storekeeper picking (resolved server-side on the DO detail): the supplier
     PO(s) that supplied this line's goods, and the physical rack(s) they are
     stored on. Both optional / possibly empty → the cell shows a dash. */
  source_pos?: string[] | null;
  racks?: string[] | null;
  /* Line reference photos (R2 keys, delivery_order_items.photo_urls — carried
     from the SO line, mig 20260828T0746). Optional so the Consignment Note
     reuse stays valid. When present the row's first description line gains
     the " (photo)" marker and the ITEM PHOTOS block prints the `.thumb`
     siblings. */
  photo_urls?: string[] | null;
};

type Doc = import('jspdf').jsPDF;

// ── Page geometry ────────────────────────────────────────────────────────────
export const DO_PAGE_FORMAT = 'a4';
const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;                       // left / right / top padding
const PAD_BOTTOM = 12;
const CONTENT_W = PAGE_W - M * 2;   // 182mm

const EM_DASH = '—';

/** Line height as a multiple of the size, for stacked prose. */
const LINE = 1.4;

// jsPDF places text on its BASELINE; blocks here are placed by their top edge.
// This is the cap-height drop that converts one to the other, and it is the
// single number that keeps the two columns of the header optically level.
const BASELINE_DROP = 0.78;
const baselineOf = (topMm: number, sizePt: number): number => topMm + pt(sizePt) * BASELINE_DROP;

const setInk = (doc: Doc, rgb: Rgb): void => { doc.setTextColor(rgb[0], rgb[1], rgb[2]); };
const setStroke = (doc: Doc, rgb: Rgb): void => { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); };

/* Rule weights. An impact printer forms a line out of pin strikes, so a
   0.1mm hairline prints broken; 0.25mm is the thinnest that comes out solid
   on the second ply. */
const RULE_THIN = 0.25;
const RULE_HEAVY = 0.6;

/** A horizontal rule. jsPDF strokes centred on the path. */
const rule = (doc: Doc, x1: number, y: number, x2: number, widthMm: number): void => {
  setStroke(doc, T.line);
  doc.setLineWidth(widthMm);
  doc.line(x1, y, x2, y);
};

/** Set the one face at a size. Every text call goes through here, so the sheet
 *  cannot grow a second family or a size under the floor by accident. */
const font = (doc: Doc, sizePt: number, style: 'normal' | 'bold' = 'normal'): void => {
  doc.setFont(SANS, style);
  doc.setFontSize(sizePt);
};

/** The letterhead, closed by a heavy rule; returns that rule's y. */
function drawDoHeader(
  doc: Doc,
  header: DoHeader,
  opts: { docTitle: string; logo?: BrandingLogo | null },
): number {
  /* The shared Conts letterhead. The number ("No. :", owner 2026-09-21) and issue date sit in its right column; the
     customer-service desk (owner 2026-08-07, falling back to the headline phone / e-mail) is its contact line. */
  const QR = 14;       // a floor: drawQrIntoPdf grows the code when the link needs more modules (2026-08-27)
  const QR_BOX = 20;
  const QR_GAP = 6;
  const withQr = Boolean(header.scanToken && typeof window !== 'undefined');
  const head = drawDocLetterheadAt(doc, {
    title: opts.docTitle.toUpperCase(),
    name: COMPANY.shortName,
    logo: opts.logo ?? getBrandingLogoCache(),
    lines: letterheadLines({ phone: COMPANY.csPhone || COMPANY.phone, email: COMPANY.csEmail || COMPANY.email }),
    meta: [{ label: 'No. :', value: header.do_number }, { label: 'Issued', value: fmtDocDate(header.do_date) }],
    margin: M,
    reserve: withQr ? QR_BOX + QR_GAP : 0,
  });
  let bottom = head.bottom;

  /* THE SCAN QR opens the PUBLIC page (2026-08-26): the driver has no account, and the token in it is the only
     credential. It is scanned at each step of the loading ladder, hence the caption. It sits beside the number column,
     in the space the letterhead kept for it, so it adds no height. */
  if (withQr && header.scanToken) {
    const x = head.columnLeft;
    const top = DOC_THEME.blockTop - 3;
    const url = `${window.location.origin}/d/${encodeURIComponent(header.scanToken)}`;
    const drawn = drawQrIntoPdf(doc, url, x, top, QR);
    font(doc, S.footer, 'bold');
    setInk(doc, T.ink);
    const labelBaseline = baselineOf(top + Math.max(drawn, QR) + 1, S.footer);
    doc.text('SCAN AT EACH STEP', x, labelBaseline);
    bottom = Math.max(bottom, labelBaseline + 1);
  }

  const ruleY = bottom + 1;
  rule(doc, M, ruleY, PAGE_W - M, RULE_HEAVY);
  return ruleY;
}

/** Section caption — bold, uppercase. */
function drawCaption(doc: Doc, text: string, x: number, top: number): number {
  font(doc, S.caption, 'bold');
  setInk(doc, T.ink);
  doc.text(text.toUpperCase(), x, baselineOf(top, S.caption));
  return top + pt(S.caption) + 3;
}

/**
 * DELIVER TO / DELIVERY DETAILS — one ruled box, two columns.
 *
 * Drawn in two passes: the columns are measured first (so the box can be
 * sized to the taller one), then the box is stroked and the content is drawn
 * on top. Measuring by drawing into a throwaway pass would double every text
 * call, so instead each column's writer is run once in `measure` mode.
 */
function drawInfoPanel(doc: Doc, top: number, header: DoHeader, reno?: RenoDocInfo | null): number {
  const PAD_X = 5;
  const PAD_Y = 3;
  const GAP = 8;
  const innerW = CONTENT_W - PAD_X * 2;
  const colW = (innerW - GAP) / 2;
  const leftX = M + PAD_X;
  const rightX = leftX + colW + GAP;
  const contentTop = top + PAD_Y;

  const address = [
    header.address1,
    header.address2,
    [header.postcode, header.city, header.state]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .join(' '),
  ]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(', ');

  // ── Left column ──────────────────────────────────────────────────────────
  const drawLeft = (draw: boolean): number => {
    let y = draw ? drawCaption(doc, 'Deliver To', leftX, contentTop) : contentTop + pt(S.caption) + 3;

    font(doc, S.customer, 'bold');
    const nameLines = doc.splitTextToSize(
      `Customer :  ${header.debtor_name || EM_DASH}`,
      colW,
    ) as string[];
    for (const line of nameLines) {
      y += pt(S.customer) * 1.2;
      if (draw) { setInk(doc, T.ink); doc.text(line, leftX, y); }
    }
    // Customer account code (debtor_code) is deliberately NOT printed on the
    // customer's copy (owner 2026-09-21) — it is an internal account number. The
    // field is still carried on DoHeader for search / dedup elsewhere.

    font(doc, S.body);
    // The address measure is capped so it never crowds the details column.
    const addrLines = doc.splitTextToSize(address || EM_DASH, Math.min(78, colW)) as string[];
    y += 2.5 + pt(S.body);
    if (draw) doc.text('Address:', leftX, y);
    for (const line of addrLines) {
      y += pt(S.body * LINE);
      if (draw) doc.text(line, leftX, y);
    }

    y += 2 + pt(S.body);
    if (draw) {
      const tel = header.phone ? formatPhone(header.phone) : EM_DASH;
      font(doc, S.body);
      doc.text('Tel :', leftX, y);
      const labelW = doc.getTextWidth('Tel :') + 1.6;
      font(doc, S.body, 'bold');
      doc.text(tel, leftX + labelW, y);
    }

    // Delivery note from the order — the "ring the bell twice", "leave with the
    // guardhouse" line. Whatever it says, the driver is the one who needs it,
    // so it prints on the driver's sheet. Absent when blank.
    const note = (header.notes || '').trim();
    if (note) {
      font(doc, S.body);
      const noteLines = doc.splitTextToSize(note, Math.min(78, colW)) as string[];
      y += 2.5 + pt(S.body);
      if (draw) doc.text('Note:', leftX, y);
      for (const line of noteLines) {
        y += pt(S.body * LINE);
        if (draw) doc.text(line, leftX, y);
      }
    }
    return y;
  };

  // ── Right column: label gutter + value ───────────────────────────────────
  const LABEL_W = 30;
  const ROW_GAP = 2.2;
  /* Houzs prints OUR number and the CUSTOMER'S own reference on separate lines;
     2990 prints the single "SO Ref" (owner 2026-08-07). The customer reference
     resolves exactly as the DO detail page's refOf() does — po_doc_no, then
     customer_so_no, then ref — so the document and the screen can never
     disagree about which of the three a given record actually carries. */
  const isHouzs = getBrandingCompanyCode() === HOUZS_COMPANY_CODE;
  const customerRef = header.po_doc_no || header.customer_so_no || header.ref || null;
  const soRows = isHouzs
    ? [
        { label: 'SO No', value: header.so_doc_no, bold: true },
        { label: 'Ref No.', value: customerRef },
      ]
    : [{ label: 'SO Ref', value: header.so_doc_no, bold: true }];

  const rows: Array<{ label: string; value: string | null; bold?: boolean }> = [
    ...soRows,
    // Renovation mode (mig 0116): the project, building and unit the DO carries from its SO.
    ...renoDetailRows(reno, { short: true }).filter((r): r is [string, string] => !!r[1]).map(([label, value]) => ({ label, value })),
    // Who sold the order — printed once the record carries it, omitted (not
    // dashed) otherwise, the rule the Driver / Vehicle rows follow.
    ...(header.salesperson && header.salesperson.trim()
      ? [{ label: 'Salesperson', value: header.salesperson.trim() }]
      : []),
    { label: 'Issued Date', value: fmtDocDate(header.do_date) },
    {
      label: 'Delivery Date',
      value: header.expected_delivery_at ? fmtDocDate(header.expected_delivery_at) : null,
    },
    // Who is bringing it, and in what. Printed only once the run is assigned —
    // a dashed "Driver —" on an unassigned DO is noise on the driver's sheet.
    ...(header.driver_name ? [{ label: 'Driver', value: header.driver_name }] : []),
    ...(header.vehicle ? [{ label: 'Vehicle', value: header.vehicle }] : []),
    // Status is intentionally NOT shown on the customer's copy (owner
    // 2026-09-21): the DO states what is delivered, not the order's workflow
    // state. The status still drives the header QR / on-screen views.
  ];

  const drawRight = (draw: boolean): number => {
    let y = draw ? drawCaption(doc, 'Delivery Details', rightX, contentTop) : contentTop + pt(S.caption) + 3;
    for (const row of rows) {
      const value = row.value || EM_DASH;
      y += ROW_GAP + pt(S.body);
      if (draw) {
        font(doc, S.body);
        doc.text(row.label, rightX, y);
        font(doc, S.body, row.bold ? 'bold' : 'normal');
        doc.text(value, rightX + LABEL_W + 4, y);
      }
    }
    return y;
  };

  const bottom = Math.max(drawLeft(false), drawRight(false)) + PAD_Y;
  const panelH = bottom - top;

  /* Stroke only. A filled panel — even the palest tint — dithers into dots
     under every word inside it. */
  setStroke(doc, T.line);
  doc.setLineWidth(RULE_THIN);
  doc.rect(M, top, CONTENT_W, panelH, 'S');

  drawLeft(true);
  drawRight(true);
  return top + panelH;
}

// ── Closing block geometry, shared by the drawer and the page-break check ────
const FOOTER_RULE_Y = PAGE_H - PAD_BOTTOM - 6;
/* The MINIMUM blank signing space reserved above the signature rule — a page-
   break threshold, NOT a drawn box: drawClosing always strikes the rule at
   SIG_TITLE_TOP, so a short DO keeps a large blank above it either way. At 20mm
   (+6mm gap = 26mm reserved) even a five-line DO spilled a near-empty second
   sheet. Trimmed to 8mm (+4mm gap = 12mm floor, owner 2026-09-21): still
   room to sign, and normal DOs now close on one page. */
const SIG_BOX_H = 8;
const SIG_FIELD_ROW = pt(S.sigField) + 3.6;
const SIG_TITLE_TOP = FOOTER_RULE_Y - 6 - SIG_FIELD_ROW * 2 - 2 - pt(S.sigTitle) - 2.5;
const SIG_BOX_TOP = SIG_TITLE_TOP - SIG_BOX_H;
/** Content must end above this or the closing block takes a fresh page. */
const CLOSING_TOP = SIG_BOX_TOP - 4;

/** Signature blocks + footer, pinned to the bottom of the page they close. */
function drawClosing(doc: Doc, header: DoHeader, pageOf: { page: number; total: number }): void {
  const colW = (CONTENT_W - 10) / 2;
  const blocks: Array<{ x: number; title: string }> = [
    { x: M, title: 'Customer Acknowledged Receipt' },
    { x: M + colW + 10, title: `${COMPANY.name} — Driver Signature` },
  ];

  for (const block of blocks) {
    rule(doc, block.x, SIG_BOX_TOP + SIG_BOX_H, block.x + colW, RULE_THIN);

    font(doc, S.sigTitle, 'bold');
    setInk(doc, T.ink);
    const titleLines = doc.splitTextToSize(block.title, colW) as string[];
    doc.text(titleLines[0]!, block.x, baselineOf(SIG_TITLE_TOP + 2.5, S.sigTitle));

    font(doc, S.sigField);
    let y = SIG_TITLE_TOP + 2.5 + pt(S.sigTitle) + 2;
    for (const label of ['Name', 'Date']) {
      const baseline = baselineOf(y, S.sigField);
      doc.text(label, block.x, baseline);
      const labelW = doc.getTextWidth('Date') + 3;
      /* Solid, not dotted: a row of 0.1mm dots is exactly the mark an impact
         printer cannot form, and the field read as a smear. */
      rule(doc, block.x + labelW, baseline + 0.8, block.x + colW, RULE_THIN);
      y += SIG_FIELD_ROW;
    }
  }

  rule(doc, M, FOOTER_RULE_Y, PAGE_W - M, RULE_THIN);
  const footBaseline = baselineOf(FOOTER_RULE_Y + 3, S.footer);
  font(doc, S.footer);
  setInk(doc, T.ink);
  doc.text(
    'By signing above, the customer confirms receipt of the items listed in good order and condition.',
    M,
    footBaseline,
  );
  doc.text(`${header.do_number} · Page : ${pageOf.page} of ${pageOf.total}`, PAGE_W - M, footBaseline, { align: 'right' });
}

/** The footer alone — every page that is not the one carrying the signature. */
function drawFooterOnly(doc: Doc, header: DoHeader, pageOf: { page: number; total: number }): void {
  rule(doc, M, FOOTER_RULE_Y, PAGE_W - M, RULE_THIN);
  const footBaseline = baselineOf(FOOTER_RULE_Y + 3, S.footer);
  font(doc, S.footer);
  setInk(doc, T.ink);
  doc.text(`${COMPANY.portalLabel} · ${fmtDocDate(header.do_date)}`, M, footBaseline);
  doc.text(`${header.do_number} · Page : ${pageOf.page} of ${pageOf.total}`, PAGE_W - M, footBaseline, { align: 'right' });
}

/* Draw ONE delivery order's content into `doc`. Does NOT create the doc or
   save — the caller finalizes, so several DOs can share one doc (batch "Export
   PDF"). The footer loop starts at the page this DO began on (startPage) so
   combined docs keep each DO's own "page n of m" scoped to its own pages. */
export async function renderDeliveryOrderInto(
  doc: Doc,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoTable: any,
  header: DoHeader,
  items: DoItem[],
  opts?: {
    docTitle?: string;
    docNoLabel?: string;
    showPicking?: boolean;
    /** Per-document logo override, same contract as pdf-common's drawHeader:
     *  null/undefined falls back to the company logo memo. */
    logo?: BrandingLogo | null;
    /** Renovation mode (mig 0116): project, building, unit and each line's room. */
    renovation?: RenoDocInfo | null;
  },
): Promise<void> {
  /* Before ANY drawing — the delivery address is the field that strands a
     driver when it prints as mojibake. No-op for a pure-WinAnsi DO. */
  await ensurePdfCjkFont(doc, [header, items]);

  // Source PO + Rack picking columns are a DELIVERY-ORDER aid; the Consignment
  // Note reuses this renderer but opts out (showPicking: false).
  const showPicking = opts?.showPicking !== false;
  const startPage = doc.getNumberOfPages();

  /* Photos follow the line (owner spec 2026-08): fetch the `.thumb` sibling of
     every carried photo key up front, falling back to the original when the
     thumb 404s (fetchLinePhotoForPdf — the AutoCount cutover keys have no
     thumb; docs/bugs/0815), best-effort — a key whose fetch or decode fails is
     skipped and the PDF renders without it. The CN reuse has no header id, so
     it fetches nothing by construction. */
  const doId = header.id ?? null;
  const photoGroups = doId
    ? buildPhotoGroups(items.map((it) => ({
        code: it.item_code,
        photoKeys: photoKeysOf(it.photo_urls),
      })))
    : [];
  const photoOwners = photoKeyOwners(
    items.flatMap((it) => (it.id ? [{ id: it.id, photoKeys: photoKeysOf(it.photo_urls) }] : [])),
  );
  const photoImages: Map<string, PdfPhotoImage> = doId && photoGroups.length > 0
    ? await collectPhotoImages(
        photoGroups,
        (key) => {
          const ownerId = photoOwners.get(key);
          if (!ownerId) return Promise.reject(new Error('photo_owner_missing'));
          return fetchLinePhotoForPdf((k) => fetchDoItemPhotoBlob(doId, ownerId, k), key);
        },
        blobToSquarePdfImage,
      )
    : new Map<string, PdfPhotoImage>();

  const ruleY = drawDoHeader(doc, header, {
    docTitle: opts?.docTitle ?? 'DELIVERY ORDER',
    logo: opts?.logo,
  });
  const panelBottom = drawInfoPanel(doc, ruleY + 4, header, opts?.renovation);

  // ── Line items ────────────────────────────────────────────────────
  // Description cell = SKU description + the UNIFIED variant line (same composer
  // as SO/DR/SI/consignment), so the line reads identically on every customer
  // document (Commander 2026-06-16).
  const fabric = await loadCustomerFabricMaps(items);
  // DO is QUANTITY-only (Owner 2026-06-26) — a delivery doc shows quantity /
  // volume, not money. The unit_price_sen still flows to the Sales Invoice.
  const listCell = (vals?: string[] | null): string =>
    vals && vals.length > 0 ? vals.join('\n') : EM_DASH;
  const descOf = (it: DoItem): string => {
    const composed = [it.description, docVariantLine(it, fabric.ext, fabric.desc), renoLineNote(opts?.renovation, it.id)]
      .filter((s): s is string => Boolean(s));
    if (composed.length === 0) return EM_DASH;
    /* Owner spec: a row carries NO image — the " (photo)" marker on the first
       description line points the reader at the ITEM PHOTOS block below. */
    const lines = photoKeysOf(it.photo_urls).length > 0 ? appendPhotoMarker(composed) : composed;
    // Guard the customer copy against migrated AutoCount book text — see book-text.ts.
    return stripBookText(lines.join('\n')) || EM_DASH;
  };
  const m3Of = (it: DoItem): string => (it.m3_milli != null ? (it.m3_milli / 1000).toFixed(3) : EM_DASH);

  const rows = items.map((it, idx) => {
    // Row numbers are zero-padded (01, 02 …) so the column stays a fixed-width
    // rail rather than jittering at the tenth row.
    const seq = String(idx + 1).padStart(2, '0');
    return showPicking
      ? [seq, it.item_code, descOf(it), listCell(it.source_pos), listCell(it.racks), String(it.qty), m3Of(it)]
      : [seq, it.item_code, descOf(it), String(it.qty), m3Of(it)];
  });

  const qtyTotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const m3Total = items.reduce((sum, it) => sum + (it.m3_milli ?? 0), 0) / 1000;
  // The label spans everything left of the numbers: at 5% the first column is
  // a row-number rail, and "TOTAL" dropped into it wraps to "TOT / AL".
  const foot = [[
    { content: 'TOTAL', colSpan: showPicking ? 5 : 3 },
    String(qtyTotal),
    m3Total.toFixed(3),
  ]];

  // Column widths as percentages of the measure. The identifier columns (item
  // code, Source PO) sit one step below body size so a 17-character PO number
  // fits its column on one line — a document number broken mid-string is the
  // one thing the storekeeper cannot read back.
  const pct = (p: number): number => (CONTENT_W * p) / 100;
  const idCol = { fontSize: S.tableHead, fontStyle: 'bold' as const };
  const columnStyles = showPicking
    ? {
        0: { cellWidth: pct(6), fontStyle: 'bold' as const },
        1: { cellWidth: pct(19), ...idCol },
        2: { cellWidth: 'auto' as const, fontStyle: 'bold' as const },
        3: { cellWidth: pct(22), ...idCol },
        4: { cellWidth: pct(7) },
        5: { cellWidth: pct(6), halign: 'right' as const, fontStyle: 'bold' as const },
        6: { cellWidth: pct(11), halign: 'right' as const },
      }
    : {
        0: { cellWidth: pct(6), fontStyle: 'bold' as const },
        1: { cellWidth: pct(19), ...idCol },
        2: { cellWidth: 'auto' as const, fontStyle: 'bold' as const },
        3: { cellWidth: pct(6), halign: 'right' as const, fontStyle: 'bold' as const },
        4: { cellWidth: pct(11), halign: 'right' as const },
      };

  const headRow = showPicking
    ? ['#', 'Item Code', 'Description', 'Source PO', 'Rack', 'Qty', 'm³']
    : ['#', 'Item Code', 'Description', 'Qty', 'm³'];
  const rightAlignedHead = new Set(showPicking ? [5, 6] : [3, 4]);

  autoTable(doc, {
    startY: panelBottom + 4,
    head: [headRow],
    body: rows,
    foot,
    // The header repeats on every page the table spills onto — a second sheet
    // of unlabelled numbers is not a delivery note.
    showFoot: 'lastPage',
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: {
      font: SANS,
      fontSize: S.body,
      cellPadding: { top: 1.8, right: 2, bottom: 1.8, left: 2 },
      valign: 'top',
      textColor: T.ink,
      lineColor: T.line,
      lineWidth: { bottom: RULE_THIN } as never,
    },
    headStyles: { fillColor: false as never, textColor: T.ink },
    footStyles: {
      fillColor: false as never,
      lineWidth: { top: RULE_HEAVY } as never,
      lineColor: T.line,
      textColor: T.ink,
      fontSize: S.tableFoot,
      fontStyle: 'bold',
    },
    columnStyles,
    margin: { left: M, right: M, bottom: PAGE_H - FOOTER_RULE_Y + 6 },
    /* The header row: bold upper-cased labels over a heavy rule. autoTable
       cannot upper-case a cell, so each head cell paints its own text and
       cancels autoTable's; the rule is drawn once, from the first cell. */
    willDrawCell: (data: {
      section: string;
      column: { index: number };
      cell: {
        x: number; y: number; width: number; height: number;
        text: string[]; styles: { halign?: string };
      };
    }): boolean | void => {
      if (data.section !== 'head') return;
      if (data.column.index === 0) {
        rule(doc, M, data.cell.y + data.cell.height, PAGE_W - M, RULE_HEAVY);
      }
      const label = data.cell.text.join(' ').toUpperCase();
      font(doc, S.tableHead, 'bold');
      setInk(doc, T.ink);
      const baseline = baselineOf(data.cell.y + 2, S.tableHead);
      if (rightAlignedHead.has(data.column.index)) {
        doc.text(label, data.cell.x + data.cell.width - 2, baseline, { align: 'right' });
      } else {
        doc.text(label, data.cell.x + 2, baseline);
      }
      return false;
    },
  });

  // ── ITEM PHOTOS (owner spec 2026-08) ───────────────────────────────
  /* One block per document, AFTER the items table and BEFORE the pinned
     signature/footer. Row-number chips key each group back to the table
     above; a group never splits across pages (it moves whole, under a
     continued heading). Pages the block adds are swept up by the closing
     loop below, so they get the footer like any table spill page. The
     block draws in jsPDF's built-in helvetica, the same face as the rest of
     this sheet. Absent entirely when no photo actually fetched. */
  let finalY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? panelBottom);
  if (photoImages.size > 0) {
    const photoRes = drawItemPhotosBlock(doc, photoGroups, photoImages, {
      margin: M,
      contentW: CONTENT_W,
      startY: finalY + 6,
      pageBottom: FOOTER_RULE_Y - 6, // the items table's own bottom rail
      pageTop: M,
      side: null,
      onNewPage: null,
    });
    if (photoRes.drew) finalY = photoRes.endY;
  }

  // ── Closing: signature + footer, pinned to the bottom ──────────────
  if (finalY > CLOSING_TOP) doc.addPage();

  const pageCount = doc.getNumberOfPages();
  const total = pageCount - startPage + 1;
  for (let p = startPage; p <= pageCount; p += 1) {
    doc.setPage(p);
    const pageOf = { page: p - startPage + 1, total };
    if (p === pageCount) drawClosing(doc, header, pageOf);
    else drawFooterOnly(doc, header, pageOf);
  }
  setInk(doc, T.ink);
}

/* Single DO → its own file (unchanged behaviour). */
export async function generateDeliveryOrderPdf(
  header: DoHeader,
  items: DoItem[],
  opts?: { docTitle?: string; docNoLabel?: string; showPicking?: boolean; action?: PdfAction; renovation?: RenoDocInfo | null },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: DO_PAGE_FORMAT });
  await renderDeliveryOrderInto(doc, autoTable, header, items, opts);
  deliverPdf(doc, `${header.do_number}-${safeName(header.debtor_name || 'customer')}.pdf`, opts?.action);
}

/* Several DOs → ONE combined file, each DO starting on a new page. For the
   batch "Export PDF" action (download a customer's DOs in one attachment). */
export async function generateCombinedDeliveryOrderPdf(
  docs: Array<{ header: DoHeader; items: DoItem[] }>,
  opts?: { fileName?: string; docTitle?: string; docNoLabel?: string; showPicking?: boolean; action?: PdfAction },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: DO_PAGE_FORMAT });
  for (let i = 0; i < docs.length; i += 1) {
    if (i > 0) doc.addPage();
    await renderDeliveryOrderInto(doc, autoTable, docs[i]!.header, docs[i]!.items, opts);
  }
  deliverPdf(doc, opts?.fileName ?? 'delivery-orders.pdf', opts?.action);
}
