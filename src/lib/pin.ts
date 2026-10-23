/** Phone sign-in for cleaners and technicians (functions/_lib/fieldPin.ts holds the rules the server applies). */

/** The address a phone-only account is given; it can never receive mail, so it is never shown. */
export const hasRealEmail = (email: string): boolean => !email.toLowerCase().endsWith('@no-email.invalid');

/** 111111, 123456, 987654 and the like: refused as a PIN. */
export const easyPin = (p: string): boolean => /^(\d)\1{5}$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p);

export const pinPolicy = (p: string): { label: string; ok: boolean }[] => [
  { label: 'Exactly 6 digits', ok: /^\d{6}$/.test(p) },
  { label: 'Not easy to guess, like 111111 or 123456', ok: /^\d{6}$/.test(p) && !easyPin(p) },
];

/** Props that turn a PasswordField into a PIN box with a number pad on phones. No maxLength: digitsOnly keeps six
 *  digits, and a browser limit would count a stray letter before it is filtered out and drop the last digit. */
export const PIN_INPUT = { inputMode: 'numeric', style: { letterSpacing: '0.3em', fontVariantNumeric: 'tabular-nums' } } as const;
export const digitsOnly = (v: string): string => v.replace(/\D/g, '').slice(0, 6);
