import { mayRun } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, hashPassword } from '../../../_lib/auth';
import { notify } from '../../../_lib/notify';

/**
 * POST /api/owners/:id/resend-invite — re-send the owner's portal invitation. Same rules as the staff one
 * (users/[id]/resend-invite.ts): only while the login has never been used, a fresh temporary password replaces
 * the unknown one from the first email, and an owner who already signed in gets a password reset instead
 * (owners/[id]/reset-email.ts), so a working password is never replaced from here.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, ['management'])) return fail('FORBIDDEN', 'Only management and operations managers can re-send owner invitations.', 403);

  const id = String(params.id);
  const owner = await one<{ id: string; display_name: string; user_id: string | null }>(env, 'SELECT id, display_name, user_id FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  if (!owner.user_id) return fail('NOT_INVITED', 'This owner has not been invited yet. Use Invite to portal.', 409);
  const user = await one<{ id: string; email: string; must_change_password: number; last_login_at: string | null; is_active: number }>(
    env, "SELECT id, email, must_change_password, last_login_at, is_active FROM users WHERE id = ? AND role = 'owner'", owner.user_id);
  if (!user) return fail('NOT_FOUND', 'This owner\'s portal login no longer exists.', 404);
  if (!user.is_active) return fail('VALIDATION', 'This owner\'s portal login is switched off. Turn it back on before re-inviting.', 422);
  if (!(user.must_change_password && !user.last_login_at)) {
    return fail('ALREADY_ACTIVE', 'This owner has already signed in. Send them a password reset link instead.', 409);
  }

  const temp = crypto.randomUUID().slice(0, 12) + 'A1';
  await run(env, 'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?',
    await hashPassword(temp), nowIso(), user.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.resend_invite', entityTable: 'owners', entityId: id, after: { userId: user.id, email: user.email } });

  // The temporary password leaves the server here and nowhere else.
  const delivery = await notify(env, {
    template: 'account.invited', recipient: user.email, channel: 'email', subject: 'Your Conts owner portal',
    body: `${session.fullName} re-sent your owner portal invitation.\n\nEmail: ${user.email}\nTemporary password: ${temp}\n\nYou will be asked to choose a new password when you first sign in.`,
    entityTable: 'users', entityId: user.id,
    // Every resend carries a new password, so it is a new message: the default hourly key would skip a second
    // resend within the hour and leave the owner holding a password that no longer works.
    idempotencyKey: crypto.randomUUID(),
    urgent: true,
  });
  return json({ id, delivery: delivery.state, reason: delivery.reason });
};
