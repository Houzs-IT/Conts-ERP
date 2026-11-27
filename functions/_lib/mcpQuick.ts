/**
 * AI Connector quick answers (functions/_lib/mcpServer.ts business_summary, reservations_summary, today_summary), owner
 * 25 Nov 2026: searching through the connector felt slow. The AI walked list_modules -> list_endpoints -> erp_get and
 * then read replies of tens of thousands of characters. A quick answer is ONE tool call that reads the endpoints the
 * Dashboard and the Reservations list already read, as the person (so their access applies unchanged), and returns a few
 * hundred characters. Nothing here calls Channex, HostPlatform or any other outside service.
 *
 * Also the pure parts of search / fetch (the pair ChatGPT requires), erp_get's `fields`, and the ready-made prompts.
 * Pure, so it is unit-tested (src/lib/mcpQuick.test.mjs). Money arrives in sen and leaves as RM (2 dp).
 */

type Obj = Record<string, unknown>;

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);

/** Sen -> RM, 2 dp. */
export const rm = (sen: unknown): number => Math.round(num(sen)) / 100;

/** Percent change, 1 dp; null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Today in Malaysia (UTC+8) as YYYY-MM-DD. */
export function myToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** "YYYY-MM", defaulting to the current Malaysia month. */
export function normaliseMonth(raw: unknown, today: string): string {
  const s = String(raw ?? '').trim();
  return MONTH.test(s) ? s : today.slice(0, 7);
}

/** The month before "YYYY-MM". */
export function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The last day of "YYYY-MM". */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** A from/to range (YYYY-MM-DD, from <= to, at most 400 days), or null. */
export function validRange(from: unknown, to: unknown): { from: string; to: string } | null {
  const f = String(from ?? ''), t = String(to ?? '');
  if (!YMD.test(f) || !YMD.test(t) || f > t || Number.isNaN(Date.parse(f)) || Number.isNaN(Date.parse(t))) return null;
  if ((Date.parse(t) - Date.parse(f)) / 86_400_000 > 400) return null;
  return { from: f, to: t };
}

/* ---------- business_summary: /api/dashboard/kpis (month and the one before) + /api/dashboard/channels ---------- */

const KPI_NAMES: Record<string, string> = {
  accommodation_revenue: 'reservationIncomeRm', income_per_unit: 'incomePerUnitRm', adr: 'adrRm', revpar: 'revparRm', net_owner_payout: 'ownerPayoutEstimateRm',
};

/** The Dashboard's tiles as { occupancyPct, reservationIncomeRm, ... }; money tiles only when the reply carried them. */
export function kpiFigures(kpisReply: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of arr(obj(kpisReply).kpis)) {
    const key = String(k.key ?? '');
    if (key === 'occupancy') out.occupancyPct = num(k.value);
    else if (KPI_NAMES[key]) {
      out[KPI_NAMES[key]] = rm(k.value);
      if (key === 'income_per_unit' && k.units !== undefined) out.activeUnits = num(k.units);
    }
  }
  return out;
}

export function summariseBusiness(month: string, today: string, cur: unknown, prev: unknown, channels: unknown) {
  const now = kpiFigures(cur);
  const before = prev ? kpiFigures(prev) : null;
  const change: Record<string, number | null> = {};
  if (before) for (const [k, v] of Object.entries(now)) if (k in before && k !== 'activeUnits') change[k] = k === 'occupancyPct' ? Math.round((v - before[k]) * 10) / 10 : pctChange(v, before[k]);
  const inProgress = month === today.slice(0, 7);
  const money = 'reservationIncomeRm' in now;
  return {
    month,
    note: `Same figures as the Dashboard. Income = host payout after the channel's service fee, split by night into the month, rental units only (no rent to rent). Money in RM.${inProgress ? ` ${month} is in progress: it counts stays up to today (${today}); the previous month is the whole month.` : ''}${money ? '' : ' Money figures are not shown for this account.'}`,
    thisMonth: now,
    previousMonth: before ? { month: prevMonth(month), ...before } : null,
    // Occupancy change in percentage points; money changes in percent.
    change: before ? change : null,
    byChannel: arr(obj(channels).channels).map(c => ({ channel: String(c.label ?? c.key ?? ''), sharePct: num(c.share), incomeRm: rm(c.revenue) })),
  };
}

/* ---------- reservations_summary: /api/reservations?view=all&from=&to= (the Reservations list's own totals) ---------- */

const TODO_NAMES: Record<string, string> = {
  arriving: 'arrivingToday', departing: 'departingToday', unpaid: 'directGuestsStillOwing', payout: 'hostPayoutsOutstanding',
};

export function summariseReservations(range: { from: string; to: string }, reply: unknown) {
  const r = obj(reply);
  const t = obj(r.totals);
  const facets = obj(r.facets);
  const todos: Record<string, { count: number; owedRm: number }> = {};
  for (const [k, v] of Object.entries(obj(r.todos))) todos[TODO_NAMES[k] ?? k] = { count: num(obj(v).count), owedRm: rm(obj(v).outstanding) };
  return {
    from: range.from,
    to: range.to,
    note: 'Reservations whose stay touches the range (checkout after "from", check-in on or before "to"), as the Reservations list counts them; blocks and owner stays are left out. Money in RM. The to-do counts are across all reservations in the range.',
    reservations: num(t.bookings),
    nights: num(t.nights),
    guestTotalRm: rm(t.gross),
    serviceFeesRm: rm(t.fees),
    expectedPayoutRm: rm(t.payout),
    stillOwedRm: rm(t.outstanding),
    byTab: Object.fromEntries(Object.entries(obj(r.counts)).map(([k, v]) => [k, num(v)])),
    byChannel: arr(facets.ch).map(f => ({ channel: String(f.value ?? ''), reservations: num(f.count) })),
    byStatus: arr(facets.st).map(f => ({ status: String(f.value ?? ''), reservations: num(f.count) })),
    toDo: todos,
  };
}

/* ---------- today_summary: /api/dashboard/today + /api/dashboard/exceptions ---------- */

export function summariseToday(today: unknown, exceptions: unknown) {
  const t = obj(today);
  const counts: Record<string, number> = {};
  for (const row of arr(t.rows)) counts[String(row.key ?? '')] = num(row.count);
  return {
    date: String(t.date ?? ''),
    counts: {
      checkIns: counts.check_ins ?? 0,
      checkOuts: counts.check_outs ?? 0,
      cleaningPending: counts.cleaning_pending ?? 0,
      maintenanceOpen: counts.maintenance_open ?? 0,
      unreadGuestMessages: counts.escalations ?? 0,
    },
    // What needs a person, highest risk first (the Dashboard's list).
    needsAttention: arr(obj(exceptions).exceptions).slice(0, 12).map(e => ({
      level: String(e.tone ?? ''), title: String(e.title ?? ''), detail: String(e.detail ?? ''),
      ...(e.revenueAtRisk !== undefined && e.revenueAtRisk !== null ? { revenueAtRiskRm: rm(e.revenueAtRisk) } : {}),
    })),
  };
}

/* ---------- erp_get fields ---------- */

/** Keep only the named keys at every object level (rows stay rows). Empty list = unchanged. */
export function pickFields(v: unknown, fields: string[]): unknown {
  if (!fields.length) return v;
  const keep = new Set(fields);
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 20) return x;
    if (Array.isArray(x)) return x.map(y => walk(y, depth + 1));
    if (x && typeof x === 'object') {
      const out: Obj = {};
      for (const [k, val] of Object.entries(x as Obj)) {
        if (keep.has(k)) out[k] = val;
        else if (val && typeof val === 'object') {
          const inner = walk(val, depth + 1);
          if (inner && typeof inner === 'object' && (Array.isArray(inner) ? inner.some(i => i && typeof i === 'object' && Object.keys(i).length) : Object.keys(inner as Obj).length)) out[k] = inner;
        }
      }
      return out;
    }
    return x;
  };
  return walk(v, 0);
}

/* ---------- search / fetch (the shape ChatGPT requires) ----------
 * ChatGPT outside Developer Mode only accepts a connector with a `search` and a `fetch` tool, and deep research uses
 * only those two (https://developers.openai.com/api/docs/mcp): search returns {results:[{id,title,url}]}, fetch returns
 * one {id,title,text,url,metadata}. */

/** Search kind -> how fetch opens the record: its detail endpoint, or a list it is picked out of by id. Supply chain
 *  kinds (answered by the engine) have no entry: fetch points to their ERP link instead. */
const e = encodeURIComponent;
export const FETCH_SPECS: Record<string, { path: (id: string) => string; query?: (id: string) => Record<string, string>; pick?: boolean; page: (id: string) => string }> = {
  reservation: { path: id => `/api/reservations/${e(id)}`, page: id => `/reservations/bookings?view=all&open=${e(id)}` },
  guest: { path: id => `/api/guests/${e(id)}`, page: id => `/reservations/guests?g=${e(id)}` },
  unit: { path: () => '/api/units/detail', query: id => ({ unitId: id }), page: id => `/properties/units/${e(id)}` },
  owner: { path: () => '/api/owners', query: id => ({ id }), page: id => `/owners/${e(id)}` },
  cleaning: { path: id => `/api/housekeeping/tasks/${e(id)}`, page: id => `/operations/cleaning?task=${e(id)}` },
  expense: { path: id => `/api/expenses/${e(id)}`, page: () => '/finance/payables?view=list' },
  bill: { path: id => `/api/expenses/${e(id)}`, page: () => '/finance/payables?view=list' },
  maintenance: { path: () => '/api/maintenance/issues', pick: true, page: id => `/operations/maintenance?id=${e(id)}` },
  building: { path: () => '/api/properties', pick: true, page: () => '/properties/units' },
};

const KIND_TITLE: Record<string, string> = {
  unit: 'Unit', building: 'Building', reservation: 'Reservation', guest: 'Guest', owner: 'Owner', maintenance: 'Maintenance job',
  cleaning: 'Cleaning job', expense: 'Expense', bill: 'Utility bill',
};

export type SearchHit = { id: string; title: string; url: string };

/** /api/search's reply (an array of hits) -> ChatGPT results; id = "<kind>:<row id>". The engine's "could not search"
 *  notice is not a record and is left out (`partial` says so). */
export function searchResults(body: unknown, origin: string): { results: SearchHit[]; partial: boolean } {
  const out: SearchHit[] = [];
  let partial = false;
  for (const h of arr(body)) {
    const kind = String(h.kind ?? ''), rid = String(h.id ?? '');
    if (kind === 'notice') { partial = true; continue; }
    if (!kind || !rid) continue;
    const target = String(h.target ?? '');
    const sub = String(h.sub ?? '');
    const when = h.checkIn && h.checkOut ? `${String(h.checkIn)} to ${String(h.checkOut)}` : h.date ? String(h.date).slice(0, 10) : '';
    out.push({
      id: `${kind}:${rid}`,
      title: [`${KIND_TITLE[kind] ?? kind.replace(/_/g, ' ')}: ${String(h.label ?? rid)}`, sub, when, h.ref ? `ref ${String(h.ref)}` : ''].filter(Boolean).join(' · ').slice(0, 300),
      url: target.startsWith('/') ? origin + target : origin,
    });
  }
  return { results: out, partial };
}

/** "reservation:abc" -> { kind, rowId } (null for anything else). */
export function parseFetchId(raw: unknown): { kind: string; rowId: string } | null {
  const m = /^([a-z_]{2,40}):([A-Za-z0-9._-]{1,100})$/.exec(String(raw ?? '').trim());
  return m ? { kind: m[1], rowId: m[2] } : null;
}

/** The first object anywhere in `v` whose id is `id` (for kinds read from a list). */
export function findById(v: unknown, id: string, depth = 0): Obj | null {
  if (depth > 6) return null;
  if (Array.isArray(v)) {
    for (const x of v) { const hit = findById(x, id, depth + 1); if (hit) return hit; }
    return null;
  }
  if (v && typeof v === 'object') {
    const o = v as Obj;
    if (String(o.id ?? '') === id && depth > 0) return o;
    for (const x of Object.values(o)) if (x && typeof x === 'object') { const hit = findById(x, id, depth + 1); if (hit) return hit; }
  }
  return null;
}

/** A readable title for a fetched record. */
export function docTitle(kind: string, doc: unknown): string {
  const d = obj(obj(doc).data ?? doc);
  const pick = [d.externalRef, d.ref, d.title, d.guestName, d.fullName, d.displayName, d.name, d.unitNumber, d.unitCode, d.description].find(x => typeof x === 'string' && x.trim());
  return `${KIND_TITLE[kind] ?? kind.replace(/_/g, ' ')} ${String(pick ?? '')}`.trim();
}

/* ---------- prompts (ready-made questions in the AI app) ---------- */

export const PROMPTS = [
  {
    name: 'monthly_review', title: 'Monthly review',
    description: 'Occupancy and reservation income for a month against the month before, by channel, with what is still owed.',
    arguments: [{ name: 'month', description: 'YYYY-MM (default this month)', required: false }],
  },
  {
    name: 'today_at_a_glance', title: 'Today at a glance',
    description: "Today's check-ins, checkouts, cleaning, open repairs and what needs someone now.",
    arguments: [],
  },
  {
    name: 'find_reservation', title: 'Find a reservation or guest',
    description: 'Find a reservation by its reference or a guest, unit or owner by name, and summarise it.',
    arguments: [{ name: 'query', description: 'a reservation reference, guest name or phone, unit or owner', required: true }],
  },
  {
    name: 'daily-brief', title: 'What do I need to look at today?',
    description: 'Your tasks, approvals, deliveries, purchase orders and repairs that are overdue or due soon, and what else is waiting for you.',
    arguments: [],
  },
  // Round 4c P2 (owner, 26 Nov 2026): one prompt per role. prompts/list shows each only when the person can use one of
  // its tools (PROMPT_TOOLS, mcpServer.ts), so the list itself follows their ERP access.
  {
    name: 'owner_morning_report', title: 'Owner morning report',
    description: 'The day at a glance for management: occupancy tonight, check-ins and checkouts, money owed to us, what we owe, reviews and what needs a decision.',
    arguments: [],
  },
  {
    name: 'operations_review', title: 'Operations and cleaning',
    description: 'Cleaning and repairs today and overdue, check-ins and checkouts, units empty tonight and units not ready.',
    arguments: [],
  },
  {
    name: 'reservations_revenue_review', title: 'Reservations and earnings',
    description: 'Earnings, average nightly price and earnings per available night, channel mix, pace for the next 90 days and cancellations, against the period before.',
    arguments: [{ name: 'period', description: 'month | last_month | quarter | year (default month)', required: false }],
  },
  {
    name: 'finance_review', title: 'Finance review',
    description: 'Money owed to us (aged), what we owe suppliers and contractors, owner statements still to send and the management report against the period before.',
    arguments: [{ name: 'month', description: 'YYYY-MM (default this month)', required: false }],
  },
  {
    name: 'owner_relations_review', title: 'Owner relations',
    description: "Owner statements and payouts, contracts ending soon, owners missing bank details or a contract, and one owner's account when named.",
    arguments: [{ name: 'owner', description: "an owner's name (optional)", required: false }],
  },
];

/** The tools behind each prompt: a prompt is listed only when the person can use at least one of them (round 4c). */
export const PROMPT_TOOLS: Record<string, string[]> = {
  monthly_review: ['business_summary', 'reservations_summary'],
  today_at_a_glance: ['today_summary'],
  find_reservation: ['search'],
  'daily-brief': ['daily_brief'],
  owner_morning_report: ['daily_brief', 'occupancy_summary', 'today_summary', 'arrears_summary', 'payables_summary', 'reviews_summary'],
  operations_review: ['housekeeping_today', 'today_summary', 'vacancy_summary'],
  reservations_revenue_review: ['revenue_summary', 'channel_mix', 'booking_pace', 'cancellations_summary'],
  finance_review: ['arrears_summary', 'payables_summary', 'owner_statement_summary', 'company_report'],
  owner_relations_review: ['owner_statement_summary', 'leases_expiring', 'data_gaps'],
};

const ROLE_TAIL = ' If a tool says I do not have access, say so in one line and carry on with the rest. Lead with the numbers (RM), give each item\'s ERP link, keep it short and in plain language.';

/** The message a prompt expands to (prompts/get). Unknown name -> null. */
export function promptText(name: string, a: Record<string, unknown>): string | null {
  const v = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim().slice(0, 100) : '');
  if (name === 'monthly_review') {
    const m = MONTH.test(v('month')) ? v('month') : 'this month';
    return `Review ${m} using business_summary and reservations_summary for the same month. Give occupancy and reservation income against the month before (with the change), the split by channel, and what is still owed to us. Short, plain language.`;
  }
  if (name === 'today_at_a_glance') {
    return 'Using today_summary, tell me today\'s check-ins and checkouts, cleaning still pending, open repairs and unread guest messages, then what needs someone now, most urgent first. Short.';
  }
  if (name === 'find_reservation') {
    return `Find "${v('query')}" with search, open the best match with fetch, and summarise it: dates, unit, guest, channel, status and amounts. Give the ERP link.`;
  }
  if (name === 'daily-brief') {
    return 'What do I need to look at today? Use daily_brief. Start with what is overdue, then what is due soon, then the rest. For each section give the count and the items with their links. If something is not available to my account, say so in one line. Short.';
  }
  if (name === 'owner_morning_report') {
    return 'Give me my morning report. Use daily_brief first, then occupancy_summary (tonight by building), today_summary (check-ins, checkouts, what needs someone now), arrears_summary (who owes us, oldest first), payables_summary (what we owe, due this week) and reviews_summary {period: "week"} (bad reviews, not replied). Start with what needs a decision today.' + ROLE_TAIL;
  }
  if (name === 'operations_review') {
    return 'Operations review for today: housekeeping_today (cleaning today and overdue, repairs due), today_summary (check-ins and checkouts, cleaning pending, unread guest messages) and vacancy_summary {days: 7} (empty tonight and the week ahead). Flag any check-in today whose unit is not cleaned yet.' + ROLE_TAIL;
  }
  if (name === 'reservations_revenue_review') {
    const p = ['month', 'last_month', 'quarter', 'year'].includes(v('period')) ? v('period') : 'month';
    return `Reservations and earnings for ${p.replace('_', ' ')}: revenue_summary {period: "${p}"} (earnings, average nightly price, earnings per available night by building, against the period before), channel_mix {period: "${p}"}, booking_pace (next 30 / 60 / 90 days against last month and last year) and cancellations_summary {period: "${p}"}.` + ROLE_TAIL;
  }
  if (name === 'finance_review') {
    const m = MONTH.test(v('month')) ? v('month') : '';
    return `Finance review${m ? ` for ${m}` : ''}: arrears_summary (money owed to us, aged), payables_summary (suppliers and contractor claims, due this week), owner_statement_summary${m ? ` {month: "${m}"}` : ''} (still draft, waiting to send, sent, paid) and company_report {period: "month"${m ? `, month: "${m}"` : ''}} against the month before.` + ROLE_TAIL;
  }
  if (name === 'owner_relations_review') {
    const o = v('owner');
    return `Owner relations: owner_statement_summary${o ? ` {owner: "${o}"}` : ''} (statements to send, owners in the negative${o ? `, and ${o}'s statements and payouts month by month` : ''}), leases_expiring {days: 60} (owner contracts ending) and data_gaps (owners without bank details or a contract, units without an owner).` + ROLE_TAIL;
  }
  return null;
}
