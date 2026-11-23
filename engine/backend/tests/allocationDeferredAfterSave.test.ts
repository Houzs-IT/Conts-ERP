/* D16 (save-integrity, 22 Nov 2026): a save answers before the whole-company
 * allocation re-walk, and a burst of saves shares one more sweep instead of
 * each waiting for its own. */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';

const recompute = vi.fn();
vi.mock('../src/scm/lib/so-stock-allocation', () => ({ recomputeSoStockAllocation: (sb: unknown) => recompute(sb) }));
const enqueue = vi.fn(async () => undefined);
vi.mock('../src/scm/lib/stock-allocation-queue', () => ({ enqueueStockAllocationRecompute: () => enqueue() }));

import { drainCoalesced, queueAllocationRecompute } from '../src/scm/lib/stock-allocation-job';

/* A queue table that is always free and always finishes: enough for the drain to reach recompute and delete. */
function freeQueueSb() {
  const chain = (data: unknown): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'or', 'update', 'delete', 'upsert']) b[m] = () => b;
    b.maybeSingle = async () => ({ data, error: null });
    return b;
  };
  return {
    from: () => chain({ job_key: 'GLOBAL', request_token: 't1', requested_at: '', attempts: 0 }),
  };
}

describe('queueAllocationRecompute', () => {
  it('inside a request: answers before the sweep finishes and hands the sweep to waitUntil', async () => {
    recompute.mockReset();
    let finish!: () => void;
    recompute.mockImplementation(() => new Promise((ok) => { finish = () => ok({ ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0 }); }));
    const waited: Promise<unknown>[] = [];
    const app = new Hono();
    app.use('*', contextStorage());
    app.post('/save', async (c) => {
      await queueAllocationRecompute(freeQueueSb(), 'test-save');
      return c.text('saved');
    });
    const res = await app.request('/save', { method: 'POST' }, {}, { waitUntil: (p: Promise<unknown>) => waited.push(p), passThroughOnException: () => {} } as never);
    expect(await res.text()).toBe('saved');
    expect(waited).toHaveLength(1);
    await vi.waitFor(() => expect(recompute).toHaveBeenCalledTimes(1));
    finish();
    await waited[0];
  });

  it('outside a request (scripts, tests): runs the sweep inline as before', async () => {
    recompute.mockReset();
    recompute.mockResolvedValue({ ok: true, linesFlipped: 0, ordersAdvanced: 0, ordersRegressed: 0 });
    await queueAllocationRecompute({}, 'script');
    expect(recompute).toHaveBeenCalledTimes(1);
  });
});

describe('drainCoalesced', () => {
  it('runs again while saves keep arriving, then stops', async () => {
    const drain = vi.fn()
      .mockResolvedValueOnce({ processed: true, completed: false, deferred: true, reason: 'new_work_arrived' })
      .mockResolvedValueOnce({ processed: true, completed: false, deferred: true, reason: 'new_work_arrived' })
      .mockResolvedValueOnce({ processed: true, completed: true });
    const r = await drainCoalesced({}, drain);
    expect(drain).toHaveBeenCalledTimes(3);
    expect(r.completed).toBe(true);
  });

  it('is bounded: a constant stream leaves the row for the next save', async () => {
    const drain = vi.fn().mockResolvedValue({ processed: true, completed: false, deferred: true, reason: 'new_work_arrived' });
    await drainCoalesced({}, drain);
    expect(drain).toHaveBeenCalledTimes(4);
  });

  it('does not repeat when the job was claimed by another sweep (that sweep re-runs instead)', async () => {
    const drain = vi.fn().mockResolvedValue({ processed: false, completed: false, deferred: true, reason: 'job_already_claimed' });
    await drainCoalesced({}, drain);
    expect(drain).toHaveBeenCalledTimes(1);
  });
});

describe('no save route waits for the whole-company sweep', () => {
  const sources = import.meta.glob(['../src/scm/**/*.ts', '!../src/scm/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('only the manual "Re-allocate stock" endpoint and the job itself call the sweep inline', () => {
    const inline = Object.entries(sources)
      .map(([f, src]) => ({ f, n: src.split('await recomputeSoStockAllocation(').length - 1 }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.f.replace('../', '')}:${x.n}`)
      .sort();
    expect(inline).toEqual([
      'src/scm/lib/so-stock-allocation.ts:2', // its own comments
      'src/scm/lib/stock-allocation-job.ts:1',
      'src/scm/routes/mfg-sales-orders.ts:1',
    ]);
  });
});
