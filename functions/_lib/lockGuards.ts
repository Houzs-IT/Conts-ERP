/** What the routes that write costs and owner adjustments ask about a locked month (owner statement close; plan
 *  docs/superpowers/plans/2026-11-11-owner-report-locks-part2a-deductions-o2.md): the notice a person sees when what
 *  they add goes to a later month, and the refusal when they would remove what a locked month holds. The wording is in
 *  stageLocks.ts. A new cost never lands in a locked month whatever writes it (the expenses trigger, migration 0303);
 *  these only say so. */
import { type Env, one } from './db';
import { monthLabel, rolledText, editedText, refusedText } from './stageLocks';

/** The unit as owner statements name it: building and unit number. */
export async function unitLabel(env: Env, unitId: string): Promise<string> {
  const r = await one<{ name: string }>(env, `SELECT p.name || ' ' || u.unit_number AS name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, unitId);
  return r?.name ?? 'this unit';
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
