// Owner decision C7 (Conts, 11 Oct 2026): no AutoCount integration. With the
// kill switch both Conts wrangler files set, the outbox drain sends nothing —
// even with a host configured — and never opens the database.
import { describe, expect, it } from 'vitest';
import { drainAutoCountOutbox } from './autocount-outbox';

describe('AutoCount outbox drain under AUTOCOUNT_SYNC_DISABLED (C7)', () => {
  it('skips before reading the queue or calling the host', async () => {
    let fetched = false;
    const env = { AUTOCOUNT_SYNC_DISABLED: 'true', AC_SYNC_URL: 'https://example.invalid', AC_SYNC_SECRET: 'x' } as never;
    const r = await drainAutoCountOutbox(env, 10, (async () => { fetched = true; return new Response('{}'); }) as typeof fetch);
    expect(r).toEqual({ skipped: 'autocount_disabled', processed: 0, sent: 0, failed: 0, retried: 0, waiting: 0 });
    expect(fetched).toBe(false);
  });
});
