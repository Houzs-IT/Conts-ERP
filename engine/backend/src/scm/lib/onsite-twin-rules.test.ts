import { describe, expect, it } from 'vitest';
import { addUp, deliverOrWithdraw, deliveriesToRaise, receiptPicks, podKeysOfSitePhotos } from './onsite-twin-rules';

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
  it('the drafts it is about to deliver use up what the order has left (database cap 0270)', () => {
    // 5 arrived, 4 left on the line, a draft of 2 is planned: only 2 more may be raised, not 3.
    const drafts = [{ doId: 'd1', soItemId: 's1', qty: 2 }];
    expect(deliveriesToRaise(new Map([['s1', 5]]), new Map(), drafts, rest(4))).toEqual({ raise: [{ soItemId: 's1', qty: 2 }], planned: ['d1'] });
    // A draft already covering all that is left: nothing raised.
    expect(deliveriesToRaise(new Map([['s1', 5]]), new Map(), [{ doId: 'd1', soItemId: 's1', qty: 4 }], rest(4)).raise).toEqual([]);
  });
  it('a draft planned through another line still counts against the line it also carries', () => {
    const drafts = [{ doId: 'd1', soItemId: 's1', qty: 1 }, { doId: 'd1', soItemId: 's2', qty: 2 }];
    // d1 carries both lines: once planned, its 2 on s2 use up s2's remaining too.
    const out = deliveriesToRaise(new Map([['s1', 1], ['s2', 3]]), new Map([['s2', 0]]), drafts, rest(3));
    expect(out.planned).toEqual(['d1']);
    expect(out.raise).toEqual([{ soItemId: 's2', qty: 1 }]);
  });
});

describe('a site receipt shares its proof of delivery', () => {
  it('takes the photos of the goods, not the supplier paper', () => {
    expect(podKeysOfSitePhotos([{ r2_key: 'a', kind: 'in_place' }, { r2_key: 'b', kind: 'supplier_do' }, { r2_key: 'c', kind: 'after' }])).toEqual(['a', 'c']);
  });
});

describe('a DO the twin raised that cannot be delivered', () => {
  const io = (deliver: number, withdraw = 200) => {
    const calls: string[] = [];
    return {
      calls,
      io: {
        deliver: async () => { calls.push('deliver'); return { status: deliver, json: { error: 'over_delivery', message: 'This delivery would ship more than the Sales Order ordered.' } }; },
        withdraw: async () => { calls.push('withdraw'); return { status: withdraw }; },
        untie: async () => { calls.push('untie'); },
      },
    };
  };
  it('a site receipt leaves no stray draft: cancelled and untied', async () => {
    const t = io(409);
    const out = await deliverOrWithdraw(t.io, true);
    expect(out.withdrawn).toBe(true);
    expect(out.problem).toMatch(/more than the Sales Order ordered.*was cancelled/);
    expect(t.calls).toEqual(['deliver', 'withdraw', 'untie']);
  });
  it('delivered: nothing else happens', async () => {
    const t = io(200);
    expect(await deliverOrWithdraw(t.io, true)).toEqual({ problem: null, withdrawn: false });
    expect(t.calls).toEqual(['deliver']);
  });
  it('a warehouse GR twin keeps its DO (it was raised live, not as a draft)', async () => {
    const t = io(409);
    expect((await deliverOrWithdraw(t.io, false)).withdrawn).toBe(false);
    expect(t.calls).toEqual(['deliver']);
  });
  it('a failed cancel says so', async () => {
    const t = io(409, 500);
    const out = await deliverOrWithdraw(t.io, true);
    expect(out.withdrawn).toBe(false);
    expect(out.problem).toMatch(/cancel it by hand/);
  });
});

describe('addUp', () => {
  it('sums by key and skips rows with none', () => {
    expect(addUp([{ k: 'a', q: 1 }, { k: 'a', q: 2 }, { k: null, q: 9 }], (r) => r.k, (r) => r.q)).toEqual(new Map([['a', 3]]));
  });
});
