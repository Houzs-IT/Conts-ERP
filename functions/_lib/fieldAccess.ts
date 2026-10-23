import { type Env, one, run, json, fail, audit, nowIso } from './db';
import { type Session, hashPassword, revokeSessions } from './auth';
import { can } from './access';
import { NO_EMAIL_DOMAIN, PIN_ROLES, employeeIdFor, hasEmployeeIds, tempPin } from './fieldPin';


/** The two worker lists on Workers: cleaners sign in as housekeepers, technicians as technicians. */
const LISTS = {
  cleaners: { role: 'housekeeper', noun: 'cleaner', action: 'housekeeping.cleaner' },
  technicians: { role: 'technician', noun: 'technician', action: 'maintenance.technician' },
} as const;
export type WorkerList = keyof typeof LISTS;

/**
 * "Give app access" on a worker list entry: lets an in-house worker sign in to the field app with an employee ID
 * (EMP-001, the next free number, kept for good) and a PIN. An entry with no login gets a new field account linked to
 * it; one already linked gets an employee ID on that account. Either way a new first PIN is returned once (never stored
 * or logged) with the ID for the office to pass on, the person must choose their own PIN at the first sign-in, and any
 * earlier sign-in on that account ends. Run it again to give a forgotten PIN; the ID stays the same.
 */
export async function giveFieldAccess(env: Env, session: Session, list: WorkerList, id: string): Promise<Response> {
  const { role, noun, action } = LISTS[list];
  // Creating a login is a management decision; Full on Operations (the Operations Manager position) may make field
  // ones too, and only from here.
  if (!can(session, 'operations', 'full')) return fail('FORBIDDEN', 'Only management and operations managers can give app access.', 403);
  if (!(await hasEmployeeIds(env))) return fail('NOT_MIGRATED', 'Employee ID sign-in needs a database update (migration 0145) that has not been applied yet.', 503);

  const w = await one<{ id: string; full_name: string; employment_type: string; phone: string | null; user_id: string | null; is_active: number }>(env,
    `SELECT id, full_name, employment_type, phone, user_id, is_active FROM ${list} WHERE id = ?`, id);
  if (!w) return fail('NOT_FOUND', `That ${noun} is no longer on the list.`, 404);
  if (w.employment_type !== 'internal') return fail('VALIDATION', `Outside companies do not get a login.`, 422);
  if (!w.is_active) return fail('VALIDATION', `Switch the ${noun} back on first.`, 422);

  const pin = tempPin();
  const hash = await hashPassword(pin);
  const now = nowIso();
  const nextId = async (): Promise<string> => employeeIdFor(Number((await one<{ n: string }>(env, "SELECT nextval('employee_id_seq')::text AS n"))?.n));
  let userId = w.user_id;
  let employeeId: string;
  if (userId) {
    const u = await one<{ role: string; is_active: number; employee_id: string | null }>(env, 'SELECT role, is_active, employee_id FROM users WHERE id = ?', userId);
    if (!u) return fail('NOT_FOUND', `The login linked to this ${noun} no longer exists.`, 404);
    // A list entry may link an office login (an operations person who also fixes things); phone sign-in is never
    // put on one, so this button cannot reach an office account's password.
    if (!PIN_ROLES.includes(u.role)) return fail('FORBIDDEN', 'The linked login is an office account. It signs in with email; management manages it under Users and roles.', 403);
    if (!u.is_active) return fail('VALIDATION', 'The linked login is switched off. Management can switch it back on under Users and roles.', 422);
    employeeId = u.employee_id ?? await nextId();
    await run(env, 'UPDATE users SET employee_id = ?, password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      employeeId, hash, now, userId);
    await revokeSessions(env, userId);
  } else {
    userId = crypto.randomUUID();
    employeeId = await nextId();
    await run(env, `
      INSERT INTO users (id, email, full_name, phone, password_hash, role, employee_id, must_change_password, locale, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'en-MY', 1, ?, ?)`,
      userId, `${userId}${NO_EMAIL_DOMAIN}`, w.full_name, w.phone, hash, role, employeeId, now, now);
    await run(env, `UPDATE ${list} SET user_id = ?, updated_at = ? WHERE id = ?`, userId, now, id);
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: w.user_id ? `${action}_new_pin` : `${action}_app_access`,
    entityTable: list, entityId: id, after: { userId, employeeId },
  });
  return json({ userId, employeeId, pin }, 200, { 'cache-control': 'no-store' });
}
