/** Owner report stage locks: the rules, with no database and no imports, so node --test can load this file
 *  (src/lib/stageLocks.test.mjs). Spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md.
 *
 *  chew, 11 Nov 2026: each month's owner report is checked in stages (income, deductions, O2) and each stage, once
 *  checked, is locked unit by unit. A locked figure never changes again; a change that arrives later goes to the next
 *  month that is still open, as an owner adjustment, and is never dropped.
 *
 *  chew, 13 Nov 2026 (docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md): six lock categories, locked
 *  on the Unit report by clicking the amount: Revenue (stored as `income`), Cleaning, Utilities, Add. ded. (`additional`),
 *  Misc and O2. The single deductions lock is split into the four ("这个我想要分开", "这个也分开可以吗"). */

export type Stage = 'income' | 'cleaning' | 'utilities' | 'additional' | 'misc' | 'o2';
/** In the order the Unit report shows them. */
export const STAGES: Stage[] = ['income', 'cleaning', 'utilities', 'additional', 'misc', 'o2'];
/** The categories that keep costs: each cost is under exactly one (costStageOf). */
export const COST_STAGES = ['cleaning', 'utilities', 'additional'] as const;
export type CostStage = typeof COST_STAGES[number];
/** The late update turns the locked categories live one at a time in this order (lateShares); O2 posts nothing late. */
export const LATE_STAGES: Stage[] = ['income', 'cleaning', 'utilities', 'additional', 'misc'];
/** The categories as the Unit report's columns and buttons name them. */
export const STAGE_LABEL: Record<Stage, string> = { income: 'Revenue', cleaning: 'Cleaning', utilities: 'Utilities', additional: 'Add. ded.', misc: 'Misc', o2: 'O2' };
const NAME: Record<Stage, string> = { income: 'income', cleaning: 'cleaning', utilities: 'utilities', additional: 'other deductions', misc: 'misc', o2: 'O2' };
/** The category in a sentence ('October 2026 other deductions are locked'). The Revenue lock is the income lock. */
export const stageName = (stage: Stage): string => NAME[stage];
const plural = (stage: Stage) => stage === 'utilities' || stage === 'additional';

/** The lock category of a cost, by the statement's own split (ownerStatement.ts classifyCost): cleaning; the four bills
 *  (electricity, water, internet, Indah Water); everything else charged to the owner. The migration 0323 trigger does
 *  the same in SQL. */
export function costStageOf(category: string, description: string | null): CostStage {
  if (category === 'cleaning' || category === 'housekeeping') return 'cleaning';
  if (category === 'electricity' || category === 'water' || category === 'internet' || category === 'sewerage') return 'utilities';
  if (category === 'utilities' && /indah|sewer|iwk/i.test(description ?? '')) return 'utilities';
  return 'additional';
}

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

/** Whether a unit can be locked on a step, by its contract's basis (termsFor). Every category but O2: a share only
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

/** Each step's share of a unit-month's late difference (sen). `statement`: the owner's payout before adjustments as the
 *  statement takes it (every lock's figures); `runs[k]`: the same with the first k + 1 locked categories of the late
 *  update (LATE_STAGES, in order) turned live. A category the unit has not locked changes nothing between two runs, so
 *  its share is 0. Each lock carries the change in its own part: a misc change that a reservation brings goes with the
 *  Misc lock when misc is locked, and with Revenue when it is not (misc then follows the live occupancy). The company's
 *  figure (companyFigure) is shared out the same way. */
export function lateShares(statement: number, runs: number[]): number[] {
  return runs.map((r, k) => r - (k ? runs[k - 1] : statement));
}

/** The company's figure of a unit-month (sen): what the gross leaves after the deductions and what the owner is due before
 *  adjustments. It is the reports' Gain / Loss (GP less the owner base) on a share, a guarantee and a long-term let.
 *  A late change's company share is this figure live less as locked, split between the locks by splitLate, and it
 *  lands on the month the owner's share goes to (chew's choice A, 11 Nov 2026: "A：算进下个月"). */
export const companyFigure = (m: { gross: number; deductions: number; payoutBeforeAdjustments: number; topUp?: number; yearlyGuarantee?: boolean }): number =>
  // A yearly guarantee's top-up (its contract year's last month) is not in the reports' owner base (O1 only), so it is
  // left out here too: a lock must not change the company's figure from what the reports work out (review finding).
  m.gross - m.deductions - m.payoutBeforeAdjustments + (m.yearlyGuarantee ? m.topUp ?? 0 : 0);

/** The owner adjustment's description for a lock's late difference (owners read it on their statement). */
export const lateText = (stage: Stage, unitLabel: string, label: string): string =>
  `Late change to ${unitLabel} ${stageName(stage)} for ${label} (${stageName(stage)} locked)`;

/** A notice is worked out after the change it is about has been saved, so a failure there must never turn a saved change
 *  into an error (the person would try again and, say, record a payment twice: review finding). Any failure gives
 *  `fallback`, and is logged. */
export async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try { return await work(); } catch (e) { console.error('A notice was skipped:', e); return fallback; }
}

/** A late change named by its month and category ('October 2026 income'), for a screen that already shows the unit (the
 *  company views). Before 13 Nov 2026 the deductions lock wrote 'deductions'; that still reads. Any other text, such as
 *  a carried row's, is returned as it is. */
// The name in brackets must be the one before ' for' (\1), so 'other deductions' is not read as 'deductions'.
const LATE_RE = /^Late change to .+ (income|deductions|cleaning|utilities|other deductions|misc) for (.+) \(\1 locked\)$/;
export const lateLabel = (description: string): string => {
  const m = LATE_RE.exec(description);
  return m ? `${m[2]} ${m[1]}` : description;
};

/* What people are told about a locked or final month: every route and screen uses these, not its own wording. */
/** 'October 2026 utilities are locked for Vista 22-04.' */
export const lockedText = (stage: Stage, unitLabel: string, label: string): string =>
  `${label} ${stageName(stage)} ${plural(stage) ? 'are' : 'is'} locked for ${unitLabel}.`;
/** A new cost dated in a closed month goes on the next open statement. */
export const rolledText = (unitLabel: string, fromLabel: string, toLabel: string, why: 'locked' | 'final', stage: CostStage): string =>
  `${why === 'locked' ? lockedText(stage, unitLabel, fromLabel) : `The ${fromLabel} statement is final for ${unitLabel}.`} This cost goes on the ${toLabel} statement.`;
/** A cost changed on a month whose category is locked: the month keeps it as locked, the difference moves on. */
export const editedText = (unitLabel: string, label: string, stage: CostStage): string =>
  `${lockedText(stage, unitLabel, label)} The ${label} statement keeps the old amount; the difference goes to the next open month as an owner adjustment.`;
/** A reservation added, changed or cancelled in a month whose income is locked: the month keeps its locked figures and
 *  the difference goes on. `toLabel`: the month it goes to, when there is one locked month to name it from. */
export const incomeNoticeText = (unitLabel: string, lockedLabels: string[], toLabel: string | null): string =>
  `${lockedLabels.join(' and ')} income ${lockedLabels.length > 1 ? 'are' : 'is'} locked for ${unitLabel}. The difference goes to ${lockedLabels.length === 1 && toLabel ? toLabel : 'the next open month'}.`;
/** Something a locked month holds cannot be removed or changed until the step is unlocked. */
export const refusedText = (stage: Stage, unitLabel: string, label: string): string =>
  `${lockedText(stage, unitLabel, label)} Ask someone who can unlock a step to unlock ${plural(stage) ? 'them' : 'it'} first.`;
/** A new owner adjustment dated in a month whose O2 is locked is dated into the next open month. */
export const movedO2Text = (unitLabel: string, fromLabel: string, toLabel: string): string =>
  `${lockedText('o2', unitLabel, fromLabel)} This owner adjustment is dated ${toLabel}.`;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Why a unit's Revenue cannot be locked yet (its Airbnb reservations still to confirm), or null: the one thing that holds
 *  a lock back (spec goal 4). */
export const notReadyText = (toConfirm: number): string | null =>
  toConfirm > 0 ? `${toConfirm} Airbnb ${toConfirm === 1 ? 'reservation' : 'reservations'} still to confirm on Airbnb reconciliation.` : null;

/** Hints on Cleaning (a warning, never a block: spec call 4): check-outs with no cleaning charged. Amounts in sen. */
export function cleaningChecks(x: { checkouts: number; cleaning: number }): string[] {
  return x.checkouts > 0 && x.cleaning === 0 ? [`${x.checkouts} check-out${x.checkouts === 1 ? '' : 's'}, no cleaning charged`] : [];
}

/** Hints on Utilities: the contract ended in the month or before, yet bills are charged. `contractEnd` and `monthEnd`
 *  are YYYY-MM-DD; amounts in sen. */
export function utilitiesChecks(x: { utilities: number; contractEnd: string | null; monthEnd: string }): string[] {
  const end = x.contractEnd?.slice(0, 10);
  return end && end <= x.monthEnd && x.utilities > 0 ? [`Contract ended ${Number(end.slice(8, 10))} ${MON[Number(end.slice(5, 7)) - 1]}: check the bills`] : [];
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

/* Part 3, GP and final (chew, 11 Nov 2026). An owner's statement can be made final only once every step that lists one
 * of the owner's units is locked for the month (spec goal 7); Unlock final follows how far the payout has gone (spec
 * calls 5 and 6, agreed "可以"). */

/** One unit of an owner on the month's steps: the categories that list it (every category but O2 on a share, O2 for
 *  every unit on the statement: monthSteps) and the ones locked. */
export interface FinalUnit { unitId: string; label: string; steps: Stage[]; locked: Stage[] }

/** The units still waiting before Make final, each with the steps not yet locked, in step order. Empty: it can be made final. */
export function finalWaiting(units: FinalUnit[]): { unitId: string; label: string; stages: Stage[] }[] {
  return units.flatMap(u => {
    const stages = STAGES.filter(s => u.steps.includes(s) && !u.locked.includes(s));
    return stages.length ? [{ unitId: u.unitId, label: u.label, stages }] : [];
  });
}

/** 'Revenue, Misc and O2': the categories as the Unit report names them. */
const stageList = (stages: Stage[]): string => {
  const names = stages.map(s => STAGE_LABEL[s]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
};

/** 'Waiting: Misc and O2' for an owner with one unit; 'Waiting: B-16-05 (B) O2' otherwise, at most two units named
 *  ('Waiting: X Revenue; Y O2; 2 more units'). */
export function waitingText(waiting: { label: string; stages: Stage[] }[], ownerUnits: number): string {
  if (ownerUnits <= 1 && waiting.length === 1) return `Waiting: ${stageList(waiting[0].stages)}`;
  const named = waiting.slice(0, 2).map(w => `${w.label} ${stageList(w.stages)}`);
  const more = waiting.length - 2;
  return `Waiting: ${[...named, ...(more > 0 ? [`${more} more unit${more === 1 ? '' : 's'}`] : [])].join('; ')}`;
}

export type FinalUnlock = { kind: 'draft'; cancelPayout: string | null } | { kind: 'paid' } | { kind: 'refused'; problem: string };

/** What Unlock final does, from the statement's state and its latest payout that is not cancelled (null when none):
 *    not paid (final, or sent with the payout pending or failed): back to draft, the payout cancelled;
 *    the transfer under way (processing): refused until it is paid or has failed;
 *    paid: the statement and its payout stay; the month is worked out again and the difference goes to the next open
 *          month as an owner adjustment. */
export function unlockFinalPlan(statementState: string, payout: { id: string; state: string } | null): FinalUnlock {
  if (statementState === 'provisional') return { kind: 'refused', problem: 'This statement is a draft, so there is nothing to unlock.' };
  if (statementState === 'paid' || payout?.state === 'paid') return { kind: 'paid' };
  if (payout?.state === 'processing') return { kind: 'refused', problem: 'The payout is being transferred. Unlock the statement once the transfer is paid or has failed.' };
  return { kind: 'draft', cancelPayout: payout && (payout.state === 'pending' || payout.state === 'failed') ? payout.id : null };
}

/** The owner adjustment's description for a paid statement's difference after Unlock final. */
export const finalUnlockText = (unitLabel: string, label: string): string => `Change to ${unitLabel} for ${label} after it was paid (statement unlocked)`;
