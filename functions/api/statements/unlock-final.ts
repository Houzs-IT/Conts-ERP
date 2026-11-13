import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { unlockFinal } from '../../_lib/ownerLocks';

/** POST /api/statements/unlock-final { statementId, reason } — Unlock final (owner statement close part 3; spec calls 5 and
 *  6, chew 11 Nov 2026: "final还是要能解锁"). Not paid yet: back to draft and its payout cancelled; the transfer under way:
 *  refused; paid: the difference goes to the next open month as an owner adjustment (ownerLocks.ts unlockFinal). A power
 *  given one by one (access area unlockFinal); the reason is required and kept in the history. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'unlockFinal', 'edit')) return fail('FORBIDDEN', 'Your access does not include Unlock final.', 403);

  const b = await request.json<{ statementId?: unknown; reason?: unknown }>().catch(() => null);
  const statementId = typeof b?.statementId === 'string' ? b.statementId : '';
  const reason = typeof b?.reason === 'string' ? b.reason.trim() : '';
  if (!statementId) return fail('VALIDATION', 'Say which statement to unlock.', 422);
  if (!reason) return fail('VALIDATION', 'Say why you are unlocking.', 422);
  if (reason.length > 500) return fail('VALIDATION', 'Keep the reason under 500 characters.', 422);

  const r = await unlockFinal(env, { userId: session.userId, fullName: session.fullName }, statementId, reason);
  if ('problem' in r) return fail(r.status === 404 ? 'NOT_FOUND' : 'CONFLICT', r.problem, r.status);
  return json(r);
};
