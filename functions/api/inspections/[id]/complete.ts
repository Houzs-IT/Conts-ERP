import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

/** POST /api/inspections/:id/complete { result: 'pass' | 'fail', checklist? }
 *  A pass needs every required item checked and passed, and releases the unit for check-in.
 *  A fail needs at least one failed item and keeps the unit out of service. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (!['pass', 'fail'].includes(b?.result)) return fail('VALIDATION', 'Say whether it passed or failed.', 422);

  const cur = await one<any>(env, 'SELECT id, state, unit_id, checklist FROM inspections WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That inspection no longer exists.', 404);
  if (cur.state === 'resolved') return fail('CONFLICT', 'That inspection is already finished.', 409);

  let list = JSON.parse(cur.checklist || '[]') as any[];
  if (Array.isArray(b.checklist)) {
    // Notes and links typed on screen are kept; the pass/fail marks come from the saved checklist unless sent too.
    list = list.map(c => { const n = b.checklist.find((x: any) => x?.item === c.item); return n ? { ...c, ok: n.ok ?? c.ok, note: typeof n.note === 'string' ? n.note.slice(0, 500) : c.note } : c; });
  }

  const unchecked = list.filter(c => c.required !== false && c.ok === null);
  const failed = list.filter(c => c.ok === false);
  if (b.result === 'pass' && (unchecked.length || failed.some(c => c.required !== false))) {
    return fail('CHECKLIST_INCOMPLETE', unchecked.length ? 'Check every required item before passing.' : 'A required item failed, so this cannot pass.', 422);
  }
  if (b.result === 'fail' && !failed.length) return fail('CHECKLIST_INCOMPLETE', 'Mark at least one item as failed.', 422);

  const passed = b.result === 'pass';
  const now = nowIso();
  await run(env, `UPDATE inspections SET state = ?, passed = ?, checklist = ?, inspected_at = ?, inspector_id = COALESCE(inspector_id, ?) WHERE id = ?`,
    passed ? 'resolved' : 'reopened', passed ? 1 : 0, JSON.stringify(list), now, session.userId, id);
  await run(env, 'UPDATE units SET readiness = ?, updated_at = ? WHERE id = ?', passed ? 'ready' : 'inspection', now, cur.unit_id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'inspection.complete', entityTable: 'inspections', entityId: id, before: { state: cur.state }, after: { passed, failedItems: failed.map(c => c.item) } });
  return json({ ok: true, passed });
};
