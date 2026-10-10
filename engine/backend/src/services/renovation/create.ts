/* Opening a renovation project. One SQL statement (data-modifying CTEs), so the
   project, its finance row, its 11 stage rows, its stage checklist copied from
   the type's template and its template tasks all exist together or not at all.
   No brand, venue or event type: those belong to exhibitions. Code RN-YYMM-NNN. */

import { RENO_STAGES } from "../../scm/shared/renovation-stages";
import type { Db } from "./load";
import { planTradeTasks } from "./tradeTasks";

export interface CreateRenovationInput {
  name: string;
  projectTypeId: number;
  customerKind: "owner" | "customer";
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  posOwnerId?: string | null;
  posUnitId?: string | null;
  building?: string | null;
  unitNo?: string | null;
  siteAddress?: string | null;
  plannedHandoverDate?: string | null;
  salespersonName?: string | null;
  picId?: number | null;
  notes?: string | null;
}

export type CreateRefusal =
  | "name_required"
  | "type_required"
  | "customer_kind_invalid"
  | "customer_required"
  | "date_invalid"
  | "uuid_invalid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCreate(body: Partial<CreateRenovationInput>): CreateRefusal | null {
  if (!String(body.name ?? "").trim()) return "name_required";
  if (!Number.isInteger(Number(body.projectTypeId)) || Number(body.projectTypeId) <= 0) return "type_required";
  if (body.customerKind !== "owner" && body.customerKind !== "customer") return "customer_kind_invalid";
  if (!String(body.customerName ?? "").trim() && !body.customerId) return "customer_required";
  if (body.customerId && !UUID.test(body.customerId)) return "uuid_invalid";
  if (body.plannedHandoverDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.plannedHandoverDate)) return "date_invalid";
  return null;
}

/** YYMM in Malaysia time. */
export function codeMonth(now: Date): string {
  const myt = new Date(now.getTime() + 8 * 3600 * 1000);
  return `${String(myt.getUTCFullYear()).slice(2)}${String(myt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function createRenovationProject(
  db: Db,
  input: CreateRenovationInput,
  actorId: number,
  companyId: number,
  now = new Date(),
): Promise<{ id: number; code: string } | null> {
  const typeRow = await db
    .prepare(`SELECT to_json(stage_keys) AS stage_keys FROM project_types WHERE id = ? AND active AND company_id = ?`)
    .bind(input.projectTypeId, companyId)
    .first<{ stage_keys: string[] }>();
  if (!typeRow) return null;
  const internal = planTradeTasks({ works: [], existing: [], typeStageKeys: typeRow.stage_keys }).create.map((t) => ({
    stage_key: t.stageKey,
    trade_code: t.tradeCode,
    label: t.label,
    seq: t.seq,
  }));
  const yymm = codeMonth(now);
  const row = await db
    .prepare(
      `WITH t AS (
         SELECT id, stage_keys, checklist_template_id FROM project_types WHERE id = ? AND active AND company_id = ?
       ),
       code AS (
         SELECT 'RN-' || ? || '-' || lpad((coalesce(max(substring(code from '^RN-[0-9]{4}-([0-9]+)$')::int), 0) + 1)::text, 3, '0') AS code
           FROM projects WHERE code LIKE 'RN-' || ? || '-%'
       ),
       p AS (
         INSERT INTO projects (code, name, stage, project_kind, project_type_id, customer_kind, customer_id, customer_name,
                               customer_phone, customer_email, pos_owner_id, pos_unit_id, building, unit_no, site_address,
                               planned_handover_date, salesperson_name, pic_id, notes, created_by, company_id, reno_stage)
         SELECT code.code, ?, 'draft', 'renovation', t.id, ?, ?::uuid, ?, ?, ?, ?, ?, ?, ?, ?, ?::date, ?, ?, ?, ?, ?, 'design'
           FROM t, code
         RETURNING id, code
       ),
       fin AS (INSERT INTO project_finance (project_id) SELECT id FROM p RETURNING project_id),
       st AS (
         INSERT INTO project_stages (project_id, stage_key, seq, in_type, company_id)
         SELECT p.id, k.key, (k.ord - 1)::int, (k.key = ANY(t.stage_keys) OR k.key IN ('design', 'handover', 'closed')), ?
           FROM p, t, unnest(?::text[]) WITH ORDINALITY AS k(key, ord)
         RETURNING id
       ),
       sec AS (
         INSERT INTO project_checklist_sections (project_id, name, sort_order, display_mode, company_id, stage_key)
         SELECT p.id, ts.name, ts.sort_order, coalesce(ts.display_mode, 'list'), ?, ts.stage_key
           FROM p, t JOIN project_checklist_template_sections ts ON ts.template_id = t.checklist_template_id
          WHERE ts.stage_key = ANY(t.stage_keys)
         RETURNING id, stage_key
       ),
       items AS (
         INSERT INTO project_checklist (project_id, seq, title, description, status, section_id, role_label, crew_visible,
                                        company_id, item_key, evidence_hint, skippable)
         SELECT p.id, ti.seq, ti.title, ti.description, 'pending', sec.id, ti.role_label, ti.crew_visible, ?, ti.item_key,
                ti.evidence_hint, ti.skippable
           FROM p, t
           JOIN project_checklist_template_items ti ON ti.template_id = t.checklist_template_id
           JOIN project_checklist_template_sections ts ON ts.id = ti.section_id
           JOIN sec ON sec.stage_key = ts.stage_key
         RETURNING id
       ),
       tasks AS (
         INSERT INTO project_trade_tasks (project_id, stage_key, trade_code, fix_phase, label, seq, fulfilment_kind, company_id)
         SELECT p.id, x.stage_key, x.trade_code, 'single', x.label, x.seq, 'internal', ?
           FROM p, jsonb_to_recordset(?::text::jsonb) AS x(stage_key text, trade_code text, label text, seq int)
         RETURNING id
       ),
       act AS (
         INSERT INTO project_activity (project_id, action, to_value, user_id, company_id)
         SELECT p.id, 'created', p.code, ?, ? FROM p RETURNING id
       )
       SELECT p.id, p.code, (SELECT count(*) FROM st)::int AS stages, (SELECT count(*) FROM items)::int AS items,
              (SELECT count(*) FROM tasks)::int AS tasks, (SELECT count(*) FROM fin)::int AS fin, (SELECT count(*) FROM act)::int AS act
         FROM p`,
    )
    .bind(
      input.projectTypeId, companyId,
      yymm, yymm,
      input.name.trim(), input.customerKind, input.customerId ?? null, input.customerName?.trim() || null,
      input.customerPhone ?? null, input.customerEmail ?? null, input.posOwnerId ?? null, input.posUnitId ?? null,
      input.building ?? null, input.unitNo ?? null, input.siteAddress ?? null, input.plannedHandoverDate || null,
      input.salespersonName ?? null, input.picId ?? null, input.notes ?? null, actorId, companyId,
      companyId, `{${RENO_STAGES.join(",")}}`,
      companyId,
      companyId,
      companyId, JSON.stringify(internal),
      actorId, companyId,
    )
    .first<{ id: number; code: string }>();
  return row ? { id: Number(row.id), code: row.code } : null;
}
