/** Airbnb reconciliation, step 2: what confirming a reservation writes, worked out without the database (tested in
 *  src/lib/airbnbConfirm.test.mjs). chew's points, 11 Nov 2026:
 *    1. a new amount sets the reservation's guest total so its net (guest total − Airbnb's fee, as the owner statement
 *       reads it from Oct 2026) is Airbnb's; the fee stays;
 *    2. a month whose owner statement is already final gets the owner's share of the change on the next open month's
 *       statement, by the owner's contract: a share contract its percentage, fixed rent / master lease / long-term let
 *       nothing (their income does not follow the stay);
 *    3. undone while the statements it touched are still open;
 *    4. confirming needs edit access to Airbnb reconciliation;
 *    5. lines that only record company income can be confirmed together;
 *    6. company income is the company's: no owner share, no setting.
 *  Amounts in sen. A value import would stop node --test reading this file, so its few date helpers are its own. */
import type { Line } from './airbnbRecon';

/** Statements read a stay's net from this month on; earlier months read collected revenue, so a change gives nothing. */
export const NET_FROM_MONTH = '2026-10';
export const COUNTED = ['confirmed', 'checked_in', 'checked_out'];

export interface StayMoney { id: string; unitId: string; checkIn: string; checkOut: string; state: string; gross: number | null; fee: number | null }
export const netOf = (s: Pick<StayMoney, 'gross' | 'fee'>) => Math.max(0, (s.gross ?? 0) - (s.fee ?? 0));

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((t(b) - t(a)) / DAY));
const monthEndEx = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 2026". */
export const monthName = (month: string) => `${MON[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** The first month from `month` on whose owner statement is not final (as src/lib/deductMonth.ts firstOpenMonth). */
export function openMonthFrom(month: string, finals: ReadonlySet<string>): string {
  let m = month;
  while (finals.has(m)) m = monthEndEx(m).slice(0, 7);
  return m;
}

/** The months a stay has nights in. */
export function stayMonths(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  if (checkOut <= checkIn) return out;
  let m = checkIn.slice(0, 7);
  const last = new Date(t(checkOut) - DAY).toISOString().slice(0, 7);
  while (m <= last) { out.push(m); m = monthEndEx(m).slice(0, 7); }
  return out;
}

/** A code's new net over its counted stays, in proportion to their nets now (largest remainder, to the sen); stays
 *  with no net yet share it equally. */
export function splitNet(newNet: number, stays: ReadonlyArray<{ id: string; net: number }>): Map<string, number> {
  const out = new Map<string, number>();
  if (!stays.length) return out;
  const base = stays.reduce((n, s) => n + s.net, 0);
  const weights = base > 0 ? stays.map(s => s.net) : stays.map(() => 1);
  const total = weights.reduce((n, w) => n + w, 0);
  const exact = weights.map(w => (newNet * w) / total);
  const shares = exact.map(Math.floor);
  let left = newNet - shares.reduce((n, x) => n + x, 0);
  const order = exact.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; shares[i]! += 1; left -= 1; }
  stays.forEach((s, i) => out.set(s.id, shares[i]!));
  return out;
}

/** The owner's share of a change of `deltaNet` to one stay, for its months whose statement is final (each month's part
 *  by its nights). `ownerPctOf` gives the owner's percentage that month, or null when the owner's income does not follow
 *  the stay. Rounded once; the months it came from. */
export function ownerShareOfChange(
  deltaNet: number, stay: { checkIn: string; checkOut: string }, finalMonths: ReadonlySet<string>, ownerPctOf: (month: string) => number | null,
): { sen: number; months: string[] } {
  const total = nightsBetween(stay.checkIn, stay.checkOut);
  if (!deltaNet || total <= 0) return { sen: 0, months: [] };
  let share = 0;
  const months: string[] = [];
  for (const m of stayMonths(stay.checkIn, stay.checkOut)) {
    if (!finalMonths.has(m) || m < NET_FROM_MONTH) continue;
    const pct = ownerPctOf(m);
    if (pct == null) continue;
    const from = `${m}-01` > stay.checkIn ? `${m}-01` : stay.checkIn;
    const to = monthEndEx(m) < stay.checkOut ? monthEndEx(m) : stay.checkOut;
    share += (deltaNet * nightsBetween(from, to) / total) * pct / 100;
    months.push(m);
  }
  return { sen: Math.round(share), months };
}

/** One reservation changed. `openMonths`: its months the change reaches (from Oct 2026) whose statement was still open
 *  when confirmed; one of them final by the time of an undo means that statement already has the new amount. */
export interface StayChange {
  id: string; unitId: string; before: { gross: number | null; state: string }; after: { gross: number | null; state: string }; openMonths: string[];
}
/** The owner's share of a change for final months, and the open month's statement it goes on. */
export interface OwnerShare { unitId: string; reservationId: string; sen: number; months: string[]; onMonth: string }
export type Plan = { ok: true; changes: StayChange[]; shares: OwnerShare[] } | { ok: false; message: string };

/** What confirming one line changes on its reservations, and the owner's share for final months. set_amount: the
 *  code's counted stays to Airbnb's net. cancel: a past stay is marked cancelled (one still to come is cancelled on
 *  the reservation itself, where its nights reopen). Anything else changes no reservation. */
export function planLine(
  line: Pick<Line, 'code' | 'action' | 'newAmount'>, stays: ReadonlyArray<StayMoney>, today: string,
  finalMonthsOf: (unitId: string) => ReadonlySet<string>, ownerPctOf: (unitId: string, month: string) => number | null,
): Plan {
  const counted = stays.filter(s => COUNTED.includes(s.state));
  const changes: StayChange[] = [];
  const shares: OwnerShare[] = [];
  const reached = (s: StayMoney, all: boolean) => stayMonths(s.checkIn, s.checkOut).filter(m => all || m >= NET_FROM_MONTH);
  const change = (s: StayMoney, after: StayChange['after'], all: boolean) => changes.push({
    id: s.id, unitId: s.unitId, before: { gross: s.gross, state: s.state }, after, openMonths: reached(s, all).filter(m => !finalMonthsOf(s.unitId).has(m)),
  });
  const share = (s: StayMoney, delta: number) => {
    const finals = finalMonthsOf(s.unitId);
    const o = ownerShareOfChange(delta, s, finals, m => ownerPctOf(s.unitId, m));
    if (o.sen !== 0) shares.push({ unitId: s.unitId, reservationId: s.id, sen: o.sen, months: o.months, onMonth: openMonthFrom(o.months[o.months.length - 1]!, finals) });
  };
  if (line.action === 'set_amount') {
    if (line.newAmount == null || line.newAmount <= 0) return { ok: false, message: `${line.code}: there is no amount above RM 0.00 to set. Check it by hand.` };
    if (!counted.length) return { ok: false, message: `${line.code}: no reservation in the system to set the amount on.` };
    const nets = splitNet(line.newAmount, counted.map(s => ({ id: s.id, net: netOf(s) })));
    for (const s of counted) {
      const net = nets.get(s.id)!;
      const gross = net + (s.fee ?? 0);
      if (gross === s.gross) continue;
      change(s, { gross, state: s.state }, false);
      share(s, net - netOf(s));
    }
  } else if (line.action === 'cancel') {
    for (const s of counted) {
      if (s.checkOut > today) return { ok: false, message: `${line.code}: the stay is still to come. Cancel it on the reservation itself, so its nights open again.` };
      // Before Oct 2026 a statement reads the money collected, which a cancellation takes off whole.
      if (s.checkIn.slice(0, 7) < NET_FROM_MONTH) return { ok: false, message: `${line.code}: the stay has nights before ${monthName(NET_FROM_MONTH)}, whose statements read the money collected. Check it by hand.` };
      change(s, { gross: s.gross, state: 'cancelled' }, true);
      share(s, -netOf(s));
    }
  }
  return { ok: true, changes, shares };
}

/** Lines that only record company income (no reservation to change, nothing to look at by hand) can be confirmed
 *  together (chew's point 5). R10, cancelled but paid, is confirmed one by one (her spec: "confirm each"). */
export const bulkEligible = (l: Pick<Line, 'needsConfirm' | 'action' | 'rule'>) => l.needsConfirm && l.action === 'none' && l.rule !== 'R10';

/** A company income line's key in a confirmation: its Airbnb lines. */
export const incomeKey = (i: { txnIds: readonly string[] }) => i.txnIds.join(',');

export interface TypeRow { id: string; parentId: string | null; name: string; active: boolean }
/** A type for one company income line: an active type, and one of its active sub-types when it has any. */
export function checkIncomeType(types: readonly TypeRow[], typeId: string | null | undefined, subTypeId: string | null | undefined):
  { ok: true; typeId: string; subTypeId: string | null } | { ok: false; message: string } {
  const type = types.find(x => x.id === typeId && !x.parentId);
  if (!type) return { ok: false, message: 'choose its type.' };
  if (!type.active) return { ok: false, message: `${type.name} is inactive now; choose another type.` };
  const subs = types.filter(x => x.parentId === type.id && x.active);
  if (!subs.length) return { ok: true, typeId: type.id, subTypeId: null };
  const sub = subs.find(x => x.id === subTypeId);
  return sub ? { ok: true, typeId: type.id, subTypeId: sub.id } : { ok: false, message: `choose the kind of ${type.name}.` };
}

/** How the owner's statement names the credit or charge: the reservation, and the statement that was already final. */
export function adjustmentText(code: string, action: string, months: readonly string[]): string {
  const after = `after the ${months.map(monthName).join(' and ')} statement`;
  return action === 'cancel' ? `Airbnb reservation ${code}: refunded to the guest ${after}` : `Airbnb reservation ${code}: amount corrected ${after}`;
}

/** What a confirmation wrote, kept on the decision so it can be undone. */
export interface Applied { changes: StayChange[]; shares: (OwnerShare & { adjustmentId: string })[]; incomeIds: string[] }

/** Why a confirmation can no longer be undone (chew's point 3), or null. `stays`: the reservations now; `adjustments`:
 *  the owner credits and charges it made, now (gone ones are skipped), `final` when a final statement carries one. */
export function undoProblem(applied: Applied, now: {
  stays: ReadonlyMap<string, { gross: number | null; state: string }>;
  finalMonthsOf: (unitId: string) => ReadonlySet<string>;
  adjustments: ReadonlyMap<string, { state: string; final: boolean }>;
}): string | null {
  for (const c of applied.changes) {
    const s = now.stays.get(c.id);
    if (!s || s.gross !== c.after.gross || s.state !== c.after.state) {
      return 'The reservation has changed since it was confirmed, so undoing would overwrite that. Correct it on the reservation instead.';
    }
    const final = c.openMonths.find(m => now.finalMonthsOf(c.unitId).has(m));
    if (final) return `The ${monthName(final)} owner statement is final now and already has the new amount.`;
  }
  for (const s of applied.shares) {
    const a = now.adjustments.get(s.adjustmentId);
    if (a && (a.final || a.state !== 'open')) {
      return `The owner’s ${s.sen > 0 ? 'credit' : 'charge'} it made is on a final statement now, or was held or settled.`;
    }
  }
  return null;
}
