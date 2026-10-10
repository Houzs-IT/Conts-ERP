import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, securitySettings, verifyPassword, hashPassword, revokeSessions, signSession, cookie, sessionLimits } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import {
  backupCodesLeft, decryptSecret, encryptSecret, issueBackupCodes, matchTotp, newSecret, otpauthUri,
  twoFactorAvailable, twoFactorTables,
} from '../../_lib/twoFactor';

/**
 * My account: the signed-in person's own sign-in security.
 *   GET  /api/account                      two-step state, the last 10 sign-ins
 *   POST /api/account/password             { current, password } change their own password
 *   POST /api/account/2fa/setup            start setting up: a new secret, returned once with its otpauth:// address
 *   POST /api/account/2fa/confirm          { code } finish: turns it on and returns 10 backup codes, once
 *   POST /api/account/2fa/disable          { password } turn it off (refused when their role requires it)
 *   POST /api/account/2fa/backup-codes     { password } replace the backup codes, returned once
 *   POST /api/account/sign-out-others      end every other session; this one carries on
 */

const UNAVAILABLE = 'Two-step sign-in cannot be set up yet: the server key for it (TOTP_ENC_KEY) has not been added. Ask management. Signing in with your password still works.';
const NOT_MIGRATED = 'Two-step sign-in needs a database update (migration 0098) that has not been applied yet. Ask management.';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (segments(params).length) return fail('NOT_FOUND', 'Not found.', 404);

  const tables = await twoFactorTables(env);
  const settings = await securitySettings(env);
  const user = await one<{ totp_enabled_at: string | null; last_login_at: string | null }>(env,
    `SELECT ${tables ? 'totp_enabled_at' : 'NULL AS totp_enabled_at'}, last_login_at FROM users WHERE id = ?`, session.userId);
  const recent = tables
    ? await all<{ at: string; ip: string | null; user_agent: string | null; result: string; method: string }>(env,
      'SELECT at, ip, user_agent, result, method FROM login_events WHERE user_id = ? ORDER BY at DESC LIMIT 10', session.userId)
    : [];
  return json({
    twoStep: {
      enabled: !!user?.totp_enabled_at,
      enabledAt: user?.totp_enabled_at ?? null,
      backupCodesLeft: user?.totp_enabled_at ? await backupCodesLeft(env, session.userId) : 0,
      available: twoFactorAvailable(env) && tables,
      unavailableReason: !tables ? NOT_MIGRATED : !twoFactorAvailable(env) ? UNAVAILABLE : null,
      requiredForRole: settings.require2faRoles.includes(session.role),
    },
    recentSignIns: recent.map(r => ({ at: r.at, ip: r.ip, userAgent: r.user_agent, result: r.result, method: r.method })),
  }, 200, { 'cache-control': 'no-store' });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const path = segments(params).join('/');
  const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const me = { actorId: session.userId, actorLabel: session.fullName, entityTable: 'users', entityId: session.userId };

  if (path === 'password') {
    const user = await one<{ password_hash: string }>(env, 'SELECT password_hash FROM users WHERE id = ?', session.userId);
    if (!user || !(await verifyPassword(String(body.current ?? ''), user.password_hash))) {
      return fail('VALIDATION', 'Your current password is not right.', 422, { current: 'Not your current password' });
    }
    const password = String(body.password ?? '');
    const problem = password.length < 8 ? 'At least 8 characters' : !/[A-Z]/.test(password) ? 'At least 1 uppercase letter' : !/[0-9]/.test(password) ? 'At least 1 digit' : null;
    if (problem) return fail('VALIDATION', 'Password does not meet the requirements.', 422, { password: problem });
    await run(env, 'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', await hashPassword(password), nowIso(), session.userId);
    await audit(env, { ...me, action: 'account.password_changed' });
    // A third-party send never fails the change itself.
    try {
      await notify(env, {
        template: 'account.password_changed', recipient: session.email, channel: 'email', subject: 'Your password was changed',
        body: 'Your Conts ERP password was changed just now. If this was not you, contact your administrator immediately.',
        entityTable: 'users', entityId: session.userId, urgent: true,
      });
    } catch (e) {
      await audit(env, { ...me, action: 'notify.failed', after: { template: 'account.password_changed', error: String(e).slice(0, 200) } }).catch(() => {});
    }
    return json({ ok: true });
  }

  if (path === 'sign-out-others') {
    if (!(await revokeSessions(env, session.userId))) return fail('NOT_MIGRATED', 'Signing out other devices needs a database update (migration 0055) that has not been applied yet.', 503);
    await audit(env, { ...me, action: 'account.sign_out_others' });
    // This browser gets a session signed after the stamp, so it is the one that carries on.
    await new Promise(r => setTimeout(r, 2));
    const { ttlHours, absoluteDays } = sessionLimits(await securitySettings(env), session.role);
    const token = await signSession(env.SESSION_SECRET, { userId: session.userId, email: session.email, role: session.role, fullName: session.fullName }, ttlHours, absoluteDays);
    return json({ ok: true }, 200, { 'set-cookie': cookie(request, token, ttlHours * 3600) });
  }

  if (!path.startsWith('2fa/')) return fail('NOT_FOUND', 'Not found.', 404);
  if (!(await twoFactorTables(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const user = await one<{ email: string; password_hash: string; totp_secret: string | null; totp_enabled_at: string | null; role: string }>(env,
    'SELECT email, password_hash, totp_secret, totp_enabled_at, role FROM users WHERE id = ?', session.userId);
  if (!user) return fail('UNAUTHENTICATED', 'Your session expired. Sign in to continue.', 401);

  if (path === '2fa/setup') {
    if (!twoFactorAvailable(env)) return fail('TWO_STEP_UNAVAILABLE', UNAVAILABLE, 503);
    if (user.totp_enabled_at) return fail('ALREADY_ON', 'Two-step sign-in is already on. Turn it off first to move it to a new phone.', 409);
    const secret = newSecret();
    await run(env, 'UPDATE users SET totp_secret = ?, totp_last_step = NULL, updated_at = ? WHERE id = ?', await encryptSecret(env, secret), nowIso(), session.userId);
    return json({ secret, uri: otpauthUri(user.email, secret) }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '2fa/confirm') {
    if (!twoFactorAvailable(env)) return fail('TWO_STEP_UNAVAILABLE', UNAVAILABLE, 503);
    if (user.totp_enabled_at) return fail('ALREADY_ON', 'Two-step sign-in is already on.', 409);
    const secret = await decryptSecret(env, user.totp_secret);
    if (!secret) return fail('VALIDATION', 'Start again: press Set up two-step sign-in.', 422);
    const step = await matchTotp(secret, String(body.code ?? ''), null);
    if (step === null) return fail('VALIDATION', 'That code is not right. Enter the six digits showing in the app now.', 422, { code: 'Not the current code' });
    await run(env, 'UPDATE users SET totp_enabled_at = ?, totp_last_step = ?, updated_at = ? WHERE id = ?', nowIso(), step, nowIso(), session.userId);
    const codes = await issueBackupCodes(env, session.userId);
    await audit(env, { ...me, action: 'account.two_step_enabled' });
    return json({ ok: true, backupCodes: codes }, 200, { 'cache-control': 'no-store' });
  }

  // Turning it off or replacing backup codes needs the password again, so a browser left signed in is not enough.
  if (!(await verifyPassword(String(body.password ?? ''), user.password_hash))) {
    return fail('VALIDATION', 'Your password is not right.', 422, { password: 'Not your password' });
  }

  if (path === '2fa/disable') {
    if ((await securitySettings(env)).require2faRoles.includes(user.role)) {
      return fail('REQUIRED', 'Your role must use two-step sign-in, so it cannot be turned off. To move it to a new phone, ask management to reset it.', 409);
    }
    await run(env, 'UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?', nowIso(), session.userId);
    await run(env, 'DELETE FROM user_backup_codes WHERE user_id = ?', session.userId);
    await audit(env, { ...me, action: 'account.two_step_disabled' });
    return json({ ok: true });
  }

  if (path === '2fa/backup-codes') {
    if (!user.totp_enabled_at) return fail('VALIDATION', 'Turn on two-step sign-in first.', 422);
    const codes = await issueBackupCodes(env, session.userId);
    await audit(env, { ...me, action: 'account.backup_codes_replaced' });
    return json({ ok: true, backupCodes: codes }, 200, { 'cache-control': 'no-store' });
  }

  return fail('NOT_FOUND', 'Not found.', 404);
};

function segments(params: Record<string, unknown>) {
  const p = params.path;
  return Array.isArray(p) ? p.map(String) : p ? [String(p)] : [];
}

