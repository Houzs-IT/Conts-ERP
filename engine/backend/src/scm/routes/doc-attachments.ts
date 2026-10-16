// ----------------------------------------------------------------------------
// Photos and documents on every document of the transaction flow (owner,
// 16 Oct 2026; migration 0119 scm.doc_attachments; rules in lib/doc-attachments.ts).
//
//   GET    <document>/:id/attachments            the document's files
//   PUT    <document>/:id/attachments?name=&caption=&sha256=&source=
//                                                 one file, the raw bytes as the body, its type as Content-Type
//   PATCH  <document>/:id/attachments/:fileId    { caption }
//   DELETE <document>/:id/attachments/:fileId    hides it; the row keeps who removed it and when
//   GET    <document>/:id/attachments/:fileId    the bytes
//   POST   /doc-attachments/resolve              the import's check: document numbers -> documents, and which
//                                                 of the files are already attached
//
// One small router per document, mounted on that document's own prefix in
// scm/index.ts (the pattern of renovation-doc-flow.ts), so the document's area
// guard decides who may read and who may add or remove, and no Houzs route file
// is edited. Before 0119 is applied every call answers { ready: false } and the
// pages show that attachments are not switched on.
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { activeCompanySql } from '../lib/companyScope';
import { hasHouzsPerm } from '../lib/houzs-perms';
import type { Env, Variables } from '../env';
import type { Db } from '../../services/renovation/load';
import {
  DOC_TYPES, MAX_FILE_BYTES, MAX_VIDEO_BYTES, POD_FILE_ID, adoptLegacySoAttachments, attachmentKey, attachmentsReady,
  cleanName, fileKind, fileRow, findDocsByNumber, isDocType, listFiles, loadDoc, podFile, type DocRef, type DocType,
} from '../lib/doc-attachments';

type C = Context<{ Bindings: Env; Variables: Variables }>;
const dbOf = (c: { env: Env }) => c.env.DB as unknown as Db;
const SHA = /^[0-9a-f]{64}$/;

const notReady = (c: C) => c.json({ ready: false, files: [], error: 'not_ready', message: 'Attachments are not switched on yet.' }, 409);
const who = (c: C) => {
  const u = c.get('houzsUser');
  return { id: u?.id != null ? Number(u.id) : null, name: (u?.name || u?.email || null) as string | null };
};

async function docOr404(c: C, type: DocType): Promise<DocRef | Response> {
  const db = dbOf(c);
  if (!(await attachmentsReady(db).catch(() => false))) return notReady(c);
  const doc = await loadDoc(db, type, c.req.param('id') ?? '', activeCompanySql(c, 'd.company_id'));
  if (!doc) return c.json({ error: 'not_found', message: `That ${DOC_TYPES[type].label.toLowerCase()} is not in the company you are working in.` }, 404);
  return doc;
}

export async function streamObject(bucket: R2Bucket | undefined, key: string, mime: string, name: string, range: string | undefined): Promise<Response | null> {
  if (!bucket) return null;
  /* A video plays only when the player can ask for a part of it. */
  const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (m) {
    const head = await bucket.head(key);
    if (!head) return null;
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), head.size - 1) : head.size - 1;
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
    const part = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!part) return null;
    return new Response(part.body, {
      status: 206,
      headers: {
        'content-type': mime, 'content-range': `bytes ${start}-${end}/${head.size}`, 'accept-ranges': 'bytes',
        'content-length': String(end - start + 1), 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff',
      },
    });
  }
  const obj = await bucket.get(key);
  if (!obj) return null;
  return new Response(obj.body, {
    headers: {
      'content-type': mime, 'accept-ranges': 'bytes', 'content-disposition': `inline; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"`,
      'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff',
    },
  });
}

/* The renovation quotation and variation order sit under /renovation, whose area guard lets a viewer through and
   leaves writes to a permission inside each handler; their files follow the same permission. */
const WRITE_PERM: Partial<Record<DocType, string>> = { quotation: 'scm.renovation.quote', variation_order: 'scm.renovation.quote' };

function router(type: DocType) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', supabaseAuth);
  app.use('/:id/attachments/*', async (c, next) => {
    const perm = WRITE_PERM[type];
    if (perm && c.req.method !== 'GET' && c.req.method !== 'HEAD' && !hasHouzsPerm(c, perm)) {
      return c.json({ error: 'forbidden', message: `You need the "${perm}" permission for this.` }, 403);
    }
    await next();
  });
  app.use('/:id/attachments', async (c, next) => {
    const perm = WRITE_PERM[type];
    if (perm && c.req.method !== 'GET' && c.req.method !== 'HEAD' && !hasHouzsPerm(c, perm)) {
      return c.json({ error: 'forbidden', message: `You need the "${perm}" permission for this.` }, 403);
    }
    await next();
  });

  app.get('/:id/attachments', async (c: C) => {
    const doc = await docOr404(c, type);
    if (doc instanceof Response) return doc;
    const db = dbOf(c);
    await adoptLegacySoAttachments(db, doc).catch((e) => console.error('[doc-attachments] legacy SO list', e));
    const files = await listFiles(db, doc);
    if (type === 'delivery_order') {
      const pod = await podFile(db, doc.id).catch(() => null);
      if (pod) { const { key: _key, ...shown } = pod; files.unshift(shown); }
    }
    return c.json({ ready: true, doc: { type, id: doc.id, no: doc.no }, files });
  });

  app.put('/:id/attachments', async (c: C) => {
    const doc = await docOr404(c, type);
    if (doc instanceof Response) return doc;
    const bucket = c.env.SO_ITEM_PHOTOS;
    if (!bucket) return c.json({ error: 'bucket_not_configured' }, 500);
    const mime = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const kind = fileKind(mime);
    if (!kind) return c.json({ error: 'bad_type', message: 'Attach a photo, a video or a PDF.' }, 400);
    const size = Number(c.req.header('content-length') ?? NaN);
    if (!Number.isFinite(size) || size <= 0) return c.json({ error: 'no_length', message: 'The file arrived without its size. Try again.' }, 411);
    const cap = kind === 'video' ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
    if (size > cap) return c.json({ error: 'too_large', message: `The file is over ${cap / 1024 / 1024} MB.` }, 413);
    const sha = (c.req.query('sha256') ?? '').toLowerCase();
    const sha256 = SHA.test(sha) ? sha : null;
    const source = c.req.query('source') === 'import' ? 'import' : 'upload';
    const caption = (c.req.query('caption') ?? '').trim().slice(0, 500);
    const name = cleanName(c.req.query('name') ?? '', mime);
    const db = dbOf(c);
    if (sha256) {
      const same = await db.prepare(
        `SELECT id::text AS id FROM scm.doc_attachments
          WHERE company_id = ? AND doc_type = ? AND doc_id = ? AND sha256 = ? AND deleted_at IS NULL`,
      ).bind(doc.companyId, type, doc.id, sha256).first<{ id: string }>();
      if (same) return c.json({ ok: true, duplicate: true, id: same.id, message: `${name} is already attached to ${doc.no}.` });
    }
    const body = c.req.raw.body;
    if (!body) return c.json({ error: 'no_data' }, 400);
    const key = attachmentKey(doc.companyId, type, doc.id, mime);
    await bucket.put(key, body, { httpMetadata: { contentType: mime }, customMetadata: { docType: type, docNo: doc.no } });
    const u = who(c);
    try {
      const row = await db.prepare(
        `INSERT INTO scm.doc_attachments (company_id, doc_type, doc_id, r2_key, file_name, mime, size_bytes, sha256, caption, source, uploaded_by, uploaded_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id::text AS id`,
      ).bind(doc.companyId, type, doc.id, key, name, mime, size, sha256, caption, source, u.id, u.name).first<{ id: string }>();
      return c.json({ ok: true, duplicate: false, id: row?.id }, 201);
    } catch (e) {
      /* Two uploads of the same file racing: the unique index keeps one; the second's bytes go. */
      await bucket.delete(key).catch(() => undefined);
      if (/doc_attachments_same_file_idx|duplicate key/i.test(String((e as Error)?.message ?? e))) {
        return c.json({ ok: true, duplicate: true, message: `${name} is already attached to ${doc.no}.` });
      }
      throw e;
    }
  });

  app.patch('/:id/attachments/:fileId', async (c: C) => {
    const doc = await docOr404(c, type);
    if (doc instanceof Response) return doc;
    const body = (await c.req.json().catch(() => null)) as { caption?: unknown } | null;
    if (!body || typeof body.caption !== 'string') return c.json({ error: 'caption_required' }, 400);
    if (!(await fileRow(dbOf(c), doc, c.req.param('fileId') ?? ''))) return c.json({ error: 'not_found' }, 404);
    await dbOf(c).prepare(`UPDATE scm.doc_attachments SET caption = ? WHERE id = ?::uuid`)
      .bind(body.caption.trim().slice(0, 500), c.req.param('fileId')).run();
    return c.json({ ok: true });
  });

  app.delete('/:id/attachments/:fileId', async (c: C) => {
    const doc = await docOr404(c, type);
    if (doc instanceof Response) return doc;
    const fileId = c.req.param('fileId') ?? '';
    if (fileId === POD_FILE_ID) return c.json({ error: 'pod_kept', message: 'The proof-of-delivery photo stays with the delivery.' }, 409);
    if (!(await fileRow(dbOf(c), doc, fileId))) return c.json({ error: 'not_found' }, 404);
    const u = who(c);
    /* Hidden, not deleted: the row and the stored file are the record of what was attached and who removed it. */
    await dbOf(c).prepare(`UPDATE scm.doc_attachments SET deleted_at = now(), deleted_by = ?, deleted_by_name = ? WHERE id = ?::uuid AND deleted_at IS NULL`)
      .bind(u.id, u.name, fileId).run();
    return c.json({ ok: true });
  });

  app.get('/:id/attachments/:fileId', async (c: C) => {
    const doc = await docOr404(c, type);
    if (doc instanceof Response) return doc;
    const fileId = c.req.param('fileId') ?? '';
    const range = c.req.header('range');
    if (type === 'delivery_order' && fileId === POD_FILE_ID) {
      const pod = await podFile(dbOf(c), doc.id);
      const res = pod && ((await streamObject(c.env.SLIPS, pod.key, pod.mime, pod.name, range)) ?? (await streamObject(c.env.POD_BUCKET, pod.key, pod.mime, pod.name, range)));
      return res ?? c.json({ error: 'not_found' }, 404);
    }
    const row = await fileRow(dbOf(c), doc, fileId);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return (await streamObject(c.env.SO_ITEM_PHOTOS, row.key, row.mime, row.name, range))
      ?? c.json({ error: 'object_missing', message: 'The file is listed but its stored copy is gone.' }, 404);
  });

  return app;
}

export const quotationAttachments = router('quotation');
export const salesOrderAttachments = router('sales_order');
export const variationOrderAttachments = router('variation_order');
export const purchaseOrderAttachments = router('purchase_order');
export const deliveryOrderAttachments = router('delivery_order');
export const goodsReceivedAttachments = router('goods_received');
export const deliveryReturnAttachments = router('delivery_return');
export const purchaseReturnAttachments = router('purchase_return');
export const purchaseInvoiceAttachments = router('purchase_invoice');
export const salesInvoiceAttachments = router('sales_invoice');
export const receiptAttachments = router('receipt');

/* ── The import's check (Supply chain > Import document files) ──
   POST { items: [{ docType, docNo, sha256 }] } -> per item: the document it names (or none) and whether that file
   is already attached (or was attached and removed). Reads only; the upload itself goes through the document's own
   PUT above, under the document's own guard. */
export const docAttachmentsImport = new Hono<{ Bindings: Env; Variables: Variables }>();
docAttachmentsImport.use('*', supabaseAuth);
docAttachmentsImport.post('/resolve', async (c: C) => {
  const db = dbOf(c);
  if (!(await attachmentsReady(db).catch(() => false))) return notReady(c);
  const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
  const items = Array.isArray(body?.items) ? (body.items as Array<Record<string, unknown>>) : null;
  if (!items) return c.json({ error: 'items_required' }, 400);
  if (items.length > 2000) return c.json({ error: 'too_many', message: 'Check up to 2,000 files at a time.' }, 400);
  const byType = new Map<DocType, Set<string>>();
  for (const it of items) {
    if (!isDocType(it.docType) || typeof it.docNo !== 'string') continue;
    const set = byType.get(it.docType) ?? new Set<string>();
    set.add(it.docNo.trim());
    byType.set(it.docType, set);
  }
  const companySql = activeCompanySql(c, 'd.company_id');
  const found = new Map<string, DocRef[]>();
  for (const [type, nos] of byType) {
    for (const d of await findDocsByNumber(db, type, [...nos], companySql)) {
      const k = `${type}:${d.no}`;
      found.set(k, [...(found.get(k) ?? []), d]);
    }
  }
  const docs = [...found.values()].flat();
  const existing = new Map<string, 'attached' | 'removed'>();
  if (docs.length) {
    const res = await db.prepare(
      `SELECT doc_type || ':' || doc_id || ':' || sha256 AS k, bool_or(deleted_at IS NULL) AS live FROM scm.doc_attachments
        WHERE sha256 IS NOT NULL AND (doc_type || ':' || doc_id) = ANY(?::text[]) GROUP BY 1`,
    ).bind(`{${docs.map((d) => `"${d.type}:${d.id.replace(/["\\]/g, '')}"`).join(',')}}`).all<{ k: string; live: boolean }>();
    for (const r of res.results ?? []) existing.set(r.k, r.live ? 'attached' : 'removed');
  }
  return c.json({
    ready: true,
    results: items.map((it) => {
      if (!isDocType(it.docType)) return { status: 'bad_type' as const };
      const hits = found.get(`${it.docType}:${String(it.docNo ?? '').trim()}`) ?? [];
      if (hits.length === 0) return { status: 'no_document' as const };
      if (hits.length > 1) return { status: 'ambiguous' as const };
      const d = hits[0];
      const sha = typeof it.sha256 === 'string' ? it.sha256.toLowerCase() : '';
      const prior = sha ? existing.get(`${d.type}:${d.id}:${sha}`) : undefined;
      return { status: prior ?? ('new' as const), docId: d.id, docNo: d.no };
    }),
  });
});
