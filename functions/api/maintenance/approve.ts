import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { notify } from '../../_lib/notify';

/** POST /api/maintenance/approve { issueId, approved, quotedAmount }
 *  Owner-facing. The quoted amount is echoed back so an owner cannot approve a
 *  figure that changed after they last saw it. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { issueId, approved, quotedAmount } = await request.json<{ issueId: string; approved: boolean; quotedAmount: number }>();

  const issue = await one<any>(env, `
    SELECT m.id, m.state, m.quoted_amount, m.owner_approval_required, m.owner_approved_at, o.user_id AS owner_user
    FROM maintenance_issues m
    JOIN units u ON u.id = m.unit_id
    JOIN owners o ON o.id = u.owner_id
    WHERE m.id = ?`, issueId);
  if (!issue) return fail('NOT_FOUND', 'That request no longer exists.', 404);

  // Owners may only approve on their own property.
  if (session.role === 'owner' && issue.owner_user !== session.userId) {
    return fail('FORBIDDEN', 'This request belongs to another owner.', 403);
  }
  if (session.role !== 'owner' && !canSeeFinance(session.role)) {
    return fail('FORBIDDEN', 'Only the owner or a finance or management role can decide on a quote.', 403);
  }
  if (issue.owner_approved_at || issue.state === 'resolved') {
    return fail('ALREADY_DECIDED', 'This quote was already approved.', 409);
  }
  if (!issue.owner_approval_required) {
    return fail('NOT_APPLICABLE', 'This work does not need your approval.', 422);
  }
  if (issue.quoted_amount !== quotedAmount) {
    return fail('QUOTE_CHANGED',
      'This quote changed since you last saw it. Review the new amount before approving.', 409);
  }

  const next = approved ? 'assigned' : 'waiting';
  await run(env, 'UPDATE maintenance_issues SET state = ?, owner_approved_at = ?, updated_at = ? WHERE id = ?',
    next, approved ? nowIso() : null, nowIso(), issueId);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName,
    action: approved ? 'maintenance.approve' : 'maintenance.decline',
    entityTable: 'maintenance_issues', entityId: issueId,
    before: { state: issue.state }, after: { state: next },
    source: 'owner_portal',
  });

  await notify(env, {
    template: approved ? 'ops.quote_approved' : 'ops.quote_declined',
    recipient: 'operations@theconts.com',
    channel: 'in_app',
    body: `${session.fullName} ${approved ? 'approved' : 'declined'} the quote. ${approved ? 'Schedule the work.' : 'No work will be scheduled.'}`,
    entityTable: 'maintenance_issues', entityId: issueId,
  });

  return json({ ok: true, state: next });
};
