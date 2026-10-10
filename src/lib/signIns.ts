import type { Tone } from './types';

/** How a sign-in attempt ended (login_events.result), in words and a badge tone. */
export const SIGN_IN_RESULT: Record<string, { label: string; tone: Tone }> = {
  success: { label: 'Signed in', tone: 'success' },
  wrong_password: { label: 'Wrong password', tone: 'warning' },
  '2fa_failed': { label: 'Wrong code', tone: 'warning' },
  locked: { label: 'Locked', tone: 'critical' },
  inactive: { label: 'Account off', tone: 'neutral' },
};

export const SIGN_IN_METHOD: Record<string, string> = {
  password: 'Password',
  totp: 'Password and app code',
  backup_code: 'Password and backup code',
  reset_link: 'Reset link',
};

/** "Chrome on Windows" from a user agent; good enough to recognise your own devices, not a fingerprint. */
export function deviceOf(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? ua.slice(0, 40);
}
