/* Draws a renovation document (quotation, sales order, variation order) as an
   A4 portrait PDF in the layout of the owner's samples: brand letterhead and
   title, company block, Attention / To with LAST AMEND on the left and Prepared
   By / Building / Unit / Date on the right, the intro sentence, the column
   header, section colour bands, the rows, a TOTAL box on every page, the bank
   line and terms, and on the last page the summary, promotion lines, payment
   terms and two signature blocks. Pagination comes from print-layout.ts so the
   page totals here are the ones its tests pin. */

import type { jsPDF as JsPdf } from 'jspdf';
import { PRINT_FORMATS } from './print-formats';
import { A4, BODY_TOP, FOOTER_TOP, layoutDocument, pageTotalSen, ROW_HEIGHTS, summaryRows, type Density, type Layout, type WrapFn } from './print-layout';
import { DOC_TITLE, rmGrouped, rmPlain, type PrintDoc } from './print-model';

const M = A4.margin;
const RIGHT = A4.width - M;

function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const HIGHLIGHT: Partial<Record<string, [number, number, number]>> = { GREY: [217, 217, 217], PINK: [251, 225, 214] };

/** d/m/yy as on the samples ("5/9/26", "4/11/2025" for the doc date). */
function dmy(iso: string | null | undefined, longYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return `${Number(m[3])}/${Number(m[2])}/${longYear ? m[1] : m[1].slice(2)}`;
}

function drawLetterhead(pdf: JsPdf, d: PrintDoc): void {
  const b = d.brand;
  if (b.logo) {
    const maxW = 62;
    const maxH = 24;
    const scale = Math.min(maxW / b.logo.width, maxH / b.logo.height);
    pdf.addImage(b.logo.dataUrl, b.logo.format, M + 2, 12, b.logo.width * scale, b.logo.height * scale);
  } else {
    pdf.setFont('times', 'normal');
    pdf.setFontSize(20);
    pdf.setTextColor(30);
    pdf.text(b.name.toUpperCase().split('').join(' '), M + 2, 26, { maxWidth: 100 });
  }
  pdf.setFont('times', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(0);
  pdf.text(DOC_TITLE[d.kind], RIGHT - 4, 27, { align: 'right' });
  pdf.setDrawColor(0);
  pdf.setLineWidth(0.3);
  pdf.line(M + 2, 40, RIGHT - 2, 40);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  let y = 47;
  for (const l of [...b.companyLines, b.contactLine].filter(Boolean)) {
    pdf.text(l, M + 2, y);
    y += 4.1;
  }
}

function drawInfo(pdf: JsPdf, d: PrintDoc): void {
  const h = d.header;
  const y0 = 72;
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Attention', M + 2, y0);
  pdf.text('To', M + 2, y0 + 4.6);
  pdf.text(h.customerName || h.attention, M + 26, y0 + 4.6, { maxWidth: 90 });
  /* Second line: the attention when it differs from the customer, else the quotation's phone and site address
     (mig 0116). Third line: the property, then the last-amended date. Blank parts print nothing. */
  const second = h.attention && h.customerName && h.attention !== h.customerName
    ? h.attention
    : [h.customerPhone, (h.siteAddress ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  if (second) {
    pdf.setFont('helvetica', 'normal');
    pdf.text(second, M + 26, y0 + 9.2, { maxWidth: 90 });
  }
  const third = [h.property, h.lastAmended ? `LAST AMEND : ${dmy(h.lastAmended)}` : ''].filter(Boolean).join('   ');
  if (third) {
    pdf.setFont('helvetica', 'normal');
    pdf.text(third, M + 26, y0 + 13.8, { maxWidth: 90 });
  }
  const lx = 128;
  const vx = RIGHT - 18;
  const rows: Array<[string, string]> = [['Prepared By', h.preparedBy], ['Building', h.building], ['Unit', h.unitNo], ['Date', dmy(h.docDate, true)]];
  rows.forEach(([label, value], i) => {
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, lx, y0 + i * 4.6);
    pdf.setFont('helvetica', 'normal');
    pdf.text(value || '', vx, y0 + i * 4.6, { align: 'center' });
  });
  pdf.setLineWidth(0.3);
  pdf.line(M, y0 + 16.2, RIGHT, y0 + 16.2);
  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(7);
  const intro = (h.intro ?? '') || d.brand.intro;
  pdf.text(intro, M, y0 + 19.8, { maxWidth: RIGHT - M });
  if (d.reference) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(d.reference, RIGHT, y0 + 19.8, { align: 'right' });
  }
}

function drawColumnHeader(pdf: JsPdf, d: PrintDoc): void {
  const cols = PRINT_FORMATS[d.format].columns;
  let x = M;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  for (const c of cols) {
    const tx = c.align === 'right' ? x + c.width - 1 : c.align === 'center' ? x + c.width / 2 : x + 1;
    pdf.text(c.label, tx, BODY_TOP - 3, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
    x += c.width;
  }
}

function drawFooter(pdf: JsPdf, d: PrintDoc, layout: Layout, pageIdx: number): void {
  const page = layout.pages[pageIdx];
  const total = pageTotalSen(d, page);
  const boxX = 124;
  let y = FOOTER_TOP;
  if (PRINT_FORMATS[d.format].netSubtotal && page.netSen !== page.listSen && page.rows.length) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.text(rmPlain(page.netSen), 146, y - 1.5, { align: 'center' });
  }
  // The last page of a qty-only document prints its package total once, in the summary.
  const blankLastTotal = page.isLast && total === null;
  if ((page.rows.length || !page.isLast) && !blankLastTotal) {
    pdf.setLineWidth(0.3);
    pdf.line(boxX, y, RIGHT, y);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('TOTAL (RM)', boxX + 22, y + 4.2, { align: 'center' });
    pdf.setFontSize(9);
    pdf.text(total === null ? '' : rmPlain(total), RIGHT - 14, y + 4.2, { align: 'center' });
    pdf.setLineWidth(0.6);
    pdf.line(boxX, y + 6.2, RIGHT, y + 6.2);
    y += 6.4;
  }
  if (page.isLast) {
    for (const r of summaryRows(d, layout.closing.summary)) {
      if (r.tone === 'plain' && d.format !== 'DISCOUNT' && page.rows.length) continue;
      // Under this page's own TOTAL box, the document's total reads as the grand total.
      const label = r.tone === 'plain' && d.format === 'DISCOUNT' && page.rows.length ? 'GRAND TOTAL (RM)' : r.label;
      const fill = r.tone === 'final' ? (d.format === 'DISCOUNT' ? [198, 239, 206] : [255, 224, 138]) : r.tone === 'discount' ? [255, 255, 0] : null;
      if (fill) { pdf.setFillColor(fill[0], fill[1], fill[2]); pdf.rect(boxX, y, RIGHT - boxX, 5.6, 'F'); }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(r.tone === 'final' ? 8.5 : 7.5);
      pdf.text(label, boxX + 22, y + 4, { align: 'center' });
      pdf.text(d.format === 'DISCOUNT' ? rmGrouped(r.sen) : rmPlain(r.sen), RIGHT - 14, y + 4, { align: 'center' });
      pdf.setLineWidth(0.3);
      pdf.line(boxX, y + 5.6, RIGHT, y + 5.6);
      y += 5.8;
    }
  }
  // Bank line and terms, left.
  pdf.setTextColor(0);
  pdf.setFontSize(6.5);
  let ty = FOOTER_TOP + 7;
  const bank = d.brand.bankLine;
  if (bank) {
    const cut = bank.search(/THE CONTS|DREAM CRAFTER/i);
    if (cut > 0) {
      pdf.setFont('helvetica', 'normal');
      pdf.text(bank.slice(0, cut), M, ty);
      const w = pdf.getTextWidth(bank.slice(0, cut));
      pdf.setFont('helvetica', 'bold');
      pdf.text(bank.slice(cut), M + w, ty);
    } else {
      pdf.setFont('helvetica', 'normal');
      pdf.text(bank, M, ty);
    }
    ty += 4.2;
  }
  pdf.setFont('helvetica', 'normal');
  for (const t of d.brand.termsLines) {
    pdf.text(t, M, ty, { maxWidth: boxX - M - 4 });
    ty += 4.2;
  }
  pdf.setFontSize(6.5);
  pdf.setTextColor(120);
  pdf.text(`${d.docNo}  ·  Page ${pageIdx + 1} of ${layout.pages.length}`, RIGHT, A4.height - 8, { align: 'right' });
  pdf.setTextColor(0);
}

function drawRows(pdf: JsPdf, d: PrintDoc, layout: Layout, pageIdx: number, density: Density): number {
  const cols = PRINT_FORMATS[d.format].columns;
  const h = ROW_HEIGHTS[density];
  let y = BODY_TOP;
  for (const r of layout.pages[pageIdx].rows) {
    if (r.type === 'spacer') { y += r.heightMm; continue; }
    if (r.type === 'band') {
      const rgb = hexToRgb(r.color);
      if (rgb) { pdf.setFillColor(rgb[0], rgb[1], rgb[2]); pdf.rect(M, y, RIGHT - M, r.heightMm, 'F'); }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(h.fontPt);
      const descX = M + cols[0].width + 1;
      r.textLines.forEach((t, i) => pdf.text(t, descX, y + h.band * 0.68 + i * h.extraLine));
      if (r.amount) {
        const amt = cols.find((c) => c.key === 'amount');
        if (amt) pdf.text(r.amount, RIGHT - 1, y + h.band * 0.68, { align: 'right' });
      }
      y += r.heightMm;
      continue;
    }
    const fill = HIGHLIGHT[r.highlight];
    if (fill) { pdf.setFillColor(fill[0], fill[1], fill[2]); pdf.rect(M, y, RIGHT - M, r.heightMm, 'F'); }
    pdf.setFontSize(h.fontPt);
    let x = M;
    const base = y + h.line * 0.7;
    for (const c of cols) {
      pdf.setFont('helvetica', c.key === 'desc' && r.bold ? 'bold' : c.key === 'no' ? 'bold' : 'normal');
      if (c.key === 'desc') {
        r.textLines.forEach((t, i) => pdf.text(t, x + 1, base + i * h.extraLine));
      } else {
        const v = r.cells[c.key];
        if (v) {
          const tx = c.align === 'right' ? x + c.width - 1 : c.align === 'center' ? x + c.width / 2 : x + 1;
          pdf.text(v, tx, base, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
        }
      }
      x += c.width;
    }
    y += r.heightMm;
  }
  return y;
}

function drawClosing(pdf: JsPdf, d: PrintDoc, layout: Layout, startY: number): void {
  let y = startY + 6;
  const boxW = 112;
  const x0 = M + 10;
  for (const p of d.promoLines) {
    const rgb = hexToRgb(p.color ?? null);
    if (rgb) { pdf.setFillColor(rgb[0], rgb[1], rgb[2]); pdf.rect(x0, y - 3.8, boxW, 5, 'F'); }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text(p.text, x0 + 1.5, y);
    y += 5.5;
  }
  if (layout.closing.termsLines.length) {
    y += 6;
    const top = y - 4;
    pdf.setFillColor(191, 227, 245);
    pdf.rect(x0, top, boxW, 5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.text('PAYMENT TERMS :', x0 + 1.5, y - 0.4);
    y += 4.5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.6);
    for (const t of layout.closing.termsLines) {
      pdf.text(`${t.label} -`, x0 + 1.5, y);
      const lines = pdf.splitTextToSize(t.lines.join(' '), boxW - 40) as string[];
      lines.forEach((ln, i) => pdf.text(ln, x0 + 37, y + i * 3.9));
      y += Math.max(1, lines.length) * 3.9 + 1.2;
    }
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.2);
    pdf.rect(x0, top, boxW, y - top);
    y += 4;
  }
  // Two signature blocks.
  y = Math.max(y + 6, FOOTER_TOP - 32);
  if (y + 26 > FOOTER_TOP) y = FOOTER_TOP - 26;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  const company = d.brand.signatoryCompany || 'THE CONTS SDN BHD';
  pdf.text(`For and on behalf of ${company}:`, M, y);
  pdf.text(d.kind === 'VARIATION_ORDER' ? 'Agreed & Signed by Customer :' : 'Accepted & Agree by Customer :', 106, y);
  pdf.setFont('helvetica', 'normal');
  for (const [i, label] of ['Signature:', 'Name:', 'Date:'].entries()) {
    const ly = y + 14 + i * 4.6;
    pdf.text(label, M, ly);
    pdf.line(M + 16, ly, M + 70, ly);
    pdf.text(label, 106, ly);
    pdf.line(122, ly, 176, ly);
  }
}

export function renderRenovationDoc(pdf: JsPdf, d: PrintDoc, density: Density = 'normal'): Layout {
  const fontPt = ROW_HEIGHTS[density].fontPt;
  const wrap: WrapFn = (text, w, bold) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(fontPt);
    return pdf.splitTextToSize(text || ' ', w) as string[];
  };
  const layout = layoutDocument(d, wrap, { density });
  layout.pages.forEach((_, i) => {
    if (i > 0) pdf.addPage();
    drawLetterhead(pdf, d);
    drawInfo(pdf, d);
    drawColumnHeader(pdf, d);
    const endY = drawRows(pdf, d, layout, i, density);
    if (layout.pages[i].isLast) drawClosing(pdf, d, layout, layout.closing.ownPage ? BODY_TOP - 6 : endY);
    drawFooter(pdf, d, layout, i);
  });
  return layout;
}

export function renovationPdfFilename(d: PrintDoc): string {
  const who = (d.header.customerName || d.header.building || d.kind).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 32);
  return `${d.docNo}-${who || d.kind}.pdf`;
}
