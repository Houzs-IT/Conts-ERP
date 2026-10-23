import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { readSession, readCookie, signSession, cookie, clearCookie, sessionLimits, securitySettings, type Session } from '../../_lib/auth';
import { doorFor, homeFor } from '../../_lib/door';
import { placeOf } from '../../_lib/userSide';
import { roleForKind, isKind, isSide, type DepartmentKind, type Side } from '../../_lib/access';

/**
 * Staging only: a management account can look at the system as any other account without signing out
 * and in again. It exists so a change can be checked from each department's side.
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

interface DepartmentRow { id: string; name: string; kind: string; side: string }

/** Every department (and, optionally, one of its positions) gets its own test account to view as, so looking at a
 *  department never acts as a real colleague. An owner needs an owner record with units behind the login, so for Owner
 *  the menu lists existing owner logins instead. */
const testEmail = (departmentId: string, positionId: string | null) =>
  `dept-${departmentId.slice(0, 8)}${positionId ? `-${positionId.slice(0, 8)}` : ''}@staging.invalid`;

/** The test account for a department and position, made on first use and brought in line with the department's current
 *  kind and side on every use, so editing a department on the list screen shows in View as at once. Its password is '!',
 *  which no sign-in can match (verifyPassword needs a salt), so View as is the only way in. Only reached through who(),
 *  so only on staging. */
async function testAccount(env: Env, w: Who, departmentId: string, positionId: string | null): Promise<Account | null> {
  const dept = await one<DepartmentRow>(env, 'SELECT id, name, kind, side FROM departments WHERE id = ?', departmentId);
  if (!dept || !isKind(dept.kind)) return null;
  const pos = positionId ? await one<{ id: string; name: string }>(env, 'SELECT id, name FROM positions WHERE id = ? AND department_id = ?', positionId, departmentId) : null;
  if (positionId && !pos) return null;
  const email = testEmail(dept.id, pos?.id ?? null);
  const role = roleForKind(dept.kind);
  const side: Side = isSide(dept.side) ? dept.side : 'both';
  const find = () => one<Account>(env, 'SELECT id, full_name, email, role FROM users WHERE email = ? AND is_active = 1', email);
  const name = `Test: ${dept.name}${pos ? ` / ${pos.name}` : ''}`;
  const found = await find();
  if (found) {
    await run(env, `UPDATE users SET role = ?, side = ?, department_id = ?, position_id = ?, department = ?, "position" = ?, full_name = ? WHERE id = ?`,
      role, side, dept.id, pos?.id ?? null, dept.name, pos?.name ?? null, name, found.id);
    return { ...found, role, full_name: name };
  }
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO users (id, email, full_name, password_hash, role, side, department_id, position_id, department, "position", must_change_password, locale, is_active, created_at, updated_at)
    VALUES (?, ?, ?, '!', ?, ?, ?, ?, ?, ?, 0, 'en-MY', 1, ?, ?) ON CONFLICT (email) DO NOTHING`,
    id, email, name, role, side, dept.id, pos?.id ?? null, dept.name, pos?.name ?? null, now, now);
  const made = await find();
  if (made?.id === id) await audit(env, {
    actorId: w.origin.userId, actorLabel: w.origin.fullName, action: 'user.view_as_test_account',
    entityTable: 'users', entityId: id, after: { email, department: dept.name, position: pos?.name ?? null, role, note: 'Staging test account for View as. No password.' },
  });
  return made;
}

function reply(data: unknown, cookies: string[]) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(data), { status: 200, headers });
}

/** GET /api/auth/view-as -> { enabled, me, viewing, users, departments, roles }. `enabled: false` is the whole answer anywhere it is off.
 *  `departments`: every active department with its positions, each of which has a test account to view as. `roles` is
 *  empty now that nobody picks a role; it stays in the answer so an older screen still renders. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const w = await who(request, env);
  if (!w) return json({ enabled: false });
  const [users, departments, positions] = await Promise.all([
    all<Account & { has_unit: boolean; must_change_password: number; department_id: string | null; position_id: string | null; department: string | null }>(env, `
    SELECT u.id, u.full_name, u.email, u.role, u.must_change_password, u.department_id, u.position_id, d.name AS department,
      EXISTS (SELECT 1 FROM owners o JOIN units un ON un.owner_id = o.id WHERE o.user_id = u.id) AS has_unit
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.is_active = 1 ORDER BY d.sort NULLS LAST, d.name, u.full_name`),
    all<DepartmentRow>(env, 'SELECT id, name, kind, side FROM departments WHERE is_active = 1 ORDER BY sort, name'),
    all<{ id: string; department_id: string; name: string }>(env, 'SELECT id, department_id, name FROM positions WHERE is_active = 1 ORDER BY sort, name'),
  ]);
  return json({
    enabled: true,
    me: { id: w.origin.userId, fullName: w.origin.fullName },
    viewing: w.current.userId === w.origin.userId ? null : { id: w.current.userId, fullName: w.current.fullName, role: w.current.role },
    users: users.map(u => ({
      id: u.id, fullName: u.full_name, email: u.email, role: u.role, departmentId: u.department_id, department: u.department,
      positionId: u.position_id, hasUnit: !!u.has_unit, notSetUp: !!u.must_change_password,
    })),
    departments: departments.map(d => ({ id: d.id, name: d.name, kind: d.kind, side: d.side, positions: positions.filter(p => p.department_id === d.id).map(p => ({ id: p.id, name: p.name })) })),
    roles: [],
  });
};

/** POST /api/auth/view-as { userId } or { departmentId, positionId? } -> signs this browser in as that account, or as
 *  that department's (and position's) test account. Answers { home }. The old { role } still works for the four
 *  hidden roles: it opens the first department of that kind. */
const KIND_OF_ROLE: Record<string, DepartmentKind> = { management: 'management', operations_staff: 'staff', housekeeper: 'cleaning', technician: 'maintenance' };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const w = await who(request, env);
  if (!w) return fail('NOT_FOUND', 'That address does not exist.', 404);
  const body = await request.json().catch(() => null) as { userId?: string; role?: string; departmentId?: string; positionId?: string | null } | null;
  const kind = body?.role ? KIND_OF_ROLE[body.role] : undefined;
  const departmentId = body?.departmentId ?? (kind ? (await one<{ id: string }>(env, 'SELECT id FROM departments WHERE kind = ? AND is_active = 1 ORDER BY sort, name LIMIT 1', kind))?.id : undefined);
  const user = departmentId
    ? await testAccount(env, w, departmentId, body?.positionId ?? null)
    : body?.userId ? await one<Account & { must_change_password: number }>(env,
      'SELECT id, full_name, email, role, must_change_password FROM users WHERE id = ? AND is_active = 1', body.userId) : null;
  if (!user) return fail('VALIDATION', 'That account does not exist or is switched off.', 400);
  const back = user.id === w.origin.userId;
  // Until that person chooses a password, the system shows them only "Set a new password", so there is nothing to look at.
  if (!back && 'must_change_password' in user && user.must_change_password) {
    return fail('NOT_SET_UP', 'That account has not been set up yet: the person has not chosen a password. Use the department list instead.', 400);
  }

  const settings = await securitySettings(env);
  const mine = sessionLimits(settings, w.origin.role);
  const theirs = sessionLimits(settings, user.role);
  // No signed-in browser row for the account being viewed, so View as never shows up in that person's device list.
  // Going back reuses the real person's own row, so switching back and forth adds none for them either.
  const sid = back ? w.origin.sid : undefined;
  const place = await placeOf(env, user.id);
  const { side, departmentId: deptId, positionId: posId, kind: placeKind } = place;
  const session = await signSession(env.SESSION_SECRET,
    { userId: user.id, email: user.email, role: user.role, side, departmentId: deptId, positionId: posId, kind: placeKind, fullName: user.full_name, sid }, theirs.ttlHours, theirs.absoluteDays);
  const origin = await signSession(env.SESSION_SECRET,
    { userId: w.origin.userId, email: w.origin.email, role: w.origin.role, fullName: w.origin.fullName, sid: w.origin.sid }, mine.ttlHours, mine.absoluteDays, w.origin.iat);

  if (!back) await audit(env, {
    actorId: w.origin.userId, actorLabel: w.origin.fullName, action: 'user.view_as',
    entityTable: 'users', entityId: user.id, after: { viewedAs: user.full_name, role: user.role, department: place.department },
  });
  return reply({ home: homeFor({ role: user.role, kind: placeKind, side, department: place.department }) }, [
    cookie(request, session, theirs.ttlHours * 3600),
    back ? clearOrigin(request) : originCookie(request, origin, mine.ttlHours * 3600),
  ]);
};
