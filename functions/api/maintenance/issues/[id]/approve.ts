import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, canSeeFinance } from '../../../../_lib/auth';

/** POST /api/maintenance/issues/:id/approve { approved, quotedAmount }
 *  The owner's decision. The quote is echoed back so nobody approves a figure that changed after they saw it. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (typeof b?.approved !== 'boolean') return fail('VALIDATION', 'Say whether you approve.', 422);

  const issue = await one<any>(env, `
    SELECT m.id, m.state, m.quoted_amount, m.owner_approval_required, m.owner_approved_at, o.user_id AS owner_user
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN owners o ON o.id = u.owner_id WHERE m.id = ?`, id);
  if (!issue) return fail('NOT_FOUND', 'That request no longer exists.', 404);

  if (session.role === 'owner' && issue.owner_user !== session.userId) return fail('FORBIDDEN', 'This request belongs to another owner.', 403);
  if (session.role !== 'owner' && !canSeeFinance(session.role)) return fail('FORBIDDEN', 'Only the owner or a finance or management role can decide on a quote.', 403);
  if (issue.owner_approved_at || issue.state === 'resolved') return fail('ALREADY_DECIDED', 'This quote was already approved.', 409);
  if (!issue.owner_approval_required) return fail('NOT_APPLICABLE', 'This work does not need approval.', 422);
  if (issue.quoted_amount !== b.quotedAmount) return fail('QUOTE_CHANGED', 'This quote changed since you last saw it. Review the new amount before approving.', 409);

  const next = b.approved ? 'assigned' : 'waiting';
  await run(env, 'UPDATE maintenance_issues SET state = ?, owner_approved_at = ?, updated_at = ? WHERE id = ?', next, b.approved ? nowIso() : null, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: b.approved ? 'maintenance.approve' : 'maintenance.decline', entityTable: 'maintenance_issues', entityId: id, before: { state: issue.state }, after: { state: next }, source: session.role === 'owner' ? 'owner_portal' : 'web' });
  return json({ ok: true, state: next });
};
