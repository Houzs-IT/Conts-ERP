// Import SKUs with the renovation columns (sub category, uom).
// Same create-vs-edit contract as before: a code the system does not hold is a
// NEW SKU, a code it holds is an EDIT, and only filled cells are written.
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { batchImportMfgProductsHandler } from '../src/scm/routes/mfg-products';
import { SUB_CATEGORIES, parseSubCategory, parseUom, UOMS } from '../src/scm/shared/renovation-catalog';

// The sub-category table as migration 0061 seeds it; SKU saves and imports check against it.
// The unit table as migration 0118 seeds it.
const UOM_ROWS = () => UOMS.map((u, i) => ({ code: u.code, label: u.label, print_label: u.printLabel, measure: u.measure, builtin: true, sort_order: (i + 1) * 10, active: true }));
const SUB_ROWS = () => SUB_CATEGORIES.map((s) => ({ group_code: s.group, code: s.code, label: s.label, sort_order: s.sort, legacy_categories: [...(s.legacy ?? [])], active: true }));

type Row = Record<string, unknown>;
class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'insert' = 'select';
  private patch: Row = {};
  private inserted: Row[] = [];
  private head = false;
  constructor(private rows: Row[]) {}
  select(_c?: string, o?: { head?: boolean }) { if (o?.head) this.head = true; return this; }
  limit() { return this; }
  order() { return this; }
  update(p: Row) { this.op = 'update'; this.patch = p; return this; }
  insert(p: Row | Row[]) { this.op = 'insert'; this.inserted = Array.isArray(p) ? p : [p]; return this; }
  eq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) === String(val)); return this; }
  in(col: string, vals: unknown[]) { const s = new Set(vals.map(String)); this.preds.push((r) => s.has(String(r[col]))); return this; }
  neq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) !== String(val)); return this; }
  private run(): Row[] {
    if (this.op === 'insert') { this.rows.push(...this.inserted); return this.inserted; }
    const hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === 'update') for (const r of hit) Object.assign(r, this.patch);
    return hit;
  }
  private result() { const hit = this.run(); return { data: this.head ? null : hit, count: hit.length, error: null }; }
  maybeSingle() { const r = this.result(); return Promise.resolve({ ...r, data: (r.data as Row[] | null)?.[0] ?? null }); }
  single() { return this.maybeSingle(); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.result()).then(res, rej); }
}

function harness() {
  const tables: Record<string, Row[]> = {
    product_sub_categories: SUB_ROWS(),
    product_uoms: UOM_ROWS(),
    mfg_products: [
      { id: 'p-hk', company_id: 1, code: 'HK-1', name: 'Hacking', category: 'WORKS', sub_category: 'HACKING', uom: 'LOT', status: 'ACTIVE', model_id: null },
      { id: 'p-wr', company_id: 1, code: 'WR-1', name: 'Wardrobe', category: 'BUILTIN', sub_category: 'WARDROBE', uom: 'UNIT', status: 'INACTIVE', model_id: null },
      { id: 'p-m1', company_id: 1, code: 'SV-A', name: 'Service A', category: 'SERVICE', sub_category: null, uom: 'UNIT', status: 'ACTIVE', model_id: 'm-1' },
      { id: 'p-m2', company_id: 1, code: 'SV-B', name: 'Service B', category: 'SERVICE', sub_category: null, uom: 'UNIT', status: 'ACTIVE', model_id: 'm-1' },
    ],
    product_models: [{ id: 'm-1', company_id: 1, model_code: 'SV', name: 'Service', category: 'SERVICE' }],
    mfg_product_photos: [],
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, { from: (t: string) => new FakeQuery((tables[t] ||= [])) } as never);
    c.set('companyId' as never, 1 as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'T', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.post('/import', batchImportMfgProductsHandler as never);
  const run = async (rows: Row[]) => {
    const res = await app.request('/import', { method: 'POST', body: JSON.stringify({ rows }), headers: { 'content-type': 'application/json' } });
    return (await res.json()) as { upserted: number; failures: Array<{ code: string; reason: string }> };
  };
  const sku = (code: string) => tables.mfg_products.find((r) => r.code === code);
  return { run, sku };
}

describe('parsers', () => {
  test('sub-category by code or label, any case', () => {
    expect(parseSubCategory('Plaster ceiling')).toBe('PLASTER_CEILING');
    expect(parseSubCategory('plaster_ceiling')).toBe('PLASTER_CEILING');
    expect(parseSubCategory('Kitchen cabinet')).toBe('KITCHEN_CABINET');
    expect(parseSubCategory('nope')).toBeNull();
    expect(parseSubCategory('')).toBeNull();
  });
  test('uom by code, label or print label', () => {
    expect(parseUom('sqft')).toBe('SQFT');
    expect(parseUom('LS')).toBe('LOT');
    expect(parseUom('Lump sum')).toBe('LOT');
    expect(parseUom('full unit')).toBe('FULL');
    expect(parseUom('tin')).toBeNull();
  });
});

describe('POST /mfg-products/batch-import — renovation columns', () => {
  test('a new Works SKU takes its trade and unit and is ACTIVE', async () => {
    const { run, sku } = harness();
    const out = await run([{ code: 'EL-1', name: 'Lighting point', category: 'Works', sub_category: 'Electrical', uom: 'point' }]);
    expect(out.failures).toEqual([]);
    expect(sku('EL-1')).toMatchObject({ category: 'WORKS', sub_category: 'ELECTRICAL', uom: 'POINT' });
    expect(sku('EL-1')!.status).not.toBe('INACTIVE');
  });

  test('a new Built-in SKU is created INACTIVE even when the sheet says ACTIVE', async () => {
    const { run, sku } = harness();
    const out = await run([{ code: 'KC-1', name: 'Kitchen 10ft', category: 'BUILTIN', subCategory: 'KITCHEN_CABINET', status: 'ACTIVE' }]);
    expect(out.upserted).toBe(1);
    expect(sku('KC-1')!.status).toBe('INACTIVE');
  });

  test('a new-group SKU without a sub-category is reported, not created', async () => {
    const { run, sku } = harness();
    const out = await run([{ code: 'X-1', name: 'x', category: 'WORKS' }]);
    expect(out.upserted).toBe(0);
    expect(out.failures[0].reason).toMatch(/sub-category/i);
    expect(sku('X-1')).toBeUndefined();
  });

  test('a sub-category from another group, or an unreadable one, is reported', async () => {
    const { run } = harness();
    const out = await run([
      { code: 'HK-1', sub_category: 'Wardrobe' },
      { code: 'HK-1', sub_category: 'Bricks' },
      { code: 'HK-1', uom: 'tin' },
    ]);
    expect(out.upserted).toBe(0);
    expect(out.failures.map((f) => f.reason)).toEqual([
      expect.stringMatching(/does not belong/i),
      expect.stringMatching(/not a sub-category/i),
      expect.stringMatching(/not a unit/i),
    ]);
  });

  test('an existing SKU changes only the filled renovation cells', async () => {
    const { run, sku } = harness();
    const out = await run([{ code: 'HK-1', sub_category: 'Plumbing' }, { code: 'WR-1', uom: 'set' }]);
    expect(out.failures).toEqual([]);
    expect(sku('HK-1')).toMatchObject({ sub_category: 'PLUMBING', uom: 'LOT', name: 'Hacking' });
    expect(sku('WR-1')).toMatchObject({ uom: 'SET', sub_category: 'WARDROBE' });
  });

  test('moving a modelled SKU into a new group moves the model and every SKU with the given sub-category', async () => {
    const { run, sku } = harness();
    const out = await run([{ code: 'SV-A', category: 'WORKS', sub_category: 'Cleaning' }]);
    expect(out.failures).toEqual([]);
    expect(sku('SV-A')).toMatchObject({ category: 'WORKS', sub_category: 'CLEANING' });
    expect(sku('SV-B')).toMatchObject({ category: 'WORKS', sub_category: 'CLEANING' });
  });

  test('activating a photo-group SKU with no photo is reported', async () => {
    const { run, sku } = harness();
    const out = await run([{ code: 'WR-1', status: 'ACTIVE' }]);
    expect(out.upserted).toBe(0);
    expect(out.failures[0].reason).toMatch(/photo/i);
    expect(sku('WR-1')!.status).toBe('INACTIVE');
  });
});
