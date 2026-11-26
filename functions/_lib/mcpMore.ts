/**
 * AI Connector round 3 (owner, 26 Nov 2026), the pure parts: four more quick answers (occupancy_summary,
 * arrears_summary, owner_statement_summary, attendance_today), the daily brief, export_excel's list allowlist and
 * column shaping, and the per-person rate limit. The tools themselves are in mcpMoreTools.ts; every read there goes
 * through the same readValue as erp_get (as the person, credential fields stripped), so these functions only ever see
 * what the person's own ERP screens would show. Money arrives in sen and leaves as RM (2 dp).
 *
 * Pure, so it is unit-tested (src/lib/mcpMore.test.mjs).
 */
import { rm } from './mcpQuick';

type Obj = Record<string, unknown>;
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** A list reply's rows: `data`, `rows`, or the reply itself when it is an array. */
export const rowsOf = (v: unknown): Obj[] => (Array.isArray(v) ? arr(v) : Array.isArray(obj(v).data) ? arr(obj(v).data) : arr(obj(v).rows));
const ymd = (v: unknown) => str(v).slice(0, 10);

/** YYYY-MM-DD plus n days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** Whole days from `a` to `b` (b later = positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/* ---------- occupancy_summary: /api/portfolio/performance + /api/dashboard/kpis + /api/reservations?view=inhouse ---------- */

export function summariseOccupancy(month: string, today: string, perf: unknown, kpis: unknown, inhouse: unknown) {
  const p = obj(perf);
  const rows = arr(p.rows);
  const days = num(p.days);
  const nights = rows.reduce((s, r) => s + num(r.nights), 0);
  const unitDays = rows.length * days;
  const money = rows.some(r => num(r.revenue) !== 0);
  const byB = new Map<string, { building: string; units: number; nights: number }>();
  for (const r of rows) {
    const k = str(r.propertyName) || 'Unknown';
    const b = byB.get(k) ?? { building: k, units: 0, nights: 0 };
    b.units++; b.nights += num(r.nights);
    byB.set(k, b);
  }
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const dash = arr(obj(kpis).kpis).find(k => k.key === 'occupancy');
  const exceptions = rows.filter(r => r.exception && typeof r.exception === 'object');
  return {
    month,
    note: `Occupancy = nights sold / (listed units x days). ${month === today.slice(0, 7) ? `${month} is in progress: counted up to today (${today}). ` : ''}The Dashboard's figure counts each unit only for the days it was live, so it can differ slightly.${money ? ' Money in RM.' : ''}`,
    days,
    listedUnits: num(p.units) || rows.length,
    buildings: num(p.buildings) || byB.size,
    nightsSold: nights,
    occupancyPct: pct(nights, unitDays),
    ...(dash ? { dashboardOccupancyPct: num(dash.value) } : {}),
    ...(inhouse ? { staysInHouseNow: num(obj(obj(inhouse).counts).inhouse ?? obj(inhouse).total) } : {}),
    ...(inhouse ? { tonightByBuilding: tonightByBuilding(rows, inhouse) } : {}),
    byBuilding: [...byB.values()].map(b => ({ ...b, occupancyPct: pct(b.nights, b.units * days) })).sort((a, b) => b.occupancyPct - a.occupancyPct).slice(0, 15),
    lowestUnits: [...rows].sort((a, b) => num(a.occupancy) - num(b.occupancy)).slice(0, 5)
      .map(r => ({ unit: `${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), occupancyPct: num(r.occupancy), nights: num(r.nights), ...(money ? { incomeRm: rm(r.revenue) } : {}) })),
    unitsNeedingAttention: { count: exceptions.length, top: exceptions.slice(0, 5).map(r => ({ unit: `${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), issue: str(obj(r.exception).label) })) },
  };
}

/** Tonight by building: reservations in house now (the Reservations list's In house tab, its building filter counts)
 *  against the listed units of each building. */
export function tonightByBuilding(rows: Obj[], inhouse: unknown) {
  const units = new Map<string, { building: string; units: number }>();
  for (const r of rows) {
    const id = str(r.propertyId);
    const b = units.get(id) ?? { building: str(r.propertyName) || 'Unknown', units: 0 };
    b.units++; units.set(id, b);
  }
  const inHouse = new Map(arr(obj(obj(inhouse).facets).building).map(f => [str(f.value), num(f.count)]));
  return [...units.entries()].map(([id, b]) => {
    const n = Math.min(inHouse.get(id) ?? 0, b.units);
    return { building: b.building, units: b.units, occupiedNow: n, occupancyPct: b.units ? Math.round((n / b.units) * 1000) / 10 : 0 };
  }).sort((a, b) => b.occupancyPct - a.occupancyPct).slice(0, 15);
}

/** Ageing buckets of amounts by days: 0-30, 31-60, 61-90, 90+. */
export function ageing(items: { days: number; sen: number }[]): Record<string, number> {
  const b: Record<string, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const i of items) b[i.days <= 30 ? '0-30' : i.days <= 60 ? '31-60' : i.days <= 90 ? '61-90' : '90+'] += i.sen;
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, rm(v)]));
}

/* ---------- arrears_summary: /api/reservations?todo=unpaid + /api/sales-invoices ---------- */

const SI_OPEN = (s: string) => !['PAID', 'CANCELLED'].includes(s);

export function summariseArrears(today: string, origin: string, guests: unknown, invoices: unknown) {
  const out: Obj = {
    date: today,
    note: 'Money owed to us that is still open. Guests: direct reservations with a balance (the Reservations list\'s "Unpaid" card), aged by days since check-in; host payouts the channels still owe us are shown separately. Customers: Dream Crafter sales invoices not fully paid, overdue = past the due date. Tenant rent on Agent-to-let records is not tracked as paid or unpaid in the ERP, so rent arrears cannot be reported. Money in RM.',
  };
  if (guests) {
    const g = obj(guests);
    const todos = obj(g.todos);
    const unpaid = obj(todos.unpaid), payout = obj(todos.payout);
    const list = rowsOf(g);
    out.guests = {
      directGuestsOwing: num(unpaid.count),
      owedRm: rm(unpaid.outstanding),
      // Ageing only when the page holds every guest owing (it is read 100 at a time, oldest first).
      ...(list.length >= num(unpaid.count) ? { ageingByDaysRm: ageing(list.map(r => ({ days: Math.max(0, daysBetween(ymd(r.checkIn), today)), sen: num(r.outstanding) }))) } : {}),
      // Oldest stays first (the list's order for this card).
      oldest: list.slice(0, 5).map(r => ({
        ref: str(r.externalRef), guest: str(r.guestName), unit: `${str(r.propertyName)} ${str(r.unitNumber)}`.trim(),
        checkIn: ymd(r.checkIn), checkOut: ymd(r.checkOut), daysSinceCheckIn: Math.max(0, daysBetween(ymd(r.checkIn), today)), owedRm: rm(r.outstanding),
        link: `${origin}/reservations/bookings?view=all&open=${encodeURIComponent(str(r.id))}`,
      })),
      hostPayoutsOutstanding: { count: num(payout.count), owedRm: rm(payout.outstanding) },
    };
  }
  if (invoices) {
    const open = rowsOf(invoices).filter(r => SI_OPEN(str(r.status)) && num(r.outstandingSen) > 0);
    const overdue = open.filter(r => ymd(r.dueDate) && ymd(r.dueDate) < today);
    out.customers = {
      openInvoices: open.length,
      openRm: rm(open.reduce((s, r) => s + num(r.outstandingSen), 0)),
      overdueInvoices: overdue.length,
      overdueRm: rm(overdue.reduce((s, r) => s + num(r.outstandingSen), 0)),
      overdueByDaysRm: ageing(overdue.map(r => ({ days: daysBetween(ymd(r.dueDate), today), sen: num(r.outstandingSen) }))),
      biggestOverdue: [...overdue].sort((a, b) => num(b.outstandingSen) - num(a.outstandingSen)).slice(0, 5).map(r => ({
        invoice: str(r.invoiceNumber), customer: str(r.customerName), dueDate: ymd(r.dueDate), daysOverdue: daysBetween(ymd(r.dueDate), today),
        owedRm: rm(r.outstandingSen), link: `${origin}/sales/invoices`,
      })),
    };
  }
  return out;
}

/* ---------- owner_statement_summary: /api/statements?period= ---------- */

const STATUS: Record<string, string> = { provisional: 'draft', finalised: 'final', sent: 'sent', paid: 'paid' };

export function summariseStatements(origin: string, reply: unknown) {
  const r = obj(reply);
  const period = str(r.period);
  const t = obj(r.totals);
  const periods = arr(r.periods);
  const cur = periods.find(p => str(p.period) === period) ?? {};
  const rows = rowsOf(r);
  const link = (x: Obj) => `${origin}/finance/statements/${encodeURIComponent(str(x.id))}`;
  return {
    period: period || null,
    note: 'Owner statements for one month (default: the latest month that has any). Status: Draft -> Final -> Sent (the owner can see it) -> Paid. Money in RM.',
    statements: num(r.total),
    byStatus: { draft: num(cur.provisional), final: num(cur.finalised), sent: num(cur.sent), paid: num(cur.paid) },
    finalNotSent: num(obj(r.summary).notSent),
    totals: { guestTotalRm: rm(t.gross), operatorShareRm: rm(t.fee), expensesRm: rm(t.expenses), netPayoutToOwnerRm: rm(t.net) },
    waitingToSend: rows.filter(x => x.state === 'finalised').slice(0, 5).map(x => ({ owner: str(x.ownerName), netPayoutToOwnerRm: rm(x.netPayout), link: link(x) })),
    stillDraft: rows.filter(x => x.state === 'provisional').slice(0, 5).map(x => ({ owner: str(x.ownerName), link: link(x) })),
    sent: rows.filter(x => x.state === 'sent').slice(0, 5).map(x => ({ owner: str(x.ownerName), sentAt: ymd(x.sentAt), link: link(x) })),
    ownersOwingUs: rows.filter(x => num(x.netPayout) < 0).length,
    biggestPayouts: [...rows].sort((a, b) => num(b.netPayout) - num(a.netPayout)).slice(0, 5).map(x => ({
      owner: str(x.ownerName), units: str(x.unitsLabel).slice(0, 120), status: STATUS[str(x.state)] ?? str(x.state), netPayoutToOwnerRm: rm(x.netPayout), link: link(x),
    })),
    recentMonths: periods.slice(0, 6).map(p => ({ period: str(p.period), statements: num(p.count), netPayoutToOwnerRm: rm(p.net), sent: num(p.sent), paid: num(p.paid) })),
  };
}

/* ---------- attendance_today: /api/attendance (today) + /api/leaves (pending and coming up) ---------- */

export function summariseAttendance(today: string, att: unknown, leaves: unknown) {
  const a = obj(att);
  const lines = arr(a.data);
  const name = (l: Obj) => str(obj(l.employee).name) || 'Unknown';
  const onLeave = lines.filter(l => l.leave);
  const punched = lines.filter(l => l.punch);
  const notIn = lines.filter(l => !l.punch && !l.leave);
  const out: Obj = {
    date: str(a.date) || today,
    note: 'In-house staff on the attendance list (HR > Workers > Attendance). "Not clocked in" may simply mean their shift has not started yet.',
    people: lines.length,
    clockedIn: punched.length,
    stillIn: punched.filter(l => !obj(l.punch).clockOutAt).length,
    forgotToClockOut: punched.filter(l => obj(l.punch).forgotOut).length,
    onLeave: { count: onLeave.length, people: onLeave.slice(0, 20).map(l => ({ name: name(l), type: str(l.leave) })) },
    notClockedIn: { count: notIn.length, people: notIn.slice(0, 20).map(name) },
  };
  if (leaves) {
    const all = arr(obj(leaves).leaves);
    const pending = all.filter(l => l.status === 'pending');
    const soon = all.filter(l => l.status === 'approved' && ymd(l.startDate) > today && ymd(l.startDate) <= addDays(today, 7));
    out.leaveRequestsWaiting = { count: pending.length, top: pending.slice(0, 5).map(l => ({ name: str(l.name), type: str(l.type), from: ymd(l.startDate), to: ymd(l.endDate), days: num(l.days) })) };
    out.leaveNext7Days = soon.slice(0, 10).map(l => ({ name: str(l.name), type: str(l.type), from: ymd(l.startDate), to: ymd(l.endDate) }));
  }
  return out;
}

/* ---------- payables_summary: /api/purchase-invoices + /api/finance/payables ---------- */

const PI_OPEN = (s: string) => !['PAID', 'CANCELLED'].includes(s);

export function summarisePayables(today: string, origin: string, invoices: unknown, claims: unknown) {
  const out: Obj = {
    date: today,
    note: 'What we owe outside people. Suppliers: Dream Crafter purchase invoices not fully paid, aged by days past the due date (not yet due counts as 0-30). Contractors: maintenance contractor claims not yet paid (Finance > Accounts payable), aged by billing date. Utility bills and other expenses have no paid / unpaid record in the ERP, so they are not in here. Money in RM.',
  };
  if (invoices) {
    const open = rowsOf(invoices).filter(r => PI_OPEN(str(r.status)) && num(r.outstandingSen) > 0);
    const weekEnd = addDays(today, 7);
    const per = new Map<string, { supplier: string; invoices: number; sen: number; overdueSen: number }>();
    for (const r of open) {
      const k = str(r.supplierName) || str(r.supplierCode) || 'Unknown';
      const e = per.get(k) ?? { supplier: k, invoices: 0, sen: 0, overdueSen: 0 };
      e.invoices++; e.sen += num(r.outstandingSen);
      if (ymd(r.dueDate) && ymd(r.dueDate) < today) e.overdueSen += num(r.outstandingSen);
      per.set(k, e);
    }
    const dueWeek = open.filter(r => ymd(r.dueDate) >= today && ymd(r.dueDate) <= weekEnd);
    out.suppliers = {
      openInvoices: open.length,
      owedRm: rm(open.reduce((s, r) => s + num(r.outstandingSen), 0)),
      ageingByDaysPastDueRm: ageing(open.map(r => ({ days: ymd(r.dueDate) ? Math.max(0, daysBetween(ymd(r.dueDate), today)) : 0, sen: num(r.outstandingSen) }))),
      dueThisWeek: { invoices: dueWeek.length, owedRm: rm(dueWeek.reduce((s, r) => s + num(r.outstandingSen), 0)) },
      bySupplier: [...per.values()].sort((a, b) => b.sen - a.sen).slice(0, 10).map(e => ({ supplier: e.supplier, invoices: e.invoices, owedRm: rm(e.sen), overdueRm: rm(e.overdueSen) })),
      link: `${origin}/procurement/purchase-invoices`,
    };
  }
  if (claims) {
    const c = obj(claims);
    const unpaid = rowsOf(c).filter(r => !r.paidOn && num(r.amount) > 0);
    out.contractors = {
      unpaidClaims: num(obj(c.counts).unpaid) || unpaid.length,
      owedRm: rm(c.owed ?? unpaid.reduce((s, r) => s + num(r.amount), 0)),
      ageingByDaysRm: ageing(unpaid.map(r => ({ days: Math.max(0, daysBetween(ymd(r.billingDate ?? r.finishedAt) || today, today)), sen: num(r.amount) }))),
      oldest: unpaid.slice(0, 5).map(r => ({ payee: str(r.payee), job: str(r.title), place: `${str(r.propertyName)} ${str(r.unitNumber)}`.trim(), billed: ymd(r.billingDate ?? r.finishedAt), owedRm: rm(r.amount) })),
      link: `${origin}/finance/payables`,
    };
  }
  return out;
}

/* ---------- today lists (today_summary): /api/reservations?todo=arriving|departing ---------- */

export function todayStays(origin: string, reply: unknown) {
  const r = obj(reply);
  const list = rowsOf(r);
  return {
    count: num(r.total) || list.length,
    list: list.slice(0, 25).map(x => ({
      ref: str(x.externalRef), guest: str(x.guestName), unit: `${str(x.propertyName)} ${str(x.unitNumber)}`.trim(), channel: str(x.channel),
      ...(str(x.checkInTime || x.checkOutTime) ? { time: str(x.checkInTime || x.checkOutTime) } : {}),
      link: `${origin}/reservations/bookings?view=all&open=${encodeURIComponent(str(x.id))}`,
    })),
  };
}

/* ---------- daily_brief ---------- */

export type BriefLine = { title: string; detail: string; due?: string; link: string };
export type BriefSection = { section: string; count: number; top: BriefLine[]; more?: string };

const SO_DONE = ['DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED'];
const PO_OPEN = ['SUBMITTED', 'PARTIALLY_RECEIVED'];

/** The replies daily_brief reads (null = not read or refused), and the names of the ones refused. */
export interface BriefInput {
  today: string; origin: string; name: string;
  badges: unknown; tasks: unknown; approvals: unknown; salesOrders: unknown; purchaseOrders: unknown; maintenance: unknown;
  /** GET /api/supply-chain/mail-waiting (Mail Center's waiting-for-my-reply count); null when not read or refused. */
  mail?: unknown;
  noAccess: string[];
}

const dueLabel = (due: string, today: string) => (due < today ? `overdue ${daysBetween(due, today)} d` : due === today ? 'due today' : `due in ${daysBetween(today, due)} d`);

export function buildBrief(i: BriefInput) {
  const { today, origin } = i;
  const soon = addDays(today, 3);
  const sections: BriefSection[] = [];
  const add = (section: string, items: BriefLine[], count = items.length, more?: string) => { if (count > 0) sections.push({ section, count, top: items.slice(0, 5), ...(more ? { more } : {}) }); };

  // My tasks: assigned to me, not done, day up to 3 days ahead (the read asks for exactly that).
  if (i.tasks) {
    const t = rowsOf(i.tasks).filter(r => r.state !== 'resolved' && ymd(r.date) && ymd(r.date) <= soon);
    add('My jobs overdue or due in 3 days', t.map(r => ({
      title: str(r.title) || str(r.kind).replace(/_/g, ' '), detail: `${str(r.propertyName)} ${str(r.unitNumber)} · ${str(r.state)}`.trim(),
      due: dueLabel(ymd(r.date), today), link: `${origin}/operations/tasks`,
    })), t.length, `${origin}/operations/tasks`);
  }
  // Money requests this person may decide.
  if (i.approvals) {
    const mine = rowsOf(i.approvals).filter(r => obj(r.can).approve);
    add('Approvals waiting for you', mine.map(r => ({
      title: `${str(r.kindLabel)}: ${str(r.summary)}`.slice(0, 160), detail: `RM ${rm(r.amount).toFixed(2)} · asked by ${str(obj(r.requestedBy).name)}`,
      due: `since ${ymd(r.requestedAt)}`, link: `${origin}/finance/approvals`,
    })), mine.length, `${origin}/finance/approvals`);
  }
  if (i.salesOrders) {
    const so = rowsOf(i.salesOrders).filter(r => !SO_DONE.includes(str(r.status)) && ymd(r.targetDate) && ymd(r.targetDate) <= soon)
      .sort((a, b) => ymd(a.targetDate).localeCompare(ymd(b.targetDate)));
    add('Sales orders to deliver (overdue or in 3 days)', so.map(r => ({
      title: `${str(r.docNo)} ${str(r.customerName)}`.trim(), detail: str(r.status).replace(/_/g, ' ').toLowerCase(),
      due: dueLabel(ymd(r.targetDate), today), link: `${origin}/sales/orders`,
    })));
  }
  if (i.purchaseOrders) {
    const po = rowsOf(i.purchaseOrders).filter(r => PO_OPEN.includes(str(r.status)) && ymd(r.expectedAt) && ymd(r.expectedAt) <= soon)
      .sort((a, b) => ymd(a.expectedAt).localeCompare(ymd(b.expectedAt)));
    add('Purchase orders expected (overdue or in 3 days)', po.map(r => ({
      title: `${str(r.poNumber)} ${str(r.supplierName)}`.trim(), detail: str(r.status).replace(/_/g, ' ').toLowerCase(),
      due: dueLabel(ymd(r.expectedAt), today), link: `${origin}/procurement/purchase-orders`,
    })));
  }
  if (i.maintenance) {
    const jobs = rowsOf(i.maintenance).filter(r => r.state !== 'resolved' && ymd(r.dueOn) && ymd(r.dueOn) <= soon)
      .sort((a, b) => ymd(a.dueOn).localeCompare(ymd(b.dueOn)));
    add('Maintenance jobs overdue or due in 3 days', jobs.map(r => ({
      title: str(r.title), detail: `${str(r.propertyName)} ${str(r.unitNumber)} · ${str(r.state)}`.trim(),
      due: dueLabel(ymd(r.dueOn), today), link: `${origin}/operations/maintenance?id=${encodeURIComponent(str(r.id))}`,
    })));
  }
  // Mail Center (the engine): open threads whose last word is the customer's, assigned to me or in my own mailbox.
  if (i.mail) {
    const n = num(obj(i.mail).count);
    add('Mail Center: emails waiting for your reply', [{ title: `${n} email thread${n === 1 ? '' : 's'} waiting for your reply`, detail: 'Assigned to you, or unassigned in your own mailbox.', link: `${origin}/mail` }], n, `${origin}/mail`);
  }
  // The side menu's bell: everything else waiting for this person's role (each already limited to what they may open).
  const alerts = arr(obj(i.badges).alerts).filter(a => a.key !== 'approvals' || !i.approvals);
  if (alerts.length) {
    sections.push({
      section: 'Also waiting (the ERP bell)', count: alerts.reduce((s, a) => s + num(a.count), 0),
      top: alerts.slice(0, 8).map(a => ({ title: str(a.title), detail: str(a.body), link: origin + str(a.target) })),
    });
  }
  return {
    date: today,
    for: i.name,
    note: 'What needs you today, from the ERP screens your account can open. Each section: how many, the first 5, and links.',
    sections,
    ...(sections.length ? {} : { nothing: 'Nothing overdue or due in the next 3 days, and nothing waiting for you.' }),
    ...(i.noAccess.length ? { noAccess: `Your account does not have access to: ${i.noAccess.join(', ')}. Those are left out.` } : {}),
    ...(i.mail ? {} : { notCovered: 'Mail Center is not included: it could not be read for your account (no Mail Center access, or Mail Center is not set up or did not answer). Open Mail Center in the ERP.' }),
  };
}

/* ---------- export_excel: the lists it may export ---------- */

/** How a list pages: `pageSize` = page + pageSize (cap per page), `size` = page + size with export=1, `none` = one reply. */
export type Paging = { kind: 'pageSize' | 'size'; max: number; exportFlag?: boolean } | { kind: 'none' };
export interface ExportList {
  path: string; title: string; paging: Paging;
  /** The query keys a caller may pass through (filters / search / dates). */
  filters: string[];
  /** Extra fixed query (e.g. view=all). */
  fixed?: Record<string, string>;
  /** Default columns (keys of a row) in order. */
  columns: string[];
  /** Keys holding money in sen besides those ending in "Sen". */
  money?: string[];
  /** Column titles in the ERP's own words (docs/VOCABULARY.md) where the row key differs. */
  headers?: Record<string, string>;
  /** Dates: [from key, to key] the list understands, when it takes a range. */
  range?: [string, string];
}

export const EXPORT_LISTS: Record<string, ExportList> = {
  reservations: {
    path: '/api/reservations', title: 'Reservations', paging: { kind: 'size', max: 1000, exportFlag: true }, fixed: { view: 'all' },
    filters: ['view', 'todo', 'ch', 'building', 'st', 'q', 'ref', 'guest', 'unit', 'sort'], range: ['from', 'to'],
    columns: ['externalRef', 'guestName', 'propertyName', 'unitNumber', 'channel', 'state', 'checkIn', 'checkOut', 'nights', 'grossBookingValue', 'channelFee', 'expectedPayout', 'received', 'outstanding'],
    money: ['grossBookingValue', 'channelFee', 'collectedRevenue', 'expectedPayout', 'received', 'outstanding', 'roomRevenue', 'cleaningFee', 'extraFees', 'sst', 'tourismTax', 'otaTax', 'deposit'],
    headers: { externalRef: 'Reference', propertyName: 'Building', unitNumber: 'Unit', state: 'Status', grossBookingValue: 'Guest total', channelFee: 'Service fee', expectedPayout: 'Host payout', collectedRevenue: 'Earnings' },
  },
  guests: {
    path: '/api/guests', title: 'Guests', paging: { kind: 'size', max: 1000, exportFlag: true }, filters: ['filter', 'q', 'country', 'sort'],
    columns: ['fullName', 'email', 'phone', 'countryCode'],
  },
  units: {
    path: '/api/units', title: 'Units', paging: { kind: 'none' }, filters: ['propertyId', 'readiness'],
    columns: ['propertyName', 'unitNumber', 'ownerName', 'readiness', 'bedrooms', 'bathrooms', 'maxGuests', 'isListed', 'purpose', 'baseRate'], money: ['baseRate'],
  },
  tasks: {
    path: '/api/tasks', title: 'Tasks', paging: { kind: 'size', max: 1000, exportFlag: true }, filters: ['state', 'kind', 'building', 'assignee', 'q', 'sort'], range: ['from', 'to'],
    columns: ['date', 'propertyName', 'unitNumber', 'kind', 'title', 'state', 'assigneeName', 'scheduledFor', 'dueAt', 'completedAt'],
  },
  maintenance: {
    path: '/api/maintenance/issues', title: 'Maintenance jobs', paging: { kind: 'none' }, filters: ['state', 'unitId'],
    columns: ['reportedAt', 'propertyName', 'unitNumber', 'title', 'category', 'jobType', 'state', 'dueOn', 'assigneeName', 'chargeTo', 'approvalStatus', 'quotedAmount', 'finalAmount', 'resolvedAt'],
    money: ['quotedAmount', 'finalAmount', 'expensed', 'contractorAmount'],
  },
  statements: {
    path: '/api/statements', title: 'Owner statements', paging: { kind: 'pageSize', max: 500 }, filters: ['period', 'state', 'q'],
    columns: ['period', 'ownerName', 'unitsLabel', 'state', 'grossBookingValue', 'managementFee', 'expensesTotal', 'netPayout', 'sentAt'],
    money: ['grossBookingValue', 'managementFee', 'expensesTotal', 'netPayout'],
    headers: { ownerName: 'Owner', unitsLabel: 'Units', state: 'Status', grossBookingValue: 'Guest total', managementFee: 'Operator share', expensesTotal: 'Expenses', netPayout: 'Net payout to owner' },
  },
  expenses: {
    path: '/api/finance/expenses', title: 'Expenses', paging: { kind: 'pageSize', max: 1000, exportFlag: true }, fixed: { view: 'list' },
    filters: ['month', 'category', 'building', 'unit', 'owner', 'q', 'sort'],
    columns: ['incurredOn', 'propertyName', 'unitNumber', 'category', 'description', 'reference', 'amount', 'chargeTo', 'paidAt'], money: ['amount'],
  },
  guest_documents: {
    path: '/api/guest-documents', title: 'Guest invoices and receipts', paging: { kind: 'pageSize', max: 200 }, filters: ['type', 'status', 'month', 'q'],
    columns: ['docNo', 'typeLabel', 'issuedAt', 'guestName', 'bookingRef', 'unit', 'amount', 'voidedAt'], money: ['amount'],
  },
  sales_orders: {
    path: '/api/sales-orders', title: 'Sales orders', paging: { kind: 'none' }, filters: ['status', 'search'],
    columns: ['docNo', 'soDate', 'customerName', 'customerPo', 'targetDate', 'status', 'totalSen', 'paidSen', 'outstandingSen'],
  },
  sales_invoices: {
    path: '/api/sales-invoices', title: 'Sales invoices', paging: { kind: 'none' }, filters: ['status', 'search'],
    columns: ['invoiceNumber', 'invoiceDate', 'dueDate', 'customerName', 'doNumber', 'soDocNo', 'status', 'totalSen', 'paidSen', 'outstandingSen'],
  },
  purchase_orders: {
    path: '/api/purchase-orders', title: 'Purchase orders', paging: { kind: 'none' }, filters: ['status', 'supplierId', 'search'],
    columns: ['poNumber', 'poDate', 'supplierCode', 'supplierName', 'expectedAt', 'status', 'subtotalSen', 'taxSen', 'totalSen', 'receivedAt'],
  },
  purchase_invoices: {
    path: '/api/purchase-invoices', title: 'Purchase invoices', paging: { kind: 'none' }, filters: ['status', 'supplierId', 'search'],
    columns: ['invoiceNumber', 'supplierInvoiceRef', 'invoiceDate', 'dueDate', 'supplierName', 'poNumber', 'status', 'totalSen', 'paidSen', 'outstandingSen'],
  },
  suppliers: { path: '/api/suppliers', title: 'Suppliers', paging: { kind: 'none' }, filters: ['status', 'search', 'category'], columns: [] },
  customers: { path: '/api/customers', title: 'Customers', paging: { kind: 'none' }, filters: ['status', 'search'], columns: [] },
};

export const EXPORT_MAX_ROWS = 5000;

/** The query for one page of a list (or the only read, for `none`). Filters not on the list's allowlist are dropped. */
export function exportQuery(l: ExportList, filters: Record<string, unknown>, page: number, from?: string, to?: string): Record<string, string> {
  const q: Record<string, string> = { ...(l.fixed ?? {}) };
  for (const k of l.filters) {
    const v = filters[k];
    if (v === undefined || v === null || typeof v === 'object') continue;
    const s = String(v).trim().slice(0, 100);
    if (s) q[k] = s;
  }
  if (l.range) { if (from) q[l.range[0]] = from; if (to) q[l.range[1]] = to; }
  if (l.paging.kind !== 'none') {
    q.page = String(page);
    q[l.paging.kind] = String(l.paging.max);
    if (l.paging.exportFlag) q.export = '1';
  }
  return q;
}

/** Whether another page should be read after one that brought `got` rows (total so far `have`). */
export function morePages(l: ExportList, got: number, have: number, total: number | null): boolean {
  if (l.paging.kind === 'none' || got === 0 || have >= EXPORT_MAX_ROWS) return false;
  if (total !== null) return have < total;
  return got >= l.paging.max;
}

export type Column = { key: string; header: string; money: boolean };

const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
/** "grossBookingValue" -> "Gross booking value"; a sen field reads "(RM)". */
export function headerOf(key: string, money: boolean): string {
  const base = key.replace(/Sen$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}${money ? ' (RM)' : ''}`;
}

/** The columns: the caller's `fields` (only keys the rows have), else the list's defaults that the rows have (an
 *  account without finance access gets no money keys back, so those columns simply drop), else every plain key. */
export function exportColumns(l: ExportList, rows: Obj[], fields: string[]): Column[] {
  const seen = new Set<string>();
  for (const r of rows.slice(0, 200)) for (const [k, v] of Object.entries(r)) if (isScalar(v)) seen.add(k);
  const want = fields.length ? fields : l.columns.length ? l.columns : [...seen];
  const keys = want.filter(k => seen.has(k)).slice(0, 60);
  const money = new Set(l.money ?? []);
  return (keys.length ? keys : [...seen].slice(0, 60)).map(key => {
    const m = /Sen$/.test(key) || money.has(key);
    const named = l.headers?.[key];
    return { key, header: named ? `${named}${m ? ' (RM)' : ''}` : headerOf(key, m), money: m };
  });
}

/** One cell: money sen -> RM number, booleans Yes / No, everything else as it came. */
export function cellValue(v: unknown, money: boolean): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  if (money) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) / 100 : String(v); }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 500);
  return String(v);
}

/* ---------- rate limit (per person, tools/call only) ---------- */

export const RATE_PER_MINUTE = 30;
export const RATE_PER_DAY = 600;
/** The status a refused call is logged with; such rows do not count toward the limit. */
export const RATE_LIMITED_STATUS = 429;

/** Null when the call may go ahead, else the plain message the AI app is given. */
export function limitVerdict(c: { minute: number; day: number }, perMinute = RATE_PER_MINUTE, perDay = RATE_PER_DAY): string | null {
  if (c.day >= perDay) return `Daily limit reached: ${perDay} AI Connector lookups in 24 hours. It frees up gradually over the next day; use the ERP directly meanwhile.`;
  if (c.minute >= perMinute) return `Too many requests — wait a minute. The limit is ${perMinute} lookups a minute.`;
  return null;
}

/** One count as a scalar subquery for the door's token query (mcpStore resolveAccessToken withCounts), used twice
 *  (last minute, last day); each is one index range scan on mcp_calls (user_id, created_at). One `?`: the window start. */
export const RATE_COUNT_SQL = (userCol: string) =>
  `SELECT COUNT(*) FROM mcp_calls k WHERE k.user_id = ${userCol} AND k.created_at > ? AND k.status IS DISTINCT FROM ${RATE_LIMITED_STATUS}`;

/** The same counts on their own (one index range scan on mcp_calls (user_id, created_at), migration 0378). */
export const RATE_SQL = `SELECT COUNT(*) FILTER (WHERE created_at > ?) AS minute, COUNT(*) AS day
  FROM mcp_calls WHERE user_id = ? AND created_at > ? AND status IS DISTINCT FROM ${RATE_LIMITED_STATUS}`;
