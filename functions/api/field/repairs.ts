import { type Env, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { mineSql, hasAssigneeUser, UNASSIGNED_SQL, hasJobType, fieldVisibleSql } from '../../_lib/maintenance';
import { fieldRepairs } from '../../_lib/fieldRepairs';

/** GET /api/field/repairs — the signed-in person's repair jobs (open ones, and the ones closed in the last 14 days),
 *  and, for a technician, the open jobs nobody has yet that they may pick up. Never carries an amount. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const byId = await hasAssigneeUser(env);
  // A job waiting for the owner (or its parts) stays with the office: the field app never lists it.
  const visible = fieldVisibleSql(await hasJobType(env));
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const mine = await fieldRepairs(env, `${mineSql(byId)} AND ${visible} AND (m.state != 'resolved' OR m.resolved_at >= ?)`,
    [...(byId ? [session.userId, session.userId] : [session.userId]), since]);
  // A job waiting for the owner's approval cannot be started, so it is not offered.
  const open = session.role === 'technician'
    ? await fieldRepairs(env, `${UNASSIGNED_SQL} AND ${visible} AND m.state IN ('open','reopened')`, [])
    : [];
  return json({ generatedAt: nowIso(), mine, open, mayPick: session.role === 'technician' });
};
