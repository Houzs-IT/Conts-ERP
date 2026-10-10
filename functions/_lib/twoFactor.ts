import { type Env, all, one, run, nowIso } from './db';
import { hasColumn } from './auth';

/**
 * Two-step sign-in: a six-digit code from an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 30-second steps),
 * with ten single-use backup codes for a lost phone. Web Crypto only.
 * The secret is stored encrypted (AES-GCM) with a key from the TOTP_ENC_KEY server secret, so a copy of the
 * database alone cannot produce codes.
 */

const ENC = new TextEncoder();
const STEP_SECONDS = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const ISSUER = 'Conts ERP';

/** Two-step sign-in can be set up only when the server has its encryption key. */
export function twoFactorAvailable(env: Env) {
  return !!env.TOTP_ENC_KEY && env.TOTP_ENC_KEY.length >= 16;
}

/** Whether migration 0098 has reached this database. */
export function twoFactorTables(env: Env) {
  return hasColumn(env, 'users', 'totp_enabled_at');
}

export function base32Encode(bytes: Uint8Array) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function newSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The code for one 30-second step (RFC 4226 dynamic truncation, six digits). */
export async function totpAt(secretB32: string, step: number) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let s = step;
  for (let i = 7; i >= 0; i--) { msg[i] = s & 255; s = Math.floor(s / 256); }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = mac[mac.length - 1] & 15;
  const n = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The step the code belongs to (one step either side allows for a phone clock a little off), or null.
 *  A step at or before `lastStep` was already used and is refused, so an overheard code cannot be replayed. */
export async function matchTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()) {
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const at = currentStep(now);
  for (const step of [at, at - 1, at + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (await totpAt(secretB32, step) === digits) return step;
  }
  return null;
}

export function otpauthUri(email: string, secretB32: string) {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function aesKey(env: Env) {
  const raw = await crypto.subtle.digest('SHA-256', ENC.encode(`totp-v1:${env.TOTP_ENC_KEY}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** "v1:<iv>:<ciphertext>", both base64. */
export async function encryptSecret(env: Env, secretB32: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), ENC.encode(secretB32)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

/** Null when the key is missing or is not the one the secret was stored with. */
export async function decryptSecret(env: Env, stored: string | null) {
  if (!stored || !twoFactorAvailable(env)) return null;
  const [v, iv, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

/* ------------------------------ backup codes ------------------------------ */

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const normalizeCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

async function hashCode(userId: string, code: string) {
  const d = await crypto.subtle.digest('SHA-256', ENC.encode(`${userId}:${normalizeCode(code)}`));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Replaces this person's backup codes with ten new ones and returns them (the only time they are seen). */
export async function issueBackupCodes(env: Env, userId: string) {
  const codes = Array.from({ length: 10 }, () => {
    const s = [...crypto.getRandomValues(new Uint8Array(10))].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  await run(env, 'DELETE FROM user_backup_codes WHERE user_id = ?', userId);
  const now = nowIso();
  for (const c of codes) {
    await run(env, 'INSERT INTO user_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)', crypto.randomUUID(), userId, await hashCode(userId, c), now);
  }
  return codes;
}

/** Uses up a backup code; true when it matched one not used before. The UPDATE ... used_at IS NULL makes two
 *  requests racing with the same code unable to both succeed. */
export async function useBackupCode(env: Env, userId: string, code: string) {
  if (normalizeCode(code).length !== 10) return false;
  const hit = await all<{ id: string }>(env,
    'UPDATE user_backup_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL RETURNING id', nowIso(), userId, await hashCode(userId, code));
  return hit.length > 0;
}

export async function backupCodesLeft(env: Env, userId: string) {
  const r = await one<{ n: number }>(env, 'SELECT count(*) AS n FROM user_backup_codes WHERE user_id = ? AND used_at IS NULL', userId);
  return Number(r?.n ?? 0);
}

/* ------------------------- the step between password and code ------------------------- */

const CHALLENGE_MINUTES = 5;

async function mac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', ENC.encode(`${secret}:two-step`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(data));
  return b64(new Uint8Array(sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Proof that the password was right, handed to the browser for five minutes while it asks for the code.
 *  Signed with a key derived separately from the session cookie's, so it can never pass as a session. */
export async function signChallenge(env: Env, userId: string) {
  const body = btoa(JSON.stringify({ uid: userId, exp: Date.now() + CHALLENGE_MINUTES * 60000 })).replace(/=+$/, '');
  return `${body}.${await mac(env.SESSION_SECRET, body)}`;
}

export async function readChallenge(env: Env, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (await mac(env.SESSION_SECRET, body) !== sig) return null;
  try {
    const p = JSON.parse(atob(body));
    return typeof p.uid === 'string' && p.exp > Date.now() ? p.uid : null;
  } catch { return null; }
}

/* ------------------------------ sign-in record ------------------------------ */

export type LoginResult = 'success' | 'wrong_password' | 'locked' | '2fa_failed' | 'inactive';
export type LoginMethod = 'password' | 'totp' | 'backup_code' | 'reset_link';

/** Never blocks or fails the sign-in it records: a database without migration 0098, or any write error,
 *  just means this one attempt is not in the list. */
export async function logLogin(env: Env, request: Request, e: { userId: string | null; email: string; result: LoginResult; method: LoginMethod }) {
  try {
    if (!(await twoFactorTables(env))) return;
    await run(env,
      'INSERT INTO login_events (id, user_id, email, at, ip, user_agent, result, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), e.userId, e.email.slice(0, 200), nowIso(),
      request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      (request.headers.get('user-agent') ?? '').slice(0, 300) || null, e.result, e.method);
  } catch { /* see above */ }
}
