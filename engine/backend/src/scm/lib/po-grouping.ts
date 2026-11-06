// ----------------------------------------------------------------------------
// po-grouping.ts — how selected SO lines become POs, from the one global toggle
// on the MRP page and the From-SO picker.
//
// Owner, 4 Nov 2026: "上了 MRP 之后，by right 要支持 combine PO，或者按 per SO 来开".
//
//   COMBINED  one PO per supplier: lines of several SOs to one supplier merge.
//   PER-SO    one PO per SO for that supplier.
//
// This replaces Houzs's per-category rule (sofa, bedframe and mattress each
// answering the toggle differently): under it a Conts buyer pressing Combined
// got one PO per SO for every bedframe and one per delivery week for every
// mattress, and pressing Per SO split one SO into a PO per category.
//
// Every key starts (warehouse, supplier). The warehouse is load-bearing: it
// keeps each PO single-warehouse, which the GRN relies on to land stock where
// the SO line asked for it. The supplier is the physical "one PO = one supplier"
// constraint, so Per SO still gives an SO with two suppliers two POs.
//
// Two rules the toggle cannot override. A renovation PO holds one category
// (mig 0116's trigger refuses the lines otherwise), and Works and Built-in are
// made for one unit, so their PO belongs to one SO even in Combined (owner, 6
// Nov 2026): two customers on one in-house PO jam production Complete.
// ----------------------------------------------------------------------------

import { chunkIn } from './paginate-all';
import { pgrestInList } from './pgrest-in-list';
import { isUnitBoundCategory } from './unit-bound-sku';

/** The caller's global toggle. */
export type PoMode = 'combined' | 'per-so';

export interface GroupKeyInput {
  warehouseId: string | null;
  supplierId: string;
  soDocNo: string;
  /* Set only on a line of a project's SO. */
  categoryGroup?: string | null;
  unitBound?: boolean;
}

/** The bucket key for one line. Same key = same PO (within one convert batch). */
export function groupKeyFor(input: GroupKeyInput, toggle: PoMode): string {
  const supplier = `${input.warehouseId ?? 'null'}::${input.supplierId}`;
  const base = input.categoryGroup ? `${supplier}::cat:${input.categoryGroup}` : supplier;
  return toggle === 'per-so' || input.unitBound ? `${base}::so:${input.soDocNo}` : base;
}

export interface PoGroupFacts {
  categoryGroupOf: (itemCode: string, soDocNo: string) => string | null;
  unitBound: (itemCode: string) => boolean;
}

/** What the grouping must know beyond the toggle. Throws on a failed read: a guess would either mix a PO the database
    then refuses, or put two customers on one in-house PO. */
export async function loadPoGroupFacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the scm PostgREST client is untyped
  sb: any,
  companyId: number | null,
  codes: readonly string[],
  docNos: readonly string[],
): Promise<PoGroupFacts> {
  const wanted = [...new Set(codes.filter(Boolean))];
  const productQ = (batch: string[], from: number, to: number) => {
    const q = sb.from('mfg_products').select('code, category, category_group').filter('code', 'in', pgrestInList(batch));
    return (companyId == null ? q : q.eq('company_id', companyId)).order('id').range(from, to);
  };
  const { data: products, error } = await chunkIn<{ code: string; category: string | null; category_group: string | null }>(wanted, productQ);
  if (error) throw new Error(`po_group_facts_failed: ${error.message}`);
  const { data: orders, error: soErr } = await chunkIn<{ doc_no: string; project_id: number | null }>([...new Set(docNos.filter(Boolean))], (batch, from, to) =>
    sb.from('mfg_sales_orders').select('doc_no, project_id').in('doc_no', batch).order('doc_no').range(from, to));
  if (soErr) throw new Error(`po_group_facts_failed: ${soErr.message}`);
  const group = new Map((products ?? []).map((p) => [p.code, p.category_group]));
  const bound = new Set((products ?? []).filter((p) => isUnitBoundCategory(p.category) || isUnitBoundCategory(p.category_group)).map((p) => p.code));
  const projectDocs = new Set((orders ?? []).filter((o) => o.project_id != null).map((o) => o.doc_no));
  return {
    categoryGroupOf: (itemCode, soDocNo) => (projectDocs.has(soDocNo) ? group.get(itemCode) ?? null : null),
    unitBound: (itemCode) => bound.has(itemCode),
  };
}
