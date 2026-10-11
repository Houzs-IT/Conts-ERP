import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { checklistOf, standardItems } from '../../../../_lib/cleaning';

async function load(env: Env, id: string) {
  return one<{ id: string; kind: string; state: string; assignee_id: string | null }>(env, 'SELECT id, kind, state, assignee_id FROM tasks WHERE id = ?', id);
}

/** GET /api/housekeeping/tasks/:id/checklist — the clean's checklist: the standard items, then any added by hand. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const t = await load(env, String(params.id));
  if (!t) return fail('NOT_FOUND', 'That clean no longer exists.', 404);
  if (isFieldRole(session.role) && t.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  return json({ data: await checklistOf(env, t.id, t.kind) });
};

/** POST /api/housekeeping/tasks/:id/checklist { key, done } ticks or unticks one item; { label } adds an item.
 *  Answers with the whole list. A finished clean's list is kept as it was. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const t = await load(env, String(params.id));
  if (!t) return fail('NOT_FOUND', 'That clean no longer exists.', 404);
  if (isFieldRole(session.role) && t.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
  if (t.state === 'resolved') return fail('CONFLICT', 'That clean is finished; its checklist is closed.', 409);

  const b = await request.json<any>().catch(() => null);
  const now = nowIso();
  if (typeof b?.label === 'string') {
    const label = b.label.trim().slice(0, 120);
    if (!label) return fail('VALIDATION', 'Write the item.', 422, { label: 'Write the item.' });
    // A double tap, or the same item typed twice, would list it twice.
    if ((await checklistOf(env, t.id, t.kind)).some(i => i.label.trim().toLowerCase() === label.toLowerCase())) {
      return fail('DUPLICATE', 'That item is already on the list.', 409, { label: 'Already on the list.' });
    }
    const key = `c-${crypto.randomUUID()}`;
    await run(env, `INSERT INTO task_checklist_items (id, task_id, item_key, label, sort_order, created_at) VALUES (?, ?, ?, ?, 1000, ?)`,
      crypto.randomUUID(), t.id, key, label, now);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.checklist_add', entityTable: 'tasks', entityId: t.id, after: { label } });
    return json({ data: await checklistOf(env, t.id, t.kind) }, 201);
  }

  if (typeof b?.key !== 'string' || typeof b?.done !== 'boolean') return fail('VALIDATION', 'Say which item and whether it is done.', 422);
  const std = standardItems(t.kind).find(s => s.key === b.key);
  if (!std && !b.key.startsWith('c-')) return fail('NOT_FOUND', 'That item is not on this checklist.', 404);
  if (std) {
    await run(env, `
      INSERT INTO task_checklist_items (id, task_id, item_key, label, sort_order, done_at, done_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (task_id, item_key) DO UPDATE SET done_at = EXCLUDED.done_at, done_by = EXCLUDED.done_by`,
      crypto.randomUUID(), t.id, std.key, std.label, std.sort, b.done ? now : null, b.done ? session.userId : null, now);
  } else {
    const hit = await one(env, `UPDATE task_checklist_items SET done_at = ?, done_by = ? WHERE task_id = ? AND item_key = ? RETURNING id`,
      b.done ? now : null, b.done ? session.userId : null, t.id, b.key);
    if (!hit) return fail('NOT_FOUND', 'That item is not on this checklist.', 404);
  }
  return json({ data: await checklistOf(env, t.id, t.kind) });
};
