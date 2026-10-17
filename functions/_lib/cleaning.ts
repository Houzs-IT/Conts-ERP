import { type Env, all, one, run, audit, nowIso } from './db';
import type { Session } from './auth';
import { isPeriodLocked } from './expenses';
import { hasCleanPrices, cleanAmounts } from './cleaningPrices';

export const CLEAN_KINDS = ['turnover', 'deep_clean', 'light_clean'] as const;
export const CLEAN_KINDS_SQL = `('turnover','deep_clean','light_clean')`;
/** Stays that leave no guest mess and hold no guest: never a "previous" or "next" guest. */
export const LIVE_STAY_SQL = (r: string) => `${r}.state NOT IN ('cancelled','no_show','inquiry') AND ${r}.channel != 'maintenance_block'`;

/** The standard checklist. Deep cleans add the last items. Labels are what the cleaner reads on the phone. */
const STANDARD = [
  'Change bed sheets and pillowcases',
  'Clean bathroom and toilet',
  'Restock amenities (shampoo, toilet paper)',
  'Vacuum and mop floors',
  'Empty bins, close windows, switch off aircon',
];
const DEEP_EXTRA = ['Clean inside fridge and microwave', 'Wipe windows and wash curtains'];

export function standardItems(kind: string): { key: string; label: string; sort: number }[] {
  const list = kind === 'deep_clean' ? [...STANDARD, ...DEEP_EXTRA] : STANDARD;
  return list.map((label, i) => ({ key: `std-${i + 1}`, label, sort: i + 1 }));
}

export interface ChecklistItem { key: string; label: string; done: boolean; doneAt: string | null; doneBy: string | null; custom: boolean }

/** The checklist of one clean: the standard items with their ticks, then any added by hand. */
export async function checklistOf(env: Env, taskId: string, kind: string): Promise<ChecklistItem[]> {
  const rows = await all<{ item_key: string; label: string; sort_order: number; done_at: string | null; done_by: string | null }>(env, `
    SELECT c.item_key, c.label, c.sort_order, c.done_at, u.full_name AS done_by
    FROM task_checklist_items c LEFT JOIN users u ON u.id = c.done_by
    WHERE c.task_id = ? ORDER BY c.sort_order, c.created_at`, taskId);
  const byKey = new Map(rows.map(r => [r.item_key, r]));
  const std = standardItems(kind).map(s => {
    const r = byKey.get(s.key);
    return { key: s.key, label: s.label, done: !!r?.done_at, doneAt: r?.done_at ?? null, doneBy: r?.done_by ?? null, custom: false };
  });
  const custom = rows.filter(r => r.item_key.startsWith('c-'))
    .map(r => ({ key: r.item_key, label: r.label, done: !!r.done_at, doneAt: r.done_at, doneBy: r.done_by, custom: true }));
  return [...std, ...custom];
}

const setting = async (env: Env, key: string) => (await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', key))?.value;

/** What one clean of this kind costs on this unit, in sen, and where the figure came from.
 *  Standard: the unit's own cleaning price (unit costs), else the last clean of the same kind charged on the unit,
 *  else the organisation default. Deep: the last deep clean charged on the unit, else the default. */
export async function cleanPrice(env: Env, unitId: string, kind: string): Promise<{ amount: number; source: 'unit' | 'history' | 'default' }> {
  const deep = kind === 'deep_clean';
  const unit = await one<{ amount: number }>(env, `SELECT amount FROM unit_expenses WHERE unit_id = ? AND category = ? AND amount > 0 ORDER BY sort_order LIMIT 1`, unitId, deep ? 'cleaning_deep' : 'cleaning');
  if (unit) return { amount: Number(unit.amount), source: 'unit' };
  const last = await one<{ amount: number }>(env, `
    SELECT e.amount FROM expenses e JOIN tasks t ON t.id = e.task_id
    WHERE e.unit_id = ? AND e.category = 'cleaning' AND e.amount > 0 AND t.kind ${deep ? "= 'deep_clean'" : "!= 'deep_clean'"}
    ORDER BY e.incurred_on DESC LIMIT 1`, unitId);
  if (last) return { amount: Number(last.amount), source: 'history' };
  const def = Number(await setting(env, deep ? 'operations.cleaningPriceDeep' : 'operations.cleaningPriceStandard'));
  return { amount: Number.isInteger(def) && def >= 0 ? def : deep ? 13800 : 8000, source: 'default' };
}

/** Charges a finished clean to its unit once (category cleaning, owner pays), dated the day it was finished (today,
 *  unless `day` says otherwise): that date decides the month and the owner statement it lands on. Skipped when the
 *  clean already has an expense, when the unit already carries a cleaning expense that day (the owner workbook import
 *  records cleans too), or when that month's statement is final. Never throws: the clean is already finished. */
export async function chargeClean(env: Env, session: Session, task: { id: string; unit_id: string; kind: string; title: string }, day = mytToday()):
  Promise<{ amount: number; created: boolean; reason: string | null }> {
  try {
    // The clean's own amount (typed on the job) or the price table's, kept on the job as charged; none set: the old pricing.
    let set: { amount: number; source: 'job' | 'unit' | 'table' } | null = null;
    if (await hasCleanPrices(env)) {
      // Priced on the clean's own day, so a price change dated later never reaches it.
      const own = await one<{ amount: number | null; cleaner_pay: number | null; day_at: string | null }>(env,
        'SELECT amount, cleaner_pay, COALESCE(scheduled_for, due_at, created_at) AS day_at FROM tasks WHERE id = ?', task.id);
      const p = await cleanAmounts(env, task.unit_id, task.kind, own?.day_at);
      const amount = own?.amount ?? p.external, pay = own?.cleaner_pay ?? p.internal;
      if (p.itemId !== undefined) await run(env, 'UPDATE tasks SET amount = ?, cleaner_pay = ?, service_item_id = COALESCE(service_item_id, ?) WHERE id = ?', amount, pay, p.itemId, task.id);
      else await run(env, 'UPDATE tasks SET amount = ?, cleaner_pay = ? WHERE id = ?', amount, pay, task.id);
      if (amount != null) set = { amount: Number(amount), source: own?.amount != null ? 'job' : p.source ?? 'table' };
    }
    const existing = await one<{ amount: number }>(env, `SELECT amount FROM expenses WHERE task_id = ? LIMIT 1`, task.id);
    if (existing) return { amount: Number(existing.amount), created: false, reason: 'already charged' };
    const sameDay = await one<{ amount: number }>(env, `SELECT amount FROM expenses WHERE unit_id = ? AND category = 'cleaning' AND incurred_on = ? LIMIT 1`, task.unit_id, day);
    if (sameDay) return { amount: Number(sameDay.amount), created: false, reason: 'a clean is already charged on this unit today' };
    const price = set ?? await cleanPrice(env, task.unit_id, task.kind);
    if (await isPeriodLocked(env, task.unit_id, day)) return { amount: price.amount, created: false, reason: "this month's owner statement is already final" };
    if (price.amount <= 0) return { amount: 0, created: false, reason: 'no price' };
    const id = crypto.randomUUID();
    await run(env, `
      INSERT INTO expenses (id, unit_id, task_id, category, description, amount, currency, incurred_on, charge_to, created_by, created_at)
      VALUES (?, ?, ?, 'cleaning', ?, ?, 'MYR', ?, 'owner', ?, ?)`,
      id, task.unit_id, task.id, task.kind === 'deep_clean' ? 'Deep clean' : 'Standard clean', price.amount, day, session.userId, nowIso());
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.create', entityTable: 'expenses', entityId: id, after: { unitId: task.unit_id, taskId: task.id, category: 'cleaning', amount: price.amount, source: price.source } });
    return { amount: price.amount, created: true, reason: null };
  } catch (e) {
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.clean_charge_failed', entityTable: 'tasks', entityId: task.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    return { amount: 0, created: false, reason: 'the charge could not be saved' };
  }
}

/** A stay's start or end as an instant: day + HH:MM in Malaysia. */
export const stayInstant = (day: string, hm: string | null, fallback: string) => `${day}T${hm && /^\d{2}:\d{2}$/.test(hm) ? hm : fallback}:00+08:00`;

export interface Overlap { reservationId: string; guestName: string; checkIn: string; checkOut: string; checkInTime: string; checkOutTime: string; state: string }

/** Guest stays on the unit that overlap [from, to). A guest who has checked out no longer counts. */
export async function staysOverlapping(env: Env, unitId: string, from: string, to: string): Promise<Overlap[]> {
  const rows = await all<any>(env, `
    SELECT r.id, r.state, r.check_in, r.check_out, COALESCE(NULLIF(r.check_in_time, ''), '15:00') AS cin, COALESCE(NULLIF(r.check_out_time, ''), '11:00') AS cout,
           COALESCE(NULLIF(g.full_name, ''), CASE WHEN r.channel = 'owner_stay' THEN 'Owner stay' ELSE 'Guest' END) AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.unit_id = ? AND r.state IN ('pending','confirmed','checked_in') AND r.channel != 'maintenance_block'
      AND (r.check_in || 'T' || COALESCE(NULLIF(r.check_in_time, ''), '15:00') || ':00+08:00')::timestamptz < ?::timestamptz
      AND (r.check_out || 'T' || COALESCE(NULLIF(r.check_out_time, ''), '11:00') || ':00+08:00')::timestamptz > ?::timestamptz
    ORDER BY r.check_in`, unitId, to, from);
  return rows.map(r => ({ reservationId: r.id, guestName: r.guest_name, checkIn: r.check_in, checkOut: r.check_out, checkInTime: r.cin, checkOutTime: r.cout, state: r.state }));
}

export interface RepairWindow { id: string; issueId: string; startsAt: string; endsAt: string; note: string | null; overlaps: Overlap[] }

/** Repair windows of these jobs, each with the stays it overlaps (only for windows not yet over). */
export async function windowsFor(env: Env, issueIds: string[]): Promise<Map<string, RepairWindow[]>> {
  const out = new Map<string, RepairWindow[]>();
  if (!issueIds.length) return out;
  const rows = await all<any>(env, `
    SELECT w.id, w.issue_id, w.starts_at, w.ends_at, w.note, m.unit_id
    FROM maintenance_windows w JOIN maintenance_issues m ON m.id = w.issue_id
    WHERE w.issue_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY w.starts_at`, JSON.stringify(issueIds));
  const now = Date.now();
  for (const r of rows) {
    const overlaps = Date.parse(r.ends_at) > now ? await staysOverlapping(env, r.unit_id, r.starts_at, r.ends_at) : [];
    const list = out.get(r.issue_id) ?? [];
    list.push({ id: r.id, issueId: r.issue_id, startsAt: r.starts_at, endsAt: r.ends_at, note: r.note ?? null, overlaps });
    out.set(r.issue_id, list);
  }
  return out;
}

/** Repair windows that touch one Malaysian day, with their job and unit, for Cleaning and Today. */
export async function windowsOnDay(env: Env, day: string) {
  const from = `${day}T00:00:00+08:00`, to = `${day}T23:59:59+08:00`;
  const rows = await all<any>(env, `
    SELECT w.id, w.issue_id, w.starts_at, w.ends_at, w.note, m.title, m.state, m.urgency, m.category, m.vendor_name, m.unit_id,
           u.unit_number, p.id AS property_id, p.name AS property_name
    FROM maintenance_windows w JOIN maintenance_issues m ON m.id = w.issue_id
    JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    WHERE m.state != 'resolved' AND w.starts_at::timestamptz <= ?::timestamptz AND w.ends_at::timestamptz >= ?::timestamptz
    ORDER BY w.starts_at`, to, from);
  const out = [];
  for (const r of rows) {
    out.push({
      id: r.id, issueId: r.issue_id, startsAt: r.starts_at, endsAt: r.ends_at, note: r.note ?? null,
      title: r.title, state: r.state, urgency: r.urgency, category: r.category, assigneeName: r.vendor_name ?? null,
      unitId: r.unit_id, unitNumber: r.unit_number, buildingId: r.property_id, propertyName: r.property_name,
      overlaps: Date.parse(r.ends_at) > Date.now() ? await staysOverlapping(env, r.unit_id, r.starts_at, r.ends_at) : [],
    });
  }
  return out;
}

/** Malaysian calendar day today. */
export const mytToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Nobody tapped "Guest left": from the checkout time on, the guest counts as out (owner, 17 Oct 2026; early leavers are
 *  still tapped by staff). There is no scheduled worker, so whichever screen first reads the clean after that time stamps
 *  it, once, at the checkout time itself, and writes the history row ("Automatic, at checkout 11:00"). Rows are changed
 *  in place (guest_left_at, guest_left_auto). The stamp is the checkout instant in +08:00 form, which a tap (an ISO 'Z'
 *  instant) never is, so later reads still know it was automatic. Never throws: a screen read must not fail over it. */
export async function autoGuestLeft(env: Env, rows: any[], stdOut: string): Promise<void> {
  const now = Date.now();
  const due: { id: string; at: string; time: string; unit: string | null }[] = [];
  for (const r of rows) {
    if (r.guest_left_at || !r.prev_id || r.prev_state === 'checked_out' || r.state === 'resolved' || !r.day) continue;
    const time = r.prev_time && /^\d{2}:\d{2}$/.test(r.prev_time) ? r.prev_time : stdOut;
    const at = `${r.day}T${time}:00+08:00`;
    if (Date.parse(at) > now) continue;
    r.guest_left_at = at; r.guest_left_auto = true;
    due.push({ id: r.id, at, time, unit: r.unit_id ?? null });
  }
  if (!due.length) return;
  try {
    const stamp = nowIso();
    // Only the rows this read stamped get a history line: two screens reading at once write it once.
    const set = await all<{ id: string }>(env, `
      UPDATE tasks t SET guest_left_at = x.at, updated_at = ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, at text)
      WHERE t.id = x.id AND t.guest_left_at IS NULL RETURNING t.id`, stamp, JSON.stringify(due));
    const done = due.filter(d => set.some(s => s.id === d.id));
    if (!done.length) return;
    await run(env, `UPDATE units SET readiness = 'dirty', updated_at = ? WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND readiness IN ('occupied','ready')`,
      stamp, JSON.stringify(done.map(d => d.unit).filter(Boolean)));
    await run(env, `
      INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
      SELECT NULL, 'Automatic', 'task.guest_left', 'tasks', x.id, NULL, x.after, 'system', ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, after text)`,
      stamp, JSON.stringify(done.map(d => ({ id: d.id, after: JSON.stringify({ guestLeftAt: d.at, auto: true, reason: `Automatic, at checkout ${d.time}` }) }))));
  } catch { /* the next read tries again */ }
}
