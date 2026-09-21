import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { resolveUnit, refOf, stampMyt } from '../../_lib/ops';

const TEMPLATE = [
  { item: 'Linen set complete and pressed', ok: null, required: true },
  { item: 'Bathroom sealed and dry', ok: null, required: true },
  { item: 'Consumables restocked', ok: null, required: true },
  { item: 'Aircon cooling within 10 minutes', ok: null, required: true },
  { item: 'Wifi reachable at 20 Mbps', ok: null, required: false },
];

/** GET /api/inspections — every inspection with its checklist. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all<any>(env, `
    SELECT i.*, u.unit_number, p.name AS property_name, COALESCE(x.full_name, '') AS inspector
    FROM inspections i
    JOIN units u ON u.id = i.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users x ON x.id = i.inspector_id
    ${isFieldRole(session.role) ? 'WHERE i.inspector_id = ?' : ''}
    ORDER BY i.inspected_at DESC NULLS FIRST, i.created_at DESC`, ...(isFieldRole(session.role) ? [session.userId] : []));

  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, ref: refOf('INS', r.id), unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name,
      inspector: r.inspector || null, state: r.state,
      passed: r.passed === null ? null : !!r.passed,
      checklist: (JSON.parse(r.checklist || '[]') as any[]).map(c => ({
        ...c, required: c.required !== false, ...(c.linkedIssue ? { linkedIssue: refOf('MNT', c.linkedIssue) } : {}),
      })),
      notes: r.notes, inspectedAt: stampMyt(r.inspected_at),
    })),
  });
};

/** POST /api/inspections { unitId | unitNumber, propertyName?, taskId? } — starts one from the template.
 *  If the unit already has an inspection in progress, that one is returned instead of a second. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const b = await request.json<any>().catch(() => null);
  const unit = await resolveUnit(env, b?.unitId ?? b?.unitNumber, b?.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422);
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);

  const open = await one<{ id: string }>(env, `SELECT id FROM inspections WHERE unit_id = ? AND state IN ('open','assigned','in_progress') ORDER BY created_at DESC LIMIT 1`, unit.id);
  if (open) return json({ id: open.id, existing: true });

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO inspections (id, unit_id, task_id, inspector_id, state, checklist, created_at)
    VALUES (?, ?, ?, ?, 'assigned', ?, ?)`, id, unit.id, b.taskId ?? null, session.userId, JSON.stringify(TEMPLATE), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'inspection.create', entityTable: 'inspections', entityId: id, after: { unitId: unit.id } });
  return json({ id }, 201);
};
