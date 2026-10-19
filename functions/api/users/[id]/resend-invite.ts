import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, hashPassword } from '../../../_lib/auth';
import { notify } from '../../../_lib/notify';

const MANAGE = ['management'];

/**
 * POST /api/users/:id/resend-invite — re-send the account invitation.
 *
 * Only for an account that was invited but has never signed in (its temporary
 * password is unknown to anyone — it only ever lived in the first email). We mint
 * a fresh temporary password, replace the stored hash, and email it again. An
 * account that has already signed in must use the password-reset flow instead, so
 * we never silently reset a working password from here. Sent urgent, so it goes
 * out immediately rather than waiting for quiet hours to end at 08:00.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) return fail('FORBIDDEN', 'Only management can re-send invitations.', 403);

  const id = String(params.id);
  const user = await one<{ id: string; email: string; full_name: string; must_change_password: number; last_login_at: string | null; is_active: number }>(
    env, 'SELECT id, email, full_name, must_change_password, last_login_at, is_active FROM users WHERE id = ?', id);
  if (!user) return fail('NOT_FOUND', 'That account no longer exists.', 404);
  if (!user.is_active) return fail('VALIDATION', 'Reactivate the account before re-inviting.', 422);
  if (!(user.must_change_password && !user.last_login_at)) {
    return fail('ALREADY_ACTIVE', 'This person has already signed in — send them a password reset instead.', 409);
  }

  // Fresh temporary password: replaces the unknown one from the first invite.
  const temp = crypto.randomUUID().slice(0, 12) + 'A1';
  await run(env, 'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?',
    await hashPassword(temp), nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'user.resend_invite', entityTable: 'users', entityId: id, after: { email: user.email } });

  // The temporary password leaves the server here and nowhere else.
  const delivery = await notify(env, {
    template: 'account.invited', recipient: user.email, channel: 'email', subject: 'Your Conts ERP account',
    body: `${session.fullName} re-sent your account invitation.\n\nEmail: ${user.email}\nTemporary password: ${temp}\n\nYou will be asked to choose a new password when you first sign in.`,
    entityTable: 'users', entityId: id,
    // Every resend carries a new password, so it is a new message: the default hourly key would skip a second
    // send within the hour of the first and leave the person holding a password that no longer works.
    idempotencyKey: crypto.randomUUID(),
    urgent: true,
  });
  return json({ id, delivery: delivery.state, reason: delivery.reason });
};
