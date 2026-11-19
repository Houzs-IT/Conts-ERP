/* Where a package's lines go in a VO's Add part (owner, 20 Nov 2026). A package adds its areas as new sections after what
   is already typed; a kit (no area) joins the area the user picked it in, or the last area when picked with From package.
   The blank line the search was typed on gives way. Change picks (replace) first takes out every line of that package. */

import type { DocLine, DocSection } from '../../lib/renovation/api';
import type { PackageAdd } from './renovationPackagePick';

const typedLine = (l: DocLine): boolean => Boolean(l.itemCode || l.description.trim() || l.fromPackageId);

export function withPackageAdd(
  adds: DocSection[], a: PackageAdd, kind: 'PACKAGE' | 'KIT', at: { sectionIndex: number | null; lineIndex: number | null }, replace: boolean,
): DocSection[] {
  let cur = adds.map((s, i) => ({
    ...s,
    lines: s.lines.filter((l, j) => !(replace && l.fromPackageId === a.packageId) && !(i === at.sectionIndex && j === at.lineIndex && !typedLine(l))),
  }));
  let target = at.sectionIndex;
  if (target === null && kind === 'KIT') {
    for (let i = cur.length - 1; i >= 0; i--) if (cur[i].heading.trim() && cur[i].lines.some(typedLine)) { target = i; break; }
  }
  if (kind === 'KIT' && target !== null && target < cur.length) {
    cur = cur.map((s, i) => (i === target ? { ...s, lines: [...s.lines, ...a.sections.flatMap((x) => x.lines)] } : s));
    return cur.filter((s) => s.lines.length > 0);
  }
  return [...cur.filter((s) => s.lines.some(typedLine)), ...a.sections];
}
