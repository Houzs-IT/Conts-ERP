/* A STATUS WRITE IS A COMPARE-AND-SET ON THE STATUS IT READ.
 *
 * The Sales Invoice and Delivery Return status handlers read the current status, check the move is legal, then
 * wrote the new status with no condition on the old one (only the CANCELLED branch had one). A cancel landing
 * between that read and the write was overwritten: the invoice or return came back from CANCELLED while its revenue
 * or stock reversal had already run. The write now carries `.eq('status', <status read>)` and answers 409
 * status_changed when it matches nothing. Same shape as Houzs 50daf5a35 (delivery-return status CAS).
 */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { patchDeliveryReturnStatusHandler } from '../src/scm/routes/delivery-returns';
import { patchSalesInvoiceStatusHandler } from '../src/scm/routes/sales-invoices';

const CO = 1;
type Row = Record<string, any>;

export class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'delete' | 'insert' = 'select';
  private patch: Row = {};
  private inserted: Row[] = [];
  private wantCount = false;
  constructor(private rows: Row[], private seq: { n: number }) {}
  select(_cols?: string, opts?: { head?: boolean; count?: string }) {
    if (opts?.count) this.wantCount = true;
    return this;
  }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  ilike() { return this; }
  update(p: Row) { this.op = 'update'; this.patch = p; return this; }
  delete() { this.op = 'delete'; return this; }
  insert(p: Row | Row[]) {
    this.op = 'insert';
    this.inserted = (Array.isArray(p) ? p : [p]).map((r) => (r.id ? r : { ...r, id: `row-${++this.seq.n}` }));
    return this;
  }
  eq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) === String(val)); return this; }
  neq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) !== String(val)); return this; }
  in(col: string, vals: unknown[]) {
    const s = new Set((vals ?? []).map(String));
    this.preds.push((r) => s.has(String(r[col])));
    return this;
  }
  gte() { return this; }
  lte() { return this; }
  not() { return this; }
  like() { return this; }
  is() { return this; }
  or() { return this; }
  private run(): Row[] {
    if (this.op === 'insert') { this.rows.push(...this.inserted); return this.inserted; }
    const hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === 'update') for (const r of hit) Object.assign(r, this.patch);
    if (this.op === 'delete') for (const r of hit) this.rows.splice(this.rows.indexOf(r), 1);
    return hit;
  }
  maybeSingle() {
    const h = this.run();
    return Promise.resolve({ data: h[0] ?? null, error: null });
  }
  single() {
    const h = this.run();
    // PostgREST answers zero rows with PGRST116, NOT with data:null.
    return Promise.resolve({ data: h[0] ?? null, error: h.length ? null : { message: 'PGRST116: no rows' } });
  }
  then(res: (v: any) => any, rej?: (e: any) => any) {
    const hit = this.run();
    const out = this.wantCount
      ? { data: hit, count: hit.length, error: null }
      : { data: hit, error: null };
    return Promise.resolve(out).then(res, rej);
  }
}


/* The race: the first UPDATE on `racedTable` finds the row already cancelled by someone else. */
function harness(tables: Record<string, Row[]>, racedTable: string) {
  const seq = { n: 0 };
  let raced = false;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, {
      from: (t: string) => {
        const q = new FakeQuery((tables[t] ||= []), seq);
        if (t === racedTable) {
          const update = q.update.bind(q);
          (q as any).update = (p: Row) => {
            if (!raced) { raced = true; for (const r of tables[t]) r.status = 'CANCELLED'; }
            return update(p);
          };
        }
        return q;
      },
      rpc: async () => ({ data: null, error: null }),
    } as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1', user_metadata: { name: 'Tester' } } as never);
    c.set('houzsUser' as never, { id: 9, name: 'Tester', permissions: ['*'] } as never);
    await next();
  });
  app.patch('/delivery-returns/:id/status', patchDeliveryReturnStatusHandler as never);
  app.patch('/sales-invoices/:id/status', patchSalesInvoiceStatusHandler as never);
  return app;
}

const patch = (app: Hono, url: string, body: Row) =>
  app.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('a status move that lost the race to a cancel', () => {
  test('a delivery return stays CANCELLED and the late move gets 409', async () => {
    const tables: Record<string, Row[]> = {
      delivery_returns: [{ id: 'dr-1', company_id: CO, return_number: 'DR-1', status: 'RECEIVED', warehouse_id: 'wh-1' }],
    };
    const res = await patch(harness(tables, 'delivery_returns'), '/delivery-returns/dr-1/status', { status: 'INSPECTED' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'status_changed' });
    expect(tables.delivery_returns[0]!.status).toBe('CANCELLED');
  });

  test('a sales invoice stays CANCELLED and the late move gets 409', async () => {
    const tables: Record<string, Row[]> = {
      sales_invoices: [{ id: 'si-1', company_id: CO, invoice_number: 'SI-1', status: 'SENT', paid_sen: 0, total_sen: 1000 }],
    };
    // OVERDUE: PAID by hand is now refused before the write when nothing is paid (status_follows_money).
    const res = await patch(harness(tables, 'sales_invoices'), '/sales-invoices/si-1/status', { status: 'OVERDUE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'status_changed' });
    expect(tables.sales_invoices[0]!.status).toBe('CANCELLED');
  });

  test('without a race the move still lands', async () => {
    const tables: Record<string, Row[]> = {
      delivery_returns: [{ id: 'dr-1', company_id: CO, return_number: 'DR-1', status: 'RECEIVED', warehouse_id: 'wh-1' }],
    };
    const res = await patch(harness(tables, 'none'), '/delivery-returns/dr-1/status', { status: 'INSPECTED' });
    expect(res.status).toBe(200);
    expect(tables.delivery_returns[0]!.status).toBe('INSPECTED');
  });
});
