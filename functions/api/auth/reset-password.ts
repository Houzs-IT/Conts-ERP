import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { signSession, cookie, hashPassword, sessionLimits, securitySettings } from '../../_lib/auth';
import { doorFor, doorRefusal, HOME } from '../../_lib/door';
import { notify } from '../../_lib/notify';

async function hashToken(token: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Shared by GET (check only) and POST (check + consume): one generic answer
 *  whether the token is unknown, already used, or expired — never tells a
 *  caller which case it is. Returns the user row when the token is genuinely
 *  usable, or a ready-to-return Response when it is not. */
async function lookupValid(env: Env, request: Request, hash: string) {
  const invalid = () => fail('INVALID_TOKEN', 'This reset link is invalid or has expired. Request a new one.', 400);

  const row = await one<{ token_hash: string; user_id: string; expires_at: string; used_at: string | null }>(
    env, 'SELECT * FROM password_reset_tokens WHERE token_hash = ?', hash);
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return { response: invalid() };

  const user = await one<{ id: string; email: string; full_name: string; role: string; is_active: number }>(
    env, 'SELECT id, email, full_name, role, is_active FROM users WHERE id = ?', row.user_id);
  if (!user || !user.is_active) return { response: invalid() };

  // Same rule as signing in: an owner's link only opens the owner door, and so
  // on — checked here too (not only on submit) so a page load already tells the
  // visitor to use the right address, rather than only failing after they type
  // a new password.
  const refusal = doorRefusal(doorFor(request), user.role);
  if (refusal) return { response: fail('WRONG_DOOR', refusal, 403) };

  return { user };
}

/**
 * GET /api/auth/reset-password?token=...
 *
 * Checked the moment the page loads, before the visitor types anything. Without
 * this, an already-used or expired link renders an identical "set a new
 * password" form and only reveals the problem after a submit — confusing for
 * anyone who, reasonably, tries the same email link twice.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return fail('VALIDATION', 'This reset link is missing its token.', 422);
  const { response } = await lookupValid(env, request, await hashToken(token));
  return response ?? json({ ok: true });
};

/**
 * POST /api/auth/reset-password { token, password }
 *
 * The other half of forgot-password.ts: verifies the emailed token, sets the new
 * password, and signs the person straight in (same as login.ts) so the link takes
 * them into the app rather than back to a plain sign-in form.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { token, password } = await request.json<{ token: string; password: string }>();
  if (!token) return fail('VALIDATION', 'This reset link is missing its token.', 422);

  const problems: Record<string, string> = {};
  if (!password || password.length < 8) problems.password = 'At least 8 characters';
  else if (!/[A-Z]/.test(password)) problems.password = 'At least 1 uppercase letter';
  else if (!/[0-9]/.test(password)) problems.password = 'At least 1 digit';
  if (Object.keys(problems).length) return fail('VALIDATION', 'Password does not meet the requirements.', 422, problems);

  const hash = await hashToken(token);
  const { response, user } = await lookupValid(env, request, hash);
  if (response) return response;

  const newHash = await hashPassword(password);
  await run(env,
    'UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, sessions_revoked_at = ?, updated_at = ? WHERE id = ?',
    newHash, nowIso(), nowIso(), user.id);
  // Marked spent rather than deleted: a repeat click of the same link then gets the
  // same clear "expired, request a new one" answer instead of a confusing 404.
  await run(env, 'UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?', nowIso(), hash);

  await audit(env, {
    actorId: user.id, actorLabel: user.full_name, action: 'account.password_reset_completed',
    entityTable: 'users', entityId: user.id, source: 'password_reset',
  });
  await notify(env, {
    template: 'account.password_changed',
    recipient: user.email,
    channel: 'email',
    subject: 'Your password was changed',
    body: 'Your Conts ERP password was just reset. If this was not you, contact your administrator immediately.',
    // Keyed by the token (see forgot-password.ts): keeps this from colliding
    // with change-password.ts's own same-template notify() if both fire for the
    // same user within the same clock hour.
    entityTable: 'password_reset_tokens', entityId: hash,
    urgent: true,
  });

  const { ttlHours, absoluteDays } = sessionLimits(await securitySettings(env), user.role);
  const sessionToken = await signSession(env.SESSION_SECRET, {
    userId: user.id, email: user.email, role: user.role, fullName: user.full_name,
  }, ttlHours, absoluteDays);

  return json({
    user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, mustChangePassword: false, locale: 'en-MY' },
    home: HOME[user.role] ?? '/',
  }, 200, { 'set-cookie': cookie(request, sessionToken, ttlHours * 3600) });
};
