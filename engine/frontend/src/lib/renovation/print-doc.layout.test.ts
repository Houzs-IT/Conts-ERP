/* The sales order PDF by item, area or category: the same lines and money, grouped differently. */
import { describe, expect, it } from 'vitest';
import { sectionsByLayout } from './print-doc';
import type { PrintLineInput, PrintSectionInput } from './print-model';

const line = (over: Partial<PrintLineInput>): PrintLineInput => ({ kind: 'ITEM', description: 'x', qty: 1, measureMilli: null, measureUom: null, unitPriceSen: 100, discountBp: 0, amountOverrideSen: null, isFoc: false, ...over });
const section = (heading: string, lines: PrintLineInput[], lumpSumSen: number | null = null): PrintSectionInput => ({ heading, bandColor: null, lumpSumSen, lines });

const A = line({ id: 'a', description: 'Tile', room: 'Kitchen', itemCode: 'T' });
const B = line({ id: 'b', description: 'Sink', room: 'Bath', itemCode: 'S' });
const C = line({ id: 'c', description: 'Paint', room: 'Kitchen', itemCode: 'P' });
const CHILD = line({ id: 'c2', kind: 'CHILD', parentId: 'b', description: 'Tap', room: 'Bath', itemCode: 'T2' });
const doc = [section('Wet works', [A, B, CHILD]), section('Finishes', [C])];
const group = (l: PrintLineInput) => ({ T: 'Tiling', S: 'Sanitary', P: 'Painting', T2: 'Tiling' })[l.itemCode ?? ''] ?? null;

describe('sectionsByLayout', () => {
  it('by area keeps the document as drawn', () => {
    expect(sectionsByLayout(doc, 'area', group)).toBe(doc);
  });
  it('by item is one list of every line', () => {
    const r = sectionsByLayout(doc, 'item', group);
    expect(r).toHaveLength(1);
    expect(r[0]!.lines.map((l) => l.description)).toEqual(['Tile', 'Sink', 'Tap', 'Paint']);
  });
  it('by category groups the lines; a child stays with its parent', () => {
    const r = sectionsByLayout(doc, 'category', group);
    expect(r.map((s) => [s.heading, s.lines.map((l) => l.description)])).toEqual([['Tiling', ['Tile']], ['Sanitary', ['Sink', 'Tap']], ['Painting', ['Paint']]]);
  });
  it('a line with no category lands in Other, last', () => {
    const r = sectionsByLayout([section('S', [line({ description: 'Odd', itemCode: null }), A])], 'category', group);
    expect(r.map((s) => s.heading)).toEqual(['Tiling', 'Other']);
  });
  it('a lump sum section has one price for its lines, so it stays as drawn', () => {
    const lump = [section('Package', [A, B], 5000)];
    expect(sectionsByLayout(lump, 'item', group)).toBe(lump);
    expect(sectionsByLayout(lump, 'category', group)).toBe(lump);
  });
});
