import { describe, expect, it } from 'vitest';
import { blankLine, blankSection } from './DocEditor';
import { withPackageAdd } from './renovationPackageAdd';
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
});
