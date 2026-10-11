/* Paginate a renovation document onto A4 portrait pages the way the owner's
   samples are laid out: the letterhead, info block and column header repeat on
   every page, the body holds as many rows as fit (or breaks where a section or
   line asks to), every page ends with its TOTAL box, bank line and terms, and
   the last page carries the summary (GRAND TOTAL, or TOTAL -> DISCOUNT -> FINAL
   TOTAL), promotion lines, payment terms and the two signature blocks. When the
   closing block does not fit under the last rows it gets a page of its own (as
   the D'Clover sample's page 9).

   All geometry in mm. Pure: the wrap function is injected (jsPDF's
   splitTextToSize when drawing, a character estimate in tests). */

import { PRINT_FORMATS } from './print-formats';
import { buildRows, summaryOf, type DocSummary, type PrintDoc, type PrintRow } from './print-model';

export const A4 = { width: 210, height: 297, margin: 14 } as const;
/** Where the body starts under the repeated header block, and where the footer starts. */
export const BODY_TOP = 102;
export const FOOTER_TOP = 250;
export const BODY_HEIGHT = FOOTER_TOP - BODY_TOP;
export type Density = 'normal' | 'compact';
/** Row heights per density. The samples differ: AVA prints about 15 rows a page, the D'Clover
    sheet (Excel "fit to page") about 35. 'compact' is the second, offered at print time. */
export const ROW_HEIGHTS: Record<Density, { band: number; line: number; extraLine: number; spacer: number; fontPt: number }> = {
  normal: { band: 6.2, line: 5.2, extraLine: 3.8, spacer: 5, fontPt: 7.5 },
  compact: { band: 4.8, line: 3.7, extraLine: 3.0, spacer: 2.6, fontPt: 6.3 },
};

export type WrapFn = (text: string, widthMm: number, bold: boolean) => string[];

/** Helvetica estimate for tests and previews: about 0.62 chars per mm at 7.5 pt (bold a little wider). */
export const approxWrap: WrapFn = (text, widthMm, bold) => {
  const perLine = Math.max(8, Math.floor(widthMm * (bold ? 0.56 : 0.62)));
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= perLine) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur || out.length === 0) out.push(cur);
  return out;
};

export type LaidRow = PrintRow & { textLines: string[]; heightMm: number };

export interface LayoutPage {
  index: number;
  rows: LaidRow[];
  usedMm: number;
  netSen: number;
  listSen: number;
  isLast: boolean;
}

export interface ClosingBlock {
  summary: DocSummary;
  /** The closing block (summary + promo + terms + signatures) starts a fresh page. */
  ownPage: boolean;
  heightMm: number;
  termsLines: Array<{ label: string; lines: string[] }>;
}

export interface Layout {
  pages: LayoutPage[];
  closing: ClosingBlock;
  density: Density;
}

function descWidth(doc: Pick<PrintDoc, 'format'>): number {
  return PRINT_FORMATS[doc.format].columns.find((c) => c.key === 'desc')!.width - 2;
}

function rowHeight(r: PrintRow, lines: number, density: Density): number {
  const h = ROW_HEIGHTS[density];
  if (r.type === 'spacer') return h.spacer;
  if (r.type === 'band') return h.band + Math.max(0, lines - 1) * h.extraLine;
  return h.line + Math.max(0, lines - 1) * h.extraLine;
}

export function closingHeight(doc: Pick<PrintDoc, 'promoLines' | 'instalments' | 'kind'>, wrap: WrapFn): { height: number; termsLines: ClosingBlock['termsLines'] } {
  const termsLines = doc.instalments.map((i) => ({
    label: `${i.label || `${i.seq}`} - ${(i.pctBp / 100).toFixed(i.pctBp % 100 ? 2 : 0)}%`,
    lines: wrap(i.description || '', 120, false),
  }));
  let h = 0;
  h += doc.promoLines.length * 5.5;
  if (termsLines.length) h += 8 + termsLines.reduce((s, t) => s + Math.max(1, t.lines.length) * 3.9 + 1.2, 0) + 4;
  h += 34; // two signature blocks
  return { height: h, termsLines };
}

export function layoutDocument(doc: PrintDoc, wrap: WrapFn = approxWrap, opts: { density?: Density } = {}): Layout {
  const density = opts.density ?? 'normal';
  const rows = buildRows(doc);
  const width = descWidth(doc);
  const pages: LayoutPage[] = [];
  let cur: LayoutPage = { index: 0, rows: [], usedMm: 0, netSen: 0, listSen: 0, isLast: false };
  const close = () => { pages.push(cur); cur = { index: pages.length, rows: [], usedMm: 0, netSen: 0, listSen: 0, isLast: false }; };
  const hasContent = () => cur.rows.some((r) => r.type !== 'spacer');

  for (const r of rows) {
    const text = r.type === 'band' ? r.text : r.type === 'line' ? (r.cells.desc ?? '') : '';
    const textLines = r.type === 'spacer' ? [] : wrap(text, r.type === 'band' ? width - 24 : width, r.type === 'band' || r.bold);
    const laid: LaidRow = { ...r, textLines, heightMm: rowHeight(r, textLines.length, density) };
    if (laid.type === 'spacer' && !hasContent()) continue;
    const forced = laid.type !== 'spacer' && laid.pageBreakBefore && hasContent();
    if (forced || cur.usedMm + laid.heightMm > BODY_HEIGHT) {
      // Never leave a section band alone at the foot of a page.
      const carry: LaidRow[] = [];
      while (cur.rows.length && (cur.rows[cur.rows.length - 1].type === 'band' || cur.rows[cur.rows.length - 1].type === 'spacer')) {
        const last = cur.rows.pop()!;
        cur.usedMm -= last.heightMm;
        if (last.type === 'band') carry.unshift(last);
      }
      if (cur.rows.length) close();
      for (const c of carry) { cur.rows.push(c); cur.usedMm += c.heightMm; }
      if (laid.type === 'spacer') continue;
    }
    cur.rows.push(laid);
    cur.usedMm += laid.heightMm;
  }
  if (cur.rows.length || pages.length === 0) close();

  for (const p of pages) {
    for (const r of p.rows) {
      if (r.type === 'spacer') continue;
      p.netSen += r.netSen;
      p.listSen += r.listSen;
    }
  }
  const summary = summaryOf(rows, doc.docDiscountSen);
  const { height, termsLines } = closingHeight(doc, wrap);
  const last = pages[pages.length - 1];
  const ownPage = last.usedMm + height > BODY_HEIGHT;
  if (ownPage) pages.push({ index: pages.length, rows: [], usedMm: 0, netSen: 0, listSen: 0, isLast: false });
  pages[pages.length - 1].isLast = true;
  return { pages, closing: { summary, ownPage, heightMm: height, termsLines }, density };
}

/** What a page's TOTAL box shows, per format ('' = box left blank). */
export function pageTotalSen(doc: Pick<PrintDoc, 'format'>, page: LayoutPage): number | null {
  const t = PRINT_FORMATS[doc.format].pageTotal;
  if (t === 'none') return null;
  return t === 'list' ? page.listSen : page.netSen;
}

/** The last page's summary rows. */
export function summaryRows(doc: Pick<PrintDoc, 'format' | 'docDiscountSen' | 'docDiscountLabel'>, s: DocSummary): Array<{ label: string; sen: number; tone: 'plain' | 'discount' | 'final' }> {
  if (doc.format === 'DISCOUNT') {
    return [
      { label: 'TOTAL (RM)', sen: s.listSen, tone: 'plain' },
      { label: 'DISCOUNT (RM)', sen: s.discountSen, tone: 'discount' },
      { label: 'FINAL TOTAL (RM)', sen: s.finalSen, tone: 'final' },
    ];
  }
  if (doc.format === 'QTY_ONLY') return [{ label: 'TOTAL (RM)', sen: s.finalSen, tone: 'final' }];
  if (s.docDiscountSen > 0) {
    return [
      { label: 'TOTAL (RM)', sen: s.netSen, tone: 'plain' },
      { label: doc.docDiscountLabel ? `${doc.docDiscountLabel} (RM)`.toUpperCase() : 'DISCOUNT (RM)', sen: s.docDiscountSen, tone: 'discount' },
      { label: 'GRAND TOTAL', sen: s.finalSen, tone: 'final' },
    ];
  }
  return [{ label: 'GRAND TOTAL', sen: s.finalSen, tone: 'final' }];
}
