// ----------------------------------------------------------------------------
// The paged read of the Delivery Returns and Purchase Returns lists (audit 20 Nov 2026, batch 3).
//
// Both lists answered their newest 500 / 300 returns to every caller, and the phone list searched only what had
// loaded. `?page=` asks for one page instead, `{ <rows>, total, page, pageSize }`, the contract the phone's
// generic list (MobileModuleList SERVER_PAGINATED) already speaks for the other documents. `?q=` searches on the
// server over the fields the list's own search reads. Without `page`, the list answers exactly as before.
// ----------------------------------------------------------------------------

import { cleanSearch } from './outstanding-so-page';
import { escapeForOr } from './postgrest-search';

export const RETURN_PAGE_SIZE_MAX = 100;
const RETURN_PAGE_SIZE_DEFAULT = 30;

export interface ReturnListPage { page: number; pageSize: number; q: string }

/** The paged mode's parameters, or null when the caller did not ask for a page (no `page`). */
export function parseReturnListPage(query: (k: string) => string | undefined): ReturnListPage | null {
  const raw = query('page');
  if (raw == null || raw === '') return null;
  const p = Number(raw);
  const s = Number(query('pageSize'));
  return {
    page: Number.isFinite(p) && p > 0 ? Math.floor(p) : 0,
    pageSize: Number.isFinite(s) && s > 0 ? Math.min(RETURN_PAGE_SIZE_MAX, Math.floor(s)) : RETURN_PAGE_SIZE_DEFAULT,
    q: cleanSearch(query('q')),
  };
}

/** The first and last row of a page, for `.range()`. */
export function pageRange(p: ReturnListPage): [number, number] {
  return [p.page * p.pageSize, p.page * p.pageSize + p.pageSize - 1];
}

/* The Delivery Returns search fields (frontend lib/so-ref-search.ts deliveryReturnSearchParts), minus the
   salesperson uuid, which ilike cannot read. The reference is ref or customer_so_no (customerRefOf). */
export const DR_SEARCH_COLS = [
  'return_number', 'do_doc_no', 'debtor_name', 'debtor_code', 'ref', 'customer_so_no',
  'branding', 'sales_location', 'reason', 'venue',
] as const;

/* The phone's Purchase Returns search (return number, credit note reference) plus the reason; the supplier is
   matched through its ids. */
export const PR_SEARCH_COLS = ['return_number', 'credit_note_ref', 'reason'] as const;

/** The `.or()` filter for a search over `cols`, plus `supplier_id` in the given ids. Null for no search. */
export function returnSearchOr(cols: readonly string[], q: string, supplierIds: readonly string[] = []): string | null {
  const s = escapeForOr(q);
  if (!s) return null;
  const parts = cols.map((c) => `${c}.ilike.%${s}%`);
  if (supplierIds.length > 0) parts.push(`supplier_id.in.(${supplierIds.join(',')})`);
  return parts.join(',');
}
