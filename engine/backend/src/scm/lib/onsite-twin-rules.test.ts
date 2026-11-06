import { describe, expect, it } from 'vitest';
import { addUp, deliveriesToRaise, receiptPicks } from './onsite-twin-rules';

describe('a delivery receives what it has not yet received', () => {
  const po = [{ id: 'p1', so_item_id: 's1', qty: 6, received_qty: 0 }];
  it('the first press receives the delivery', () => {
    expect(receiptPicks([{ so_item_id: 's1', qty: 3 }], po, new Map())).toEqual([{ poItemId: 'p1', qty: 3 }]);
  });
  it('split delivery: Delivered repeats the twin and receives nothing more', () => {
    const afterFirst = [{ ...po[0]!, received_qty: 3 }];
    expect(receiptPicks([{ so_item_id: 's1', qty: 3 }], afterFirst, new Map([['s1', 3]]))).toEqual([]);
  });
  it('the second delivery of the split still receives its own 3', () => {
    const afterFirst = [{ ...po[0]!, received_qty: 3 }];
    expect(receiptPicks([{ so_item_id: 's1', qty: 3 }], afterFirst, new Map())).toEqual([{ poItemId: 'p1', qty: 3 }]);
  });
  it('a line split in two on one delivery shares what was received', () => {
    const lines = [{ so_item_id: 's1', qty: 2 }, { so_item_id: 's1', qty: 2 }];
    expect(receiptPicks(lines, po, new Map([['s1', 3]]))).toEqual([{ poItemId: 'p1', qty: 1 }]);
  });
  it('never takes more than the PO has open', () => {
    expect(receiptPicks([{ so_item_id: 's1', qty: 9 }], po, new Map())).toEqual([{ poItemId: 'p1', qty: 6 }]);
  });
});

describe('a receipt delivers what is not yet delivered', () => {
  const rest = (n: number) => () => n;
  it('raises a delivery for the receipt', () => {
    expect(deliveriesToRaise(new Map([['s1', 3]]), new Map(), [], rest(6))).toEqual({ raise: [{ soItemId: 's1', qty: 3 }], planned: [] });
  });
  it('a repeat of the same receipt raises nothing', () => {
    expect(deliveriesToRaise(new Map([['s1', 3]]), new Map([['s1', 3]]), [], rest(3)).raise).toEqual([]);
  });
  it('a draft delivery is the plan: tied, and nothing new raised', () => {
    const drafts = [{ doId: 'd1', soItemId: 's1', qty: 3 }];
    expect(deliveriesToRaise(new Map([['s1', 3]]), new Map(), drafts, rest(6))).toEqual({ raise: [], planned: ['d1'] });
  });
  it('only what the draft does not cover is raised', () => {
    const drafts = [{ doId: 'd1', soItemId: 's1', qty: 2 }];
    expect(deliveriesToRaise(new Map([['s1', 3]]), new Map(), drafts, rest(6))).toEqual({ raise: [{ soItemId: 's1', qty: 1 }], planned: ['d1'] });
  });
  it('never raises more than the order has left', () => {
    expect(deliveriesToRaise(new Map([['s1', 3]]), new Map(), [], rest(1)).raise).toEqual([{ soItemId: 's1', qty: 1 }]);
  });
});

describe('addUp', () => {
  it('sums by key and skips rows with none', () => {
    expect(addUp([{ k: 'a', q: 1 }, { k: 'a', q: 2 }, { k: null, q: 9 }], (r) => r.k, (r) => r.q)).toEqual(new Map([['a', 3]]));
  });
});
