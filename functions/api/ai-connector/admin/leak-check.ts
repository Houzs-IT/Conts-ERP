import { type Env, audit, fail, json, nowIso, one, run } from '../../../_lib/db';
import { actorOf, connectorGate } from '../../../_lib/aiConnector';
import { analyseBody, leakCheckPaths, type LeakRow } from '../../../_lib/mcpAccess';
import { isDeskRole, isMcpAdmin, issueTokens, LEAK_CLIENT_ID, revokeToken } from '../../../_lib/mcpStore';
import { mcpRouteInfo, readEndpoint } from '../../../_lib/mcpServer';

const PAGE = 20;
const PARALLEL = 4;

/**
 * POST /api/ai-connector/admin/leak-check { userId, offset }: runs the connector's real read path AS one approved staff
 * account over every parameter-free list endpoint, a page of 20 per request (the page asks again with `next` until
 * `done`), four at a time so one check never floods the database. It reports which money and people field NAMES
 * (cost, salary, margin, commission, IC, bank account ...) reach that account; never a value. The token it uses lives
 * five minutes and is revoked when the page is done, whatever happens.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const gate = await connectorGate(request, env, true);
  if (gate.response) return gate.response;
  const { session } = gate;
  const body = await request.json<{ userId?: unknown; offset?: unknown }>().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const offset = Math.max(0, Math.floor(Number(body?.offset) || 0));
  const u = userId ? await one<{ id: string; full_name: string; role: string; is_active: number; approved: boolean }>(env,
    'SELECT u.id, u.full_name, u.role, u.is_active, EXISTS (SELECT 1 FROM mcp_access a WHERE a.user_id = u.id) AS approved FROM users u WHERE u.id = ?', userId) : null;
  if (!u) return fail('NOT_FOUND', 'Choose an approved staff account.', 404);
  if (isMcpAdmin(u)) return fail('VALIDATION', 'Management sees everything. Choose a staff account.', 422);
  if (Number(u.is_active) !== 1 || !isDeskRole(u.role)) return fail('VALIDATION', 'That account is switched off or is not a desk account.', 422);
  if (!u.approved) return fail('VALIDATION', 'Turn the AI Connector on for this account first; the check reads as them.', 422);

  await run(env, `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, 'Leak check', '[]', ?) ON CONFLICT (client_id) DO NOTHING`, LEAK_CLIENT_ID, nowIso());
  const paths = leakCheckPaths(mcpRouteInfo());
  const page = paths.slice(offset, offset + PAGE);
  const tok = await issueTokens(env, userId, LEAK_CLIENT_ID, 5 * 60_000);
  const rows: LeakRow[] = [];
  try {
    for (let i = 0; i < page.length; i += PARALLEL) {
      const chunk = page.slice(i, i + PARALLEL);
      rows.push(...await Promise.all(chunk.map(async path => {
        try {
          const r = await readEndpoint(request, env, waitUntil, tok.accessToken, path, { page: 1, pageSize: 5, limit: 5 });
          return analyseBody(path, r.status, !!r.result.isError, r.body, r.removed);
        } catch {
          return { path, outcome: 'error' as const, status: 500, hidden: [], sensitive: [] };
        }
      })));
    }
  } finally {
    await revokeToken(env, tok.tokenId, null);
  }
  if (offset === 0) await audit(env, { ...actorOf(session), action: 'ai_connector.leak_check', entityTable: 'users', entityId: userId, after: { endpoints: paths.length } });
  return json({ person: u.full_name, total: paths.length, offset, next: offset + page.length, done: offset + page.length >= paths.length, rows });
};
