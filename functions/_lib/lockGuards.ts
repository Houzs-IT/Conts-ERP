/** What the routes that write costs and owner adjustments ask about a locked month (owner statement close; plan
 *  docs/superpowers/plans/2026-11-11-owner-report-locks-part2a-deductions-o2.md): the notice a person sees when what
 *  they add goes to a later month, and the refusal when they would remove what a locked month holds. The wording is in
 *  stageLocks.ts. A new cost never lands in a locked month whatever writes it (the expenses trigger, migration 0303);
 *  these only say so. */
import { type Env, one, all } from './db';
import { monthLabel, rolledText, editedText, refusedText, movedO2Text, openMonthAfter, incomeNoticeText } from './stageLocks';
import { closedMonthsFor, lockedMonthsFor } from './ownerLocks';
import { stayMonths } from './airbnbConfirm';
import { UNIT_SQL, unitForMonth, type UnitRow } from './ownerStatement';
import { modelOf } from './revenueModel';

/** The unit as owner statements name it: building and unit number. */
export async function unitLabel(env: Env, unitId: string): Promise<string> {
  const r = await one<{ name: string }>(env, `SELECT p.name || ' ' || u.unit_number AS name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, unitId);
  return r?.name ?? 'this unit';
}

/** Whether a reservation in this state and on this channel counts in the owner statement's income (loadInputs). */
export const countsAsIncome = (state: string, channel: string): boolean =>
  ['confirmed', 'checked_in', 'checked_out'].includes(state) && !['maintenance_block', 'owner_stay'].includes(channel);

/** What someone changing a reservation's income is told when any of `months` has the unit's income locked (owner
 *  statement close part 2b): the month keeps its locked figures and the late update takes the difference to the next
 *  open month, named when one locked month is involved. Null when none is locked. */
export async function incomeNotice(env: Env, unitId: string, months: string[]): Promise<string | null> {
  if (!unitId || !months.length) return null;
  const locked = (await lockedMonthsFor(env, [unitId], 'income')).get(unitId);
  const hit = [...new Set(months)].filter(m => locked?.has(m)).sort();
  if (!hit.length) return null;
  let to: string | null = null;
  if (hit.length === 1) {
    const closed = (await closedMonthsFor(env, [unitId], hit[0], 'o2')).get(unitId) ?? new Set<string>();
    to = monthLabel(openMonthAfter(hit[0], closed));
  }
  return incomeNoticeText(await unitLabel(env, unitId), hit.map(monthLabel), to);
}

/** The months a stay has nights in, from its stored dates. */
export const stayMonthsOf = (checkIn: string, checkOut: string): string[] => stayMonths(String(checkIn).slice(0, 10), String(checkOut).slice(0, 10));

/** The notice for money recorded against a reservation, added or removed: only a booking with no host payout takes its
 *  income from what is recorded (ownerStatement.ts stayIncomeParts), so only such a booking is told. */
export async function paymentIncomeNotice(env: Env, reservationId: string): Promise<string | null> {
  const r = await one<{ unit_id: string; state: string; channel: string; check_in: string; check_out: string; payout: number }>(env,
    'SELECT unit_id, state, channel, check_in, check_out, GREATEST(0, gross_booking_value - COALESCE(channel_fee, 0)) AS payout FROM reservations WHERE id = ?', reservationId);
  if (!r || !countsAsIncome(r.state, r.channel) || Number(r.payout) > 0) return null;
  return incomeNotice(env, r.unit_id, stayMonthsOf(r.check_in, r.check_out));
}

/** Whether `month`'s deductions are locked for the unit. */
export async function deductionsLocked(env: Env, unitId: string, month: string): Promise<boolean> {
  return !!(await one(env, `SELECT 1 AS x FROM owner_report_locks WHERE unit_id = ? AND stage = 'deductions' AND month = ?`, unitId, month));
}

/** A cost just written whose deduction month is later than its own month: where it went, and why (its month's
 *  deductions are locked, or its statement is final). Null when it stayed in its own month. */
export async function costNotice(env: Env, c: { unitId: string; incurredOn: string; deductMonth: string }): Promise<string | null> {
  const own = c.incurredOn.slice(0, 7);
  if (!c.deductMonth || c.deductMonth <= own) return null;
  const why = (await deductionsLocked(env, c.unitId, own)) ? 'locked' : 'final';
  return rolledText(await unitLabel(env, c.unitId), monthLabel(own), monthLabel(c.deductMonth), why);
}

/** A cost changed on a month whose deductions are locked: that month keeps it as locked and the late update posts the
 *  difference to the next open month. Null when the month is not locked. */
export async function editNotice(env: Env, unitId: string, deductMonth: string): Promise<string | null> {
  return (await deductionsLocked(env, unitId, deductMonth)) ? editedText(await unitLabel(env, unitId), monthLabel(deductMonth)) : null;
}

/** Why a cost on a month whose deductions are locked cannot be removed, or null. */
export async function costLockProblem(env: Env, unitId: string, deductMonth: string): Promise<string | null> {
  return (await deductionsLocked(env, unitId, deductMonth)) ? refusedText('deductions', await unitLabel(env, unitId), monthLabel(deductMonth)) : null;
}

/* O2 (owner adjustments). A statement being built for a month whose O2 is locked takes only what the lock kept
   (ownerStatement.ts computeMonth); these keep the dates of that month still, so the history reads the same. */

/** The unit an owner adjustment counts on in `month`: its own, or (with none) the owner's first unit as the statement
 *  picks it: by building, then unit number, the first that is not a master lease. */
async function o2UnitFor(env: Env, ownerId: string, unitId: string | null, month: string): Promise<string | null> {
  if (unitId) return unitId;
  const units = (await all<UnitRow>(env, `${UNIT_SQL} WHERE u.owner_id = ? ORDER BY p.name, u.unit_number`, ownerId)).map(u => unitForMonth(u, month));
  return (units.find(u => modelOf(u) !== 'master_lease') ?? units[0])?.id ?? null;
}

const o2Locked = async (env: Env, unitId: string, month: string) =>
  !!(await one(env, `SELECT 1 AS x FROM owner_report_locks WHERE unit_id = ? AND stage = 'o2' AND month = ?`, unitId, month));

/** The date a new owner adjustment dated `date` gets: its own, or the first day of the next open month when its
 *  month's O2 is locked for the unit it counts on (with the notice that says so). */
export async function o2Date(env: Env, ownerId: string, unitId: string | null, date: string): Promise<{ occurredOn: string; notice: string | null }> {
  const month = date.slice(0, 7);
  const unit = await o2UnitFor(env, ownerId, unitId, month);
  if (!unit || !(await o2Locked(env, unit, month))) return { occurredOn: date, notice: null };
  const next = openMonthAfter(month, (await closedMonthsFor(env, [unit], month, 'o2')).get(unit) ?? new Set());
  return { occurredOn: `${next}-01`, notice: movedO2Text(await unitLabel(env, unit), monthLabel(month), monthLabel(next)) };
}

/** Why an owner adjustment cannot be held, settled or deleted: an O2 lock kept it, or it is dated in a month whose O2
 *  is locked for the unit it counts on (a held one being deleted changes no month, so only what a lock kept stops it). */
export async function o2LockProblem(env: Env, a: { id: string; owner_id: string; unit_id: string | null; occurred_on: string; state: string }, action: 'hold' | 'settle' | 'delete'): Promise<string | null> {
  const kept = await one<{ unit_id: string; month: string }>(env, `SELECT unit_id, month FROM owner_report_locks
    WHERE stage = 'o2' AND frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', ?::text)) LIMIT 1`, a.id);
  if (kept) return refusedText('o2', await unitLabel(env, kept.unit_id), monthLabel(kept.month));
  if (action === 'delete' && a.state === 'held') return null;
  const month = String(a.occurred_on).slice(0, 7);
  const unit = await o2UnitFor(env, a.owner_id, a.unit_id, month);
  return unit && (await o2Locked(env, unit, month)) ? refusedText('o2', await unitLabel(env, unit), monthLabel(month)) : null;
}

/** Why a held owner adjustment cannot be released into `month` (its O2 is locked for the unit it counts on), with the
 *  month it can go into instead; null when it can. */
export async function releaseProblem(env: Env, a: { owner_id: string; unit_id: string | null }, month: string): Promise<string | null> {
  const unit = await o2UnitFor(env, a.owner_id, a.unit_id, month);
  if (!unit || !(await o2Locked(env, unit, month))) return null;
  const next = openMonthAfter(month, (await closedMonthsFor(env, [unit], month, 'o2')).get(unit) ?? new Set());
  return `${refusedText('o2', await unitLabel(env, unit), monthLabel(month))} Release it into ${monthLabel(next)} instead.`;
}
