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
