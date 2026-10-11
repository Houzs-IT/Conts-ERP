import { type Env, run, json, fail, audit, nowIso, transaction } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { loadTemplates, nameTaken, writeLines, auditShape, mayEditTemplates } from '../../../../_lib/maintenanceTemplates';

/** POST /api/maintenance/templates/:id/duplicate — a copy named "<name> (copy)", "(copy 2)", ... to edit from. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditTemplates(session)) return fail('FORBIDDEN', 'Only management and operations managers can change job templates.', 403);
  const [src] = await loadTemplates(env, { id: String(params.id), money: true });
  if (!src) return fail('NOT_FOUND', 'That template no longer exists.', 404);

  let name = '';
  for (let n = 1; n < 50; n++) {
    const candidate = `${src.name.slice(0, 68)} (copy${n > 1 ? ` ${n}` : ''})`;
    if (!(await nameTaken(env, candidate))) { name = candidate; break; }
  }
  if (!name) return fail('DUPLICATE', 'Too many copies of this template already. Rename one first.', 409);

  const v = {
    name, category: src.category, urgency: src.urgency, assigneeKind: src.assigneeKind, technicianId: src.technicianId, contractorName: src.contractorName,
    estimatedCost: src.estimatedCost, blocksUnit: src.blocksUnit, instructions: src.instructions,
    steps: src.steps.map(s => s.label), parts: src.parts.map(p => ({ skuId: p.skuId, qty: p.qty })),
  };
  const id = crypto.randomUUID(), now = nowIso();
  await transaction(env, async tx => {
    await run(tx, `
      INSERT INTO maintenance_templates (id, name, category, urgency, assignee_kind, technician_id, contractor_name, estimated_cost, blocks_unit, instructions, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, v.name, v.category, v.urgency, v.assigneeKind, v.technicianId, v.contractorName, v.estimatedCost, v.blocksUnit ? 1 : 0, v.instructions, session.userId, now, now);
    await writeLines(tx, id, v);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance_template.duplicate', entityTable: 'maintenance_templates', entityId: id, after: { ...auditShape(v), copiedFrom: src.id } });
  });
  return json({ id, name }, 201);
};
