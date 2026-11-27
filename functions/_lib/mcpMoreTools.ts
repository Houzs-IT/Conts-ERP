/**
 * AI Connector round 3 tools (owner, 26 Nov 2026): occupancy_summary, arrears_summary, owner_statement_summary,
 * attendance_today, daily_brief and export_excel. Called from mcpServer.ts callTool, which applies the rate limit and
 * logs every call in mcp_calls. The pure shaping is in mcpMore.ts, the workbook in mcpXlsx.ts.
 *
 * RBAC: every read is ctx.read, the same readValue as erp_get (path gate, in-process GET AS THE PERSON, credential
 * fields stripped), so a tool sees exactly what that person's ERP screens show, including each endpoint's own money
 * hiding. There are no connector-only rules here. A read the person's role is refused is named plainly ("Your account
 * does not have access to ...") and the rest of the answer still comes back. All reads of one tool run in parallel.
 */
import { mytToday } from './db';
import { EXPORT_PREFIX, EXPORT_TTL_MS, safeFileName, signExport } from './mcpActions';
import { normaliseMonth } from './mcpQuick';
import { randomToken } from './mcpStore';
import type { Outcome, ReadValue, ToolCtx } from './mcpActionTools';
import {
  EXPORT_LISTS, EXPORT_MAX_ROWS, addDays, buildBrief, cellValue, exportColumns, exportQuery, morePages, rowsOf,
  summariseArrears, summariseAttendance, summariseOccupancy, summarisePayables, summariseStatements,
} from './mcpMore';
import { buildXlsx, XLSX_TYPE } from './mcpXlsx';
import { summariseOwnerPayouts } from './mcpConts4';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const done = (body: unknown, target: string, note = ''): Outcome => ({ result: text(JSON.stringify(body)), status: 200, note, target });
const refuse = (msg: string, status: number, target: string, note = ''): Outcome => ({ result: text(msg, true), status, note: note || msg.slice(0, 120), target });

const refused = (r: ReadValue) => !r.ok && (r.status === 401 || r.status === 403);
/** "you don't have access to X" for a refused read, or the ERP's own error. */
const why = (what: string, r: ReadValue) => (r.ok ? '' : refused(r) ? `Your account does not have access to ${what}.` : `${what} could not be read: ${r.message}`);

/** A quick answer made of several reads: answers with what it could read, names what it could not; an error only
 *  when nothing at all could be read. */
function partial(target: string, parts: { what: string; r: ReadValue }[], body: () => Record<string, unknown>): Outcome {
  const failed = parts.filter(p => !p.r.ok);
  if (failed.length === parts.length) {
    const f = failed[0].r as Extract<ReadValue, { ok: false }>;
    return refuse(failed.map(p => why(p.what, p.r)).join(' '), f.status, target, f.note);
  }
  const out = body();
  if (failed.length) out.notIncluded = failed.map(p => why(p.what, p.r));
  return done(out, target, failed.length ? 'partial' : '');
}

async function occupancyTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const today = mytToday();
  const month = normaliseMonth(args.month, today);
  const target = `occupancy:${month}`;
  const [perf, kpis, inhouse] = await Promise.all([
    c.read('/api/portfolio/performance', { period: month }),
    c.read('/api/dashboard/kpis', { period: month }),
    // Only the counts are used; size 25 is the list's smallest page.
    c.read('/api/reservations', { view: 'inhouse', size: 25 }),
  ]);
  if (!perf.ok) return refuse(why('Portfolio (occupancy by unit)', perf), perf.status, target, perf.note);
  return partial(target, [{ what: 'Portfolio', r: perf }, { what: 'the Dashboard', r: kpis }, { what: 'Reservations', r: inhouse }],
    () => summariseOccupancy(month, today, perf.value, kpis.ok ? kpis.value : null, inhouse.ok ? inhouse.value : null));
}

async function arrearsTool(c: ToolCtx): Promise<Outcome> {
  const today = mytToday();
  const [guests, invoices] = await Promise.all([
    c.read('/api/reservations', { view: 'all', todo: 'unpaid', size: 100 }),
    c.read('/api/sales-invoices'),
  ]);
  return partial('arrears', [{ what: 'Reservations (guest balances)', r: guests }, { what: 'Sales invoices', r: invoices }],
    () => summariseArrears(today, c.origin, guests.ok ? guests.value : null, invoices.ok ? invoices.value : null));
}

async function statementsTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const m = String(args.month ?? '').trim();
  const owner = String(args.owner ?? '').trim().slice(0, 80);
  const q: Record<string, unknown> = { pageSize: 200 };
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) q.period = m;
  const target = `statements:${q.period ?? 'latest'}${owner ? `:${owner}` : ''}`;
  // One owner (round 4, C10): that owner's statements over the months and their payouts, beside the month's summary.
  const [r, os, op] = await Promise.all([
    c.read('/api/statements', q),
    owner ? c.read('/api/statements', { period: 'all', q: owner, pageSize: 24 }) : Promise.resolve(null),
    owner ? c.read('/api/payouts', { q: owner, pageSize: 24 }) : Promise.resolve(null),
  ]);
  if (!r.ok) return refuse(why('owner statements', r), r.status, target, r.note);
  if (!os || !op) return done(summariseStatements(c.origin, r.value), target);
  const out: Record<string, unknown> = { ...summariseStatements(c.origin, r.value), owner: summariseOwnerPayouts(c.origin, owner, os.ok ? os.value : null, op.ok ? op.value : null) };
  const missing = [{ what: "that owner's statements", r: os }, { what: 'Owner payouts', r: op }].filter(x => !x.r.ok).map(x => why(x.what, x.r));
  if (missing.length) out.notIncluded = missing;
  return done(out, target, missing.length ? 'partial' : '');
}

async function payablesTool(c: ToolCtx): Promise<Outcome> {
  const today = mytToday();
  const [invoices, claims] = await Promise.all([c.read('/api/purchase-invoices'), c.read('/api/finance/payables', { paid: 'no' })]);
  return partial('payables', [{ what: 'Purchase invoices (suppliers)', r: invoices }, { what: 'Accounts payable (contractor claims)', r: claims }],
    () => summarisePayables(today, c.origin, invoices.ok ? invoices.value : null, claims.ok ? claims.value : null));
}

async function attendanceTool(c: ToolCtx): Promise<Outcome> {
  const today = mytToday();
  const [att, leaves] = await Promise.all([c.read('/api/attendance', { date: today }), c.read('/api/leaves', { year: today.slice(0, 4) })]);
  if (!att.ok) {
    const msg = refused(att) ? 'Your account does not have access to attendance (HR). Ask HR or management.' : why('Attendance', att);
    return refuse(msg, att.status, 'attendance', att.note);
  }
  return partial('attendance', [{ what: 'Attendance', r: att }, { what: 'Leave', r: leaves }],
    () => summariseAttendance(today, att.value, leaves.ok ? leaves.value : null));
}

async function briefTool(c: ToolCtx): Promise<Outcome> {
  const today = mytToday();
  const reads = {
    badges: c.read('/api/nav/badges'),
    tasks: c.read('/api/tasks', { state: 'active', assignee: `u:${c.id.user.id}`, to: addDays(today, 3), sort: 'day:asc', size: 50 }),
    approvals: c.read('/api/approvals', { view: 'pending', pageSize: 50 }),
    salesOrders: c.read('/api/sales-orders'),
    purchaseOrders: c.read('/api/purchase-orders'),
    // The Maintenance screen's first view: open jobs only, its cheaper path.
    maintenance: c.read('/api/maintenance/issues', { view: 'open', limit: 200 }),
    // Mail Center's waiting-for-my-reply count, read server to server from the engine (round 4, C1).
    // list=1 (round 4b): the waiting threads too, each with its threadId for propose_mail_reply.
    mail: c.read('/api/supply-chain/mail-waiting', { list: '1' }),
  };
  const keys = Object.keys(reads) as (keyof typeof reads)[];
  const got = await Promise.all(keys.map(k => reads[k]));
  const v = Object.fromEntries(keys.map((k, i) => [k, got[i].ok ? (got[i] as Extract<ReadValue, { ok: true }>).value : null])) as Record<keyof typeof reads, unknown>;
  const NAMES: Record<string, string> = { badges: 'the menu counts', tasks: 'Tasks', approvals: 'Approvals', salesOrders: 'Sales orders', purchaseOrders: 'Purchase orders', maintenance: 'Maintenance', mail: 'Mail Center' };
  const noAccess = keys.filter((_k, i) => refused(got[i])).map(k => NAMES[k]);
  // Mail Center not set up on this system (501) is not a failure: the brief says it is not included.
  const failed = keys.filter((k, i) => !got[i].ok && !refused(got[i]) && !(k === 'mail' && got[i].status === 501)).map(k => NAMES[k]);
  const brief = buildBrief({ today, origin: c.origin, name: c.id.user.fullName, ...v, noAccess });
  return done(failed.length ? { ...brief, couldNotRead: failed } : brief, 'brief', failed.length ? `unread: ${failed.join(', ')}` : '');
}

/* ---------- export_excel ---------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function exportTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const name = String(args.list ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const l = EXPORT_LISTS[name];
  if (!l) return refuse(`Choose a list to export: ${Object.keys(EXPORT_LISTS).join(', ')}.`, 400, `export ${name.slice(0, 40)}`, 'unknown list');
  const filters = args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters) ? args.filters as Record<string, unknown> : {};
  if (typeof args.search === 'string' && args.search.trim()) {
    const key = l.filters.find(k => k === 'q' || k === 'search');
    if (key && filters[key] === undefined) filters[key] = args.search;
  }
  const from = YMD.test(String(args.from ?? '')) ? String(args.from) : undefined;
  const to = YMD.test(String(args.to ?? '')) ? String(args.to) : undefined;
  const fields = Array.isArray(args.fields) ? (args.fields as unknown[]).map(String).filter(Boolean).slice(0, 60) : [];
  const target = `export ${name}`;
  if (!c.env.MEDIA) return refuse('File storage is not set up on this system, so no download link can be made. Use the Export button on the list in the ERP.', 501, target);

  // As the person, up to EXPORT_MAX_ROWS rows. The first page says how many match; the rest are then read four at a
  // time. A list that gives no total is read page by page until a short page.
  const first = await c.read(l.path, exportQuery(l, filters, 1, from, to));
  if (!first.ok) return refuse(refused(first) ? `Your account does not have access to ${l.title}.` : first.message, first.status, target, first.note);
  const rows: Record<string, unknown>[] = rowsOf(first.value);
  const t0 = Number((first.value as { total?: unknown })?.total);
  const total: number | null = Number.isFinite(t0) && t0 >= 0 ? t0 : null;
  if (l.paging.kind !== 'none' && morePages(l, rows.length, rows.length, total)) {
    const per = l.paging.max;
    if (total !== null) {
      const last = Math.ceil(Math.min(total, EXPORT_MAX_ROWS) / per);
      for (let p = 2; p <= last; p += 4) {
        const batch = await Promise.all(Array.from({ length: Math.min(4, last - p + 1) }, (_, i) => c.read(l.path, exportQuery(l, filters, p + i, from, to))));
        for (const r of batch) if (r.ok) rows.push(...rowsOf(r.value));
        if (batch.some(r => !r.ok)) break;
      }
    } else {
      for (let page = 2; page <= 50; page++) {
        const r = await c.read(l.path, exportQuery(l, filters, page, from, to));
        if (!r.ok) break;
        const got = rowsOf(r.value);
        rows.push(...got);
        if (!morePages(l, got.length, rows.length, null)) break;
      }
    }
  }
  const truncated = rows.length > EXPORT_MAX_ROWS || (total !== null && total > EXPORT_MAX_ROWS);
  const kept = rows.slice(0, EXPORT_MAX_ROWS);
  const cols = exportColumns(l, kept, fields);
  const bytes = await buildXlsx(l.title, cols.map(x => ({ header: x.header, money: x.money })), kept.map(r => cols.map(x => cellValue(r[x.key], x.money))));
  const exp = Date.now() + EXPORT_TTL_MS;
  const file = safeFileName(`${l.title} ${mytToday()}`);
  const key = `${EXPORT_PREFIX}${mytToday()}/${randomToken(12)}/${file}.xlsx`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: XLSX_TYPE }, customMetadata: { userId: c.id.user.id, expiresAt: new Date(exp).toISOString() } });
  return done({
    url: `${c.origin}/api/mcp/export?${await signExport(c.env.SESSION_SECRET, key, exp)}`,
    fileName: `${file}.xlsx`, rows: kept.length, ...(total !== null ? { totalMatching: total } : {}), truncated,
    columns: cols.map(x => x.header), expiresAt: new Date(exp).toISOString(),
    how: `An Excel file of ${l.title.toLowerCase()} as your account sees them, money in RM. The link works for 15 minutes; give it to the person.${truncated ? ` Only the first ${EXPORT_MAX_ROWS} rows are in it: narrow the filters for the rest.` : ''}`,
  }, `${target}: ${kept.length} rows${truncated ? ' (truncated)' : ''}`, truncated ? 'truncated' : '');
}

/** One of the tools above, or null when `name` is not one of them. */
export async function runMoreTool(name: string, args: Record<string, unknown>, c: ToolCtx): Promise<Outcome | null> {
  switch (name) {
    case 'occupancy_summary': return occupancyTool(c, args);
    case 'arrears_summary': return arrearsTool(c);
    case 'owner_statement_summary': return statementsTool(c, args);
    case 'attendance_today': return attendanceTool(c);
    case 'payables_summary': return payablesTool(c);
    case 'daily_brief': return briefTool(c);
    case 'export_excel': return exportTool(c, args);
    default: return null;
  }
}

const RO = { readOnlyHint: true, openWorldHint: false };
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const MONTH_ARG = { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM. Default: this month.' } }, additionalProperties: false };

export const MORE_TOOLS = [
  {
    name: 'daily_brief', title: 'Daily brief (what needs me today)',
    description: 'What the signed-in person needs to look at today, in ONE call: their jobs overdue or due in 3 days, approvals waiting for them, sales orders to deliver and purchase orders expected (overdue or in 3 days), maintenance jobs due, Mail Center emails waiting for their reply, and the ERP bell\'s other waiting items. Each with a count, the first 5 and links. Only what their account can open.',
    inputSchema: NO_ARGS, annotations: RO,
  },
  {
    name: 'occupancy_summary', title: 'Occupancy (quick answer)',
    description: "Occupancy in ONE call: tonight by building (in house now against listed units) and the month (nights sold, occupancy % by building, the 5 lowest units, units blocked or needing cleaning). Default this month.",
    inputSchema: MONTH_ARG, annotations: RO,
  },
  {
    name: 'arrears_summary', title: 'Arrears (quick answer)',
    description: 'Who owes us money, in ONE call: direct guests with a balance (oldest first, aged 0-30 / 31-60 / 61-90 / 90+ days), host payouts the channels still owe, and Dream Crafter customer invoices open and overdue by age (RM). Tenant rent is not tracked as paid / unpaid in the ERP; the answer says so. Each part only when the account may see it.',
    inputSchema: NO_ARGS, annotations: RO,
  },
  {
    name: 'owner_statement_summary', title: 'Owner statements (quick answer)',
    description: "One month's owner statements in ONE call: how many are Draft, Final, Sent and Paid, which are waiting to be sent, still draft or sent, totals (guest total, operator share, expenses, net payout to owner in RM), the biggest, owners in the negative, and the last 6 months. Default: the latest month that has statements. With owner: also that owner's statements month by month and their payouts (paid, pending, failed, still to pay). Finance access only (the ERP decides).",
    inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM. Default: the latest month with statements.' }, owner: { type: 'string', description: "An owner's name (or part of it): adds that owner's statements and payouts." } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'payables_summary', title: 'What we owe (quick answer)',
    description: 'What we owe outside people, in ONE call: Dream Crafter supplier invoices unpaid, per supplier, aged 0-30 / 31-60 / 61-90 / 90+ days past due, and due this week; and maintenance contractor claims not yet paid. Finance access only (the ERP decides).',
    inputSchema: NO_ARGS, annotations: RO,
  },
  {
    name: 'attendance_today', title: 'Attendance today (quick answer)',
    description: "Today's attendance from HR: who is on leave, who has not clocked in, who is in, forgotten clock-outs, leave requests waiting and leave in the next 7 days. HR access only; others are told they do not have access.",
    inputSchema: NO_ARGS, annotations: RO,
  },
  {
    name: 'export_excel', title: 'Export a list to Excel',
    description: `An Excel (.xlsx) file of one ERP list as the person sees it, up to ${EXPORT_MAX_ROWS} rows, money in RM: a 15-minute download link, the row count, and "truncated" when there were more. Lists: ${Object.keys(EXPORT_LISTS).join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', enum: Object.keys(EXPORT_LISTS) },
        filters: { type: 'object', description: 'The list\'s own query filters, e.g. {"st":"confirmed","ch":"airbnb"} for reservations, {"status":"OVERDUE"} for sales_invoices, {"period":"2026-10"} for statements, {"month":"2026-10"} for expenses.', additionalProperties: { type: ['string', 'number', 'boolean'] } },
        search: { type: 'string', description: 'Free-text search, on lists that have one.' },
        from: { type: 'string', description: 'YYYY-MM-DD (reservations: stays touching the range; tasks: task day).' },
        to: { type: 'string', description: 'YYYY-MM-DD.' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Only these columns (row keys), in this order. Default: the list\'s usual columns.' },
      },
      required: ['list'], additionalProperties: false,
    },
    annotations: RO,
  },
];
