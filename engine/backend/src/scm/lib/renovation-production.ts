/* The rules of a production order that need no database (owner, 6 Nov 2026): schedule days, Day N of M, list buckets, how
   much leaves stock and from where, what a material's status reads. The routes and stock writes sit in
   routes/production-orders.ts and lib/renovation-production-stock.ts. */

export type IsoDate = string;

const toUtc = (iso: IsoDate): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const fromUtc = (t: number): IsoDate => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;

export const isScheduleDay = (iso: IsoDate, holidays: ReadonlySet<string>): boolean =>
  new Date(toUtc(iso)).getUTCDay() !== 0 && !holidays.has(iso.slice(0, 10));

/** Every day between two dates, both included, that counts: Sundays and public holidays do not. */
export function scheduleDays(start: IsoDate | null | undefined, finish: IsoDate | null | undefined, holidays: ReadonlySet<string>): IsoDate[] {
  if (!start || !finish) return [];
  const from = toUtc(start);
  const to = toUtc(finish);
  if (to < from) return [];
  const out: IsoDate[] = [];
  for (let t = from; t <= to; t += DAY) {
    const iso = fromUtc(t);
    if (isScheduleDay(iso, holidays)) out.push(iso);
  }
  return out;
}

/** A holiday counts for an order when it is nationwide or in the state of the order's project. */
export function holidaySet(rows: ReadonlyArray<{ holiday_date: string; state: string | null }>, state: string | null | undefined): Set<string> {
  const want = (state ?? '').trim().toLowerCase();
  return new Set(rows.filter((r) => !r.state || (want && r.state.trim().toLowerCase() === want)).map((r) => r.holiday_date));
}

export type ProductionBucket = 'draft' | 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type OrderClock = {
  status: string; on_hold?: boolean | null; plan_start?: string | null; expected_at?: string | null;
  actual_start_at?: string | null; received_at?: string | null;
};

export function bucketOf(o: OrderClock): ProductionBucket {
  if (o.status === 'DRAFT') return 'draft';
  if (o.status === 'CANCELLED') return 'cancelled';
  if (o.status === 'RECEIVED') return 'completed';
  if (o.on_hold || o.status === 'ON_HOLD') return 'on_hold';
  return o.actual_start_at ? 'in_progress' : 'pending';
}

/** Past plan finish and not completed. A held or cancelled order is stopped, not late. */
export const isOverdue = (o: OrderClock, today: IsoDate): boolean => {
  const b = bucketOf(o);
  return (b === 'pending' || b === 'in_progress') && Boolean(o.expected_at) && String(o.expected_at).slice(0, 10) < today;
};

export type Progress = {
  bucket: ProductionBucket; overdue: boolean; label: string; statusLabel: string;
  planDays: IsoDate[]; dayNo: number | null; daysLeft: number | null; pct: number;
};

const STATUS_WORD: Record<ProductionBucket, string> = {
  draft: 'Draft', pending: 'Pending', in_progress: 'In Progress', on_hold: 'On Hold', completed: 'Completed', cancelled: 'Cancelled',
};

/** Day N of M, read from the plan dates and never from a percentage anyone typed. */
export function progressOf(o: OrderClock, today: IsoDate, holidays: ReadonlySet<string>): Progress {
  const bucket = bucketOf(o);
  const overdue = isOverdue(o, today);
  const planDays = scheduleDays(o.plan_start, o.expected_at, holidays);
  const statusLabel = overdue ? 'Overdue' : STATUS_WORD[bucket];
  const base = { bucket, overdue, statusLabel, planDays };
  if (bucket === 'completed') {
    const started = (o.actual_start_at ?? o.plan_start ?? '').slice(0, 10);
    const n = scheduleDays(started, (o.received_at ?? '').slice(0, 10), holidays).length;
    return { ...base, label: n > 0 ? `Done in ${n} day${n === 1 ? '' : 's'}` : 'Done', dayNo: null, daysLeft: 0, pct: 100 };
  }
  if (bucket === 'draft' || bucket === 'cancelled' || !o.actual_start_at) return { ...base, label: '', dayNo: null, daysLeft: null, pct: 0 };
  const m = planDays.length;
  const start = planDays[0] ?? o.actual_start_at.slice(0, 10);
  /* Before the first plan day a started job still reads Day 1. Past the last it keeps counting, so a late job reads Day 11 of 7. */
  const dayNo = Math.max(1, scheduleDays(start, today, holidays).length);
  const daysLeft = m > 0 ? Math.max(0, m - dayNo) : null;
  return { ...base, label: m > 0 ? `Day ${dayNo} of ${m}` : `Day ${dayNo}`, dayNo, daysLeft, pct: m > 0 ? Math.min(100, Math.round((dayNo / m) * 100)) : 0 };
}

/** The list's filter contract. Each tab is a plain column filter, so it pages and counts on the server like every other. */
export const PRODUCTION_TABS = ['pending', 'in_progress', 'overdue', 'completed'] as const;
export type ProductionTab = (typeof PRODUCTION_TABS)[number];
export const isProductionTab = (v: string | null | undefined): v is ProductionTab => (PRODUCTION_TABS as readonly string[]).includes(v ?? '');

type TabFilterable = { eq(c: string, v: unknown): TabFilterable; is(c: string, v: unknown): TabFilterable; not(c: string, op: string, v: unknown): TabFilterable; lt(c: string, v: unknown): TabFilterable };

export function filterProductionTab<Q>(q: Q, tab: ProductionTab, today: IsoDate): Q {
  const out = q as unknown as TabFilterable;
  if (tab === 'completed') return out.eq('status', 'RECEIVED') as unknown as Q;
  const running = out.eq('status', 'SUBMITTED').eq('on_hold', false);
  if (tab === 'pending') return running.is('actual_start_at', null) as unknown as Q;
  if (tab === 'in_progress') return running.not('actual_start_at', 'is', null) as unknown as Q;
  return running.lt('expected_at', today) as unknown as Q;
}

/** Stock counts whole units: a fractional need rounds up at Start, and a leftover comes back with Return stock. */
export const wholeNeed = (qty: number | string): number => Math.ceil(Number(qty) - 1e-9);

export type WarehouseStock = { warehouseId: string; qty: number };

/* Stock is pooled, so an issue walks the warehouses holding the most. What the pool cannot cover still goes out (the job
   does not wait), off the fallback warehouse, and is the shortfall MRP must buy. */
export function allocateIssue(need: number, stock: WarehouseStock[], fallbackWarehouseId: string | null): { picks: WarehouseStock[]; short: number } {
  const picks: WarehouseStock[] = [];
  let left = need;
  for (const s of [...stock].filter((x) => x.qty > 0).sort((a, b) => b.qty - a.qty)) {
    if (left <= 0) break;
    const take = Math.min(left, s.qty);
    s.qty -= take;
    left -= take;
    picks.push({ warehouseId: s.warehouseId, qty: take });
  }
  if (left > 0) {
    const wh = fallbackWarehouseId ?? picks[0]?.warehouseId ?? null;
    if (wh) {
      const same = picks.find((p) => p.warehouseId === wh);
      if (same) same.qty += left; else picks.push({ warehouseId: wh, qty: left });
    }
  }
  return { picks, short: left };
}

export type MaterialIssue = { qty_issued: number; qty_returned: number };
export const returnable = (m: MaterialIssue): number => Math.max(0, m.qty_issued - m.qty_returned);

export type ReturnLine = { materialId: string; qty: number; warehouseId: string };

/** Refuses the whole return before anything moves: one bad line must not leave half of it done. */
export function checkReturn(lines: ReadonlyArray<ReturnLine>, materials: ReadonlyMap<string, MaterialIssue & { item_code: string }>): string | null {
  const asked = new Map<string, number>();
  for (const l of lines) {
    const m = materials.get(l.materialId);
    if (!m) return 'A raw material is no longer on this order. Refresh and try again.';
    if (!Number.isInteger(l.qty) || l.qty <= 0) return `Give ${m.item_code} a whole number above zero.`;
    if (!l.warehouseId) return `Pick the warehouse ${m.item_code} goes back to.`;
    asked.set(l.materialId, (asked.get(l.materialId) ?? 0) + l.qty);
  }
  for (const [id, qty] of asked) {
    const m = materials.get(id)!;
    if (qty > returnable(m)) return `${m.item_code}: only ${returnable(m)} can go back.`;
  }
  return null;
}

/* MRP (audit item 2). Received units sit in stock, so they cover demand through the stock bucket: taking them off the
   demand as well counted them twice. Before Start a material asks for all it needs; once issued it asks only for what has
   not left stock yet, plus what went out past the pooled balance. */
export type MaterialDemandInput = { qty_needed: number | string; qty_issued: number; qty_issued_short: number };
export const openDemandOf = (m: MaterialDemandInput): { unissued: number; shortfall: number } => ({
  unissued: Math.max(0, wholeNeed(m.qty_needed) - m.qty_issued),
  shortfall: m.qty_issued > 0 ? m.qty_issued_short : 0,
});

/* An issue past the pool leaves the balance negative. MRP shows that as the material's own shortage rather than as extra
   need on whichever line comes next, and a shortfall since covered (the balance is back above zero) asks for nothing.
   Rows are taken in order, so the earliest date is served first. Returns the balance with the claimed part put back. */
export function claimShortfall<R extends { qty: number }>(rows: R[], balance: number): { kept: R[]; balance: number } {
  let open = Math.max(0, -balance);
  const kept: R[] = [];
  for (const r of rows) {
    const take = Math.min(r.qty, open);
    if (take <= 0) continue;
    open -= take;
    r.qty = take;
    kept.push(r);
  }
  return { kept, balance: balance + kept.reduce((t, r) => t + r.qty, 0) };
}

export type MaterialState = 'received' | 'stock' | 'po' | 'short';
export type PoLink = { qty: number; received_qty: number | null; delivery_date: string | null; purchase_order_id: string; po: { po_number: string; expected_at: string | null } };
export type PlanLine = { source: string; shortageQty: number; poNumber: string | null; poEta: string | null } | undefined;

/* One verdict for a material (audit item 15): the PO number and the ETA come from the same PO, the material's own open line
   first, and a material MRP no longer plans (a held, draft or finished order) reads from what it actually has. */
export function materialVerdict(m: MaterialDemandInput & { id: string }, own: readonly PoLink[], line: PlanLine): {
  state: MaterialState; received: number; onOrder: number; shortQty: number | null; poNumber: string | null; poId: string | null; eta: string | null;
} {
  const received = own.reduce((t, l) => t + Number(l.received_qty ?? 0), 0);
  const onOrder = own.reduce((t, l) => t + Math.max(0, Number(l.qty ?? 0) - Number(l.received_qty ?? 0)), 0);
  const open = own.find((l) => Number(l.qty ?? 0) > Number(l.received_qty ?? 0));
  const need = wholeNeed(m.qty_needed);
  const issuedAll = m.qty_issued >= need;
  const fromOwn = open ?? own[0] ?? null;
  const verdict = (state: MaterialState, shortQty: number | null = null) => ({
    state, received, onOrder, shortQty,
    poNumber: fromOwn?.po.po_number ?? (state === 'po' ? line?.poNumber ?? null : null),
    poId: fromOwn?.purchase_order_id ?? null,
    eta: state === 'po' ? open?.delivery_date ?? open?.po.expected_at ?? line?.poEta ?? null : null,
  });
  if (line) {
    if (line.source === 'shortage') return verdict('short', line.shortageQty);
    if (line.source === 'po') return verdict('po');
    return verdict(received >= need ? 'received' : 'stock');
  }
  if (issuedAll || received >= need) return verdict(received >= need ? 'received' : 'stock');
  if (onOrder > 0) return verdict('po');
  return verdict('short', need - m.qty_issued);
}

export const stockStatusOf = (states: readonly MaterialState[]): 'READY' | 'NOT READY' | null =>
  states.length === 0 ? null : states.every((s) => s === 'received' || s === 'stock') ? 'READY' : 'NOT READY';

export const validHours = (v: unknown): number | null | 'bad' => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 10) / 10 : 'bad';
};
