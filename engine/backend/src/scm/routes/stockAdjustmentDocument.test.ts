// BUG-66 (Sim 2026-10-07): a stock adjustment became a numbered document that
// can be opened and edited. This drives the REAL routes through the fake
// PostgREST client and asserts:
//   - POST writes ONE header + its lines, and every movement carries the
//     document's id and number
//   - an edit moves only the DIFFERENCE per bucket (-3 -> -5 writes one -2)
//   - an edit that would take out more than the bucket holds is refused
//     before anything is written (Sim's "-3 edited to -12" example)
//   - putting written-off stock back enters at the cost it was written off at
//   - a reason / notes-only edit moves no stock
//   - another company's document 404s and nothing is written
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

import { fakeSb, type Row } from '../lib/fake-postgrest';
import type { Env, Variables } from '../env';

function makeSb() {
  return Object.assign(
    fakeSb({
      warehouses: [{ id: 'wh-1', code: 'KL', company_id: 1 }],
      stock_adjustments: [
        { id: 'sa-1', adjustment_no: 'TC-SA-2610-001', warehouse_id: 'wh-1', notes: null, company_id: 1,
          created_by: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' },
        { id: 'sa-9', adjustment_no: '2990-SA-2610-001', warehouse_id: 'wh-1', notes: 'other company', company_id: 2,
          created_by: null, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' },
      ],
      stock_adjustment_lines: [
        { id: 'l-1', stock_adjustment_id: 'sa-1', company_id: 1, line_no: 1, item_code: 'CH-1', product_name: 'Chair',
          item_group: null, variants: null, description2: null, variant_key: '', batch_no: null, qty: -3,
          reason_code: 'DAMAGE', notes: null },
      ],
      // The original -3 already went out at RM10 a unit; 7 remain open.
      inventory_movements: [
        { id: 'm-1', movement_type: 'ADJUSTMENT', warehouse_id: 'wh-1', item_code: 'CH-1', variant_key: '', batch_no: null,
          qty: -3, unit_cost_sen: 1000, source_doc_type: 'ADJUSTMENT', source_doc_id: 'sa-1',
          source_doc_no: 'TC-SA-2610-001', company_id: 1 },
      ],
      v_inventory_lots_open: [
        { warehouse_id: 'wh-1', item_code: 'CH-1', variant_key: '', batch_no: null, qty_remaining: 7, company_id: 1 },
        { warehouse_id: 'wh-1', item_code: 'CH-2', variant_key: '', batch_no: null, qty_remaining: 4, company_id: 1 },
      ],
      inventory_lots: [
        { warehouse_id: 'wh-1', item_code: 'CH-1', variant_key: '', unit_cost_sen: 1200, qty_remaining: 7,
          source_doc_type: 'GRN', received_at: '2026-09-01T00:00:00Z', company_id: 1 },
        { warehouse_id: 'wh-1', item_code: 'CH-2', variant_key: '', unit_cost_sen: 500, qty_remaining: 4,
          source_doc_type: 'GRN', received_at: '2026-09-01T00:00:00Z', company_id: 1 },
      ],
      entity_audit_log: [],
      app_config: [],
    }),
    { rpc: async (name: string) => ({ data: name === 'next_doc_no_n' ? 1 : true, error: null }) },
  );
}

vi.mock('../../db/supabase', () => ({ getSupabaseService: () => sb }));
vi.mock('../lib/so-stock-allocation', () => ({ recomputeSoStockAllocation: async () => undefined }));
vi.mock('../lib/oversell-retrocost', () => ({ reconcileUncostedAfterIn: async () => ({ reconciled: 0, affectedDoIds: [] }) }));

let sb = makeSb();
beforeEach(() => { sb = makeSb(); });

const movements = () => sb.tables.inventory_movements as Row[];
const docMovements = (id: string) => movements().filter((m) => m.source_doc_id === id);
const docLines = (id: string) => (sb.tables.stock_adjustment_lines as Row[]).filter((l) => l.stock_adjustment_id === id);

const CALLER = {
  id: '7', email: 'store@houzs.test', app_metadata: {},
  user_metadata: { name: 'Store' }, aud: 'authenticated', created_at: '',
} as unknown as User;

const { inventoryAdjustments } = await import('./inventory-adjustments');

async function call(method: string, path: string, body: Record<string, unknown>, companyId = 1) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('user', CALLER);
    c.set('companyId', companyId);
    c.set('supabase', sb as unknown as Variables['supabase']);
    await next();
  });
  app.route('/', inventoryAdjustments);
  return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const V0 = '2026-10-07T00:00:00Z';
const line = (itemCode: string, qty: number, reasonCode = 'DAMAGE') => ({ itemCode, qty, reasonCode });

describe('POST /inventory/adjustments — one document', () => {
  it('writes one numbered header, its lines, and movements that point back at it', async () => {
    const res = await call('POST', '/', { warehouseId: 'wh-1', lines: [line('CH-1', -1), line('CH-2', 2, 'FOUND')] });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; adjustmentNo: string };
    expect(body.adjustmentNo).toMatch(/^TC-SA-\d{4}-\d{3}$/);
    expect(docLines(body.id).map((l) => [l.item_code, l.qty])).toEqual([['CH-1', -1], ['CH-2', 2]]);
    const mv = docMovements(body.id);
    // Found stock first, so a write-off in the same bucket finds the lot.
    expect(mv.map((m) => [m.item_code, m.qty])).toEqual([['CH-2', 2], ['CH-1', -1]]);
    expect(new Set(mv.map((m) => m.source_doc_no))).toEqual(new Set([body.adjustmentNo]));
  });

  it('refuses a write-off larger than the bucket holds, writing nothing', async () => {
    const before = (sb.tables.stock_adjustments as Row[]).length;
    const res = await call('POST', '/', { warehouseId: 'wh-1', lines: [line('CH-2', -5)] });
    expect(res.status).toBe(422);
    // Nothing written, so the Idempotency-Key claim is released for the corrected resubmit.
    expect(res.headers.get('Idempotency-Outcome')).toBe('no-write');
    expect((sb.tables.stock_adjustments as Row[]).length).toBe(before);
    expect(movements()).toHaveLength(1);
  });
});

describe('PATCH /inventory/adjustments/:id — edit moves only the difference', () => {
  it('-3 edited to -5 writes ONE -2 movement and replaces the line', async () => {
    const res = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0,  lines: [line('CH-1', -5)] });
    expect(res.status).toBe(200);
    const mv = docMovements('sa-1');
    expect(mv.map((m) => m.qty)).toEqual([-3, -2]);
    expect(docLines('sa-1').map((l) => l.qty)).toEqual([-5]);
    expect((sb.tables.entity_audit_log as Row[]).some((a) => a.action === 'UPDATE' && a.entity_id === 'sa-1')).toBe(true);
  });

  it('-3 edited to -12 needs 9 more but only 7 are open: refused, nothing written', async () => {
    const res = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0,  lines: [line('CH-1', -12)] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain('only 7 on hand');
    expect(docMovements('sa-1')).toHaveLength(1);
    expect(docLines('sa-1').map((l) => l.qty)).toEqual([-3]);
  });

  it('-3 edited to -1 puts 2 back at the cost they were written off at', async () => {
    const res = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0,  lines: [line('CH-1', -1)] });
    expect(res.status).toBe(200);
    const back = docMovements('sa-1')[1]!;
    expect(back.qty).toBe(2);
    expect(back.unit_cost_sen).toBe(1000);
  });

  it('a reason / notes-only edit moves no stock', async () => {
    const res = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0,  notes: 'recount', lines: [line('CH-1', -3, 'WRITEOFF')] });
    expect(res.status).toBe(200);
    expect(docMovements('sa-1')).toHaveLength(1);
    expect(docLines('sa-1').map((l) => l.reason_code)).toEqual(['WRITEOFF']);
    expect((sb.tables.stock_adjustments as Row[]).find((h) => h.id === 'sa-1')!.notes).toBe('recount');
  });

  it("404s on another company's document and writes nothing", async () => {
    const res = await call('PATCH', '/sa-9', { expectedUpdatedAt: V0,  notes: 'should not land' }, 1);
    expect(res.status).toBe(404);
    expect((sb.tables.stock_adjustments as Row[]).find((h) => h.id === 'sa-9')!.notes).toBe('other company');
  });
});

describe('PATCH /inventory/adjustments/:id — two saves of one version post the delta once', () => {
  it('the second save of the same version is 409 stale_document and moves nothing', async () => {
    const first = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0, lines: [line('CH-1', -5)] });
    expect(first.status).toBe(200);
    const second = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0, lines: [line('CH-1', -5)] });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe('stale_document');
    expect(docMovements('sa-1').map((m) => m.qty)).toEqual([-3, -2]);
    expect(docLines('sa-1').map((l) => l.qty)).toEqual([-5]);
  });

  it('two saves racing past the header read: only the one that claims the version writes', async () => {
    // Both requests read the header before either claims it: hold the first
    // one's claim until the second has read, then let them both run.
    const fire = () => call('PATCH', '/sa-1', { expectedUpdatedAt: V0, lines: [line('CH-1', -5)] });
    const [a, b] = await Promise.all([fire(), fire()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(docMovements('sa-1').map((m) => m.qty)).toEqual([-3, -2]);
  });

  it('the save carries the new version back, and that version saves again', async () => {
    const first = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0, lines: [line('CH-1', -5)] });
    const v1 = ((await first.json()) as { adjustment: { updated_at: string } }).adjustment.updated_at;
    expect(v1).not.toBe(V0);
    const again = await call('PATCH', '/sa-1', { expectedUpdatedAt: v1, lines: [line('CH-1', -6)] });
    expect(again.status).toBe(200);
    expect(docMovements('sa-1').map((m) => m.qty)).toEqual([-3, -2, -1]);
  });

  it('a save without the version is refused', async () => {
    const res = await call('PATCH', '/sa-1', { lines: [line('CH-1', -5)] });
    expect(res.status).toBe(400);
    expect(docMovements('sa-1')).toHaveLength(1);
  });
});

describe('a long adjustment stays inside the Worker budget', () => {
  it('40 lines read the lots once per table, not once per line', async () => {
    const orig = sb.from.bind(sb);
    let calls = 0;
    (sb as { from: typeof sb.from }).from = ((t: string) => { calls += 1; return orig(t); }) as typeof sb.from;
    const lines = Array.from({ length: 40 }, (_, i) => line(i % 2 ? 'CH-1' : 'CH-2', i % 2 ? 1 : -1, i % 2 ? 'FOUND' : 'DAMAGE'));
    // 20 write-offs of CH-2 need 20 open; give it 30.
    (sb.tables.v_inventory_lots_open as Row[]).push({ warehouse_id: 'wh-1', item_code: 'CH-2', variant_key: '', batch_no: null, qty_remaining: 26, company_id: 1 });
    const res = await call('POST', '/', { warehouseId: 'wh-1', lines });
    expect(res.status).toBe(201);
    // Was 2 + one lot read per line (40+); now a fixed handful whatever the line count.
    expect(calls).toBeLessThanOrEqual(15);
    const id = ((await res.json()) as { id: string }).id;
    expect(docMovements(id)).toHaveLength(40);
  });

  it('a write-off larger than one bucket holds is still refused when read in one go', async () => {
    const res = await call('POST', '/', { warehouseId: 'wh-1', lines: [line('CH-2', -3), line('CH-2', -2)] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toContain('only 4 on hand, this takes out 5');
  });
});

describe('POST failing after the header insert', () => {
  it('rolls the document back and releases the Idempotency-Key so the retry goes through', async () => {
    const orig = sb.from.bind(sb);
    (sb as { from: typeof sb.from }).from = ((t: string) => {
      const b = orig(t);
      if (t === 'inventory_movements') b.insert = () => Promise.resolve({ data: null, error: { message: 'boom' } });
      return b;
    }) as typeof sb.from;
    const before = (sb.tables.stock_adjustments as Row[]).length;
    const res = await call('POST', '/', { warehouseId: 'wh-1', lines: [line('CH-1', -1)] });
    expect(res.status).toBe(500);
    expect(res.headers.get('Idempotency-Outcome')).toBe('no-write');
    expect((sb.tables.stock_adjustments as Row[]).length).toBe(before);
  });
});

describe('a backfilled line with a blank batch', () => {
  it("is the same bucket as the form's no-batch line: an untouched edit moves nothing", async () => {
    (sb.tables.inventory_movements as Row[])[0]!.batch_no = '';
    (sb.tables.stock_adjustment_lines as Row[])[0]!.batch_no = '';
    const res = await call('PATCH', '/sa-1', { expectedUpdatedAt: V0, lines: [line('CH-1', -3)] });
    expect(res.status).toBe(200);
    expect(docMovements('sa-1')).toHaveLength(1);
  });
});
