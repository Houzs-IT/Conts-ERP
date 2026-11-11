import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { lockIncome } from '../../_lib/ownerLocks';
import { lockMonthProblem } from '../../_lib/stageLocks';

/** POST /api/owner-close/lock { month: '2026-10', stage: 'income', unitIds } — locks the stage of the month for the
 *  ticked units only (chew: "应该是我要锁的我tick 了锁"). A unit already locked is left alone and listed as already.
 *  Lock income is its own power (access area lockIncome), given person by person. Deductions and O2 come in part 2. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'lockIncome', 'edit')) return fail('FORBIDDEN', "You can't lock income. Ask management for the Lock income permission.", 403);

  const b = await request.json<{ month?: unknown; stage?: unknown; unitIds?: unknown }>().catch(() => null);
  const month = String(b?.month ?? ''), stage = String(b?.stage ?? '');
  const problem = lockMonthProblem(month, mytToday());
  if (problem) return fail('VALIDATION', problem, 422);
  if (stage !== 'income') return fail('VALIDATION', 'Only income can be locked so far.', 422);
  const unitIds = Array.isArray(b?.unitIds) && b.unitIds.every(x => typeof x === 'string') ? [...new Set(b.unitIds as string[])] : [];
  if (!unitIds.length || unitIds.length > 500) return fail('VALIDATION', 'Tick between 1 and 500 units.', 422);
  const known = new Set((await all<{ id: string }>(env, 'SELECT id FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(unitIds))).map(u => u.id));
  const unknown = unitIds.filter(id => !known.has(id));
  if (unknown.length) return fail('VALIDATION', `${unknown.length === 1 ? 'A unit no longer exists' : `${unknown.length} units no longer exist`}. Reload the page.`, 422);

  // Not locked, and listed: already locked; a fixed rent or master lease (no income to lock); a final statement.
  const r = await lockIncome(env, { userId: session.userId, fullName: session.fullName }, month, unitIds);
  return json({ locked: r.locked, already: r.already, notLockable: r.notLockable, final: r.final }, r.locked.length ? 201 : 200);
};
