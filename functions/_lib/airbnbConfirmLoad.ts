import { type Env, all } from './db';
import { finalMonthsFor } from './expenses';
import { incomeLockedMonths } from './ownerLocks';
import { UNIT_SQL, termsFor, statementSettings, type Query, type UnitRow } from './ownerStatement';
import { isTenancy } from './revenueModel';
import { NET_FROM_MONTH, netOf, planLine, type Plan, type StayMoney } from './airbnbConfirm';
import type { Line } from './airbnbRecon';

/* Airbnb reconciliation, step 2: what planning a confirmation reads from the database, shared by the month view (the
   confirm window lists the plan) and the confirmation itself (which plans again, from fresh figures). */

/** A unit's owner, and how the owner's income follows a stay: a share contract's percentage, or null (fixed rent,
 *  master lease, long-term let). `guarantee`: a share contract with a minimum, where a month the minimum was paid
 *  may not move with the stay. */
export interface UnitOwner { unitId: string; ownerId: string; ownerName: string; unit: string; ownerPct: number | null; guarantee: boolean }
export interface ConfirmContext { finals: Map<string, Set<string>>; units: Map<string, UnitOwner>; locked: Map<string, Set<string>> }

/** For every unit of these lines, in three queries: the months whose owner statement is final (from Oct 2026), and its
 *  owner and current contract as the statements read it (termsFor). */
export async function confirmContext(env: Env, lines: readonly Line[]): Promise<ConfirmContext> {
  const unitIds = [...new Set(lines.flatMap(l => l.stays.map(s => s.unitId)))];
  if (!unitIds.length) return { finals: new Map(), units: new Map(), locked: new Map() };
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const [finals, rows, settings, locked] = await Promise.all([
    finalMonthsFor(env, unitIds, NET_FROM_MONTH),
    all<UnitRow>(env, `${UNIT_SQL} WHERE u.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(unitIds)),
    statementSettings(q),
    incomeLockedMonths(env, unitIds),
  ]);
  // A month whose income is locked (owner report close) is neither final nor open here: the confirmed figure changes
  // the live month only, its statement keeps the locked income, and syncLateIncome posts the owner's difference,
  // worked out again through the contract, on the next open month.
  for (const [unitId, months] of locked) for (const m of months) finals.get(unitId)?.delete(m);
  const units = new Map<string, UnitOwner>();
  for (const u of rows) {
    const t = termsFor(u, settings.defaultFeePct);
    const ownerPct = t.basis === 'share' && !isTenancy(t.model) && t.ownerPct != null ? Number(t.ownerPct) : null;
    units.set(u.id, {
      unitId: u.id, ownerId: u.owner_id, ownerName: u.owner_name, unit: u.unit_code || u.unit_number, ownerPct,
      guarantee: ownerPct != null && (Number(t.guarantee) > 0 || Number(t.yearlyGuarantee ?? 0) > 0),
    });
  }
  return { finals, units, locked };
}

const moneyOf = (l: Line): StayMoney[] =>
  l.stays.map(s => ({ id: s.id, unitId: s.unitId, checkIn: s.checkIn, checkOut: s.checkOut, state: s.state, gross: s.gross ?? null, fee: s.fee ?? null }));

/** Does confirming take a line to check to Airbnb's figure (chew on a refund after the payment: "每笔自己看")? */
export const setsAirbnbFigure = (line: Line, setAmount: boolean) => setAmount && line.action === 'check' && line.newAmount != null;

/** planLine with what the context read. */
export function planWith(ctx: ConfirmContext, line: Line, today: string, setAmount = false): Plan {
  const l = setsAirbnbFigure(line, setAmount) ? { ...line, action: 'set_amount' as const } : line;
  return planLine(l, moneyOf(line), today, u => ctx.finals.get(u) ?? new Set(), u => ctx.units.get(u)?.ownerPct ?? null, u => ctx.locked.get(u) ?? new Set());
}

/** What the confirm window lists: each reservation before and after (its state, guest total and net) with the open
 *  months whose statement follows when generated again, and each owner's share for a month already final, with the
 *  statement it goes on. */
export interface Preview {
  ok: boolean; message: string | null;
  changes: {
    reservationId: string; unit: string; state: { before: string; after: string }; gross: { before: number; after: number }; net: { before: number; after: number };
    fee: number; openMonths: string[];
  }[];
  shares: { unit: string; owner: string; sen: number; months: string[]; onMonth: string; guarantee: boolean }[];
}
export function previewOf(ctx: ConfirmContext, line: Line, plan: Plan): Preview {
  if (!plan.ok) return { ok: false, message: plan.message, changes: [], shares: [] };
  const stay = new Map(line.stays.map(s => [s.id, s]));
  return {
    ok: true, message: null,
    changes: plan.changes.map(c => {
      const fee = stay.get(c.id)?.fee ?? 0;
      return {
        reservationId: c.id, unit: stay.get(c.id)?.unit ?? c.unitId, state: { before: c.before.state, after: c.after.state },
        gross: { before: c.before.gross ?? 0, after: c.after.gross ?? 0 },
        net: { before: netOf({ gross: c.before.gross, fee }), after: c.after.state === 'cancelled' ? 0 : netOf({ gross: c.after.gross, fee }) },
        fee, openMonths: c.openMonths,
      };
    }),
    shares: plan.shares.map(x => {
      const u = ctx.units.get(x.unitId);
      return { unit: u?.unit ?? stay.get(x.reservationId)?.unit ?? x.unitId, owner: u?.ownerName ?? '', sen: x.sen, months: x.months, onMonth: x.onMonth, guarantee: !!u?.guarantee };
    }),
  };
}
