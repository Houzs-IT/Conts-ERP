import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { loadTemplates, checkTemplate, nameTaken, writeLines, auditShape, mayEditTemplates } from '../../../_lib/maintenanceTemplates';

/** GET /api/maintenance/templates/:id — one template, archived or not. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const money = !isFieldRole(session.role) && (session.manage || session.role === 'operations_manager');
  const [t] = await loadTemplates(env, { id: String(params.id), money });
  if (!t) return fail('NOT_FOUND', 'That template no longer exists.', 404);
  return json({ data: t });
};

/** PATCH /api/maintenance/templates/:id — the whole template as the edit form sends it, or { archived: true|false }.
 *  Jobs already opened from it keep the checklist and parts they were given. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditTemplates(session)) return fail('FORBIDDEN', 'Only management and operations managers can change job templates.', 403);
  const id = String(params.id);
  const [cur] = await loadTemplates(env, { id, money: true });
  if (!cur) return fail('NOT_FOUND', 'That template no longer exists.', 404);
  const b = await request.json<any>().catch(() => null);
  const now = nowIso();

  if (typeof b?.archived === 'boolean' && Object.keys(b).length === 1) {
    if (b.archived === cur.archived) return json({ ok: true });
    if (!b.archived && await nameTaken(env, cur.name, id)) return fail('DUPLICATE', 'A live template already has this name. Rename that one first.', 409);
    await run(env, 'UPDATE maintenance_templates SET archived_at = ?, updated_at = ? WHERE id = ?', b.archived ? now : null, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: b.archived ? 'maintenance_template.archive' : 'maintenance_template.restore', entityTable: 'maintenance_templates', entityId: id, before: { archived: cur.archived }, after: { archived: b.archived } });
    return json({ ok: true });
  }

  if (cur.archived) return fail('CONFLICT', 'That template is archived. Restore it to change it.', 409);
  const checked = await checkTemplate(env, b);
  if (!checked.ok) return fail('VALIDATION', checked.message, 422, checked.fields);
  const v = checked.value;
  if (await nameTaken(env, v.name, id)) return fail('DUPLICATE', 'A template with that name already exists.', 409, { name: 'That name is taken.' });

  await transaction(env, async tx => {
    await run(tx, `
      UPDATE maintenance_templates SET name = ?, category = ?, urgency = ?, assignee_kind = ?, technician_id = ?, contractor_name = ?,
             estimated_cost = ?, blocks_unit = ?, instructions = ?, updated_at = ? WHERE id = ?`,
      v.name, v.category, v.urgency, v.assigneeKind, v.technicianId, v.contractorName, v.estimatedCost, v.blocksUnit ? 1 : 0, v.instructions, now, id);
    await writeLines(tx, id, v);
    await audit(tx, {
      actorId: session.userId, actorLabel: session.fullName, action: 'maintenance_template.edit', entityTable: 'maintenance_templates', entityId: id,
      before: auditShape({ ...cur, steps: cur.steps.map(s => s.label), parts: cur.parts.map(p => ({ skuId: p.skuId, qty: p.qty })) }),
      after: auditShape(v),
    });
  });
  return json({ ok: true });
};

/** DELETE /api/maintenance/templates/:id — only a template no job was ever opened from; a used one is archived instead,
 *  so the jobs keep saying which template they came from. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditTemplates(session)) return fail('FORBIDDEN', 'Only management and operations managers can change job templates.', 403);
  const id = String(params.id);
  const [cur] = await loadTemplates(env, { id, money: true });
  if (!cur) return fail('NOT_FOUND', 'That template no longer exists.', 404);
  const used = await one<{ n: number }>(env, 'SELECT COUNT(*)::int AS n FROM maintenance_issues WHERE template_id = ?', id);
  if (Number(used?.n) > 0) return fail('IN_USE', `${used!.n} ${used!.n === 1 ? 'job was' : 'jobs were'} opened from this template. Archive it instead.`, 409);
  await transaction(env, async tx => {
    await run(tx, 'DELETE FROM maintenance_templates WHERE id = ?', id);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance_template.delete', entityTable: 'maintenance_templates', entityId: id, before: auditShape({ ...cur, steps: cur.steps.map(s => s.label), parts: cur.parts.map(p => ({ skuId: p.skuId, qty: p.qty })) }) });
  });
  return json({ ok: true });
};
