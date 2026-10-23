import { type Env, one, run, json, fail, audit, nowIso } from './db';
import { type Session, hashPassword, revokeSessions } from './auth';
import { NO_EMAIL_DOMAIN, PIN_ROLES, hasLoginPhone, loginPhone, tempPin } from './fieldPin';

/** Creating a login is a management decision; operations managers may make only field ones, and only from here. */
export const GRANT_ACCESS = ['management', 'operations_manager'];

/** The two worker lists on Workers: cleaners sign in as housekeepers, technicians as technicians. */
const LISTS = {
  cleaners: { role: 'housekeeper', noun: 'cleaner', action: 'housekeeping.cleaner' },
  technicians: { role: 'technician', noun: 'technician', action: 'maintenance.technician' },
} as const;
export type WorkerList = keyof typeof LISTS;

/**
 * "Give app access" on a worker list entry: lets an in-house worker sign in to the field app with their phone number
 * and a PIN. An entry with no login gets a new field account linked to it; one already linked gets phone sign-in on
 * that account. Either way a new first PIN is returned once (never stored or logged) for the office to pass on, the
 * person must choose their own at the first sign-in, and any earlier sign-in on that account ends. Run it again to
 * give a forgotten PIN.
 */
export async function giveFieldAccess(env: Env, session: Session, list: WorkerList, id: string, rawPhone: unknown): Promise<Response> {
  const { role, noun, action } = LISTS[list];
  if (!GRANT_ACCESS.includes(session.role)) return fail('FORBIDDEN', 'Only management and operations managers can give app access.', 403);
  if (!(await hasLoginPhone(env))) return fail('NOT_MIGRATED', 'Phone sign-in needs a database update (migration 0143) that has not been applied yet.', 503);

  const w = await one<{ id: string; full_name: string; employment_type: string; phone: string | null; user_id: string | null; is_active: number }>(env,
    `SELECT id, full_name, employment_type, phone, user_id, is_active FROM ${list} WHERE id = ?`, id);
  if (!w) return fail('NOT_FOUND', `That ${noun} is no longer on the list.`, 404);
  if (w.employment_type !== 'internal') return fail('VALIDATION', `Outside companies do not get a login.`, 422);
  if (!w.is_active) return fail('VALIDATION', `Switch the ${noun} back on first.`, 422);

  const phone = loginPhone(rawPhone ?? w.phone);
  if (!phone) return fail('VALIDATION', 'Enter the phone number they will sign in with.', 422, { phone: 'Enter a phone number.' });
  const taken = await one<{ full_name: string }>(env, 'SELECT full_name FROM users WHERE login_phone = ? AND id IS DISTINCT FROM ?', phone, w.user_id);
  if (taken) return fail('CONFLICT', `${taken.full_name} already signs in with that number.`, 409, { phone: 'Already used by another login.' });

  const pin = tempPin();
  const hash = await hashPassword(pin);
  const now = nowIso();
  let userId = w.user_id;
  if (userId) {
    const u = await one<{ role: string; is_active: number }>(env, 'SELECT role, is_active FROM users WHERE id = ?', userId);
    if (!u) return fail('NOT_FOUND', `The login linked to this ${noun} no longer exists.`, 404);
    // A list entry may link an office login (an operations person who also fixes things); phone sign-in is never
    // put on one, so this button cannot reach an office account's password.
    if (!PIN_ROLES.includes(u.role)) return fail('FORBIDDEN', 'The linked login is an office account. It signs in with email; management manages it under Users and roles.', 403);
    if (!u.is_active) return fail('VALIDATION', 'The linked login is switched off. Management can switch it back on under Users and roles.', 422);
    await run(env, 'UPDATE users SET login_phone = ?, password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      phone, hash, now, userId);
    await revokeSessions(env, userId);
  } else {
    userId = crypto.randomUUID();
    await run(env, `
      INSERT INTO users (id, email, full_name, phone, password_hash, role, login_phone, must_change_password, locale, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'en-MY', 1, ?, ?)`,
      userId, `${userId}${NO_EMAIL_DOMAIN}`, w.full_name, w.phone ?? `+${phone}`, hash, role, phone, now, now);
    await run(env, `UPDATE ${list} SET user_id = ?, phone = COALESCE(phone, ?), updated_at = ? WHERE id = ?`, userId, `+${phone}`, now, id);
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: w.user_id ? `${action}_new_pin` : `${action}_app_access`,
    entityTable: list, entityId: id, after: { userId, phone: `+${phone}` },
  });
  return json({ userId, phone: `+${phone}`, pin }, 200, { 'cache-control': 'no-store' });
}
