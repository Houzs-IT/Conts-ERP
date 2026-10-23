import { type Env, one } from './db';
import { hasColumn } from './auth';

/** Field sign-in for cleaners and technicians (migration 0145): an employee ID (EMP-001) in users.employee_id and a
 *  6-digit PIN in users.password_hash. Only these two roles may have one. */
export const PIN_ROLES = ['housekeeper', 'technician'];

/** A field account still needs a unique email; this one can never receive mail (.invalid is reserved). */
export const NO_EMAIL_DOMAIN = '@no-email.invalid';
export const hasRealEmail = (email: string | null | undefined): boolean => !!email && !email.toLowerCase().endsWith(NO_EMAIL_DOMAIN);

/** EMP-001 for 1: three digits up to 999, then as many as it takes. */
export const employeeIdFor = (n: number): string => `EMP-${String(n).padStart(3, '0')}`;

/** A typed employee ID as stored: "1", "001", "emp001" and "EMP-001" are all EMP-001. */
export function employeeIdOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  const n = Number(digits);
  return digits && digits.length <= 7 && n > 0 ? employeeIdFor(n) : null;
}

export const isPin = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v);

export const hasEmployeeIds = (env: Env): Promise<boolean> => hasColumn(env, 'users', 'employee_id').catch(() => false);

/** The account's employee ID when it signs in with one (and a PIN), so a new secret for it must be a PIN. */
export async function employeeIdOfUser(env: Env, userId: string): Promise<string | null> {
  if (!(await hasEmployeeIds(env))) return null;
  const row = await one<{ employee_id: string | null }>(env, 'SELECT employee_id FROM users WHERE id = ?', userId);
  return row?.employee_id ?? null;
}
export const signsInWithPin = async (env: Env, userId: string): Promise<boolean> => !!(await employeeIdOfUser(env, userId));

/** What is wrong with a new password (or PIN, for a phone account); null when it is fine. */
export function secretProblem(secret: string, pin: boolean): string | null {
  if (pin) {
    if (!isPin(secret)) return 'Exactly 6 digits';
    return /^(\d)\1{5}$/.test(secret) || '0123456789'.includes(secret) || '9876543210'.includes(secret) ? 'Too easy to guess' : null;
  }
  return secret.length < 8 ? 'At least 8 characters' : !/[A-Z]/.test(secret) ? 'At least 1 uppercase letter' : !/[0-9]/.test(secret) ? 'At least 1 digit' : null;
}

/** A first PIN for the office to pass on; the person must choose their own when they first sign in. */
export function tempPin(): string {
  for (;;) {
    const pin = String((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 1_000_000).padStart(6, '0');
    if (!secretProblem(pin, true)) return pin;
  }
}
