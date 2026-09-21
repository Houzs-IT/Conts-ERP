import { type Env, one, run, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** POST /api/inspections/:id/items { item, result: true | false | null, note?, linkedIssue? } — one checklist line. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (typeof b?.item !== 'string' || ![true, false, null].includes(b.result)) return fail('VALIDATION', 'Give the item and its result.', 422);

  const cur = await one<{ state: string; checklist: string }>(env, 'SELECT state, checklist FROM inspections WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That inspection no longer exists.', 404);
  if (cur.state === 'resolved') return fail('CONFLICT', 'That inspection is already finished.', 409);

  const list = JSON.parse(cur.checklist || '[]') as any[];
  const line = list.find(c => c.item === b.item);
  if (!line) return fail('NOT_FOUND', 'That checklist item does not exist.', 404);
  line.ok = b.result;
  if (typeof b.note === 'string') line.note = b.note.slice(0, 500);
  if (typeof b.linkedIssue === 'string') line.linkedIssue = b.linkedIssue;

  await run(env, `UPDATE inspections SET checklist = ?, state = CASE WHEN state IN ('open','assigned') THEN 'in_progress' ELSE state END, inspector_id = COALESCE(inspector_id, ?) WHERE id = ?`, JSON.stringify(list), session.userId, id);
  return json({ ok: true });
};
