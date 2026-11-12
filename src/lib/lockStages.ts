/** The month's lock categories (functions/_lib/stageLocks.ts Stage): Revenue (income), Cleaning, Utilities, Add. ded.
 *  (additional), Misc and O2 (Unit report locks, chew 13 Nov 2026). Shared by the Unit report and the work pages' lock bars. */
export type Stage = 'income' | 'cleaning' | 'utilities' | 'additional' | 'misc' | 'o2';
export const STAGES: Stage[] = ['income', 'cleaning', 'utilities', 'additional', 'misc', 'o2'];
export const STAGE_LABEL: Record<Stage, string> = { income: 'Revenue', cleaning: 'Cleaning', utilities: 'Utilities', additional: 'Add. ded.', misc: 'Misc', o2: 'O2' };
