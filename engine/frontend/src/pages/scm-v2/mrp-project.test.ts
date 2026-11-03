import { describe, expect, it } from 'vitest';
import { groupDistinct, mrpProjectLabel, type ModelGroup } from './mrp-model-pipeline';
import type { MrpLine } from '../../vendor/scm/lib/mrp-queries';

const line = (o: Partial<MrpLine>): MrpLine => ({
  soItemId: 'i', soDocNo: 'TC-SO-2611-001', debtorName: null, customerState: null, soDate: null, deliveryDate: null,
  processingDate: null, orderByDate: null, qty: 1, source: 'shortage', poNumber: null, poEta: null, shortageQty: 1,
  poSupplierId: null, poSupplierName: null, ...o,
});

describe('MRP project and customer (owner, 3 Nov 2026)', () => {
  it('names the project by code and name, and leaves an order with no project blank', () => {
    expect(mrpProjectLabel(line({ projectCode: 'RN-2611-001', projectName: 'TESTING T-02-01' }))).toBe('RN-2611-001 · TESTING T-02-01');
    expect(mrpProjectLabel(line({ projectCode: 'RN-2611-001', projectName: null }))).toBe('RN-2611-001');
    expect(mrpProjectLabel(line({}))).toBe('');
  });
  it('lists each project and customer of a row once, first seen first', () => {
    const g = { variants: [
      { lines: [line({ projectCode: 'RN-1', debtorName: 'Ali' }), line({ projectCode: 'RN-2', debtorName: 'Ali' })] },
      { lines: [line({ projectCode: 'RN-1', debtorName: 'Bob' }), line({})] },
    ] } as unknown as ModelGroup;
    expect(groupDistinct(g, mrpProjectLabel)).toEqual(['RN-1', 'RN-2']);
    expect(groupDistinct(g, (l) => l.debtorName ?? '')).toEqual(['Ali', 'Bob']);
  });
});
