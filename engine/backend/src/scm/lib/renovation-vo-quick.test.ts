import { describe, expect, it } from 'vitest';
import { carryToAddedLine, quickVoLines } from './renovation-vo';
import type { RenoDb } from './renovation-db';
import type { DocLineOut } from './renovation-doc-lines';

const t = {
  id: 'L1', parentId: null, kind: 'ITEM', sortOrder: 1, room: 'Living', itemCode: 'SOF-1', description: 'Sofa', qty: 2, measureMilli: null,
  measureUom: null, uom: 'UNIT', unitPriceSen: 100000, listPriceSen: null, discountBp: 0, amountOverrideSen: null, isFoc: false, supplyByOwner: false,
  highlight: 'NONE', supplierId: 'S1', unitCostSen: 50000, stageCode: null, pageBreakBefore: false, voChange: null, omitTargetLineId: null, omitQty: null,
  measure: null, baseSen: 200000, netSen: 200000, overridden: false, soItemId: 'I1', voId: null, omittedByVoId: null,
} as DocLineOut;
const prod = { name: 'Sofa 2', costSen: 60000, supplierId: 'S2', uom: 'UNIT' };

describe('quickVoLines', () => {
  it('nothing changed: no VO lines', () => {
    expect(quickVoLines(t, { soItemId: 'I1', qty: 2 }, false, null)).toBeNull();
  });
  it('fewer of the same: omits the difference only', () => {
    const r = quickVoLines(t, { soItemId: 'I1', qty: 1 }, true, null)!;
    expect(r.add).toBeNull();
    expect(r.omit).toMatchObject({ voChange: 'OMIT', omitTargetLineId: 'L1', omitQty: 1 });
  });
  it('more of the same on a line a PO buys: adds the difference, keeps the line', () => {
    const r = quickVoLines(t, { soItemId: 'I1', qty: 5 }, true, null)!;
    expect(r.omit).toBeNull();
    expect(r.add).toMatchObject({ voChange: 'ADD', itemCode: 'SOF-1', qty: 3, room: 'Living', unitPriceSen: 100000 });
  });
  it('more of the same with no PO: replaces the line at the new qty', () => {
    const r = quickVoLines(t, { soItemId: 'I1', qty: 5 }, false, null)!;
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ qty: 5, itemCode: 'SOF-1' });
  });
  it('another SKU: omits whole, adds the new product at the old price', () => {
    const r = quickVoLines(t, { soItemId: 'I1', itemCode: 'SOF-2' }, false, prod)!;
    expect(r.sameSku).toBe(false);
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ itemCode: 'SOF-2', description: 'Sofa 2', qty: 2, unitPriceSen: 100000, supplierId: 'S2', unitCostSen: 60000 });
  });
  it('another price: replaces the line', () => {
    const r = quickVoLines(t, { soItemId: 'I1', unitPriceSen: 120000 }, true, null)!;
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ qty: 2, unitPriceSen: 120000 });
  });
  it('a measured line is replaced whole, never partly omitted', () => {
    const r = quickVoLines({ ...t, measureMilli: 5000 }, { soItemId: 'I1', qty: 1 }, false, null)!;
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ qty: 1, measureMilli: 5000 });
  });
  it('same SKU with new options (a PO line re-specified): omits whole, adds it again at the same qty and price', () => {
    const r = quickVoLines(t, { soItemId: 'I1', variants: { fabricCode: 'Client fabric 7' } }, true, null)!;
    expect(r.sameSku).toBe(true);
    expect(r.omit).toMatchObject({ voChange: 'OMIT', omitTargetLineId: 'L1', omitQty: null });
    expect(r.add).toMatchObject({ voChange: 'ADD', itemCode: 'SOF-1', qty: 2, unitPriceSen: 100000, room: 'Living', supplierId: 'S1' });
  });
  it('same SKU, new options and fewer: still one whole replacement at the new qty, never a partial omit', () => {
    const r = quickVoLines(t, { soItemId: 'I1', qty: 1, variants: { fabricCode: 'X' } }, true, null)!;
    expect(r.omit).toMatchObject({ omitQty: null });
    expect(r.add).toMatchObject({ qty: 1 });
  });
});

/** Records every statement, answers none. */
function recordingDb(): RenoDb & { calls: Array<{ text: string; params: readonly unknown[] }> } {
  const calls: Array<{ text: string; params: readonly unknown[] }> = [];
  return { calls, q: async (text: string, params: readonly unknown[] = []) => { calls.push({ text, params }); return []; } } as never;
}

describe('carryToAddedLine (quickVo, the line a VO adds)', () => {
  const base = { lineId: 'V1', fromSoItemId: 'OLD', sameSku: true, itemCode: 'BED-1' };
  it('same SKU with new options: the new line takes the options given, not the old line options', async () => {
    const db = recordingDb();
    await carryToAddedLine(db, { ...base, respec: true, variants: { fabricCode: 'PC1461-03', colourId: 'PC1461-03', fabricId: 'PC1461', divanHeight: '6"', legHeight: '1"', gap: '4"', totalHeight: '11"', remark: 'x' } }, 'NEW', 'bedframe');
    const [upd, room, plan] = db.calls;
    expect(db.calls).toHaveLength(3);
    expect(room.text).toMatch(/set room = coalesce/);
    expect(room.params).toEqual(['NEW', 'OLD']);
    expect(upd.text).toMatch(/set variants = \$2::text::jsonb, description2 = \$3/);
    expect(upd.text).not.toMatch(/variants = o\.variants/);
    expect(JSON.parse(String(upd.params[1]))).toEqual({ fabricCode: 'PC1461-03', colourId: 'PC1461-03', fabricId: 'PC1461', divanHeight: '6"', legHeight: '1"', gap: '4"', totalHeight: '11"' });
    expect(upd.params[2]).toBe('PC1461-03 / DIVAN 6" + LEG 1" / GAP 4" / T.Heights 11"');
    expect(upd.params[3]).toBeNull();
    expect(upd.params[4]).toBe('OLD');
    expect(plan.text).toMatch(/reno_beta_line_plans/);
  });
  it('same SKU with new options and a remark: the remark given is written', async () => {
    const db = recordingDb();
    await carryToAddedLine(db, { ...base, respec: true, variants: { seatHeight: '28' }, remark: ' Fit by 5 Nov ' }, 'NEW', 'sofa');
    expect(db.calls[0].params[2]).toBe('SEAT 28');
    expect(db.calls[0].params[3]).toBe('Fit by 5 Nov');
  });
  it('same SKU, no new options: copies the old line as before', async () => {
    const db = recordingDb();
    await carryToAddedLine(db, { ...base, respec: false }, 'NEW', 'bedframe');
    expect(db.calls.map((c) => c.text).join('\n')).toMatch(/variants = o\.variants/);
    expect(db.calls.map((c) => c.text).join('\n')).toMatch(/set room = coalesce/);
  });
});
