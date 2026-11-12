/** Owner report stage locks: the rules, with no database and no imports, so node --test can load this file
 *  (src/lib/stageLocks.test.mjs). Spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md.
 *
 *  chew, 11 Nov 2026: each month's owner report is checked in stages (income, deductions, O2) and each stage, once
 *  checked, is locked unit by unit. A locked figure never changes again; a change that arrives later goes to the next
 *  month that is still open, as an owner adjustment, and is never dropped. */

export type Stage = 'income' | 'deductions' | 'o2';
export const STAGES: Stage[] = ['income', 'deductions', 'o2'];

/** No month before this can be locked: September 2026 and earlier come from the owner workbook and are paid. */
export const LOCK_FROM = '2026-10';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Why `month` cannot be locked on `today` (YYYY-MM-DD, Malaysia time), or null. A month still running would freeze
 *  half its reservations and send every later one to the next month as a late change (review finding 3). */
export function lockMonthProblem(month: string, today: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return 'Month must look like 2026-10.';
  if (month < LOCK_FROM) return 'Locks start from October 2026.';
  return month >= today.slice(0, 7) ? `${monthLabel(month)} has not ended yet.` : null;
}

/** Whether a unit can be locked on a step, by its contract's basis (termsFor). Income and deductions: a share only
 *  (long-term lets included). A master lease has no owner statement. A fixed rent (GRR) pays the owner the same whatever
 *  the unit earns or costs; it is no longer a contract type (owner, 4 Nov 2026, migration 0206: the database refuses it
 *  on a contract and on a unit, and no unit on production is one), so it is left off these steps rather than built for
 *  (part 2b ruling, 12 Nov 2026). O2: every unit on the statement. */
export const lockable = (stage: Stage, basis: string): boolean => stage === 'o2' || basis === 'share';
export const incomeLockable = (basis: string): boolean => lockable('income', basis);

/** The month after `month` (YYYY-MM). */
export function monthAfter(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** 'October 2026' for '2026-10'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** The first month after `month` that is not closed (a final statement, or, from part 2, a locked O2). */
export function openMonthAfter(month: string, closed: ReadonlySet<string>): string {
  let m = monthAfter(month);
  while (closed.has(m)) m = monthAfter(m);
  return m;
}

/** An owner adjustment already posted for a lock's late difference. `movable`: it can still be changed or withdrawn
 *  (the statement it falls on is not final). `onDraft`: a draft statement prints it, so changing or withdrawing it
 *  means that draft must be generated again before it is marked final (finalise refuses it until then). */
export interface PostedLate { id: string; month: string; amount: number; movable: boolean; onDraft?: boolean }

export type LatePlan =
  | { kind: 'none' }
  | { kind: 'insert'; month: string; amount: number }
  | { kind: 'update'; id: string; amount: number }
  | { kind: 'remove'; id: string };

/** What to write so that the lock's posted adjustments add up to `diff` (sen: live owner payout less frozen). The
 *  difference still to post goes on the open adjustment already on `target` when there is one, else on a new one;
 *  less than a sen is left alone. */
export function planLate(diff: number, posted: PostedLate[], target: string): LatePlan {
  const remaining = Math.round(diff - posted.reduce((n, p) => n + p.amount, 0));
  const open = posted.find(p => p.month === target && p.movable);
  if (Math.abs(remaining) < 1) return { kind: 'none' };
  if (open) {
    const amount = open.amount + remaining;
    return amount === 0 ? { kind: 'remove', id: open.id } : { kind: 'update', id: open.id, amount };
  }
  return { kind: 'insert', month: target, amount: remaining };
}

export interface UnlockPlan { problem: string | null; remove: string[]; carried: { amount: number; months: string[] } | null; regenerate: string[] }

/** Unlocking brings the month back to today's data (spec call 9): the adjustments the lock posted that can still be
 *  withdrawn are removed; any that already sit on a final statement stay there, and the unlocked month carries the
 *  same amount back (`carried`), so the owner is never paid twice. A month whose own statement is final is refused.
 *  `regenerate`: the months whose draft statement printed a withdrawn adjustment and must be generated again. */
export function planUnlock(posted: PostedLate[], monthIsFinal: boolean, label: string): UnlockPlan {
  if (monthIsFinal) return { problem: `The ${label} statement is final. Unlock the final statement first.`, remove: [], carried: null, regenerate: [] };
  const stay = posted.filter(p => !p.movable);
  const amount = stay.reduce((n, p) => n + p.amount, 0);
  const remove = posted.filter(p => p.movable);
  return {
    problem: null,
    remove: remove.map(p => p.id),
    carried: stay.length && amount !== 0 ? { amount, months: [...new Set(stay.map(p => p.month))].sort() } : null,
    regenerate: [...new Set(remove.filter(p => p.onDraft).map(p => p.month))].sort(),
  };
}

/** A unit-month's owner payout before adjustments (sen), worked out three ways for the late update: `statement` as the
 *  statement takes it (every lock's figures); `incomeLive` with today's income but the locked costs, misc worked out
 *  from today's occupancy (needed only when income and deductions are both locked); `live` from today's data alone. */
export interface LateRun { statement: number; incomeLive?: number; live: number }

/** Each lock's share of a unit-month's late difference. Income comes first, then deductions, so a misc change that a
 *  reservation brings (misc follows occupancy) goes with the income difference (spec call 11); with income unlocked,
 *  the deductions lock carries it. */
export function splitLate(r: LateRun, locked: { income: boolean; deductions: boolean }): { income?: number; deductions?: number } {
  if (locked.income && locked.deductions) {
    const mid = r.incomeLive ?? r.live;
    return { income: mid - r.statement, deductions: r.live - mid };
  }
  if (locked.income) return { income: r.live - r.statement };
  if (locked.deductions) return { deductions: r.live - r.statement };
  return {};
}

/** The company's figure of a unit-month (sen): what the gross leaves after the deductions and what the owner is due before
 *  adjustments. It is the reports' Gain / Loss (GP less the owner base) on a share, a guarantee and a long-term let.
 *  A late change's company share is this figure live less as locked, split between the locks by splitLate, and it
 *  lands on the month the owner's share goes to (chew's choice A, 11 Nov 2026: "A：算进下个月"). */
export const companyFigure = (m: { gross: number; deductions: number; payoutBeforeAdjustments: number; topUp?: number; yearlyGuarantee?: boolean }): number =>
  // A yearly guarantee's top-up (its contract year's last month) is not in the reports' owner base (O1 only), so it is
  // left out here too: a lock must not change the company's figure from what the reports work out (review finding).
  m.gross - m.deductions - m.payoutBeforeAdjustments + (m.yearlyGuarantee ? m.topUp ?? 0 : 0);

/** The owner adjustment's description for a lock's late difference. */
export const lateText = (stage: 'income' | 'deductions', unitLabel: string, label: string): string =>
  `Late change to ${unitLabel} ${stage} for ${label} (${stage} locked)`;

/** A notice is worked out after the change it is about has been saved, so a failure there must never turn a saved change
 *  into an error (the person would try again and, say, record a payment twice: review finding). Any failure gives
 *  `fallback`, and is logged. */
export async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try { return await work(); } catch (e) { console.error('A notice was skipped:', e); return fallback; }
}

/** A late change named by its month and step ('October 2026 income'), for a screen that already shows the unit (the
 *  company views). Any other text, such as a carried row's, is returned as it is. */
export const lateLabel = (description: string): string => {
  const m = /^Late change to .+ (income|deductions) for (.+) \((?:income|deductions) locked\)$/.exec(description);
  return m ? `${m[2]} ${m[1]}` : description;
};

/* What people are told about a locked or final month: every route and screen uses these, not its own wording. */
const STAGE_NAME: Record<Stage, string> = { income: 'income', deductions: 'deductions', o2: 'O2' };
/** 'October 2026 deductions are locked for Vista 22-04.' */
export const lockedText = (stage: Stage, unitLabel: string, label: string): string =>
  `${label} ${STAGE_NAME[stage]} ${stage === 'deductions' ? 'are' : 'is'} locked for ${unitLabel}.`;
/** A new cost dated in a closed month goes on the next open statement. */
export const rolledText = (unitLabel: string, fromLabel: string, toLabel: string, why: 'locked' | 'final'): string =>
  `${why === 'locked' ? lockedText('deductions', unitLabel, fromLabel) : `The ${fromLabel} statement is final for ${unitLabel}.`} This cost goes on the ${toLabel} statement.`;
/** A cost changed on a month whose deductions are locked: the month keeps it as locked, the difference moves on. */
export const editedText = (unitLabel: string, label: string): string =>
  `${lockedText('deductions', unitLabel, label)} The ${label} statement keeps the old amount; the difference goes to the next open month as an owner adjustment.`;
/** A reservation added, changed or cancelled in a month whose income is locked: the month keeps its locked figures and
 *  the difference goes on. `toLabel`: the month it goes to, when there is one locked month to name it from. */
export const incomeNoticeText = (unitLabel: string, lockedLabels: string[], toLabel: string | null): string =>
  `${lockedLabels.join(' and ')} income ${lockedLabels.length > 1 ? 'are' : 'is'} locked for ${unitLabel}. The difference goes to ${lockedLabels.length === 1 && toLabel ? toLabel : 'the next open month'}.`;
/** Something a locked month holds cannot be removed or changed until the step is unlocked. */
export const refusedText = (stage: Stage, unitLabel: string, label: string): string =>
  `${lockedText(stage, unitLabel, label)} Ask someone who can unlock a step to unlock ${stage === 'deductions' ? 'them' : 'it'} first.`;
/** A new owner adjustment dated in a month whose O2 is locked is dated into the next open month. */
export const movedO2Text = (unitLabel: string, fromLabel: string, toLabel: string): string =>
  `${lockedText('o2', unitLabel, fromLabel)} This owner adjustment is dated ${toLabel}.`;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Hints on the Deductions step (a warning, never a block: spec call 4). `contractEnd` and `monthEnd` are YYYY-MM-DD;
 *  amounts in sen. */
export function deductionChecks(x: { checkouts: number; cleaning: number; utilities: number; contractEnd: string | null; monthEnd: string }): string[] {
  const out: string[] = [];
  if (x.checkouts > 0 && x.cleaning === 0) out.push(`${x.checkouts} check-out${x.checkouts === 1 ? '' : 's'}, no cleaning charged`);
  const end = x.contractEnd?.slice(0, 10);
  if (end && end <= x.monthEnd && x.utilities > 0) out.push(`Contract ended ${Number(end.slice(8, 10))} ${MON[Number(end.slice(5, 7)) - 1]}: check the bills`);
  return out;
}

/** Hints on the O2 step. `held`: the unit's owner adjustments held back (sen; a debt is negative); `repeats`: its
 *  owner adjustments this month that match one of the month before (`prevMonth`, e.g. 'September'). */
export function o2Checks(x: { held: number; repeats: number; prevMonth: string }): string[] {
  const out: string[] = [];
  if (x.held !== 0) out.push(`Held debt RM ${(Math.abs(x.held) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} not released`);
  if (x.repeats > 0) out.push(`Repeats ${x.repeats === 1 ? 'one' : x.repeats} from ${x.prevMonth}`);
  return out;
}

/** The balancing line on an unlocked month whose difference was already settled on later statements. */
export const carriedText = (labels: string[]): string => `Already settled on the ${labels.join(' and ')} statement`;
/** The company's balancing row on an unlocked month whose late change already counted in later months. */
export const companyCarriedText = (labels: string[]): string => `Already counted in ${labels.join(' and ')}`;
