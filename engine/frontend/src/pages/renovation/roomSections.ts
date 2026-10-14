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
): { sections: T[]; added: string[] } {
  const out = [...sections];
  const added: string[] = [];
  const rooms = roomSectionHeadings(bedrooms, bathrooms);
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

/** Rooms after "Generate rooms from layout": the missing ones inserted where they belong. */
export function generateRooms(rooms: readonly string[], bedrooms: number, bathrooms: number): { rooms: string[]; added: string[] } {
  const r = insertRoomSections(rooms.map((heading) => ({ heading })), bedrooms, bathrooms, (heading) => ({ heading }));
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
