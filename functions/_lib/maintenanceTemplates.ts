import { type Env, all, one, run, nowIso } from './db';
import type { Session } from './auth';
import { isFieldRole } from './auth';
import { mayRun } from './access';
import { CATEGORIES, URGENCIES, ASSIGNEE_KINDS } from './maintenance';

/** Who may add, change, duplicate and archive templates: management and operations managers (or a role management
 *  gave Full on Operations). Everyone else who can open Maintenance reads them for the "Use template" picker. */
export const mayEditTemplates = (s: Session) => mayRun(s, ['management', 'operations_manager']);

export interface TemplateStep { label: string }
export interface TemplatePart { skuId: string; code: string; name: string; unitLabel: string; qty: number; active: boolean }
export interface Template {
  id: string; name: string; category: string; urgency: string; assigneeKind: string | null;
  technicianId: string | null; technicianName: string | null; contractorName: string | null;
  estimatedCost: number | null; blocksUnit: boolean; instructions: string | null; archived: boolean; archivedAt: string | null;
  steps: TemplateStep[]; parts: TemplatePart[]; usedCount: number; updatedAt: string;
}

/** Templates with their steps and parts. `money` false leaves the estimated cost out (roles without finance access). */
export async function loadTemplates(env: Env, opts: { id?: string; archived?: boolean; money: boolean }): Promise<Template[]> {
  const where: string[] = [], args: unknown[] = [];
  if (opts.id) { where.push('t.id = ?'); args.push(opts.id); }
  else if (!opts.archived) where.push('t.archived_at IS NULL');
  const rows = await all<any>(env, `
    SELECT t.*, u.full_name AS technician_name,
           (SELECT COUNT(*)::int FROM maintenance_issues m WHERE m.template_id = t.id) AS used_count
    FROM maintenance_templates t LEFT JOIN users u ON u.id = t.technician_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.archived_at IS NOT NULL, lower(t.name)`, ...args);
  if (!rows.length) return [];
  const ids = JSON.stringify(rows.map(r => r.id));
  const steps = await all<{ template_id: string; label: string }>(env, `
    SELECT template_id, label FROM maintenance_template_steps
    WHERE template_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY template_id, sort_order, id`, ids);
  const parts = await all<any>(env, `
    SELECT p.template_id, p.sku_id, p.qty, s.code, s.name, s.unit_label, s.active
    FROM maintenance_template_parts p JOIN maintenance_skus s ON s.id = p.sku_id
    WHERE p.template_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY s.name`, ids);
  return rows.map(r => ({
    id: r.id, name: r.name, category: r.category, urgency: r.urgency, assigneeKind: r.assignee_kind ?? null,
    technicianId: r.technician_id ?? null, technicianName: r.technician_name ?? null, contractorName: r.contractor_name ?? null,
    estimatedCost: opts.money ? (r.estimated_cost ?? null) : null, blocksUnit: !!r.blocks_unit, instructions: r.instructions ?? null,
    archived: !!r.archived_at, archivedAt: r.archived_at ?? null,
    steps: steps.filter(s => s.template_id === r.id).map(s => ({ label: s.label })),
    parts: parts.filter(p => p.template_id === r.id).map(p => ({ skuId: p.sku_id, code: p.code, name: p.name, unitLabel: p.unit_label, qty: Number(p.qty), active: !!p.active })),
    usedCount: Number(r.used_count), updatedAt: r.updated_at,
  }));
}

export interface TemplateInput {
  name: string; category: string; urgency: string; assigneeKind: string | null; technicianId: string | null; contractorName: string | null;
  estimatedCost: number | null; blocksUnit: boolean; instructions: string | null; steps: string[]; parts: { skuId: string; qty: number }[];
}

type Checked = { ok: true; value: TemplateInput } | { ok: false; message: string; fields: Record<string, string> };

/** Checks a template from the screen. Every field is required in the body except the optional ones, which may be null. */
export async function checkTemplate(env: Env, b: any): Promise<Checked> {
  const bad = (field: string, message: string): Checked => ({ ok: false, message, fields: { [field]: message } });
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (!name) return bad('name', 'Name the template.');
  if (name.length > 80) return bad('name', 'Keep the name to 80 characters.');
  const category = b?.category ?? 'other';
  if (!CATEGORIES.includes(category)) return bad('category', 'Pick a category.');
  const urgency = b?.urgency ?? 'normal';
  if (!URGENCIES.includes(urgency)) return bad('urgency', 'Normal or urgent.');
  const assigneeKind = b?.assigneeKind ?? null;
  if (assigneeKind !== null && !ASSIGNEE_KINDS.includes(assigneeKind)) return bad('assigneeKind', 'In-house or contractor.');

  let technicianId: string | null = null, contractorName: string | null = null;
  if (assigneeKind === 'in_house' && typeof b?.technicianId === 'string' && b.technicianId) {
    const t = await one(env, `SELECT 1 AS x FROM users WHERE id = ? AND role = 'technician' AND is_active = 1`, b.technicianId);
    if (!t) return bad('technicianId', 'Pick an active technician.');
    technicianId = b.technicianId;
  }
  if (assigneeKind === 'contractor' && typeof b?.contractorName === 'string' && b.contractorName.trim()) {
    contractorName = b.contractorName.trim().slice(0, 80);
  }

  const cost = b?.estimatedCost ?? null;
  if (cost !== null && (!Number.isInteger(cost) || cost < 0 || cost > 100_000_000)) return bad('estimatedCost', 'Enter the estimated cost in RM, 0 or more.');
  const instructions = typeof b?.instructions === 'string' && b.instructions.trim() ? b.instructions.trim() : null;
  if (instructions && instructions.length > 1000) return bad('instructions', 'Keep the note to 1,000 characters.');

  if (b?.steps !== undefined && !Array.isArray(b.steps)) return bad('steps', 'The checklist must be a list of steps.');
  const steps: string[] = [];
  for (const s of (b?.steps ?? []) as unknown[]) {
    const label = typeof s === 'string' ? s.trim() : typeof (s as any)?.label === 'string' ? (s as any).label.trim() : '';
    if (!label) continue;
    if (label.length > 160) return bad('steps', 'Keep each step to 160 characters.');
    if (steps.some(x => x.toLowerCase() === label.toLowerCase())) return bad('steps', `"${label}" is on the checklist twice.`);
    steps.push(label);
  }
  if (steps.length > 40) return bad('steps', 'Keep the checklist to 40 steps.');

  if (b?.parts !== undefined && !Array.isArray(b.parts)) return bad('parts', 'The parts must be a list.');
  const parts: { skuId: string; qty: number }[] = [];
  for (const p of (b?.parts ?? []) as any[]) {
    if (typeof p?.skuId !== 'string' || !p.skuId) return bad('parts', 'Pick each part from the catalog.');
    if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > 999) return bad('parts', 'Each quantity must be a whole number from 1 to 999.');
    if (parts.some(x => x.skuId === p.skuId)) return bad('parts', 'A part is listed twice. Change its quantity instead.');
    parts.push({ skuId: p.skuId, qty: p.qty });
  }
  if (parts.length) {
    const found = await all<{ id: string }>(env, `SELECT id FROM maintenance_skus WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(parts.map(p => p.skuId)));
    if (found.length !== parts.length) return bad('parts', 'A part is no longer in the catalog.');
  }
  return { ok: true, value: { name, category, urgency, assigneeKind, technicianId, contractorName, estimatedCost: cost, blocksUnit: !!b?.blocksUnit, instructions, steps, parts } };
}

/** Whether another live template already has this name. */
export async function nameTaken(env: Env, name: string, exceptId?: string) {
  return !!(await one(env, `SELECT 1 AS x FROM maintenance_templates WHERE archived_at IS NULL AND lower(btrim(name)) = lower(btrim(?)) AND id != ?`, name, exceptId ?? ''));
}

/** Rewrites a template's steps and parts. */
export async function writeLines(env: Env, id: string, v: TemplateInput) {
  await run(env, 'DELETE FROM maintenance_template_steps WHERE template_id = ?', id);
  await run(env, 'DELETE FROM maintenance_template_parts WHERE template_id = ?', id);
  if (v.steps.length) {
    await run(env, `
      INSERT INTO maintenance_template_steps (id, template_id, label, sort_order)
      SELECT ? || '-' || s.n, ?, s.label, s.n FROM jsonb_array_elements_text(?::text::jsonb) WITH ORDINALITY AS s(label, n)`,
      `${id}-${Date.now().toString(36)}`, id, JSON.stringify(v.steps));
  }
  if (v.parts.length) {
    await run(env, `
      INSERT INTO maintenance_template_parts (template_id, sku_id, qty)
      SELECT ?, p->>'skuId', (p->>'qty')::int FROM jsonb_array_elements(?::text::jsonb) AS p`, id, JSON.stringify(v.parts));
  }
}

/** A summary of a template for the audit trail. */
export const auditShape = (v: Partial<TemplateInput> & { name?: string }) => ({
  name: v.name, category: v.category, urgency: v.urgency, assigneeKind: v.assigneeKind, technicianId: v.technicianId,
  contractorName: v.contractorName, estimatedCost: v.estimatedCost, blocksUnit: v.blocksUnit, instructions: v.instructions,
  steps: v.steps, parts: v.parts,
});

/** Copies a template's checklist and parts onto a job that was just opened from it. */
export async function applyTemplate(env: Env, issueId: string, templateId: string, by: string) {
  const now = nowIso();
  await run(env, `
    INSERT INTO maintenance_checklist_items (id, issue_id, item_key, label, sort_order, created_at)
    SELECT ? || '-' || row_number() OVER (ORDER BY s.sort_order, s.id), ?, 't-' || row_number() OVER (ORDER BY s.sort_order, s.id), s.label,
           row_number() OVER (ORDER BY s.sort_order, s.id), ?
    FROM maintenance_template_steps s WHERE s.template_id = ?`, issueId, issueId, now, templateId);
  // Planned from the template; the quantity used (and charged) is recorded on the job.
  await run(env, `
    INSERT INTO maintenance_issue_lines (id, issue_id, sku_id, description, uom, unit_price, planned_qty, qty, created_by, created_at, updated_by, updated_at)
    SELECT ? || '-' || p.sku_id, ?, p.sku_id, s.name, s.unit_label, s.default_price, p.qty, 0, ?, ?, ?, ?
    FROM maintenance_template_parts p JOIN maintenance_skus s ON s.id = p.sku_id WHERE p.template_id = ?`,
    issueId, issueId, by, now, by, now, templateId);
}

/** Whether a field account may work on this repair: it is assigned to their account (or, for adding photos, they reported it). */
export async function fieldOwnsRepair(env: Env, session: Session, issueId: string, reporterToo = false) {
  if (!isFieldRole(session.role)) return true;
  return !!(await one(env, 'SELECT 1 AS x FROM maintenance_issues WHERE id = ? AND (assignee_id = ? OR (? AND reported_by = ?))', issueId, session.userId, reporterToo, session.userId));
}

export interface IssueChecklistItem { key: string; label: string; done: boolean; doneAt: string | null; doneBy: string | null; custom: boolean }

export async function issueChecklist(env: Env, issueId: string): Promise<IssueChecklistItem[]> {
  const rows = await all<any>(env, `
    SELECT c.item_key, c.label, c.done_at, u.full_name AS done_by FROM maintenance_checklist_items c LEFT JOIN users u ON u.id = c.done_by
    WHERE c.issue_id = ? ORDER BY c.sort_order, c.created_at`, issueId);
  return rows.map(r => ({ key: r.item_key, label: r.label, done: !!r.done_at, doneAt: r.done_at ?? null, doneBy: r.done_by ?? null, custom: r.item_key.startsWith('c-') }));
}
