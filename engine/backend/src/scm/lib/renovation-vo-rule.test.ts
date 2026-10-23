import { describe, expect, test } from 'vitest';
import { mergeLanesForVo, soVoLocked } from './renovation-vo-rule';
import { poPickerOffers } from './renovation-po-split';
import type { LaneSplit } from '../shared/amendment-lane';

const empty = () => ({ headerChanges: {}, headerKeys: [] as string[], lines: [] as string[] });

describe('soVoLocked', () => {
  test('a confirmed or later order changes only through a VO; a draft or cancelled one does not', () => {
    for (const s of ['CONFIRMED', 'confirmed', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED']) expect(soVoLocked({ status: s })).toBe(true);
    for (const s of ['DRAFT', 'CANCELLED', '', null]) expect(soVoLocked({ status: s })).toBe(false);
    expect(soVoLocked(null)).toBe(false);
  });
});

describe('mergeLanesForVo', () => {
  test('a mixed request becomes one VO in the LINES lane, header changes and lines together', () => {
    const split: LaneSplit<string> = {
      lanes: ['LINES', 'DELIVERY'],
      perLane: {
        LINES: { headerChanges: {}, headerKeys: [], lines: ['sofa'] },
        DELIVERY: { headerChanges: { customerDeliveryDate: '2026-11-01' }, headerKeys: ['customerDeliveryDate'], lines: ['SVC-DELIVERY'] },
        PRICE: empty(),
      },
    };
    const out = mergeLanesForVo(split);
    expect(out.lanes).toEqual(['LINES']);
    expect(out.perLane.LINES).toEqual({ headerChanges: { customerDeliveryDate: '2026-11-01' }, headerKeys: ['customerDeliveryDate'], lines: ['sofa', 'SVC-DELIVERY'] });
    expect(out.perLane.DELIVERY.lines).toEqual([]);
  });
  test('a single-lane request is left as it is', () => {
    const split: LaneSplit<string> = { lanes: ['DELIVERY'], perLane: { LINES: empty(), PRICE: empty(), DELIVERY: { headerChanges: { address1: 'x' }, headerKeys: ['address1'], lines: [] } } };
    expect(mergeLanesForVo(split)).toBe(split);
  });
});

describe('poPickerOffers', () => {
  test('never offers a customer-supplied line', () => {
    expect(poPickerOffers({ itemCode: 'CUS-TILE', itemGroup: 'builtin', mainSupplierCode: 'CUSTOMER' })).toBe(false);
    expect(poPickerOffers({ itemCode: 'CUS-TILE', itemGroup: 'builtin', mainSupplierCode: null })).toBe(false);
    expect(poPickerOffers({ itemCode: 'TILE-01', itemGroup: 'builtin', mainSupplierCode: 'CUSTOMER' })).toBe(false);
  });
  test('does not offer a works or service line with no supplier, but does when it has one', () => {
    expect(poPickerOffers({ itemCode: 'RN-PLASTER', itemGroup: 'works', mainSupplierCode: null })).toBe(false);
    expect(poPickerOffers({ itemCode: 'SVC-DELIVERY', itemGroup: 'service', mainSupplierCode: null })).toBe(false);
    expect(poPickerOffers({ itemCode: 'RN-PLASTER', itemGroup: 'works', mainSupplierCode: 'ABC' })).toBe(true);
  });
  test('offers a product line, bound or not', () => {
    expect(poPickerOffers({ itemCode: 'SOFA-1', itemGroup: 'sofa', mainSupplierCode: 'HOOKKA' })).toBe(true);
    expect(poPickerOffers({ itemCode: 'SOFA-1', itemGroup: 'sofa', mainSupplierCode: null })).toBe(true);
  });
});
