import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearListMemo, withListMemo } from './mrp-list-memo';

describe('withListMemo', () => {
  beforeEach(clearListMemo);

  it('answers from the last result inside 20 seconds, and works it out again after', async () => {
    const compute = vi.fn(async () => 'plan');
    let t = 0;
    await withListMemo('c1', compute, () => t);
    t = 19_000;
    await withListMemo('c1', compute, () => t);
    expect(compute).toHaveBeenCalledTimes(1);
    t = 20_000;
    await withListMemo('c1', compute, () => t);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('keeps each company apart and never keeps a failure', async () => {
    const compute = vi.fn(async () => 'plan');
    await withListMemo('c1', compute);
    await withListMemo('c2', compute);
    expect(compute).toHaveBeenCalledTimes(2);
    await expect(withListMemo('c3', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    await expect(withListMemo('c3', compute)).resolves.toBe('plan');
  });
});
