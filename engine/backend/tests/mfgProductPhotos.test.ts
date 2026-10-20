// SKU photos (migration 0062): upload / list / primary / delete, the last-photo
// rule for active photo-group SKUs, the public proxy's key check, and R2 cleanup
// when a SKU is deleted.
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  deleteMfgProductPhotoHandler,
  listMfgProductPhotosHandler,
  mfgProductPhotoProxyHandler,
  patchMfgProductPhotoHandler,
  uploadMfgProductPhotoHandler,
} from '../src/scm/routes/mfg-product-photos';
import { deleteMfgProductHandler } from '../src/scm/routes/mfg-products';
import { publicScmImages } from '../src/scm/routes/public-images';

type Row = Record<string, unknown>;
class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  private patch: Row = {};
  private inserted: Row[] = [];
  private head = false;
  constructor(private tbl: { rows: Row[] }) {}
  select(_c?: string, o?: { head?: boolean }) { if (o?.head) this.head = true; return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  update(p: Row) { this.op = 'update'; this.patch = p; return this; }
  insert(p: Row | Row[]) { this.op = 'insert'; this.inserted = (Array.isArray(p) ? p : [p]).map((r) => ({ id: `ph-${Math.random().toString(36).slice(2, 8)}`, ...r })); return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) === String(val)); return this; }
  in(col: string, vals: unknown[]) { const s = new Set(vals.map(String)); this.preds.push((r) => s.has(String(r[col]))); return this; }
  neq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) !== String(val)); return this; }
  private run(): Row[] {
    if (this.op === 'insert') { this.tbl.rows.push(...this.inserted); return this.inserted; }
    const hit = this.tbl.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === 'update') for (const r of hit) Object.assign(r, this.patch);
    if (this.op === 'delete') this.tbl.rows = this.tbl.rows.filter((r) => !hit.includes(r));
    return hit;
  }
  private result() { const hit = this.run(); return { data: this.head ? null : hit, count: hit.length, error: null }; }
  single() { const r = this.result(); return Promise.resolve({ ...r, data: (r.data as Row[] | null)?.[0] ?? null }); }
  maybeSingle() { return this.single(); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.result()).then(res, rej); }
}

class FakeBucket {
  objects = new Map<string, { body: ArrayBuffer; type: string }>();
  async put(k: string, body: ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }) { this.objects.set(k, { body, type: o?.httpMetadata?.contentType ?? '' }); }
  async get(k: string) { const o = this.objects.get(k); return o ? { body: o.body, httpMetadata: { contentType: o.type } } : null; }
  async delete(k: string) { this.objects.delete(k); }
}

function harness() {
  const t: Record<string, { rows: Row[] }> = {
    mfg_products: { rows: [
      { id: 'p-tv', company_id: 1, code: 'TV-55', category: 'APPLIANCE', status: 'ACTIVE' },
      { id: 'p-new', company_id: 1, code: 'KC-1', category: 'BUILTIN', status: 'INACTIVE' },
      { id: 'p-other', company_id: 2, code: 'X', category: 'BUILTIN', status: 'INACTIVE' },
    ] },
    mfg_product_photos: { rows: [
      { id: 'ph-1', company_id: 1, product_id: 'p-tv', r2_key: 'mfg-product-photos/p-tv/a.jpg', thumb_key: null, is_primary: true, sort_order: 0 },
    ] },
  };
  const bucket = new FakeBucket();
  bucket.objects.set('mfg-product-photos/p-tv/a.jpg', { body: new TextEncoder().encode('JPEG').buffer, type: 'image/jpeg' });
  const sb = { from: (name: string) => new FakeQuery((t[name] ||= { rows: [] })) };
  const env = { SO_ITEM_PHOTOS: bucket };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, 1 as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'T', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.get('/mfg-products/:id/photos', listMfgProductPhotosHandler as never);
  app.post('/mfg-products/:id/photos', uploadMfgProductPhotoHandler as never);
  app.delete('/mfg-products/:id/photos/:photoId', deleteMfgProductPhotoHandler as never);
  app.patch('/mfg-products/:id/photos/:photoId', patchMfgProductPhotoHandler as never);
  app.delete('/mfg-products/:id', deleteMfgProductHandler as never);
  app.get('/pub/mfg-products/:id/photo/:key', mfgProductPhotoProxyHandler as never);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env);
  const upload = (id: string) => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));
    return req(`/mfg-products/${id}/photos`, { method: 'POST', body: fd });
  };
  return { t, bucket, req, upload };
}

describe('SKU photo routes', () => {
  test('the first upload is primary, stored under the SKU prefix, served by a public url', async () => {
    const { req, upload, bucket } = harness();
    const res = await upload('p-new');
    expect(res.status).toBe(200);
    const { photo } = (await res.json()) as { photo: { key: string; url: string; is_primary: boolean } };
    expect(photo.is_primary).toBe(true);
    expect(photo.key).toMatch(/^mfg-product-photos\/p-new\/[0-9a-f-]+\.jpg$/);
    expect(photo.url).toBe(`/api/scm/mfg-products/p-new/photo/${encodeURIComponent(photo.key)}`);
    expect(bucket.objects.has(photo.key)).toBe(true);
    const second = (await (await upload('p-new')).json()) as { photo: { is_primary: boolean; order: number } };
    expect(second.photo).toMatchObject({ is_primary: false, order: 1 });
    const list = (await (await req('/mfg-products/p-new/photos')).json()) as { photos: unknown[] };
    expect(list.photos).toHaveLength(2);
  });

  test('another company\'s SKU is not found', async () => {
    const { upload } = harness();
    expect((await upload('p-other')).status).toBe(404);
  });

  test('the only photo of an ACTIVE SKU can be deleted: photos are optional', async () => {
    const { req, t, bucket } = harness();
    const res = await req('/mfg-products/p-tv/photos/ph-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(t.mfg_product_photos.rows).toHaveLength(0);
    expect(bucket.objects.size).toBe(0);
  });

  test('deleting the primary promotes the next photo and removes the R2 object', async () => {
    const { req, upload, t, bucket } = harness();
    await upload('p-tv');
    const res = await req('/mfg-products/p-tv/photos/ph-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(bucket.objects.has('mfg-product-photos/p-tv/a.jpg')).toBe(false);
    const left = t.mfg_product_photos.rows.filter((r) => r.product_id === 'p-tv');
    expect(left).toHaveLength(1);
    expect(left[0].is_primary).toBe(true);
  });

  test('making a photo primary demotes the old one', async () => {
    const { req, upload, t } = harness();
    const { photo } = (await (await upload('p-tv')).json()) as { photo: { id: string } };
    const res = await req(`/mfg-products/p-tv/photos/${photo.id}`, { method: 'PATCH', body: JSON.stringify({ is_primary: true }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    expect(t.mfg_product_photos.rows.filter((r) => r.is_primary).map((r) => r.id)).toEqual([photo.id]);
  });

  test('deleting a SKU removes its photo objects from R2', async () => {
    const { req, upload, bucket, t } = harness();
    const { photo } = (await (await upload('p-new')).json()) as { photo: { key: string } };
    const res = await req('/mfg-products/p-new', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(bucket.objects.has(photo.key)).toBe(false);
  });
});

describe('public SKU photo proxy', () => {
  test('streams a stored photo of this SKU', async () => {
    const { req } = harness();
    const res = await req(`/pub/mfg-products/p-tv/photo/${encodeURIComponent('mfg-product-photos/p-tv/a.jpg')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(await res.text()).toBe('JPEG');
  });

  test('a key outside the SKU\'s prefix is refused before any read', async () => {
    const { req } = harness();
    const res = await req(`/pub/mfg-products/p-tv/photo/${encodeURIComponent('product-model-photos/m1/a.jpg')}`);
    expect(res.status).toBe(400);
  });

  test('a key under the prefix with no stored row is not served', async () => {
    const { req, bucket } = harness();
    bucket.objects.set('mfg-product-photos/p-tv/secret.jpg', { body: new ArrayBuffer(1), type: 'image/jpeg' });
    const res = await req(`/pub/mfg-products/p-tv/photo/${encodeURIComponent('mfg-product-photos/p-tv/secret.jpg')}`);
    expect(res.status).toBe(404);
  });

  test('the public router exposes the SKU photo GET (and only GETs)', () => {
    const routes = (publicScmImages as unknown as { routes: Array<{ method: string; path: string }> }).routes;
    expect(routes.some((r) => r.method === 'GET' && r.path === '/mfg-products/:id/photo/:key')).toBe(true);
    expect(routes.every((r) => r.method === 'GET')).toBe(true);
  });
});
