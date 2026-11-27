/**
 * AI Connector round 4c, platform quality (owner, 26 Nov 2026). Pure, unit-tested in src/lib/mcpWrite.test.mjs.
 *
 *   P1 role-aware tools/list   TOOL_NEEDS: the endpoints each read tool reads. A tool is listed only when the person
 *                              passes the session middleware's own module gate (access.ts accessFor + refusalFor, the
 *                              level on Users and roles > Permissions) for those endpoints: no connector-only rule.
 *                              Action tools: listed only while their switches are on (and, for the write actions, the
 *                              person may make that write). A hidden tool called directly still answers "no access".
 *   P3 structured output       STRUCTURED_TOOLS (the quick answers) carry an open `outputSchema` in tools/list, and
 *                              their results `structuredContent` (the same JSON as the text, which stays).
 *   P4 cache                   AnswerCache: a successful heavy summary is reused for 60 s per person + role + tool +
 *                              arguments (in this isolate's memory only).
 *   P5 links + RM              withLinksAndRm: a top-level `erpLink` (the ERP page the answer comes from), a `url` on any
 *                              row that names a record but has no link, and any `...Sen` money key left turned into
 *                              `...Rm` (a figure the ERP hid stays null, never 0).
 */

type Obj = Record<string, unknown>;

/** all: every endpoint must be readable; any: at least one. A tool with no entry is always listed. */
export type ToolNeed = { all?: string[]; any?: string[] };

export const TOOL_NEEDS: Record<string, ToolNeed> = {
  business_summary: { all: ['/api/dashboard/kpis'] },
  reservations_summary: { all: ['/api/reservations'] },
  today_summary: { all: ['/api/dashboard/today'] },
  occupancy_summary: { all: ['/api/portfolio/performance'] },
  arrears_summary: { any: ['/api/reservations', '/api/sales-invoices'] },
  owner_statement_summary: { all: ['/api/statements'] },
  payables_summary: { any: ['/api/purchase-invoices', '/api/finance/payables'] },
  attendance_today: { all: ['/api/attendance'] },
  unit_overview: { any: ['/api/units/detail', '/api/lettings', '/api/reservations'] },
  leases_expiring: { any: ['/api/contracts', '/api/lettings'] },
  revenue_summary: { any: ['/api/portfolio/performance', '/api/dashboard/kpis'] },
  housekeeping_today: { any: ['/api/tasks', '/api/maintenance/issues', '/api/dashboard/today'] },
  booking_pace: { all: ['/api/reservations'] },
  channel_mix: { any: ['/api/reservations', '/api/dashboard/channels'] },
  cancellations_summary: { all: ['/api/reservations'] },
  reviews_summary: { all: ['/api/reviews'] },
  vacancy_summary: { all: ['/api/reservations/calendar'] },
  company_report: { any: ['/api/dashboard/kpis', '/api/portfolio/performance', '/api/statements', '/api/reservations', '/api/analytics', '/api/sales-invoices', '/api/purchase-invoices'] },
  document_flow: { any: ['/api/reservations', '/api/statements'] },
  get_pdf: { any: ['/api/statements', '/api/guest-documents'] },
};

/** Whether a read tool is usable by someone whose GET gate answers `canRead(path)`. */
export async function readToolAllowed(name: string, canRead: (path: string) => Promise<boolean>): Promise<boolean> {
  const need = TOOL_NEEDS[name];
  if (!need) return true;
  for (const p of need.all ?? []) if (!(await canRead(p))) return false;
  if (need.any?.length) {
    for (const p of need.any) if (await canRead(p)) return true;
    return false;
  }
  return true;
}

/** "no access" for a hidden tool called directly, naming what it reads. */
export function noAccessText(name: string): string {
  const need = TOOL_NEEDS[name];
  const paths = [...(need?.all ?? []), ...(need?.any ?? [])].map(p => p.replace(/^\/api\//, '').split('/')[0].replace(/-/g, ' '));
  return `Not available to your role: your ERP account does not have access to what ${name} reads${paths.length ? ` (${[...new Set(paths)].join(', ')})` : ''}.`;
}

/* ---------- P3: structured output ---------- */

export const STRUCTURED_TOOLS = new Set([
  'business_summary', 'reservations_summary', 'today_summary', 'occupancy_summary', 'arrears_summary', 'owner_statement_summary',
  'payables_summary', 'attendance_today', 'daily_brief', 'unit_overview', 'leases_expiring', 'revenue_summary', 'housekeeping_today',
  'booking_pace', 'channel_mix', 'cancellations_summary', 'reviews_summary', 'vacancy_summary', 'company_report', 'data_gaps',
]);

/** Open on purpose: each summary has its own fields, and fields drop out for roles the ERP hides them from. */
export const QUICK_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    erpLink: { type: 'string', description: 'The ERP page this answer comes from' },
    notIncluded: { type: 'array', items: { type: 'string' }, description: 'Parts the account has no access to, or that could not be read' },
  },
  additionalProperties: true,
} as const;

/** The JSON object a quick answer's text carries, or null (an error text, or a reply cut at the size cap). */
export function parseQuickText(t: string): Obj | null {
  try {
    const v = JSON.parse(t) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null;
  } catch {
    return null;
  }
}

/* ---------- P5: links + RM ---------- */

/** The ERP page each quick answer comes from. */
export const TOOL_PAGES: Record<string, string> = {
  business_summary: '/', reservations_summary: '/reservations/bookings', today_summary: '/operations/today', occupancy_summary: '/portfolio',
  arrears_summary: '/reservations/bookings', owner_statement_summary: '/finance/statements', payables_summary: '/finance/payables',
  attendance_today: '/hr/employees', daily_brief: '/', unit_overview: '/properties/units', leases_expiring: '/owners/contracts',
  revenue_summary: '/portfolio', housekeeping_today: '/operations/cleaning', booking_pace: '/reservations/bookings', channel_mix: '/reservations/bookings',
  cancellations_summary: '/reservations/bookings', reviews_summary: '/performance/reviews', vacancy_summary: '/reservations/calendar',
  company_report: '/portfolio', data_gaps: '/properties/units',
};

const e = encodeURIComponent;
/** A row's record id key -> its ERP page (the same pages search / fetch link to, mcpQuick.ts FETCH_SPECS). */
const ID_PAGES: [string, (id: string) => string][] = [
  ['reservationId', id => `/reservations/bookings?view=all&open=${e(id)}`],
  ['unitId', id => `/properties/units/${e(id)}`],
  ['ownerId', id => `/owners/${e(id)}`],
  ['statementId', id => `/finance/statements/${e(id)}/report`],
  ['guestId', id => `/reservations/guests?g=${e(id)}`],
  ['taskId', id => `/operations/cleaning?task=${e(id)}`],
  ['issueId', id => `/operations/maintenance?id=${e(id)}`],
  ['threadId', () => '/mail'],
];
const LINK_KEYS = ['url', 'link', 'erpLink', 'href', 'target'];
const hasLink = (o: Obj) => LINK_KEYS.some(k => typeof o[k] === 'string' && (o[k] as string).length > 0);

/** P5 over one answer (see the file header). */
export function withLinksAndRm(tool: string, value: Obj, origin: string): Obj {
  const walk = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map(x => walk(x, false));
    if (!v || typeof v !== 'object') return v;
    const o = v as Obj;
    const out: Obj = {};
    for (const [k, x] of Object.entries(o)) {
      if (/[a-z]Sen$/.test(k) && (typeof x === 'number' || x === null)) {
        const rk = k.replace(/Sen$/, 'Rm');
        if (!(rk in o)) out[rk] = x === null ? null : Math.round(x) / 100;
        continue;
      }
      out[k] = walk(x, false);
    }
    if (!top && !hasLink(o)) {
      for (const [key, page] of ID_PAGES) {
        const id = o[key];
        if (typeof id === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(id)) { out.url = origin + page(id); break; }
      }
    }
    return out;
  };
  const out = walk(value, true) as Obj;
  if (!hasLink(out) && TOOL_PAGES[tool]) out.erpLink = origin + TOOL_PAGES[tool];
  return out;
}

/* ---------- P4: cache ---------- */

export const ANSWER_CACHE_TTL_MS = 60_000;
export const ANSWER_CACHE_MAX = 300;

/** The heavy summaries whose successful answers may be reused for a minute (several reads each, or paging). Live
 *  operational answers (today, housekeeping, attendance, one unit) are always read fresh. */
export const CACHEABLE_TOOLS = new Set([
  'business_summary', 'reservations_summary', 'occupancy_summary', 'arrears_summary', 'owner_statement_summary', 'payables_summary',
  'daily_brief', 'revenue_summary', 'booking_pace', 'channel_mix', 'cancellations_summary', 'reviews_summary', 'vacancy_summary',
  'company_report', 'data_gaps', 'leases_expiring',
]);

/** Stable JSON (keys sorted at every depth), so {a,b} and {b,a} share an entry. */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as Obj).sort().map(k => `${JSON.stringify(k)}:${stable((v as Obj)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};

/** The cache key: person + role + tool + arguments. Null for a tool that is not cached. */
export function cacheKey(userId: string, role: string, tool: string, args: Obj): string | null {
  return CACHEABLE_TOOLS.has(tool) ? `${userId}|${role}|${tool}|${stable(args)}` : null;
}

/** A small TTL map (oldest dropped past ANSWER_CACHE_MAX). */
export class AnswerCache<T> {
  private m = new Map<string, { at: number; v: T }>();
  private ttl: number;
  private max: number;
  constructor(ttl = ANSWER_CACHE_TTL_MS, max = ANSWER_CACHE_MAX) { this.ttl = ttl; this.max = max; }
  get(k: string, now = Date.now()): T | null {
    const hit = this.m.get(k);
    if (!hit) return null;
    if (now - hit.at >= this.ttl) { this.m.delete(k); return null; }
    return hit.v;
  }
  set(k: string, v: T, now = Date.now()): void {
    this.m.delete(k);
    this.m.set(k, { at: now, v });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  get size(): number { return this.m.size; }
}
