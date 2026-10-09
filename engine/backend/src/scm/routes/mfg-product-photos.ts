/* Photos per SKU (renovation catalog, migration 0062 scm.mfg_product_photos).

   The same pipeline as model gallery photos (product-models.ts "Multi-photo
   gallery"): R2 bucket SO_ITEM_PHOTOS, keys minted as
   mfg-product-photos/<productId>/<uuid>.<ext>, optional client thumbnail at
   <key>.thumb, first photo becomes primary.

   Surface (registered on the mfgProducts router, behind its auth):
     GET    /mfg-products/:id/photos                → { photos }
     POST   /mfg-products/:id/photos   (multipart)  → { photo }
     DELETE /mfg-products/:id/photos/:photoId       → { ok }
     PATCH  /mfg-products/:id/photos/:photoId       → { ok }  body { is_primary?, order? }
   and ONE public GET, mounted outside the auth gate in public-images.ts so a
   bare <img src> works (no Authorization header rides an <img>):
     GET    /api/scm/mfg-products/:id/photo/:key

   A SKU in a photo group (renovation-catalog.ts isPhotoRequiredCategory) that
   is ACTIVE cannot lose its last photo: deactivate it first. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { canWriteScmConfig } from '../lib/houzs-perms';
import { NOT_THIS_COMPANY, requireActiveCompanyId, scopeToCompanyId } from '../lib/companyScope';
import { baseKeyOf, deleteThumbFor, putOptionalThumb } from '../../services/photoThumbs';
import { isPhotoRequiredCategory } from '../shared/renovation-catalog';
import type { Env, Variables } from '../env';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const MFG_PHOTO_PREFIX = 'mfg-product-photos/';
const MAX_BYTES = 5 * 1024 * 1024;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const COLS = 'id, r2_key, thumb_key, sort_order, is_primary, mime_type, size_bytes';

type PhotoCols = {
  id: string;
  r2_key: string;
  thumb_key: string | null;
  sort_order: number;
  is_primary: boolean;
};

export function mfgPhotoUrl(productId: string, key: string): string {
  return `/api/scm/mfg-products/${encodeURIComponent(productId)}/photo/${encodeURIComponent(key)}`;
}

export function photoToWire(productId: string, p: PhotoCols) {
  return {
    id: p.id,
    key: p.r2_key,
    url: mfgPhotoUrl(productId, p.r2_key),
    thumbUrl: p.thumb_key ? mfgPhotoUrl(productId, p.thumb_key) : null,
    is_primary: p.is_primary,
    order: p.sort_order,
  };
}

/** How many photos a SKU has, in one company. Fails closed: a read error is
 *  reported, never turned into a count. */
export async function photoCountFor(
  sb: SupabaseClient,
  productId: string,
  companyId: number,
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  const { count, error } = await scopeToCompanyId(
    sb.from('mfg_product_photos').select('id', { count: 'exact', head: true }).eq('product_id', productId),
    companyId,
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true, count: count ?? 0 };
}

/** The primary (else first) photo url and the photo count per SKU, for list
 *  pages. One read over the given ids. */
export async function primaryPhotosFor(
  sb: SupabaseClient,
  productIds: string[],
  companyId: number,
): Promise<{ ok: true; byProduct: Map<string, { url: string; thumbUrl: string | null; count: number }> } | { ok: false; reason: string }> {
  const byProduct = new Map<string, { url: string; thumbUrl: string | null; count: number }>();
  if (productIds.length === 0) return { ok: true, byProduct };
  const CHUNK = 200;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const ids = productIds.slice(i, i + CHUNK);
    const { data, error } = await scopeToCompanyId(
      sb.from('mfg_product_photos').select('product_id, r2_key, thumb_key, is_primary, sort_order').in('product_id', ids),
      companyId,
    )
      .order('is_primary', { ascending: false })
      .order('sort_order', { ascending: true });
    if (error) return { ok: false, reason: error.message };
    // The primary photo, else the lowest sort order; chosen here, not by row order.
    const best = new Map<string, { is_primary: boolean; sort_order: number }>();
    for (const r of (data ?? []) as Array<{ product_id: string; r2_key: string; thumb_key: string | null; is_primary: boolean; sort_order: number }>) {
      const entry = {
        url: mfgPhotoUrl(r.product_id, r.r2_key),
        thumbUrl: r.thumb_key ? mfgPhotoUrl(r.product_id, r.thumb_key) : null,
        count: (byProduct.get(r.product_id)?.count ?? 0) + 1,
      };
      const b = best.get(r.product_id);
      const better = !b || (r.is_primary && !b.is_primary) || (r.is_primary === b.is_primary && r.sort_order < b.sort_order);
      if (better) {
        best.set(r.product_id, { is_primary: r.is_primary, sort_order: r.sort_order });
        byProduct.set(r.product_id, entry);
      } else {
        byProduct.get(r.product_id)!.count = entry.count;
      }
    }
  }
  return { ok: true, byProduct };
}

/** R2 keys of a SKU's photos (main + thumb), read before the SKU is deleted so
 *  the objects can be removed after the cascade drops the rows. */
export async function photoKeysFor(sb: SupabaseClient, productId: string, companyId: number): Promise<string[]> {
  const { data, error } = await scopeToCompanyId(
    sb.from('mfg_product_photos').select('r2_key, thumb_key').eq('product_id', productId),
    companyId,
  );
  if (error || !data) return [];
  return (data as Array<{ r2_key: string; thumb_key: string | null }>).flatMap((r) => [r.r2_key, r.thumb_key].filter((k): k is string => !!k));
}

async function loadProduct(sb: SupabaseClient, id: string, companyId: number) {
  return scopeToCompanyId(sb.from('mfg_products').select('id, code, category, status').eq('id', id), companyId).maybeSingle();
}

export const listMfgProductPhotosHandler = async (c: AppContext) => {
  const sb = c.get('supabase');
  const id = c.req.param('id') as string;
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await scopeToCompanyId(sb.from('mfg_product_photos').select(COLS).eq('product_id', id), co.companyId)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ photos: (data ?? []).map((r) => photoToWire(id, r as PhotoCols)) });
};

export const uploadMfgProductPhotoHandler = async (c: AppContext) => {
  if (!canWriteScmConfig(c)) return c.json({ error: 'forbidden' }, 403);
  if (!c.env.SO_ITEM_PHOTOS) return c.json({ error: 'photo_bucket_not_configured' }, 500);
  const sb = c.get('supabase');
  const id = c.req.param('id') as string;

  let body: Record<string, unknown>;
  try { body = await c.req.parseBody(); } catch { return c.json({ error: 'invalid_multipart' }, 400); }
  const file = body.file as File | undefined;
  if (!file || typeof file === 'string') return c.json({ error: 'file_missing', expected: 'multipart field "file"' }, 400);
  if (!MIME.has(file.type)) return c.json({ error: 'unsupported_type', got: file.type, allowed: [...MIME] }, 400);
  if (file.size > MAX_BYTES) return c.json({ error: 'too_large', max_bytes: MAX_BYTES }, 413);

  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data: product, error: pErr } = await loadProduct(sb, id, co.companyId);
  if (pErr) return c.json({ error: 'load_failed', reason: pErr.message }, 500);
  if (!product) return c.json(NOT_THIS_COMPANY, 404);

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const r2Key = `${MFG_PHOTO_PREFIX}${id}/${crypto.randomUUID()}.${ext}`;
  await c.env.SO_ITEM_PHOTOS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const thumbKey = await putOptionalThumb(c.env.SO_ITEM_PHOTOS, body.thumb, r2Key);

  const existing = await scopeToCompanyId(sb.from('mfg_product_photos').select('sort_order, is_primary').eq('product_id', id), co.companyId);
  if (existing.error) {
    await c.env.SO_ITEM_PHOTOS.delete(r2Key).catch(() => {});
    await deleteThumbFor(c.env.SO_ITEM_PHOTOS, r2Key);
    return c.json({ error: 'load_failed', reason: existing.error.message }, 500);
  }
  const rows = (existing.data ?? []) as Array<{ sort_order: number; is_primary: boolean }>;
  const nextOrder = rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
  const { data, error } = await sb
    .from('mfg_product_photos')
    .insert({
      company_id: co.companyId,
      product_id: id,
      r2_key: r2Key,
      thumb_key: thumbKey,
      sort_order: nextOrder,
      is_primary: !rows.some((r) => r.is_primary),
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select(COLS)
    .single();
  if (error) {
    await c.env.SO_ITEM_PHOTOS.delete(r2Key).catch(() => {});
    await deleteThumbFor(c.env.SO_ITEM_PHOTOS, r2Key);
    return c.json({ error: 'db_insert_failed', reason: error.message }, 500);
  }
  return c.json({ photo: photoToWire(id, data as PhotoCols) });
};

export const deleteMfgProductPhotoHandler = async (c: AppContext) => {
  if (!canWriteScmConfig(c)) return c.json({ error: 'forbidden' }, 403);
  const sb = c.get('supabase');
  const id = c.req.param('id') as string;
  const photoId = c.req.param('photoId') as string;
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);

  const { data: row, error: rowErr } = await scopeToCompanyId(
    sb.from('mfg_product_photos').select('id, r2_key, is_primary').eq('product_id', id).eq('id', photoId),
    co.companyId,
  ).maybeSingle();
  if (rowErr) return c.json({ error: 'load_failed', reason: rowErr.message }, 500);
  if (!row) return c.json(NOT_THIS_COMPANY, 404);
  const target = row as { id: string; r2_key: string; is_primary: boolean };

  // The last photo of an ACTIVE photo-group SKU stays: the SKU would be active
  // with no photo. Both reads fail closed.
  const { data: product, error: pErr } = await loadProduct(sb, id, co.companyId);
  if (pErr || !product) return c.json({ error: 'load_failed', reason: pErr?.message ?? 'product not found' }, 500);
  const p = product as { category: string; status: string };
  if (p.status === 'ACTIVE' && isPhotoRequiredCategory(p.category)) {
    const n = await photoCountFor(sb, id, co.companyId);
    if (!n.ok) return c.json({ error: 'photo_check_failed', reason: n.reason }, 503);
    if (n.count <= 1) {
      return c.json({ error: 'last_photo', reason: 'This is the only photo of an active SKU that needs one. Add another photo or make the SKU inactive first.' }, 409);
    }
  }

  const { error: delErr } = await scopeToCompanyId(sb.from('mfg_product_photos').delete().eq('id', photoId), co.companyId);
  if (delErr) return c.json({ error: 'db_delete_failed', reason: delErr.message }, 500);
  if (c.env.SO_ITEM_PHOTOS) {
    await c.env.SO_ITEM_PHOTOS.delete(target.r2_key).catch(() => {});
    await deleteThumbFor(c.env.SO_ITEM_PHOTOS, target.r2_key);
  }
  if (target.is_primary) {
    const { data: next } = await scopeToCompanyId(sb.from('mfg_product_photos').select('id').eq('product_id', id), co.companyId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await scopeToCompanyId(sb.from('mfg_product_photos').update({ is_primary: true }).eq('id', (next as { id: string }).id), co.companyId);
    }
  }
  return c.json({ ok: true });
};

export const patchMfgProductPhotoHandler = async (c: AppContext) => {
  if (!canWriteScmConfig(c)) return c.json({ error: 'forbidden' }, 403);
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');
  const id = c.req.param('id') as string;
  const photoId = c.req.param('photoId') as string;
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);

  const { data: row, error: rowErr } = await scopeToCompanyId(
    sb.from('mfg_product_photos').select('id').eq('product_id', id).eq('id', photoId),
    co.companyId,
  ).maybeSingle();
  if (rowErr) return c.json({ error: 'load_failed', reason: rowErr.message }, 500);
  if (!row) return c.json(NOT_THIS_COMPANY, 404);

  if (body.order !== undefined) {
    const n = Number(body.order);
    if (!Number.isInteger(n) || n < 0) return c.json({ error: 'order_invalid', expected: 'non-negative integer' }, 400);
  }
  if (body.is_primary === true) {
    // Demote first: the partial unique index allows one primary per SKU.
    const { error: dErr } = await scopeToCompanyId(
      sb.from('mfg_product_photos').update({ is_primary: false }).eq('product_id', id).eq('is_primary', true),
      co.companyId,
    );
    if (dErr) return c.json({ error: 'patch_failed', reason: dErr.message }, 500);
    const { error } = await scopeToCompanyId(sb.from('mfg_product_photos').update({ is_primary: true }).eq('id', photoId), co.companyId);
    if (error) return c.json({ error: 'patch_failed', reason: error.message }, 500);
  }
  if (body.order !== undefined) {
    const { error } = await scopeToCompanyId(sb.from('mfg_product_photos').update({ sort_order: Number(body.order) }).eq('id', photoId), co.companyId);
    if (error) return c.json({ error: 'patch_failed', reason: error.message }, 500);
  }
  return c.json({ ok: true });
};

/* PUBLIC proxy (mounted pre-auth in public-images.ts). Safe for the same reason
   as the model proxies: the key must sit under this SKU's prefix AND match a
   stored photo row of this SKU before anything is streamed, so a guessed key
   cannot reach another object. Service-role client on schema scm. */
export const mfgProductPhotoProxyHandler = async (c: AppContext) => {
  const id = c.req.param('id');
  const rawKey = c.req.param('key');
  if (!id || !rawKey) return c.json({ error: 'bad_request' }, 400);
  let key: string;
  try { key = decodeURIComponent(rawKey); } catch { return c.json({ error: 'bad_request' }, 400); }
  if (!key.startsWith(`${MFG_PHOTO_PREFIX}${id}/`)) return c.json({ error: 'photo_key_invalid' }, 400);
  if (!c.env.SO_ITEM_PHOTOS) return c.json({ error: 'photo_bucket_not_configured' }, 500);

  const sb = c.get('supabase') ?? createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).schema('scm');
  const { data, error } = await sb
    .from('mfg_product_photos')
    .select('id')
    .eq('product_id', id)
    .eq('r2_key', baseKeyOf(key))
    .maybeSingle();
  if (error) return c.json({ error: 'load_failed' }, 500);
  if (!data) return c.json({ error: 'photo_not_in_product' }, 404);

  const obj = await c.env.SO_ITEM_PHOTOS.get(key);
  if (!obj) return c.json({ error: 'photo_not_found_in_r2' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      // Keys are minted with crypto.randomUUID(), so a url names one fixed object.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
