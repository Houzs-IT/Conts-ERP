import { mayWork } from '../../_lib/access';
import { type Env, one, run, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasPenalties, NOT_MIGRATED, listPenalties, penaltyInput, saveDraft, movePenalty } from '../../_lib/penalties';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)

const head = (env: Env, id: string): Promise<{ status: string; penalty_no: string } | null> =>
  one(env, 'SELECT status, penalty_no FROM worker_penalties WHERE id = ?', id);

/** PUT /api/penalties/:id { ...penalty, submit? } — change a draft (and submit it). A submitted or approved penalty is
 *  changed by rejecting or revoking it first, as on Hookka. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include changing penalties.', 403);
  if (!(await hasPenalties(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const id = String(params.id);
  const before = await head(env, id);
  if (!before) return fail('NOT_FOUND', 'That penalty no longer exists.', 404);
  if (before.status !== 'draft') return fail('CONFLICT', `${before.penalty_no} is ${before.status}. Reject or revoke it before changing it.`, 409);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const parsed = penaltyInput.safeParse(b);
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  await saveDraft(env, parsed.data, session.userId, id);
  if (b?.submit === true) {
    const refused = await movePenalty(env, id, 'submit', session);
    if (refused) return fail('CONFLICT', refused.message, refused.status);
  }
  const [saved] = await listPenalties(env, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'penalty.update', entityTable: 'worker_penalties', entityId: id,
    after: { reason: parsed.data.reason, jobRef: saved?.jobRef, totalSen: saved?.totalSen, workers: saved?.lines.map(l => l.name), submitted: b?.submit === true },
  });
  return json({ data: saved });
};

/** DELETE /api/penalties/:id — throw away a draft. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include changing penalties.', 403);
  if (!(await hasPenalties(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const id = String(params.id);
  const before = await head(env, id);
  if (!before) return fail('NOT_FOUND', 'That penalty no longer exists.', 404);
  if (before.status !== 'draft') return fail('CONFLICT', `${before.penalty_no} is ${before.status}; only a draft can be deleted.`, 409);
  await run(env, `DELETE FROM worker_penalties WHERE id = ? AND status = 'draft'`, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'penalty.delete', entityTable: 'worker_penalties', entityId: id, before: { penaltyNo: before.penalty_no } });
  return json({ ok: true });
};
