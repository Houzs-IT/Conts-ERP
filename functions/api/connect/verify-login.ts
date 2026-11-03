import { type Env, one, run, json, fail, nowIso } from '../../_lib/db';
import { securitySettings, timingSafeEqualStr, verifyPassword } from '../../_lib/auth';
import { addressRefusal, decryptSecret, logLogin, matchTotp, readChallenge, signChallenge, twoFactorTables, useBackupCode } from '../../_lib/twoFactor';
import { countFailure, lockedMessage } from '../../_lib/signIn';

/**
 * POST /api/connect/verify-login — Houzs Connect (the company chat) checks a Conts account here, so Conts staff
 * sign in to Connect with their Conts email and password. Called by Connect's server, never a browser: the
 * caller proves itself with CONNECT_LOGIN_KEY as a Bearer token. Unset, every call is refused.
 *
 *   { email, password }   → { ok: true, user } or { twoStep: true, challenge }
 *   { challenge, code }   → { ok: true, user }   (the authenticator code or a backup code)
 *
 * The same rules as signing in here: wrong passwords and codes count towards the same lock, a locked or inactive
 * account is refused, two-step sign-in is asked for, and every attempt is in login_events. No Conts session is
 * made; Connect keeps its own.
 */
type Account = {
  id: string; email: string; full_name: string; password_hash: string; role: string;
  failed_attempts: number; locked_until: string | null; is_active: number;
  totp_enabled_at?: string | null; totp_secret?: string | null; totp_last_step?: number | null;
};

const person = (u: Account) => ({ ok: true, user: { email: u.email, name: u.full_name, role: u.role } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // The key is checked before anything about an account is said.
  const key = (env.CONNECT_LOGIN_KEY ?? '').trim();
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!key || !given || !timingSafeEqualStr(given, key)) return fail('UNAUTHENTICATED', 'Not allowed.', 401);

  const busy = await addressRefusal(env, request);
  if (busy) return fail('TOO_MANY_ATTEMPTS', busy, 429);
  const body = await request.json<{ email?: string; password?: string; challenge?: string; code?: string }>().catch(() => null);
  const settings = await securitySettings(env);
  const totp = await twoFactorTables(env);
  const columns = `id, email, full_name, password_hash, role, failed_attempts, locked_until, is_active${totp ? ', totp_enabled_at, totp_secret, totp_last_step' : ''}`;

  const passed = async (u: Account, method: 'password' | 'totp' | 'backup_code') => {
    await run(env, 'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), u.id);
    await logLogin(env, request, { userId: u.id, email: u.email, result: 'success', method });
    return json(person(u), 200, { 'cache-control': 'no-store' });
  };

  // Second step: the code.
  if (body?.challenge) {
    const userId = await readChallenge(env, body.challenge);
    const u = userId && totp ? await one<Account>(env, `SELECT ${columns} FROM users WHERE id = ?`, userId) : null;
    if (!u || !u.is_active || !u.totp_enabled_at) return fail('CHALLENGE_EXPIRED', 'This sign-in took too long. Enter your email and password again.', 401);
    if (u.locked_until && new Date(u.locked_until) > new Date()) return fail('ACCOUNT_LOCKED', lockedMessage(settings, u.locked_until), 423);
    const code = String(body.code ?? '').trim();
    if (!code) return fail('VALIDATION', 'Enter the code from your authenticator app, or a backup code.', 422);
    const digits = code.replace(/\s+/g, '');
    if (/^\d{6}$/.test(digits)) {
      const secret = await decryptSecret(env, u.totp_secret ?? null);
      const step = secret ? await matchTotp(secret, digits, u.totp_last_step == null ? null : Number(u.totp_last_step)) : null;
      if (step !== null) {
        await run(env, 'UPDATE users SET totp_last_step = ? WHERE id = ?', step, u.id);
        return passed(u, 'totp');
      }
    } else if (await useBackupCode(env, u.id, code)) {
      return passed(u, 'backup_code');
    }
    const locked = await countFailure(env, settings, u);
    await logLogin(env, request, { userId: u.id, email: u.email, result: locked ? 'locked' : '2fa_failed', method: /^\d{6}$/.test(digits) ? 'totp' : 'backup_code' });
    return fail('INVALID_CODE', 'That code is not right. Enter the one showing now in your authenticator app, or a backup code.', 401);
  }

  // First step: email and password.
  const address = String(body?.email ?? '').toLowerCase().trim();
  const password = String(body?.password ?? '');
  if (!address || !password) return fail('VALIDATION', 'Enter your email and password.', 422);
  const u = await one<Account>(env, `SELECT ${columns} FROM users WHERE email = ? LIMIT 1`, address);
  const ok = u ? await verifyPassword(password, u.password_hash) : false;
  if (u?.locked_until && new Date(u.locked_until) > new Date()) {
    await logLogin(env, request, { userId: u.id, email: address, result: 'locked', method: 'password' });
    return fail('ACCOUNT_LOCKED', lockedMessage(settings, u.locked_until), 423);
  }
  if (!u || !ok) {
    if (u) await countFailure(env, settings, u);
    await logLogin(env, request, { userId: u?.id ?? null, email: address, result: 'wrong_password', method: 'password' });
    return fail('INVALID_CREDENTIALS', 'Wrong email or password.', 401);
  }
  if (!u.is_active) {
    await logLogin(env, request, { userId: u.id, email: address, result: 'inactive', method: 'password' });
    return fail('ACCOUNT_INACTIVE', 'This Conts account is inactive.', 403);
  }
  if (u.totp_enabled_at) return json({ twoStep: true, challenge: await signChallenge(env, u.id) }, 200, { 'cache-control': 'no-store' });
  return passed(u, 'password');
};
