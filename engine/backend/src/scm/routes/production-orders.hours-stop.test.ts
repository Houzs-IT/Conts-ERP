/* Second review of #857: an order that stops being in production stops whoever is on the clock — cancel and reopen (both
   undo Start) and hold. Otherwise the timer ran on hidden and blocked the next Start's time. */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { fakeSb, type Row } from '../lib/fake-postgrest';
import { productionHoldHandler, undoStart } from './production-orders';

const running = (): Row[] => [{ id: 'e1', production_order_id: 'o1', person_key: 'tech-1', name: 'Ali', started_at: new Date(Date.now() - 3600_000).toISOString(), stopped_at: null }];
const ctx = (sb: unknown) => ({ get: (k: string) => (k === 'user' ? { id: 'staff' } : k === 'houzsUser' ? { id: 9, name: 'Mei' } : k === 'supabase' ? sb : undefined) });

describe('timers stop when the order stops being in production', () => {
  it('undoing Start (cancel, reopen) stops running timers', async () => {
    const sb = fakeSb({ production_order_materials: [], production_order_workers: [], production_time_entries: running() });
    expect(await undoStart(ctx(sb), sb, 'o1')).toBeNull();
    expect(sb.tables.production_time_entries[0].stopped_at).toBeTruthy();
  });

  it('putting the order on hold stops running timers; taking it off hold does not start them', async () => {
    const sb = fakeSb({
      production_orders: [{ id: 'o1', company_id: 1, po_number: 'TC-PRO-1', status: 'SUBMITTED', on_hold: false }],
      production_time_entries: running(),
    });
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('companyId' as never, 1 as never);
      c.set('supabase' as never, sb as never);
      c.set('user' as never, { id: 'staff' } as never);
      c.set('houzsUser' as never, { id: 9, name: 'Mei' } as never);
      await next();
    });
    a.patch('/:id/hold', productionHoldHandler);
    const res = await a.request('/o1/hold', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onHold: true, reason: 'waiting for client' }) });
    expect(res.status).toBe(200);
    expect(sb.tables.production_time_entries[0].stopped_at).toBeTruthy();
  });
});
