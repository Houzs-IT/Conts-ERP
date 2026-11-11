import { describe, expect, it } from 'vitest';
import { renovationTemplateColumns, savedSummary, skuTemplateSheets } from './skuImportTemplate';
import { normalizeImportHeader } from '../products-import-headers';

describe('the SKU import template', () => {
  it('the renovation sheet heads exactly the columns the importer reads, and nothing to import by mistake', () => {
    const cols = renovationTemplateColumns();
    const [skus, guide] = skuTemplateSheets(cols);
    const heads = (skus[0] as Array<{ value: string }>).map((c) => c.value);
    expect(heads).toEqual(['code', 'name', 'category', 'sub_category', 'uom', 'status']);
    expect(skus).toHaveLength(1);
    expect(heads.map(normalizeImportHeader)).toEqual(heads);
    expect(guide.length).toBeGreaterThan(cols.length);
  });

  it('says how many SKUs were new and how many were updated', () => {
    expect(savedSummary({ upserted: 5, created: 2 })).toBe('2 new SKUs · 3 SKUs updated');
    expect(savedSummary({ upserted: 1, created: 1 })).toBe('1 new SKU');
    expect(savedSummary({ upserted: 3 })).toBe('3 SKUs updated');
    expect(savedSummary({ upserted: 2, created: 0, unchanged: 7 })).toBe('2 SKUs updated · 7 unchanged');
  });
});
