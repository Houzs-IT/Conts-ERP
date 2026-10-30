// ----------------------------------------------------------------------------
// A renovation contract's revenue lines, for the waterfall (spec 2.3 and 4; plan 2026-10-30-renovation-revenue-ledger.md
// Task 5).
//
// The contract's live SO rows (not cancelled), keyed by SO item id. Each line's category group and sub-category come
// from its product (item_code → scm.mfg_products, the ACTIVE row first): the SO rows themselves always say
// item_group 'RENOVATION'. Three system rows are not work and never stand as SERVICE lines:
//   • RENO-ADJUST (the price of a lump-sum section, whose lines carry 0) is spread over the lines inside its section in
//     proportion to their nominal amounts (qty × unit price, or the measured amount), equally by count when all are 0;
//   • RENO-DISCOUNT (the header discount, negative) lowers every line in proportion to its amount;
//   • RENO-PROGRESS and RENO-CREDIT are billing rows and are left out.
// Spreads are largest remainder, so the lines always sum to exactly the contract.
// ----------------------------------------------------------------------------

import type { RevenueLine } from '../../acc/reno-waterfall';
import { paginateAll } from './paginate-all';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Sb = any;

export type ContractRevenueLine = RevenueLine & { itemCode: string };

const BILLING_ROWS = new Set(['RENO-PROGRESS', 'RENO-CREDIT']);

/** `total` shared over `weights` in proportion, floors first then one sen each to the largest remainders (ties: the
    earlier). All weights 0 → equally by count. A negative total is shared as its size, then negated. */
export function spreadByWeight(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sign = total < 0 ? -1n : 1n;
  const t = BigInt(Math.abs(total));
  let w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  let sum = w.reduce((s, x) => s + x, 0n);
  if (sum === 0n) {
    w = weights.map(() => 1n);
    sum = BigInt(weights.length);
  }
  const parts = w.map((x, i) => ({ i, floor: (t * x) / sum, rem: (t * x) % sum }));
  let left = t - parts.reduce((s, p) => s + p.floor, 0n);
  for (const p of [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))) {
    if (left <= 0n) break;
    p.floor += 1n;
    left -= 1n;
  }
  return parts.map((p) => Number(p.floor * sign));
}

type SoRow = { id: string; item_code: string | null; total_sen: number | null; cancelled: boolean | null; line_no: number | null };
type DocLineRow = { section_id: string; so_item_id: string | null; qty: number | null; measure: string | number | null; unit_price_sen: number | null; amount_override_sen: number | null; is_foc: boolean | null };

const errText = (e: unknown): string => (e as { message?: string })?.message ?? String(e);

function nominalSen(l: DocLineRow): number {
  if (l.is_foc) return 0;
  if (l.amount_override_sen != null) return Number(l.amount_override_sen);
  const price = Number(l.unit_price_sen ?? 0);
  if (l.measure != null && l.measure !== '') return Math.round(Number(l.measure) * price);
  return Number(l.qty ?? 0) * price;
}

/** The contract's revenue lines (see the header). Throws when a read does not answer. */
export async function contractRevenueLines(sb: Sb, soDocNo: string, companyId?: number): Promise<ContractRevenueLine[]> {
  const { data: soData, error: soErr } = await paginateAll((from, to) => {
    let q = sb.from('mfg_sales_order_items').select('id, item_code, total_sen, cancelled, line_no').eq('doc_no', soDocNo);
    if (companyId != null) q = q.eq('company_id', companyId);
    return q.order('id').range(from, to);
  });
  if (soErr) throw new Error(`The lines of ${soDocNo} could not be read: ${errText(soErr)}`);
  const rows = ((soData ?? []) as SoRow[])
    .filter((r) => r.cancelled !== true && !BILLING_ROWS.has(String(r.item_code ?? '')))
    .sort((a, b) => Number(a.line_no ?? 0) - Number(b.line_no ?? 0));

  const work = rows.filter((r) => r.item_code !== 'RENO-ADJUST' && r.item_code !== 'RENO-DISCOUNT');
  const adjusts = rows.filter((r) => r.item_code === 'RENO-ADJUST');
  const discounts = rows.filter((r) => r.item_code === 'RENO-DISCOUNT');

  /* Products: the group and sub-category of every work line. */
  const codes = [...new Set(work.map((r) => String(r.item_code ?? '')).filter(Boolean))];
  const product = new Map<string, { group: string; sub: string | null }>();
  if (codes.length > 0) {
    let q = sb.from('mfg_products').select('code, category_group, sub_category, status').in('code', codes);
    if (companyId != null) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw new Error(`The products of ${soDocNo} could not be read: ${errText(error)}`);
    const sorted = ((data ?? []) as Array<{ code: string; category_group: string | null; sub_category: string | null; status: string | null }>)
      .sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'));
    for (const p of sorted) {
      if (!product.has(p.code)) product.set(p.code, { group: String(p.category_group ?? '').trim().toUpperCase(), sub: p.sub_category ? String(p.sub_category).trim().toUpperCase() : null });
    }
  }

  const amount = new Map<string, number>(work.map((r) => [r.id, Number(r.total_sen ?? 0)]));

  /* Lump sums: spread over the live lines of the section whose so_item_id is the RENO-ADJUST row. */
  if (adjusts.length > 0) {
    const { data: secs, error: sErr } = await sb.from('reno_doc_sections').select('id, so_item_id').eq('so_doc_no', soDocNo).in('so_item_id', adjusts.map((a) => a.id));
    if (sErr) throw new Error(`The sections of ${soDocNo} could not be read: ${errText(sErr)}`);
    const sectionOf = new Map(((secs ?? []) as Array<{ id: string; so_item_id: string }>).map((s) => [s.so_item_id, s.id]));
    const sectionIds = [...sectionOf.values()];
    let docLines: DocLineRow[] = [];
    if (sectionIds.length > 0) {
      const { data: dl, error: dErr } = await sb.from('reno_doc_lines')
        .select('section_id, so_item_id, qty, measure, unit_price_sen, amount_override_sen, is_foc').in('section_id', sectionIds);
      if (dErr) throw new Error(`The lines of ${soDocNo}'s lump sums could not be read: ${errText(dErr)}`);
      docLines = (dl ?? []) as DocLineRow[];
    }
    for (const a of adjusts) {
      const inside = docLines.filter((l) => l.section_id === sectionOf.get(a.id) && l.so_item_id && amount.has(l.so_item_id));
      if (inside.length === 0) {
        throw new Error(`The lump sum "${a.id}" on ${soDocNo} has no lines inside it to carry its revenue.`);
      }
      const shares = spreadByWeight(Number(a.total_sen ?? 0), inside.map(nominalSen));
      inside.forEach((l, i) => amount.set(l.so_item_id!, (amount.get(l.so_item_id!) ?? 0) + shares[i]));
    }
  }

  /* The header discount: every line in proportion to its amount. */
  for (const d of discounts) {
    const keys = [...amount.keys()];
    const shares = spreadByWeight(Number(d.total_sen ?? 0), keys.map((k) => amount.get(k) ?? 0));
    keys.forEach((k, i) => amount.set(k, (amount.get(k) ?? 0) + shares[i]));
  }

  return work.map((r) => {
    const p = product.get(String(r.item_code ?? ''));
    return { key: r.id, itemCode: String(r.item_code ?? ''), group: p?.group ?? '', subCategory: p?.sub ?? null, amountSen: amount.get(r.id) ?? 0 };
  });
}
