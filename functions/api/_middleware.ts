import { type Env, fail } from '../_lib/db';
import { readSession, readCookie, signSession, cookie, clearCookie, sessionLimits, sessionState, isFieldRole, canSeeFinance } from '../_lib/auth';
import { doorFor, doorRefusal } from '../_lib/door';
import { accessFor, refusalFor } from '../_lib/access';
import { flushWhenQuiet, FLUSH_DELAY_MS } from '../_lib/channexQueue';

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

/** Supply chain endpoints only check for a signed-in user, and carry prices and costs;
 *  field accounts have no supply chain screens, so they are refused here in one place. */
const SUPPLY_CHAIN = /^\/api\/(consignment-notes|customers|delivery-orders|delivery-schedule|delivery-zones|driver-leave|drivers|fabrics|fleet-health|coverage-fleet|goods-receipts|loading-list|mrp|payment-vouchers|product-models|products|purchase-consignment|purchase-invoices|purchase-orders|purchase-returns|racks|rate-cards|sales-invoices|sales-orders|sales-returns|so-amendments|stock|stock-takes|stock-transfers|suppliers|threepl-companies|unbilled-deliveries|vehicles|warehouses|credit-notes|accounting)(\/|$)/;
/** Invoices and payments: what is owed and paid. Finance roles only, like Accounting. */
const MONEY_ONLY = /^\/api\/(payment-vouchers|purchase-invoices|sales-invoices|unbilled-deliveries|credit-notes|accounting)(\/|$)/;

const PUBLIC = new Set([
  'POST /api/auth/login', 'POST /api/auth/forgot-password',
  'GET /api/auth/reset-password', 'POST /api/auth/reset-password',
]);

export const onRequest: PagesFunction<Env> = async ({ request, env, next, waitUntil }) => {
  const route = `${request.method} ${new URL(request.url).pathname.replace(/\/+$/, '')}`;
  if (request.method === 'OPTIONS' || PUBLIC.has(route)) return next();

  const signed = await readSession(env.SESSION_SECRET, readCookie(request));
  if (!signed) return next(); // the endpoint answers 401 itself

  // The cookie only says who signed in. Their role and whether the account is still on are read from
  // users on every request (one query, shared with the security settings below), so switching someone
  // off or changing their role on Users and roles takes effect on their very next click.
  const live = await sessionState(env, signed.userId);
  if (!live.user?.active) {
    return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'This account has been switched off or changed. Sign in again, or ask management.' } }),
      { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': clearCookie(request) } });
  }
  const session = live.user.role === signed.role && live.user.fullName === signed.fullName ? signed : { ...signed, role: live.user.role, fullName: live.user.fullName };
  const limits = sessionLimits(live.settings, session.role);
  // Endpoints read the session from the cookie themselves (requireSession), so they are handed a cookie
  // carrying the current role rather than the one signed at sign-in.
  let forward = request;
  if (session !== signed) {
    const token = await signSession(env.SESSION_SECRET, session, limits.ttlHours, limits.absoluteDays, session.iat);
    const headers = new Headers(request.headers);
    headers.set('cookie', (request.headers.get('cookie') ?? '').replace(/tc_session=[^;]+/, `tc_session=${token}`));
    forward = new Request(request, { headers }) as typeof request;
  }

  const refusal = doorRefusal(doorFor(request), session.role);
  if (refusal) return fail('WRONG_DOOR', refusal, 403);

  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  // The staging account switcher checks who really signed in itself, so it stays reachable from any account.
  if (path === '/api/auth/view-as') return next(forward);
  if (session.role === 'owner' &&!OWNER_ALLOWED.some(([m, re]) => m === request.method && re.test(path))) {
    return fail('FORBIDDEN', 'This is not available on the owner portal.', 403);
  }
  if (isFieldRole(session.role) && SUPPLY_CHAIN.test(path)) {
    return fail('FORBIDDEN', 'Your account does not have access to supply chain records.', 403);
  }
  // A level management chose on Users and roles > Permissions replaces the built-in rule for that area.
  const access = await accessFor(env, session.role, path);
  const refused = refusalFor(access, request.method);
  if (refused) return fail('FORBIDDEN', refused, 403);
  if (MONEY_ONLY.test(path) && !(access.chosen ? access.level !== 'none' : canSeeFinance(session.role))) {
    return fail('FORBIDDEN', 'Only finance and management can see invoices and payments.', 403);
  }

  const response = await next(forward);
  // Any write may have queued Channex updates; send them once the burst of edits has gone quiet.
  if (request.method !== 'GET' && response.status < 400) {
    waitUntil(new Promise(r => setTimeout(r, FLUSH_DELAY_MS)).then(() => flushWhenQuiet(env)).catch(() => {}));
  }
  // Slide the idle deadline forward on every authenticated call, capped at the
  // absolute limit from first login (see signSession). Skipped when the endpoint
  // already set its own cookie (logout clearing it, login/reset-password issuing a
  // fresh one) so this never overwrites that with a stale live session.
  if (response.headers.has('set-cookie')) return response;
  const { ttlHours, absoluteDays } = limits;
  const refreshed = await signSession(env.SESSION_SECRET, session, ttlHours, absoluteDays, session.iat);
  const headers = new Headers(response.headers);
  headers.append('set-cookie', cookie(request, refreshed, ttlHours * 3600));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
