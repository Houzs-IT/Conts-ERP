import { type Env, json, run, nowIso } from './db';
import { levelsFor } from './access';
import { signSession, cookie, sessionLimits, startSession, type SecuritySettings } from './auth';
import { HOME } from './door';
import { logLogin, twoFactorAvailable, twoFactorTables, type LoginMethod } from './twoFactor';
import { employeeIdOfUser } from './fieldPin';

export interface SignInUser { id: string; email: string; full_name: string; role: string; must_change_password: number; totp_enabled_at?: string | null }

/** True when management requires two-step sign-in for this role, this person has not set it up yet, and it
 *  can be set up here (the server has its key and the database has migration 0098). Without the key nobody is
 *  held at the set-up screen, because they could never get past it. */
export async function twoStepSetupDue(env: Env, settings: SecuritySettings, role: string, enabled: boolean) {
  return !enabled && settings.require2faRoles.includes(role) && twoFactorAvailable(env) && await twoFactorTables(env);
}

/** The last step of every successful sign-in (password only, or password then code): clears failed attempts,
 *  records it, and issues the session cookie. */
export async function completeSignIn(env: Env, request: Request, user: SignInUser, settings: SecuritySettings, method: LoginMethod) {
  await run(env, 'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), user.id);
  await logLogin(env, request, { userId: user.id, email: user.email, result: 'success', method });

  const { ttlHours, absoluteDays } = sessionLimits(settings, user.role);
  const sid = await startSession(env, request, user.id, absoluteDays);
  const token = await signSession(env.SESSION_SECRET, {
    userId: user.id, email: user.email, role: user.role, fullName: user.full_name, sid,
  }, ttlHours, absoluteDays);

  return json({
    user: {
      id: user.id, fullName: user.full_name, email: user.email, role: user.role,
      mustChangePassword: !!user.must_change_password, locale: 'en-MY', employeeId: await employeeIdOfUser(env, user.id),
      twoStepSetupRequired: await twoStepSetupDue(env, settings, user.role, !!user.totp_enabled_at),
      access: await levelsFor(env, user.role),
    },
    home: user.must_change_password ? '/change-password' : (HOME[user.role] ?? '/'),
  }, 200, { 'set-cookie': cookie(request, token, ttlHours * 3600) });
}

/** One wrong password or code: counts towards the lock, and says how it ended for the sign-in record. */
export async function countFailure(env: Env, settings: SecuritySettings, user: { id: string; failed_attempts: number }) {
  const attempts = user.failed_attempts + 1;
  const lock = attempts >= settings.maxAttempts ? new Date(Date.now() + settings.lockoutMinutes * 60000).toISOString() : null;
  await run(env, 'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', attempts, lock, user.id);
  return !!lock;
}

export function lockedMessage(settings: SecuritySettings, lockedUntil: string) {
  return `Account locked for ${settings.lockoutMinutes} minutes after ${settings.maxAttempts} failed attempts. Try again at ${new Date(lockedUntil).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false })} or ask an administrator to reset it.`;
}
