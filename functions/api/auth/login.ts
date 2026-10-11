import { type Env, one, json, fail } from '../../_lib/db';
import { verifyPassword, securitySettings } from '../../_lib/auth';
import { doorFor, doorRefusal } from '../../_lib/door';
import { addressRefusal, logLogin, signChallenge, twoFactorAvailable, twoFactorTables } from '../../_lib/twoFactor';
import { completeSignIn, countFailure, lockedMessage, type SignInUser } from '../../_lib/signIn';

/**
 * POST /api/auth/login { email, password }
 * Someone with two-step sign-in on gets { twoStep: true, challenge } instead of a session, and finishes at
 * POST /api/auth/login-2fa with a code. Every attempt is recorded in login_events.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const busy = await addressRefusal(env, request);
  if (busy) return fail('TOO_MANY_ATTEMPTS', busy, 429);
  const settings = await securitySettings(env);

  const { email, password } = await request.json<{ email: string; password: string }>();
  if (!email || !password) return fail('VALIDATION', 'Enter your email and password.', 422);
  const address = email.toLowerCase().trim();

  const totp = await twoFactorTables(env);
  const user = await one<SignInUser & { password_hash: string; failed_attempts: number; locked_until: string | null; is_active: number }>(env,
    `SELECT id, email, full_name, password_hash, role, must_change_password, failed_attempts, locked_until, is_active${totp ? ', totp_enabled_at' : ''}
     FROM users WHERE email = ? LIMIT 1`, address);

  // Same response shape and timing whether or not the account exists.
  const ok = user ? await verifyPassword(password, user.password_hash) : false;

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    await logLogin(env, request, { userId: user.id, email: address, result: 'locked', method: 'password' });
    return fail('ACCOUNT_LOCKED', lockedMessage(settings, user.locked_until), 423);
  }

  if (!user || !ok) {
    if (user) await countFailure(env, settings, user);
    await logLogin(env, request, { userId: user?.id ?? null, email: address, result: 'wrong_password', method: 'password' });
    return fail('INVALID_CREDENTIALS', `Invalid email or password. ${settings.maxAttempts} failed attempts lock the account for ${settings.lockoutMinutes} minutes.`, 401);
  }

  if (!user.is_active) {
    await logLogin(env, request, { userId: user.id, email: address, result: 'inactive', method: 'password' });
    return fail('ACCOUNT_INACTIVE', 'This account is inactive. Ask an administrator to reactivate it.', 403);
  }

  // Checked after the password, so a wrong door never reveals which accounts exist.
  const refusal = doorRefusal(doorFor(request), user.role);
  if (refusal) return fail('WRONG_DOOR', refusal, 403);

  // Failed attempts are not cleared here: the code step counts towards the same lock, so a known password
  // does not buy unlimited guesses at the code.
  if (user.totp_enabled_at) {
    return json({
      twoStep: true,
      challenge: await signChallenge(env, user.id),
      // Without the server key only backup codes can be checked (they are hashed, not encrypted).
      backupOnly: !twoFactorAvailable(env),
    }, 200, { 'cache-control': 'no-store' });
  }

  return completeSignIn(env, request, user, settings, 'password');
};
