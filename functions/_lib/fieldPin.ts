import { type Env, one } from './db';
import { hasColumn } from './auth';

/** Phone sign-in for cleaners and technicians (migration 0143): the phone number in users.login_phone, the 6-digit
 *  PIN in users.password_hash. Only these two roles may have one. */
export const PIN_ROLES = ['housekeeper', 'technician'];

/** A phone-only account still needs a unique email; this one can never receive mail (.invalid is reserved). */
export const NO_EMAIL_DOMAIN = '@no-email.invalid';
export const hasRealEmail = (email: string | null | undefined): boolean => !!email && !email.toLowerCase().endsWith(NO_EMAIL_DOMAIN);

/** A typed phone number as login_phone stores it: digits only, with the country code. */
export function loginPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  // ponytail: a number starting 0 is taken as Malaysian (60); needs a country choice once staff outside Malaysia sign in.
  const full = digits.startsWith('0') ? `6${digits}` : digits;
  return /^[0-9]{8,15}$/.test(full) ? full : null;
}

export const isPin = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v);

export const hasLoginPhone = (env: Env): Promise<boolean> => hasColumn(env, 'users', 'login_phone').catch(() => false);

/** Whether this account signs in with phone and PIN, so a new secret for it must be a PIN. */
export async function signsInWithPin(env: Env, userId: string): Promise<boolean> {
  if (!(await hasLoginPhone(env))) return false;
  const row = await one<{ login_phone: string | null }>(env, 'SELECT login_phone FROM users WHERE id = ?', userId);
  return !!row?.login_phone;
}

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
