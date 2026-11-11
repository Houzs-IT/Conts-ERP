// ---------------------------------------------------------------------------
// Money per status tab (TODO item 5, Hookka 5aff2b333 / f9ff4d840 / 79323f31c):
// the PO, GRN, PI and SI lists show "Pending 25 · RM 15,631" — each tab's count
// AND the money in it. The money is read with the SAME base filters as that
// list's head counts (company, supplier / salesperson scope; no status, search
// or paging), grouped by status in one aggregate and folded into the same
// buckets, so a tab's money always covers exactly the rows its count does.
//
// Money is a garnish: a failed read answers undefined and the list still loads
// with its counts (the counts' own failure handling is unchanged).
// ---------------------------------------------------------------------------
import { paginateAll } from './paginate-all';

type Res<T> = { data: T[] | null | undefined; error?: { message?: string | null } | null };

/** RAW_STATUS (upper case) -> summed money, from a grouped aggregate or raw rows. */
export function sumByStatus<T extends { status?: string | null }>(rows: readonly T[], amount: (r: T) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = String(r.status ?? '').toUpperCase() || 'UNKNOWN';
    out[key] = (out[key] ?? 0) + (Number.isFinite(amount(r)) ? amount(r) : 0);
  }
  return out;
}

/** Fold RAW_STATUS sums into the list's tab buckets, plus `all`. Bucket members
 *  are compared upper case, as the status column is stored. `all` leaves out the
 *  `cancelled` bucket's money: a cancelled document is worth nothing. */
export function foldMoney(byStatus: Record<string, number>, buckets: Record<string, readonly string[]>): Record<string, number> {
  const dead = new Set((buckets.cancelled ?? []).map((m) => m.toUpperCase()));
  const out: Record<string, number> = { all: Object.entries(byStatus).reduce((s, [k, n]) => (dead.has(k) ? s : s + n), 0) };
  for (const [tab, members] of Object.entries(buckets)) {
    out[tab] = [...new Set(members.map((m) => m.toUpperCase()))].reduce((s, m) => s + (byStatus[m] ?? 0), 0);
  }
  return out;
}

/**
 * Read and fold. `base(select)` must build the list's count query (company and
 * scope filters, nothing else) with the given select. Tries the grouped
 * aggregate first; falls back to paging the two columns when aggregates are off.
 */
export async function readStatusMoney(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builders (aggregate selects defeat supabase-js typing)
  base: (select: string) => any,
  amountCol: string,
  buckets: Record<string, readonly string[]>,
): Promise<Record<string, number> | undefined> {
  try {
    const agg = (await base(`status, amt:${amountCol}.sum()`)) as Res<{ status: string | null; amt: number | null }>;
    if (!agg.error && agg.data) return foldMoney(sumByStatus(agg.data, (r) => Number(r.amt ?? 0)), buckets);
    const fb = await paginateAll<Record<string, unknown> & { status: string | null }>((from, to) => base(`status, ${amountCol}`).range(from, to));
    if (fb.error || !fb.data) return undefined;
    return foldMoney(sumByStatus(fb.data, (r) => Number(r[amountCol] ?? 0)), buckets);
  } catch {
    return undefined;
  }
}
