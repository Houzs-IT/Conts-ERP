import { type Env, all, json, nowIso, one } from '../../../_lib/db';
import { connectorGate, connectorUrl } from '../../../_lib/aiConnector';
import { appLabel } from '../../../_lib/mcpAccess';
import { LEAK_CLIENT_ID } from '../../../_lib/mcpStore';

/** Where a person sits, for the lists: their position, else their department. */
const PLACE_JOIN = 'LEFT JOIN positions p ON p.id = u.position_id LEFT JOIN departments d ON d.id = u.department_id';
const PLACE = `COALESCE(p.name, d.name, '')`;
/** Desk accounts that need an approval: not management (always allowed), not owners or field accounts (never). */
const STAFF_ROLES = `u.role NOT IN ('management', 'owner', 'housekeeper', 'technician', 'renovator')`;

/**
 * GET /api/ai-connector/admin/overview: management's AI Connector page in one read: people waiting for approval,
 * everyone connected, who is allowed, the last 100 lookups, the staff who could be turned on, and the counts.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const now = nowIso();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  type Person = { user_id: string; full_name: string; place: string };
  const [requests, connected, allowed, calls, staff, stats] = await Promise.all([
    all<Person & { id: string; reason: string | null; created_at: string }>(env, `
      SELECT r.id, r.user_id, r.reason, r.created_at, u.full_name, ${PLACE} AS place
        FROM mcp_access_requests r JOIN users u ON u.id = r.user_id ${PLACE_JOIN}
       WHERE r.status = 'pending' ORDER BY r.created_at`),
    all<Person & { id: string; created_at: string; last_used_at: string | null; client_name: string | null }>(env, `
      SELECT t.id, t.user_id, t.created_at, t.last_used_at, c.client_name, u.full_name, ${PLACE} AS place
        FROM mcp_tokens t JOIN users u ON u.id = t.user_id LEFT JOIN mcp_oauth_clients c ON c.client_id = t.client_id ${PLACE_JOIN}
       WHERE t.revoked_at IS NULL AND t.refresh_expires_at > ? AND t.client_id <> ?
       ORDER BY t.last_used_at DESC NULLS LAST, t.created_at DESC`, now, LEAK_CLIENT_ID),
    all<Person & { approved_at: string }>(env, `
      SELECT a.user_id, a.approved_at, u.full_name, ${PLACE} AS place
        FROM mcp_access a JOIN users u ON u.id = a.user_id ${PLACE_JOIN}
       ORDER BY u.full_name`),
    all<{ id: string; user_id: string; full_name: string; client_name: string | null; tool: string; target: string | null; status: number | null; ok: number; note: string | null; ms: number | null; created_at: string }>(env, `
      SELECT k.id, k.user_id, u.full_name, c.client_name, k.tool, k.target, k.status, k.ok, k.note, k.ms, k.created_at
        FROM mcp_calls k JOIN users u ON u.id = k.user_id LEFT JOIN mcp_oauth_clients c ON c.client_id = k.client_id
       ORDER BY k.created_at DESC LIMIT 100`),
    all<Person>(env, `
      SELECT u.id AS user_id, u.full_name, ${PLACE} AS place
        FROM users u ${PLACE_JOIN}
       WHERE u.is_active = 1 AND ${STAFF_ROLES} AND NOT EXISTS (SELECT 1 FROM mcp_access a WHERE a.user_id = u.id)
       ORDER BY u.full_name`),
    one<{ calls: number; refused: number; people: number }>(env, `
      SELECT (SELECT count(*) FROM mcp_calls WHERE created_at > ?) AS calls,
             (SELECT count(*) FROM mcp_calls WHERE created_at > ? AND ok = 0) AS refused,
             (SELECT count(DISTINCT user_id) FROM mcp_tokens WHERE revoked_at IS NULL AND refresh_expires_at > ? AND client_id <> ?) AS people`,
    dayAgo, dayAgo, now, LEAK_CLIENT_ID),
  ]);
  const person = (r: Person) => ({ userId: r.user_id, name: r.full_name, position: r.place || '' });
  return json({
    connectorUrl: connectorUrl(request),
    stats: { connectedPeople: Number(stats?.people ?? 0), callsToday: Number(stats?.calls ?? 0), refusedToday: Number(stats?.refused ?? 0), waiting: requests.length },
    requests: requests.map(r => ({ ...person(r), id: r.id, reason: r.reason ?? '', createdAt: r.created_at })),
    connected: connected.map(r => ({ ...person(r), tokenId: r.id, app: appLabel(r.client_name ?? ''), connectedAt: r.created_at, lastUsedAt: r.last_used_at })),
    allowed: allowed.map(r => ({ ...person(r), approvedAt: r.approved_at })),
    calls: calls.map(k => ({ id: k.id, userId: k.user_id, name: k.full_name, app: appLabel(k.client_name ?? ''), tool: k.tool, target: k.target ?? '', status: Number(k.status ?? 0), ok: Number(k.ok) === 1, note: k.note ?? '', ms: Number(k.ms ?? 0), at: k.created_at })),
    staff: staff.map(person),
  });
};
