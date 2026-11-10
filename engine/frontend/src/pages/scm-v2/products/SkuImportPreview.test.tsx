import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeSkuChange, planSummary, SkuImportPreview } from './SkuImportPreview';

describe('the Import SKUs preview', () => {
  it('says each change as old → new, prices in RM', () => {
    expect(describeSkuChange({ field: 'base_price_sen', from: 10000, to: 12550 })).toBe('Base price: RM 100.00 → RM 125.50');
    expect(describeSkuChange({ field: 'uom', from: 'LOT', to: 'SQFT' })).toBe('Unit: LOT → SQFT');
    expect(describeSkuChange({ field: 'description', from: null, to: '柜子' })).toBe('Description: (blank) → 柜子');
    expect(describeSkuChange({ field: 'status', from: 'ACTIVE', to: 'INACTIVE' })).toBe('Status: Active → Inactive');
  });

  it('counts new, changed and unchanged rows', () => {
    expect(planSummary({ new: 1, changed: 2, unchanged: 40 })).toBe('1 new · 2 changed · 40 unchanged');
  });

  it('lists changed and new rows and the rows that will be skipped', () => {
    const html = renderToStaticMarkup(
      <SkuImportPreview
        skipped={[{ code: 'BAD', reason: 'price could not be read' }]}
        plan={{
          dryRun: true,
          counts: { new: 1, changed: 1, unchanged: 3 },
          plan: [
            { code: 'HK-1', name: 'Hacking', status: 'changed', changes: [{ field: 'base_price_sen', from: 100, to: 200 }] },
            { code: 'EL-9', name: 'Lighting', status: 'new', changes: [] },
          ],
          failed: 0,
          failures: [],
        }}
      />,
    );
    expect(html).toContain('1 new · 1 changed · 3 unchanged');
    expect(html).toContain('Base price: RM 1.00 → RM 2.00');
    expect(html).toContain('EL-9');
    expect(html).toContain('BAD: price could not be read');
    expect(html).toContain('1 will be skipped');
  });
});
