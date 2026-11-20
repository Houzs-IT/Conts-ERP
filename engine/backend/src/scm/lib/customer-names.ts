// ----------------------------------------------------------------------------
// The Customer Name funnel's choices: every distinct customer name on a list,
// and nothing else.
//
// The SO and DO lists used to fill that funnel from GET /mfg-sales-orders/customers,
// which reads every SO header with nine columns and answers each customer with
// every one of their orders attached, on every visit, just to collect names
// (audit 20 Nov 2026). This reads the one column, in name order, and answers the
// names. The caller passes a page reader that already carries the list's own
// company and sales scope, so the funnel offers exactly the names the list can show.
// ----------------------------------------------------------------------------

import { paginateAll } from './paginate-all';

/** Distinct, trimmed, non-blank names, in the order the pages arrive (name order), first spelling kept. */
export function distinctNames(rows: ReadonlyArray<{ debtor_name: string | null }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const name = (r.debtor_name ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Every distinct customer name the scoped query can see. `page(from, to)` must select `debtor_name`, apply the list's
 * scope and order by `debtor_name`; it is read page by page so PostgREST's row cap cannot drop a name.
 */
export async function readDistinctCustomerNames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SCM PostgREST client is untyped throughout
  page: (from: number, to: number) => any,
): Promise<{ names: string[]; error: string | null }> {
  const { data, error } = await paginateAll<{ debtor_name: string | null }>(page);
  if (error) return { names: [], error: error.message };
  return { names: distinctNames(data ?? []), error: null };
}
