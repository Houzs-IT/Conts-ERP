/* Renovation mode (Conts, mig 0112): a sales order's lines room by room, for its page and its print. Pure. */

/** Renovation mode: the order's room list and each line's room by item id. */
export interface SoPrintRooms { order: string[]; byItem: Record<string, string> }

export const NOT_IN_A_ROOM = 'Other items';
export function roomLabel(rooms: SoPrintRooms, itemId: string): string {
  const r = rooms.byItem[itemId] ?? '';
  return rooms.order.find((x) => x.toLowerCase() === r.toLowerCase()) ?? NOT_IN_A_ROOM;
}
/** Lines in room order (the order's list, then lines in no room), keeping line order inside a room. */
export function roomOrdered<T extends { id: string }>(items: readonly T[], rooms: SoPrintRooms): T[] {
  const rank = (it: T) => {
    const i = rooms.order.findIndex((x) => x.toLowerCase() === (rooms.byItem[it.id] ?? '').toLowerCase());
    return i < 0 ? rooms.order.length : i;
  };
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map((x) => x.it);
}

/** One area (room) of a sales order: its lines in line order and their subtotal. */
export interface SoAreaGroup<T> { area: string; lines: T[]; subtotalSen: number }

/** The "By area" view (owner, 24 Oct 2026): the lines grouped under their room, in the order's room order, with a
    subtotal per room. Lines in no listed room come last, under "Other items". Pure. */
export function roomGroups<T extends { id: string; total_sen?: number | null }>(items: readonly T[], rooms: SoPrintRooms): SoAreaGroup<T>[] {
  const out: SoAreaGroup<T>[] = [];
  for (const it of roomOrdered(items, rooms)) {
    const area = roomLabel(rooms, it.id);
    let g = out[out.length - 1];
    if (!g || g.area !== area) {
      g = { area, lines: [], subtotalSen: 0 };
      out.push(g);
    }
    g.lines.push(it);
    g.subtotalSen += Number(it.total_sen ?? 0);
  }
  return out;
}

/* "By category" (owner, 31 Oct 2026): the same grouping keyed on each line's catalog category and sub-category,
   named and ordered as Products > SKU Master keeps them (product_category_groups, product_sub_categories), shown as
   "Works · Plaster ceiling" like the renovation lists. A line whose code is not in the catalog (the renovation system
   rows: document discount, lump sums) prints under "Other items". Pure. */
export interface CatalogNames {
  groups: ReadonlyArray<{ code: string; label: string }>;
  subs: ReadonlyArray<{ group: string; code: string; label: string; sort: number; legacy?: readonly string[] }>;
}
export function categoryRooms(
  items: ReadonlyArray<{ id: string; item_code?: string | null }>,
  productOf: (code: string) => { group?: string | null; sub?: string | null } | undefined,
  names: CatalogNames,
): SoPrintRooms {
  const byItem: Record<string, string> = {};
  const rank = new Map<string, number>();
  for (const it of items) {
    const p = it.item_code ? productOf(it.item_code) : undefined;
    const gi = names.groups.findIndex((g) => g.code === p?.group);
    if (!p || gi < 0) continue;
    const subs = names.subs.filter((s) => s.group === p.group);
    const sub = p.sub ? subs.find((s) => s.code === p.sub || s.legacy?.includes(p.sub!)) : undefined;
    const label = sub ? `${names.groups[gi]!.label} · ${sub.label}` : names.groups[gi]!.label;
    byItem[it.id] = label;
    rank.set(label, gi * 100000 + (sub ? sub.sort : 99999));
  }
  const order = [...rank.keys()].sort((a, b) => rank.get(a)! - rank.get(b)! || a.localeCompare(b));
  return { order, byItem };
}
