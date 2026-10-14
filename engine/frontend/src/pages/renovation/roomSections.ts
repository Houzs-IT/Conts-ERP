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
