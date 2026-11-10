/* Worker actual hours on a production order (TODO item 16): Start time / Stop time, entries by hand, and what the order
   page reads back. */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { fakeSb, type Row } from '../lib/fake-postgrest';

vi.mock('../lib/entity-audit', async (original) => ({
  ...(await original<typeof import('../lib/entity-audit')>()),
  recordEntityAudit: vi.fn(async () => ({ ok: true })),
}));

const { entryAddHandler, entryDeleteHandler, entryEditHandler, hoursGetHandler, stopRunningTimers, timerStartHandler, timerStopHandler, actualMinutesByOrder } = await import('./production-hours');

const CO = 1;
const order = (over: Row = {}): Row => ({ id: 'o1', company_id: CO, po_number: 'TC-PRO-2611-001', status: 'SUBMITTED', on_hold: false, actual_start_at: '2026-11-09T01:00:00Z', production_time_hours: 10, ...over });

function world(o: Row = order(), entries: Row[] = []) {
  return fakeSb({
    production_orders: [o],
    production_order_workers: [{ production_order_id: 'o1', person_key: 'tech-1', name: 'Ali', how: 'ASSIGNED' }],
    production_time_entries: entries,
  });
}

function app(sb: ReturnType<typeof fakeSb>) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('companyId' as never, CO as never);
    c.set('supabase' as never, sb as never);
    c.set('user' as never, { id: 'staff-uuid' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'Mei' } as never);
    await next();
  });
  a.get('/:id/hours', hoursGetHandler);
  a.post('/:id/hours/start', timerStartHandler);
  a.post('/:id/hours/stop', timerStopHandler);
  a.post('/:id/hours', entryAddHandler);
  a.patch('/:id/hours/:entryId', entryEditHandler);
  a.delete('/:id/hours/:entryId', entryDeleteHandler);
  return a;
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('Start time / Stop time', () => {
  it('starts a timer for the caller, once; Stop closes it', async () => {
    const sb = world();
    const a = app(sb);
    const first = await a.request('/o1/hours/start', json({}));
    expect(first.status).toBe(201);
    const again = await (await a.request('/o1/hours/start', json({}))).json() as { alreadyRunning?: boolean };
    expect(again.alreadyRunning).toBe(true);
    expect(sb.tables.production_time_entries).toHaveLength(1);
    expect(sb.tables.production_time_entries[0]).toMatchObject({ person_key: 'user:9', name: 'Mei', how: 'TIMER' });
    const stop = await a.request('/o1/hours/stop', json({}));
    expect(stop.status).toBe(200);
    expect(sb.tables.production_time_entries[0].stopped_at).toBeTruthy();
    expect((await a.request('/o1/hours/stop', json({}))).status).toBe(409);
  });

  it('starts a timer for a worker on the order, never for a stranger', async () => {
    const sb = world();
    expect((await app(sb).request('/o1/hours/start', json({ personKey: 'tech-1' }))).status).toBe(201);
    expect(sb.tables.production_time_entries[0]).toMatchObject({ person_key: 'tech-1', name: 'Ali' });
    expect((await app(sb).request('/o1/hours/start', json({ personKey: 'tech-99' }))).status).toBe(422);
  });

  it('runs only on an order in production: started, not on hold, not finished', async () => {
    expect((await app(world(order({ actual_start_at: null }))).request('/o1/hours/start', json({}))).status).toBe(409);
    expect((await app(world(order({ on_hold: true }))).request('/o1/hours/start', json({}))).status).toBe(409);
    expect((await app(world(order({ status: 'RECEIVED' }))).request('/o1/hours/start', json({}))).status).toBe(409);
    expect((await app(world(order({ company_id: 2 }))).request('/o1/hours/start', json({}))).status).toBe(404);
  });
});

describe('entries by hand', () => {
  it('adds a typed entry, refuses an overlap and a stop before the start', async () => {
    const sb = world();
    const a = app(sb);
    const ok = await a.request('/o1/hours', json({ personKey: 'tech-1', startedAt: '2026-11-09T01:00:00Z', stoppedAt: '2026-11-09T05:00:00Z', notes: 'cutting' }));
    expect(ok.status).toBe(201);
    expect(sb.tables.production_time_entries[0]).toMatchObject({ how: 'MANUAL', notes: 'cutting', name: 'Ali' });
    expect((await a.request('/o1/hours', json({ personKey: 'tech-1', startedAt: '2026-11-09T04:00:00Z', stoppedAt: '2026-11-09T06:00:00Z' }))).status).toBe(409);
    expect((await a.request('/o1/hours', json({ personKey: 'tech-1', startedAt: '2026-11-09T07:00:00Z', stoppedAt: '2026-11-09T06:00:00Z' }))).status).toBe(422);
  });

  it('may still be added on a finished order, but not before Start', async () => {
    const body = json({ startedAt: '2026-11-09T01:00:00Z', stoppedAt: '2026-11-09T02:00:00Z' });
    expect((await app(world(order({ status: 'RECEIVED' }))).request('/o1/hours', body)).status).toBe(201);
    expect((await app(world(order({ actual_start_at: null, status: 'SUBMITTED' }))).request('/o1/hours', body)).status).toBe(409);
  });

  it('corrects and removes an entry of this order only', async () => {
    const sb = world(order(), [{ id: 'e1', production_order_id: 'o1', person_key: 'tech-1', name: 'Ali', started_at: '2026-11-09T01:00:00Z', stopped_at: '2026-11-09T09:00:00Z', how: 'TIMER' }]);
    const a = app(sb);
    const patch = await a.request('/o1/hours/e1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stoppedAt: '2026-11-09T06:00:00Z' }) });
    expect(patch.status).toBe(200);
    expect(sb.tables.production_time_entries[0].stopped_at).toBe('2026-11-09T06:00:00.000Z');
    expect((await a.request('/o2/hours/e1', { method: 'DELETE' })).status).toBe(404);
    expect((await a.request('/o1/hours/e1', { method: 'DELETE' })).status).toBe(200);
    expect(sb.tables.production_time_entries).toHaveLength(0);
  });
});

describe('what the order page reads', () => {
  it('actual against the budget, kept apart from the plan', async () => {
    const sb = world(order({ production_time_hours: 6 }), [
      { id: 'e1', production_order_id: 'o1', person_key: 'tech-1', name: 'Ali', started_at: '2026-11-09T01:00:00Z', stopped_at: '2026-11-09T05:00:00Z' },
      { id: 'e2', production_order_id: 'o1', person_key: 'user:9', name: 'Mei', started_at: '2026-11-09T02:00:00Z', stopped_at: '2026-11-09T05:00:00Z' },
    ]);
    const body = await (await app(sb).request('/o1/hours')).json() as { budgetHours: number; summary: { actualMinutes: number; varianceMinutes: number; overBudget: boolean }; me: string; entries: Array<{ minutes: number }> };
    expect(body.budgetHours).toBe(6);
    expect(body.summary).toMatchObject({ actualMinutes: 420, varianceMinutes: 60, overBudget: true });
    expect(body.entries.map((x) => x.minutes)).toEqual([240, 180]);
    expect(body.me).toBe('user:9');
  });

  it('the list total per order, and Complete stops whoever is still on the clock', async () => {
    const sb = world(order(), [
      { id: 'e1', production_order_id: 'o1', person_key: 'tech-1', name: 'Ali', started_at: '2026-11-09T01:00:00Z', stopped_at: '2026-11-09T02:00:00Z' },
      { id: 'e2', production_order_id: 'o1', person_key: 'user:9', name: 'Mei', started_at: new Date(Date.now() - 30 * 60_000).toISOString(), stopped_at: null },
    ]);
    const before = await actualMinutesByOrder(sb, ['o1']);
    expect(before.get('o1')).toBe(90);
    expect(await stopRunningTimers(sb, 'o1', 'Mei')).toBe(1);
    expect(sb.tables.production_time_entries.every((x: Row) => x.stopped_at)).toBe(true);
  });
});
