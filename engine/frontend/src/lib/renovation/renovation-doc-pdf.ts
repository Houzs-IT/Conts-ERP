/* Draws a renovation document (quotation, sales order, variation order) as an
   A4 portrait PDF in the layout of the owner's samples: brand letterhead and
   title, company block, Attention / To with the contact, property and LAST
   AMEND on the left and Prepared By / Building / Unit / Date on the right (empty
   Attention and Prepared By rows left out), the intro sentence, the column
   header, centred section banners, the rows with their dimension sub-line, a TOTAL box on every page, the bank
   line and terms, and on the last page the summary, promotion lines, payment
   terms and two signature blocks. Pagination comes from print-layout.ts so the
   page totals here are the ones its tests pin. */

import type { jsPDF as JsPdf } from 'jspdf';
import { PRINT_FORMATS } from './print-formats';
import { A4, BODY_TOP, FOOTER_TOP, layoutDocument, pageTotalSen, ROW_HEIGHTS, summaryRows, type Density, type Layout, type WrapFn } from './print-layout';
import { drawDocLetterhead } from './renovation-doc-theme';
import { clientContactLine, DOC_TITLE, rmGrouped, type PrintDoc } from './print-model';

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
  drawDocLetterhead(pdf, { title: DOC_TITLE[d.kind], name: b.name, logo: b.logo, lines: [...b.companyLines, b.contactLine], meta: [{ label: '', value: d.docNo }], margin: M });
}

const INFO_TOP = BODY_TOP - 31;
const INFO_ROW = 4.6;
const WRAPPED_LINE = 3.7;
const BLOCK_GAP = 1;
const CLIENT_VALUE_X = M + 26;
const META_LABEL_X = 126;
const META_VALUE_X = META_LABEL_X + 20;

interface InfoText {
  text: string;
  x: number;
  y: number;
  bold: boolean;
}

interface InfoPlan {
  texts: InfoText[];
  ruleY: number;
  bodyTop: number;
}

function placeLines(pdf: JsPdf, texts: InfoText[], line: { text: string; x: number; y: number; width: number; bold: boolean }): number {
  pdf.setFont('helvetica', line.bold ? 'bold' : 'normal');
  const lines = pdf.splitTextToSize(line.text, line.width) as string[];
  lines.forEach((text, i) => texts.push({ text, x: line.x, y: line.y + i * WRAPPED_LINE, bold: line.bold }));
  return line.y + Math.max(0, lines.length - 1) * WRAPPED_LINE;
}

function planClient(pdf: JsPdf, h: PrintDoc['header'], texts: InfoText[]): number {
  const width = META_LABEL_X - 4 - CLIENT_VALUE_X;
  const attention = h.customerName && h.attention !== h.customerName ? h.attention : '';
  let y = INFO_TOP;
  if (attention) {
    texts.push({ text: 'Attention', x: M + 2, y, bold: true });
    y = placeLines(pdf, texts, { text: attention, x: CLIENT_VALUE_X, y, width, bold: false }) + INFO_ROW;
  }
  texts.push({ text: 'To', x: M + 2, y, bold: true });
  y = placeLines(pdf, texts, { text: h.customerName || h.attention || ' ', x: CLIENT_VALUE_X, y, width, bold: true });
  const property = [h.property, h.lastAmended ? `LAST AMEND : ${dmy(h.lastAmended)}` : ''].filter(Boolean).join('   ');
  for (const block of [clientContactLine(h), property].filter(Boolean)) {
    y = placeLines(pdf, texts, { text: block, x: CLIENT_VALUE_X, y: y + WRAPPED_LINE + BLOCK_GAP, width, bold: false });
  }
  return y;
}

function planMeta(pdf: JsPdf, h: PrintDoc['header'], texts: InfoText[]): number {
  const rows: Array<[string, string]> = [['Prepared By', h.preparedBy], ['Building', h.building], ['Unit', h.unitNo], ['Date', dmy(h.docDate, true)]];
  let y = INFO_TOP - INFO_ROW;
  for (const [label, value] of rows.filter(([label, value]) => label !== 'Prepared By' || value)) {
    y += INFO_ROW;
    texts.push({ text: `${label}:`, x: META_LABEL_X, y, bold: true });
    y = placeLines(pdf, texts, { text: value || ' ', x: META_VALUE_X, y, width: RIGHT - META_VALUE_X, bold: false });
  }
  return y;
}

function planInfo(pdf: JsPdf, d: PrintDoc): InfoPlan {
  pdf.setFontSize(7.5);
  const texts: InfoText[] = [];
  const ruleY = Math.max(BODY_TOP - 13.8, planClient(pdf, d.header, texts) + 2, planMeta(pdf, d.header, texts) + 2);
  return { texts, ruleY, bodyTop: ruleY + 13.8 };
}

function drawInfo(pdf: JsPdf, d: PrintDoc, plan: InfoPlan): void {
  pdf.setFontSize(7.5);
  for (const { text, x, y, bold } of plan.texts) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.text(text, x, y);
  }
  pdf.setLineWidth(0.3);
  pdf.line(M, plan.ruleY, RIGHT, plan.ruleY);
  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(7);
  const intro = (d.header.intro ?? '') || d.brand.intro;
  pdf.text(intro, M, plan.ruleY + 3.6, { maxWidth: RIGHT - M });
  if (d.reference) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(d.reference, RIGHT, plan.ruleY + 3.6, { align: 'right' });
  }
}

function drawColumnHeader(pdf: JsPdf, d: PrintDoc, bodyTop: number): void {
  const cols = PRINT_FORMATS[d.format].columns;
  let x = M;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  for (const c of cols) {
    const tx = c.align === 'right' ? x + c.width - 1 : c.align === 'center' ? x + c.width / 2 : x + 1;
    pdf.text(c.label, tx, bodyTop - 3, { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
    x += c.width;
  }
}

function drawFooter(pdf: JsPdf, d: PrintDoc, layout: Layout, pageIdx: number): void {
  const page = layout.pages[pageIdx];
  const total = pageTotalSen(d, page);
  const boxX = 124;
  let y = FOOTER_TOP;
  // The last page of a qty-only document prints its package total once, in the summary.
  const blankLastTotal = page.isLast && total === null;
  if ((page.rows.length || !page.isLast) && !blankLastTotal) {
    pdf.setLineWidth(0.3);
    pdf.line(boxX, y, RIGHT, y);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('TOTAL (RM)', boxX + 22, y + 4.2, { align: 'center' });
    pdf.setFontSize(9);
    pdf.text(total === null ? '' : rmGrouped(total), RIGHT - 1, y + 4.2, { align: 'right' });
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
      pdf.text(rmGrouped(r.sen), RIGHT - 1, y + 4, { align: 'right' });
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
  let y = layout.bodyTop;
  for (const r of layout.pages[pageIdx].rows) {
    if (r.type === 'spacer') { y += r.heightMm; continue; }
    if (r.type === 'band') {
      const rgb = hexToRgb(r.color);
      if (rgb) { pdf.setFillColor(rgb[0], rgb[1], rgb[2]); pdf.rect(M, y, RIGHT - M, r.heightMm, 'F'); }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(h.fontPt);
      r.textLines.forEach((t, i) => pdf.text(t, (M + RIGHT) / 2, y + h.band * 0.68 + i * h.extraLine, { align: 'center' }));
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
        if (r.dimensionLines.length) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(h.fontPt - 0.8);
          pdf.setTextColor(51);
          r.dimensionLines.forEach((t, i) => pdf.text(t, x + 1, base + (r.textLines.length + i) * h.extraLine));
          pdf.setTextColor(0);
          pdf.setFontSize(h.fontPt);
        }
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
  const info = planInfo(pdf, d);
  const layout = layoutDocument(d, wrap, { density, bodyTop: info.bodyTop });
  layout.pages.forEach((_, i) => {
    if (i > 0) pdf.addPage();
    drawLetterhead(pdf, d);
    drawInfo(pdf, d, info);
    drawColumnHeader(pdf, d, layout.bodyTop);
    const endY = drawRows(pdf, d, layout, i, density);
    if (layout.pages[i].isLast) drawClosing(pdf, d, layout, layout.closing.ownPage ? layout.bodyTop - 6 : endY);
    drawFooter(pdf, d, layout, i);
  });
  return layout;
}

export function renovationPdfFilename(d: PrintDoc): string {
  const who = (d.header.customerName || d.header.building || d.kind).replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 32);
  return `${d.docNo}-${who || d.kind}.pdf`;
}
