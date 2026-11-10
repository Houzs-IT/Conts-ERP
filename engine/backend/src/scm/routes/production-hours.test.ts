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

/* A worker with Edit on Production Orders, not Full: a supervisor is the default caller (Mei, matrix not set up). */
const WORKER = { id: 10, name: 'Ali', scm_l2_configured: true, page_access: { 'scm.procurement.production': 'edit' } };

function app(sb: ReturnType<typeof fakeSb>, houzsUser: Row = { id: 9, name: 'Mei' }) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('companyId' as never, CO as never);
    c.set('supabase' as never, sb as never);
    c.set('user' as never, { id: 'staff-uuid' } as never);
    c.set('houzsUser' as never, houzsUser as never);
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

/* ── Review fixes (#857) ───────────────────────────────────────────────── */
const patch = (body: unknown) => ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** The table answers the next write on it with this database error (an exclusion constraint the fake cannot model). */
function failingWrites(sb: ReturnType<typeof fakeSb>, code: string) {
  const from = sb.from;
  return { ...sb, from: (t: string) => {
    const b = from(t) as Record<string, any>;
    if (t !== 'production_time_entries') return b;
    const refuse = () => { const r: Record<string, any> = { select: () => r, single: async () => ({ data: null, error: { code, message: 'conflicting key value violates exclusion constraint' } }), eq: () => r, is: () => r,
      then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { code, message: 'conflict' } }) }; return r; };
    return { ...b, insert: refuse, update: refuse };
  } } as unknown as ReturnType<typeof fakeSb>;
}

describe('review fixes', () => {
  it('1. no Start once Complete has begun (the order is still in production until the last step)', async () => {
    const res = await app(world(order({ completion_step: 'grn' }))).request('/o1/hours/start', json({}));
    expect(res.status).toBe(409);
    expect((await res.json() as { message: string }).message).toContain('being completed');
  });

  it('2. an overlap the database refuses (exclusion constraint, 23P01) answers 409, not 500', async () => {
    const sb = failingWrites(world(), '23P01');
    const add = await app(sb).request('/o1/hours', json({ personKey: 'tech-1', startedAt: '2026-11-09T01:00:00Z', stoppedAt: '2026-11-09T02:00:00Z' }));
    expect(add.status).toBe(409);
    expect((await add.json() as { error: string }).error).toBe('overlap');
    const start = await app(failingWrites(world(), '23P01')).request('/o1/hours/start', json({}));
    expect(start.status).toBe(409);
  });

  it('4. a worker times only themselves; entries by hand are for a supervisor', async () => {
    const sb = world();
    expect((await app(sb, WORKER).request('/o1/hours/start', json({}))).status).toBe(201);
    expect((await app(sb, WORKER).request('/o1/hours/start', json({ personKey: 'tech-1' }))).status).toBe(403);
    expect((await app(sb, WORKER).request('/o1/hours/stop', json({ personKey: 'user:9' }))).status).toBe(403);
    expect((await app(sb, WORKER).request('/o1/hours', json({ startedAt: '2026-11-09T01:00:00Z', stoppedAt: '2026-11-09T02:00:00Z' }))).status).toBe(403);
    const id = String(sb.tables.production_time_entries[0].id);
    expect((await app(sb, WORKER).request(`/o1/hours/${id}`, patch({ notes: 'x' }))).status).toBe(403);
    expect((await app(sb, WORKER).request(`/o1/hours/${id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await (await app(sb, WORKER).request('/o1/hours')).json() as { canSupervise: boolean }).canSupervise).toBe(false);
    expect((await (await app(sb).request('/o1/hours')).json() as { canSupervise: boolean }).canSupervise).toBe(true);
    /* Full access supervises. */
    const lead = { ...WORKER, id: 11, page_access: { 'scm.procurement.production': 'full' } };
    expect((await app(sb, lead).request('/o1/hours/start', json({ personKey: 'tech-1' }))).status).toBe(201);
  });

  it('5. correcting a running timer that was stopped meanwhile writes nothing and says so', async () => {
    const sb = world(order(), [{ id: 'e1', production_order_id: 'o1', person_key: 'tech-1', name: 'Ali', started_at: new Date(Date.now() - 3600_000).toISOString(), stopped_at: null, how: 'TIMER' }]);
    const from = sb.from;
    const raced = { ...sb, from: (t: string) => {
      const b = from(t) as Record<string, any>;
      if (t !== 'production_time_entries') return b;
      /* Stop lands between the read and the write. */
      return { ...b, update: (u: Row) => { sb.tables.production_time_entries[0].stopped_at = new Date().toISOString(); return b.update(u); } };
    } } as unknown as ReturnType<typeof fakeSb>;
    const res = await app(raced).request('/o1/hours/e1', patch({ startedAt: new Date(Date.now() - 7200_000).toISOString() }));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('changed');
  });

  it('6. Stop works for someone taken off the order; Start for them does not', async () => {
    const sb = world(order(), [{ id: 'e1', production_order_id: 'o1', person_key: 'tech-gone', name: 'Siva', started_at: new Date(Date.now() - 3600_000).toISOString(), stopped_at: null, how: 'TIMER' }]);
    const stop = await app(sb).request('/o1/hours/stop', json({ personKey: 'tech-gone' }));
    expect(stop.status).toBe(200);
    expect(sb.tables.production_time_entries[0].stopped_at).toBeTruthy();
    expect((await app(sb).request('/o1/hours/start', json({ personKey: 'tech-gone' }))).status).toBe(422);
  });
});

/* ── Second review (#857) ──────────────────────────────────────────────── */
describe('second review fixes', () => {
  it('3. a timer forgotten past 16 h is closed at the limit and Start begins a fresh entry', async () => {
    const old = new Date(Date.now() - 20 * 3600_000).toISOString();
    const sb = world(order(), [{ id: 'e1', production_order_id: 'o1', person_key: 'user:9', name: 'Mei', started_at: old, stopped_at: null, how: 'TIMER' }]);
    const res = await app(sb).request('/o1/hours/start', json({}));
    expect(res.status).toBe(201);
    const rows = sb.tables.production_time_entries as Row[];
    expect(rows).toHaveLength(2);
    expect(Date.parse(String(rows[0].stopped_at)) - Date.parse(old)).toBe(16 * 3600_000);
    expect(rows[1].stopped_at ?? null).toBeNull();
  });

  it('4. the list totals come from the database sum, and page past the row cap without it', async () => {
    const sb = world();
    sb.rpcHandlers.production_actual_minutes = () => [{ production_order_id: 'o1', minutes: '125' }];
    expect((await actualMinutesByOrder(sb, ['o1'])).get('o1')).toBe(125);
    /* No function yet: 1,500 one-hour entries, read in pages past the fake's 1,000-row cap, all counted. */
    const many: Row[] = Array.from({ length: 1500 }, (_, i) => ({ id: `e${String(i).padStart(5, '0')}`, production_order_id: 'o1', person_key: `p${i}`, name: 'X', started_at: '2026-11-01T00:00:00Z', stopped_at: '2026-11-01T01:00:00Z' }));
    const capped = fakeSb({ production_time_entries: many }, {}, [], [], 1000);
    expect((await actualMinutesByOrder(capped, ['o1'])).get('o1')).toBe(1500 * 60);
  });

  it('a second Stop that lost the race writes no second History line', async () => {
    const { recordEntityAudit } = await import('../lib/entity-audit');
    const sb = world(order(), [{ id: 'e1', production_order_id: 'o1', person_key: 'user:9', name: 'Mei', started_at: new Date(Date.now() - 3600_000).toISOString(), stopped_at: null }]);
    const from = sb.from;
    const raced = { ...sb, from: (t: string) => {
      const b = from(t) as Record<string, any>;
      if (t !== 'production_time_entries') return b;
      /* The other press stops it between this one's read and write. */
      return { ...b, update: (u: Row) => { sb.tables.production_time_entries[0]!.stopped_at = new Date().toISOString(); return b.update(u); } };
    } } as unknown as ReturnType<typeof fakeSb>;
    (recordEntityAudit as unknown as { mockClear: () => void }).mockClear();
    const res = await app(raced).request('/o1/hours/stop', json({}));
    expect(res.status).toBe(200);
    expect((await res.json() as { alreadyStopped?: boolean }).alreadyStopped).toBe(true);
    expect(recordEntityAudit).not.toHaveBeenCalled();
  });

  it('Stop in the same instant as Start ends after it (the row check wants stop > start) and counts nought', async () => {
    const now = new Date().toISOString();
    const sb = world(order(), [{ id: 'e1', production_order_id: 'o1', person_key: 'user:9', name: 'Mei', started_at: now, stopped_at: null }]);
    const res = await app(sb).request('/o1/hours/stop', json({}));
    expect(res.status).toBe(200);
    const row = sb.tables.production_time_entries[0] as Row;
    expect(Date.parse(String(row.stopped_at))).toBeGreaterThan(Date.parse(now));
    expect((await res.json() as { minutes: number }).minutes).toBe(0);
  });
});
