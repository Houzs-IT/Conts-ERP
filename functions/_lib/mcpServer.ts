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
 * Actions (owner, 26 Nov 2026, "confirm first, then do"): propose_meeting / propose_email prepare a booking or an email
 * and return a summary; confirm_action, after the person said yes, does it once through the ERP's own Meetings and Mail
 * Center endpoints as the person. Everything else is read-only. See mcpActions.ts / mcpActionTools.ts for the fence.
 *
 * Reads are the person's OWN access by construction: a tool call re-enters the API in-process as a GET carrying
 * the person's token and this isolate's secret (mcpDispatch.ts). The session middleware accepts a connector token only
 * that way and only for GET/HEAD, turns it into that person's session, and every handler then checks as usual.
 *
 * Quick answers (business_summary, reservations_summary, today_summary; functions/_lib/mcpQuick.ts) answer the commonest
 * questions in one call of a few hundred characters, from the same endpoints the Dashboard and Reservations list read,
 * through the same readValue as erp_get. search + fetch are the pair ChatGPT requires.
 *
 * Round 3 (owner, 26 Nov 2026; mcpMoreTools.ts): occupancy_summary, arrears_summary, owner_statement_summary,
 * attendance_today, daily_brief (+ the daily-brief prompt) and export_excel (.xlsx through the get_pdf signed link).
 * Rate limit per person on tools/call only: 30 a minute, 600 a day, counted from mcp_calls (limitVerdict); over it the
 * AI app gets a normal tool result with isError, never a 500. The admin leak check reads through readEndpoint, never
 * callTool, so it is not counted or limited.
 */
import { type Env } from './db';
import { MCP_INNER_HEADER, mcpInnerSecret } from './mcpInner';
import { classifyPath, moduleCatalog, readablePaths, redactSecrets, type RouteInfo } from './mcpAccess';
import { logCall, type McpIdentity } from './mcpStore';
import { dispatchGet } from './mcpDispatch';
import { apiRoutes } from './apiRoutes.generated';
import { originOf } from './mcpDiscovery';
import { ACTION_TOOLS, runActionTool } from './mcpActionTools';
import { actionsEnabled, mcpActionsReady, recentCallCounts } from './mcpStore';
import { MORE_TOOLS, runMoreTool } from './mcpMoreTools';
import { RATE_LIMITED_STATUS, limitVerdict, todayStays } from './mcpMore';
import {
  FETCH_SPECS, PROMPTS, docTitle, findById, monthEnd, myToday, normaliseMonth, parseFetchId, pickFields, prevMonth, promptText,
  searchResults, summariseReservations, summariseBusiness, summariseToday, validRange,
} from './mcpQuick';

export { originOf };

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
/** erp_get's cap. Was 60k; quick answers and `fields` make most replies far smaller. */
export const MAX_RESULT_CHARS = 30_000;
const SERVER_INFO = { name: 'conts-erp', title: 'The Conts ERP', version: '1.3.0' };

/** The GET routes as list_modules and list_endpoints show them. */
export const mcpRouteInfo = (): RouteInfo[] => apiRoutes().map(r => ({ method: r.method, path: r.path }));

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS = `You are connected to The Conts ERP as the signed-in staff member. The Conts manages short-stay rental units for their owners: units and buildings, owners and their contracts, reservations from Airbnb, Booking.com and Agoda, guests, cleaning and maintenance jobs, owner statements and payouts, expenses and utility bills, pricing and reviews, HR for field staff; plus the Dream Crafter supply chain screens (sales orders, purchasing, stock, transport).
Everything is limited to what this person may see and do in the ERP. Never guess figures a call did not return.
READ-ONLY, with ONE exception, and only when management switched it on: propose_meeting / propose_email prepare a meeting or an email and return a summary and a confirmationId. Show the person that summary word for word and ask them to confirm; call confirm_action ONLY after they explicitly say yes in this conversation. Never confirm on your own, never for anything they did not ask for. Nothing else can be changed: no orders, money, stock, approvals or deletes.
Document chains: document_flow {number_or_id} (a reservation's invoice, receipts, payments, owner and owner statement). PDFs: get_pdf {type, id}.
ANSWER FAST: use a quick answer first. It is one call and already summarised:
- Occupancy, reservation income, average nightly price, earnings per available night, income per unit, owner payout estimate, split by channel, against last month: business_summary {month: "YYYY-MM"} (default this month).
- Reservations for a period (how many, nights, guest total, fees, expected payout, still owed, by channel and status, direct guests still owing, host payouts outstanding): reservations_summary {from, to} (default this month).
- Today (check-ins and checkouts with guest names, cleaning pending, open repairs, unread guest messages, what needs someone now): today_summary.
- A reservation by reference, or a guest, unit, building, owner, job or bill by name or phone: search {query}, then fetch {id} for the full record.
- "What do I need to look at today?": daily_brief.
- Occupancy by building and unit: occupancy_summary {month}. Money owed to us (guests, customers): arrears_summary. Owner statements for a month: owner_statement_summary {month}. What we owe suppliers and contractors: payables_summary. Who is on leave or not in today (HR only): attendance_today.
- A list as an Excel file: export_excel {list, filters, from, to, fields}; give the person the link it returns.
Only when no quick answer fits: list_modules, then list_endpoints for a module, then erp_get. With erp_get pass "fields" (only the keys you need) and query parameters (from / to dates, page / pageSize, q or search, status) to keep replies small.
Quick answers give money in RM. In erp_get replies money is in sen (RM x 100) where a field ends in Sen or is an amount. Dates are YYYY-MM-DD, Malaysia time.
If a call says "not available to your role" or names a missing access, tell the person their account does not have access to that data.`;

const RO = { readOnlyHint: true, openWorldHint: false };
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const TOOLS = [
  {
    name: 'business_summary', title: 'Business summary (quick answer)',
    description: "A month's occupancy, reservation income, average nightly price, earnings per available night, income per unit and owner payout estimate in ONE call, against the month before, with the split by channel. Same figures as the Dashboard.",
    inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM. Default: this month.' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'reservations_summary', title: 'Reservations summary (quick answer)',
    description: 'Reservations whose stay touches a date range in ONE call: count, nights, guest total, service fees, expected payout and still owed (RM), by channel, status and tab, plus direct guests still owing and host payouts outstanding. Same totals as the Reservations list. Default: this month.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD. Default: the 1st of this month.' }, to: { type: 'string', description: 'YYYY-MM-DD. Default: the last day of this month.' } },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: 'today_summary', title: 'Today (quick answer)',
    description: "Today's check-ins and checkouts (counts and who: guest, unit, channel, link), cleaning pending, open maintenance jobs and unread guest messages, and the Dashboard's list of what needs someone now, in ONE call.",
    inputSchema: NO_ARGS, annotations: RO,
  },
  { name: 'whoami', title: 'Who am I connected as', description: 'The ERP account this connection uses.', inputSchema: NO_ARGS, annotations: RO },
  { name: 'list_modules', title: 'List ERP modules', description: 'The ERP modules (API path prefixes) with how many read endpoints each has. Use when no quick answer fits.', inputSchema: NO_ARGS, annotations: RO },
  {
    name: 'list_endpoints', title: 'List read endpoints',
    description: 'Every readable GET address under a module prefix (e.g. /api/reservations), with :id style placeholders.',
    inputSchema: { type: 'object', properties: { prefix: { type: 'string', description: 'Module prefix from list_modules' } }, required: ['prefix'], additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'erp_get', title: 'Read from the ERP',
    description: 'Read one ERP API address as the signed-in person (GET only) and return its JSON. Try a quick answer first. Large replies are cut; pass "fields" and narrow them with query parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'API path without query string, with real ids in place of :id, e.g. /api/reservations' },
        query: { type: 'object', description: 'Query parameters, e.g. {"from":"2026-11-01","to":"2026-11-30"}', additionalProperties: { type: ['string', 'number', 'boolean'] } },
        fields: { type: 'array', items: { type: 'string' }, description: 'Only keep these keys (at any depth), e.g. ["externalRef","checkIn","checkOut","state"]. Makes big replies small and fast.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: RO,
  },
  ...MORE_TOOLS,
  ...ACTION_TOOLS,
  {
    name: 'search', title: 'Search the ERP',
    description: 'Find reservations (by reference, guest name or phone), guests, units, buildings, owners, maintenance and cleaning jobs, expenses and utility bills, and supply chain records, by number or name. Returns ids to open with fetch.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'a reservation reference, guest, unit, building, owner or supplier name, or a phone number' } }, required: ['query'], additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'fetch', title: 'Open a search result',
    description: 'The full record for an id returned by search (e.g. "reservation:abc123"): a reservation with its money, a guest, a unit, an owner, a job, a bill.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'An id from search' } }, required: ['id'], additionalProperties: false },
    annotations: RO,
  },
];

/** Tool names and titles, for the admin page's list. */
export const MCP_TOOL_NAMES = TOOLS.map(t => ({ name: t.name, title: t.title }));

export interface ReadResult { result: ToolResult; status: number; note: string; target: string; body: unknown; removed: string[] }

type ReadValue =
  | { ok: true; status: number; value: unknown; removed: string[]; target: string }
  | { ok: false; status: number; message: string; note: string; target: string };

/** Reads one endpoint as the person behind `token`: the path gate, the in-process GET (the middleware and the handler
 *  decide access, as for their browser), then credential fields stripped. Every read goes through here: erp_get, the
 *  quick answers, search and fetch. */
async function readValue(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void, token: string, rawPath: string, query: Record<string, unknown> | undefined): Promise<ReadValue> {
  const d = classifyPath(rawPath);
  if (!d.ok) return { ok: false, status: 400, message: d.reason, note: 'blocked path', target: String(rawPath ?? '').slice(0, 300) };
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
    return { ok: false, status: res.status, message: `Not available to your role: your ERP account does not have access to this.${why}`, note: 'no access', target };
  }
  if (!ctype.includes('json')) {
    return { ok: false, status: res.status, message: `This endpoint returns a file (${ctype.split(';')[0] || 'unknown type'}), not data. Open it in the ERP instead.`, note: 'not data', target };
  }
  if (res.status >= 400) {
    const msg = typeof message === 'string' ? message : `the request failed (${res.status})`;
    return { ok: false, status: res.status, message: `The ERP answered: ${msg}`, note: msg.slice(0, 120), target };
  }
  const { value, removed } = redactSecrets(body);
  return { ok: true, status: res.status, value, removed: [...removed], target };
}

/** erp_get: one endpoint as JSON text, only `fields` when given, cut at MAX_RESULT_CHARS. Shared with the leak check
 *  (api/ai-connector/admin/leak-check). */
export async function readEndpoint(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void, token: string, rawPath: string, query: Record<string, unknown> | undefined, fields: string[] = []): Promise<ReadResult> {
  const r = await readValue(request, env, waitUntil, token, rawPath, query);
  if (!r.ok) return { result: text(r.message, true), status: r.status, note: r.note, target: r.target, body: null, removed: [] };
  let out = JSON.stringify(pickFields(r.value, fields));
  const cut = out.length > MAX_RESULT_CHARS;
  if (cut) out = out.slice(0, MAX_RESULT_CHARS);
  const notes: string[] = [];
  if (r.removed.length) notes.push(`Credential fields removed: ${r.removed.join(', ')}.`);
  if (cut) notes.push(`Reply cut at ${MAX_RESULT_CHARS} characters. Pass "fields" and narrow it with query parameters (dates, page / pageSize, search), or use a quick answer.`);
  return { result: text((notes.length ? `${notes.join(' ')}\n` : '') + out), status: r.status, note: cut ? 'cut' : '', target: r.target, body: r.value, removed: r.removed };
}

/** A quick answer: the summary as JSON, or the first refusal / error among the reads it cannot do without. */
function quickResult(summary: () => unknown, needed: ReadValue[]): { result: ToolResult; status: number; note: string } {
  const failed = needed.find(x => !x.ok);
  if (failed && !failed.ok) return { result: text(failed.message, true), status: failed.status, note: failed.note };
  return { result: text(JSON.stringify(summary())), status: 200, note: '' };
}

/** Tool calls already made in this request (a JSON-RPC batch), per identity object (one per request). */
const calledInRequest = new WeakMap<McpIdentity, number>();

async function callTool(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void, id: McpIdentity, token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const t0 = Date.now();
  let status = 200, note = '', target = '';
  let result: ToolResult;
  const read = (path: string, q?: Record<string, unknown>) => readValue(request, env, waitUntil, token, path, q);
  try {
    const ctx = { request, env, waitUntil, id, token, origin: originOf(request), read };
    // Counts read at the door with the token (one query), plus the calls this same request already made (a batch);
    // without them, one count query. A failed count lets the call through: the limit never breaks a lookup.
    const base = id.recent ?? await recentCallCounts(env, id.user.id).catch(() => ({ minute: 0, day: 0 }));
    const over = limitVerdict({ minute: base.minute + (calledInRequest.get(id) ?? 0), day: base.day + (calledInRequest.get(id) ?? 0) });
    calledInRequest.set(id, (calledInRequest.get(id) ?? 0) + 1);
    const acted = over ? null : (await runMoreTool(name, args, ctx)) ?? (await runActionTool(name, args, ctx));
    if (over) {
      result = text(over, true);
      status = RATE_LIMITED_STATUS;
      note = over.startsWith('Daily') ? 'daily limit' : 'rate limited';
    } else if (acted) {
      ({ result, status, note, target } = acted);
    } else if (name === 'whoami') {
      const actions = (await mcpActionsReady(env)) && (await actionsEnabled(env));
      result = text(JSON.stringify({ name: id.user.fullName, email: id.user.email, readOnly: !actions, actions: actions ? 'meetings and email, each confirmed by you first' : 'off' }));
    } else if (name === 'list_modules') {
      result = text(JSON.stringify({ readOnly: true, modules: moduleCatalog(mcpRouteInfo()), tip: 'Try a quick answer first (business_summary, reservations_summary, today_summary, occupancy_summary, arrears_summary, owner_statement_summary, attendance_today, payables_summary, daily_brief, search). Else call list_endpoints with a prefix, then erp_get with "fields". A module your account cannot open answers "not available to your role".' }));
    } else if (name === 'list_endpoints') {
      const prefix = String(args.prefix ?? '');
      target = prefix.slice(0, 300);
      const d = classifyPath(prefix);
      if (!d.ok) { result = text(d.reason, true); status = 400; }
      else result = text(JSON.stringify({ prefix: d.path, endpoints: readablePaths(mcpRouteInfo(), d.path).slice(0, 300) }));
    } else if (name === 'erp_get') {
      const fields = Array.isArray(args.fields) ? (args.fields as unknown[]).map(String).filter(Boolean).slice(0, 40) : [];
      const r = await readEndpoint(request, env, waitUntil, token, String(args.path ?? ''), args.query as Record<string, unknown> | undefined, fields);
      ({ result, status, note, target } = r);
    } else if (name === 'business_summary') {
      const today = myToday();
      const month = normaliseMonth(args.month, today);
      target = `business:${month}`;
      const [cur, prev, ch] = await Promise.all([
        read('/api/dashboard/kpis', { period: month }), read('/api/dashboard/kpis', { period: prevMonth(month) }), read('/api/dashboard/channels', { period: month }),
      ]);
      // Only the month itself must open; the comparison and the channel split are extras.
      ({ result, status, note } = quickResult(() => summariseBusiness(month, today, cur.ok ? cur.value : null, prev.ok ? prev.value : null, ch.ok ? ch.value : null), [cur]));
    } else if (name === 'reservations_summary') {
      const today = myToday();
      const range = validRange(args.from ?? `${today.slice(0, 7)}-01`, args.to ?? monthEnd(today.slice(0, 7)));
      if (!range) { result = text('Give from and to as YYYY-MM-DD (from on or before to, at most 400 days).', true); status = 400; }
      else {
        target = `reservations:${range.from}..${range.to}`;
        // The Reservations list's totals, counts and to-do cards cover the whole filtered set; size 25 is its smallest page.
        const r = await read('/api/reservations', { view: 'all', from: range.from, to: range.to, size: 25 });
        ({ result, status, note } = quickResult(() => summariseReservations(range, r.ok ? r.value : null), [r]));
      }
    } else if (name === 'today_summary') {
      target = 'today';
      // The counts, what needs someone, and who arrives and leaves today (the Reservations list's to-do cards), together.
      const [t, ex, inn, out] = await Promise.all([
        read('/api/dashboard/today'), read('/api/dashboard/exceptions'),
        read('/api/reservations', { todo: 'arriving', size: 25 }), read('/api/reservations', { todo: 'departing', size: 25 }),
      ]);
      ({ result, status, note } = quickResult(() => ({
        ...summariseToday(t.ok ? t.value : null, ex.ok ? ex.value : null),
        ...(inn.ok ? { checkInsToday: todayStays(originOf(request), inn.value) } : {}),
        ...(out.ok ? { checkOutsToday: todayStays(originOf(request), out.value) } : {}),
      }), [t]));
    } else if (name === 'search') {
      const q = String(args.query ?? args.q ?? '').trim().slice(0, 60);
      target = `search:${q}`;
      if (!q) { result = text('Give something to search for: a reservation reference, a name or a phone number.', true); status = 400; }
      else {
        const r = await read('/api/search', { q });
        if (!r.ok) { result = text(r.message, true); status = r.status; note = r.note; }
        else {
          const { results, partial } = searchResults(r.value, originOf(request));
          if (partial) note = 'supply chain search incomplete';
          result = text(JSON.stringify({ results }));
        }
      }
    } else if (name === 'fetch') {
      const f = parseFetchId(args.id);
      target = `fetch:${String(args.id ?? '').slice(0, 200)}`;
      const spec = f ? FETCH_SPECS[f.kind] : undefined;
      if (!f) { result = text('Give an id from search, e.g. reservation:abc123.', true); status = 400; }
      else if (!spec) { result = text(`A ${f.kind.replace(/_/g, ' ')} is a supply chain record: open it with the link search gave.`, true); status = 400; }
      else {
        const r = await read(spec.path(f.rowId), spec.query?.(f.rowId));
        const doc = r.ok ? (spec.pick ? findById(r.value, f.rowId) : r.value) : null;
        if (!r.ok) { result = text(r.message, true); status = r.status; note = r.note; }
        else if (!doc) { result = text('That record was not found, or your account cannot see it.', true); status = 404; }
        else {
          let body = JSON.stringify(doc);
          if (body.length > MAX_RESULT_CHARS) body = body.slice(0, MAX_RESULT_CHARS);
          result = text(JSON.stringify({
            id: `${f.kind}:${f.rowId}`, title: docTitle(f.kind, doc), text: body, url: originOf(request) + spec.page(f.rowId),
            metadata: { kind: f.kind, source: r.target, credentialFieldsRemoved: r.removed },
          }));
        }
      }
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
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': return reply(await callTool(request, env, waitUntil, id, token, String(m.params?.name ?? ''), (m.params?.arguments as Record<string, unknown> | undefined) ?? {}));
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: PROMPTS });
    case 'prompts/get': {
      const pname = String(m.params?.name ?? '');
      const ptext = promptText(pname, (m.params?.arguments as Record<string, unknown> | undefined) ?? {});
      if (ptext === null) return { jsonrpc: '2.0', id: m.id ?? null, error: { code: -32602, message: `Unknown prompt: ${pname}` } };
      return reply({ description: PROMPTS.find(x => x.name === pname)?.description ?? '', messages: [{ role: 'user', content: { type: 'text', text: ptext } }] });
    }
    default:
      if (m.id === undefined || m.id === null || (m.method ?? '').startsWith('notifications/')) return null;
      return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method ?? ''}` } };
  }
}
