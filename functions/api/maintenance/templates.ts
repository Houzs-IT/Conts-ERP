import { type Env, json, fail, audit, nowIso, run, transaction } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { loadTemplates, checkTemplate, nameTaken, writeLines, auditShape, mayEditTemplates } from '../../_lib/maintenanceTemplates';

/** GET /api/maintenance/templates?archived=1 — the job templates, live ones first, each with its checklist and parts.
 *  Read by everyone who can report a repair (the "Use template" picker, cleaners included); the estimated cost only
 *  for the roles that see repair money. `canEdit` says whether this person may change them. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const archived = new URL(request.url).searchParams.get('archived') === '1' && !isFieldRole(session.role);
  const money = !isFieldRole(session.role) && (session.manage || session.role === 'operations_manager');
  return json({ data: await loadTemplates(env, { archived, money }), canEdit: mayEditTemplates(session) });
};

/** POST /api/maintenance/templates — a new template (management and operations managers). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditTemplates(session)) return fail('FORBIDDEN', 'Only management and operations managers can change job templates.', 403);
  const checked = await checkTemplate(env, await request.json<any>().catch(() => null));
  if (!checked.ok) return fail('VALIDATION', checked.message, 422, checked.fields);
  const v = checked.value;
  if (await nameTaken(env, v.name)) return fail('DUPLICATE', 'A template with that name already exists.', 409, { name: 'That name is taken.' });

  const id = crypto.randomUUID(), now = nowIso();
  await transaction(env, async tx => {
    await run(tx, `
      INSERT INTO maintenance_templates (id, name, category, urgency, assignee_kind, technician_id, contractor_name, estimated_cost, blocks_unit, instructions, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, v.name, v.category, v.urgency, v.assigneeKind, v.technicianId, v.contractorName, v.estimatedCost, v.blocksUnit ? 1 : 0, v.instructions, session.userId, now, now);
    await writeLines(tx, id, v);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance_template.create', entityTable: 'maintenance_templates', entityId: id, after: auditShape(v) });
  });
  return json({ id }, 201);
};
