/* The one letterhead every Conts document prints (owner, 24 Oct 2026: SO, DO, VO, PO and the rest must look like one
   family). The logo top left with the company block under it, the document title in serif capitals top right, then a
   black rule (owner, 6 Nov 2026). The engine's own documents (PO, GRN, amendments, invoices, the plain SO) draw the same letterhead and
   put their number and dates under the title.
   The delivery order draws it too (owner, 24 Oct 2026: Conts prints DOs on a normal A4 printer, not dot-matrix), with its
   scan code in the space `reserve` keeps beside the number column.
   Units are millimetres on an A4 jsPDF page. */

import type { jsPDF as JsPdf } from 'jspdf';
import { brandLogoFor } from './brand-logos';

export interface LetterheadLogo { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number }

export const DOC_THEME = {
  logoTop: 12,
  logoMaxW: 54,
  logoMaxH: 14,
  titleFont: 'times',
  titlePt: 17,
  titleBaseline: 19,
  ruleY: 44,
  ruleWidth: 0.3,
  blockNamePt: 8.5,
  blockPt: 7.5,
  blockStep: 3.8,
  blockMaxW: 112,
  metaPt: 8,
  metaStep: 4.6,
} as const;

/** Breaks a company-block line only after a comma, so "No. 2," never splits; a single chunk wider than the measure
    falls back to a word wrap. */
function wrapLine(pdf: JsPdf, line: string, maxW: number): string[] {
  const chunks = (line.match(/[^,]+,?/g) ?? [line]).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const c of chunks) {
    const next = cur ? `${cur} ${c}` : c;
    if (cur && pdf.getTextWidth(next) > maxW) { out.push(cur); cur = c; } else cur = next;
  }
  if (cur) out.push(cur);
  return out.flatMap((l) => (pdf.getTextWidth(l) > maxW ? (pdf.splitTextToSize(l, maxW) as string[]) : [l]));
}

export interface LetterheadOpts {
  title: string;
  /** Shown in spaced capitals where the logo goes when there is no logo. */
  name: string;
  logo?: LetterheadLogo | null;
  /** The company block, one entry per printed line (long lines wrap at commas). */
  lines: ReadonlyArray<string | null | undefined>;
  /** The document's number and dates, right-aligned under the rule. */
  meta?: ReadonlyArray<{ label: string; value: string }>;
  margin?: number;
  /** Width (mm) kept free left of the right column, for something the caller draws there (the DO's scan code). */
  reserve?: number;
  /** false: the caller draws the rule, under something of its own in the right column. */
  rule?: boolean;
}

/** Draws the letterhead and returns the y (mm) where the document's body may start. */
export function drawDocLetterhead(pdf: JsPdf, o: LetterheadOpts): number {
  return drawDocLetterheadAt(pdf, o).bottom;
}

/** As drawDocLetterhead, also giving where the right column (with its reserved space) begins and how far down it runs.
    The owner's choice of 6 Nov 2026: logo and company block on the left, the title and number top right, then the rule. */
export function drawDocLetterheadAt(pdf: JsPdf, o: LetterheadOpts): { bottom: number; columnLeft: number; columnTop: number } {
  const t = DOC_THEME;
  const M = o.margin ?? 14;
  const right = pdf.internal.pageSize.getWidth() - M;
  pdf.setTextColor(0);

  const logo = o.logo ?? brandLogoFor(o.name);
  const scale = Math.min(t.logoMaxW / logo.width, t.logoMaxH / logo.height);
  const logoW = logo.width * scale;
  const logoH = logo.height * scale;
  pdf.addImage(logo.dataUrl, logo.format, M, t.logoTop, logoW, logoH);

  // One "Label: value" text per row; a row with no label prints its value alone.
  const meta = (o.meta ?? []).filter((m) => m.value).map((m) => {
    const label = m.label.trim();
    return label ? `${label}${label.endsWith(':') ? '' : ':'} ${m.value}` : m.value;
  });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(t.metaPt);
  const metaW = Math.max(0, ...meta.map((m) => pdf.getTextWidth(m)));
  const columnLeft = right - metaW - (o.reserve ?? 0);

  // The title shrinks rather than run into the logo.
  pdf.setFont(t.titleFont, 'bold');
  let pt: number = t.titlePt;
  pdf.setFontSize(pt);
  const room = right - M - logoW - 6;
  while (pt > 12 && pdf.getTextWidth(o.title) > room) { pt -= 1; pdf.setFontSize(pt); }
  pdf.text(o.title, right, t.titleBaseline, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(t.metaPt);
  let metaY = t.titleBaseline + 5.5;
  const columnTop = metaY - 2.5;
  for (const m of meta) {
    pdf.text(m, right, metaY, { align: 'right' });
    metaY += t.metaStep;
  }

  /* The company's name reads first and the address and contact sit smaller under it (owner, 6 Nov 2026). */
  const blockW = Math.min(t.blockMaxW, columnLeft - M - 6);
  pdf.setFontSize(t.blockPt);
  const blockLines = o.lines.filter((l): l is string => !!l).flatMap((l, i) => {
    if (i === 0) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(t.blockNamePt); }
    const wrapped = wrapLine(pdf, l, blockW);
    if (i === 0) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(t.blockPt); }
    return wrapped.map((text, j) => ({ text, name: i === 0 && j === 0 }));
  });
  let blockY = t.logoTop + logoH + 3.5;
  for (const l of blockLines) {
    pdf.setFont('helvetica', l.name ? 'bold' : 'normal');
    pdf.setFontSize(l.name ? t.blockNamePt : t.blockPt);
    pdf.text(l.text, M, blockY);
    blockY += t.blockStep;
  }

  const contentBottom = Math.max(blockY - t.blockStep + 2, metaY - t.metaStep + 2, t.logoTop + logoH + 2);
  if (o.rule === false) return { bottom: contentBottom, columnLeft, columnTop };
  const ruleY = Math.max(t.ruleY, contentBottom + 1);
  pdf.setDrawColor(0);
  pdf.setLineWidth(t.ruleWidth);
  pdf.line(M, ruleY, right, ruleY);
  return { bottom: ruleY + 6, columnLeft, columnTop };
}
