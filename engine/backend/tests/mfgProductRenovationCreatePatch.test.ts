// SKU create / PATCH for the renovation catalog (spec 2026-10-09 section 3).
//
// - A new-group SKU needs a sub-category of that group; a legacy category does not.
// - uom is one of the eight units.
// - A SKU in a photo group (Built-in, Furniture, Lighting, Appliances, Soft) starts
//   INACTIVE and cannot be switched ACTIVE until it has a photo; Works / Service
//   SKUs are ACTIVE at once. A photo read that fails refuses (fails closed).
//
// Harness: a bare Hono app mounting the exported handlers with a fake scm client,
// like skuCategoryChangeAndImport.test.ts.
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { createMfgProductHandler, patchMfgProductHandler } from '../src/scm/routes/mfg-products';
import { SUB_CATEGORIES, UOMS } from '../src/scm/shared/renovation-catalog';

// The sub-category table as migration 0061 seeds it; SKU saves and imports check against it.
// The unit table as migration 0118 seeds it.
const UOM_ROWS = () => UOMS.map((u, i) => ({ code: u.code, label: u.label, print_label: u.printLabel, measure: u.measure, builtin: true, sort_order: (i + 1) * 10, active: true }));
const SUB_ROWS = () => SUB_CATEGORIES.map((s) => ({ group_code: s.group, code: s.code, label: s.label, sort_order: s.sort, legacy_categories: [...(s.legacy ?? [])], active: true }));

const CO = 1;
type Row = Record<string, unknown>;

class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'insert' = 'select';
  private patch: Row = {};
  private inserted: Row[] = [];
  private head = false;
  constructor(private rows: Row[], private failRead = false) {}
  select(_cols?: string, opts?: { head?: boolean }) { if (opts?.head) this.head = true; return this; }
  limit() { return this; }
  order() { return this; }
  range() { return this; }
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
  private result() {
    if (this.failRead && this.op === 'select') return { data: null, count: null, error: { message: 'read failed' } };
    const hit = this.run();
    return { data: this.head ? null : hit, count: hit.length, error: null };
  }
  single() { const r = this.result(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }); }
  maybeSingle() { return this.single(); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    return Promise.resolve(this.result()).then(res, rej);
  }
}

function harness(opts: { failPhotoRead?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    product_sub_categories: SUB_ROWS(),
    product_uoms: UOM_ROWS(),
    mfg_products: [
      { id: 'p-sofa', company_id: CO, code: 'SOFA-1', name: 'SOFA ONE', category: 'SOFA', sub_category: 'SOFA', model_id: null, status: 'ACTIVE', uom: 'UNIT' },
      { id: 'p-ward', company_id: CO, code: 'WR-1', name: 'Wardrobe 8ft', category: 'BUILTIN', sub_category: 'WARDROBE', model_id: null, status: 'INACTIVE', uom: 'UNIT' },
      { id: 'p-tv', company_id: CO, code: 'TV-55', name: 'TV 55', category: 'APPLIANCE', sub_category: 'TV', model_id: null, status: 'INACTIVE', uom: 'UNIT' },
      { id: 'p-hack', company_id: CO, code: 'HK-1', name: 'Hacking wall', category: 'WORKS', sub_category: 'HACKING', model_id: null, status: 'ACTIVE', uom: 'LOT' },
    ],
    product_models: [],
    mfg_product_photos: [
      { id: 'ph-1', company_id: CO, product_id: 'p-tv', r2_key: 'mfg-product-photos/p-tv/a.jpg', is_primary: true, sort_order: 0 },
    ],
    master_price_history: [],
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, {
      from: (t: string) => new FakeQuery((tables[t] ||= []), t === 'mfg_product_photos' && !!opts.failPhotoRead),
    } as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'Tester', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.post('/mfg-products', createMfgProductHandler as never);
  app.patch('/mfg-products/:id', patchMfgProductHandler as never);
  const send = async (method: string, path: string, body: unknown) => {
    const res = await app.request(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const sku = (code: string) => tables.mfg_products.find((r) => r.code === code)!;
  return { send, sku, tables };
}

describe('POST /mfg-products — renovation categories', () => {
  test('a Works SKU with its trade is created ACTIVE with its unit', async () => {
    const { send, sku } = harness();
    const r = await send('POST', '/mfg-products', { code: 'EL-PT', name: 'Lighting point', category: 'WORKS', subCategory: 'electrical', uom: 'point' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('ACTIVE');
    expect(sku('EL-PT')).toMatchObject({ category: 'WORKS', sub_category: 'ELECTRICAL', uom: 'POINT', status: 'ACTIVE' });
  });

  test('a Built-in SKU starts INACTIVE until it has a photo', async () => {
    const { send, sku } = harness();
    const r = await send('POST', '/mfg-products', { code: 'KC-1', name: 'Kitchen cabinet 10ft', category: 'BUILTIN', subCategory: 'KITCHEN_CABINET' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('INACTIVE');
    expect(r.body.needsPhoto).toBe(true);
    expect(sku('KC-1').status).toBe('INACTIVE');
  });

  test('a new group without a sub-category, or with another group\'s, is refused', async () => {
    const { send, tables } = harness();
    const before = tables.mfg_products.length;
    const a = await send('POST', '/mfg-products', { code: 'X1', name: 'x', category: 'WORKS' });
    expect(a.status).toBe(400);
    expect(a.body.error).toBe('sub_category_required');
    const b = await send('POST', '/mfg-products', { code: 'X2', name: 'x', category: 'WORKS', subCategory: 'WARDROBE' });
    expect(b.status).toBe(400);
    expect(b.body.error).toBe('sub_category_mismatch');
    expect(tables.mfg_products.length).toBe(before);
  });

  test('an unknown unit is refused', async () => {
    const { send } = harness();
    const r = await send('POST', '/mfg-products', { code: 'X3', name: 'x', category: 'WORKS', subCategory: 'PAINTING', uom: 'TIN' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_uom');
  });

  test('a legacy category still needs no sub-category and is ACTIVE (no photo rule)', async () => {
    const { send, sku } = harness();
    const r = await send('POST', '/mfg-products', { code: 'MAT-1', name: 'Mattress Q', category: 'MATTRESS' });
    expect(r.status).toBe(201);
    expect(sku('MAT-1').status).toBe('ACTIVE');
  });
});

describe('PATCH /mfg-products/:id — renovation fields', () => {
  test('activating a photo-group SKU with no photo is refused with photo_required', async () => {
    const { send, sku } = harness();
    const r = await send('PATCH', '/mfg-products/p-ward', { status: 'ACTIVE' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('photo_required');
    expect(sku('WR-1').status).toBe('INACTIVE');
  });

  test('activating a photo-group SKU that has a photo works', async () => {
    const { send, sku } = harness();
    const r = await send('PATCH', '/mfg-products/p-tv', { status: 'ACTIVE' });
    expect(r.status).toBe(200);
    expect(sku('TV-55').status).toBe('ACTIVE');
  });

  test('a photo read that fails refuses the activation (503), it never reads as "has a photo"', async () => {
    const { send, sku } = harness({ failPhotoRead: true });
    const r = await send('PATCH', '/mfg-products/p-tv', { status: 'ACTIVE' });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('photo_check_failed');
    expect(sku('TV-55').status).toBe('INACTIVE');
  });

  test('sub-category and unit change; a sub from another group is refused', async () => {
    const { send, sku } = harness();
    expect((await send('PATCH', '/mfg-products/p-hack', { subCategory: 'PLUMBING', uom: 'FT' })).status).toBe(200);
    expect(sku('HK-1')).toMatchObject({ sub_category: 'PLUMBING', uom: 'FT' });
    const bad = await send('PATCH', '/mfg-products/p-hack', { subCategory: 'SOFA' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('sub_category_mismatch');
    expect(sku('HK-1').sub_category).toBe('PLUMBING');
    expect((await send('PATCH', '/mfg-products/p-hack', { uom: 'BAG' })).body.error).toBe('invalid_uom');
  });

  test('moving into a new group needs the sub-category in the same request', async () => {
    const { send, sku } = harness();
    const r = await send('PATCH', '/mfg-products/p-hack', { category: 'LIGHTING' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('sub_category_required');
    expect(sku('HK-1').category).toBe('WORKS');
  });

  test('moving an ACTIVE Works SKU into a photo group without a photo is refused', async () => {
    const { send, sku } = harness();
    const r = await send('PATCH', '/mfg-products/p-hack', { category: 'LIGHTING', subCategory: 'DOWNLIGHT' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('photo_required');
    expect(sku('HK-1').category).toBe('WORKS');
  });

  test('a legacy SKU still moves between legacy categories without a sub-category', async () => {
    const { send, sku } = harness();
    expect((await send('PATCH', '/mfg-products/p-sofa', { category: 'MATTRESS' })).status).toBe(200);
    expect(sku('SOFA-1').category).toBe('MATTRESS');
  });
});
