import { describe, expect, test } from 'vitest';
import type { DocLine, DocSection } from '../../lib/renovation/api';
import { blockFromQuote, partyFromBlock, sectionsFromForm, seedQuoteForm } from './renovationQuotationForm';

const line = (p: Partial<DocLine> = {}): DocLine => ({
  kind: 'ITEM', room: '', itemCode: 'RN-DESIGN', description: 'Design fee', qty: 2, measure: null, measureUom: null, uom: 'UNIT', unitPriceSen: 10000, listPriceSen: 12000,
  discountBp: 1000, amountOverrideSen: null, isFoc: false, supplyByOwner: false, highlight: 'PINK', supplierId: 'sup-1', unitCostSen: 500, stageCode: 'hardware', pageBreakBefore: true, ...p,
});
const section = (heading: string, lines: DocLine[], p: Partial<DocSection> = {}): DocSection => ({ heading, bandColor: '#123', lumpSumSen: null, pageBreakBefore: false, lines, ...p });

const seedOf = (sections: DocSection[]) => {
  let n = 0;
  return seedQuoteForm(sections, () => `r${n += 1}`);
};
const saved = (s: ReturnType<typeof seedOf>) => sectionsFromForm(s.rooms, s.lines, s.lineRoom, s.sources);

describe('a saved quotation on the sales order form', () => {
  test('opening and saving changes nothing the row does not show', () => {
    const sections = [
      section('LIVING', [line(), line({ kind: 'TEXT', itemCode: null, description: 'Notes for the customer', qty: 0, unitPriceSen: 0, discountBp: 0 })], { lumpSumSen: 99900 }),
      section('', [line({ amountOverrideSen: 15000, discountBp: 0 })]),
    ];
    const out = saved(seedOf(sections));
    expect(out).toEqual([
      { ...sections[0], lines: sections[0].lines.map((l) => ({ ...l, room: 'LIVING' })) },
      { ...sections[1], lines: sections[1].lines.map((l) => ({ ...l, room: '' })) },
    ]);
  });

  test('repeated headings stay two sections with their own lump sums', () => {
    const s = seedOf([section('ADD ON :', [line()], { lumpSumSen: 100 }), section('ADD ON :', [line({ itemCode: 'RN-X' })], { lumpSumSen: 200 })]);
    expect(s.rooms).toEqual(['ADD ON :', 'ADD ON : (2)']);
    const out = saved(s);
    expect(out.map((x) => [x.heading, x.lumpSumSen, x.lines[0].itemCode])).toEqual([['ADD ON :', 100, 'RN-DESIGN'], ['ADD ON :', 200, 'RN-X']]);
  });

  test('changed money drops the old override and works the discount out again', () => {
    const s = seedOf([section('A', [line({ amountOverrideSen: 15000, discountBp: 0 })])]);
    expect(s.lines[0].discountSen).toBe(5000);
    const out = sectionsFromForm(s.rooms, [{ ...s.lines[0], qty: 3 }], s.lineRoom, s.sources);
    expect(out[0].lines[0]).toMatchObject({ qty: 3, amountOverrideSen: null, discountBp: 1667, highlight: 'PINK', supplierId: 'sup-1' });
  });

  test('a row with no product and nothing saved behind it is left out', () => {
    const s = seedOf([section('A', [line()])]);
    const blank = { rid: 'new', itemCode: '', description: '', uom: 'UNIT', qty: 1, unitPriceSen: 0, discountSen: 0, unitCostSen: 0, remark: '' };
    expect(sectionsFromForm(s.rooms, [...s.lines, blank], { ...s.lineRoom, new: 'A' }, s.sources)[0].lines).toHaveLength(1);
  });

  test('the site address and property come back as they went in', () => {
    const b = blockFromQuote({ customerName: 'A', siteAddress: 'Line 1\nLine 2\nLine 3', building: 'B', unitNo: 'U', bedrooms: 3, builtUpSqft: 1100 } as never, 5);
    expect(b).toMatchObject({ projectId: 5, address1: 'Line 1', address2: 'Line 2\nLine 3', bedrooms: '3', builtUpSqft: '1100' });
    expect(partyFromBlock(b).siteAddress).toBe('Line 1\nLine 2\nLine 3');
  });
});
