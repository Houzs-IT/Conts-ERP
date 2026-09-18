import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { getDb } from './db';
import { unauthorized, forbidden } from './http';
import type { AuthUser, Env, Vars } from './types';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Check the token Supabase Auth gave the browser.
 *
 * New Supabase projects sign with a rotating key pair, checked against the
 * project's public keys (JWKS). Older projects sign with a shared secret; if
 * SUPABASE_JWT_SECRET is set we use that instead. An unsigned or expired token
 * throws, and the request is rejected.
 */
export async function verifyToken(env: Env, token: string): Promise<JWTPayload> {
  if (env.SUPABASE_JWT_SECRET) {
    const key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return payload;
  }
  jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks);
  return payload;
}

/**
 * Every /api route runs this first: verify the token, load the profile, and
 * load every permission the user holds through their roles.
 */
export const authenticate: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();

  let payload: JWTPayload;
  try {
    payload = await verifyToken(c.env, token);
  } catch {
    throw unauthorized('Session expired or invalid');
  }

  const userId = payload.sub;
  if (!userId) throw unauthorized('Token has no user');

  const db = c.get('db') ?? getDb(c.env);
  c.set('db', db);

  const rows = await db<{
    id: string; email: string; full_name: string; is_active: boolean;
    role_id: string | null; role_code: string | null; role_name: string | null;
  }[]>`
    select p.id, p.email, p.full_name, p.is_active,
           r.id as role_id, r.code as role_code, r.name as role_name
    from app.profiles p
    left join app.user_roles ur on ur.user_id = p.id
    left join app.roles r on r.id = ur.role_id
    where p.id = ${userId}
  `;

  const first = rows[0];
  if (!first) throw forbidden('This login has no profile yet. Ask an admin to finish your setup.');
  if (!first.is_active) throw forbidden('This account is deactivated');

  const permissionRows = await db<{ code: string }[]>`select code from app.user_permissions(${userId})`;

  const auth: AuthUser = {
    id: first.id,
    email: first.email,
    fullName: first.full_name,
    isActive: first.is_active,
    roles: rows.filter((r) => r.role_id).map((r) => ({ id: r.role_id!, code: r.role_code!, name: r.role_name! })),
    permissions: new Set(permissionRows.map((r) => r.code)),
  };
  c.set('auth', auth);
  await next();
};

/** Route guard. The UI hides buttons; this is what actually stops the request. */
export const requirePermission =
  (code: string): MiddlewareHandler<{ Bindings: Env; Variables: Vars }> =>
  async (c, next) => {
    if (!c.get('auth').permissions.has(code)) {
      throw forbidden(`Missing permission: ${code}`);
    }
    await next();
  };
