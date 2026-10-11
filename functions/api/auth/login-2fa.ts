import { type Env, one, run, fail } from '../../_lib/db';
import { securitySettings } from '../../_lib/auth';
import { addressRefusal, decryptSecret, logLogin, matchTotp, readChallenge, twoFactorTables, useBackupCode } from '../../_lib/twoFactor';
import { completeSignIn, countFailure, lockedMessage, type SignInUser } from '../../_lib/signIn';

/**
 * POST /api/auth/login-2fa { challenge, code }
 * The second step of signing in: the challenge from /api/auth/login (proof the password was right, five
 * minutes) plus a six-digit authenticator code or one of the backup codes. A wrong code counts towards the
 * same lock as a wrong password.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const busy = await addressRefusal(env, request);
  if (busy) return fail('TOO_MANY_ATTEMPTS', busy, 429);
  const body = await request.json<{ challenge?: string; code?: string }>().catch(() => null);
  const userId = await readChallenge(env, body?.challenge);
  if (!userId || !(await twoFactorTables(env))) return fail('CHALLENGE_EXPIRED', 'This sign-in took too long. Enter your email and password again.', 401);
  const code = String(body?.code ?? '').trim();
  if (!code) return fail('VALIDATION', 'Enter the code from your authenticator app, or a backup code.', 422);

  const settings = await securitySettings(env);
  const user = await one<SignInUser & { failed_attempts: number; locked_until: string | null; is_active: number; totp_secret: string | null; totp_last_step: number | null }>(env,
    `SELECT id, email, full_name, role, must_change_password, failed_attempts, locked_until, is_active, totp_secret, totp_enabled_at, totp_last_step
     FROM users WHERE id = ?`, userId);
  if (!user || !user.is_active || !user.totp_enabled_at) return fail('CHALLENGE_EXPIRED', 'This sign-in took too long. Enter your email and password again.', 401);

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await logLogin(env, request, { userId: user.id, email: user.email, result: 'locked', method: 'totp' });
    return fail('ACCOUNT_LOCKED', lockedMessage(settings, user.locked_until), 423);
  }

  const digits = code.replace(/\s+/g, '');
  if (/^\d{6}$/.test(digits)) {
    const secret = await decryptSecret(env, user.totp_secret);
    const step = secret ? await matchTotp(secret, digits, user.totp_last_step === null ? null : Number(user.totp_last_step)) : null;
    if (step !== null) {
      await run(env, 'UPDATE users SET totp_last_step = ? WHERE id = ?', step, user.id);
      return completeSignIn(env, request, user, settings, 'totp');
    }
    if (!secret) {
      // The server key is missing or changed: no authenticator code can be checked, only backup codes.
      await logLogin(env, request, { userId: user.id, email: user.email, result: '2fa_failed', method: 'totp' });
      return fail('TOTP_UNAVAILABLE', 'Authenticator codes cannot be checked right now. Use one of your backup codes, or ask management to reset your two-step sign-in.', 503);
    }
  } else if (await useBackupCode(env, user.id, code)) {
    return completeSignIn(env, request, user, settings, 'backup_code');
  }

  const locked = await countFailure(env, settings, user);
  await logLogin(env, request, { userId: user.id, email: user.email, result: locked ? 'locked' : '2fa_failed', method: /^\d{6}$/.test(digits) ? 'totp' : 'backup_code' });
  if (locked) return fail('ACCOUNT_LOCKED', `Too many wrong codes. ${lockedMessage(settings, new Date(Date.now() + settings.lockoutMinutes * 60000).toISOString())}`, 423);
  return fail('INVALID_CODE', 'That code is not right. Codes change every 30 seconds; enter the one showing now, or a backup code.', 401);
};
