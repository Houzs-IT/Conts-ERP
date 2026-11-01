// ----------------------------------------------------------------------------
// /api/scm/renovation-so-info — the "Order information" block of a sales order
// in renovation mode (owner, 14 Oct 2026; migration 0112).
//
//   GET  /lists               property types + layouts (Project Maintenance), ready flag
//   GET  /projects?q=         renovation projects to put the SO under, with their shared fields
//   GET  /projects/:id        one project's shared fields (prefill when an SO is opened from it)
//   GET  /so/:docNo           an existing SO's order information (the edit form)
//   PUT  /:docNo              save the SO's order information and write it back to its project
//   PUT  /:docNo/rooms        save the SO's room list and its lines' rooms
//   PUT  /:docNo/lines/:itemId/spec   a line's variants and remark (renovation contracts too)
//
// The create path (POST /api/scm/mfg-sales-orders with a `renovation` block) and
// this PUT share applyRenovationSoInfo below. Reads ride the Sales Orders view
// level; the PUT needs Sales Orders edit (area guard in scm/index.ts).
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { activeCompanyId, activeCompanySql } from '../lib/companyScope';
import type { Env, Variables } from '../env';
import type { Db } from '../../services/renovation/load';
import { refreshProjectDates } from '../../services/renovation/projectDates';
import {
  propertyColumnsReady,
  readProjectShared,
  readSoShared,
  readPropertyLists,
  readSoRooms,
  renovationMode,
  roomsForCreatedLines,
  writeSoRooms,
  searchProjects,
  writeSoPropertyColumns,
  writeSoToProject,
  type SoShared,
} from '../../services/renovation/customerProperty';
import { cleanRoomName, cleanRoomSections, readPropertyInput, renoSoRequiredProblems, type PropertyProblem } from '../shared/renovation-property';
import { canonicalizeVariants } from '../shared/so-variant-rule';
import { buildVariantSummary } from '../shared/variant-summary';
import { variantCategoryOf } from '../lib/renovation-flow-rules';

type C = Context<{ Bindings: Env; Variables: Variables }>;

export const renovationSoInfo = new Hono<{ Bindings: Env; Variables: Variables }>();
renovationSoInfo.use('*', supabaseAuth);

const dbOf = (c: { env: Env }) => c.env.DB as unknown as Db;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The renovation block a SO form sends (`body.renovation`), read and checked. */
export interface RenovationSoInput {
  projectId: number | null;
  building: string;
  unitNo: string;
  property: ReturnType<typeof readPropertyInput>['value'];
  problems: PropertyProblem[];
  /** The ordered room list; null when the request did not send one (rooms then stay as they are). */
  roomSections: string[] | null;
  /** Saved lines' rooms by item id (the edit form); [] when not sent. */
  itemRooms: Array<{ id: string; room: string }>;
}

export function readRenovationBlock(raw: unknown): RenovationSoInput {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pid = Number(b.projectId);
  const { value, problems } = readPropertyInput(b);
  return {
    projectId: Number.isInteger(pid) && pid > 0 ? pid : null,
    building: str(b.building).slice(0, 120),
    unitNo: str(b.unitNo).slice(0, 40),
    property: value,
    problems,
    roomSections: Array.isArray(b.roomSections) ? cleanRoomSections(b.roomSections) : null,
    itemRooms: b.itemRooms && typeof b.itemRooms === 'object' && !Array.isArray(b.itemRooms)
      ? Object.entries(b.itemRooms as Record<string, unknown>)
        .filter(([id]) => /^[0-9a-f-]{36}$/i.test(id))
        .map(([id, room]) => ({ id, room: cleanRoomName(room) }))
      : [],
  };
}

/** After a create: stamp the rooms the form sent for its lines (body.items[i].room) and the room list. */
export async function stampCreatedRooms(db: Db, docNo: string, sections: string[] | null, bodyItems: unknown): Promise<void> {
  const sent = (Array.isArray(bodyItems) ? bodyItems : [])
    .map((it) => ({ itemCode: String((it as Record<string, unknown>)?.itemCode ?? ''), room: cleanRoomName((it as Record<string, unknown>)?.room) }));
  const inserted = await db.prepare(`SELECT id::text AS id, item_code FROM scm.mfg_sales_order_items WHERE doc_no = ? ORDER BY line_no, created_at`)
    .bind(docNo).all<{ id: string; item_code: string | null }>();
  await writeSoRooms(db, docNo, sections ?? [], roomsForCreatedLines(inserted.results ?? [], sent));
}

/** Every reason a renovation SO cannot be saved: invalid values, then the required fields. */
export function renovationSoProblems(input: RenovationSoInput, head: { customerName: string; phone: string; address1: string }): PropertyProblem[] {
  const invalid = new Set(input.problems.map((p) => p.field));
  return [...input.problems, ...renoSoRequiredProblems({ ...head, property: input.property }).filter((p) => !invalid.has(p.field))];
}

/** Whether a request may use the renovation block at all: renovation mode and migration 0112 applied. */
export async function renovationSoAvailable(db: Db): Promise<{ ok: true } | { ok: false; status: 409; body: Record<string, unknown> }> {
  if (!(await renovationMode(db))) {
    return { ok: false, status: 409, body: { error: 'not_renovation_mode', message: 'This install does not run renovation projects.' } };
  }
  if (!(await propertyColumnsReady(db))) {
    return { ok: false, status: 409, body: { error: 'property_columns_missing', message: 'The property fields are not in the database yet (migration 0112). Ask the administrator to apply it.' } };
  }
  return { ok: true };
}

/** Stamp the SO's order information and write the shared fields back to its project. */
export async function applyRenovationSoInfo(
  db: Db,
  docNo: string,
  input: RenovationSoInput,
  ctx: { companyId: number; companySql: string; actorId: number },
): Promise<{ ok: true; projectId: number | null } | { ok: false; status: 404 | 422; body: Record<string, unknown> }> {
  if (input.projectId != null && !(await readProjectShared(db, input.projectId, ctx.companySql))) {
    return { ok: false, status: 422, body: { error: 'project_not_found', message: 'That project does not exist in this company.' } };
  }
  const before = await db.prepare(`SELECT project_id::int AS project_id FROM scm.mfg_sales_orders WHERE doc_no = ?`).bind(docNo).first<{ project_id: number | null }>();
  await writeSoPropertyColumns(db, docNo, input.projectId, { building: input.building, unitNo: input.unitNo, ...input.property });
  /* Picking or changing the project here is the same link the project's "Link existing SO" makes
     (services/renovation/soLink.ts): the same project activity rows, and no step change. */
  const prev = before?.project_id == null ? null : Number(before.project_id);
  if (prev !== input.projectId) {
    if (prev != null) {
      await db.prepare(`INSERT INTO project_activity (project_id, action, from_value, user_id, company_id)
                        SELECT id, 'so_unlinked', ?, ?, company_id FROM projects WHERE id = ? AND project_kind = 'renovation'`)
        .bind(docNo, ctx.actorId, prev).run();
    }
    if (input.projectId != null) {
      await db.prepare(`INSERT INTO project_activity (project_id, action, to_value, user_id, company_id) VALUES (?, 'so_linked', ?, ?, ?)`)
        .bind(input.projectId, docNo, ctx.actorId, ctx.companyId).run();
    }
  }
  if (input.roomSections !== null) await writeSoRooms(db, docNo, input.roomSections, input.itemRooms);
  if (input.projectId != null) {
    /* Every shared field as the SO now holds it (header, address, salesperson, property just stamped). */
    const shared: SoShared | null = await readSoShared(db, docNo);
    if (!shared) return { ok: false, status: 404, body: { error: 'so_not_found' } };
    await writeSoToProject(db, input.projectId, shared, ctx.actorId, ctx.companyId, docNo);
  }
  return { ok: true, projectId: input.projectId };
}

renovationSoInfo.get('/lists', async (c: C) => {
  const db = dbOf(c);
  const mode = await renovationMode(db).catch(() => false);
  const ready = mode && (await propertyColumnsReady(db).catch(() => false));
  if (!ready) return c.json({ ready: false, renovationMode: mode, propertyTypes: [], layouts: [] });
  const lists = await readPropertyLists(db, activeCompanySql(c));
  return c.json({ ready: true, renovationMode: true, ...lists });
});

renovationSoInfo.get('/projects', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  return c.json({ data: await searchProjects(db, activeCompanySql(c, 'p.company_id'), str(c.req.query('q'))) });
});

renovationSoInfo.get('/projects/:id', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  /* The Start / End date the block shows are the project's, kept up to date with its step (migration 0117). */
  await refreshProjectDates(db, id, activeCompanySql(c, 'p.company_id'));
  const p = await readProjectShared(db, id, activeCompanySql(c, 'p.company_id'));
  if (!p) return c.json({ error: 'not_found', message: 'Project not found.' }, 404);
  return c.json({ project: p });
});

renovationSoInfo.get('/so/:docNo', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const r = await db.prepare(
    `SELECT project_id::int AS project_id, debtor_name, phone, email, address1, address2, building, unit_no, property_type, layout_label,
            bedrooms, bathrooms, built_up_sqft::float8 AS built_up_sqft
       FROM scm.mfg_sales_orders WHERE doc_no = ?${activeCompanySql(c)}`,
  ).bind(c.req.param('docNo') ?? '').first<Record<string, unknown>>();
  if (!r) return c.json({ error: 'so_not_found' }, 404);
  const t = (v: unknown) => (v == null ? '' : String(v));
  const projectId = r.project_id == null ? null : Number(r.project_id);
  /* project_id on a Houzs order can name an exhibition (its fair): only a renovation project counts here. */
  if (projectId != null) await refreshProjectDates(db, projectId, activeCompanySql(c, 'p.company_id'));
  const project = projectId != null ? await readProjectShared(db, projectId, activeCompanySql(c, 'p.company_id')) : null;
  const rooms = await readSoRooms(db, c.req.param('docNo') ?? '');
  return c.json({
    ...rooms,
    info: {
      projectId: project ? project.id : null, customerName: t(r.debtor_name), customerPhone: t(r.phone), customerEmail: t(r.email),
      siteAddress: [t(r.address1), t(r.address2)].filter(Boolean).join('\n'), building: t(r.building), unitNo: t(r.unit_no),
      propertyType: t(r.property_type), layoutLabel: t(r.layout_label), bedrooms: t(r.bedrooms), bathrooms: t(r.bathrooms),
      builtUpSqft: t(r.built_up_sqft),
    },
    project,
  });
});

/* The rooms alone (the edit form saves them after its lines, when new lines have their ids). */
renovationSoInfo.put('/:docNo/rooms', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const docNo = c.req.param('docNo') ?? '';
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.roomSections)) return c.json({ error: 'rooms_required', message: 'Send the room list.' }, 400);
  const so = await db.prepare(`SELECT coalesce(so_kind, 'STANDARD') AS so_kind, status::text AS status FROM scm.mfg_sales_orders WHERE doc_no = ?${activeCompanySql(c)}`)
    .bind(docNo).first<{ so_kind: string; status: string }>();
  if (!so) return c.json({ error: 'so_not_found', message: `Sales order ${docNo} does not exist.` }, 404);
  if (so.so_kind !== 'STANDARD') return c.json({ error: 'renovation_contract', message: 'A renovation contract keeps the sections it was signed with.' }, 409);
  if (so.status === 'CANCELLED' || so.status === 'CLOSED') return c.json({ error: 'so_closed', message: `Sales order ${docNo} is ${so.status.toLowerCase()}.` }, 409);
  const input = readRenovationBlock(body);
  await writeSoRooms(db, docNo, input.roomSections ?? [], input.itemRooms);
  return c.json({ ok: true, ...(await readSoRooms(db, docNo)) });
});

renovationSoInfo.put('/:docNo', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const docNo = c.req.param('docNo') ?? '';
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const so = await db.prepare(
    `SELECT doc_no, coalesce(so_kind, 'STANDARD') AS so_kind, status::text AS status, debtor_name, phone, address1, company_id::int AS company_id
       FROM scm.mfg_sales_orders WHERE doc_no = ?${activeCompanySql(c)}`,
  ).bind(docNo).first<{ so_kind: string; status: string; debtor_name: string | null; phone: string | null; address1: string | null; company_id: number }>();
  if (!so) return c.json({ error: 'so_not_found', message: `Sales order ${docNo} does not exist.` }, 404);
  if (so.status === 'CANCELLED' || so.status === 'CLOSED') return c.json({ error: 'so_closed', message: `Sales order ${docNo} is ${so.status.toLowerCase()}.` }, 409);
  /* A renovation contract shares its customer and property with the project both ways like any SO (owner, 1 Nov
     2026: "I change either side"); it only keeps the room sections it was signed with. Refusing the whole block
     made every VO saved from the SO page fail on a contract. */
  const read = readRenovationBlock(body);
  const input = so.so_kind === 'STANDARD' ? read : { ...read, roomSections: null };
  const problems = renovationSoProblems(input, { customerName: so.debtor_name ?? '', phone: so.phone ?? '', address1: so.address1 ?? '' });
  if (problems.length) return c.json({ error: 'validation_failed', problems }, 422);
  const r = await applyRenovationSoInfo(db, docNo, input, {
    companyId: activeCompanyId(c) ?? so.company_id, companySql: activeCompanySql(c, 'p.company_id'),
    actorId: Number(c.get('houzsUser')?.id ?? 0),
  });
  if (!r.ok) return c.json(r.body, r.status);
  return c.json({ ok: true, docNo, projectId: r.projectId });
});

/* A line's variants and remark (owner, 1 Nov 2026: the SO line carries the options its SKU has, picked on the SO).
   A renovation contract changes lines only through a contract VO, which adds or omits lines and never touches the
   options, so this is the one place they are set. Money, quantity and SKU never move here, and a line a live PO
   already buys keeps what the supplier was sent: that change goes through the PO amendment. */
renovationSoInfo.put('/:docNo/lines/:itemId/spec', async (c: C) => {
  const db = dbOf(c);
  const docNo = c.req.param('docNo') ?? '';
  const itemId = c.req.param('itemId') ?? '';
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.variants !== 'object' || body.variants === null || Array.isArray(body.variants)) {
    return c.json({ error: 'variants_required', message: 'Send the line options.' }, 400);
  }
  const line = await db.prepare(
    `SELECT i.id::text AS id, i.item_code, i.variants, i.remark, i.company_id::int AS company_id, o.status::text AS status,
            p.category::text AS category, p.sub_category
       FROM scm.mfg_sales_order_items i
       JOIN scm.mfg_sales_orders o ON o.doc_no = i.doc_no
       LEFT JOIN scm.mfg_products p ON p.code = i.item_code AND p.company_id = o.company_id
      WHERE i.doc_no = ? AND i.id::text = ?${activeCompanySql(c, 'o.company_id')}`,
  ).bind(docNo, itemId).first<{ id: string; item_code: string; variants: unknown; remark: string | null; company_id: number; status: string; category: string | null; sub_category: string | null }>();
  if (!line) return c.json({ error: 'line_not_found', message: `That line is not on sales order ${docNo}.` }, 404);
  if (line.status === 'CANCELLED' || line.status === 'CLOSED') return c.json({ error: 'so_closed', message: `Sales order ${docNo} is ${line.status.toLowerCase()}.` }, 409);
  const po = await db.prepare(
    `SELECT po.doc_no FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
      WHERE pi.so_item_id::text = ? AND po.status::text NOT IN ('CANCELLED', 'DRAFT') LIMIT 1`,
  ).bind(itemId).first<{ doc_no: string }>();
  const group = (variantCategoryOf(line.category, line.sub_category) ?? '').toLowerCase();
  const raw = { ...(body.variants as Record<string, unknown>) };
  delete raw.remark;
  const variants = canonicalizeVariants(group, raw);
  const before = typeof line.variants === 'string' ? JSON.parse(line.variants) as unknown : line.variants;
  const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, 500) : (line.remark ?? '');
  const sameOptions = JSON.stringify(canonicalizeVariants(group, (before ?? {}) as Record<string, unknown>)) === JSON.stringify(variants);
  if (sameOptions && remark === (line.remark ?? '')) return c.json({ ok: true, changed: false });
  if (po && !sameOptions) {
    return c.json({ error: 'line_on_po', message: `${po.doc_no} already buys this line from the supplier. Change its options through that PO's amendment.` }, 409);
  }
  const summary = buildVariantSummary(group, variants) || null;
  await db.prepare(
    `UPDATE scm.mfg_sales_order_items SET variants = ?::jsonb, description2 = coalesce(?, description2), remark = nullif(?, '')
      WHERE id::text = ? AND doc_no = ?`,
  ).bind(JSON.stringify(variants), summary, remark, itemId, docNo).run();
  await db.prepare(
    `INSERT INTO scm.mfg_so_audit_log (so_doc_no, company_id, action, actor_name_snapshot, field_changes, status_snapshot, source, note)
     VALUES (?, ?, 'UPDATE', ?, ?::jsonb, ?, 'renovation', ?)`,
  ).bind(docNo, line.company_id, String(c.get('houzsUser')?.name ?? ''), JSON.stringify([{ field: 'variants', from: before ?? null, to: variants }]),
    line.status, `${line.item_code}: options ${summary ?? 'cleared'}${remark !== (line.remark ?? '') ? `; remark ${remark || 'cleared'}` : ''}`).run();
  return c.json({ ok: true, changed: true, variants, summary });
});

/* ── Attachments on the whole order (owner, 14 Oct 2026; mig 0115 scm.mfg_sales_orders.attachments) ──
   Photos of the site, floor plans, the signed quotation. The files go in the bucket the line photos already
   use (SO_ITEM_PHOTOS), under so-attachments/<doc no>/; the list lives on the order. Images and PDFs, 10 MB. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/i;
export interface SoAttachment { id: string; key: string; name: string; type: string; size: number; at: string; by: string | null }

async function readAttachments(db: Db, docNo: string, companySql: string): Promise<SoAttachment[] | null> {
  const r = await db.prepare(`SELECT attachments FROM scm.mfg_sales_orders WHERE doc_no = ?${companySql}`).bind(docNo).first<{ attachments: unknown }>();
  if (!r) return null;
  const raw = typeof r.attachments === 'string' ? JSON.parse(r.attachments) as unknown : r.attachments;
  return Array.isArray(raw) ? (raw as SoAttachment[]) : [];
}

renovationSoInfo.get('/:docNo/attachments', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const list = await readAttachments(db, c.req.param('docNo') ?? '', activeCompanySql(c));
  if (!list) return c.json({ error: 'so_not_found' }, 404);
  return c.json({ attachments: list.map(({ key: _key, ...rest }) => rest) });
});

renovationSoInfo.post('/:docNo/attachments', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  if (!c.env.SO_ITEM_PHOTOS) return c.json({ error: 'photo_bucket_not_configured' }, 500);
  const docNo = c.req.param('docNo') ?? '';
  const list = await readAttachments(db, docNo, activeCompanySql(c));
  if (!list) return c.json({ error: 'so_not_found', message: `Sales order ${docNo} does not exist.` }, 404);
  if (list.length >= 50) return c.json({ error: 'too_many', message: 'An order keeps up to 50 attachments.' }, 409);
  let form: Record<string, unknown>;
  try { form = await c.req.parseBody(); } catch { return c.json({ error: 'invalid_multipart' }, 400); }
  const file = form.file as File | undefined;
  if (!file || typeof file === 'string') return c.json({ error: 'file_field_required', message: 'Choose a file.' }, 400);
  if (!ATTACHMENT_TYPES.test(file.type || '')) return c.json({ error: 'invalid_mime', message: 'Attach a photo or a PDF.' }, 400);
  if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'file_too_large', message: 'The file is over 10 MB.' }, 400);
  const id = crypto.randomUUID();
  const ext = (file.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? (file.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase();
  const key = `so-attachments/${docNo}/${id}.${ext}`;
  const by = String(c.get('houzsUser')?.name ?? c.get('houzsUser')?.email ?? '') || null;
  await c.env.SO_ITEM_PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { docNo, uploadedBy: by ?? '' } });
  const item: SoAttachment = { id, key, name: file.name.slice(0, 160) || `attachment.${ext}`, type: file.type, size: file.size, at: new Date().toISOString(), by };
  await db.prepare(`UPDATE scm.mfg_sales_orders SET attachments = attachments || ?::text::jsonb, updated_at = now() WHERE doc_no = ?`)
    .bind(JSON.stringify([item]), docNo).run();
  const { key: _key, ...shown } = item;
  return c.json({ attachment: shown }, 201);
});

renovationSoInfo.get('/:docNo/attachments/:id', async (c: C) => {
  const db = dbOf(c);
  const list = await readAttachments(db, c.req.param('docNo') ?? '', activeCompanySql(c));
  const hit = list?.find((a) => a.id === c.req.param('id'));
  if (!hit) return c.json({ error: 'not_found' }, 404);
  if (!c.env.SO_ITEM_PHOTOS) return c.json({ error: 'photo_bucket_not_configured' }, 500);
  const obj = await c.env.SO_ITEM_PHOTOS.get(hit.key);
  if (!obj) return c.json({ error: 'file_missing' }, 404);
  return new Response(obj.body, { headers: { 'content-type': hit.type, 'content-disposition': `inline; filename="${hit.name.replace(/"/g, '')}"`, 'cache-control': 'private, max-age=300' } });
});

renovationSoInfo.delete('/:docNo/attachments/:id', async (c: C) => {
  const db = dbOf(c);
  const docNo = c.req.param('docNo') ?? '';
  const list = await readAttachments(db, docNo, activeCompanySql(c));
  const hit = list?.find((a) => a.id === c.req.param('id'));
  if (!list || !hit) return c.json({ error: 'not_found' }, 404);
  await db.prepare(`UPDATE scm.mfg_sales_orders SET attachments = ?::text::jsonb, updated_at = now() WHERE doc_no = ?`)
    .bind(JSON.stringify(list.filter((a) => a.id !== hit.id)), docNo).run();
  /* The list no longer names it, so the file goes too; a failed delete leaves an orphan file, never a broken list. */
  try { await c.env.SO_ITEM_PHOTOS?.delete(hit.key); } catch (e) { console.error('[so-attachments] delete failed', e); }
  return c.json({ ok: true });
});
