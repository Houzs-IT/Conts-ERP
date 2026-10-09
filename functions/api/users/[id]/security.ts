import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, revokeSessions, sendPasswordReset } from '../../../_lib/auth';
import { doorFor } from '../../../_lib/door';

const ACTIONS = ['reset_email', 'force_change', 'revoke_sessions', 'unlock'] as const;
type Action = typeof ACTIONS[number];

/**
 * POST /api/users/:id/security { action } — management only. Passwords stay hashed; none of these ever shows one.
 *   reset_email      email a one-hour reset link (same as Forgot password)
 *   force_change     they must choose a new password at their next sign-in; signs them out now so that is soon
 *   revoke_sessions  sign them out on every device (a lost phone, a shared laptop)
 *   unlock           clear the lock from too many wrong passwords
 * Switching an account off for a while is the existing Active checkbox (PATCH /api/users/:id): the password is kept.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change sign-in security.', 403);

  const id = String(params.id);
  const action = (await request.json<{ action?: Action }>().catch(() => null))?.action;
  if (!action || !ACTIONS.includes(action)) return fail('VALIDATION', 'Unknown action.', 422);
  if (id === session.userId && (action === 'force_change' || action === 'revoke_sessions')) {
    return fail('SELF_LOCKOUT', 'Use Change password on your own account instead.', 422);
  }

  const user = await one<{ id: string; email: string; full_name: string; role: string; is_active: number }>(
    env, 'SELECT id, email, full_name, role, is_active FROM users WHERE id = ?', id);
  if (!user) return fail('NOT_FOUND', 'That account no longer exists.', 404);
  if (!user.is_active && action !== 'revoke_sessions') return fail('VALIDATION', 'Reactivate the account first.', 422);

  let result: Record<string, unknown> = { ok: true };
  if (action === 'reset_email') {
    // An owner's link must open the owner door (reset-password.ts refuses the wrong one).
    const url = new URL(request.url);
    if (user.role === 'owner' && doorFor(request) === 'ops') url.hostname = url.hostname.replace(/^[^.]+/, 'owner');
    const delivery = await sendPasswordReset(env, url.origin, user);
    result = { delivery: delivery.state, reason: delivery.reason };
  } else if (action === 'force_change') {
    await run(env, 'UPDATE users SET must_change_password = 1, updated_at = ? WHERE id = ?', nowIso(), id);
    await revokeSessions(env, id);
  } else if (action === 'revoke_sessions') {
    await revokeSessions(env, id);
  } else {
    await run(env, 'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `user.${action}`, entityTable: 'users', entityId: id, after: { email: user.email } });
  return json(result);
};
