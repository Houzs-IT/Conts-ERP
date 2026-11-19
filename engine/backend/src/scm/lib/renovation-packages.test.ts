import { describe, expect, it } from 'vitest';
import { areaCount, describeChange, normalisePackageHeader, slaSet, stripPrices, suggestCode, totalAtSkuPrices, type SkuRef } from './renovation-packages';
import type { DocSectionOut } from './renovation-doc-lines';
import type { NormSection } from './renovation-validate';

const line = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), parentId: null, kind: 'ITEM', sortOrder: 1, room: '', itemCode: 'SOF-1', description: 'Sofa', qty: 1, measureMilli: null,
  measure: null, measureUom: null, uom: 'UNIT', unitPriceSen: 150000, listPriceSen: 160000, discountBp: 500, amountOverrideSen: null, isFoc: false,
  supplyByOwner: false, highlight: 'NONE', supplierId: '00000000-0000-0000-0000-000000000001', unitCostSen: 90000, stageCode: null,
  processingAfterDays: null, deliveryAfterDays: null, fromPackageId: null, pageBreakBefore: false, voChange: null, omitTargetLineId: null, omitQty: null,
  soItemId: null, voId: null, omittedByVoId: null, baseSen: 0, netSen: 0, overridden: false, ...over,
});
const section = (heading: string, lines: ReturnType<typeof line>[]) => ({
  id: crypto.randomUUID(), heading, bandColor: null, sortOrder: 1, lumpSumSen: null, pageBreakBefore: false, soItemId: null, voId: null, lines,
}) as unknown as DocSectionOut;
const ref = (sellSen: number): SkuRef => ({ name: 'x', sellSen, costSen: 1, supplierId: null, uom: null, active: true });

describe('suggestCode', () => {
  it('starts at 001 and follows the highest number of the same kind', () => {
    expect(suggestCode('PACKAGE', [])).toBe('PKG-001');
    expect(suggestCode('PACKAGE', ['PKG-001', 'PKG-007', 'PKG-SKY-A', 'KIT-020'])).toBe('PKG-008');
    expect(suggestCode('KIT', ['PKG-001', 'kit-004'])).toBe('KIT-005');
  });
});

describe('normalisePackageHeader', () => {
  it('a new package needs a name; kind and status default to Package and Draft', () => {
    expect(normalisePackageHeader({}, false).ok).toBe(false);
    const r = normalisePackageHeader({ name: ' Studio set ', code: 'pkg-st 1' }, false);
    expect(r.ok).toBe(false);
    const ok = normalisePackageHeader({ name: ' Studio set ', code: 'pkg-st-1' }, false);
    expect(ok).toEqual({ ok: true, value: { kind: 'PACKAGE', status: 'DRAFT', code: 'PKG-ST-1', name: 'Studio set' } });
  });
  it('a partial save checks only what it sends', () => {
    expect(normalisePackageHeader({ status: 'ACTIVE' }, true)).toEqual({ ok: true, value: { status: 'ACTIVE' } });
    expect(normalisePackageHeader({ status: 'LIVE' }, true).ok).toBe(false);
    expect(normalisePackageHeader({ kind: 'BUNDLE' }, true).ok).toBe(false);
  });
});

describe('stripPrices', () => {
  it('keeps products, quantities and SLA days, drops every price, cost and supplier', () => {
    const s = [{ ...section('Living', [line({ qty: 2, processingAfterDays: 7, deliveryAfterDays: 30, fromPackageId: 'abc' })]), lumpSumSen: 5000 }] as unknown as NormSection[];
    const [out] = stripPrices(s);
    expect(out.lumpSumSen).toBeNull();
    expect(out.lines[0]).toMatchObject({ itemCode: 'SOF-1', qty: 2, processingAfterDays: 7, deliveryAfterDays: 30, unitPriceSen: 0, listPriceSen: null, discountBp: 0, unitCostSen: 0, supplierId: null, fromPackageId: null });
  });
});

describe('totals, SLA and areas', () => {
  const ss = [section('Living room', [line({ qty: 2 }), line({ kind: 'TEXT', itemCode: null })]), section('', [line({ itemCode: 'BED-1', processingAfterDays: 7 })]), section('Empty', [])];
  it('prices each product at today\'s SKU price, ignoring the line\'s own price', () => {
    expect(totalAtSkuPrices(ss, new Map([['SOF-1', ref(100000)], ['BED-1', ref(50000)]]))).toBe(250000);
    expect(totalAtSkuPrices(ss, new Map())).toBe(0);
  });
  it('SLA is set only when every product line has a day', () => {
    expect(slaSet(ss)).toBe(false);
    expect(slaSet([section('A', [line({ deliveryAfterDays: 3 })])])).toBe(true);
    expect(slaSet([])).toBe(false);
  });
  it('areas are headed sections with lines', () => {
    expect(areaCount(ss)).toBe(1);
  });
});

describe('describeChange', () => {
  const before = { kind: 'PACKAGE' as const, code: 'PKG-001', name: 'A', building: '', unitType: '', salesNote: '', status: 'DRAFT' as const, lines: [{ code: 'SOF-1', qty: 1 }] };
  it('names the fields and lines that changed', () => {
    expect(describeChange(before, { status: 'ACTIVE', building: 'Skyline', lines: [{ code: 'SOF-1', qty: 2 }, { code: 'BED-1', qty: 1 }] }))
      .toBe('Building (blank) to Skyline; Status Draft to Active; Added BED-1; Qty changed on SOF-1 1 to 2');
    expect(describeChange(before, {})).toBe('Saved, nothing changed');
  });
});
