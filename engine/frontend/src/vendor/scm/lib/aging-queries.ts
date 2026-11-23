// ----------------------------------------------------------------------------
// aging-queries — the formal AR / AP aging from the books (ported from Houzs on
// 21 Nov 2026: columns by the bill's month, or days, or due date; money not tied
// to a bill in Unapplied (未冲); the rows add up to the control accounts).
// Server: backend/src/conts/aging-routes.ts over acc/aging.ts.
// The query keys still start 'ar-aging' / 'ap-aging', so the invoice, AP and
// opening screens that refresh the aging after a change refresh this one.
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import type { Department } from '../../../conts/department';
import { authedFetch } from './authed-fetch';
import { retryUnlessClientError } from '../../../lib/retryPolicy';

export type AgingSide = 'ar' | 'ap';
export type AgingBasis = 'invoice' | 'due';
export type AgingBuckets = 'month' | 'day';
/** all, trade (every control but the Other one), other, or one control's account code. */
export type AgingControl = string;

export type AgingOpenItem = { group: string; docNo: string; kind: string; date: string; dueDate: string | null; amountSen: number; openSen: number; column: number };
export type AgingUnappliedItem = { docNo: string; kind: string; date: string; amountSen: number };
export type AgingRow = {
  key: string;
  code: string | null;
  name: string;
  balanceSen: number;
  /** The five columns, in sen: This month · 1 · 2 · 3 · 4 months + (本月 … 4 个月以上), or by days. */
  cells: number[];
  /** Money not tied to a bill (未冲, Unapplied) — negative. */
  unappliedSen: number;
  items: AgingOpenItem[];
  unapplied: AgingUnappliedItem[];
};
export type AgingAccount = { code: string; name: string; other: boolean };
export type AgingReportData = {
  asOf: string;
  basis: AgingBasis;
  buckets: AgingBuckets;
  control: AgingControl;
  department: Department | null;
  /** Every customer (SDC) or supplier (SCC) control of the chart, for the Accounts choice. */
  accounts: AgingAccount[];
  rows: AgingRow[];
  totals: { balanceSen: number; cells: number[]; unappliedSen: number };
  controls: Array<{ code: string; balanceSen: number }>;
  /** What the rows miss of the control accounts — zero by construction. */
  differenceSen: number;
  /** Open invoices brought over as migrated paperwork: never booked here, not aged. */
  outside: { count: number; sen: number };
  /** The OPENING journal on these controls: explained by the opening documents, and left as one unsplit line. */
  opening: { splitSen: number; unsplitSen: number };
};

/** The five columns' names. */
export const AGING_COLUMN_LABELS: Record<AgingBuckets, string[]> = {
  month: ['This month', '1 month', '2 months', '3 months', '4 months +'],
  day: ['0–30', '31–60', '61–90', '91–120', 'Over 120 days'],
};

export type AgingParams = { asOf: string; basis: AgingBasis; buckets: AgingBuckets; control: AgingControl; department: Department | '' };

export const agingPath = (side: AgingSide, p: AgingParams): string => {
  const qs = new URLSearchParams({ asOf: p.asOf, basis: p.basis, buckets: p.buckets, control: p.control });
  if (p.department) qs.set('department', p.department);
  return `/accounting/${side}-aging?${qs.toString()}`;
};

export const useAging = (side: AgingSide, p: AgingParams) => useQuery({
  queryKey: [side === 'ar' ? 'ar-aging' : 'ap-aging', p.asOf, p.basis, p.buckets, p.control, p.department],
  queryFn: () => authedFetch<AgingReportData>(agingPath(side, p)),
  staleTime: 30_000,
  retry: retryUnlessClientError,
  retryDelay: 800,
});
