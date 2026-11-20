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
    // Picked on a line: the kit's lines go where that line is (in place of a blank one, else right after it), in the
    // kit's own order; otherwise at the end of the area.
    const before = adds[target]?.lines ?? [];
    const onLine = !replace && target === at.sectionIndex && at.lineIndex !== null && at.lineIndex < before.length;
    const pos = onLine ? at.lineIndex! + (typedLine(before[at.lineIndex!]) ? 1 : 0) : Infinity;
    const kit = a.sections.flatMap((x) => x.lines);
    cur = cur.map((s, i) => (i === target ? { ...s, lines: [...s.lines.slice(0, pos), ...kit, ...s.lines.slice(pos)] } : s));
    return cur.filter((s) => s.lines.length > 0);
  }
  return [...cur.filter((s) => s.lines.some(typedLine)), ...a.sections];
}

/** The lines a package brings, after the confirm dialog's ticks, quantities and area names. Order is the package's own:
    areas in their order, lines in their order inside each area (owner, 20 Nov 2026). */
export function chosenPackageSections(
  pkg: { id: string; sections: Array<Omit<DocSection, 'lines'> & { lines: DocLine[] }> },
  picks: Record<string, { on: boolean; qty: number }>,
  areaNames: string[],
): DocSection[] {
  const priced = (l: Pick<DocLine, 'kind'>) => l.kind === 'ITEM' || l.kind === 'CHILD';
  return pkg.sections.map((s, si) => ({
    heading: (areaNames[si] ?? s.heading).trim(),
    bandColor: s.bandColor, lumpSumSen: null, pageBreakBefore: false,
    lines: s.lines.flatMap((l, li) => {
      if (!priced(l)) return [{ ...l, voChange: 'ADD' as const, fromPackageId: pkg.id }];
      const p = picks[`${si}_${li}`];
      return p?.on ? [{ ...l, qty: p.qty, voChange: 'ADD' as const, fromPackageId: pkg.id }] : [];
    }),
  })).filter((s) => s.lines.some((l) => priced(l)));
}
