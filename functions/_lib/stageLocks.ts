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

/** Whether a unit's income can be locked, by its contract's basis (termsFor): only a share. A fixed rent or a master
 *  lease pays the owner the same whatever the unit earns, so a lock there would only freeze the company's own figures
 *  (review finding 4; where the company's part of a late change goes is chew's call). */
export const incomeLockable = (basis: string): boolean => basis === 'share';

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

/** The owner adjustment's description for a lock's late difference. */
export const lateText = (unitLabel: string, label: string): string => `Late change to ${unitLabel} income for ${label} (income locked)`;

/** The balancing line on an unlocked month whose difference was already settled on later statements. */
export const carriedText = (labels: string[]): string => `Already settled on the ${labels.join(' and ')} statement`;
