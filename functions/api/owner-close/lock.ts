import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { lockStage } from '../../_lib/ownerLocks';
import { lockMonthProblem, STAGES, type Stage } from '../../_lib/stageLocks';

/** Each step's lock is its own power, given person by person (chew: "lock 的功能我会自己assign 去相关做的同事去lock"). */
const POWER: Record<Stage, { area: string; name: string }> = {
  income: { area: 'lockIncome', name: 'income' },
  deductions: { area: 'lockDeductions', name: 'deductions' },
  o2: { area: 'lockO2', name: 'O2' },
};

/** POST /api/owner-close/lock { month: '2026-10', stage: 'income' | 'deductions' | 'o2', unitIds } — locks the step of
 *  the month for the ticked units only (chew: "应该是我要锁的我tick 了锁"). A unit already locked is left alone and
 *  listed as already. Lock income, Lock deductions and Lock O2 are separate powers (access areas lockIncome,
 *  lockDeductions, lockO2). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  // Someone with none of the three powers is refused before the request is read (the permissions matrix posts {}).
  if (!STAGES.some(s => can(session, POWER[s].area, 'edit'))) return fail('FORBIDDEN', "You can't lock any step. Ask management for the Lock income, Lock deductions or Lock O2 permission.", 403);

  const b = await request.json<{ month?: unknown; stage?: unknown; unitIds?: unknown }>().catch(() => null);
  const month = String(b?.month ?? ''), stage = String(b?.stage ?? '') as Stage;
  const problem = lockMonthProblem(month, mytToday());
  if (problem) return fail('VALIDATION', problem, 422);
  if (!STAGES.includes(stage)) return fail('VALIDATION', 'Say which step to lock: income, deductions or O2.', 422);
  const power = POWER[stage];
  if (!can(session, power.area, 'edit')) return fail('FORBIDDEN', `You can't lock ${power.name}. Ask management for the Lock ${power.name} permission.`, 403);
  const unitIds = Array.isArray(b?.unitIds) && b.unitIds.every(x => typeof x === 'string') ? [...new Set(b.unitIds as string[])] : [];
  if (!unitIds.length || unitIds.length > 500) return fail('VALIDATION', 'Tick between 1 and 500 units.', 422);
  const known = new Set((await all<{ id: string }>(env, 'SELECT id FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(unitIds))).map(u => u.id));
  const unknown = unitIds.filter(id => !known.has(id));
  if (unknown.length) return fail('VALIDATION', `${unknown.length === 1 ? 'A unit no longer exists' : `${unknown.length} units no longer exist`}. Reload the page.`, 422);

  // Not locked, and listed: already locked; not on this step (a fixed rent or master lease has no income or deductions
  // to lock); a final statement.
  const r = await lockStage(env, { userId: session.userId, fullName: session.fullName }, month, stage, unitIds);
  return json({ locked: r.locked, already: r.already, notLockable: r.notLockable, final: r.final }, r.locked.length ? 201 : 200);
};
