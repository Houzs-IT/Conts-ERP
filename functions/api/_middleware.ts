import { type Env, fail } from '../_lib/db';
import { readSession, readCookie, signSession, cookie, sessionLimits } from '../_lib/auth';
import { doorFor, doorRefusal } from '../_lib/door';

/**
 * Runs before every /api endpoint. Most endpoints only check that someone is signed
 * in, so the owner role is deny-by-default here: an owner may call only the routes
 * below, each of which scopes its data to that owner's own records.
 */
const OWNER_ALLOWED: [string, RegExp][] = [
  ['GET', /^\/api\/auth\/session$/],
  ['POST', /^\/api\/auth\/logout$/],
  ['POST', /^\/api\/auth\/change-password$/],
  ['GET', /^\/api\/owner\/(summary|trend|property-health|documents)$/],
  ['GET', /^\/api\/owner\/statements\/[^/]+\/pdf$/],
  ['POST', /^\/api\/maintenance\/issues\/[^/]+\/approve$/],
];

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

  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (session.role === 'owner' && !OWNER_ALLOWED.some(([m, re]) => m === request.method && re.test(path))) {
    return fail('FORBIDDEN', 'This is not available on the owner portal.', 403);
  }

  const response = await next();
  // Slide the idle deadline forward on every authenticated call, capped at the
  // absolute limit from first login (see signSession). Skipped when the endpoint
  // already set its own cookie (logout clearing it, login/reset-password issuing a
  // fresh one) so this never overwrites that with a stale live session.
  if (response.headers.has('set-cookie')) return response;
  const { ttlHours, absoluteDays } = sessionLimits(env, session.role);
  const refreshed = await signSession(env.SESSION_SECRET, session, ttlHours, absoluteDays, session.iat);
  const headers = new Headers(response.headers);
  headers.append('set-cookie', cookie(request, refreshed, ttlHours * 3600));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
