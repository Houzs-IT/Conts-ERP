/* Site receipt: /api/scm/site-receipts (renovation flow, spec section 5 POD).

   A supplier delivers straight to the customer's unit, or a subcontractor
   finishes a trade; the site supervisor receives the purchase order on the
   phone, at the unit. It IS the PO's goods receipt (same GRN numbering, PO
   received_qty rollup, audit) with proof of delivery attached, and it books no
   stock (scm/lib/renovation-site-receipt.ts).

   Order of work, so a refusal never leaves a half receipt:
     1. validate everything that can be validated without writing
        (lines belong to this project's SO, quantities, photos, signature,
        hardware gate for WORKS lines)
     2. create DRAFT GRN(s) with the shared core (same as /grns/from-po-items)
     3. stamp the POD + photos on each draft in one transaction
        (a failure deletes that draft again)
     4. post through postGrnAndRollup, which skips stock for a site receipt
     5. tick the trade tasks whose purchase order is now fully received
   Photos and signatures are uploaded first to /api/renovation/:id/files, so
   only their keys travel here; every key must sit under renovation/{projectId}/. */

import { Hono, type Context } from "hono";
import type { Env, Variables } from "../env";
import { supabaseAuth } from "../middleware/auth";
import { createDraftGrnsFromPoItemsCore, type GrnFromPoItemsContext } from "../lib/grn-from-po-core";
import { postGrnAndRollup, recordGrnCreate } from "./grns";
import { refuseWithoutWriting } from "../lib/no-write-refusal";
import { requireActiveCompanyId } from "../lib/companyScope";
import { todayMyt } from "../lib/my-time";
import { resolveCallerStaffId } from "../lib/salesScope";
import { hasPermission } from "../../services/permissions";
import { loadProjectRows, loadRenovationFacts, BOARD_CHECKLIST_KEYS, type Db } from "../../services/renovation/load";
import { computeProjectView } from "../../services/renovation/view";
import { GATE_REASON_TEXT } from "../../services/renovation/gate";
import { categoryGroupOf, isCatalogGroup, siteGroupOf } from "../shared/renovation-catalog";

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export const siteReceipts = new Hono<{ Bindings: Env; Variables: Variables }>();
siteReceipts.use("*", supabaseAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PHOTO_KINDS = ["in_place", "supplier_do", "before", "after", "defect", "other"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export interface SiteReceiptBody {
  projectId: number;
  lines: Array<{ poItemId: string; qty: number }>;
  photos: Array<{ r2Key: string; kind: PhotoKind; location?: string | null; poItemId?: string | null; caption?: string | null; takenAt?: string | null }>;
  supervisorSignatureR2Key: string;
  customerSignerName?: string | null;
  customerSignatureR2Key?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  locatedAt?: string | null;
  notes?: string | null;
}

export interface OpenLine {
  po_item_id: string;
  so_item_id: string;
  purchase_order_id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string | null;
  item_code: string;
  material_name: string;
  description: string | null;
  qty: number;
  received_qty: number;
  remaining: number;
  category: string | null;
  category_group: string | null;
  sub_category?: string | null;
  room: string | null;
}

export type BodyRefusal = { error: string; message: string };

/** Everything that can be refused from the body alone. */
export function validateSiteReceiptBody(b: Partial<SiteReceiptBody> | null | undefined): BodyRefusal | null {
  if (!b || !Number.isInteger(b.projectId) || Number(b.projectId) <= 0) return { error: "project_required", message: "Pick the project." };
  const prefix = `renovation/${b.projectId}/`;
  if (!Array.isArray(b.lines) || b.lines.length === 0) return { error: "lines_required", message: "Tick at least one line received." };
  const seen = new Set<string>();
  for (const l of b.lines) {
    if (!l || !UUID.test(String(l.poItemId))) return { error: "invalid_line", message: "A line is not a purchase order line." };
    if (!Number.isInteger(l.qty) || l.qty <= 0) return { error: "qty_must_be_positive", message: "Received quantity must be a whole number above 0." };
    if (seen.has(l.poItemId)) return { error: "duplicate_line", message: "A line was entered twice." };
    seen.add(l.poItemId);
  }
  if (!b.supervisorSignatureR2Key || !String(b.supervisorSignatureR2Key).startsWith(prefix)) {
    return { error: "supervisor_signature_required", message: "The site supervisor must sign." };
  }
  if (b.customerSignatureR2Key) {
    if (!String(b.customerSignatureR2Key).startsWith(prefix)) return { error: "invalid_signature_key", message: "Customer signature upload is not for this project." };
    if (!String(b.customerSignerName ?? "").trim()) return { error: "customer_name_required", message: "Write the customer's name next to their signature." };
  }
  const photos = Array.isArray(b.photos) ? b.photos : [];
  for (const p of photos) {
    if (!p || !String(p.r2Key ?? "").startsWith(prefix) || String(p.r2Key).includes("..")) return { error: "invalid_photo_key", message: "A photo upload is not for this project." };
    if (!PHOTO_KINDS.includes(p.kind)) return { error: "invalid_photo_kind", message: "Unknown photo type." };
    if (p.poItemId != null && !seen.has(String(p.poItemId))) return { error: "photo_line_mismatch", message: "A photo is tagged to a line that is not being received." };
  }
  const hasGps = b.lat != null || b.lng != null;
  if (hasGps) {
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { error: "invalid_location", message: "The phone's location is not valid." };
    }
    if (b.accuracyM != null && (!Number.isFinite(Number(b.accuracyM)) || Number(b.accuracyM) < 0)) return { error: "invalid_location", message: "The phone's location is not valid." };
  }
  return null;
}

/** Photo rules once the lines are known: items in place (or after photos for a
    trade), and the supplier's delivery order whenever goods arrive. */
export function photoRuleRefusal(photos: SiteReceiptBody["photos"], hasGoods: boolean): BodyRefusal | null {
  const kinds = new Set((photos ?? []).map((p) => p.kind));
  if (!kinds.has("in_place") && !kinds.has("after")) return { error: "photo_required", message: "Add at least one photo of the items in place (or an after photo for a trade)." };
  if (hasGoods && !kinds.has("supplier_do")) return { error: "supplier_do_photo_required", message: "Add a photo of the supplier's delivery order." };
  return null;
}

/** The group a line works as on site: a site-trade service (aircon install, cleaning) is a trade, like WORKS. */
export function lineGroupOf(l: Pick<OpenLine, "category" | "category_group" | "sub_category">) {
  const g = l.category_group ? l.category_group.toUpperCase() : null;
  return siteGroupOf(isCatalogGroup(g) ? g : categoryGroupOf(l.category), l.sub_category);
}

const db = (c: Ctx) => c.env.DB as unknown as Db;

export interface SiteReceiptStamp {
  grnId: string; companyId: number; projectId: number; supervisorStaffId: string;
  photos: Array<{ grn_item_id: string | null; location: string | null; kind: string; r2_key: string; caption: string | null; taken_at: string | null }>;
  lat: number | null; lng: number | null; accuracyM: number | null; locatedAt?: string | null;
  supervisorSignatureR2Key: string; customerSignerName: string | null; customerSignatureR2Key: string | null; notes: string | null;
}

/** Marks a just-created GRN as a site receipt (POD fields + photos) in one transaction, and throws when the
    GRN row was not stamped. The shared core inserts the GRN without a status, so it carries the column
    default (POSTED in this schema, not DRAFT); an unstamped receipt would be posted as a warehouse receipt. */
export async function stampSiteReceipt(d: Db, s: SiteReceiptStamp): Promise<void> {
  const hasGps = s.lat != null && s.lng != null;
  const [stamp] = await d.batch!([
    d.prepare(
      `UPDATE scm.grns SET received_at_site = true, project_id = ?, site_received_at = now(),
              site_lat = ?, site_lng = ?, site_accuracy_m = ?, site_located_at = ${hasGps ? "coalesce(?::timestamptz, now())" : "NULL"},
              supervisor_user_id = ?::uuid, supervisor_signature_r2_key = ?, customer_signer_name = ?, customer_signature_r2_key = ?,
              site_notes = ?, delivery_note_ref = coalesce(delivery_note_ref, 'Site receipt'), updated_at = now()
        WHERE id = ?::uuid AND status::text IN ('DRAFT', 'POSTED') AND company_id = ?`,
    ).bind(s.projectId, hasGps ? s.lat : null, hasGps ? s.lng : null, hasGps ? s.accuracyM : null,
      ...(hasGps ? [s.locatedAt ?? null] : []),
      s.supervisorStaffId, s.supervisorSignatureR2Key, s.customerSignerName, s.customerSignatureR2Key, s.notes, s.grnId, s.companyId),
    d.prepare(
      `INSERT INTO scm.grn_site_photos (grn_id, grn_item_id, project_id, location, kind, r2_key, caption, taken_at, uploaded_by, company_id)
       SELECT ?::uuid, x.grn_item_id::uuid, ?, x.location, x.kind, x.r2_key, x.caption, x.taken_at::timestamptz, ?::uuid, ?
         FROM jsonb_to_recordset(?::text::jsonb) AS x(grn_item_id text, location text, kind text, r2_key text, caption text, taken_at text)
        WHERE EXISTS (SELECT 1 FROM scm.grns g WHERE g.id = ?::uuid AND g.received_at_site AND g.project_id = ?)`,
    ).bind(s.grnId, s.projectId, s.supervisorStaffId, s.companyId, JSON.stringify(s.photos), s.grnId, s.projectId),
  ]) as Array<{ count?: number } | undefined>;
  if (Number(stamp?.count ?? 0) !== 1) throw new Error(`site receipt stamp matched ${stamp?.count ?? 0} GRN rows`);
}

async function projectInCompany(c: Ctx, projectId: number, companyId: number): Promise<boolean> {
  const row = await db(c).prepare(`SELECT id FROM projects WHERE id = ? AND project_kind = 'renovation' AND company_id = ?`).bind(projectId, companyId).first();
  return !!row;
}

/** Open PO lines of the project's renovation SO, with their product group and room. */
export async function loadOpenLines(d: Db, projectId: number): Promise<OpenLine[]> {
  const res = await d.prepare(
    `SELECT poi.id::text AS po_item_id, poi.so_item_id::text AS so_item_id, poi.purchase_order_id::text AS purchase_order_id,
            po.po_number, po.supplier_id::text AS supplier_id, sup.name AS supplier_name, poi.item_code, poi.material_name,
            coalesce(i.description, poi.description) AS description, poi.qty, poi.received_qty,
            GREATEST(poi.qty - poi.received_qty, 0) AS remaining,
            p.category::text AS category, to_jsonb(p)->>'category_group' AS category_group, to_jsonb(p)->>'sub_category' AS sub_category, i.location AS room
       FROM scm.mfg_sales_orders so
       JOIN scm.mfg_sales_order_items i ON i.doc_no = so.doc_no AND i.cancelled = false
       JOIN scm.purchase_order_items poi ON poi.so_item_id = i.id
       JOIN scm.purchase_orders po ON po.id = poi.purchase_order_id
       LEFT JOIN scm.suppliers sup ON sup.id = po.supplier_id
       LEFT JOIN LATERAL (SELECT * FROM scm.mfg_products mp WHERE mp.code = i.item_code ORDER BY mp.company_id = i.company_id DESC LIMIT 1) p ON true
      WHERE so.project_id = ? AND so.status::text <> 'CANCELLED' AND to_jsonb(so)->>'so_kind' = 'RENOVATION'
        AND po.status::text NOT IN ('CANCELLED', 'RECEIVED') AND coalesce(po.on_hold, false) = false
      ORDER BY po.po_number, poi.line_no NULLS LAST, poi.created_at`,
  ).bind(projectId).all<OpenLine>();
  return (res.results ?? []).map((r) => ({ ...r, qty: Number(r.qty), received_qty: Number(r.received_qty), remaining: Number(r.remaining) }));
}

function canWriteProjects(c: Ctx): boolean {
  const hu = c.get("houzsUser");
  const granted = hu?.permissions_set ?? hu?.permissions ?? [];
  return hasPermission(granted, "projects.write");
}

siteReceipts.get("/projects/:projectId/open-lines", async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const projectId = Number(c.req.param("projectId"));
  if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: "invalid_project" }, 400);
  if (!(await projectInCompany(c, projectId, co.companyId))) return c.json({ error: "not_found" }, 404);
  const lines = (await loadOpenLines(db(c), projectId)).filter((l) => l.remaining > 0);
  return c.json({ data: lines.map((l) => ({ ...l, group: lineGroupOf(l) })) });
});

siteReceipts.post("/", async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return refuseWithoutWriting(c, co.refusal, 409);
  if (!canWriteProjects(c)) return refuseWithoutWriting(c, { error: "forbidden", message: "Receiving on site needs Projects edit access." }, 403);
  let body: SiteReceiptBody;
  try { body = (await c.req.json()) as SiteReceiptBody; } catch { return refuseWithoutWriting(c, { error: "invalid_json" }, 400); }
  const bad = validateSiteReceiptBody(body);
  if (bad) return refuseWithoutWriting(c, bad, 400);
  const projectId = body.projectId;
  if (!(await projectInCompany(c, projectId, co.companyId))) return refuseWithoutWriting(c, { error: "not_found" }, 404);

  let open: OpenLine[];
  try {
    open = await loadOpenLines(db(c), projectId);
  } catch (e) {
    console.error("[site-receipt] open lines read failed", e);
    return refuseWithoutWriting(c, { error: "lines_unreadable", message: "The project's purchase orders could not be read, so nothing was received." }, 409);
  }
  const byPoItem = new Map(open.map((l) => [l.po_item_id, l]));
  for (const l of body.lines) {
    const ol = byPoItem.get(l.poItemId);
    if (!ol) return refuseWithoutWriting(c, { error: "line_not_in_project", message: "A line does not belong to this project's sales order, or its purchase order is closed." }, 409);
    if (l.qty > ol.remaining) return refuseWithoutWriting(c, { error: "qty_exceeds_remaining", poItemId: l.poItemId, remaining: ol.remaining, message: `Only ${ol.remaining} left to receive on ${ol.po_number}.` }, 409);
  }
  const picked = body.lines.map((l) => byPoItem.get(l.poItemId)!);
  const hasWorks = picked.some((l) => lineGroupOf(l) === "WORKS");
  const hasGoods = picked.some((l) => lineGroupOf(l) !== "WORKS");
  const photoBad = photoRuleRefusal(body.photos, hasGoods);
  if (photoBad) return refuseWithoutWriting(c, photoBad, 400);

  const coreRes = await createDraftGrnsFromPoItemsCore({
    req: { json: async () => ({ picks: body.lines.map((l) => ({ poItemId: l.poItemId, qty: l.qty })), notes: body.notes ?? `Site receipt at project ${projectId}`, receivedDate: todayMyt() }) },
    get: ((key: string) => c.get(key as "supabase")) as unknown as GrnFromPoItemsContext["get"],
  });
  if (!coreRes.ok) return refuseWithoutWriting(c, coreRes.body, coreRes.status);

  const sb = c.get("supabase");
  const user = c.get("user");
  /* The real person who signed, not the pinned system staff row every SCM call runs as. */
  const supervisorStaffId = (await resolveCallerStaffId(sb, c.get("houzsUser")?.id)) ?? user.id;
  const hasGps = body.lat != null && body.lng != null;
  const created: Array<{ id: string; grnNumber: string; posted: boolean; postError?: string }> = [];
  for (const draft of coreRes.created) {
    const draftItems = await sb.from("grn_items").select("id, purchase_order_item_id").eq("grn_id", draft.id);
    const itemByPoItem = new Map(((draftItems.data ?? []) as Array<{ id: string; purchase_order_item_id: string | null }>).map((r) => [r.purchase_order_item_id ?? "", r.id]));
    const draftPhotos = body.photos
      .filter((p) => !p.poItemId || itemByPoItem.has(p.poItemId))
      .map((p) => ({
        grn_item_id: p.poItemId ? (itemByPoItem.get(p.poItemId) ?? null) : null,
        location: p.location?.trim() || (p.poItemId ? (byPoItem.get(p.poItemId)?.room ?? null) : null),
        kind: p.kind,
        r2_key: p.r2Key,
        caption: p.caption ?? null,
        taken_at: p.takenAt ?? null,
      }));
    try {
      await stampSiteReceipt(db(c), {
        grnId: draft.id, companyId: draft.companyId, projectId, supervisorStaffId, photos: draftPhotos,
        lat: hasGps ? Number(body.lat) : null, lng: hasGps ? Number(body.lng) : null, accuracyM: hasGps ? (body.accuracyM ?? null) : null,
        locatedAt: hasGps ? (body.locatedAt ?? null) : undefined, supervisorSignatureR2Key: body.supervisorSignatureR2Key,
        customerSignerName: body.customerSignerName?.trim() || null, customerSignatureR2Key: body.customerSignatureR2Key ?? null, notes: body.notes ?? null,
      });
    } catch (e) {
      console.error("[site-receipt] POD stamp failed; removing the draft", e);
      await sb.from("grn_items").delete().eq("grn_id", draft.id);
      await sb.from("grns").delete().eq("id", draft.id);
      return c.json({ error: "pod_stamp_failed", message: "The proof of delivery could not be saved, so the receipt was not made.", created }, 500);
    }
    const postRes = await postGrnAndRollup(sb, draft.id, user.id, draft.companyId);
    await recordGrnCreate(sb, c.get("houzsUser"), co.companyId, draft.id, draft.lineCount, `Site receipt at the unit (project ${projectId}) from ${draft.poNumbers.join(", ")}`);
    created.push({ id: draft.id, grnNumber: draft.grnNumber, posted: postRes.ok, ...(postRes.ok ? {} : { postError: postRes.reason }) });
  }

  /* Trade tasks complete when their purchase order is fully received. */
  let tasksCompleted = 0;
  try {
    const res = await db(c).prepare(
      `UPDATE project_trade_tasks t
          SET state = 'done', actual_start = coalesce(t.actual_start, ?::date), actual_end = coalesce(t.actual_end, ?::date),
              done_at = coalesce(t.done_at, now()), completed_by_grn_id = ?::uuid, updated_at = now()
        WHERE t.project_id = ? AND t.fulfilment_kind = 'po' AND t.state NOT IN ('done', 'skipped')
          AND EXISTS (SELECT 1 FROM project_trade_task_lines l WHERE l.task_id = t.id AND l.purchase_order_item_id::text IN (SELECT jsonb_array_elements_text(?::text::jsonb)))
          AND NOT EXISTS (
            SELECT 1 FROM project_trade_task_lines l JOIN scm.purchase_order_items poi ON poi.id = l.purchase_order_item_id
             WHERE l.task_id = t.id AND poi.received_qty < poi.qty)`,
    ).bind(todayMyt(), todayMyt(), created.find((x) => x.posted)?.id ?? null, projectId, JSON.stringify(body.lines.map((l) => l.poItemId))).run() as { meta?: { changes?: number } };
    tasksCompleted = res.meta?.changes ?? 0;
  } catch (e) {
    console.error("[site-receipt] task completion failed (receipt stands)", e);
  }
  return c.json({ created, total: created.length, tasksCompleted }, 201);
});

siteReceipts.get("/:grnId", async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const grnId = c.req.param("grnId");
  if (!UUID.test(grnId)) return c.json({ error: "invalid_id" }, 400);
  const head = await db(c).prepare(
    `SELECT g.id::text AS id, g.grn_number, g.status::text AS status, g.project_id, g.site_received_at, g.site_lat, g.site_lng,
            g.site_accuracy_m, g.site_located_at, g.supervisor_signature_r2_key, g.customer_signer_name, g.customer_signature_r2_key,
            g.site_notes, st.name AS supervisor_name, po.po_number, sup.name AS supplier_name
       FROM scm.grns g
       LEFT JOIN scm.staff st ON st.id = g.supervisor_user_id
       LEFT JOIN scm.purchase_orders po ON po.id = g.purchase_order_id
       LEFT JOIN scm.suppliers sup ON sup.id = g.supplier_id
      WHERE g.id = ?::uuid AND g.received_at_site AND g.company_id = ?`,
  ).bind(grnId, co.companyId).first<Record<string, unknown>>();
  if (!head) return c.json({ error: "not_found" }, 404);
  const photos = await db(c).prepare(
    `SELECT id::text AS id, grn_item_id::text AS grn_item_id, location, kind, r2_key, caption, taken_at FROM scm.grn_site_photos WHERE grn_id = ?::uuid ORDER BY created_at`,
  ).bind(grnId).all();
  const lines = await db(c).prepare(
    `SELECT id::text AS id, item_code, material_name, qty_accepted FROM scm.grn_items WHERE grn_id = ?::uuid ORDER BY created_at`,
  ).bind(grnId).all();
  return c.json({ receipt: head, photos: photos.results ?? [], lines: lines.results ?? [] });
});
