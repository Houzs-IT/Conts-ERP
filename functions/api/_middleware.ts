import { type Env, fail } from '../_lib/db';
import { readSession, readCookie } from '../_lib/auth';
import { doorFor, doorRefusal } from '../_lib/door';

/**
 * Runs before every /api endpoint. Most endpoints only check that someone is signed
 * in, so the owner role is deny-by-default here: an owner may call only the routes
 * below, each of which scopes its data to that owner's own records.
 */
const OWNER_ALLOWED = new Set([
  'GET /api/auth/session',
  'POST /api/auth/logout',
  'POST /api/auth/change-password',
  'GET /api/owner/portal',
  'GET /api/statements/pdf',
  'POST /api/maintenance/approve',
]);

const PUBLIC = new Set([
  'POST /api/auth/login', 'POST /api/auth/forgot-password',
  'GET /api/auth/reset-password', 'POST /api/auth/reset-password',
]);

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const route = `${request.method} ${new URL(request.url).pathname.replace(/\/+$/, '')}`;
  if (request.method === 'OPTIONS' || PUBLIC.has(route)) return next();

  const session = await readSession(env.SESSION_SECRET, readCookie(request));
  if (!session) return next(); // the endpoint answers 401 itself

  const refusal = doorRefusal(doorFor(request), session.role);
  if (refusal) return fail('WRONG_DOOR', refusal, 403);

  if (session.role === 'owner' && !OWNER_ALLOWED.has(route)) {
    return fail('FORBIDDEN', 'This is not available on the owner portal.', 403);
  }
  return next();
};
