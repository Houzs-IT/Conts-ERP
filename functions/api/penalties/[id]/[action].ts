import { mayRun, mayWork } from '../../../_lib/access';
import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hasPenalties, NOT_MIGRATED, listPenalties, movePenalty, isPenaltyAction } from '../../../_lib/penalties';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
const CODE: Record<number, string> = { 403: 'FORBIDDEN', 404: 'NOT_FOUND', 422: 'VALIDATION' };

/** POST /api/penalties/:id/submit | approve | reject { reason } | revoke — Hookka's penalty lifecycle. Submitting needs
 *  Edit on HR; approving, rejecting and revoking need Full. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const action = String(params.action);
  if (!isPenaltyAction(action)) return fail('NOT_FOUND', 'Submit, approve, reject or revoke.', 404);
  if (!(action === 'submit' ? mayWork(session, MANAGE) : mayRun(session, MANAGE))) {
    return fail('FORBIDDEN', action === 'submit' ? 'Your access does not include penalties.' : 'Approving, rejecting and revoking penalties needs Full access to HR.', 403);
  }
  if (!(await hasPenalties(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const reason = typeof b?.reason === 'string' ? b.reason : null;
  const id = String(params.id);
  const refused = await movePenalty(env, id, action, session, reason);
  if (refused) return fail(CODE[refused.status] ?? 'CONFLICT', refused.message, refused.status);
  const [saved] = await listPenalties(env, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: `penalty.${action}`, entityTable: 'worker_penalties', entityId: id,
    after: { status: saved?.status, reason, payrollMonths: [...new Set(saved?.lines.map(l => l.payrollPeriod))] },
  });
  return json({ data: saved });
};
