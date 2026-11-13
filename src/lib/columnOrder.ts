/** A list's column in the order the table shows (DataTable's TableLayout['columns']): hidden ones keep their place. */
export interface LayoutColumn { key: string; hidden: boolean }

/** The layout with `from` moved just before or after `to`: a column header dragged onto another (chew, 13 Nov 2026).
 *  The same array comes back when nothing moves: dropped on itself, next to where it already is, or naming a column the
 *  layout does not have. */
export function moveColumn<T extends LayoutColumn>(layout: T[], from: string, to: string, side: 'before' | 'after'): T[] {
  const i = layout.findIndex(c => c.key === from), j = layout.findIndex(c => c.key === to);
  if (i < 0 || j < 0 || i === j) return layout;
  const rest = layout.filter((_, k) => k !== i);
  const at = rest.findIndex(c => c.key === to) + (side === 'after' ? 1 : 0);
  const next = [...rest.slice(0, at), layout[i], ...rest.slice(at)];
  return next.every((c, k) => c === layout[k]) ? layout : next;
}

/** True when the column order kept with the person's account (functions/api/table-layouts/columns.ts) was saved later
 *  than the one this browser last saved or took: it was changed on another computer. Both times are the server's, so
 *  the computers' own clocks play no part, and an older answer kept from before a save cannot undo it. */
export function accountOrderNewer(accountAt: string | null | undefined, browserAt: string | null): boolean {
  return !!accountAt && (!browserAt || accountAt > browserAt);
}

/** True when opening a saved view changes the columns: the view keeps an order of its own. The company's ready-made
 *  views (functions/_lib/tableLayoutSeeds.ts) keep none, so they leave the person's own order as it is. */
export const viewKeepsColumns = (layout: { columns?: readonly unknown[] | null }) => !!layout.columns?.length;
