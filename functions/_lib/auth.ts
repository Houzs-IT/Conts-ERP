import { type Env, one, run, fail, nowIso } from './db';

export interface Session { userId: string; email: string; role: string; fullName: string }

const ENC = new TextEncoder();

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signSession(secret: string, s: Session, days = 30) {
  const exp = Date.now() + days * 864e5;
  const body = btoa(JSON.stringify({ ...s, exp })).replace(/=+$/, '');
  return `${body}.${await hmac(secret, body)}`;
}

export async function readSession(secret: string, token: string | null): Promise<Session | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (await hmac(secret, body) !== sig) return null;
  try {
    const p = JSON.parse(atob(body));
    if (!p.exp || p.exp < Date.now()) return null;
    return { userId: p.userId, email: p.email, role: p.role, fullName: p.fullName };
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

export function cookie(request: Request, token: string, days = 30) {
  const secure = isSecure(request) ? ' Secure;' : '';
  return `tc_session=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${days * 86400}`;
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
