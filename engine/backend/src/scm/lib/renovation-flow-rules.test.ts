import { describe, it, expect } from 'vitest';
import {
  ADDRESS_FIT_ON_SAVE, SOFA_MIX_RULE_ON, brandingFromLineBrands, buildingTypeFromProperty, customerGoodsCodes,
  deliveredOnTimestamp, doBrandingFromLines, isCustomerGoods, poMissingAxesForSoLine, renovationDoSiteFields, soLineRemarkOf,
} from './renovation-flow-rules';
import { createMixRefusal, lineMixRefusal, amendmentMixRefusal } from './main-mix';
import { fitAddressIfTouched } from './so-address-on-save';
import { fakeSb } from './fake-postgrest';

/* Conts switches found by the live run on project 99 "TESTING" (TC-SO-2610-002, 24 Oct 2026). */

describe('sofa, bedframe and mattress share a renovation SO', () => {
  it('the Houzs rule is off for Conts', () => {
    expect(SOFA_MIX_RULE_ON).toBe(false);
  });
  it('create, add-line and VO all let a sofa sit beside a bedframe', async () => {
    const sb = fakeSb({ mfg_products: [], mfg_sales_order_items: [] });
    expect(await createMixRefusal(sb, [{ itemCode: 'SOFA-A', itemGroup: 'SOFA' }, { itemCode: 'BED-A', itemGroup: 'BEDFRAME' }], 1)).toBeNull();
    expect(await lineMixRefusal(sb, 'mfg_sales_order_items', 'SO-1', null, 'SOFA-A', 1)).toBeNull();
    expect(await amendmentMixRefusal(sb, 'SO-1', [{ changeType: 'ADD', newItemCode: 'SOFA-A' }], 1)).toBeNull();
  });
});

describe('SO line remarks', () => {
  it('a remark sent as the line field is kept (desktop New SO)', () => {
    expect(soLineRemarkOf({ remark: '  Install on the left wall ', variants: {} })).toBe('Install on the left wall');
  });
  it('the POS remark inside variants still wins, and blanks are nothing', () => {
    expect(soLineRemarkOf({ remark: 'b', variants: { remark: 'a' } })).toBe('a');
    expect(soLineRemarkOf({ remark: '   ', variants: { remark: '' } })).toBeNull();
    expect(soLineRemarkOf({})).toBeNull();
  });
});

describe('customer-supplied goods hold no stock', () => {
  it('supplier CUSTOMER, or a CUS-* SKU with no supplier', () => {
    expect(isCustomerGoods('CUS-SOFA', null)).toBe(true);
    expect(isCustomerGoods('ANY-1', 'CUSTOMER')).toBe(true);
    expect(isCustomerGoods('CUS-TV', 'LOTWIN')).toBe(false);
    expect(isCustomerGoods('BED-HKA-1003-(Q)', 'HOOKKA')).toBe(false);
  });
  it('reads the main supplier of each code', async () => {
    const sb = fakeSb({
      suppliers: [{ id: 's-c', code: 'CUSTOMER' }, { id: 's-h', code: 'HOOKKA' }],
      supplier_material_bindings: [
        { item_code: 'CUS-SOFA', supplier_id: 's-c', is_main_supplier: true, company_id: 1 },
        { item_code: 'BED-HKA-1003-(Q)', supplier_id: 's-h', is_main_supplier: true, company_id: 1 },
        { item_code: 'CUS-TV', supplier_id: 's-h', is_main_supplier: true, company_id: 1 },
      ],
    });
    const got = await customerGoodsCodes(sb, ['CUS-SOFA', 'BED-HKA-1003-(Q)', 'CUS-TV', 'CUS-DINING'], 1);
    expect([...got].sort()).toEqual(['CUS-DINING', 'CUS-SOFA']);
  });
  it('a failed read checks stock as usual', async () => {
    const sb = fakeSb({ suppliers: [], supplier_material_bindings: [] }, { supplier_material_bindings: ['is_main_supplier'] });
    expect((await customerGoodsCodes(sb, ['CUS-SOFA'], 1)).size).toBe(0);
  });
});

describe('a PO line asks only for the options its SO line has', () => {
  const missing = [{ key: 'fabricCode', label: 'Fabric' }, { key: 'divanHeight', label: 'Divan Height' }, { key: 'legHeight', label: 'Leg Height' }];
  it('an SO line with no options asks for none', () => {
    expect(poMissingAxesForSoLine(missing, {})).toEqual([]);
    expect(poMissingAxesForSoLine(missing, null)).toEqual([]);
  });
  it('an option the SO line has is still required', () => {
    expect(poMissingAxesForSoLine(missing, { divanHeight: '4"' }).map((a) => a.key)).toEqual(['divanHeight']);
  });
  it('a PO line not from an SO keeps the full rule', () => {
    expect(poMissingAxesForSoLine(missing, undefined)).toHaveLength(3);
  });
});

describe('a renovation DO takes its site from the SO property and its brand from its lines', () => {
  it('condo is high-rise with a lift; a house is landed; unknown is not guessed', () => {
    expect(buildingTypeFromProperty('Condo')).toBe('High-rise (lift)');
    expect(buildingTypeFromProperty('Double storey terrace')).toBe('Landed');
    expect(buildingTypeFromProperty('Office')).toBeNull();
    expect(buildingTypeFromProperty(null)).toBeNull();
  });
  it('venue is building and unit, never the header leftover', () => {
    const head = { venue: 'sda', building_type: null, building: 'TESTING', unit_no: 'T-01-01', property_type: 'Condo', project_id: 99 };
    expect(renovationDoSiteFields(head)).toEqual({ venue: 'TESTING T-01-01', buildingType: 'High-rise (lift)' });
  });
  it('a Houzs SO (no property block) is left alone', () => {
    expect(renovationDoSiteFields({ venue: 'IOI Mall', building_type: 'Landed' })).toEqual({});
  });
  it('brand is the distinct line brands', () => {
    expect(brandingFromLineBrands(['HOOKKA', 'hookka', null, ''])).toBe('HOOKKA');
    expect(brandingFromLineBrands(['AKEMI', 'HOOKKA'])).toBe('AKEMI / HOOKKA');
    expect(brandingFromLineBrands([null])).toBeNull();
  });
});

describe('office Mark delivered date', () => {
  const now = '2026-10-24T05:00:00.000Z'; // 13:00 in Malaysia
  it('no date or today keeps the moment', () => {
    expect(deliveredOnTimestamp(undefined, now)).toBeNull();
    expect(deliveredOnTimestamp('2026-10-24', now)).toBeNull();
  });
  it('a past day is stamped at noon that day', () => {
    expect(deliveredOnTimestamp('2026-10-22', now)).toBe('2026-10-22T04:00:00.000Z');
  });
  it('a future or malformed day is refused', () => {
    expect(deliveredOnTimestamp('2026-10-25', now)).toBe('invalid');
    expect(deliveredOnTimestamp('2026-02-30', now)).toBe('invalid');
    expect(deliveredOnTimestamp('24/10/2026', now)).toBe('invalid');
  });
});

describe('an SO address is stored as typed', () => {
  it('a 43-character line 2 is not re-flowed into line 1', async () => {
    expect(ADDRESS_FIT_ON_SAVE).toBe(false);
    const updates: Record<string, unknown> = { address1: 'TESTING T-01-01, Jalan Testing', address2: 'TESTING - test project, not a real customer' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the helper only reads the context when it fits
    await fitAddressIfTouched(fakeSb({ mfg_sales_orders: [] }), {} as any, 'SO-1', updates);
    expect(updates).toEqual({ address1: 'TESTING T-01-01, Jalan Testing', address2: 'TESTING - test project, not a real customer' });
  });
});

describe('a new DO takes its branding from its lines, not the SO header (TESTING, TC-SO-2610-002)', () => {
  /* The lines and SKUs of TC-SO-2610-002 as production holds them; the SO header says AKEMI. */
  const sb = () => fakeSb({
    mfg_sales_order_items: [
      { id: 'pillow', branding: 'HOOKKA INDUSTRIES SDN BHD' },
      { id: 'bed-q', branding: 'HOOKKA INDUSTRIES SDN BHD' },
      { id: 'matt-q', branding: 'AKEMI' },
      { id: 'track', branding: null },
    ],
    mfg_products: [
      { code: 'ACC-HKA-LONGPILLOW', company_id: 1, branding: 'HOOKKA INDUSTRIES SDN BHD' },
      { code: 'BED-HKA-1003-(Q)', company_id: 1, branding: 'HOOKKA INDUSTRIES SDN BHD' },
      { code: 'AKEMI APEX MATT (Q)', company_id: 1, branding: 'AKEMI' },
      { code: 'TRK-LTW-IMI-TR16-12W-WH-4K', company_id: 1, branding: 'LOT WIN LED LIGHTINGS (PUCHONG) SDN BHD' },
    ],
  });
  it('the Hookka bed DO (like TC-DO-2610-002) reads Hookka, not AKEMI', async () => {
    expect(await doBrandingFromLines(sb(), [
      { itemCode: 'ACC-HKA-LONGPILLOW', soItemId: 'pillow' }, { itemCode: 'BED-HKA-1003-(Q)', soItemId: 'bed-q' },
    ], 1)).toBe('HOOKKA INDUSTRIES SDN BHD');
  });
  it('a line with no brand of its own takes the SKU brand; mixed lines list both', async () => {
    expect(await doBrandingFromLines(sb(), [{ itemCode: 'TRK-LTW-IMI-TR16-12W-WH-4K', soItemId: 'track' }], 1))
      .toBe('LOT WIN LED LIGHTINGS (PUCHONG) SDN BHD');
    expect(await doBrandingFromLines(sb(), [
      { itemCode: 'AKEMI APEX MATT (Q)', soItemId: 'matt-q' }, { itemCode: 'BED-HKA-1003-(Q)', soItemId: 'bed-q' },
    ], 1)).toBe('AKEMI / HOOKKA INDUSTRIES SDN BHD');
  });
});
