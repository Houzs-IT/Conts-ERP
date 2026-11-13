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

/** Which side of a header a dragged column lands on: the half of the header the pointer is over. Worked out from the
 *  pointer when it is let go too, not only for the gold line, which can be a frame behind. */
export const dropSide = (x: number, box: { left: number; width: number }): 'before' | 'after' =>
  (x < box.left + box.width / 2 ? 'before' : 'after');

/** The kind of data a dragged header carries: not plain text, which a search box let go over would take as typing. */
export const COLUMN_DRAG_TYPE = 'application/x-conts-column';

/** True when the column order kept with the person's account (functions/api/table-layouts/columns.ts) was saved later
 *  than the one this browser last saved or took: it was changed on another computer. Both times are the server's, so
 *  the computers' own clocks play no part, and an older answer kept from before a save cannot undo it. */
export function accountOrderNewer(accountAt: string | null | undefined, browserAt: string | null): boolean {
  return !!accountAt && (!browserAt || accountAt > browserAt);
}

/** True when opening a saved view changes the columns: the view keeps an order of its own. The company's ready-made
 *  views (functions/_lib/tableLayoutSeeds.ts) keep none, so they leave the person's own order as it is. */
export const viewKeepsColumns = (layout: { columns?: readonly unknown[] | null }) => !!layout.columns?.length;

/** Where this browser keeps a list's columns for one person, and when their account kept that order. Per person, so a
 *  shared computer (the front desk) keeps each person's own. `legacy` is the one key per browser used before, read only
 *  as a start by someone who has none of their own yet. */
export function layoutKeys(userId: string | null | undefined, table: string) {
  const who = userId || 'anon';
  return { columns: `dt:${table}:columns:${who}`, at: `dt:${table}:columnsAt:${who}`, legacy: `dt:${table}:columns` };
}
export type LayoutKeys = ReturnType<typeof layoutKeys>;

/** The column layout this browser keeps for the person, else the browser's older shared one, else null. Never throws:
 *  a private window or blocked storage reads as none. */
export function readLayout(storage: Pick<Storage, 'getItem'> | null, keys: LayoutKeys): LayoutColumn[] | null {
  try {
    const v = storage?.getItem(keys.columns) ?? storage?.getItem(keys.legacy) ?? null;
    const parsed: unknown = v ? JSON.parse(v) : null;
    return Array.isArray(parsed) ? parsed as LayoutColumn[] : null;
  } catch { return null; }
}

/** What a list lets a person do with its columns. Headers drag only where the Columns menu is there too, whose
 *  "Standard columns" puts a column back: lists inside a record have neither (owner, Oct 2026) and keep their order.
 *  The order goes with the person's account on every list whose columns can be changed, saved views or not, for desk
 *  accounts; owners and field roles keep no views (functions/_lib/tableLayouts.ts mayUseViews), so theirs stays in the
 *  browser. */
export function columnControls(o: { noToolbar?: boolean; noColumns?: boolean; desk: boolean; visible: number }): { drag: boolean; account: boolean } {
  const changeable = !o.noToolbar && !o.noColumns;
  return { drag: changeable && o.visible > 1, account: changeable && o.desk };
}

/** Sends a list's column order to the person's account a moment after the last change, so dragging a few columns in a
 *  row is one save; saves go one after another, so the account ends with the last. `flush` sends a waiting change at
 *  once (the list is left before the moment is up). `onSaved` gets the time the account kept it; a failed save is quiet
 *  (the browser keeps the order, and the next change sends it again). `pending` is true while a change waits or is on
 *  its way, when the list must not take an order from the account over it. */
export function columnSaver<T>(send: (cols: T) => Promise<string | null>, onSaved: (at: string) => void, delayMs = 800) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: { cols: T } | null = null;
  let onTheWay = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!waiting) return;
    const { cols } = waiting;
    waiting = null;
    onTheWay++;
    queue = queue.then(() => send(cols)).then(at => { if (at) onSaved(at); }, () => {}).finally(() => { onTheWay--; });
  };
  return {
    schedule(cols: T) { waiting = { cols }; if (timer) clearTimeout(timer); timer = setTimeout(flush, delayMs); },
    flush,
    pending: () => !!waiting || onTheWay > 0,
  };
}
