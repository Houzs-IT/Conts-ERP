import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const AUDIT_ROLES = ['management', 'operations_manager', 'finance_admin'];

/** Actor, timestamp, before, after, source. This is what makes every financial
 *  and destructive action explainable after the fact. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const entityTable = url.searchParams.get('entityTable');
  // Operations staff may read the activity on a reservation (the drawer shows it); everything else is management and finance.
  const allowed = AUDIT_ROLES.includes(session.role) || (session.role === 'operations_staff' && entityTable === 'reservations');
  if (!allowed) {
    return fail('FORBIDDEN', 'The audit trail is available to management and finance roles.', 403);
  }
  const entityId = url.searchParams.get('entityId');
  const actorId = url.searchParams.get('actorId');
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 50), 200);

  const args: unknown[] = [];
  if (entityTable) args.push(entityTable);
  if (entityId) args.push(entityId);
  if (actorId) args.push(actorId);
  args.push(pageSize, (page - 1) * pageSize);

  const rows = await all<any>(env, `
    SELECT * FROM audit_log
    WHERE 1 = 1
      ${entityTable ? 'AND entity_table = ?' : ''}
      ${entityId ? 'AND entity_id = ?' : ''}
      ${actorId ? 'AND actor_id = ?' : ''}
    ORDER BY occurred_at DESC
    LIMIT ? OFFSET ?`, ...args);

  const total = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM audit_log');

  return json({
    generatedAt: new Date().toISOString(),
    page, pageSize, total: total?.n ?? 0,
    data: rows.map(r => ({
      id: Number(r.id), actorLabel: r.actor_label, action: r.action,
      entityTable: r.entity_table, entityId: r.entity_id,
      before: r.before_state ? JSON.parse(r.before_state) : null,
      after: r.after_state ? JSON.parse(r.after_state) : null,
      source: r.source, occurredAt: r.occurred_at,
    })),
  });
};
