import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, revokeSessions, sendPasswordReset, hashPassword } from '../../../_lib/auth';
import { doorFor } from '../../../_lib/door';

const ACTIONS = ['reset_email', 'temp_password', 'revoke_sessions', 'unlock'] as const;
type Action = typeof ACTIONS[number];

/**
 * POST /api/users/:id/security { action } — management only. Passwords stay hashed.
 *   reset_email      email a one-hour reset link (same as Forgot password)
 *   temp_password    replace their password with a temporary one, returned once so management can pass it on;
 *                    signs them out everywhere, and they must choose their own at the next sign-in
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
  if (id === session.userId && (action === 'temp_password' || action === 'revoke_sessions')) {
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
  } else if (action === 'temp_password') {
    // Only its hash is stored; the plain text is in this one response and nowhere else (not the audit entry).
    const temp = tempPassword();
    await run(env, 'UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      await hashPassword(temp), nowIso(), id);
    await revokeSessions(env, id);
    result = { tempPassword: temp };
  } else if (action === 'revoke_sessions') {
    await revokeSessions(env, id);
  } else {
    await run(env, 'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `user.${action}`, entityTable: 'users', entityId: id, after: { email: user.email } });
  return json(result, 200, { 'cache-control': 'no-store' });
};

/** Read aloud or typed from a message, so no look-alike characters (0/O, 1/l/I). Three groups of four, about 69 bits. */
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map(b => chars[b % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
