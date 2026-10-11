import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { levelsFor } from '../../_lib/access';

const AUDIT_ROLES = ['management', 'operations_manager', 'finance_admin'];

/** The area (functions/_lib/access.ts) whose records each history belongs to: a role that cannot open the
 *  area cannot read the history of its records either. Tables not listed are management and finance only. */
const ENTITY_AREA: Record<string, string> = {
  reservations: 'reservations', guests: 'reservations',
  units: 'properties', properties: 'properties', access_credentials: 'properties',
  tasks: 'operations', maintenance_issues: 'operations', cleaners: 'operations',
  owners: 'owners', owner_contracts: 'owners', owner_adjustments: 'owners',
  owner_statements: 'finance', payouts: 'finance', expenses: 'finance',
  users: 'users',
};

const parse = (s: string | null) => { if (!s) return null; try { return JSON.parse(s); } catch { return s; } };

/** person: someone signed in did it. import: a file import or a migration wrote it. system: Channex, the scheduled job, ... */
export function actorKind(r: { actor_id: string | null; action: string; source: string | null }): 'person' | 'import' | 'system' {
  if (/^import/.test(r.source ?? '') || r.action.startsWith('import.')) return 'import';
  if (!r.actor_id || r.source === 'system' || r.source === 'cron') return 'system';
  return 'person';
}

/** Whether a field account (housekeeper, technician) may read this record's history: only work that is theirs. */
async function fieldOwns(env: Env, userId: string, table: string, id: string) {
  if (table === 'tasks') {
    return !!(await one(env, `
      SELECT 1 AS x FROM tasks t LEFT JOIN cleaners c ON c.id = t.cleaner_id
      WHERE t.id = ? AND (t.assignee_id = ? OR t.completed_by = ? OR c.user_id = ?
        OR EXISTS (SELECT 1 FROM task_cleaners tc JOIN cleaners tcc ON tcc.id = tc.cleaner_id WHERE tc.task_id = t.id AND tcc.user_id = ?))`, id, userId, userId, userId, userId));
  }
  if (table === 'maintenance_issues') {
    return !!(await one(env, `
      SELECT 1 AS x FROM maintenance_issues m
      WHERE m.id = ? AND (m.reported_by = ? OR lower(m.vendor_name) = (SELECT lower(full_name) FROM users WHERE id = ?))`, id, userId, userId));
  }
  return false;
}

/** GET /api/audit — who did what, when, before and after.
 *    ?entityTable=reservations&entityId=..   one record's history (the History panel on every detail view)
 *    &also=units:abc,owners:def              more records shown in the same history (optional)
 *    &page=1&pageSize=25                     newest first
 *  Without a record it is the whole trail, for management and finance only. One record's history follows the
 *  role's access to that kind of record; housekeepers and technicians see only their own cleans and repairs. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const entityTable = url.searchParams.get('entityTable');
  const entityId = url.searchParams.get('entityId');
  const actorId = url.searchParams.get('actorId');
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 50)));

  const main: [string, string] | null = entityTable && entityId ? [entityTable, entityId] : null;
  const extra: [string, string][] = [];
  for (const pair of (url.searchParams.get('also') ?? '').split(',').filter(Boolean).slice(0, 10)) {
    const at = pair.indexOf(':');
    if (at > 0 && at < pair.length - 1) extra.push([pair.slice(0, at), pair.slice(at + 1)]);
  }

  if (session.role === 'owner') return fail('FORBIDDEN', 'The history is not available on the owner portal.', 403);
  // The record asked for must be one the role may see; extra records it may not see are left out, not refused.
  let mayRead: (t: string, id: string) => Promise<boolean>;
  if (isFieldRole(session.role)) {
    mayRead = (t, id) => fieldOwns(env, session.userId, t, id);
  } else {
    const levels = await levelsFor(env, session.role);
    mayRead = async t => { const area = ENTITY_AREA[t]; return area ? levels[area] !== 'none' : AUDIT_ROLES.includes(session.role); };
  }
  if (!main) {
    if (!AUDIT_ROLES.includes(session.role)) return fail('FORBIDDEN', 'The audit trail is available to management and finance roles.', 403);
  } else if (!(await mayRead(main[0], main[1]))) {
    return fail('FORBIDDEN', isFieldRole(session.role) ? 'You can see the history of your own cleans and repairs only.' : 'Your role cannot see the history of this record.', 403);
  }
  const entities: [string, string][] = main ? [main] : [];
  for (const e of extra) if (main && await mayRead(e[0], e[1])) entities.push(e);

  const where: string[] = [], args: unknown[] = [];
  if (entities.length) {
    where.push(`(${entities.map(() => '(a.entity_table = ? AND a.entity_id = ?)').join(' OR ')})`);
    for (const [t, id] of entities) args.push(t, id);
  } else if (entityTable) { where.push('a.entity_table = ?'); args.push(entityTable); }
  if (actorId) { where.push('a.actor_id = ?'); args.push(actorId); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, total] = await Promise.all([
    all<any>(env, `
      SELECT a.id, a.actor_id, a.actor_label, a.action, a.entity_table, a.entity_id, a.before_state, a.after_state, a.source, a.occurred_at, u.role AS actor_role
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ${cond}
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize),
    one<{ n: number }>(env, `SELECT count(*)::int AS n FROM audit_log a ${cond}`, ...args),
  ]);

  const data = rows.map(r => ({
    id: Number(r.id), actorId: r.actor_id ?? null, actorLabel: r.actor_label, actorRole: r.actor_role ?? null, actorKind: actorKind(r),
    action: r.action, entityTable: r.entity_table, entityId: r.entity_id,
    before: parse(r.before_state), after: parse(r.after_state),
    source: r.source, occurredAt: r.occurred_at,
  }));
  return json({ generatedAt: new Date().toISOString(), page, pageSize, total: total?.n ?? 0, names: await namesFor(env, data), data });
};

/** Ids inside before / after (assigneeId, cleanerId, unitId, ownerId ...) as the names people know, so the history
 *  reads "Assigned to: Aina" rather than an id. Only ids that are in this page are looked up. */
async function namesFor(env: Env, data: { before: unknown; after: unknown }[]): Promise<Record<string, string>> {
  const ids = new Set<string>();
  const collect = (o: unknown) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o)) if (/Id$/.test(k) && typeof v === 'string' && v) ids.add(v);
  };
  for (const d of data) { collect(d.before); collect(d.after); }
  if (!ids.size) return {};
  const list = JSON.stringify([...ids].slice(0, 500));
  const rows = await all<{ id: string; name: string }>(env, `
    SELECT id, full_name AS name FROM users WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    UNION ALL SELECT id, full_name FROM cleaners WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    UNION ALL SELECT u.id, trim(coalesce(p.name, '') || ' ' || u.unit_number) FROM units u LEFT JOIN properties p ON p.id = u.property_id WHERE u.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    UNION ALL SELECT id, display_name FROM owners WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    UNION ALL SELECT id, name FROM properties WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, list, list, list, list, list).catch(() => []);
  return Object.fromEntries(rows.filter(r => r.name).map(r => [r.id, r.name]));
}
