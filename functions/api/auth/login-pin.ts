import { type Env, one, json, fail } from '../../_lib/db';
import { verifyPassword, securitySettings } from '../../_lib/auth';
import { doorFor, doorRefusal } from '../../_lib/door';
import { addressRefusal, logLogin, signChallenge, twoFactorAvailable, twoFactorTables } from '../../_lib/twoFactor';
import { completeSignIn, countFailure, lockedMessage, type SignInUser } from '../../_lib/signIn';
import { employeeIdOf, hasEmployeeIds } from '../../_lib/fieldPin';

/**
 * POST /api/auth/login-pin { employeeId, pin } — the field app's sign-in for cleaners and technicians given app access
 * on HR > Employees. "1", "001" and "EMP-001" all mean EMP-001. Same locks and records as POST /api/auth/login: wrong PINs
 * count towards the account's lock and the connection's limit, so six digits are never open to unlimited guessing.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const busy = await addressRefusal(env, request);
  if (busy) return fail('TOO_MANY_ATTEMPTS', busy, 429);
  const settings = await securitySettings(env);

  const b = await request.json<{ employeeId?: unknown; pin?: unknown }>().catch(() => null);
  const pin = typeof b?.pin === 'string' ? b.pin.trim() : '';
  if (typeof b?.employeeId !== 'string' || !b.employeeId.trim() || !pin) return fail('VALIDATION', 'Enter your employee ID and PIN.', 422);
  const employeeId = employeeIdOf(b.employeeId);
  const tried = employeeId ?? b.employeeId.trim().slice(0, 20);

  const totp = await twoFactorTables(env);
  const user = employeeId && await hasEmployeeIds(env)
    ? await one<SignInUser & { password_hash: string; failed_attempts: number; locked_until: string | null; is_active: number }>(env,
      `SELECT id, email, full_name, password_hash, role, must_change_password, failed_attempts, locked_until, is_active${totp ? ', totp_enabled_at' : ''}
       FROM users WHERE employee_id = ? AND role IN ('housekeeper','technician') LIMIT 1`, employeeId)
    : null;

  // Same response shape and timing whether or not the account exists.
  const ok = user ? await verifyPassword(pin, user.password_hash) : false;
  const wrong = `Wrong employee ID or PIN. ${settings.maxAttempts} wrong tries lock the account for ${settings.lockoutMinutes} minutes.`;

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    await logLogin(env, request, { userId: user.id, email: tried, result: 'locked', method: 'pin' });
    return fail('ACCOUNT_LOCKED', lockedMessage(settings, user.locked_until), 423);
  }

  if (!user || !ok) {
    if (user) await countFailure(env, settings, user);
    await logLogin(env, request, { userId: user?.id ?? null, email: tried, result: 'wrong_password', method: 'pin' });
    return fail('INVALID_CREDENTIALS', wrong, 401);
  }

  if (!user.is_active) {
    await logLogin(env, request, { userId: user.id, email: tried, result: 'inactive', method: 'pin' });
    return fail('ACCOUNT_INACTIVE', 'This account is switched off. Ask the office to switch it back on.', 403);
  }

  const refusal = doorRefusal(doorFor(request), user.role);
  if (refusal) return fail('WRONG_DOOR', refusal, 403);

  if (user.totp_enabled_at) {
    return json({ twoStep: true, challenge: await signChallenge(env, user.id), backupOnly: !twoFactorAvailable(env) },
      200, { 'cache-control': 'no-store' });
  }

  return completeSignIn(env, request, user, settings, 'pin');
};
