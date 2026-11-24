/* A renovation document turned into printable rows: section banners, item
   lines numbered straight through the document, unnumbered add-on and
   dimension lines, the text each column shows for the chosen format, and the
   money each row contributes to its page. Pure: print-layout.ts paginates it,
   renovation-doc-pdf.ts draws it. */

import { formatMeasure, formatRm, lineAmounts, qtyLabel, type RenoLineKind } from '../../vendor/shared/renovation-money';
import { uomPrintLabel } from '../../vendor/shared/renovation-catalog';
import { PRINT_FORMATS, type ColumnKey, type PrintFormat } from './print-formats';

export type DocKind = 'QUOTATION' | 'SALES_ORDER' | 'VARIATION_ORDER';

export interface PrintLineInput {
  /** Line id and SKU, for the sales order's item, area or category layouts. */
  id?: string;
  itemCode?: string | null;
  kind: RenoLineKind;
  description: string;
  room?: string;
  qty: number;
  measureMilli: number | null;
  measureUom: string | null;
  uom?: string | null;
  unitPriceSen: number;
  listPriceSen?: number | null;
  discountBp: number;
  amountOverrideSen: number | null;
  isFoc: boolean;
  highlight?: 'NONE' | 'GREY' | 'PINK';
  pageBreakBefore?: boolean;
  parentId?: string | null;
  /** VO only: omitted lines print negative. */
  voChange?: 'ADD' | 'OMIT' | null;
  /** VO omit lines carry their signed amount from the server. */
  netSenOverride?: number | null;
  omitted?: boolean;
}

export interface PrintSectionInput {
  heading: string;
  bandColor: string | null;
  lumpSumSen: number | null;
  pageBreakBefore?: boolean;
  lines: PrintLineInput[];
}

export interface PrintBrand {
  name: string;
  logo?: { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number } | null;
  companyLines: string[];
  contactLine: string;
  bankLine: string;
  termsLines: string[];
  intro: string;
  signatoryCompany: string;
}

export interface PrintDoc {
  kind: DocKind;
  docNo: string;
  format: PrintFormat;
  brand: PrintBrand;
  header: {
    attention: string;
    customerName: string;
    building: string;
    unitNo: string;
    preparedBy: string;
    docDate: string | null;
    lastAmended: string | null;
    intro?: string | null;
    /** Quotation customer + property block (mig 0116); blank prints nothing. */
    customerPhone?: string;
    siteAddress?: string;
    /** "Condo · 3 bed 2 bath · 1,100 sq ft". */
    property?: string;
  };
  sections: PrintSectionInput[];
  docDiscountSen: number;
  docDiscountLabel: string;
  promoLines: Array<{ text: string; color?: string | null }>;
  instalments: Array<{ seq: number; label: string; pctBp: number; description: string }>;
  /** VO: the contract it varies. */
  reference?: string | null;
}

export type Highlight = 'NONE' | 'GREY' | 'PINK';

export type PrintRow =
  | { type: 'band'; text: string; color: string | null; amount: string; netSen: number; listSen: number; pageBreakBefore: boolean }
  | { type: 'line'; cells: Partial<Record<ColumnKey, string>>; dimensions: string; bold: boolean; highlight: Highlight; netSen: number; listSen: number; pageBreakBefore: boolean; groupStart: boolean }
  | { type: 'spacer' };

export const DOC_TITLE: Record<DocKind, string> = { QUOTATION: 'QUOTATION', SALES_ORDER: 'SALES ORDER', VARIATION_ORDER: 'VARIATION ORDER' };

export const BANNER_COLOR = '#DCE8F5';

/** Ringgit grouped with two decimals ("1,995.00"). */
export const rmGrouped = (sen: number): string => formatRm(sen);

const squashed = (text: string): string => text.replace(/\s+/g, '').toUpperCase();

function withoutHeading(description: string, heading: string): string {
  const at = description.lastIndexOf('@');
  return at > 0 && heading.trim() && squashed(description.slice(at + 1)) === squashed(heading) ? description.slice(0, at).trimEnd() : description;
}

function withRoom(title: string, l: PrintLineInput, heading: string): string {
  const room = (l.room ?? '').trim();
  if (!room || squashed(l.description).includes(squashed(room)) || squashed(room) === squashed(heading)) return title;
  return `${title} @ ${room}`;
}

export interface SplitDescription {
  title: string;
  dimensions: string;
}

function normaliseDimensions(text: string): string {
  return text
    .replace(/\s*:\s*/g, ': ')
    .replace(/(\d)\s*(MM|CM|FT|M)\b/gi, '$1 $2')
    .replace(/\s+[X×]\s+/gi, ' × ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isOnlyNames(part: string, names: string[]): boolean {
  const rest = names.reduce((text, name) => text.replace(new RegExp(`(^|\\s)${escapeRegExp(name)}(?=$|\\s)`, 'gi'), '$1'), part);
  return !/[A-Za-z0-9]/.test(rest);
}

/** Building and unit print in their own rows, so an address part that is only those is left out. */
export function clientContactLine(h: Pick<PrintDoc['header'], 'customerPhone' | 'siteAddress' | 'building' | 'unitNo'>): string {
  const names = [h.unitNo, h.building].map((name) => name.trim()).filter(Boolean);
  const address = (h.siteAddress ?? '').split(/\r?\n|,/).map((part) => part.trim())
    .filter((part) => part && !(names.length && isOnlyNames(part, names))).join(', ');
  return [h.customerPhone, address].filter(Boolean).join(' · ');
}

export function splitDimensions(description: string): SplitDescription {
  const text = description.trim();
  const start = text.search(/\b[WHDL]\s*:/i);
  const title = start > 0 ? text.slice(0, start).replace(/[\s@,:-]+$/, '') : '';
  if (!title) return { title: text, dimensions: '' };
  return { title, dimensions: normaliseDimensions(text.slice(start)) };
}

function pct(bp: number): string {
  const n = (bp / 100).toFixed(bp % 100 ? 2 : 0);
  return `-${n.includes('.') ? n.replace(/0+$/, '') : n}%`;
}

export function buildRows(doc: Pick<PrintDoc, 'sections' | 'format'>): PrintRow[] {
  const fmt = PRINT_FORMATS[doc.format];
  const showMoney = fmt.pageTotal !== 'none';
  const rows: PrintRow[] = [];
  let no = 0;
  for (const s of doc.sections) {
    const lump = s.lumpSumSen != null;
    const lumpAmount = lump ? s.lumpSumSen! : 0;
    rows.push({
      type: 'band', text: s.heading.toUpperCase(), color: s.bandColor ?? (s.heading.trim() ? BANNER_COLOR : null),
      amount: lump && showMoney ? rmGrouped(lumpAmount) : '',
      netSen: lumpAmount, listSen: lumpAmount, pageBreakBefore: Boolean(s.pageBreakBefore),
    });
    let seenItem = false;
    let groupHasSub = false;
    for (const l of s.lines) {
      const priced = l.kind === 'ITEM' || l.kind === 'CHILD';
      const a = lineAmounts({
        kind: l.kind, qty: l.qty, measureMilli: l.measureMilli, measureUom: l.measureUom, uom: l.uom ?? null,
        unitPriceSen: l.unitPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen, isFoc: l.isFoc,
      });
      const sign = l.voChange === 'OMIT' ? -1 : 1;
      const netSen = lump || !priced ? 0 : (l.netSenOverride ?? a.netSen * sign);
      const listSen = lump || !priced ? 0 : a.baseSen * sign;
      const numbered = l.kind === 'ITEM' || (lump && l.kind === 'DETAIL' && !l.parentId);
      // A blank row between item groups that carry add-ons or dimensions (the samples' rhythm);
      // a run of single-line items (a wiring list) stays tight.
      if (l.kind === 'ITEM' && seenItem && groupHasSub && !lump) rows.push({ type: 'spacer' });
      if (l.kind === 'ITEM') { seenItem = true; groupHasSub = false; } else groupHasSub = true;
      const { title, dimensions } = splitDimensions(withoutHeading(l.description, s.heading));
      const cells: Partial<Record<ColumnKey, string>> = { desc: (l.voChange === 'OMIT' ? 'OMIT: ' : '') + withRoom(title, l, s.heading) };
      if (numbered) cells.no = String(++no);
      if (priced || (lump && numbered)) {
        if (priced) cells.qty = qtyLabel({ qty: l.qty, measureMilli: l.measureMilli, measureUom: l.measureUom, uom: l.uom ?? null });
        if (priced && !lump) {
          const measured = l.measureMilli !== null;
          const rate = rmGrouped(l.unitPriceSen);
          const money = l.isFoc ? 'FOC' : rmGrouped(netSen);
          switch (doc.format) {
            case 'AMOUNT':
              if (measured) cells.unit = `${rate}/${uomPrintLabel(l.measureUom ?? 'FT')}`;
              cells.amount = money;
              break;
            case 'UNIT_PRICE':
              cells.unit = measured ? `${rate}/${uomPrintLabel(l.measureUom ?? 'FT')}` : rate;
              cells.amount = money;
              break;
            case 'DISCOUNT':
              cells.discPrice = l.isFoc ? 'FOC' : rmGrouped(netSen);
              cells.disc = l.discountBp ? pct(l.discountBp) : '';
              cells.amount = rmGrouped(listSen);
              break;
            case 'PROMO_STANDARD':
              cells.promo = l.isFoc ? 'FOC' : rate;
              cells.standard = l.listPriceSen ? rmGrouped(l.listPriceSen) : '';
              break;
            case 'QTY_ONLY':
              break;
          }
        }
      }
      rows.push({
        type: 'line', cells, dimensions, bold: l.kind === 'ITEM' || l.kind === 'CHILD', highlight: l.highlight ?? 'NONE',
        netSen, listSen, pageBreakBefore: Boolean(l.pageBreakBefore), groupStart: l.kind === 'ITEM',
      });
    }
  }
  return rows;
}

export interface DocSummary {
  listSen: number;
  netSen: number;
  docDiscountSen: number;
  finalSen: number;
  /** list - final (format 3's DISCOUNT row). */
  discountSen: number;
}

export function summaryOf(rows: PrintRow[], docDiscountSen: number): DocSummary {
  let listSen = 0;
  let netSen = 0;
  for (const r of rows) {
    if (r.type === 'spacer') continue;
    listSen += r.listSen;
    netSen += r.netSen;
  }
  const finalSen = netSen - docDiscountSen;
  return { listSen, netSen, docDiscountSen, finalSen, discountSen: listSen - finalSen };
}

export function measureLabel(milli: number | null, uom: string | null): string {
  return milli === null ? '' : `${formatMeasure(milli)} ${uomPrintLabel(uom ?? 'FT')}`;
}
