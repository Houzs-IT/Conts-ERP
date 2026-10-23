import { type Env, all, one, run, fail, nowIso } from './db';
import { accessFor, canManage, levelsFor, isSide, sideSql, isKind, type DepartmentKind, type Level, type Side } from './access';
import { notify } from './notify';
import { legacyRolesIncludeOwners, parseList } from './twoStepLegacy';

export interface SecuritySettings { staffTtlHours: number; ownerTtlHours: number; absoluteDays: number; maxAttempts: number; lockoutMinutes: number; require2faRoles: string[];
  /** Department ids that must use two-step sign-in; null until management has saved the new setting, when require2faRoles still answers. */
  require2faDepartments: string[] | null;
  /** Whether owner logins must use two-step sign-in. Owners have no department, so they have their own switch; until it is
   *  saved, the old role list answers (twoStepLegacy.ts). */
  require2faOwners: boolean }

/** Same defaults as the Settings > Security spec (functions/api/settings/index.ts) — used
 *  only for whatever a row is missing there, same as every other setting in that screen. */
const SECURITY_DEFAULTS: SecuritySettings = { staffTtlHours: 168, ownerTtlHours: 8, absoluteDays: 30, maxAttempts: 5, lockoutMinutes: 15, require2faRoles: [], require2faDepartments: null, require2faOwners: false };

/** The owner-configurable values from Settings > Security, read live so a change there takes
 *  effect on the very next request — including for someone already signed in, since the
 *  session middleware re-signs the idle deadline (see functions/api/_middleware.ts) using
 *  whatever this returns each time. */
export async function securitySettings(env: Env): Promise<SecuritySettings> {
  return parseSecurity(await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key LIKE 'security.%'`));
}

function parseSecurity(rows: { key: string; value: string }[]): SecuritySettings {
  const map = new Map(rows.map(r => [r.key, r.value]));
  const list = parseList;
  const num = (key: string, def: number) => { const n = Number(map.get(key)); return map.has(key) && Number.isFinite(n) ? n : def; };
  return {
    staffTtlHours: num('security.staffInactivityTimeoutMins', SECURITY_DEFAULTS.staffTtlHours * 60) / 60,
    ownerTtlHours: num('security.ownerInactivityTimeoutMins', SECURITY_DEFAULTS.ownerTtlHours * 60) / 60,
    absoluteDays: num('security.absoluteTimeoutHours', SECURITY_DEFAULTS.absoluteDays * 24) / 24,
    maxAttempts: num('security.lockoutAttempts', SECURITY_DEFAULTS.maxAttempts),
    lockoutMinutes: num('security.lockoutMinutes', SECURITY_DEFAULTS.lockoutMinutes),
    require2faRoles: list(map.get('security.require2faRoles')),
    require2faDepartments: map.has('security.require2faDepartments') ? list(map.get('security.require2faDepartments')) : null,
    require2faOwners: map.has('security.require2faOwners') ? map.get('security.require2faOwners') === 'true' : legacyRolesIncludeOwners(list(map.get('security.require2faRoles'))),
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

/** Migration 0106: one row per signed-in browser, so signing out ends that cookie everywhere it was copied, not
 *  just in the browser that pressed the button. Without the table, cookies carry no session id and behave as before. */
export function sessionTable(env: Env) {
  return hasColumn(env, 'user_sessions', 'id');
}

/** Records a new signed-in browser and returns its id for the cookie, or undefined when there is no table (or the
 *  write failed): such a cookie is checked the old way only, so a sign-in never fails over this. */
export async function startSession(env: Env, request: Request, userId: string, absoluteDays: number): Promise<string | undefined> {
  try {
    if (!(await sessionTable(env))) return undefined;
    const id = crypto.randomUUID();
    const now = nowIso();
    // Rows outlive their cookie only until this person next signs in.
    await run(env, 'DELETE FROM user_sessions WHERE user_id = ? AND expires_at < ?', userId, now);
    await run(env,
      'INSERT INTO user_sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      id, userId, now, new Date(Date.now() + absoluteDays * 864e5).toISOString(),
      request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      (request.headers.get('user-agent') ?? '').slice(0, 300) || null);
    return id;
  } catch (e) {
    console.error('startSession failed', e);
    return undefined;
  }
}

/** Ends one signed-in browser. `userId` scopes it, so nobody can end someone else's by guessing an id. */
export async function endSession(env: Env, sid: string | undefined, userId: string) {
  if (!sid || !(await sessionTable(env))) return false;
  await run(env, 'DELETE FROM user_sessions WHERE id = ? AND user_id = ?', sid, userId);
  return true;
}

/** Whether management requires two-step sign-in for this person: owners follow their own switch, everyone else their
 *  department is on the list (the setting saved by department), or, until that setting exists, their role is on the old
 *  list (which is what the department list is worked out from, see twoStepLegacy.ts). */
export function twoStepRequired(settings: SecuritySettings, who: { role: string; departmentId?: string | null }): boolean {
  if (who.role === 'owner') return settings.require2faOwners;
  if (settings.require2faDepartments) return !!who.departmentId && settings.require2faDepartments.includes(who.departmentId);
  return settings.require2faRoles.includes(who.role);
}

/** The security settings and the signed-in user's current role, department, position, active flag and whether they are still on a
 *  temporary password, in one query (one connection), for the session middleware.
 *  The cookie only says who signed in; what they may do is read from users on every request, so deactivating
 *  someone or changing their role takes effect at once.
 *  `sid` (a cookie issued once migration 0106 is in) is looked up in the same query: `sessionLive` is false
 *  once that browser has signed out. */
export async function sessionState(env: Env, userId: string, sid?: string): Promise<{
  settings: SecuritySettings;
  user: { role: string; side: Side; departmentId: string | null; positionId: string | null; kind: DepartmentKind | null; active: boolean; fullName: string; revokedAt: number; twoFactorOn: boolean; sessionLive: boolean; mustChangePassword: boolean } | null;
}> {
  const [revokedCol, totpCol, sessions, sideCol] = await Promise.all([
    hasColumn(env, 'users', 'sessions_revoked_at'), hasColumn(env, 'users', 'totp_enabled_at'), sid ? sessionTable(env) : false,
    hasColumn(env, 'users', 'side'),
  ]);
  const rows = await all<{ key: string; value: string }>(env, `
    SELECT key, value FROM settings WHERE key LIKE 'security.%'
    UNION ALL
    SELECT '~user', users.role || '|' || users.is_active::text || '|' || ${revokedCol ? "COALESCE(users.sessions_revoked_at, '')" : "''"}
      || '|' || ${totpCol ? "(users.totp_enabled_at IS NOT NULL)::int::text" : "'0'"}
      || '|' || ${sessions ? '(SELECT count(*) FROM user_sessions s WHERE s.id = ? AND s.user_id = users.id)::text' : "'1'"}
      || '|' || users.must_change_password::text || '|' || ${sideCol ? sideSql('users', 'd') : "COALESCE(d.side, 'both')"}
      || '|' || COALESCE(users.department_id, '') || '|' || COALESCE(users.position_id, '') || '|' || COALESCE(d.kind, '')
      || '|' || users.full_name FROM users LEFT JOIN departments d ON d.id = users.department_id WHERE users.id = ?`, ...(sessions ? [sid, userId] : [userId]));
  const u = rows.find(r => r.key === '~user');
  const [role, active, revoked, totp, live, mustChange, side, departmentId, positionId, kind, ...name] = (u?.value ?? '').split('|');
  return {
    settings: parseSecurity(rows.filter(r => r.key !== '~user')),
    user: u ? { role, side: isSide(side) ? side : 'both', departmentId: departmentId || null, positionId: positionId || null, kind: isKind(kind) ? kind : null, active: active === '1', fullName: name.join('|'), revokedAt: revoked ? Date.parse(revoked) : 0, twoFactorOn: totp === '1', sessionLive: live !== '0', mustChangePassword: mustChange !== '0' } : null,
  };
}

/** Ends every session this person has open: the middleware refuses any cookie signed before this moment, and
 *  (migration 0106) their signed-in browser rows go, except `keep` (the browser asking, for "sign out the others").
 *  False when the database has neither migration 0055 nor 0106, so the caller can say so instead of failing. */
export async function revokeSessions(env: Env, userId: string, keep?: string): Promise<boolean> {
  const [stamp, table] = await Promise.all([hasColumn(env, 'users', 'sessions_revoked_at'), sessionTable(env)]);
  if (stamp) await run(env, 'UPDATE users SET sessions_revoked_at = ? WHERE id = ?', nowIso(), userId);
  if (table) await run(env, 'DELETE FROM user_sessions WHERE user_id = ? AND id <> ?', userId, keep ?? '');
  return stamp || table;
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
    body: `Use this link to choose a new password:\n\n${origin}/reset-password?token=${token}\n\nThe link expires in 60 minutes. If you did not ask for this, you can ignore this email.`,
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
/** `side`: which side of the business the account works on (migration 0143); absent on a cookie signed before it,
 *  which the session middleware re-signs with the live value on the next request. */
/** `departmentId`, `positionId`, `kind`: where the account sits (migration 0145) and its department's kind, which decides the
 *  hidden role. Read live like the role and side, so moving someone applies on their next request; absent on a cookie
 *  signed before the departments shipped, or on an owner, who has no department. */
export interface Session { userId: string; email: string; role: string; side?: Side; departmentId?: string | null; positionId?: string | null; kind?: DepartmentKind | null; fullName: string; iat: number; sid?: string; manage?: boolean; picked?: Level | null;
  /** Every area's level for this person (levelsFor), set by requireSession and never stored in the cookie. */
  levels?: Record<string, Level> }

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
  secret: string, s: { userId: string; email: string; role: string; side?: Side; departmentId?: string | null; positionId?: string | null; kind?: DepartmentKind | null; fullName: string; sid?: string },
  ttlHours: number, absoluteDays: number, iat = Date.now(),
) {
  const exp = Math.min(Date.now() + ttlHours * 36e5, iat + absoluteDays * 864e5);
  const body = btoa(JSON.stringify({ ...s, iat, exp })).replace(/=+$/, '');
  return `${body}.${await hmac(secret, body)}`;
}

/** Compares every byte whatever the first difference, so how long a wrong signature or secret takes to refuse does not
 *  tell the sender how much of it was right. Only the length leaks, and the lengths here are not secret. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function readSession(secret: string, token: string | null): Promise<Session | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!timingSafeEqualStr(await hmac(secret, body), sig ?? '')) return null;
  try {
    const p = JSON.parse(atob(body));
    if (!p.exp || p.exp < Date.now()) return null;
    return { userId: p.userId, email: p.email, role: p.role, fullName: p.fullName, iat: p.iat ?? Date.now(), ...(typeof p.sid === 'string' ? { sid: p.sid } : {}), ...(isSide(p.side) ? { side: p.side } : {}),
      ...(typeof p.departmentId === 'string' ? { departmentId: p.departmentId } : {}), ...(typeof p.positionId === 'string' ? { positionId: p.positionId } : {}), ...(isKind(p.kind) ? { kind: p.kind } : {}) };
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
  const access = await accessFor(env, s, new URL(req.url).pathname.replace(/\/+$/, ''), req.method);
  const session = { ...s, manage: canManage(s.role, access), picked: access.chosen ? access.level : null, levels: await levelsFor(env, s) };
  return { session: session as Session & { manage: boolean }, response: null };
}

const FIELD = ['housekeeper', 'technician'];

export function isFieldRole(role: string) { return FIELD.includes(role); }

export { fail, nowIso, one, run };
