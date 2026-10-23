import { mayRun } from '../../../_lib/access';
import { type Env, one, json, fail, audit } from '../../../_lib/db';
import { requireSession, sendPasswordReset } from '../../../_lib/auth';
import { doorFor } from '../../../_lib/door';

/**
 * POST /api/owners/:id/reset-email — email the owner a one-hour password reset link, for an owner whose portal
 * login is already in use (one who never signed in gets a re-sent invitation instead). Same link, expiry and
 * single use as Forgot password (auth.ts sendPasswordReset).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, ['management'])) return fail('FORBIDDEN', 'Only management and operations managers can send an owner a reset link.', 403);

  const id = String(params.id);
  const owner = await one<{ id: string; user_id: string | null }>(env, 'SELECT id, user_id FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  if (!owner.user_id) return fail('NOT_INVITED', 'This owner has no portal login yet. Use Invite to portal.', 409);
  const user = await one<{ id: string; email: string; is_active: number }>(env, "SELECT id, email, is_active FROM users WHERE id = ? AND role = 'owner'", owner.user_id);
  if (!user) return fail('NOT_FOUND', 'This owner\'s portal login no longer exists.', 404);
  if (!user.is_active) return fail('VALIDATION', 'This owner\'s portal login is switched off.', 422);

  // An owner's link must open the owner door (reset-password.ts refuses the wrong one).
  const url = new URL(request.url);
  if (doorFor(request) === 'ops') url.hostname = url.hostname.replace(/^[^.]+/, 'owner');
  const delivery = await sendPasswordReset(env, url.origin, user);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.reset_email', entityTable: 'owners', entityId: id, after: { userId: user.id, delivery: delivery.state } });
  return json({ id, delivery: delivery.state, reason: delivery.reason });
};
