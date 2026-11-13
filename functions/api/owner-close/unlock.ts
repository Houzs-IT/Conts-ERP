import { type Env, json, fail, all } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { unlockStages } from '../../_lib/ownerLocks';
import { STAGES, type Stage } from '../../_lib/stageLocks';

/** POST /api/owner-close/unlock { month, stage, unitIds: string[] | 'all', reason? } — unlocks one category of the month
 *  for these units, or every unit locked in it ('all': Unlock all), and brings each back to today's data (spec call 9).
 *  No reason is needed (chew 13 Nov 2026: "小锁我觉得unlock 不要reason"); one given is kept in the history. Unlock a step
 *  is its own power (access area unlockStep), given person by person. A unit whose month's statement is final is
 *  refused: unlock the final first; each refused unit comes back with its name. A list of units with nothing unlocked
 *  and something refused answers 409 with the first reason; Unlock all answers what it did and which units it left. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'unlockStep', 'edit')) return fail('FORBIDDEN', "You can't unlock a step. Ask management for the Unlock a step permission.", 403);

  const b = await request.json<{ month?: unknown; stage?: unknown; unitIds?: unknown; reason?: unknown }>().catch(() => null);
  const month = String(b?.month ?? ''), stage = String(b?.stage ?? '') as Stage;
  const reason = typeof b?.reason === 'string' ? b.reason.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-10.', 422);
  if (!STAGES.includes(stage)) return fail('VALIDATION', 'Say which category to unlock: income, cleaning, utilities, additional, misc or o2.', 422);
  if (reason.length > 500) return fail('VALIDATION', 'Keep the reason under 500 characters.', 422);
  let which: string[] | 'all' = 'all';
  if (b?.unitIds !== 'all') {
    which = Array.isArray(b?.unitIds) && b.unitIds.every(x => typeof x === 'string') ? [...new Set(b.unitIds as string[])] : [];
    if (!which.length || which.length > 500) return fail('VALIDATION', 'Choose between 1 and 500 units, or all.', 422);
  }

  const r = await unlockStages(env, { userId: session.userId, fullName: session.fullName }, month, stage, which, reason || null);
  // Each unit left locked, named as owner statements name it, so Unlock all can say which (chew, 13 Nov 2026). Only a
  // list of units with nothing unlocked answers 409 (one cell clicked on the Unit report shows that reason).
  const labels = new Map(r.refused.length ? (await all<{ id: string; label: string }>(env, `SELECT u.id, p.name || ' ' || u.unit_number AS label
    FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    JSON.stringify(r.refused.map(x => x.unitId)))).map(x => [x.id, x.label] as const) : []);
  const refused = r.refused.map(x => ({ ...x, label: labels.get(x.unitId) ?? x.unitId }));
  if (which !== 'all' && !r.unlocked.length && refused.length) return fail('CONFLICT', refused[0].problem, 409);
  // regenerate: the months whose draft statement printed a difference this withdrew (generate them again before final).
  return json({ ok: true, unlocked: r.unlocked, notLocked: r.notLocked, refused, regenerate: r.regenerate });
};
