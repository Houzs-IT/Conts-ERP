import { describe, expect, test } from 'vitest';
import { poRequestBatches, type PoPick } from './mrp-po-batches';

const pick = (soItemId: string, supplierId: string | null): PoPick => ({ soItemId, qty: 1, supplierId });
const docOf = (id: string) => id.split('.')[0];

describe('poRequestBatches', () => {
  test('Combined keeps every line of one supplier in one request, however many SOs', () => {
    const picks = ['a.1', 'b.1', 'c.1', 'd.1', 'e.1'].map((id) => pick(id, 'S1'));
    expect(poRequestBatches(picks, docOf, 'combined')).toEqual([picks]);
  });

  test('Per SO splits seven SOs into requests of three POs', () => {
    const picks = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((d) => pick(`${d}.1`, 'S1'));
    expect(poRequestBatches(picks, docOf, 'per-so').map((b) => b.length)).toEqual([3, 3, 1]);
  });

  test('never splits one PO across two requests', () => {
    const picks = [pick('a.1', 'S1'), pick('b.1', 'S1'), pick('c.1', 'S1'), pick('d.1', 'S1'), pick('a.2', 'S1')];
    const batches = poRequestBatches(picks, docOf, 'per-so');
    const holding = batches.filter((b) => b.some((p) => docOf(p.soItemId) === 'a'));
    expect(holding).toHaveLength(1);
    expect(holding[0]!.filter((p) => docOf(p.soItemId) === 'a')).toHaveLength(2);
  });

  test('no picks, no requests', () => {
    expect(poRequestBatches([], docOf, 'combined')).toEqual([]);
  });
});
