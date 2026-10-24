/* The one letterhead every Conts document prints (owner, 24 Oct 2026: SO, DO, VO, PO and the rest must look like one
   family). It is the letterhead of the owner's sample quotations (renovation-doc-pdf.ts): the logo top left, the
   document title in large serif capitals top right, a black rule, then the company block in small type under the rule
   on the left. The engine's own documents (PO, GRN, amendments, invoices, the plain SO) draw the same letterhead and
   put their number and dates in a column on the right under the rule, where the quotation keeps its info block.
   The delivery order keeps its own template (delivery-order-pdf.ts): it is built for a multi-ply dot-matrix sheet on
   Letter paper (one face, nothing under 9pt, one page), which this letterhead's small type and height would break.
   Units are millimetres on an A4 jsPDF page. */

import type { jsPDF as JsPdf } from 'jspdf';

export interface LetterheadLogo { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number }

export const DOC_THEME = {
  logoTop: 12,
  logoMaxW: 62,
  logoMaxH: 24,
  titleFont: 'times',
  titlePt: 20,
  titleBaseline: 27,
  ruleY: 40,
  ruleWidth: 0.3,
  blockTop: 47,
  blockPt: 6.5,
  blockStep: 4.1,
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
}

/** Draws the letterhead and returns the y (mm) where the document's body may start. */
export function drawDocLetterhead(pdf: JsPdf, o: LetterheadOpts): number {
  const t = DOC_THEME;
  const M = o.margin ?? 14;
  const right = pdf.internal.pageSize.getWidth() - M;
  pdf.setTextColor(0);

  let markRight = M + 2;
  if (o.logo) {
    const scale = Math.min(t.logoMaxW / o.logo.width, t.logoMaxH / o.logo.height);
    const w = o.logo.width * scale;
    try {
      pdf.addImage(o.logo.dataUrl, o.logo.format, M + 2, t.logoTop, w, o.logo.height * scale);
      markRight = M + 2 + w;
    } catch {
      o = { ...o, logo: null };
    }
  }
  if (!o.logo) {
    pdf.setFont(t.titleFont, 'normal');
    pdf.setFontSize(20);
    pdf.setTextColor(30);
    const spaced = o.name.toUpperCase().split('').join(' ');
    pdf.text(spaced, M + 2, 26, { maxWidth: 100 });
    markRight = M + 2 + Math.min(100, pdf.getTextWidth(spaced));
    pdf.setTextColor(0);
  }

  // The title shrinks rather than run into the logo.
  pdf.setFont(t.titleFont, 'bold');
  let pt: number = t.titlePt;
  pdf.setFontSize(pt);
  const room = right - 4 - (markRight + 6);
  while (pt > 12 && pdf.getTextWidth(o.title) > room) { pt -= 1; pdf.setFontSize(pt); }
  pdf.text(o.title, right - 4, t.titleBaseline, { align: 'right' });

  pdf.setDrawColor(0);
  pdf.setLineWidth(t.ruleWidth);
  pdf.line(M + 2, t.ruleY, right - 2, t.ruleY);

  // Right column first: its width sets how wide the company block may run.
  // One "Label: value" text per row, right-aligned, as every engine document has always printed its number and dates.
  const meta = (o.meta ?? []).filter((m) => m.value).map((m) => `${m.label}${m.label.trim().endsWith(':') ? '' : ':'} ${m.value}`);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(t.metaPt);
  const metaW = Math.max(0, ...meta.map((m) => pdf.getTextWidth(m)));
  let metaY = t.blockTop;
  for (const m of meta) {
    pdf.text(m, right - 2, metaY, { align: 'right' });
    metaY += t.metaStep;
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(t.blockPt);
  const blockW = right - 2 - (metaW ? metaW + 8 : 0) - (M + 2);
  let y = t.blockTop;
  for (const line of o.lines) {
    if (!line) continue;
    for (const l of wrapLine(pdf, line, blockW)) {
      pdf.text(l, M + 2, y);
      y += t.blockStep;
    }
  }
  return Math.max(y, metaY) + 2;
}
