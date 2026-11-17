import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { lockStage } from '../../_lib/ownerLocks';
import { unconfirmedRevenue } from '../../_lib/lockReadiness';
import { LOCK_POWER } from '../../_lib/lockPowers';
import { lockMonthProblem, STAGES, stageName, type Stage } from '../../_lib/stageLocks';

/** POST /api/owner-close/lock { month: '2026-10', stage, unitIds: string[] | 'all' } — locks one category of the month
 *  (income = Revenue, cleaning, utilities, additional = Add. ded., misc, o2) for these units, or for every unit the
 *  category lists ('all': Lock all, chew 13 Nov 2026). A unit already locked is left alone and listed as already; Revenue
 *  is held back while the unit's Airbnb reservations are still to confirm (notReady). Each category's power is its own
 *  (lockPowers.ts). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  // Someone with none of the powers is refused before the request is read (the permissions matrix posts {}).
  if (!STAGES.some(s => can(session, LOCK_POWER[s].area, 'edit'))) return fail('FORBIDDEN', "You can't lock any step. Ask management for the Lock income, Lock deductions or Lock O2 permission.", 403);

  const b = await request.json<{ month?: unknown; stage?: unknown; unitIds?: unknown }>().catch(() => null);
  const month = String(b?.month ?? ''), stage = String(b?.stage ?? '') as Stage;
  const problem = lockMonthProblem(month, mytToday());
  if (problem) return fail('VALIDATION', problem, 422);
  if (!STAGES.includes(stage)) return fail('VALIDATION', 'Say which category to lock: income, cleaning, utilities, additional, misc or o2.', 422);
  const power = LOCK_POWER[stage];
  if (!can(session, power.area, 'edit')) return fail('FORBIDDEN', `You can't lock ${stageName(stage)}. Ask management for the ${power.permission} permission.`, 403);
  let which: string[] | 'all' = 'all';
  if (b?.unitIds !== 'all') {
    which = Array.isArray(b?.unitIds) && b.unitIds.every(x => typeof x === 'string') ? [...new Set(b.unitIds as string[])] : [];
    if (!which.length || which.length > 500) return fail('VALIDATION', 'Choose between 1 and 500 units, or all.', 422);
    const known = new Set((await all<{ id: string }>(env, 'SELECT id FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(which))).map(u => u.id));
    const unknown = which.filter(id => !known.has(id));
    if (unknown.length) return fail('VALIDATION', `${unknown.length === 1 ? 'A unit no longer exists' : `${unknown.length} units no longer exist`}. Reload the page.`, 422);
  }

  // Not locked, and listed: already locked; not in this category (a fixed rent or master lease has only O2); a final
  // statement; Revenue with Airbnb reservations still to confirm.
  const unconfirmed = stage === 'income' ? (await unconfirmedRevenue(env, month)).byUnit : new Map<string, number>();
  const r = await lockStage(env, { userId: session.userId, fullName: session.fullName }, month, stage, which, unconfirmed);
  return json({ locked: r.locked, already: r.already, notLockable: r.notLockable, final: r.final, notReady: r.notReady }, r.locked.length ? 201 : 200);
};
