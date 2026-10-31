import { describe, expect, it } from 'vitest';
import { mrpCategoryOf, mrpGroupViews, rowBelongsToView } from './mrp-views';

const groups = [
  { code: 'WORKS', label: 'Works' }, { code: 'FURNITURE', label: 'Furniture' },
  { code: 'SERVICE', label: 'Service' }, { code: 'RAW', label: 'Raw material' },
];

describe('MRP tabs from the product catalog (Conts)', () => {
  it('one tab per catalog group in order, no Service tab, then Others', () => {
    expect(mrpGroupViews(groups).map((v) => v.label)).toEqual(['Works', 'Furniture', 'Raw material', 'Others']);
  });
  it('a group tab asks the server for everything', () => {
    for (const v of mrpGroupViews(groups)) expect(mrpCategoryOf(v.value)).toBeNull();
  });
  it('rows land on the tab of their catalog group, an old Houzs category included', () => {
    const [works, furniture, raw, others] = mrpGroupViews(groups);
    expect(rowBelongsToView(works!, 'WORKS')).toBe(true);
    expect(rowBelongsToView(furniture!, 'FURNITURE')).toBe(true);
    expect(rowBelongsToView(furniture!, 'SOFA')).toBe(true);
    expect(rowBelongsToView(raw!, 'RAW')).toBe(true);
    expect(rowBelongsToView(works!, 'FURNITURE')).toBe(false);
    expect(rowBelongsToView(others!, 'NOPE')).toBe(true);
    expect(rowBelongsToView(others!, 'SERVICE')).toBe(false);
  });
});
