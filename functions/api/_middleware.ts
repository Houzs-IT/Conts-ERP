import { type Env, fail, withRequestDb } from '../_lib/db';
import { readSession, readCookie, signSession, cookie, clearCookie, sessionLimits, sessionState, isFieldRole, canSeeFinance } from '../_lib/auth';
import { doorFor, doorRefusal } from '../_lib/door';
import { accessFor, refusalFor } from '../_lib/access';
import { flushWhenQuiet, FLUSH_DELAY_MS } from '../_lib/channexQueue';
import { closePastStaysSometimes } from '../_lib/autoCheckout';
import { twoStepSetupDue } from '../_lib/signIn';
import { overLimit } from '../_lib/textLimits';
import { once } from '../_lib/idempotency';

/**
 * Runs before every /api endpoint. Most endpoints only check that someone is signed
 * in, so the owner role is deny-by-default here: an owner may call only the routes
 * below, each of which scopes its data to that owner's own records.
 */
const OWNER_ALLOWED: [string, RegExp][] = [
  ['GET', /^\/api\/auth\/session$/],
  ['POST', /^\/api\/auth\/logout$/],
  ['POST', /^\/api\/auth\/change-password$/],
  // My account: their own password, two-step sign-in, recent sign-ins, signing out other devices.
  ['GET', /^\/api\/account$/],
  ['POST', /^\/api\/account\/[a-z0-9/-]+$/],
  ['GET', /^\/api\/owner\/(summary|trend|property-health|documents)$/],
  ['GET', /^\/api\/owner\/statements\/[^/]+(\/pdf)?$/],
  // The Owner Income Report: the handler resolves the owner from the session (ownerFor) and shows only their final statements.
  ['GET', /^\/api\/statements\/[^/]+\/report$/],
  ['POST', /^\/api\/maintenance\/issues\/[^/]+\/approve$/],
  // Their own notices (a repair quote waiting for their approval); the handlers only ever read the signed-in person's rows.
  ['GET', /^\/api\/notifications(\/count)?$/],
  ['PATCH', /^\/api\/notifications$/],
  // A file staff marked visible to the owner (their contract); the handler checks it is theirs.
  ['GET', /^\/api\/documents\/[^/]+\/download$/],
];

/**
 * Housekeepers and technicians work from the field app (FieldTodayPage, FieldRepairsPage): today's cleans, repair
 * jobs (pick up, start, photos, claim files, done), report damage. They are deny-by-default like owners, so a desk endpoint that only checks for
 * a signed-in user (units, search, portfolio revenue, owner documents) is never theirs by accident. Each
 * handler below still checks the job is assigned to them.
 */
const FIELD_ALLOWED: [string, RegExp][] = [
  ['GET', /^\/api\/auth\/session$/],
  ['POST', /^\/api\/auth\/logout$/],
  ['POST', /^\/api\/auth\/change-password$/],
  ['GET', /^\/api\/account$/],
  ['POST', /^\/api\/account\/[a-z0-9/-]+$/],
  ['GET', /^\/api\/notifications(\/count)?$/],
  ['PATCH', /^\/api\/notifications$/],
  ['GET', /^\/api\/field\/(tasks|repairs|units)$/],
  // Repair jobs on the phone: the technician's own and the unassigned ones they may pick up (the handlers check which).
  ['GET', /^\/api\/field\/repairs\/[^/]+$/],
  ['POST', /^\/api\/field\/repairs\/[^/]+\/(pick|note)$/],
  ['GET', /^\/api\/housekeeping\/tasks\/[^/]+(\/checklist|\/photos)?$/],
  ['POST', /^\/api\/housekeeping\/tasks\/[^/]+\/(checklist|start)$/],
  ['POST', /^\/api\/housekeeping\/guest-left$/],
  ['POST', /^\/api\/tasks\/[^/]+\/(complete|photos)$/],
  ['POST', /^\/api\/maintenance\/issues$/],
  ['POST', /^\/api\/maintenance\/issues\/[^/]+\/(photos|documents|start|end)$/],
  ['GET', /^\/api\/documents\/[^/]+\/download$/],
  // The history of their own cleans and repairs (functions/api/audit/index.ts limits it to those).
  ['GET', /^\/api\/audit$/],
];

/** Supply chain endpoints only check for a signed-in user, and carry prices and costs;
 *  field accounts have no supply chain screens, so they are refused here in one place. */
const SUPPLY_CHAIN = /^\/api\/(consignment-notes|customers|delivery-orders|delivery-schedule|delivery-zones|driver-leave|drivers|fabrics|fleet-health|coverage-fleet|goods-receipts|loading-list|mrp|payment-vouchers|product-models|products|purchase-consignment|purchase-invoices|purchase-orders|purchase-returns|racks|rate-cards|sales-invoices|sales-orders|sales-returns|so-amendments|stock|stock-takes|stock-transfers|suppliers|threepl-companies|unbilled-deliveries|vehicles|warehouses|credit-notes|accounting)(\/|$)/;
/** Invoices and payments: what is owed and paid. Finance roles only, like Accounting. */
const MONEY_ONLY = /^\/api\/(payment-vouchers|purchase-invoices|sales-invoices|unbilled-deliveries|credit-notes|accounting)(\/|$)/;

const PUBLIC = new Set([
  'POST /api/auth/login', 'POST /api/auth/login-2fa', 'POST /api/auth/forgot-password',
  'GET /api/auth/reset-password', 'POST /api/auth/reset-password', 'GET /api/settings/public',
]);

/** What someone who must still set up two-step sign-in can reach. */
const SETUP_ALLOWED = /^(GET \/api\/auth\/session|POST \/api\/auth\/(logout|change-password)|GET \/api\/account|POST \/api\/account\/.+)$/;

const handle: PagesFunction<Env> = async ({ request, env, next, waitUntil }) => {
  const route = `${request.method} ${new URL(request.url).pathname.replace(/\/+$/, '')}`;
  if (request.method === 'OPTIONS' || PUBLIC.has(route)) return next();

  const signed = await readSession(env.SESSION_SECRET, readCookie(request));
  if (!signed) return next(); // the endpoint answers 401 itself

  // The cookie only says who signed in. Their role and whether the account is still on are read from
  // users on every request (one query, shared with the security settings below), so switching someone
  // off or changing their role on Users and roles takes effect on their very next click.
  const live = await sessionState(env, signed.userId, signed.sid);
  // A cookie signed before management's "Sign out everywhere" (or a password reset) is refused the same way, and so
  // is one whose browser signed out (its user_sessions row is gone), even if the cookie was copied elsewhere.
  if (!live.user?.active || signed.iat < live.user.revokedAt || !live.user.sessionLive) {
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

  // Management requires two-step sign-in for this role and this person has not set it up: until they do,
  // only their own account screen answers.
  if (!SETUP_ALLOWED.test(route) && await twoStepSetupDue(env, live.settings, session.role, live.user.twoFactorOn)) {
    return fail('TWO_STEP_REQUIRED', 'Set up two-step sign-in on My account before using the rest of the system.', 403);
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
  if (isFieldRole(session.role) && !FIELD_ALLOWED.some(([m, re]) => m === request.method && re.test(path))) {
    return fail('FORBIDDEN', 'This is not available in the field app.', 403);
  }
  // The level on Users and roles > Permissions (chosen by management, or the built-in one it shows).
  const access = await accessFor(env, session.role, path, request.method);
  const refused = refusalFor(access, request.method);
  if (refused) return fail('FORBIDDEN', refused, 403);
  if (MONEY_ONLY.test(path) && !(access.chosen ? access.level !== 'none' : canSeeFinance(session.role))) {
    return fail('FORBIDDEN', 'Only finance and management can see invoices and payments.', 403);
  }

  if (request.method !== 'GET' && (request.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await forward.clone().json().catch(() => undefined);
    const over = overLimit(body);
    if (over) return fail('VALIDATION', over.message, 422, { [over.field]: over.message });
  }

  // A money or document write sent again with the same Idempotency-Key gets the first answer back (functions/_lib/idempotency.ts).
  const response = await once(env, forward, session.userId, () => next(forward));
  closePastStaysSometimes(env, waitUntil);
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

/** An endpoint that throws (a database error, a bug) would otherwise reach the browser as the platform's own error
 *  page or a raw message. It is logged here and answered in the standard envelope with a plain sentence instead. */
export const onRequest: PagesFunction<Env> = async (ctx) => {
  try {
    return await withRequestDb(async () => handle(ctx), p => ctx.waitUntil(p));
  } catch (e) {
    console.error('Unhandled error', ctx.request.method, new URL(ctx.request.url).pathname, e);
    // A write may have saved part of its work before it failed, so it does not claim "nothing was saved" (a person who
    // believes that and presses again can make a second copy). A read saved nothing.
    if (ctx.request.method === 'GET') return fail('INTERNAL', 'Something went wrong on our side and this could not load. Try again; if it keeps happening, tell IT.', 500);
    return fail('INTERNAL', 'Something went wrong on our side. Refresh the page to see whether the change was saved before trying again; if it keeps happening, tell IT.', 500);
  }
};
