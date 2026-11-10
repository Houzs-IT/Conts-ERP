import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { mineSql, hasAssigneeUser, UNASSIGNED_SQL, hasJobType, fieldVisibleSql, passKeyTodaySql, jobPlaceJoin, CATEGORIES } from '../../_lib/maintenance';
import { fieldRepairs } from '../../_lib/fieldRepairs';

const POOL_PAGE = 200;
const POOL_MAX = 1000;
const UNIT_SEARCH_MAX = 40;
const UNIT_KEY_SQL = "regexp_replace(u.unit_number, '[^[:alnum:]]', '', 'g')";

interface PoolBuilding { id: string; name: string; open: number }

const heldByTechnicianSql = (byId: boolean): string => `EXISTS (SELECT 1 FROM users tu WHERE tu.role = 'technician' AND ${byId
  ? '(tu.id = m.assignee_user_id OR (m.assignee_user_id IS NULL AND lower(trim(tu.full_name)) = lower(trim(m.vendor_name))))'
  : 'lower(trim(tu.full_name)) = lower(trim(m.vendor_name))'})`;

/** GET /api/field/repairs?building=&category=&unit=&limit= — the signed-in person's repair jobs (open ones, and the ones closed in the last 14 days),
 *  and, for a technician, the open jobs nobody has yet that they may pick up, in one building when `building` is given,
 *  of one problem type when `category` is given, on units whose number contains `unit` (letters and digits only, so
 *  "1203" finds A-12-03), with every building's open count of those (zero kept, so a picked building stays listed),
 *  and the jobs the other technicians are working on now (`team`, read-only on the phone).
 *  `limit` grows by 200 per "Show more", up to 1000. Never carries an amount. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { searchParams } = new URL(request.url);
  const building = searchParams.get('building')?.trim() || null;
  const category = CATEGORIES.find(known => known === searchParams.get('category')) ?? null;
  const unitKey = (searchParams.get('unit') ?? '').slice(0, UNIT_SEARCH_MAX).replace(/[^\p{L}\p{N}]/gu, '');
  const limit = Math.min(POOL_MAX, Math.max(POOL_PAGE, Math.trunc(Number(searchParams.get('limit')) || POOL_PAGE)));

  const byId = await hasAssigneeUser(env);
  // A job waiting for the owner (or its parts) stays with the office, and a Pass key job shows only on its check-in day.
  const hasJobTypes = await hasJobType(env);
  const visible = `${fieldVisibleSql(hasJobTypes)} AND ${passKeyTodaySql(hasJobTypes)}`;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const mineArgs = byId ? [session.userId, session.userId] : [session.userId];
  const mine = await fieldRepairs(env, `${mineSql(byId)} AND ${visible} AND (m.state != 'resolved' OR m.resolved_at >= ?)`, [...mineArgs, since]);
  if (session.role !== 'technician') return json({ generatedAt: nowIso(), mine, open: [], team: [], mayPick: false, buildings: [] });

  const teamSql = `m.assignee_kind = 'in_house' AND ${heldByTechnicianSql(byId)} AND NOT COALESCE(${mineSql(byId)}, FALSE) AND ${visible} AND m.state != 'resolved' AND m.ended_at IS NULL`;

  // A job waiting for the owner's approval cannot be started, so it is not offered.
  const poolSql = `${UNASSIGNED_SQL} AND ${visible} AND m.state IN ('open','reopened')`;
  const filters = [
    ...(category ? [{ sql: 'm.category = ?', arg: category }] : []),
    ...(unitKey ? [{ sql: `${UNIT_KEY_SQL} ILIKE ?`, arg: `%${unitKey}%` }] : []),
  ];
  const filterSql = filters.map(({ sql }) => sql).join(' AND ') || 'TRUE';
  const filterArgs = filters.map(({ arg }) => arg);
  const placeJoin = await jobPlaceJoin(env);
  const [open, buildings, team] = await Promise.all([
    fieldRepairs(env, `${poolSql} AND ${filterSql}${building ? ' AND p.id = ?' : ''}`,
      [...filterArgs, ...(building ? [building] : [])], limit),
    all<PoolBuilding>(env, `
      SELECT p.id, p.name, COUNT(*) FILTER (WHERE ${filterSql})::int AS open FROM maintenance_issues m
      ${placeJoin}
      WHERE ${poolSql} GROUP BY p.id, p.name ORDER BY p.name`, ...filterArgs),
    fieldRepairs(env, teamSql, mineArgs, POOL_MAX),
  ]);
  return json({ generatedAt: nowIso(), mine, open, team, mayPick: true, buildings, limit, maxLimit: POOL_MAX });
};
