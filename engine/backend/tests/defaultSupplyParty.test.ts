// The default PO party of a SKU (spec 2026-10-09 section 3, "Binding"): its main
// supplier binding pre-fills a document line's supplier and cost, and phase 2's
// SO -> PO split groups by it. Subcontractors are suppliers too.
import { describe, expect, test } from 'vitest';
import { resolveDefaultParty } from '../src/scm/lib/default-supply-party';

const b = (supplier_id: string, is_main_supplier: boolean, unit_price_sen = 0, id = supplier_id) =>
  ({ id, supplier_id, is_main_supplier, unit_price_sen });

describe('resolveDefaultParty', () => {
  test('the main binding wins, with its cost', () => {
    expect(resolveDefaultParty([b('s1', false, 100), b('s2', true, 250)])).toEqual({
      supplierId: 's2', bindingId: 's2', unitPriceSen: 250, source: 'main',
    });
  });

  test('a single binding is the default even when not flagged main', () => {
    expect(resolveDefaultParty([b('s1', false, 90)])).toEqual({ supplierId: 's1', bindingId: 's1', unitPriceSen: 90, source: 'only' });
  });

  test('several bindings and no main: no default (the line must choose)', () => {
    expect(resolveDefaultParty([b('s1', false), b('s2', false)])).toBeNull();
  });

  test('no binding: no default', () => {
    expect(resolveDefaultParty([])).toBeNull();
  });

  test('two mains (legacy data before migration 0063) is ambiguous, not a coin toss', () => {
    expect(resolveDefaultParty([b('s1', true), b('s2', true)])).toBeNull();
  });

  test('a null cost reads as 0', () => {
    expect(resolveDefaultParty([{ id: 'x', supplier_id: 's1', is_main_supplier: true, unit_price_sen: null }])?.unitPriceSen).toBe(0);
  });
});
