import { describe, expect, it } from 'vitest';
import { materialDeltas } from './renovation-line-materials';

describe('materialDeltas', () => {
  it('moves only what changed, per order', () => {
    expect(materialDeltas(
      [{ order_id: 'a', material_code: 'X', qty: 60 }, { order_id: 'a', material_code: 'Y', qty: '12' }],
      [{ order_id: 'a', material_code: 'X', qty: 80 }, { order_id: 'a', material_code: 'Y', qty: 12 }],
    )).toEqual([{ orderId: 'a', code: 'X', delta: 20 }]);
  });
  it('a removed material goes down to nothing and a new one comes up from nothing', () => {
    expect(materialDeltas([{ order_id: 'a', material_code: 'X', qty: 5 }], [{ order_id: 'a', material_code: 'Z', qty: 2 }]))
      .toEqual([{ orderId: 'a', code: 'X', delta: -5 }, { orderId: 'a', code: 'Z', delta: 2 }]);
  });
  it('sums two lots of one order before comparing', () => {
    expect(materialDeltas([{ order_id: 'a', material_code: 'X', qty: 1 }, { order_id: 'a', material_code: 'X', qty: 2 }], [{ order_id: 'a', material_code: 'X', qty: 3 }])).toEqual([]);
  });
});
