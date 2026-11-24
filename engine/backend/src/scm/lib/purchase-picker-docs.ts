// ----------------------------------------------------------------------------
// The candidate documents for the two paged purchase pickers (lib/doc-batch-page.ts):
//   - GRN from PO: purchase orders that can still be received (RECEIVABLE_PO_STATUSES, not on hold);
//   - PI from GRN: posted goods receipts with something left to bill (scm.v_grn_outstanding).
// Both read the document number only, newest first, below the cursor, company-scoped by the caller's predicate.
// ----------------------------------------------------------------------------

import { escapeForOr } from './postgrest-search';
import { RECEIVABLE_PO_STATUSES } from './source-document-gates';
import { poDeadForReceiptSql } from './outstanding-po-lines';
import { docSearchOr, distinctCapped, LINE_MATCH_DOCS, SUPPLIER_MATCH_MAX, type DocBatch } from './doc-batch-page';

/* eslint-disable @typescript-eslint/no-explicit-any -- the SCM routes carry an untyped supabase-js client */

type Scope = <Q>(q: Q) => Q;

/** What a search matched outside the number column: supplier ids and the documents whose lines match. */
export interface SearchMatches { supplierIds: string[]; docIds: string[]; error: string | null }

async function supplierMatches(sb: any, scope: Scope, s: string): Promise<{ ids: string[]; error: string | null }> {
  const { data, error } = await scope(sb.from('suppliers').select('id'))
    .or(`name.ilike.%${s}%,code.ilike.%${s}%`).order('id').limit(SUPPLIER_MATCH_MAX);
  if (error) return { ids: [], error: error.message };
  return { ids: ((data ?? []) as Array<{ id: string }>).map((r) => r.id), error: null };
}

/** Supplier and line matches for a PO search. Lines on draft or cancelled orders are not read
    (the embedded-status form outstanding-po-lines.ts already runs). */
export async function poSearchMatches(sb: any, scope: Scope, q: string): Promise<SearchMatches> {
  const s = escapeForOr(q);
  if (!s) return { supplierIds: [], docIds: [], error: null };
  const [sup, lines] = await Promise.all([
    supplierMatches(sb, scope, s),
    scope(sb.from('purchase_order_items').select('purchase_order_id, po:purchase_orders!inner(status)'))
      .not('po.status', 'in', poDeadForReceiptSql())
      .or(`item_code.ilike.%${s}%,description.ilike.%${s}%,material_name.ilike.%${s}%,supplier_sku.ilike.%${s}%`)
      .order('purchase_order_id', { ascending: false }).limit(LINE_MATCH_DOCS * 5),
  ]);
  if (sup.error) return { supplierIds: [], docIds: [], error: sup.error };
  if (lines.error) return { supplierIds: [], docIds: [], error: lines.error.message };
  const docIds = distinctCapped(((lines.data ?? []) as Array<{ purchase_order_id: string }>).map((r) => r.purchase_order_id), LINE_MATCH_DOCS);
  return { supplierIds: sup.ids, docIds, error: null };
}

/** Supplier and line matches for a GRN search. */
export async function grnSearchMatches(sb: any, scope: Scope, q: string): Promise<SearchMatches> {
  const s = escapeForOr(q);
  if (!s) return { supplierIds: [], docIds: [], error: null };
  const [sup, lines] = await Promise.all([
    supplierMatches(sb, scope, s),
    scope(sb.from('grn_items').select('grn_id'))
      .or(`item_code.ilike.%${s}%,description.ilike.%${s}%,material_name.ilike.%${s}%`)
      .order('grn_id', { ascending: false }).limit(LINE_MATCH_DOCS * 5),
  ]);
  if (sup.error) return { supplierIds: [], docIds: [], error: sup.error };
  if (lines.error) return { supplierIds: [], docIds: [], error: lines.error.message };
  const docIds = distinctCapped(((lines.data ?? []) as Array<{ grn_id: string }>).map((r) => r.grn_id), LINE_MATCH_DOCS);
  return { supplierIds: sup.ids, docIds, error: null };
}

/** A batch reader plus the number to id map the line loader needs. */
export function makeDocBatchReader(args: {
  base: () => any;
  numberCol: string;
  q: string;
  matches: SearchMatches | null;
}): { read: (after: string | null, n: number) => Promise<DocBatch>; idOf: Map<string, string> } {
  const idOf = new Map<string, string>();
  const read = async (after: string | null, n: number): Promise<DocBatch> => {
    let q = args.base();
    if (args.q) {
      const or = docSearchOr(args.numberCol, args.q, args.matches?.supplierIds ?? [], args.matches?.docIds ?? []);
      if (!or) return { docs: [], more: false, error: null };
      q = q.or(or);
    }
    if (after) q = q.lt(args.numberCol, after);
    const { data, error } = await q.order(args.numberCol, { ascending: false }).limit(n);
    if (error) return { docs: [], more: false, error: error.message };
    const rows = (data ?? []) as Array<Record<string, string | null>>;
    const docs: string[] = [];
    for (const r of rows) {
      const num = r[args.numberCol];
      if (!num || !r.id) continue;
      idOf.set(num, r.id);
      docs.push(num);
    }
    return { docs, more: rows.length >= n, error: null };
  };
  return { read, idOf };
}

/** Purchase orders that can still be received, optionally one supplier's. A held order is left to the line loader's
    isReceivablePo, which answers it with no lines. */
export function receivablePoBase(sb: any, scope: Scope, supplierId: string | null): () => any {
  return () => {
    let q = scope(sb.from('purchase_orders').select('id, po_number'))
      .in('status', [...RECEIVABLE_PO_STATUSES]);
    if (supplierId) q = q.eq('supplier_id', supplierId);
    return q;
  };
}

/** Posted goods receipts with something left to bill. */
export function billableGrnBase(sb: any, scope: Scope): () => any {
  return () => scope(sb.from('v_grn_outstanding').select('id, grn_number'))
    .eq('status', 'POSTED').eq('is_outstanding', true);
}
