import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all(env, `
    SELECT i.*, u.unit_number, p.name AS property_name, COALESCE(x.full_name,'') AS inspector
    FROM inspections i
    JOIN units u ON u.id = i.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users x ON x.id = i.inspector_id
    ORDER BY i.inspected_at DESC NULLS FIRST`);

  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map((r: any) => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      inspector: r.inspector || null, state: r.state,
      passed: r.passed === null ? null : !!r.passed,
      checklist: JSON.parse(r.checklist || '[]'),
      notes: r.notes, inspectedAt: r.inspected_at,
    })),
  });
};

/** POST /api/inspections { unitId, taskId? } — starts one from the template. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { unitId, taskId } = await request.json<{ unitId: string; taskId?: string }>();
  if (!unitId) return fail('VALIDATION', 'A unit is required.', 422);

  const TEMPLATE = [
    { item: 'Linen set complete and pressed', ok: null },
    { item: 'Bathroom sealed and dry', ok: null },
    { item: 'Consumables restocked', ok: null },
    { item: 'Aircon cooling within 10 minutes', ok: null },
    { item: 'Wifi reachable at 20 Mbps', ok: null },
  ];

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO inspections (id, unit_id, task_id, inspector_id, state, checklist, created_at)
    VALUES (?, ?, ?, ?, 'assigned', ?, ?)`,
    id, unitId, taskId ?? null, session.userId, JSON.stringify(TEMPLATE), nowIso());

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'inspection.start',
    entityTable: 'inspections', entityId: id, after: { unitId },
  });
  return json({ id, checklist: TEMPLATE }, 201);
};

/** PATCH — submit the completed checklist. A fail keeps the unit out of service. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { id, checklist, notes } = await request.json<{ id: string; checklist: { item: string; ok: boolean; note?: string }[]; notes?: string }>();
  const insp = await one<any>(env, 'SELECT id, state, unit_id FROM inspections WHERE id = ?', id);
  if (!insp) return fail('NOT_FOUND', 'That inspection no longer exists.', 404);

  const passed = checklist.every(c => c.ok);
  await run(env, "UPDATE inspections SET state = ?, passed = ?, checklist = ?, notes = ?, inspected_at = ? WHERE id = ?",
    passed ? 'resolved' : 'reopened', passed ? 1 : 0, JSON.stringify(checklist), notes ?? null, nowIso(), id);

  // A unit is released for check-in only on a pass.
  await run(env, 'UPDATE units SET readiness = ?, updated_at = ? WHERE id = ?',
    passed ? 'ready' : 'inspection', nowIso(), insp.unit_id);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'inspection.submit',
    entityTable: 'inspections', entityId: id,
    before: { state: insp.state }, after: { passed, failedItems: checklist.filter(c => !c.ok).map(c => c.item) },
  });
  return json({ ok: true, passed });
};
