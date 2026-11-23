import { describe, expect, it } from 'vitest';
import type { DocLine, DocSection } from '../../lib/renovation/api';
import { addLine, EMPTY_EDITS, packageAdds, removeLine, roomsOf, setAddQty, setLinePrice, setLineQty, swapLine, totalsOf, undoLine } from './voRoomModel';

const line = (id: string, room: string, qty: number, priceSen: number, extra: Partial<DocLine> = {}): DocLine => ({
  id: `l-${id}`, soItemId: `so-${id}`, kind: 'ITEM', room, itemCode: id.toUpperCase(), description: `Item ${id}`, qty, measure: null, measureMilli: null,
  measureUom: null, uom: 'UNIT', unitPriceSen: priceSen, listPriceSen: null, discountBp: 0, amountOverrideSen: null, isFoc: false, supplyByOwner: false,
  highlight: 'NONE', supplierId: null, unitCostSen: 0, stageCode: null, pageBreakBefore: false, ...extra,
});

const sections: DocSection[] = [
  { heading: 'WORKS', bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: [line('fan', 'Common area', 3, 14500), line('socket', 'Common area', 2, 15000)] },
  { heading: 'BEDROOM 1', bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: [line('ward', '', 1, 400000), line('gone', 'Bedroom 1', 1, 100, { omittedByVoId: 'vo-0' })] },
  { heading: 'LUMP', bandColor: null, lumpSumSen: 50000, pageBreakBefore: false, lines: [line('lump', 'Store', 1, 100)] },
];
const L = (id: string): DocLine => sections.flatMap((s) => s.lines).find((l) => l.soItemId === `so-${id}`)!;

describe('VO room model', () => {
  it('groups live lines by room, falling back to the section heading, and skips omitted and lump-sum lines', () => {
    const rooms = roomsOf(sections, EMPTY_EDITS);
    expect(rooms.map((r) => [r.name, r.rows.length])).toEqual([['Common area', 2], ['BEDROOM 1', 1]]);
    expect(totalsOf(rooms).netSen).toBe(0);
  });

  it('qty up and down changes the line and the net', () => {
    let e = setLineQty(EMPTY_EDITS, L('fan'), 4);
    let row = roomsOf(sections, e)[0].rows[0];
    expect(row).toMatchObject({ kind: 'changed', qty: 4, oldQty: 3, deltaSen: 14500 });
    e = setLineQty(e, L('fan'), 3);
    expect(e.lines).toEqual([]);
    e = setLineQty(e, L('socket'), 1);
    row = roomsOf(sections, e)[0].rows[1];
    expect(row).toMatchObject({ kind: 'changed', deltaSen: -15000 });
  });

  it('qty to 0 removes, and undo brings the line back', () => {
    let e = setLineQty(EMPTY_EDITS, L('socket'), 0);
    expect(e.lines).toEqual([{ soItemId: 'so-socket', remove: true }]);
    expect(totalsOf(roomsOf(sections, e))).toMatchObject({ omitSen: -30000, removed: 1 });
    e = undoLine(e, 'so-socket');
    expect(e.lines).toEqual([]);
  });

  it('swap takes the new SKU and its price; swapping back clears the edit', () => {
    let e = swapLine(EMPTY_EDITS, L('ward'), { code: 'WARD-SLIDE', name: 'Sliding wardrobe', sellPriceSen: 460000 });
    const row = roomsOf(sections, e)[1].rows[0];
    expect(row).toMatchObject({ kind: 'changed', sku: 'WARD-SLIDE', oldSku: 'WARD', name: 'Sliding wardrobe', oldName: 'Item ward', deltaSen: 60000 });
    e = swapLine(e, L('ward'), { code: 'WARD', name: 'Item ward', sellPriceSen: 0 });
    expect(e.lines).toEqual([]);
  });

  it('price change keeps the qty', () => {
    const e = setLinePrice(EMPTY_EDITS, L('fan'), 16000);
    expect(e.lines).toEqual([{ soItemId: 'so-fan', unitPriceSen: 16000 }]);
    expect(roomsOf(sections, e)[0].rows[0].deltaSen).toBe(4500);
  });

  it('removing after a qty change keeps only the removal', () => {
    const e = removeLine(setLineQty(EMPTY_EDITS, L('fan'), 5), L('fan'));
    expect(e.lines).toEqual([{ soItemId: 'so-fan', remove: true }]);
  });

  it('adds a line in a room, a new room goes last, and qty 0 takes it out', () => {
    let e = addLine(EMPTY_EDITS, 'BEDROOM 1', { code: 'LED', name: 'LED strip', sellPriceSen: 12000 });
    e = addLine(e, 'Kitchen', { code: 'TAP', name: 'Tap', sellPriceSen: 5000 });
    e = setAddQty(e, 0, 2);
    const rooms = roomsOf(sections, e);
    expect(rooms.map((r) => r.name)).toEqual(['Common area', 'BEDROOM 1', 'Kitchen']);
    expect(rooms[1].rows[1]).toMatchObject({ kind: 'added', qty: 2, deltaSen: 24000 });
    expect(totalsOf(rooms)).toMatchObject({ addSen: 29000, added: 2 });
    expect(setAddQty(e, 1, 0).adds.map((a) => a.itemCode)).toEqual(['LED']);
  });

  it('an edit to a line another VO took out shows as a gone row that undo clears', () => {
    const e = { lines: [{ soItemId: 'so-gone', qty: 3, label: 'Old cabinet' }], adds: [] };
    const rooms = roomsOf(sections, e);
    expect(rooms[rooms.length - 1]).toMatchObject({ name: 'No longer on the contract', rows: [{ kind: 'gone', name: 'Old cabinet', deltaSen: 0 }] });
    expect(undoLine(e, 'so-gone').lines).toEqual([]);
  });

  it('a package skips free and discounted lines', () => {
    const pkg: DocSection[] = [{ heading: 'Kitchen', bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: [line('foc', '', 1, 100, { isFoc: true }), line('disc', '', 1, 100, { discountBp: 1000 })] }];
    expect(packageAdds(EMPTY_EDITS, pkg, 'p2', '', false)).toMatchObject({ skipped: 2, edits: { adds: [] } });
  });

  it('a package adds its SKU lines by area; lines with no SKU are counted as skipped; replace swaps them', () => {
    const pkg: DocSection[] = [{ heading: 'Kitchen', bandColor: null, lumpSumSen: null, pageBreakBefore: false, lines: [line('cab', '', 2, 10000), line('note', '', 1, 0, { itemCode: null })] }];
    let r = packageAdds(EMPTY_EDITS, pkg, 'p1', 'Common area', false);
    expect(r.skipped).toBe(1);
    expect(r.edits.adds).toEqual([{ room: 'Kitchen', itemCode: 'CAB', label: 'Item cab', qty: 2, unitPriceSen: 10000, fromPackageId: 'p1' }]);
    r = packageAdds(r.edits, [{ ...pkg[0], lines: [line('cab', '', 5, 10000)] }], 'p1', '', true);
    expect(r.edits.adds.map((a) => a.qty)).toEqual([5]);
  });
});
