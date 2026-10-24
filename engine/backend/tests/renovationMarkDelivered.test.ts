// Office "Mark delivered" and the driver POD write the SAME delivered state (owner live check on project 99
// "TESTING", 24 Oct 2026: TC-DO-2610-002 read DELIVERED in the header but "Ready to dispatch" on its card, with
// delivery_state and customer_delivered_date empty). Drives the real status handler for both callers and compares
// every column the DELIVERED step writes; also pins that the day picked is the delivered date, not the click time.
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { patchDeliveryOrderStatusHandler } from '../src/scm/routes/delivery-orders-mfg';
import { deliveredPatch } from '../src/scm/lib/renovation-flow-rules';

type Row = Record<string, any>;

class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  private patch: Row = {};
  private inserted: Row[] = [];
  constructor(private rows: Row[]) {}
  select() { return this; }
  insert(v: Row | Row[]) { this.op = 'insert'; this.inserted = Array.isArray(v) ? v : [v]; return this; }
  update(v: Row) { this.op = 'update'; this.patch = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, val: unknown) { this.preds.push((r) => r[col] === val); return this; }
  neq(col: string, val: unknown) { this.preds.push((r) => r[col] !== val); return this; }
  in(col: string, vals: unknown[]) { this.preds.push((r) => vals.includes(r[col])); return this; }
  is(col: string, val: unknown) {
    if (val === null) this.preds.push((r) => r[col] === null || r[col] === undefined);
    else this.preds.push((r) => r[col] === val);
    return this;
  }
  order() { return this; } limit() { return this; } range() { return this; }
  gt() { return this; } gte() { return this; } lt() { return this; } lte() { return this; }
  not() { return this; } like() { return this; } or() { return this; }
  private run(): Row[] {
    if (this.op === 'insert') { this.rows.push(...this.inserted); return this.inserted; }
    const hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === 'update') for (const r of hit) Object.assign(r, this.patch);
    if (this.op === 'delete') for (const r of hit) this.rows.splice(this.rows.indexOf(r), 1);
    return hit;
  }
  maybeSingle() { const h = this.run(); return Promise.resolve({ data: h[0] ?? null, error: null }); }
  single() {
    const h = this.run();
    return Promise.resolve({ data: h[0] ?? null, error: h.length ? null : { message: 'no rows' } });
  }
  then(res: (v: any) => any, rej?: (e: any) => any) {
    return Promise.resolve({ data: this.run(), error: null }).then(res, rej);
  }
}


function app(driver: boolean, existing: Row = {}) {
  const tables: Record<string, Row[]> = {
    drivers: [{ id: 'drv-7', user_id: 7 }],
    helpers: [],
    delivery_orders: [{
      id: 'do-1', do_number: 'DO-1', company_id: 1, status: 'DISPATCHED', so_doc_no: 'SO-1', driver_id: 'drv-7',
      delivered_at: null, delivery_state: null, customer_delivered_date: null, ...existing,
    }],
    delivery_order_crew: [{ do_id: 'do-1', driver_1_id: 'drv-7', driver_2_id: null, helper_1_id: null, helper_2_id: null }],
  };
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('supabase' as never, { from: (t: string) => new FakeQuery((tables[t] ||= [])), rpc: async () => ({ data: true, error: null }) } as never);
    c.set('companyId' as never, 1 as never);
    c.set('user' as never, { id: 'sys' } as never);
    c.set('houzsUser' as never, (driver
      ? { id: 7, name: 'Driver', permissions_set: new Set<string>(), position_capabilities: ['scm.do.dispatch'] }
      : { id: 1, name: 'Office', permissions_set: new Set<string>(['scm.sales.delivery']), position_capabilities: [] }) as never);
    if (driver) c.set('scmWriteBypassed' as never, true as never);
    await next();
  });
  a.patch('/do/:id/status', patchDeliveryOrderStatusHandler as never);
  return { a, row: () => tables.delivery_orders[0]! };
}

const send = (a: Hono, body: Row) => a.request('/do/do-1/status', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const myToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const DELIVERED_COLUMNS = ['status', 'delivery_state', 'customer_delivered_date'] as const;

describe('DELIVERED writes one state for the driver POD and the office Mark delivered', () => {
  test('both callers set status, delivery_state, the delivered day and delivered_at', async () => {
    const pod = app(true);
    expect((await send(pod.a, { status: 'DELIVERED', signatureData: 'sig', podKey: 'k' })).status).toBe(200);
    const office = app(false);
    expect((await send(office.a, { status: 'DELIVERED', podKey: 'k', deliveredOn: myToday() })).status).toBe(200);
    for (const col of DELIVERED_COLUMNS) expect(office.row()[col]).toEqual(pod.row()[col]);
    expect(office.row()).toMatchObject({ status: 'DELIVERED', delivery_state: 'DELIVERED', customer_delivered_date: myToday() });
    expect(office.row().delivered_at).toBeTruthy();
    expect(pod.row().delivered_at).toBeTruthy();
  });

  test('the day picked is stored as the delivered date, not the click time', async () => {
    const office = app(false);
    const picked = new Date(Date.now() + 8 * 3600_000 - 3 * 86400_000).toISOString().slice(0, 10);
    expect((await send(office.a, { status: 'DELIVERED', deliveredOn: picked })).status).toBe(200);
    expect(office.row().customer_delivered_date).toBe(picked);
    expect(office.row().delivered_at).toBe(new Date(`${picked}T12:00:00+08:00`).toISOString());
  });

  test('a future day is refused and nothing changes', async () => {
    const office = app(false);
    const res = await send(office.a, { status: 'DELIVERED', deliveredOn: '2999-01-01' });
    expect(res.status).toBe(400);
    expect(office.row()).toMatchObject({ status: 'DISPATCHED', delivery_state: null, customer_delivered_date: null });
  });
});

describe('deliveredPatch (pure)', () => {
  const now = '2026-10-24T05:00:00.000Z';
  test('no day picked: today in Malaysia, or a day already typed on the planning board', () => {
    expect(deliveredPatch(undefined, now, null)).toEqual({ delivered_at: now, customer_delivered_date: '2026-10-24', delivery_state: 'DELIVERED' });
    expect(deliveredPatch(undefined, now, '2026-10-23')).toMatchObject({ customer_delivered_date: '2026-10-23' });
  });
  test('a picked day wins over the board and stamps noon that day', () => {
    expect(deliveredPatch('2026-10-21', now, '2026-10-23')).toEqual({
      delivered_at: '2026-10-21T04:00:00.000Z', customer_delivered_date: '2026-10-21', delivery_state: 'DELIVERED',
    });
  });
  test('a future or malformed day is invalid', () => {
    expect(deliveredPatch('2026-10-25', now, null)).toBe('invalid');
    expect(deliveredPatch('nope', now, null)).toBe('invalid');
  });
});
