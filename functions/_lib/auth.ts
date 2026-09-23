import { type Env, all, one, run, fail, nowIso } from './db';

export interface SecuritySettings { staffTtlHours: number; ownerTtlHours: number; absoluteDays: number; maxAttempts: number; lockoutMinutes: number }

/** Same defaults as the Settings > Security spec (functions/api/settings/index.ts) — used
 *  only for whatever a row is missing there, same as every other setting in that screen. */
const SECURITY_DEFAULTS: SecuritySettings = { staffTtlHours: 168, ownerTtlHours: 8, absoluteDays: 30, maxAttempts: 5, lockoutMinutes: 15 };

/** The owner-configurable values from Settings > Security, read live so a change there takes
 *  effect on the very next request — including for someone already signed in, since the
 *  session middleware re-signs the idle deadline (see functions/api/_middleware.ts) using
 *  whatever this returns each time. */
export async function securitySettings(env: Env): Promise<SecuritySettings> {
  const rows = await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key LIKE 'security.%'`);
  const map = new Map(rows.map(r => [r.key, r.value]));
  const num = (key: string, def: number) => { const n = Number(map.get(key)); return map.has(key) && Number.isFinite(n) ? n : def; };
  return {
    staffTtlHours: num('security.staffInactivityTimeoutMins', SECURITY_DEFAULTS.staffTtlHours * 60) / 60,
    ownerTtlHours: num('security.ownerInactivityTimeoutMins', SECURITY_DEFAULTS.ownerTtlHours * 60) / 60,
    absoluteDays: num('security.absoluteTimeoutHours', SECURITY_DEFAULTS.absoluteDays * 24) / 24,
    maxAttempts: num('security.lockoutAttempts', SECURITY_DEFAULTS.maxAttempts),
    lockoutMinutes: num('security.lockoutMinutes', SECURITY_DEFAULTS.lockoutMinutes),
  };
}

/** Staff sign in far less often than they'd want to be interrupted, so they idle out on a
 *  roughly weekly cadence by default; an owner's portal is used briefly and occasionally, so
 *  it times out the same day by default — both adjustable from Settings > Security. */
export function sessionLimits(settings: SecuritySettings, role: string) {
  return { ttlHours: role === 'owner' ? settings.ownerTtlHours : settings.staffTtlHours, absoluteDays: settings.absoluteDays };
}

/** `iat` anchors the absolute cap (fixed at first sign-in); `exp` is the idle deadline,
 *  extended on every request but never past `iat + SESSION_ABSOLUTE_DAYS` — see signSession. */
export interface Session { userId: string; email: string; role: string; fullName: string; iat: number }

const ENC = new TextEncoder();

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `iat` defaults to now (a fresh sign-in); the session middleware passes the original
 *  `iat` back in when it slides an existing session's idle deadline forward, so the
 *  absolute cap always counts from first login, never from the latest request. */
export async function signSession(
  secret: string, s: { userId: string; email: string; role: string; fullName: string },
  ttlHours: number, absoluteDays: number, iat = Date.now(),
) {
  const exp = Math.min(Date.now() + ttlHours * 36e5, iat + absoluteDays * 864e5);
  const body = btoa(JSON.stringify({ ...s, iat, exp })).replace(/=+$/, '');
  return `${body}.${await hmac(secret, body)}`;
}

export async function readSession(secret: string, token: string | null): Promise<Session | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (await hmac(secret, body) !== sig) return null;
  try {
    const p = JSON.parse(atob(body));
    if (!p.exp || p.exp < Date.now()) return null;
    return { userId: p.userId, email: p.email, role: p.role, fullName: p.fullName, iat: p.iat ?? Date.now() };
  } catch { return null; }
}

/** True on the deployed site (always https) and false on plain-http local dev.
 *  `wrangler pages dev` serves localhost over http, and browsers silently refuse
 *  to store a `Secure` cookie on an insecure connection — the login call would
 *  then look like it worked (200, user data) while the browser drops the session
 *  cookie, so the very next request looks signed out. */
function isSecure(request: Request) {
  return new URL(request.url).protocol === 'https:';
}

/** `maxAgeSeconds` is only the browser's own hint to drop the cookie — the server is the
 *  real authority via the `exp`/`iat` checked in readSession. Pass the idle TTL in seconds. */
export function cookie(request: Request, token: string, maxAgeSeconds: number) {
  const secure = isSecure(request) ? ' Secure;' : '';
  return `tc_session=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(request: Request) {
  const secure = isSecure(request) ? ' Secure;' : '';
  return `tc_session=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: Request) {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.match(/tc_session=([^;]+)/);
  return m ? m[1] : null;
}

/** PBKDF2-SHA256, 100k iterations. Same scheme as houzs-erp so hashes port across. */
export async function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, , saltHex] = stored.split('$');
  if (!saltHex) return false;
  return (await hashPassword(password, saltHex)) === stored;
}

/** Guard for every non-public endpoint. 401 unauthenticated, 403 not permitted. */
export async function requireSession(req: Request, env: Env) {
  const s = await readSession(env.SESSION_SECRET, readCookie(req));
  if (!s) return { session: null, response: fail('UNAUTHENTICATED', 'Your session expired. Sign in to continue.', 401) };
  return { session: s, response: null };
}

const FINANCE = ['management', 'finance_admin', 'operations_manager'];
const FIELD = ['housekeeper', 'technician'];

export function canSeeFinance(role: string) { return FINANCE.includes(role); }
export function isFieldRole(role: string) { return FIELD.includes(role); }

export { fail, nowIso, one, run };
