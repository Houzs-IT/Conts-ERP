/* The quotation on the sales order's page (owner, 6 Nov 2026: "Quotation 整个 FE 从 SO clone 过去"). The SO's form works on
   rooms and flat lines; a quotation keeps sections and doc lines. These two functions carry one to the other, and a
   saved line keeps every field the SO's row does not show (lump sums, TEXT lines, amount overrides, highlights). */

import type { DocHeader, DocLine, DocSection } from '../../lib/renovation/api';
import { EMPTY_CUSTOMER_PROPERTY, type CustomerPropertyValue } from '../projects/renovation/customerPropertyModel';
import type { QuoteParty } from '../renovation/QuotationCustomerCard';
import { placeRows } from '../renovation/roomSections';
import type { SoPrintRooms } from '../../vendor/scm/lib/so-print-rooms';
import type { SoDisplayLine } from './soDetailParts';

export type QuotationLine = SoDisplayLine;

export interface QuoteFormLine {
  rid: string;
  itemCode: string;
  description: string;
  uom: string;
  qty: number;
  unitPriceSen: number;
  discountSen: number;
  unitCostSen: number;
  remark: string;
}

export interface QuoteSources {
  /** The saved line behind a row, by row id. */
  lines: Record<string, DocLine>;
  /** The discount the row opened with: unchanged money keeps the saved discount and override as they are. */
  openedDiscountSen: Record<string, number>;
  /** The saved section behind a room, by room name. */
  rooms: Record<string, DocSection>;
}

const DEFAULT_ROOM = 'Common area';

const openingDiscount = (l: DocLine): number => {
  const gross = l.qty * l.unitPriceSen;
  return l.amountOverrideSen != null ? gross - l.amountOverrideSen : Math.round((gross * l.discountBp) / 10000);
};

/** Rooms and rows for the form. A section with no heading shows as Common area and a repeated heading gets a number:
    the form names rooms uniquely, and saving puts the saved heading back. */
export function seedQuoteForm(sections: readonly DocSection[], newRid: () => string) {
  const rooms: string[] = [];
  const lineRoom: Record<string, string> = {};
  const lines: QuoteFormLine[] = [];
  const sources: QuoteSources = { lines: {}, openedDiscountSen: {}, rooms: {} };
  for (const s of sections) {
    const base = s.heading.trim() || DEFAULT_ROOM;
    let room = base;
    for (let n = 2; rooms.some((r) => r.toLowerCase() === room.toLowerCase()); n += 1) room = `${base} (${n})`;
    rooms.push(room);
    sources.rooms[room] = s;
    for (const l of s.lines) {
      const rid = newRid();
      const discountSen = openingDiscount(l);
      lines.push({
        rid, itemCode: l.itemCode ?? '', description: l.description, uom: l.uom ?? 'UNIT', qty: l.qty,
        unitPriceSen: l.unitPriceSen, discountSen, unitCostSen: l.unitCostSen, remark: '',
      });
      lineRoom[rid] = room;
      sources.lines[rid] = l;
      sources.openedDiscountSen[rid] = discountSen;
    }
  }
  return { rooms, lineRoom, lines, sources };
}

const emptyDocLine = (room: string): DocLine => ({
  kind: 'ITEM', room, itemCode: null, description: '', qty: 1, measure: null, measureUom: null, uom: null, unitPriceSen: 0, listPriceSen: null,
  discountBp: 0, amountOverrideSen: null, isFoc: false, supplyByOwner: false, highlight: 'NONE', supplierId: null, unitCostSen: 0,
  stageCode: null, pageBreakBefore: false,
});

/** The form's rooms and rows as the quotation's sections. A row with no product and nothing saved behind it is left out. */
export function sectionsFromForm(
  rooms: readonly string[],
  lines: readonly QuoteFormLine[],
  lineRoom: Readonly<Record<string, string>>,
  sources: QuoteSources,
): DocSection[] {
  const placed = placeRows(rooms, lines.map((l) => ({ key: l.rid, room: lineRoom[l.rid] ?? '' })));
  return placed.rooms.map((room) => {
    const saved = sources.rooms[room] as DocSection | undefined;
    const heading = saved ? saved.heading : room;
    return {
      heading, bandColor: saved?.bandColor ?? null, lumpSumSen: saved?.lumpSumSen ?? null, pageBreakBefore: saved?.pageBreakBefore ?? false,
      lines: lines.filter((l) => placed.roomOf[l.rid] === room && (l.itemCode.trim() !== '' || sources.lines[l.rid])).map((l): DocLine => {
        const o = sources.lines[l.rid] as DocLine | undefined;
        if (o?.kind === 'TEXT') return { ...o, room: heading, description: l.description };
        const gross = l.qty * l.unitPriceSen;
        const unchanged = o != null && o.qty === l.qty && o.unitPriceSen === l.unitPriceSen && sources.openedDiscountSen[l.rid] === l.discountSen;
        return {
          ...(o ?? emptyDocLine(heading)),
          room: heading, itemCode: l.itemCode.trim() || (o?.itemCode ?? null), uom: l.uom || null, qty: l.qty, unitPriceSen: l.unitPriceSen, unitCostSen: l.unitCostSen,
          description: [l.description, l.remark].filter((t) => t.trim()).join(' - '),
          discountBp: unchanged ? o.discountBp : gross > 0 ? Math.min(10000, Math.round((l.discountSen / gross) * 10000)) : 0,
          amountOverrideSen: unchanged ? o.amountOverrideSen : null,
        };
      }),
    };
  });
}

const numText = (n: number | null | undefined) => (n == null ? '' : String(n));

/** The SO's customer block from the quotation's header. The site address is one text there and two lines here. */
export function blockFromQuote(h: DocHeader, projectId: number | null): CustomerPropertyValue {
  const [address1 = '', ...rest] = (h.siteAddress ?? '').split('\n');
  return {
    ...EMPTY_CUSTOMER_PROPERTY, projectId, customerName: h.customerName, customerPhone: h.customerPhone ?? '', customerEmail: h.customerEmail ?? '',
    address1, address2: rest.join('\n'), building: h.building, unitNo: h.unitNo, propertyType: h.propertyType ?? '', layoutLabel: h.layoutLabel ?? '',
    bedrooms: numText(h.bedrooms), bathrooms: numText(h.bathrooms), builtUpSqft: numText(h.builtUpSqft), landAreaSqft: numText(h.landAreaSqft), landSize: h.landSize ?? '',
  };
}

/** The other way, for the quotation's save. */
export function partyFromBlock(v: CustomerPropertyValue): QuoteParty {
  return {
    customerName: v.customerName, customerPhone: v.customerPhone, customerEmail: v.customerEmail, siteAddress: [v.address1, v.address2].filter(Boolean).join('\n'),
    building: v.building, unitNo: v.unitNo, propertyType: v.propertyType, layoutLabel: v.layoutLabel, bedrooms: v.bedrooms, bathrooms: v.bathrooms,
    builtUpSqft: v.builtUpSqft, landAreaSqft: v.landAreaSqft, landSize: v.landSize,
  };
}

/** The sections as sales order lines and rooms. A lump sum is a line of its own, as it becomes on the sales order. */
export function quotationLines(sections: readonly DocSection[]): { rows: QuotationLine[]; rooms: SoPrintRooms } {
  const rows: QuotationLine[] = [];
  const order: string[] = [];
  const byItem: Record<string, string> = {};
  sections.forEach((s, si) => {
    const room = s.heading.trim() || DEFAULT_ROOM;
    if (!order.some((r) => r.toLowerCase() === room.toLowerCase())) order.push(room);
    if (s.lumpSumSen != null) {
      const id = `lump-${si}`;
      rows.push({ id, item_code: 'RENO-ADJUST', description: room, description2: null, uom: 'LOT', qty: 1, unit_price_sen: s.lumpSumSen, discount_sen: 0, total_sen: s.lumpSumSen });
      byItem[id] = room;
    }
    s.lines.forEach((l, li) => {
      const id = l.id ?? `line-${si}-${li}`;
      const gross = l.qty * l.unitPriceSen;
      const total = s.lumpSumSen != null ? 0 : l.netSen ?? gross;
      rows.push({
        id, item_code: l.itemCode ?? '', description: l.description, description2: null, uom: l.uom ?? '', qty: l.qty, unit_price_sen: l.unitPriceSen,
        discount_sen: s.lumpSumSen != null ? 0 : Math.max(0, gross - total), total_sen: total,
      });
      byItem[id] = room;
    });
  });
  return { rows, rooms: { order, byItem } };
}
