import { describe, expect, it } from 'vitest';
import { confirmInTurn, confirmSummary } from './batch-confirm';

describe('confirmInTurn', () => {
  it('goes through the rows one after another and a refusal does not stop the rest', async () => {
    const order: string[] = [];
    const started: number[] = [];
    const out = await confirmInTurn(['A', 'B', 'C', 'D'], (r) => r, async (r) => {
      order.push(`start ${r}`);
      await Promise.resolve();
      order.push(`end ${r}`);
      if (r === 'B') throw new Error('Already billed');
      return r === 'C' ? 'Stock was not received' : null;
    }, (n) => started.push(n));
    expect(started).toEqual([1, 2, 3, 4]);
    expect(order).toEqual(['start A', 'end A', 'start B', 'end B', 'start C', 'end C', 'start D', 'end D']);
    /* C was confirmed (the post answered 200) with a part that failed. */
    expect(out.done).toEqual(['A', 'C', 'D']);
    expect(out.failed).toEqual([{ doc: 'B', reason: 'Already billed' }]);
    expect(out.warned).toEqual([{ doc: 'C', reason: 'Stock was not received' }]);
  });
});

describe('confirmSummary', () => {
  it('counts against what was ticked and names each one left behind or to check', () => {
    expect(confirmSummary('goods receipt', { done: ['A', 'B'], warned: [], failed: [] })).toMatchObject({ title: '2 of 2 confirmed', tone: 'info' });
    const s = confirmSummary('goods receipt', { done: ['A', 'C'], warned: [{ doc: 'C', reason: 'Stock was not received' }], failed: [{ doc: 'B', reason: 'No lines' }] });
    expect(s).toMatchObject({ title: '2 of 3 confirmed', tone: 'error' });
    expect(s.body).toContain('Not confirmed (still a draft):\nB: No lines');
    expect(s.body).toContain('Confirmed, but check:\nC: Stock was not received');
  });
});
