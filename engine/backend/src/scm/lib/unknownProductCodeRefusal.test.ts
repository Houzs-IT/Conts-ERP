// Owner decision C6 (Conts, 11 Oct 2026): item codes on documents must exist in
// Products. unknownProductCodeRefusal is the one gate the purchase side (PO,
// GRN, purchase return) and the line-copying conversions call.
import { describe, expect, it } from 'vitest';
import { fakeSb } from './fake-postgrest';
import { unknownProductCodeRefusal } from './validate-item-codes';

const sb = () => fakeSb({
  mfg_products: [
    { code: 'SOFA-3S', company_id: 1, status: 'ACTIVE' },
    { code: 'OLD-1', company_id: 1, status: 'INACTIVE' },
    { code: 'OTHER-CO', company_id: 2, status: 'ACTIVE' },
  ],
});

describe('unknownProductCodeRefusal (C6)', () => {
  it('passes catalogued codes, discontinued ones included (existence, not activity)', async () => {
    expect(await unknownProductCodeRefusal(sb(), [{ code: 'SOFA-3S' }, { code: 'OLD-1', kind: 'mfg_product' }], 1)).toBeNull();
  });

  it('refuses an unknown code with a message naming it', async () => {
    const r = await unknownProductCodeRefusal(sb(), [{ code: 'SOFA-3S' }, { code: 'TYPO-9' }], 1);
    expect(r?.error).toBe('unknown_item_code');
    expect(r?.unknown).toEqual(['TYPO-9']);
    expect(r?.message).toContain('TYPO-9');
    expect(r?.message).toContain('not in the product catalog');
  });

  it("refuses another company's product", async () => {
    expect((await unknownProductCodeRefusal(sb(), [{ code: 'OTHER-CO' }], 1))?.unknown).toEqual(['OTHER-CO']);
  });

  it('leaves fabric and raw-material purchase lines, and blank codes, alone', async () => {
    expect(await unknownProductCodeRefusal(sb(), [
      { code: 'FAB-COVE-13', kind: 'fabric' }, { code: 'GLUE', kind: 'raw' }, { code: '' }, { code: null },
    ], 1)).toBeNull();
  });
});
