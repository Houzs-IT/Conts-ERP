import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { readSession, readCookie, signSession, cookie, clearCookie, sessionLimits, securitySettings, type Session } from '../../_lib/auth';
import { doorFor, HOME } from '../../_lib/door';
import { ROLES } from '../../_lib/roles';
import { ROLE_LABEL } from '../../../src/lib/vocabulary';

/**
 * Staging only: a management account can look at the system as any other account without signing out
 * and in again. It exists so a change can be checked from each role's side.
 *
 * Three things must all hold, so it cannot work on the live system: the VIEW_AS setting is "staging"
 * (wrangler.toml sets it for the preview environment only), the request is not on a live address
 * (erp. / ops. / owner.), and the person who really signed in is management. That person is kept in a
 * second signed cookie, tc_origin, so switching again and switching back never depend on the account
 * being viewed.
 */
const ORIGIN = 'tc_origin';
const originCookie = (request: Request, token: string, age: number) => cookie(request, token, age).replace('tc_session=', `${ORIGIN}=`);
const clearOrigin = (request: Request) => clearCookie(request).replace('tc_session=', `${ORIGIN}=`);
const readOrigin = (request: Request) => (request.headers.get('cookie') ?? '').match(new RegExp(`${ORIGIN}=([^;]+)`))?.[1] ?? null;

interface Who { current: Session; origin: Session }

async function who(request: Request, env: Env): Promise<Who | null> {
  if (env.VIEW_AS !== 'staging' || doorFor(request) !== 'any') return null;
  const current = await readSession(env.SESSION_SECRET, readCookie(request));
  if (!current) return null;
  const origin = await readSession(env.SESSION_SECRET, readOrigin(request)) ?? current;
  return origin.role === 'management' ? { current, origin } : null;
}

type Account = { id: string; full_name: string; email: string; role: string };

/** Every staff role gets its own test account to view as, so looking at a role never acts as a real colleague.
 *  An owner needs an owner record with units behind the login, so for Owner the menu lists existing owner logins instead. */
const TEST_ROLES = ROLES.filter(r => r !== 'owner');
const testEmail = (role: string) => `role-${role.replace(/_/g, '-')}@staging.invalid`;

/** The test account for a role, made on first use. Its password is '!', which no sign-in can match (verifyPassword
 *  needs a salt), so View as is the only way in. Only reached through who(), so only on staging. */
async function testAccount(env: Env, w: Who, role: string): Promise<Account | null> {
  const email = testEmail(role);
  const find = () => one<Account>(env, 'SELECT id, full_name, email, role FROM users WHERE email = ? AND role = ? AND is_active = 1', email, role);
  const found = await find();
  if (found) return found;
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, locale, is_active, created_at, updated_at)
    VALUES (?, ?, ?, '!', ?, 0, 'en-MY', 1, ?, ?) ON CONFLICT (email) DO NOTHING`, id, email, `Test: ${ROLE_LABEL[role]}`, role, now, now);
  const made = await find();
  if (made?.id === id) await audit(env, {
    actorId: w.origin.userId, actorLabel: w.origin.fullName, action: 'user.view_as_test_account',
    entityTable: 'users', entityId: id, after: { email, role, note: 'Staging test account for View as. No password.' },
  });
  return made;
}

function reply(data: unknown, cookies: string[]) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(data), { status: 200, headers });
}

/** GET /api/auth/view-as -> { enabled, me, viewing, users, roles }. `enabled: false` is the whole answer anywhere it is off. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const w = await who(request, env);
  if (!w) return json({ enabled: false });
  const users = await all<Account & { has_unit: boolean; must_change_password: number }>(env, `
    SELECT id, full_name, email, role, must_change_password,
      EXISTS (SELECT 1 FROM owners o JOIN units un ON un.owner_id = o.id WHERE o.user_id = users.id) AS has_unit
    FROM users WHERE is_active = 1 ORDER BY role, full_name`);
  return json({
    enabled: true,
    me: { id: w.origin.userId, fullName: w.origin.fullName },
    viewing: w.current.userId === w.origin.userId ? null : { id: w.current.userId, fullName: w.current.fullName, role: w.current.role },
    users: users.map(u => ({ id: u.id, fullName: u.full_name, email: u.email, role: u.role, hasUnit: !!u.has_unit, notSetUp: !!u.must_change_password })),
    roles: TEST_ROLES,
  });
};

/** POST /api/auth/view-as { userId } or { role } -> signs this browser in as that account, or as that role's test account. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const w = await who(request, env);
  if (!w) return fail('NOT_FOUND', 'That address does not exist.', 404);
  const body = await request.json().catch(() => null) as { userId?: string; role?: string } | null;
  const user = body?.role
    ? (TEST_ROLES.includes(body.role) ? await testAccount(env, w, body.role) : null)
    : body?.userId ? await one<Account & { must_change_password: number }>(env,
      'SELECT id, full_name, email, role, must_change_password FROM users WHERE id = ? AND is_active = 1', body.userId) : null;
  if (!user) return fail('VALIDATION', 'That account does not exist or is switched off.', 400);
  const back = user.id === w.origin.userId;
  // Until that person chooses a password, the system shows them only "Set a new password", so there is nothing to look at.
  if (!back && 'must_change_password' in user && user.must_change_password) {
    return fail('NOT_SET_UP', 'That account has not been set up yet: the person has not chosen a password. Use the role list instead.', 400);
  }

  const settings = await securitySettings(env);
  const mine = sessionLimits(settings, w.origin.role);
  const theirs = sessionLimits(settings, user.role);
  // No signed-in browser row for the account being viewed, so View as never shows up in that person's device list.
  // Going back reuses the real person's own row, so switching back and forth adds none for them either.
  const sid = back ? w.origin.sid : undefined;
  const session = await signSession(env.SESSION_SECRET,
    { userId: user.id, email: user.email, role: user.role, fullName: user.full_name, sid }, theirs.ttlHours, theirs.absoluteDays);
  const origin = await signSession(env.SESSION_SECRET,
    { userId: w.origin.userId, email: w.origin.email, role: w.origin.role, fullName: w.origin.fullName, sid: w.origin.sid }, mine.ttlHours, mine.absoluteDays, w.origin.iat);

  if (!back) await audit(env, {
    actorId: w.origin.userId, actorLabel: w.origin.fullName, action: 'user.view_as',
    entityTable: 'users', entityId: user.id, after: { viewedAs: user.full_name, role: user.role },
  });
  return reply({ home: HOME[user.role] ?? '/' }, [
    cookie(request, session, theirs.ttlHours * 3600),
    back ? clearOrigin(request) : originCookie(request, origin, mine.ttlHours * 3600),
  ]);
};
