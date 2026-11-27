import { describe, expect, it } from 'vitest';
import type { BindingRow } from '../../vendor/scm/lib/suppliers-queries';
import { rematchLinesToCreditor, type RematchableLine } from './po-creditor-rematch';

const binding = (id: string, itemCode: string, priceSen: number): BindingRow => ({
  id, supplier_id: 'sup-b', material_kind: 'mfg_product', item_code: itemCode, ac_item_code: null,
  material_name: itemCode, supplier_sku: `B-${itemCode}`, unit_price_sen: priceSen, currency: 'MYR',
  lead_time_days: 0, payment_terms_override: null, moq: 0, price_valid_from: null, price_valid_to: null,
  is_main_supplier: false, notes: null, price_matrix: null,
} as BindingRow);

interface Line extends RematchableLine { rid: string; qty: number }
const line = (rid: string, itemCode: string, extra: Partial<Line> = {}): Line => ({
  rid, itemCode, qty: 2, bindingId: `a-${rid}`, supplierSku: `A-${itemCode}`, unitPriceSen: 100, priceTouched: true, ...extra,
});

describe('rematchLinesToCreditor', () => {
  it('keeps a SKU the new creditor sells, on its supplier SKU and price, and removes the rest', () => {
    const nextBindings = [binding('b1', 'SOFA-1', 900)];
    const { kept, removed } = rematchLinesToCreditor([line('1', 'SOFA-1'), line('2', 'BED-9')], nextBindings, nextBindings, 'SUPB');
    expect(kept).toEqual([expect.objectContaining({
      rid: '1', qty: 2, bindingId: 'b1', supplierSku: 'B-SOFA-1', unitPriceSen: 900, priceTouched: false,
    })]);
    expect(removed.map((l) => l.rid)).toEqual(['2']);
  });

  it('prefers the binding on an active SKU over one on a retired SKU', () => {
    const retired = binding('old', 'SOFA-1', 500);
    const live = binding('live', 'SOFA-1', 700);
    const { kept } = rematchLinesToCreditor([line('1', 'SOFA-1')], [retired, live], [live], 'SUPB');
    expect(kept[0].bindingId).toBe('live');
  });

  it('keeps a blank line as it is', () => {
    const blank = line('1', '  ');
    expect(rematchLinesToCreditor([blank], [], [], 'SUPB')).toEqual({ kept: [blank], removed: [] });
  });

  it('removes a raw material that follows another main supplier, even when the new creditor sells it', () => {
    const nextBindings = [binding('b1', 'RM-1', 300)];
    const { kept, removed } = rematchLinesToCreditor(
      [line('1', 'RM-1', { mainSupplierCode: 'SUPA' }), line('2', 'RM-1', { mainSupplierCode: 'SUPB' })],
      nextBindings, nextBindings, 'SUPB',
    );
    expect(removed.map((l) => l.rid)).toEqual(['1']);
    expect(kept.map((l) => l.rid)).toEqual(['2']);
  });
});
