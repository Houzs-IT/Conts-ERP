/**
 * The AI Connector (a remote MCP server), owner 25 Nov 2026: staff ask Claude or ChatGPT about the ERP with their own
 * login. Endpoints (functions/api/mcp, functions/.well-known, functions/api/ai-connector):
 *
 *   POST /api/mcp                    MCP Streamable HTTP, stateless JSON-RPC, Bearer ctmcp_...
 *   POST /api/mcp/oauth/register     OAuth dynamic client registration (public clients)
 *   GET  /api/mcp/oauth/authorize    -> the SPA's /ai-connect "Allow?" screen (api/ai-connector/consent)
 *   POST /api/mcp/oauth/token        authorization_code (PKCE S256) and refresh_token (rotating)
 *   GET  /.well-known/oauth-*        discovery, at the site root
 *
 * READ-ONLY and the person's OWN access by construction: a tool call re-enters the API in-process as a GET carrying
 * the person's token and this isolate's secret (mcpDispatch.ts). The session middleware accepts a connector token only
 * that way and only for GET/HEAD, turns it into that person's session, and every handler then checks as usual.
 */
import { type Env } from './db';
import { MCP_INNER_HEADER, mcpInnerSecret } from './mcpInner';
import { classifyPath, moduleCatalog, readablePaths, redactSecrets, type RouteInfo } from './mcpAccess';
import { logCall, type McpIdentity } from './mcpStore';
import { dispatchGet } from './mcpDispatch';
import { apiRoutes } from './apiRoutes.generated';
import { originOf } from './mcpDiscovery';

export { originOf };

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const MAX_RESULT_CHARS = 60_000;
const SERVER_INFO = { name: 'conts-erp', title: 'The Conts ERP', version: '1.0.0' };

/** The GET routes as list_modules and list_endpoints show them. */
export const mcpRouteInfo = (): RouteInfo[] => apiRoutes().map(r => ({ method: r.method, path: r.path }));

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS = `You are connected to The Conts ERP as the signed-in staff member. The Conts manages short-stay rental units for their owners: units and buildings, owners and their contracts, reservations from Airbnb, Booking.com and Agoda, guests, cleaning and maintenance jobs, owner statements and payouts, expenses and utility bills, pricing and reviews, HR for field staff; plus the Dream Crafter supply chain screens (sales orders, purchasing, stock, transport).
Everything is READ-ONLY and limited to what this person may see in the ERP. Never guess figures a call did not return.
Start with list_modules, then list_endpoints for a module, then erp_get. Money is in sen (RM x 100) where a field ends in Sen. Dates are YYYY-MM-DD, Malaysia time. Use query parameters (from / to dates, page / pageSize, q or search, status) to keep answers small.
If a call says "not available to your role" or names a missing access, tell the person their account does not have access to that data.`;

const RO = { readOnlyHint: true, openWorldHint: false };
const TOOLS = [
  { name: 'whoami', title: 'Who am I connected as', description: 'The ERP account this connection uses.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
  { name: 'list_modules', title: 'List ERP modules', description: 'The ERP modules (API path prefixes) with how many read endpoints each has. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
  {
    name: 'list_endpoints', title: 'List read endpoints',
    description: 'Every readable GET address under a module prefix (e.g. /api/reservations), with :id style placeholders.',
    inputSchema: { type: 'object', properties: { prefix: { type: 'string', description: 'Module prefix from list_modules' } }, required: ['prefix'], additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'erp_get', title: 'Read from the ERP',
    description: 'Read one ERP API address as the signed-in person (GET only) and return its JSON. Large replies are cut; narrow them with query parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'API path without query string, with real ids in place of :id, e.g. /api/reservations' },
        query: { type: 'object', description: 'Query parameters, e.g. {"from":"2026-11-01","to":"2026-11-30"}', additionalProperties: { type: ['string', 'number', 'boolean'] } },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: RO,
  },
];

export interface ReadResult { result: ToolResult; status: number; note: string; target: string; body: unknown; removed: string[] }

/** Reads one endpoint as the person behind `token`; shared with the leak check (api/ai-connector/admin/leak-check). */
export async function readEndpoint(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void, token: string, rawPath: string, query: Record<string, unknown> | undefined): Promise<ReadResult> {
  const d = classifyPath(rawPath);
  if (!d.ok) return { result: text(d.reason, true), status: 400, note: 'blocked path', target: String(rawPath ?? '').slice(0, 300), body: null, removed: [] };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query && typeof query === 'object' ? query : {})) {
    if (v === undefined || v === null || typeof v === 'object') continue;
    qs.set(k, String(v));
  }
  const target = d.path + (qs.toString() ? `?${qs}` : '');
  const res = await dispatchGet(new Request(originOf(request) + target, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, [MCP_INNER_HEADER]: mcpInnerSecret(), accept: 'application/json', 'user-agent': 'Conts AI Connector' },
  }), env, waitUntil);
  const ctype = res.headers.get('content-type') ?? '';
  const body = ctype.includes('json') ? await res.json().catch(() => null) : null;
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  if (res.status === 401 || res.status === 403) {
    const why = typeof message === 'string' ? ` The ERP says: ${message}` : '';
    return { result: text(`Not available to your role: your ERP account does not have access to this.${why}`, true), status: res.status, note: 'no access', target, body: null, removed: [] };
  }
  if (!ctype.includes('json')) {
    return { result: text(`This endpoint returns a file (${ctype.split(';')[0] || 'unknown type'}), not data. Open it in the ERP instead.`, true), status: res.status, note: 'not data', target, body: null, removed: [] };
  }
  if (res.status >= 400) {
    const msg = typeof message === 'string' ? message : `the request failed (${res.status})`;
    return { result: text(`The ERP answered: ${msg}`, true), status: res.status, note: msg.slice(0, 120), target, body: null, removed: [] };
  }
  const { value, removed } = redactSecrets(body);
  let out = JSON.stringify(value);
  const cut = out.length > MAX_RESULT_CHARS;
  if (cut) out = out.slice(0, MAX_RESULT_CHARS);
  const notes: string[] = [];
  if (removed.size) notes.push(`Credential fields removed: ${[...removed].join(', ')}.`);
  if (cut) notes.push(`Reply cut at ${MAX_RESULT_CHARS} characters. Narrow it with query parameters (dates, page / pageSize, search).`);
  return { result: text((notes.length ? `${notes.join(' ')}\n` : '') + out), status: res.status, note: cut ? 'cut' : '', target, body: value, removed: [...removed] };
}

async function callTool(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void, id: McpIdentity, token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const t0 = Date.now();
  let status = 200, note = '', target = '';
  let result: ToolResult;
  try {
    if (name === 'whoami') {
      result = text(JSON.stringify({ name: id.user.fullName, email: id.user.email, readOnly: true }));
    } else if (name === 'list_modules') {
      result = text(JSON.stringify({ readOnly: true, modules: moduleCatalog(mcpRouteInfo()), tip: 'Call list_endpoints with a prefix, then erp_get. A module your account cannot open answers "not available to your role".' }));
    } else if (name === 'list_endpoints') {
      const prefix = String(args.prefix ?? '');
      target = prefix.slice(0, 300);
      const d = classifyPath(prefix);
      if (!d.ok) { result = text(d.reason, true); status = 400; }
      else result = text(JSON.stringify({ prefix: d.path, endpoints: readablePaths(mcpRouteInfo(), d.path).slice(0, 300) }));
    } else if (name === 'erp_get') {
      const r = await readEndpoint(request, env, waitUntil, token, String(args.path ?? ''), args.query as Record<string, unknown> | undefined);
      ({ result, status, note, target } = r);
    } else {
      result = text(`Unknown tool: ${name}`, true);
      status = 400;
    }
  } catch (e) {
    console.error('AI Connector tool failed', name, e);
    result = text('That lookup failed on the ERP side. Try again, or narrow the question.', true);
    status = 500;
  }
  waitUntil(logCall(env, { tokenId: id.tokenId, userId: id.user.id, clientId: id.clientId, tool: name, target, status, ok: !result.isError, note, ms: Date.now() - t0 }));
  return result;
}

export interface RpcReq { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

/** One JSON-RPC message; null for a notification (no reply). */
export async function handleRpc(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void, id: McpIdentity, token: string, m: RpcReq): Promise<unknown> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: m?.id ?? null, result });
  if (!m || typeof m !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '');
      const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': return reply(await callTool(request, env, waitUntil, id, token, String(m.params?.name ?? ''), (m.params?.arguments as Record<string, unknown> | undefined) ?? {}));
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default:
      if (m.id === undefined || m.id === null || (m.method ?? '').startsWith('notifications/')) return null;
      return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method ?? ''}` } };
  }
}
