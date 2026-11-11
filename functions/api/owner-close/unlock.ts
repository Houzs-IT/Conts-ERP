import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { unlockStage } from '../../_lib/ownerLocks';
import { STAGES, type Stage } from '../../_lib/stageLocks';

/** POST /api/owner-close/unlock { month, stage, unitId, reason } — unlocks one step of one unit's month and brings it
 *  back to today's data (spec call 9). The reason is required and kept in the audit log. Unlock a step is its own
 *  power (access area unlockStep), given person by person. Refused while the month's own statement is final. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'unlockStep', 'edit')) return fail('FORBIDDEN', "You can't unlock a step. Ask management for the Unlock a step permission.", 403);

  const b = await request.json<{ month?: unknown; stage?: unknown; unitId?: unknown; reason?: unknown }>().catch(() => null);
  const month = String(b?.month ?? ''), stage = String(b?.stage ?? ''), unitId = String(b?.unitId ?? '');
  const reason = typeof b?.reason === 'string' ? b.reason.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-10.', 422);
  if (!STAGES.includes(stage as Stage)) return fail('VALIDATION', 'Say which step to unlock: income, deductions or O2.', 422);
  if (!unitId) return fail('VALIDATION', 'Say which unit to unlock.', 422);
  if (!reason) return fail('VALIDATION', 'Say why you are unlocking.', 422);
  if (reason.length > 500) return fail('VALIDATION', 'Keep the reason under 500 characters.', 422);

  const r = await unlockStage(env, { userId: session.userId, fullName: session.fullName }, month, stage as Stage, unitId, reason);
  if ('problem' in r) return fail(r.status === 404 ? 'NOT_FOUND' : 'CONFLICT', r.problem, r.status);
  // regenerate: the months whose draft statement printed a difference this withdrew (generate them again before final).
  return json({ ok: true, regenerate: r.regenerate });
};
