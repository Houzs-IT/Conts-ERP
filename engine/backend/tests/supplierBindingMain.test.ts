// One main supplier per SKU (renovation catalog "Binding", migration 0063).
// - The first binding of a SKU becomes its main supplier (its default PO party).
// - The batch create demotes the old main when a row asks to be main.
// - A clash on the database's one-main index is a 409, not a 500.
// The fake enforces the unique index the way Postgres does (23505).
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  createSupplierBindingHandler,
  createSupplierBindingsBatchHandler,
  patchSupplierBindingHandler,
} from '../src/scm/routes/suppliers';

type Row = Record<string, any>;
const oneMainViolated = (rows: Row[]) => {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.is_main_supplier) continue;
    const k = `${r.company_id}|${r.material_kind}|${r.item_code}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
};

class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'insert' = 'select';
  private patch: Row = {};
  private inserted: Row[] = [];
  constructor(private table: string, private tables: Record<string, Row[]>, private seq: { n: number }, private race = false) {}
  private get rows() { return (this.tables[this.table] ||= []); }
  select() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  update(p: Row) { this.op = 'update'; this.patch = p; return this; }
  insert(p: Row | Row[]) {
    this.op = 'insert';
    this.inserted = (Array.isArray(p) ? p : [p]).map((r) => ({ id: r.id ?? `b-${++this.seq.n}`, ...r }));
    return this;
  }
  eq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) === String(val)); return this; }
  neq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) !== String(val)); return this; }
  in(col: string, vals: unknown[]) { const s = new Set(vals.map(String)); this.preds.push((r) => s.has(String(r[col]))); return this; }
  filter(col: string, op: string, val: string) {
    if (op === 'in') { const s = new Set(val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))); this.preds.push((r) => s.has(String(r[col]))); }
    return this;
  }
  private run(): { data: Row[]; error: { code: string; message: string } | null } {
    if (this.op === 'insert') {
      const next = [...this.rows, ...this.inserted];
      if (this.table === 'supplier_material_bindings' && (this.race || oneMainViolated(next))) {
        return { data: [], error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_smb_one_main"' } };
      }
      this.rows.push(...this.inserted);
      return { data: this.inserted, error: null };
    }
    const hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === 'update') {
      const before = hit.map((r) => ({ ...r }));
      for (const r of hit) Object.assign(r, this.patch);
      if (this.table === 'supplier_material_bindings' && (oneMainViolated(this.rows) || (this.race && this.patch.is_main_supplier === true))) {
        hit.forEach((r, i) => Object.assign(r, before[i]));
        return { data: [], error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_smb_one_main"' } };
      }
    }
    return { data: hit, error: null };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ data: r.data[0] ?? null, error: r.error }); }
  single() { return this.maybeSingle(); }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }
}

/* race: every insert, and every promote-to-main patch, meets a main written by
   another request between our demotion and our write. */
function harness(bindings: Row[] = [], race = false) {
  const tables: Record<string, Row[]> = {
    suppliers: [{ id: 's1', company_id: 1 }, { id: 's2', company_id: 1 }, { id: 's3', company_id: 1 }],
    supplier_material_bindings: bindings.map((b) => ({ company_id: 1, material_kind: 'mfg_product', ...b })),
  };
  const seq = { n: 0 };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, { from: (t: string) => new FakeQuery(t, tables, seq, race), rpc: async () => ({ data: true, error: null }) } as never);
    c.set('companyId' as never, 1 as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'T', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.post('/suppliers/:id/bindings', createSupplierBindingHandler as never);
  app.post('/suppliers/:id/bindings/batch', createSupplierBindingsBatchHandler as never);
  app.patch('/suppliers/:id/bindings/:bindingId', patchSupplierBindingHandler as never);
  const send = async (method: string, path: string, body: Row) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Row };
  };
  const mains = (code: string) => tables.supplier_material_bindings.filter((b) => b.item_code === code && b.is_main_supplier).map((b) => b.supplier_id);
  return { send, mains, tables };
}

const body = (itemCode: string, extra: Row = {}) => ({ materialKind: 'mfg_product', itemCode, materialName: itemCode, supplierSku: `X-${itemCode}`, ...extra });

describe('single binding create', () => {
  test('the first binding of a SKU becomes its main supplier', async () => {
    const { send, mains } = harness();
    const r = await send('POST', '/suppliers/s1/bindings', body('HK-1'));
    expect(r.status).toBe(201);
    expect(r.body.binding.is_main_supplier).toBe(true);
    expect(mains('HK-1')).toEqual(['s1']);
  });

  test('a later binding stays secondary unless asked', async () => {
    const { send, mains } = harness([{ id: 'b0', supplier_id: 's1', item_code: 'HK-1', is_main_supplier: true }]);
    expect((await send('POST', '/suppliers/s2/bindings', body('HK-1'))).body.binding.is_main_supplier).toBe(false);
    expect(mains('HK-1')).toEqual(['s1']);
    await send('POST', '/suppliers/s3/bindings', body('HK-1', { isMainSupplier: true }));
    expect(mains('HK-1')).toEqual(['s3']);
  });
});

describe('batch binding create', () => {
  test('SKUs with no binding get this supplier as main; a row asking to be main demotes the old one', async () => {
    const { send, mains } = harness([{ id: 'b0', supplier_id: 's1', item_code: 'EL-1', is_main_supplier: true }]);
    const r = await send('POST', '/suppliers/s2/bindings/batch', { bindings: [body('PB-1'), body('EL-1', { isMainSupplier: true })] });
    expect(r.status).toBe(201);
    expect(mains('PB-1')).toEqual(['s2']);
    expect(mains('EL-1')).toEqual(['s2']);
  });

  test('a batch row not asking to be main leaves an existing main alone', async () => {
    const { send, mains } = harness([{ id: 'b0', supplier_id: 's1', item_code: 'EL-1', is_main_supplier: true }]);
    await send('POST', '/suppliers/s2/bindings/batch', { bindings: [body('EL-1')] });
    expect(mains('EL-1')).toEqual(['s1']);
  });
});

describe('one-main clash (a racing writer)', () => {
  test('create answers 409 main_supplier_conflict instead of 500', async () => {
    const { send } = harness([], true);
    const r = await send('POST', '/suppliers/s1/bindings', body('HK-1', { isMainSupplier: true }));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('main_supplier_conflict');
  });

  test('batch create answers 409 main_supplier_conflict instead of 500', async () => {
    const { send } = harness([], true);
    const r = await send('POST', '/suppliers/s1/bindings/batch', { bindings: [body('HK-1')] });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('main_supplier_conflict');
  });

  test('promote answers 409 main_supplier_conflict instead of 500', async () => {
    const { send } = harness([{ id: 'b2', supplier_id: 's2', item_code: 'HK-1', is_main_supplier: false }], true);
    const r = await send('PATCH', '/suppliers/s2/bindings/b2', { isMainSupplier: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('main_supplier_conflict');
  });
});
