// renovation-flow-rules — Conts switches for the supply-chain flow (owner run, 24 Oct 2026).
//
// A live end-to-end run on production (project 99 "TESTING", TC-SO-2610-002) hit five Houzs rules that do not fit
// a renovation business. Each switch below turns one of them off for Conts; setting it the other way gives back
// Houzs's behaviour unchanged, the same pattern as renovation-vo-rule.ts.
//
//   SOFA_MIX_RULE_ON         Houzs: a sofa may not share an order with a bedframe or mattress (main-mix.ts).
//                            A renovation SO furnishes a whole unit, so it mixes them freely.
//   ADDRESS_FIT_ON_SAVE      Houzs: a saved SO address is re-flowed into AutoCount's 40-character lines
//                            (so-address-on-save.ts). Conts has no AutoCount, and the re-flow moved words
//                            between line 1 and line 2 of an address that was typed correctly.
//   CUSTOMER_GOODS_NO_STOCK  Conts: a line whose supplier is CUSTOMER (the client buys it, Conts only manages it)
//                            is not warehouse stock, so a delivery order neither checks nor moves stock for it.
//   PO_VARIANTS_FOLLOW_SO    Conts: a PO line taken from an SO line only needs the product options that SO line
//                            has, never more (Houzs makes the supplier spec complete on every PO).
//   DO_FROM_RENOVATION_SO    Conts: a delivery order raised from a renovation SO takes its venue and building type
//                            from the SO's property (building, unit, property type) and its branding from the
//                            brand of the lines it carries, not from leftovers on the SO header.

import { pgrestIn } from './pgrest-in-list';

export const SOFA_MIX_RULE_ON = false as boolean;
export const ADDRESS_FIT_ON_SAVE = false as boolean;
export const CUSTOMER_GOODS_NO_STOCK = true as boolean;
export const PO_VARIANTS_FOLLOW_SO = true as boolean;
export const DO_FROM_RENOVATION_SO = true as boolean;

/** The supplier code that marks client-supplied goods (supplier CUSTOMER, renovation-po-split.ts). */
export const CUSTOMER_SUPPLIER_CODE = 'CUSTOMER';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the request's PostgREST client, untyped like its siblings
type Sb = any;

/** Customer-supplied, from the SKU's main supplier: supplier CUSTOMER, or no supplier at all on a CUS-* placeholder
    (the same rule as voGoesTo in renovation-po-split.ts). Pure, for tests. */
export function isCustomerGoods(itemCode: string, mainSupplierCode: string | null): boolean {
  if (mainSupplierCode) return mainSupplierCode.toUpperCase() === CUSTOMER_SUPPLIER_CODE;
  return itemCode.trim().toUpperCase().startsWith('CUS-');
}

/** The item codes among `codes` that are customer-supplied. Empty when the switch is off. A failed read answers
    "none", so the Houzs stock check still runs: checking stock that is not there is the safe mistake. */
export async function customerGoodsCodes(sb: Sb, codes: readonly string[], companyId: number | null | undefined): Promise<Set<string>> {
  const out = new Set<string>();
  if (!CUSTOMER_GOODS_NO_STOCK) return out;
  const unique = [...new Set(codes.map((c) => String(c ?? '').trim()).filter(Boolean))];
  if (unique.length === 0) return out;
  try {
    let q = pgrestIn(sb.from('supplier_material_bindings').select('item_code, supplier_id, is_main_supplier'), 'item_code', unique);
    if (companyId != null) q = q.eq('company_id', companyId);
    const { data: bindings, error } = await q;
    if (error) throw new Error(String(error.message ?? error));
    const rows = (bindings ?? []) as Array<{ item_code: string; supplier_id: string | null; is_main_supplier: boolean | null }>;
    const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter((v): v is string => !!v))];
    const codeById = new Map<string, string>();
    if (supplierIds.length > 0) {
      const { data: sups, error: supErr } = await pgrestIn(sb.from('suppliers').select('id, code'), 'id', supplierIds);
      if (supErr) throw new Error(String(supErr.message ?? supErr));
      for (const s of (sups ?? []) as Array<{ id: string; code: string | null }>) codeById.set(s.id, String(s.code ?? ''));
    }
    const mainByCode = new Map<string, string | null>();
    for (const r of rows) {
      const sup = r.supplier_id ? codeById.get(r.supplier_id) ?? null : null;
      if (r.is_main_supplier || !mainByCode.has(r.item_code)) mainByCode.set(r.item_code, sup);
    }
    for (const code of unique) if (isCustomerGoods(code, mainByCode.get(code) ?? null)) out.add(code);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[renovation-flow-rules] customer-goods read failed, stock is checked as usual:', e);
  }
  return out;
}

/** A PO line's missing option labels, cut down to the options its SO line has (Conts). `soVariants` undefined means
    the line was not taken from an SO line: the Houzs rule stands. */
export function poMissingAxesForSoLine(
  missing: ReadonlyArray<{ key: string; label: string }>,
  soVariants: Record<string, unknown> | null | undefined,
): Array<{ key: string; label: string }> {
  if (!PO_VARIANTS_FOLLOW_SO || soVariants === undefined) return [...missing];
  const has = (k: string) => {
    const v = (soVariants ?? {})[k];
    return v !== undefined && v !== null && String(v).trim() !== '';
  };
  return missing.filter((a) => has(a.key));
}

/** Building type for a delivery, from the renovation property type: a condo or apartment is high-rise with a lift,
    a house is landed. Null when the type says neither, so nothing is guessed. */
export function buildingTypeFromProperty(propertyType: string | null | undefined): string | null {
  const t = String(propertyType ?? '').trim().toLowerCase();
  if (!t) return null;
  if (/(condo|apartment|serviced|residence|flat|soho|studio|high[- ]?rise|penthouse|duplex)/.test(t)) return 'High-rise (lift)';
  if (/(landed|terrace|bungalow|semi[- ]?d|cluster|link|townhouse|house|villa|shop)/.test(t)) return 'Landed';
  return null;
}

/** The site a renovation delivery goes to: building and unit ("TESTING T-01-01"). Null when the SO has neither. */
export function renovationVenue(building: string | null | undefined, unitNo: string | null | undefined): string | null {
  const v = [String(building ?? '').trim(), String(unitNo ?? '').trim()].filter(Boolean).join(' ');
  return v || null;
}

/** True when an SO header carries the renovation property block (mig 0112), i.e. it is a Conts project sale. */
export function isRenovationSoHeader(head: Record<string, unknown>): boolean {
  return [head.project_id, head.building, head.unit_no, head.property_type].some((v) => v != null && String(v).trim() !== '');
}

/** Conts: venue and building type of a DO raised from a renovation SO come from the SO's property, never from the
    header's free-text leftovers. Returns only the fields it decides; a field it cannot decide is left as it was. */
export function renovationDoSiteFields(head: Record<string, unknown>): { venue?: string; buildingType?: string } {
  if (!DO_FROM_RENOVATION_SO || !isRenovationSoHeader(head)) return {};
  const venue = renovationVenue(head.building as string | null, head.unit_no as string | null);
  const buildingType = buildingTypeFromProperty(head.property_type as string | null);
  return { ...(venue ? { venue } : {}), ...(buildingType ? { buildingType } : {}) };
}

/** The brand a delivery carries, from its own lines (Conts): the distinct line brands in line order, joined. Null
    when no line has one. Pure. */
export function brandingFromLineBrands(brands: ReadonlyArray<string | null | undefined>): string | null {
  const seen: string[] = [];
  for (const b of brands) {
    const v = String(b ?? '').trim();
    if (v && !seen.some((s) => s.toUpperCase() === v.toUpperCase())) seen.push(v);
  }
  return seen.length ? seen.join(' / ') : null;
}

/** Conts: the DO's branding from the brand of the lines it carries (the SO line's own branding, else the SKU's).
    Undefined when the switch is off or the brands cannot be read, so the caller keeps what it had. */
export async function doBrandingFromLines(
  sb: Sb,
  lines: ReadonlyArray<{ itemCode: string; soItemId: string | null }>,
  companyId: number | null | undefined,
): Promise<string | null | undefined> {
  if (!DO_FROM_RENOVATION_SO || lines.length === 0) return undefined;
  try {
    const soIds = [...new Set(lines.map((l) => l.soItemId).filter((v): v is string => !!v))];
    const soBrand = new Map<string, string | null>();
    if (soIds.length > 0) {
      const { data, error } = await pgrestIn(sb.from('mfg_sales_order_items').select('id, branding'), 'id', soIds);
      if (error) return undefined;
      for (const r of (data ?? []) as Array<{ id: string; branding: string | null }>) soBrand.set(r.id, r.branding);
    }
    const codes = [...new Set(lines.map((l) => l.itemCode.trim()).filter(Boolean))];
    const skuBrand = new Map<string, string | null>();
    if (codes.length > 0) {
      let q = pgrestIn(sb.from('mfg_products').select('code, branding'), 'code', codes);
      if (companyId != null) q = q.eq('company_id', companyId);
      const { data, error } = await q;
      if (error) return undefined;
      for (const r of (data ?? []) as Array<{ code: string; branding: string | null }>) skuBrand.set(r.code, r.branding);
    }
    return brandingFromLineBrands(lines.map((l) => {
      const own = l.soItemId ? soBrand.get(l.soItemId) : null;
      return own && own.trim() ? own : skuBrand.get(l.itemCode.trim()) ?? null;
    }));
  } catch {
    return undefined;
  }
}

/** The line remark a create sends: the POS keeps it in variants.remark, the desktop SO form sends it as the line's
    own `remark`. Either counts; before this only the first did, so remarks typed on the New SO form were lost. */
export function soLineRemarkOf(it: { remark?: unknown; variants?: unknown }): string | null {
  const fromVariants = (it.variants as { remark?: unknown } | null | undefined)?.remark;
  for (const r of [fromVariants, it.remark]) {
    if (typeof r === 'string' && r.trim() !== '') return r.trim();
  }
  return null;
}

/** The delivered_at stamp for an office "Mark delivered" (Conts has no driver app). `deliveredOn` is the day the goods
    arrived (YYYY-MM-DD, Malaysia time): stamped at noon that day so it reads as that day everywhere; today keeps the
    exact moment. Absent means "now" (null). A malformed or future day is 'invalid'. */
export function deliveredOnTimestamp(deliveredOn: unknown, nowIso: string): string | null | 'invalid' {
  if (deliveredOn === undefined || deliveredOn === null || deliveredOn === '') return null;
  if (typeof deliveredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deliveredOn)) return 'invalid';
  const stamp = new Date(`${deliveredOn}T12:00:00+08:00`);
  if (Number.isNaN(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== deliveredOn) return 'invalid';
  const todayMyt = new Date(new Date(nowIso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  if (deliveredOn > todayMyt) return 'invalid';
  if (deliveredOn === todayMyt) return null;
  return stamp.toISOString();
}
