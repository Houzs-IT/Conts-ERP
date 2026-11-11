// ----------------------------------------------------------------------------
// supplier-price-refresh — bring a supplier's price list up to what we actually
// paid, so the next purchase order copies a current number (TODO port item 11,
// after Hookka 5957bdd87 + 6801df6fb, reimplemented for Conts).
//
// The source is the most recent purchase invoice line for that supplier and
// item: the document a person accepted (POSTED, partly paid, paid or on hold).
// Not a draft, not a cancelled invoice, not the PO (what we asked for), not an
// average. The new price takes effect from that invoice's own date.
//
// Refused, each with its reason so a person can check it:
//   · two different prices on the same latest invoice date
//   · a jump of more than 3x either way, or a different unit on the invoice
//     than on the SKU: almost always a box vs piece mix-up, not a price change
//   · a list already dated after the last invoice (somebody's newer decision)
//   · an invoice in another currency than the price list
//   · a binding priced by size / tier (an invoice line cannot say which cell)
//   · a unit missing on the invoice line or the SKU, or a list with no price
//     yet: the box vs piece check cannot run, so a person looks first
// The paid price is NET of the line's discount: (qty x unit - discount) / qty.
// "The list is newer" reads both the binding's own date and the newest
// effective-dated price change (supplier_binding_price_history).
// A zero-priced line is never a price; an item never invoiced is left alone.
//
// Pure: the preview and the apply run this same function on fresh reads.
// ----------------------------------------------------------------------------

import { fmtSen } from '../shared/format';

/** A move bigger than this either way is treated as a unit mix-up. */
export const OUTLIER_MULTIPLE = 3;

export type PaidLine = {
  itemCode: string;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  unitPriceSen: number;
  uom: string | null;
  currency: string | null;
};

export type BindingForRefresh = {
  id: string;
  item_code: string;
  material_name: string | null;
  unit_price_sen: number | null;
  price_matrix: unknown;
  price_valid_from: string | null;
  currency: string | null;
  /** Newest effective_from in supplier_binding_price_history for this supplier + item. */
  history_from?: string | null;
};

/** What one unit actually cost on an invoice line: unit price less the line's
 *  discount spread over its quantity, rounded to the sen. */
export function netUnitSen(qty: number | null | undefined, unitSen: number, discountSen: number | null | undefined): number {
  const q = Number(qty);
  const d = Number(discountSen) || 0;
  if (!(d > 0) || !Number.isFinite(q) || q <= 0) return unitSen;
  return Math.round((q * unitSen - d) / q);
}

export type RefreshReason = 'current' | 'two_prices' | 'unit_mismatch' | 'list_newer' | 'currency' | 'size_priced' | 'no_list_price';

export type PriceDrift = {
  bindingId: string;
  itemCode: string;
  materialName: string | null;
  listSen: number;
  listFrom: string | null;
  paidSen: number | null;
  paidOn: string;
  invoiceNumber: string | null;
  deltaSen: number;
  eligible: boolean;
  reason?: RefreshReason;
  whyNot?: string;
};

/* Money in a refusal reads the AutoCount way, "RM 1,800.00" (tests/moneyTextShape.test.ts). */
const rm = (sen: number) => fmtSen(sen);
const day = (d: string | null | undefined) => String(d ?? '').slice(0, 10);
const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase();

type Latest = { date: string; prices: Set<number>; invoiceNumber: string | null; uoms: Set<string>; currencies: Set<string> };

/** Per item code, the lines on the latest invoice date only. */
export function latestPaidByItem(lines: readonly PaidLine[]): Map<string, Latest> {
  const out = new Map<string, Latest>();
  for (const l of lines) {
    const code = l.itemCode.trim();
    const date = day(l.invoiceDate);
    const price = Number(l.unitPriceSen);
    if (!code || !date || !Number.isFinite(price) || price <= 0) continue;
    const cur = out.get(code);
    if (!cur || date > cur.date) {
      out.set(code, { date, prices: new Set([price]), invoiceNumber: l.invoiceNumber, uoms: new Set(), currencies: new Set() });
    } else if (date === cur.date) {
      cur.prices.add(price);
    } else continue;
    const hit = out.get(code)!;
    if (norm(l.uom)) hit.uoms.add(norm(l.uom));
    hit.currencies.add(norm(l.currency) || 'MYR');
  }
  return out;
}

const hasMatrix = (m: unknown) => m != null && typeof m === 'object' && Object.keys(m as object).length > 0;

export function planPriceRefresh(
  bindings: readonly BindingForRefresh[],
  lines: readonly PaidLine[],
  skuUomByCode: ReadonlyMap<string, string | null> = new Map(),
): PriceDrift[] {
  const latest = latestPaidByItem(lines);
  const out: PriceDrift[] = [];
  for (const b of bindings) {
    const hit = latest.get(b.item_code.trim());
    if (!hit) continue; // never invoiced: no evidence is not a price
    const listSen = Number(b.unit_price_sen) || 0;
    /* The later of the binding's own date and its newest scheduled / recorded price change. */
    const listFrom = [day(b.price_valid_from), day(b.history_from)].filter(Boolean).sort().at(-1) || null;
    const base = {
      bindingId: b.id, itemCode: b.item_code, materialName: b.material_name,
      listSen, listFrom, paidOn: hit.date, invoiceNumber: hit.invoiceNumber,
    };
    const refuse = (reason: RefreshReason, whyNot: string, paidSen: number | null) =>
      out.push({ ...base, paidSen, deltaSen: paidSen == null ? 0 : paidSen - listSen, eligible: false, reason, whyNot });

    if (hasMatrix(b.price_matrix)) {
      refuse('size_priced', 'priced by size / tier: an invoice line cannot say which price to change', null);
      continue;
    }
    if (hit.prices.size > 1) {
      refuse('two_prices', `two prices on the same invoice date (${[...hit.prices].map(rm).join(', ')}): cannot tell which is current`, null);
      continue;
    }
    const paidSen = [...hit.prices][0]!;
    const listCurrency = norm(b.currency) || 'MYR';
    if (hit.currencies.size > 1 || !hit.currencies.has(listCurrency)) {
      refuse('currency', `invoiced in ${[...hit.currencies].join(' / ')}, the price list is in ${listCurrency}`, paidSen);
      continue;
    }
    const skuUom = norm(skuUomByCode.get(b.item_code) ?? null);
    if (!skuUom || hit.uoms.size === 0) {
      refuse('unit_mismatch', `no unit on the ${!skuUom ? 'SKU' : 'invoice line'}, so a box vs piece mix-up cannot be ruled out: check the invoice against the list's unit`, paidSen);
      continue;
    }
    const otherUom = [...hit.uoms].find((u) => u !== skuUom);
    if (otherUom) {
      refuse('unit_mismatch', `invoiced per ${otherUom}, the SKU is sold per ${skuUom}: check the invoice against the list's unit`, paidSen);
      continue;
    }
    if (paidSen === listSen) {
      refuse('current', 'already current', paidSen);
      continue;
    }
    if (listSen <= 0) {
      refuse('no_list_price', `the price list has no price yet, so a ${rm(paidSen)} invoice price cannot be checked for a unit mix-up: enter it by hand`, paidSen);
      continue;
    }
    const ratio = paidSen / listSen;
    if ((ratio > OUTLIER_MULTIPLE || ratio < 1 / OUTLIER_MULTIPLE)) {
      refuse('unit_mismatch',
        `price moved ${ratio.toFixed(1)}x (${rm(listSen)} → ${rm(paidSen)}): almost always a per-box vs per-piece mix-up, not a price change. Check the invoice against the list's unit.`,
        paidSen);
      continue;
    }
    if (listFrom && hit.date < listFrom) {
      refuse('list_newer', `the list is dated ${listFrom}, after the last invoice (${hit.date}): leaving the newer price alone`, paidSen);
      continue;
    }
    out.push({ ...base, paidSen, deltaSen: paidSen - listSen, eligible: true });
  }
  return out;
}
