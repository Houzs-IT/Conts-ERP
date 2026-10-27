import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasPunchSites } from '../../_lib/attendance';
import { ON_SITE_METRES } from '../../_lib/attendanceCalc';
import { siteInput, toSite, SITE_COLS, NOT_MIGRATED_SITES, type PunchSiteRow } from '../../_lib/punchSites';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)

/** GET /api/punch-sites — every punch site, those in use first, for Employees > Hours > Punch Sites; with how many
 *  buildings have a map location (each also counts, at ON_SITE_METRES). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Punch sites are kept by the office.', 403);
  if (!(await hasPunchSites(env))) return fail('NOT_MIGRATED', NOT_MIGRATED_SITES, 503);
  const [rows, buildings] = await Promise.all([
    all<PunchSiteRow>(env, `SELECT ${SITE_COLS} FROM punch_sites ORDER BY is_active DESC, name`),
    one<{ n: number }>(env, 'SELECT count(*)::int AS n FROM properties WHERE latitude IS NOT NULL AND longitude IS NOT NULL'),
  ]);
  return json({ data: rows.map(toSite), buildingsWithLocation: buildings?.n ?? 0, buildingRadiusM: ON_SITE_METRES });
};

/** POST /api/punch-sites { name, lat, lng, radiusM, active? } — a new punch site. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include punch sites.', 403);
  if (!(await hasPunchSites(env))) return fail('NOT_MIGRATED', NOT_MIGRATED_SITES, 503);
  const parsed = siteInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const s = parsed.data;
  const id = crypto.randomUUID();
  const now = nowIso();
  await run(env, `
    INSERT INTO punch_sites (id, name, lat, lng, radius_m, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, s.name, s.lat, s.lng, s.radiusM, s.active ? 1 : 0, session.userId, now, now);
  const row = await one<PunchSiteRow>(env, `SELECT ${SITE_COLS} FROM punch_sites WHERE id = ?`, id);
  if (!row) throw new Error('The punch site was not saved.');
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'punch_site.create', entityTable: 'punch_sites', entityId: id,
    after: toSite(row),
  });
  return json({ data: toSite(row) }, 201);
};
