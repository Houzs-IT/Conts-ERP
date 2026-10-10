import { type Env, all, one, run, fail, nowIso } from './db';
import { accessFor, canManage, type Level } from './access';
import { notify } from './notify';

export interface SecuritySettings { staffTtlHours: number; ownerTtlHours: number; absoluteDays: number; maxAttempts: number; lockoutMinutes: number; require2faRoles: string[] }

/** Same defaults as the Settings > Security spec (functions/api/settings/index.ts) — used
 *  only for whatever a row is missing there, same as every other setting in that screen. */
const SECURITY_DEFAULTS: SecuritySettings = { staffTtlHours: 168, ownerTtlHours: 8, absoluteDays: 30, maxAttempts: 5, lockoutMinutes: 15, require2faRoles: [] };

/** The owner-configurable values from Settings > Security, read live so a change there takes
 *  effect on the very next request — including for someone already signed in, since the
 *  session middleware re-signs the idle deadline (see functions/api/_middleware.ts) using
 *  whatever this returns each time. */
export async function securitySettings(env: Env): Promise<SecuritySettings> {
  return parseSecurity(await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key LIKE 'security.%'`));
}

function parseSecurity(rows: { key: string; value: string }[]): SecuritySettings {
  const map = new Map(rows.map(r => [r.key, r.value]));
  const num = (key: string, def: number) => { const n = Number(map.get(key)); return map.has(key) && Number.isFinite(n) ? n : def; };
  return {
    staffTtlHours: num('security.staffInactivityTimeoutMins', SECURITY_DEFAULTS.staffTtlHours * 60) / 60,
    ownerTtlHours: num('security.ownerInactivityTimeoutMins', SECURITY_DEFAULTS.ownerTtlHours * 60) / 60,
    absoluteDays: num('security.absoluteTimeoutHours', SECURITY_DEFAULTS.absoluteDays * 24) / 24,
    maxAttempts: num('security.lockoutAttempts', SECURITY_DEFAULTS.maxAttempts),
    lockoutMinutes: num('security.lockoutMinutes', SECURITY_DEFAULTS.lockoutMinutes),
    require2faRoles: (map.get('security.require2faRoles') ?? '').split(',').map(r => r.trim()).filter(Boolean),
  };
}

/** Columns added by migrations that code may reach a database before (0055 sessions_revoked_at, 0098
 *  totp_enabled_at): the session middleware reads them on every request, so a deploy that lands before its
 *  migration must not fail every signed-in request. A column found is remembered for the life of the
 *  worker; a missing one is looked for again after a minute, so applying the migration takes effect soon. */
const columnSeen = new Map<string, true | number>();
export async function hasColumn(env: Env, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const seen = columnSeen.get(key);
  if (seen === true) return true;
  if (typeof seen === 'number' && Date.now() - seen < 60_000) return false;
  const row = await one<{ n: number }>(env,
    `SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = ? AND column_name = ?`, table, column);
  const found = Number(row?.n ?? 0) > 0;
  columnSeen.set(key, found ? true : Date.now());
  return found;
}

/** The security settings and the signed-in user's current role and active flag, in one query (one
 *  connection), for the session middleware. The cookie only says who signed in; what they may do is read
 *  from users on every request, so deactivating someone or changing their role takes effect at once. */
export async function sessionState(env: Env, userId: string): Promise<{
  settings: SecuritySettings;
  user: { role: string; active: boolean; fullName: string; revokedAt: number; twoFactorOn: boolean } | null;
}> {
  const [revokedCol, totpCol] = await Promise.all([hasColumn(env, 'users', 'sessions_revoked_at'), hasColumn(env, 'users', 'totp_enabled_at')]);
  const rows = await all<{ key: string; value: string }>(env, `
    SELECT key, value FROM settings WHERE key LIKE 'security.%'
    UNION ALL
    SELECT '~user', role || '|' || is_active::text || '|' || ${revokedCol ? "COALESCE(sessions_revoked_at, '')" : "''"}
      || '|' || ${totpCol ? "(totp_enabled_at IS NOT NULL)::int::text" : "'0'"} || '|' || full_name FROM users WHERE id = ?`, userId);
  const u = rows.find(r => r.key === '~user');
  const [role, active, revoked, totp, ...name] = (u?.value ?? '').split('|');
  return {
    settings: parseSecurity(rows.filter(r => r.key !== '~user')),
    user: u ? { role, active: active === '1', fullName: name.join('|'), revokedAt: revoked ? Date.parse(revoked) : 0, twoFactorOn: totp === '1' } : null,
  };
}

/** Ends every session this person has open: the middleware refuses any cookie signed before this moment.
 *  False when the database does not have migration 0055 yet, so the caller can say so instead of failing. */
export async function revokeSessions(env: Env, userId: string): Promise<boolean> {
  if (!(await hasColumn(env, 'users', 'sessions_revoked_at'))) return false;
  await run(env, 'UPDATE users SET sessions_revoked_at = ? WHERE id = ?', nowIso(), userId);
  return true;
}

/** Emails a one-hour, single-use reset link. Only the token's hash is stored; the token itself leaves the server
 *  only inside the email body. Shared by Forgot password and management's "Send password reset" on Users. */
export async function sendPasswordReset(env: Env, origin: string, user: { id: string; email: string }) {
  const token = crypto.randomUUID();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', ENC.encode(token)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  await run(env,
    'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    hash, user.id, new Date(Date.now() + 60 * 60000).toISOString(), nowIso());
  return notify(env, {
    template: 'account.password_reset',
    recipient: user.email,
    channel: 'email',
    subject: 'Reset your Conts ERP password',
    body: `Use this link to choose a new password:\n\n${origin}/#/reset-password?token=${token}\n\nThe link expires in 60 minutes. If you did not ask for this, you can ignore this email.`,
    // Keyed by the token, not the user: notify()'s dedup collapses same-hour
    // calls sharing a template+entity, and a fresh "resend" makes a genuinely
    // new token each time — keying on user.id would silently drop every resend
    // within the same clock hour as the first request.
    entityTable: 'password_reset_tokens', entityId: hash,
    urgent: true,
  });
}

/** Staff sign in far less often than they'd want to be interrupted, so they idle out on a
 *  roughly weekly cadence by default; an owner's portal is used briefly and occasionally, so
 *  it times out the same day by default — both adjustable from Settings > Security. */
export function sessionLimits(settings: SecuritySettings, role: string) {
  return { ttlHours: role === 'owner' ? settings.ownerTtlHours : settings.staffTtlHours, absoluteDays: settings.absoluteDays };
}

/** `iat` anchors the absolute cap (fixed at first sign-in); `exp` is the idle deadline,
 *  extended on every request but never past `iat + SESSION_ABSOLUTE_DAYS` — see signSession. */
/** `manage`: whether the management-only actions in the area this request belongs to are open to the role
 *  (Users and roles > Permissions; functions/_lib/access.ts). Set by requireSession, not stored in the cookie. */
export interface Session { userId: string; email: string; role: string; fullName: string; iat: number; manage?: boolean; picked?: Level | null }

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
  const access = await accessFor(env, s.role, new URL(req.url).pathname);
  const session = { ...s, manage: canManage(s.role, access), picked: access.chosen ? access.level : null };
  return { session: session as Session & { manage: boolean }, response: null };
}

const FINANCE = ['management', 'finance_admin', 'operations_manager'];
const FIELD = ['housekeeper', 'technician'];

export function canSeeFinance(role: string) { return FINANCE.includes(role); }
export function isFieldRole(role: string) { return FIELD.includes(role); }

export { fail, nowIso, one, run };
