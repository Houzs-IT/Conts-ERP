/* The one letterhead every Conts document prints (owner, 24 Oct 2026: SO, DO, VO, PO and the rest must look like one
   family). The logo top left, the company block in small type top right, a black rule, then the document title in
   serif capitals on the left under the rule. The engine's own documents (PO, GRN, amendments, invoices, the plain SO) draw the same letterhead and
   put their number and dates in a column on the right under the rule, where the quotation keeps its info block.
   The delivery order draws it too (owner, 24 Oct 2026: Conts prints DOs on a normal A4 printer, not dot-matrix), with its
   scan code in the space `reserve` keeps beside the number column.
   Units are millimetres on an A4 jsPDF page. */

import type { jsPDF as JsPdf } from 'jspdf';
import { brandLogoFor } from './brand-logos';

export interface LetterheadLogo { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number }

export const DOC_THEME = {
  logoTop: 12,
  logoMaxW: 62,
  logoMaxH: 18,
  titleFont: 'times',
  titlePt: 18,
  titleBaseline: 27,
  ruleY: 32,
  ruleWidth: 0.3,
  blockTop: 47,
  blockPt: 7,
  blockStep: 3.6,
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
}

/** Draws the letterhead and returns the y (mm) where the document's body may start. */
export function drawDocLetterhead(pdf: JsPdf, o: LetterheadOpts): number {
  return drawDocLetterheadAt(pdf, o).bottom;
}

/** As drawDocLetterhead, also giving the x where the right column (with its reserved space) begins. */
export function drawDocLetterheadAt(pdf: JsPdf, o: LetterheadOpts): { bottom: number; columnLeft: number } {
  const t = DOC_THEME;
  const M = o.margin ?? 14;
  const right = pdf.internal.pageSize.getWidth() - M;
  pdf.setTextColor(0);

  /* Logo left, company block right, a rule, then the title and the document's number (owner, 5 Nov 2026). */
  const logo = o.logo ?? brandLogoFor(o.name);
  const scale = Math.min(t.logoMaxW / logo.width, t.logoMaxH / logo.height);
  const logoW = logo.width * scale;
  const logoH = logo.height * scale;
  pdf.addImage(logo.dataUrl, logo.format, M + 2, t.logoTop, logoW, logoH);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(t.blockPt);
  const blockW = right - 2 - (M + 2 + logoW + 8);
  let blockY = t.logoTop + 2.5;
  for (const line of o.lines) {
    if (!line) continue;
    for (const l of wrapLine(pdf, line, blockW)) {
      pdf.text(l, right - 2, blockY, { align: 'right' });
      blockY += t.blockStep;
    }
  }

  const ruleY = Math.max(t.ruleY, t.logoTop + logoH + 3, blockY);
  pdf.setDrawColor(0);
  pdf.setLineWidth(t.ruleWidth);
  pdf.line(M + 2, ruleY, right - 2, ruleY);

  // One "Label: value" text per row, right-aligned, as every engine document has always printed its number and dates.
  const meta = (o.meta ?? []).filter((m) => m.value).map((m) => `${m.label}${m.label.trim().endsWith(':') ? '' : ':'} ${m.value}`);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(t.metaPt);
  const metaW = Math.max(0, ...meta.map((m) => pdf.getTextWidth(m)));
  let metaY = ruleY + 6;
  for (const m of meta) {
    pdf.text(m, right - 2, metaY, { align: 'right' });
    metaY += t.metaStep;
  }
  const columnLeft = right - 2 - metaW - (o.reserve ?? 0);

  // The title shrinks rather than run into the number column.
  pdf.setFont(t.titleFont, 'bold');
  let pt: number = t.titlePt;
  pdf.setFontSize(pt);
  const room = columnLeft - 6 - (M + 2);
  while (pt > 12 && pdf.getTextWidth(o.title) > room) { pt -= 1; pdf.setFontSize(pt); }
  const y = ruleY + 9;
  pdf.text(o.title, M + 2, y);
  return { bottom: Math.max(y, metaY) + 2, columnLeft };
}
