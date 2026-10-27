import { mayWork } from '../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasPunchRadius } from '../../_lib/attendance';
import { radiusInput, toSite, SITE_COLS, NOT_MIGRATED_SITES, type PunchSiteRow } from '../../_lib/punchSites';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)

/** PATCH /api/punch-sites/:buildingId { radiusM } — a building's punch radius in metres, or null for the default.
 *  Punches are not tied to a building, so the change shows on old days too; the history keeps the radius before. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include punch sites.', 403);
  if (!(await hasPunchRadius(env))) return fail('NOT_MIGRATED', NOT_MIGRATED_SITES, 503);

  const before = await one<PunchSiteRow>(env, `SELECT ${SITE_COLS} FROM properties WHERE id = ?`, String(params.id));
  if (!before) return fail('NOT_FOUND', 'That building is not on record.', 404);
  const parsed = radiusInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  await run(env, 'UPDATE properties SET punch_radius_m = ?, updated_at = ? WHERE id = ?', parsed.data.radiusM, nowIso(), before.id);
  const after = await one<PunchSiteRow>(env, `SELECT ${SITE_COLS} FROM properties WHERE id = ?`, before.id);
  if (!after) throw new Error('The punch radius was not saved.');
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'property.punch_radius', entityTable: 'properties', entityId: before.id,
    before: { radiusM: before.punch_radius_m }, after: { radiusM: after.punch_radius_m },
  });
  return json({ data: toSite(after) });
};
