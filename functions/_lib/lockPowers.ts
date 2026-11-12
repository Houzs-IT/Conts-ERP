/** Who may lock and unlock each category (Unit report click-to-lock, spec
 *  docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md). The powers are the ones chew gives person by
 *  person in Users and roles ("lock 的功能我会自己assign 去相关做的同事去lock"): Revenue is Lock income; Cleaning,
 *  Utilities, Add. ded. and Misc are Lock deductions; O2 is Lock O2; every unlock is Unlock a step. */
import { can } from './access';
import { STAGES, type Stage } from './stageLocks';

/** A signed-in person as the access checks read them (requireSession's session). */
type Session = Parameters<typeof can>[0];

export const LOCK_POWER: Record<Stage, { area: string; permission: string }> = {
  income: { area: 'lockIncome', permission: 'Lock income' },
  cleaning: { area: 'lockDeductions', permission: 'Lock deductions' },
  utilities: { area: 'lockDeductions', permission: 'Lock deductions' },
  additional: { area: 'lockDeductions', permission: 'Lock deductions' },
  misc: { area: 'lockDeductions', permission: 'Lock deductions' },
  o2: { area: 'lockO2', permission: 'Lock O2' },
};

/** What this person may do with the month's locks, as the screens show it. */
export function lockMay(session: Session): { lock: Record<Stage, boolean>; unlock: boolean } {
  return {
    lock: Object.fromEntries(STAGES.map(s => [s, can(session, LOCK_POWER[s].area, 'edit')])) as Record<Stage, boolean>,
    unlock: can(session, 'unlockStep', 'edit'),
  };
}

/** Whether the person holds any lock power or Unlock a step. */
export const anyLockPower = (session: Session): boolean => {
  const may = lockMay(session);
  return may.unlock || STAGES.some(s => may.lock[s]);
};
