import { mayWork } from '../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasPunchSites } from '../../_lib/attendance';
import { siteInput, toSite, SITE_COLS, NOT_MIGRATED_SITES, type PunchSiteRow } from '../../_lib/punchSites';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)

/** PATCH /api/punch-sites/:id { name, lat, lng, radiusM, active } — move, rename, resize or switch off a punch site.
 *  Punches are not tied to a site, so the change shows on old days too; the history keeps the site as it was. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include punch sites.', 403);
  if (!(await hasPunchSites(env))) return fail('NOT_MIGRATED', NOT_MIGRATED_SITES, 503);

  const before = await one<PunchSiteRow>(env, `SELECT ${SITE_COLS} FROM punch_sites WHERE id = ?`, String(params.id));
  if (!before) return fail('NOT_FOUND', 'That punch site is not on record.', 404);
  const parsed = siteInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const s = parsed.data;
  await run(env, 'UPDATE punch_sites SET name = ?, lat = ?, lng = ?, radius_m = ?, is_active = ?, updated_at = ? WHERE id = ?',
    s.name, s.lat, s.lng, s.radiusM, s.active ? 1 : 0, nowIso(), before.id);
  const after = await one<PunchSiteRow>(env, `SELECT ${SITE_COLS} FROM punch_sites WHERE id = ?`, before.id);
  if (!after) throw new Error('The punch site was not saved.');
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'punch_site.update', entityTable: 'punch_sites', entityId: before.id,
    before: toSite(before), after: toSite(after),
  });
  return json({ data: toSite(after) });
};
