/* The production order list's filter: the Purchase Order list's (lib/po-list-read.ts), plus the tabs a status alone cannot
   say. Pending and In Progress turn on Start, Overdue on the plan finish. The list, its counts, its funnels and its export
   all read through here, so a tab means the same in each. */

import type { CompanyScopeCtx } from './companyScope';
import { todayMyt } from './my-time';
import { filterPoList, type PoListFilters } from './po-list-read';
import { filterProductionTab, isProductionTab } from './renovation-production';

export function filterProductionList<Q>(q: Q, f: PoListFilters, c: CompanyScopeCtx, validStatuses: ReadonlySet<string>): Q {
  if (!isProductionTab(f.status)) return filterPoList(q, f, c, validStatuses);
  return filterProductionTab(filterPoList(q, { ...f, status: null }, c, validStatuses), f.status, todayMyt());
}
