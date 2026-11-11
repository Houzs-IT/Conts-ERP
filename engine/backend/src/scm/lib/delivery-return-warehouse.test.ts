import { describe, expect, it } from 'vitest';
import { resolveDrLineWarehouses } from '../routes/delivery-returns';
import { resolveDoLineWarehouses } from './do-line-warehouses';
import { fakeSb } from './fake-postgrest';

/* Goods come back to the building they left: the delivery order's warehouse wins over the SO line's, on both sides. */
const tables = () => ({
  delivery_order_items: [{ id: 'doi', so_item_id: 'soi', delivery_order_id: 'do1' }],
  delivery_orders: [{ id: 'do1', warehouse_id: 'PICKED' }],
  mfg_sales_order_items: [{ id: 'soi', warehouse_id: 'SO-LINE' }],
  warehouses: [],
});

describe('delivery return warehouse', () => {
  it('returns to the warehouse the delivery order shipped from', async () => {
    const sb = fakeSb(tables());
    const out = await resolveDoLineWarehouses(sb, [{ id: 'doi', so_item_id: 'soi' }], 'PICKED', 1);
    const back = await resolveDrLineWarehouses(sb, [{ id: 'dri', do_item_id: 'doi' }], 'RETURN-HEADER', 1);
    expect(out.get('doi')).toBe('PICKED');
    expect(back.get('dri')).toBe(out.get('doi'));
  });
  it('falls back to the SO line when the delivery order names no warehouse', async () => {
    const t = tables();
    t.delivery_orders[0]!.warehouse_id = null as never;
    const back = await resolveDrLineWarehouses(fakeSb(t), [{ id: 'dri', do_item_id: 'doi' }], null, 1);
    expect(back.get('dri')).toBe('SO-LINE');
  });
});
