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
  it('Works and Built-in of one SO never share a PO', () => {
    const a = groupKeyFor(line({ categoryGroup: 'WORKS', unitBound: true }), 'combined');
    expect(groupKeyFor(line({ categoryGroup: 'BUILTIN', unitBound: true }), 'combined')).not.toBe(a);
  });
  it('other goods keep bulk purchase across SOs', () => {
    const a = groupKeyFor(line({ soDocNo: 'SO-1', categoryGroup: 'FURNITURE' }), 'combined');
    expect(groupKeyFor(line({ soDocNo: 'SO-2', categoryGroup: 'FURNITURE' }), 'combined')).toBe(a);
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
    ],
    mfg_sales_orders: [{ doc_no: 'SO-P', project_id: 9 }, { doc_no: 'SO-X', project_id: null }],
  });
  it('names the category only for a project order, and Works as unit bound', async () => {
    const f = await loadPoGroupFacts(sb(), 1, ['W1', 'F1'], ['SO-P', 'SO-X']);
    expect(f.categoryGroupOf('F1', 'SO-P')).toBe('FURNITURE');
    expect(f.categoryGroupOf('F1', 'SO-X')).toBeNull();
    expect(f.unitBound('W1')).toBe(true);
    expect(f.unitBound('F1')).toBe(false);
  });
});
