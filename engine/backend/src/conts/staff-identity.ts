// Conts only (not part of Houzs's code): who is asking, for the staff claim routes (design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.2-4.3). A person is their Property OS
// user id. Someone signed in to the engine is found by email; a field worker on the phone has no engine account, so
// Property OS's server forwards their call with a short-lived assertion signed with the single sign-on secret.
import type { MiddlewareHandler } from 'hono';
import { getSupabaseService } from '../db/supabase';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */

export interface Staff {
  userId: string; name: string; email: string; departmentId: string | null; side: string | null; role: string; field: boolean;
}

const FIELD_ROLES = new Set(['housekeeper', 'technician']);
const MAX_AGE_MS = 60_000;
const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
const hmacKey = (secret: string, use: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);

/** `base64url(JSON).base64url(HMAC-SHA256)`, the same shape as the single sign-on assertion (conts/sso.ts). */
export async function signStaffAssertion(secret: string, a: { userId: string; email: string; exp: number }): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ userId: a.userId, email: a.email, exp: a.exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifyStaffAssertion(secret: string, token: string, now = Date.now()): Promise<{ userId: string; email: string } | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromB64url(sig), enc.encode(body)))) return null;
    const a = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { userId?: unknown; email?: unknown; exp?: unknown };
    if (typeof a.userId !== 'string' || typeof a.email !== 'string' || typeof a.exp !== 'number') return null;
    if (a.exp < now || a.exp > now + MAX_AGE_MS) return null;
    return { userId: a.userId, email: a.email };
  } catch { return null; }
}

/** The active Conts staff member with this email (public.conts_staff), or null. */
export async function staffByEmail(sb: any, email: string): Promise<Staff | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const { data, error } = await sb.schema('public').from('conts_staff')
    .select('id, full_name, email, department_id, department_side, role, active')
    .ilike('email', e.replace(/[\\%_]/g, m => `\\${m}`));
  if (error) return null;
  const row = ((data ?? []) as Array<Record<string, unknown>>).find(r => String(r.email ?? '').toLowerCase() === e);
  if (!row || row.active !== true) return null;
  return {
    userId: String(row.id), name: String(row.full_name ?? ''), email: String(row.email),
    departmentId: (row.department_id as string | null) ?? null, side: (row.department_side as string | null) ?? null,
    role: String(row.role ?? ''), field: FIELD_ROLES.has(String(row.role ?? '')),
  };
}

const refuse = (c: any) => c.json({ error: 'not_staff', message: 'You are not signed in as a member of staff.' }, 401);

/** For a person signed in to the engine (mounted after the global auth): their email finds them. */
export const staffFromSession: MiddlewareHandler = async (c: any, next) => {
  const email = (c.get('user') as { email?: string } | undefined)?.email;
  const staff = email ? await staffByEmail(c.get('supabase'), email) : null;
  if (!staff) return refuse(c);
  c.set('staff', staff);
  await next();
};

/** For a call Property OS forwards (header x-conts-staff). The asserted id must be the email's own person. */
export const staffFromAssertion: MiddlewareHandler = async (c: any, next) => {
  const secret = (c.env as { CONTS_SSO_SECRET?: string } | undefined)?.CONTS_SSO_SECRET;
  if (!secret || secret.length < 32) return c.json({ error: 'not_configured', message: 'Staff claims are not set up on this server.' }, 503);
  const token = c.req.header('x-conts-staff');
  const a = token ? await verifyStaffAssertion(secret, token) : null;
  const staff = a ? await staffByEmail(c.get('supabase'), a.email) : null;
  if (!a || !staff || staff.userId !== a.userId) return refuse(c);
  c.set('staff', staff);
  await next();
};

/** The service client the claim routes read and write through (as the scm routes get theirs from scm/middleware/auth). */
export const claimsClient: MiddlewareHandler = async (c: any, next) => {
  c.set('supabase', getSupabaseService(c.env));
  await next();
};
