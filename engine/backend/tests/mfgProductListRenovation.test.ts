// GET /mfg-products filters for the renovation SKU Master.
//
// - ?group= / ?sub= filter on the derived category_group / sub_category.
// - ?status=all includes INACTIVE SKUs (a Built-in SKU waiting for its photo must
//   be findable) and is never cached; the default stays ACTIVE-only + 60s cache
//   for the SO / PO pickers.
// - ?withPhotos=1 adds the primary photo url and count; ?withMain=1 adds the main
//   supplier (cost only for cost viewers).
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { listMfgProductsHandler } from '../src/scm/routes/mfg-products';

type Row = Record<string, unknown>;
class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private _range: [number, number] | null = null;
  constructor(private rows: Row[]) {}
  select() { return this; }
  order() { return this; }
  or() { return this; }
  eq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) === String(val)); return this; }
  in(col: string, vals: unknown[]) { const s = new Set(vals.map(String)); this.preds.push((r) => s.has(String(r[col]))); return this; }
  filter(col: string, op: string, val: string) {
    if (op === 'in') {
      const s = new Set(val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')));
      this.preds.push((r) => s.has(String(r[col])));
    }
    return this;
  }
  range(from: number, to: number) { this._range = [from, to]; return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    let out = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this._range) out = out.slice(this._range[0], this._range[1] + 1);
    return Promise.resolve({ data: out, error: null }).then(res, rej);
  }
}

const tables: Record<string, Row[]> = {
  mfg_products: [
    { id: 'p1', code: 'HK-1', name: 'Hacking', category: 'WORKS', category_group: 'WORKS', sub_category: 'HACKING', uom: 'LOT', status: 'ACTIVE', company_id: 1 },
    { id: 'p2', code: 'EL-1', name: 'Point', category: 'WORKS', category_group: 'WORKS', sub_category: 'ELECTRICAL', uom: 'POINT', status: 'ACTIVE', company_id: 1 },
    { id: 'p3', code: 'WR-1', name: 'Wardrobe', category: 'BUILTIN', category_group: 'BUILTIN', sub_category: 'WARDROBE', uom: 'UNIT', status: 'INACTIVE', company_id: 1 },
    { id: 'p4', code: 'SOFA-1', name: 'Sofa', category: 'SOFA', category_group: 'FURNITURE', sub_category: 'SOFA', uom: 'UNIT', status: 'ACTIVE', company_id: 1 },
  ],
  mfg_product_photos: [
    { product_id: 'p3', r2_key: 'mfg-product-photos/p3/b.jpg', thumb_key: null, is_primary: false, sort_order: 1, company_id: 1 },
    { product_id: 'p3', r2_key: 'mfg-product-photos/p3/a.jpg', thumb_key: 'mfg-product-photos/p3/a.jpg.thumb', is_primary: true, sort_order: 0, company_id: 1 },
  ],
  supplier_material_bindings: [
    { id: 'b1', material_kind: 'mfg_product', item_code: 'HK-1', supplier_id: 's1', is_main_supplier: true, unit_price_sen: 50000, company_id: 1 },
    { id: 'b2', material_kind: 'mfg_product', item_code: 'HK-1', supplier_id: 's2', is_main_supplier: false, unit_price_sen: 45000, company_id: 1 },
    { id: 'b3', material_kind: 'mfg_product', item_code: 'EL-1', supplier_id: 's2', is_main_supplier: false, unit_price_sen: 8000, company_id: 1 },
  ],
  suppliers: [
    { id: 's1', name: 'Ah Seng Renovation', company_id: 1 },
    { id: 's2', name: 'Bright Electrical', company_id: 1 },
  ],
};

async function get(path: string, perms: string[] = ['*']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, { from: (t: string) => new FakeQuery(tables[t] ?? []) } as never);
    c.set('companyId' as never, 1 as never);
    c.set('houzsUser' as never, { id: 9, name: 'T', permissions_set: new Set(perms) } as never);
    await next();
  });
  app.get('/mfg-products', listMfgProductsHandler as never);
  const res = await app.request(path);
  return { res, products: ((await res.json()) as { products: Row[] }).products };
}

describe('GET /mfg-products — renovation filters', () => {
  test('default stays ACTIVE-only and cached for the pickers', async () => {
    const { res, products } = await get('/mfg-products');
    expect(products.map((p) => p.code).sort()).toEqual(['EL-1', 'HK-1', 'SOFA-1']);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });

  test('?status=all includes INACTIVE and is not cached', async () => {
    const { res, products } = await get('/mfg-products?status=all');
    expect(products.map((p) => p.code).sort()).toEqual(['EL-1', 'HK-1', 'SOFA-1', 'WR-1']);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('?group= filters on the derived group, so legacy SOFA is FURNITURE', async () => {
    expect((await get('/mfg-products?group=FURNITURE')).products.map((p) => p.code)).toEqual(['SOFA-1']);
    expect((await get('/mfg-products?group=works&sub=electrical')).products.map((p) => p.code)).toEqual(['EL-1']);
  });

  test('rows carry group, sub-category and unit', async () => {
    const { products } = await get('/mfg-products?group=WORKS&sub=HACKING');
    expect(products[0]).toMatchObject({ category_group: 'WORKS', sub_category: 'HACKING', uom: 'LOT' });
  });

  test('?withPhotos=1 adds the primary photo and the count', async () => {
    const { products } = await get('/mfg-products?status=all&withPhotos=1');
    const wr = products.find((p) => p.code === 'WR-1')!;
    expect(wr.photoCount).toBe(2);
    expect(wr.primaryPhotoUrl).toBe('/api/scm/mfg-products/p3/photo/' + encodeURIComponent('mfg-product-photos/p3/a.jpg'));
    expect(wr.primaryThumbUrl).toContain(encodeURIComponent('a.jpg.thumb'));
    expect(products.find((p) => p.code === 'HK-1')!.photoCount).toBe(0);
  });

  test('?withMain=1 adds the default PO party; cost only for cost viewers', async () => {
    const { products } = await get('/mfg-products?withMain=1');
    const hk = products.find((p) => p.code === 'HK-1')!;
    expect(hk).toMatchObject({ mainSupplierId: 's1', mainSupplierName: 'Ah Seng Renovation', mainCostSen: 50000, supplierCount: 2 });
    const el = products.find((p) => p.code === 'EL-1')!;
    expect(el).toMatchObject({ mainSupplierId: 's2', mainSupplierName: 'Bright Electrical', supplierCount: 1 });
    expect(products.find((p) => p.code === 'SOFA-1')!).toMatchObject({ mainSupplierId: null, supplierCount: 0 });

    const noCost = await get('/mfg-products?withMain=1', ['scm.read']);
    const hk2 = noCost.products.find((p) => p.code === 'HK-1')!;
    expect(hk2.mainSupplierName).toBe('Ah Seng Renovation');
    expect('mainCostSen' in hk2).toBe(false);
  });
});
