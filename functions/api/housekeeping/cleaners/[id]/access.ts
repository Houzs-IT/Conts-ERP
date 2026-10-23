import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, hashPassword, revokeSessions } from '../../../../_lib/auth';
import { NO_EMAIL_DOMAIN, PIN_ROLES, hasLoginPhone, loginPhone, tempPin } from '../../../../_lib/fieldPin';

/** Creating a login is a management decision; operations managers may make only field ones, and only from here. */
const GRANT = ['management', 'operations_manager'];

/**
 * POST /api/housekeeping/cleaners/:id/access { phone? } — "Give app access": lets an internal cleaner sign in to the
 * field app with their phone number and a PIN. A cleaner with no login gets a new cleaner account linked to the roster
 * entry; one already linked gets phone sign-in on that account. Either way a new first PIN is returned once (never
 * stored or logged) for the office to pass on, the person must choose their own at the first sign-in, and any
 * earlier sign-in on that account ends. Run it again to give a forgotten PIN.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!GRANT.includes(session.role)) return fail('FORBIDDEN', 'Only management and operations managers can give app access.', 403);
  if (!(await hasLoginPhone(env))) return fail('NOT_MIGRATED', 'Phone sign-in needs a database update (migration 0143) that has not been applied yet.', 503);

  const id = String(params.id);
  const c = await one<{ id: string; full_name: string; employment_type: string; phone: string | null; user_id: string | null; is_active: number }>(env,
    'SELECT id, full_name, employment_type, phone, user_id, is_active FROM cleaners WHERE id = ?', id);
  if (!c) return fail('NOT_FOUND', 'That cleaner is no longer on the roster.', 404);
  if (c.employment_type !== 'internal') return fail('VALIDATION', 'Outsourced cleaners do not get a login.', 422);
  if (!c.is_active) return fail('VALIDATION', 'Switch the cleaner back on first.', 422);

  const b = await request.json<{ phone?: unknown }>().catch(() => null);
  const phone = loginPhone(b?.phone ?? c.phone);
  if (!phone) return fail('VALIDATION', 'Enter the phone number they will sign in with.', 422, { phone: 'Enter a phone number.' });

  const taken = await one<{ full_name: string }>(env, 'SELECT full_name FROM users WHERE login_phone = ? AND id IS DISTINCT FROM ?', phone, c.user_id);
  if (taken) return fail('CONFLICT', `${taken.full_name} already signs in with that number.`, 409, { phone: 'Already used by another login.' });

  const pin = tempPin();
  const hash = await hashPassword(pin);
  const now = nowIso();
  let userId = c.user_id;
  if (userId) {
    const u = await one<{ role: string; is_active: number }>(env, 'SELECT role, is_active FROM users WHERE id = ?', userId);
    if (!u) return fail('NOT_FOUND', 'The login linked to this cleaner no longer exists.', 404);
    // The roster only ever links cleaner accounts; this keeps a changed link from reaching an office account's password.
    if (!PIN_ROLES.includes(u.role)) return fail('FORBIDDEN', 'The linked login is not a cleaner account. Management can change it under Users and roles.', 403);
    if (!u.is_active) return fail('VALIDATION', 'The linked login is switched off. Management can switch it back on under Users and roles.', 422);
    await run(env, 'UPDATE users SET login_phone = ?, password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      phone, hash, now, userId);
    await revokeSessions(env, userId);
  } else {
    userId = crypto.randomUUID();
    await run(env, `
      INSERT INTO users (id, email, full_name, phone, password_hash, role, login_phone, must_change_password, locale, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'housekeeper', ?, 1, 'en-MY', 1, ?, ?)`,
      userId, `${userId}${NO_EMAIL_DOMAIN}`, c.full_name, c.phone ?? `+${phone}`, hash, phone, now, now);
    await run(env, 'UPDATE cleaners SET user_id = ?, phone = COALESCE(phone, ?), updated_at = ? WHERE id = ?', userId, `+${phone}`, now, id);
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: c.user_id ? 'housekeeping.cleaner_new_pin' : 'housekeeping.cleaner_app_access',
    entityTable: 'cleaners', entityId: id, after: { userId, phone: `+${phone}` },
  });
  return json({ userId, phone: `+${phone}`, pin }, 200, { 'cache-control': 'no-store' });
};
