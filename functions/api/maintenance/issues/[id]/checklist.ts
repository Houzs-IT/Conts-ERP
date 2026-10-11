import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { fieldOwnsRepair, issueChecklist } from '../../../../_lib/maintenanceTemplates';

async function load(env: Env, id: string) {
  return one<{ id: string; state: string }>(env, 'SELECT id, state FROM maintenance_issues WHERE id = ?', id);
}

/** GET /api/maintenance/issues/:id/checklist — the job's steps (copied from its template, plus any added by hand). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const m = await load(env, String(params.id));
  if (!m) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (!(await fieldOwnsRepair(env, session, m.id))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  return json({ data: await issueChecklist(env, m.id) });
};

/** POST /api/maintenance/issues/:id/checklist { key, done } ticks or unticks a step; { label } adds one.
 *  Answers with the whole list. A finished job's list is kept as it was. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const m = await load(env, String(params.id));
  if (!m) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (!(await fieldOwnsRepair(env, session, m.id))) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (m.state === 'resolved') return fail('CONFLICT', 'That job is finished; its checklist is closed.', 409);

  const b = await request.json<any>().catch(() => null);
  const now = nowIso();
  if (typeof b?.label === 'string') {
    const label = b.label.trim().slice(0, 160);
    if (!label) return fail('VALIDATION', 'Write the step.', 422, { label: 'Write the step.' });
    if ((await issueChecklist(env, m.id)).some(i => i.label.trim().toLowerCase() === label.toLowerCase())) {
      return fail('DUPLICATE', 'That step is already on the list.', 409, { label: 'Already on the list.' });
    }
    await run(env, `INSERT INTO maintenance_checklist_items (id, issue_id, item_key, label, sort_order, created_at) VALUES (?, ?, ?, ?, 1000, ?)`,
      crypto.randomUUID(), m.id, `c-${crypto.randomUUID()}`, label, now);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.checklist_add', entityTable: 'maintenance_issues', entityId: m.id, after: { label } });
    return json({ data: await issueChecklist(env, m.id) }, 201);
  }

  if (typeof b?.key !== 'string' || typeof b?.done !== 'boolean') return fail('VALIDATION', 'Say which step and whether it is done.', 422);
  const hit = await one<{ label: string }>(env, `UPDATE maintenance_checklist_items SET done_at = ?, done_by = ? WHERE issue_id = ? AND item_key = ? RETURNING label`,
    b.done ? now : null, b.done ? session.userId : null, m.id, b.key);
  if (!hit) return fail('NOT_FOUND', 'That step is not on this checklist.', 404);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: b.done ? 'maintenance.checklist_tick' : 'maintenance.checklist_untick', entityTable: 'maintenance_issues', entityId: m.id, after: { label: hit.label, done: b.done } });
  return json({ data: await issueChecklist(env, m.id) });
};
