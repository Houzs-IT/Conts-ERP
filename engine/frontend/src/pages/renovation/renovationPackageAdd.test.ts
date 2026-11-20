import { describe, expect, it } from 'vitest';
import { blankLine, blankSection } from './DocEditor';
import { chosenPackageSections, withPackageAdd } from './renovationPackageAdd';
import type { DocSection } from '../../lib/renovation/api';
import type { PackageAdd } from './renovationPackagePick';

const line = (code: string, from: string | null = null) => ({ ...blankLine('ITEM'), itemCode: code as string | null, description: code, fromPackageId: from, voChange: 'ADD' as const });
const sec = (heading: string, lines: ReturnType<typeof line>[]): DocSection => ({ heading, bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines });
const add = (id: string, sections: DocSection[]): PackageAdd => ({ packageId: id, code: 'PKG-1', name: 'x', total: 0, sections });

describe('withPackageAdd', () => {
  it('a package replaces the blank starting section and adds its areas', () => {
    const out = withPackageAdd([blankSection('ADD ON :')], add('p', [sec('Living room', [line('SOF', 'p')]), sec('Master bedroom', [line('BED', 'p')])]), 'PACKAGE', { sectionIndex: null, lineIndex: null }, false);
    expect(out.map((s) => s.heading)).toEqual(['Living room', 'Master bedroom']);
  });
  it('a kit picked on a blank line joins that area and the blank line goes', () => {
    const adds = [sec('Kitchen', [line('RN-1'), { ...line(''), itemCode: null, description: '' }])];
    const out = withPackageAdd(adds, add('k', [sec('', [line('BED', 'k'), line('MAT', 'k')])]), 'KIT', { sectionIndex: 0, lineIndex: 1 }, false);
    expect(out).toHaveLength(1);
    expect(out[0].lines.map((l) => l.itemCode)).toEqual(['RN-1', 'BED', 'MAT']);
  });
  it('a kit from the From package button joins the last area', () => {
    const adds = [sec('Kitchen', [line('RN-1')]), sec('Study', [line('RN-2')])];
    const out = withPackageAdd(adds, add('k', [sec('Study', [line('DESK', 'k')])]), 'KIT', { sectionIndex: null, lineIndex: null }, false);
    expect(out[1].lines.map((l) => l.itemCode)).toEqual(['RN-2', 'DESK']);
  });
  it('Change picks replaces only that package\'s lines', () => {
    const adds = [sec('Kitchen', [line('RN-1')]), sec('Living room', [line('SOF', 'p'), line('TV', 'p')])];
    const out = withPackageAdd(adds, add('p', [sec('Living room', [line('SOF', 'p')])]), 'PACKAGE', { sectionIndex: null, lineIndex: null }, true);
    expect(out.map((s) => [s.heading, s.lines.map((l) => l.itemCode)])).toEqual([['Kitchen', ['RN-1']], ['Living room', ['SOF']]]);
  });
  it('a kit picked on a blank line in the middle goes there, in the kit order', () => {
    const adds = [sec('Kitchen', [line('RN-1'), { ...line(''), itemCode: null, description: '' }, line('RN-2')])];
    const out = withPackageAdd(adds, add('k', [sec('', [line('BED', 'k'), line('MAT', 'k'), line('PIL', 'k')])]), 'KIT', { sectionIndex: 0, lineIndex: 1 }, false);
    expect(out[0].lines.map((l) => l.itemCode)).toEqual(['RN-1', 'BED', 'MAT', 'PIL', 'RN-2']);
  });
});

describe('package order is kept from package to VO', () => {
  const pkg = {
    id: 'p',
    sections: [
      sec('Living room', [line('SOF'), line('TV'), line('RUG'), line('LAMP')]),
      sec('Master bedroom', [line('BED'), line('MAT'), line('WARD')]),
      sec('Kitchen', [line('FRIDGE'), line('HOOD')]),
    ],
  };
  const allOn = Object.fromEntries(pkg.sections.flatMap((s, si) => s.lines.map((l, li) => [`${si}_${li}`, { on: true, qty: l.qty }])));
  const shape = (ss: DocSection[]) => ss.map((s) => [s.heading, s.lines.map((l) => l.itemCode)]);
  const expected = [['Living room', ['SOF', 'TV', 'RUG', 'LAMP']], ['Master bedroom', ['BED', 'MAT', 'WARD']], ['Kitchen', ['FRIDGE', 'HOOD']]];

  it('the confirm dialog keeps areas, then lines, in package order', () => {
    expect(shape(chosenPackageSections(pkg, allOn, []))).toEqual(expected);
  });
  it('unticking a line keeps the others in order', () => {
    const out = chosenPackageSections(pkg, { ...allOn, '0_1': { on: false, qty: 1 } }, []);
    expect(out[0].lines.map((l) => l.itemCode)).toEqual(['SOF', 'RUG', 'LAMP']);
  });
  it('the VO Add part gets the areas and lines in the same order', () => {
    const chosen = chosenPackageSections(pkg, allOn, []);
    const out = withPackageAdd([blankSection('ADD ON :')], add('p', chosen), 'PACKAGE', { sectionIndex: null, lineIndex: null }, false);
    expect(shape(out)).toEqual(expected);
  });
  it('after lines already typed, the package areas follow them in package order', () => {
    const chosen = chosenPackageSections(pkg, allOn, []);
    const out = withPackageAdd([sec('Study', [line('DESK')])], add('p', chosen), 'PACKAGE', { sectionIndex: null, lineIndex: null }, false);
    expect(shape(out)).toEqual([['Study', ['DESK']], ...expected]);
  });
});
