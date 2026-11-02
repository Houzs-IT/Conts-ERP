import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasPunchRadius } from '../../_lib/attendance';
import { ON_SITE_METRES } from '../../_lib/attendanceCalc';
import { toSite, SITE_COLS, NOT_MIGRATED_SITES, type PunchSiteRow } from '../../_lib/punchSites';

/** GET /api/punch-sites — every building with its map location and punch radius, those with a location first, for
 *  Employees > Hours > Punch Sites. A building without a location cannot read as on site. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Punch sites are kept by the office.', 403);
  if (!(await hasPunchRadius(env))) return fail('NOT_MIGRATED', NOT_MIGRATED_SITES, 503);
  const rows = await all<PunchSiteRow>(env, `SELECT ${SITE_COLS} FROM properties ORDER BY (latitude IS NULL OR longitude IS NULL), name`);
  return json({ data: rows.map(toSite), defaultRadiusM: ON_SITE_METRES });
};
