import { describe, expect, it } from 'vitest';
import { groupKeyFor, loadPoGroupFacts, type GroupKeyInput } from './po-grouping';
import { fakeSb } from './fake-postgrest';

const line = (over: Partial<GroupKeyInput>): GroupKeyInput => ({ warehouseId: 'W', supplierId: 'INHOUSE', soDocNo: 'SO-1', ...over });

describe('Combined never puts two customers on a Works or Built-in PO', () => {
  it('Works of two SOs split, even in Combined', () => {
    const a = groupKeyFor(line({ soDocNo: 'SO-1', categoryGroup: 'WORKS', unitBound: true }), 'combined');
    const b = groupKeyFor(line({ soDocNo: 'SO-2', categoryGroup: 'WORKS', unitBound: true }), 'combined');
    expect(a).not.toBe(b);
  });
  it('one SO keeps its Works on one PO', () => {
    const a = groupKeyFor(line({ categoryGroup: 'WORKS', unitBound: true }), 'combined');
    expect(groupKeyFor(line({ categoryGroup: 'WORKS', unitBound: true }), 'combined')).toBe(a);
  });
  it('Works and Built-in of one SO share a PO: a PO may mix categories (owner, 19 Nov 2026)', () => {
    const a = groupKeyFor(line({ categoryGroup: 'WORKS', unitBound: true }), 'combined');
    expect(groupKeyFor(line({ categoryGroup: 'BUILTIN', unitBound: true }), 'combined')).toBe(a);
  });
  it('a project line of another category joins the same supplier PO', () => {
    const a = groupKeyFor(line({ supplierId: 'S', categoryGroup: 'SOFT' }), 'combined');
    expect(groupKeyFor(line({ supplierId: 'S', categoryGroup: 'BUILTIN' }), 'combined')).toBe(a);
  });
  it('other goods keep bulk purchase across SOs', () => {
    const a = groupKeyFor(line({ soDocNo: 'SO-1', categoryGroup: 'FURNITURE' }), 'combined');
    expect(groupKeyFor(line({ soDocNo: 'SO-2', categoryGroup: 'FURNITURE' }), 'combined')).toBe(a);
  });
  it('services of two SOs to one contractor share a PO in Combined, apart from goods (owner, 28 Nov 2026)', () => {
    const a = groupKeyFor(line({ supplierId: 'S', soDocNo: 'SO-1', categoryGroup: 'SERVICE' }), 'combined');
    expect(groupKeyFor(line({ supplierId: 'S', soDocNo: 'SO-2', categoryGroup: 'SERVICE' }), 'combined')).toBe(a);
    expect(groupKeyFor(line({ supplierId: 'S', soDocNo: 'SO-1', categoryGroup: 'SOFT' }), 'combined')).not.toBe(a);
  });
  it('a line of no project groups exactly as before', () => {
    expect(groupKeyFor(line({}), 'combined')).toBe('W::INHOUSE');
    expect(groupKeyFor(line({}), 'per-so')).toBe('W::INHOUSE::so:SO-1');
  });
});

describe('loadPoGroupFacts', () => {
  const sb = () => fakeSb({
    mfg_products: [
      { id: 1, code: 'W1', category: 'WORKS', category_group: 'WORKS', company_id: 1 },
      { id: 2, code: 'F1', category: 'SOFA', category_group: 'FURNITURE', company_id: 1 },
      { id: 3, code: 'S1', category: 'SERVICE', category_group: 'SERVICE', company_id: 1 },
    ],
    mfg_sales_orders: [{ doc_no: 'SO-P', project_id: 9 }, { doc_no: 'SO-X', project_id: null }],
  });
  it('names the category only for a project order, and Works as unit bound', async () => {
    const f = await loadPoGroupFacts(sb(), 1, ['W1', 'F1', 'S1'], ['SO-P', 'SO-X']);
    expect(f.categoryGroupOf('F1', 'SO-P')).toBe('FURNITURE');
    expect(f.categoryGroupOf('F1', 'SO-X')).toBeNull();
    expect(f.unitBound('W1')).toBe(true);
    expect(f.unitBound('F1')).toBe(false);
    expect(f.unitBound('S1')).toBe(false);
  });
});
