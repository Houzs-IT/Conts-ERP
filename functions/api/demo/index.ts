import { type Env, all, one, json, fail, audit } from '../../_lib/db';
import { rentalOnly } from '../../_lib/unitPurpose';
import { requireSession } from '../../_lib/auth';
import { DEMO_COOKIE, demoAllowed, demoAsked } from '../../_lib/demo';
import { demoCounts } from '../../_lib/demoRecords';

const NOT_ALLOWED = 'Demo mode is for management and sales staff.';

/** GET /api/demo — whether Demo mode is on for this browser, how much sample data there is, and the units a sample
 *  reservation or review may go on (real and sample rental units). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', NOT_ALLOWED, 403);
  const [counts, units] = await Promise.all([demoCounts(env), all<any>(env, `
    SELECT u.id, u.unit_number, u.unit_code, u.property_id, p.name AS property_name, u.demo_source
    FROM demo.v_units u JOIN properties p ON p.id = u.property_id WHERE 1 = 1${await rentalOnly(env)} ORDER BY p.name, u.unit_number`)]);
  return json({
    on: demoAsked(request), counts,
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, unitCode: u.unit_code, propertyId: u.property_id, propertyName: u.property_name, purpose: 'rental', sample: u.demo_source === 'demo' })),
  });
};

/** POST /api/demo { on } — the top bar's Demo switch. It is this browser's own setting (a cookie), checked against the
 *  person's role and department on every request, so a role change takes it away at once. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', NOT_ALLOWED, 403);
  const body = await request.json().catch(() => null) as { on?: unknown } | null;
  if (typeof body?.on !== 'boolean') return fail('VALIDATION', 'Say whether to turn Demo mode on or off.', 422);
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: body.on ? 'demo.on' : 'demo.off', entityTable: 'users', entityId: session.userId });
  return json({ on: body.on }, 200, {
    'set-cookie': body.on ? `${DEMO_COOKIE}=1; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=43200` : `${DEMO_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`,
  });
};

/** DELETE /api/demo — Clear demo: every sample row and every shadow goes; real records are untouched. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', NOT_ALLOWED, 403);
  const before = await demoCounts(env);
  const cleared = await one<{ c: Record<string, number> }>(env, 'SELECT demo.clear() AS c');
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.clear', entityTable: 'demo', entityId: 'all', before, after: cleared?.c });
  return json({ cleared: cleared?.c ?? {} });
};
