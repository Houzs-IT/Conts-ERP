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
