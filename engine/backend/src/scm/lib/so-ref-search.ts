// ---------------------------------------------------------------------------
// Find documents by their Sales Order's reference number (owner 2026-09-25:
// "整个系统的search button都能搜到SO的ref number").
//
// The SO's reference lives on the SO (`ref`, with `customer_so_no` as the
// fallback — frontend/src/lib/customer-ref.ts). DOs and SIs carry a COPY of
// `ref`, but the copy is unreliable: on 2026-09-25, 205 / 474 DOs and 79 / 205
// SIs had an empty copy while their SO had a ref, and a merged document's copy
// reads "Merged from ...". POs carry no ref at all (the link is per line). So a
// list searches the SO first and matches its own rows by the SO link instead of
// trusting the copy.
//
// The match is capped: a term that hits more SOs than the cap is too generic to
// be a reference number, and every id rides in the request URL (PostgREST
// `.in`), which has a budget (paginate-all.ts URL_QUERY_BUDGET).
// ---------------------------------------------------------------------------
import type { Variables } from '../env';
import { scopeToCompany, type CompanyScopeCtx } from './companyScope';
import { chunkIn } from './paginate-all';
import { escapeForOr } from './postgrest-search';

type Sb = Variables['supabase'];

export const SO_REF_MATCH_CAP = 50;

/** SO doc numbers in the caller's company whose `ref` or `customer_so_no`
 *  contains the term. Empty when the term is blank or nothing matches. */
export async function soDocNosByRef(sb: Sb, c: CompanyScopeCtx, term: string | null): Promise<string[]> {
  const s = escapeForOr(term ?? '');
  if (!s) return [];
  const { data, error } = await scopeToCompany(
    sb
      .from('mfg_sales_orders')
      .select('doc_no')
      .or(`ref.ilike.%${s}%,customer_so_no.ilike.%${s}%`),
    c,
  ).limit(SO_REF_MATCH_CAP);
  if (error) throw new Error(`SO reference lookup failed: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as Array<{ doc_no: string | null }>;
  return [...new Set(rows.map((r) => r.doc_no).filter((d): d is string => !!d))];
}

/** SO doc numbers in the caller's company whose project (public.projects) name or code contains the term (owner,
 *  24 Nov 2026: every list finds a document by the project it belongs to). Capped like the reference match. */
export async function soDocNosByProject(sb: Sb, c: CompanyScopeCtx, term: string | null): Promise<string[]> {
  const s = escapeForOr(term ?? '');
  if (s.length < 2) return [];
  const projects = await sb.schema('public').from('projects').select('id')
    .or(`name.ilike.%${s}%,code.ilike.%${s}%`).limit(SO_REF_MATCH_CAP);
  if (projects.error) throw new Error(`Project lookup failed: ${projects.error.message}`);
  const projectIds = (projects.data as Array<{ id: number }>).map((project) => project.id);
  if (projectIds.length === 0) return [];
  const { data, error } = await scopeToCompany(
    sb.from('mfg_sales_orders').select('doc_no').in('project_id', projectIds),
    c,
  ).limit(SO_REF_MATCH_CAP);
  if (error) throw new Error(`Project order lookup failed: ${error.message}`);
  const orders = (Array.isArray(data) ? data : []) as Array<{ doc_no: string | null }>;
  return [...new Set(orders.map((order) => order.doc_no).filter((docNo): docNo is string => !!docNo))];
}

/** The SOs a document list admits through its SO link: by the SO's reference, or by its project's name or code. */
export async function soDocNosByRefOrProject(sb: Sb, c: CompanyScopeCtx, term: string | null): Promise<string[]> {
  const [byRef, byProject] = await Promise.all([soDocNosByRef(sb, c, term), soDocNosByProject(sb, c, term)]);
  return [...new Set([...byRef, ...byProject])];
}

/** Delivery order ids in the caller's company raised from these SOs, for a return list's SO-linked match. */
export async function deliveryOrderIdsForSoDocNos(sb: Sb, c: CompanyScopeCtx, docNos: readonly string[]): Promise<string[]> {
  if (docNos.length === 0) return [];
  const { data, error } = await scopeToCompany(sb.from('delivery_orders').select('id').in('so_doc_no', [...docNos]), c)
    .limit(SO_REF_MATCH_CAP * 4);
  if (error) throw new Error(`Delivery order lookup failed: ${error.message}`);
  return (data as Array<{ id: string | null }>).map((row) => row.id).filter((id): id is string => !!id);
}

/** "<code> <name>" of each SO's project, keyed by SO doc number, for lists that search the rows they hold. SOs with
 *  no project are left out. */
export async function projectTextBySoDocNo(sb: Sb, c: CompanyScopeCtx, docNos: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(docNos.filter(Boolean))];
  if (wanted.length === 0) return out;
  const orders = await chunkIn<{ doc_no: string; project_id: number | null }>(wanted, (batch, from, to) =>
    scopeToCompany(sb.from('mfg_sales_orders').select('doc_no, project_id').in('doc_no', batch), c).range(from, to),
  );
  if (orders.error) throw new Error(`SO project lookup failed: ${orders.error.message}`);
  const projectIds = [...new Set(orders.data.map((order) => order.project_id).filter((id) => id != null).map(String))];
  if (projectIds.length === 0) return out;
  const projects = await chunkIn<{ id: number; code: string | null; name: string | null }>(projectIds, (batch, from, to) =>
    sb.schema('public').from('projects').select('id, code, name').in('id', batch).range(from, to),
  );
  if (projects.error) throw new Error(`Project lookup failed: ${projects.error.message}`);
  const textById = new Map(projects.data.map((project) => [String(project.id), [project.code, project.name].filter(Boolean).join(' ')]));
  for (const order of orders.data) {
    const text = order.project_id != null ? textById.get(String(order.project_id)) : undefined;
    if (text) out.set(order.doc_no, text);
  }
  return out;
}

/** PO ids with a line bought for one of these SOs — the line's own SO link
 *  (purchase_order_items.so_item_id) or a split allocation of it
 *  (purchase_order_item_allocations, mig 0235). */
export async function poIdsForSoDocNos(sb: Sb, docNos: readonly string[]): Promise<string[]> {
  if (docNos.length === 0) return [];
  const soItems = await chunkIn<{ id: string }>(docNos, (batch, from, to) =>
    sb.from('mfg_sales_order_items').select('id').in('doc_no', batch).range(from, to),
  );
  if (soItems.error) throw new Error(`SO line lookup failed: ${soItems.error.message}`);
  const soItemIds = soItems.data.map((r) => r.id);
  if (soItemIds.length === 0) return [];

  const [direct, allocated] = await Promise.all([
    chunkIn<{ purchase_order_id: string }>(soItemIds, (batch, from, to) =>
      sb.from('purchase_order_items').select('purchase_order_id').in('so_item_id', batch).range(from, to),
    ),
    chunkIn<{ purchase_order_item_id: string }>(soItemIds, (batch, from, to) =>
      sb.from('purchase_order_item_allocations').select('purchase_order_item_id').in('so_item_id', batch).range(from, to),
    ),
  ]);
  if (direct.error) throw new Error(`PO line lookup failed: ${direct.error.message}`);
  if (allocated.error) throw new Error(`PO allocation lookup failed: ${allocated.error.message}`);

  const poIds = new Set(direct.data.map((r) => r.purchase_order_id).filter(Boolean));
  const allocItemIds = [...new Set(allocated.data.map((r) => r.purchase_order_item_id).filter(Boolean))];
  if (allocItemIds.length > 0) {
    const viaAlloc = await chunkIn<{ purchase_order_id: string }>(allocItemIds, (batch, from, to) =>
      sb.from('purchase_order_items').select('purchase_order_id').in('id', batch).range(from, to),
    );
    if (viaAlloc.error) throw new Error(`PO line lookup failed: ${viaAlloc.error.message}`);
    for (const r of viaAlloc.data) if (r.purchase_order_id) poIds.add(r.purchase_order_id);
  }
  return [...poIds].slice(0, SO_REF_MATCH_CAP);
}

/** The `.or()` arm that adds "linked to one of these" to a list's free-text
 *  search, or nothing. Values are doc numbers / uuids, quoted so a comma or
 *  bracket in one cannot break the filter grammar. */
export function inArm(col: string, values: readonly string[]): string[] {
  if (values.length === 0) return [];
  return [`${col}.in.(${values.map((v) => `"${v.replace(/"/g, '')}"`).join(',')})`];
}

/** A DO / SI list's filters with the SO-reference matches resolved. Every
 *  reader of the list (page, export, facets) goes through this, so all of
 *  them match the same rows. */
export async function withSoRefDocNos<F extends { q: string | null; soRefDocNos: string[] }>(
  sb: Sb, c: CompanyScopeCtx, f: F,
): Promise<F> {
  return { ...f, soRefDocNos: await soDocNosByRefOrProject(sb, c, f.q) };
}

/** POs in the caller's company with a line whose item code, name, supplier SKU or
 *  description contains the term (TODO item 6: the PO list search matches line items).
 *  Capped like the reference match: a term on hundreds of lines is not a lookup. */
export async function poIdsByLineText(sb: Sb, c: CompanyScopeCtx, term: string | null): Promise<string[]> {
  const s = escapeForOr(term ?? '');
  if (s.length < 2) return [];
  const cols = ['item_code', 'material_name', 'supplier_sku', 'description'];
  const res = await scopeToCompany(
    sb.from('purchase_order_items').select('purchase_order_id').or(cols.map((col) => `${col}.ilike.%${s}%`).join(',')),
    c,
  ).limit(SO_REF_MATCH_CAP * 4);
  if (res.error) throw new Error(`PO line search failed: ${res.error.message}`);
  const ids = [...new Set((res.data as { purchase_order_id: string | null }[]).map((r) => r.purchase_order_id).filter((v): v is string => Boolean(v)))];
  return ids.slice(0, SO_REF_MATCH_CAP);
}

/** The PO list's filters with the SO-reference and line-item matches resolved (see above). */
export async function withSoRefPoIds<F extends { q: string | null; soRefPoIds: string[]; supplierIds?: string[] }>(
  sb: Sb, c: CompanyScopeCtx, f: F,
): Promise<F> {
  const [byRef, byLine, supplierIds] = await Promise.all([
    poIdsForSoDocNos(sb, await soDocNosByRefOrProject(sb, c, f.q)), poIdsByLineText(sb, c, f.q), supplierIdsByName(sb, f.q),
  ]);
  return { ...f, soRefPoIds: [...new Set([...byRef, ...byLine])], supplierIds };
}

/** Suppliers whose name or code contains the term, so a PO search finds the supplier's POs (audit 20 Nov 2026: the
    phone's receive-goods picker searches by supplier). The POs themselves stay company-scoped by the list. */
export async function supplierIdsByName(sb: Sb, term: string | null): Promise<string[]> {
  const s = escapeForOr(term ?? '');
  if (s.length < 2) return [];
  const { data, error } = await sb.from('suppliers').select('id').or(`name.ilike.%${s}%,code.ilike.%${s}%`).limit(SO_REF_MATCH_CAP);
  if (error) throw new Error(`Supplier search failed: ${error.message}`);
  return [...new Set(((data ?? []) as Array<{ id: string | null }>).map((r) => r.id).filter((v): v is string => Boolean(v)))];
}
