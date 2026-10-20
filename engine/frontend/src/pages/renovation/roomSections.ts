/* "Generate rooms from layout" (owner, 14 Oct 2026): one section per room of the
   document's layout, in order: Living hall, Bedroom 1..N, Bathroom 1..M, Common
   area. Sections already there (same name, any case or spacing) stay where they
   are and are not added again; a missing room goes right after the room before it
   in that order, or before the first room after it, or at the end. Pure. */

import { roomSectionHeadings } from '../../vendor/shared/renovation-property';

const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function insertRoomSections<T extends { heading: string }>(
  sections: readonly T[],
  bedrooms: number,
  bathrooms: number,
  make: (heading: string) => T,
  commonFirst = false,
): { sections: T[]; added: string[] } {
  const out = [...sections];
  const added: string[] = [];
  const layoutRooms = roomSectionHeadings(bedrooms, bathrooms);
  const rooms = commonFirst ? [DEFAULT_ROOM, ...layoutRooms.filter((h) => key(h) !== key(DEFAULT_ROOM))] : layoutRooms;
  const indexOf = (h: string) => out.findIndex((s) => key(s.heading) === key(h));
  let last = -1;
  rooms.forEach((h, i) => {
    const at = indexOf(h);
    if (at >= 0) { last = at; return; }
    let pos: number;
    if (last >= 0) pos = last + 1;
    else {
      const later = rooms.slice(i + 1).map(indexOf).filter((x) => x >= 0);
      pos = later.length ? Math.min(...later) : out.length;
    }
    out.splice(pos, 0, make(h));
    added.push(h);
    last = pos;
  });
  return { sections: out, added };
}

/* ── Rooms on a renovation-mode sales order (a list of names; each line names its room) ── */

/** Rooms after "Generate rooms from layout": the missing ones inserted where they belong. On a sales order
    Common area comes first, then the layout's rooms (owner, 20 Oct 2026); quotations keep it last. */
export function generateRooms(rooms: readonly string[], bedrooms: number, bathrooms: number): { rooms: string[]; added: string[] } {
  const r = insertRoomSections(rooms.map((heading) => ({ heading })), bedrooms, bathrooms, (heading) => ({ heading }), true);
  return { rooms: r.sections.map((s) => s.heading), added: r.added };
}

/** Rename one room; refused (null) when the new name is blank or another room already has it. */
export function renameRoom(rooms: readonly string[], from: string, to: string): string[] | null {
  const name = to.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (rooms.some((r) => r !== from && key(r) === key(name))) return null;
  return rooms.map((r) => (r === from ? name : r));
}

export function moveRoom(rooms: readonly string[], index: number, dir: -1 | 1): string[] {
  const j = index + dir;
  if (index < 0 || j < 0 || j >= rooms.length) return [...rooms];
  const out = [...rooms];
  [out[index], out[j]] = [out[j]!, out[index]!];
  return out;
}

/** A new room's default name: "Room N" that is not taken yet. */
export function nextRoomName(rooms: readonly string[]): string {
  for (let n = rooms.length + 1; ; n++) {
    const name = `Room ${n}`;
    if (!rooms.some((r) => key(r) === key(name))) return name;
  }
}

/** Rows grouped under their rooms in room order; rows whose room is blank or unknown go to `unplaced`. */
export function groupByRoom<T extends { room: string }>(rooms: readonly string[], rows: readonly T[]): { groups: Array<{ room: string; rows: T[] }>; unplaced: T[] } {
  const groups = rooms.map((room) => ({ room, rows: [] as T[] }));
  const unplaced: T[] = [];
  for (const row of rows) {
    const g = groups.find((x) => key(x.room) === key(row.room));
    if (g && row.room.trim()) g.rows.push(row);
    else unplaced.push(row);
  }
  return { groups, unplaced };
}

/** Rooms made as soon as a layout is chosen (owner, 14 Oct 2026): only while the order has no rooms and no line
    with a product yet. The empty lines move into the first room, so nothing is left outside a room. null = leave
    the order as it is (the "Generate rooms from layout" button is for that case). */
export function autoRoomsPlan(
  rooms: readonly string[],
  lines: ReadonlyArray<{ key: string; filled: boolean }>,
  layout: { bedrooms: number; bathrooms: number } | null,
): { rooms: string[]; assign: Record<string, string> } | null {
  /* The single Common area an order starts with before a layout is chosen does not count as rooms. */
  const onlyDefault = rooms.length === 1 && key(rooms[0]!) === key(DEFAULT_ROOM);
  if (!layout || (rooms.length > 0 && !onlyDefault) || lines.some((l) => l.filled)) return null;
  const made = generateRooms([], layout.bedrooms, layout.bathrooms).rooms;
  return { rooms: made, assign: Object.fromEntries(lines.map((l) => [l.key, made[0]!])) };
}

export const DEFAULT_ROOM = 'Common area';

/** Every line belongs to a room (owner, 14 Oct 2026): with no rooms yet the order has one, Common area; a line
    whose room is blank or no longer listed shows (and is saved) under Common area, added first when the
    order has no room of that name. The saved data changes only when the order is saved. */
export function placeRows<T extends { key: string; room: string }>(rooms: readonly string[], rows: readonly T[]): { rooms: string[]; roomOf: Record<string, string> } {
  const list = rooms.length > 0 ? [...rooms] : [DEFAULT_ROOM];
  const find = (r: string) => list.find((x) => key(x) === key(r));
  const roomOf: Record<string, string> = {};
  for (const row of rows) {
    const hit = row.room.trim() ? find(row.room) : undefined;
    if (hit) { roomOf[row.key] = hit; continue; }
    let common = find(DEFAULT_ROOM);
    if (!common) { list.unshift(DEFAULT_ROOM); common = DEFAULT_ROOM; }
    roomOf[row.key] = common;
  }
  return { rooms: list, roomOf };
}
