/** Owner report stage locks: locking a month's income, deductions and O2 unit by unit, unlocking them, and the late
 *  update (spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md, plans
 *  docs/superpowers/plans/2026-11-11-owner-report-locks-part1-income.md and …-part2a-deductions-o2.md). The rules are in
 *  stageLocks.ts.
 *
 *  A locked month is worked out from what its locks kept (ownerStatement.ts: FrozenIncome, FrozenDeductions, FrozenO2),
 *  so its figures never change. A reservation changed afterwards (Airbnb reconciliation, an edit, a cancellation from
 *  HostPlatform or Channex), or a cost changed on a month whose deductions are locked, changes only the live figures;
 *  syncLate compares the two and keeps one owner adjustment per lock on the next open month for the difference in what
 *  the owner is due (spec call 10: worked out again through the contract, guarantee included, not a flat %; a
 *  yearly-guarantee unit's is held for a person to check). Income first, then deductions (stageLocks.ts splitLate). */
import { type Env, all, one, run, transaction, nowIso, audit } from './db';
import { auditMany, type AuditEntry } from './history';
import {
  loadInputs, computeMonth, statementSettings, withYearToDate, freezeIncome, freezeDeductions, freezeO2, withoutMisc, termsFor, unitForMonth,
  hasLocksTable, hasCompanyLateTable, hasActivity, type Query, type Inputs, type UnitMonth,
} from './ownerStatement';
import { monthEndExclusive } from './revenue';
import { modelOf } from './revenueModel';
import { finalMonthsFor } from './expenses';
import {
  type Stage, STAGES, openMonthAfter, planLate, planUnlock, carriedText, companyCarriedText, companyFigure, lateText, monthLabel, lockable, splitLate,
  type PostedLate,
} from './stageLocks';

export interface LockRow { id: string; month: string; unit_id: string; stage: Stage; locked_by_name: string; locked_at: string }

const FINAL = `('finalised','sent','paid')`;
const ids = (list: string[]) => JSON.stringify([...new Set(list)]);
const queryOf = (env: Env): Query => (sql, ...args) => all(env, sql, ...args);

/** The advisory lock that puts the late update, unlocking and statement generation one after another: each reads the
 *  owner adjustments the others write (review findings 1 and 2). */
export const LATE_INCOME_LOCK = 'owner-report-late-income';
const takeLateIncomeLock = (tx: Env) => one(tx, 'SELECT 1 AS x FROM (SELECT pg_advisory_xact_lock(hashtext(?::text))) k', LATE_INCOME_LOCK);

/** The owners whose statement for `month` is final (finalised, sent or paid). */
async function finalOwners(env: Env, month: string): Promise<Set<string>> {
  return new Set((await all<{ owner_id: string }>(env, `SELECT DISTINCT owner_id FROM owner_statements WHERE period_start = ? AND state IN ${FINAL}`, `${month}-01`)).map(r => r.owner_id));
}

/** For each unit, the months from `fromMonth` on that are closed for `stage`: final for the unit's owner, or locked for
 *  that stage on the unit. "Next open month" for a late cost (deductions) or a late owner adjustment (o2). */
export async function closedMonthsFor(env: Env, unitIds: string[], fromMonth: string, stage: Stage): Promise<Map<string, Set<string>>> {
  const out = await finalMonthsFor(env, unitIds, fromMonth);
  if (!unitIds.length || !(await hasLocksTable(queryOf(env)))) return out;
  const rows = await all<{ unit_id: string; month: string }>(env, `SELECT unit_id, month FROM owner_report_locks
    WHERE stage = ? AND month >= ? AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, stage, fromMonth, ids(unitIds));
  for (const r of rows) { const s = out.get(r.unit_id) ?? new Set<string>(); s.add(r.month); out.set(r.unit_id, s); }
  return out;
}

/** The units on a month's income step: those with something in the month's owner statement whose income can be
 *  locked (not a fixed rent or a master lease), with their income lock, and whether their owner's statement for the
 *  month is final (a unit that is final and not locked cannot be locked any more). Airbnb reconciliation shows how many
 *  are locked; Owner statement close counts them the same way (closeSteps). */
export async function incomeStep(env: Env, month: string): Promise<{ inputs: Inputs; rows: UnitMonth[]; locks: Map<string, LockRow>; finals: Set<string>; counts: { locked: number; total: number } }> {
  const q = queryOf(env);
  const [settings, loaded, locks, finals] = await Promise.all([statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month)), locksFor(env, month), finalOwners(env, month)]);
  const inputs = await withYearToDate(q, loaded, month, settings);
  const rows = computeMonth(month, inputs, settings, 'dated').filter(r => hasActivity(r) && lockable('income', r.terms.basis));
  const income = new Map(locks.filter(l => l.stage === 'income').map(l => [l.unit_id, l]));
  return {
    inputs, rows, locks: income, finals,
    counts: { locked: rows.filter(r => income.has(r.unitId)).length, total: rows.filter(r => income.has(r.unitId) || !finals.has(r.ownerId)).length },
  };
}

/** Everything Owner statement close shows for a month: the month worked out as its statements do (`dated`, every lock
 *  applied) and as a statement being built now would take its owner adjustments (`open`), each unit's locks, the owners
 *  whose statement is final, the debts held back per unit (a held one with no unit counts on the owner's first unit),
 *  which units each step lists and how many of them are locked. */
export async function closeSteps(env: Env, month: string): Promise<{
  inputs: Inputs; dated: UnitMonth[]; open: UnitMonth[]; locks: Map<string, Partial<Record<Stage, LockRow>>>; finals: Set<string>;
  held: Map<string, number>; steps: Record<Stage, string[]>; counts: Record<Stage, { locked: number; total: number }>;
}> {
  const q = queryOf(env);
  const [settings, loaded, locks, finals, statements] = await Promise.all([
    statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month)), locksFor(env, month), finalOwners(env, month),
    all<{ id: string; owner_id: string }>(env, 'SELECT id, owner_id FROM owner_statements WHERE period_start = ?', `${month}-01`),
  ]);
  const inputs = await withYearToDate(q, loaded, month, settings);
  const dated = computeMonth(month, inputs, settings, 'dated');
  const statementOf = new Map(statements.map(s => [s.owner_id, s.id]));
  const open = computeMonth(month, inputs, settings, 'open', ownerId => statementOf.get(ownerId) ?? null);
  const byUnit = new Map<string, Partial<Record<Stage, LockRow>>>();
  for (const l of locks) { const x = byUnit.get(l.unit_id) ?? {}; x[l.stage] = l; byUnit.set(l.unit_id, x); }
  const openOf = new Map(open.map(r => [r.unitId, r]));
  const steps: Record<Stage, string[]> = {
    income: dated.filter(r => hasActivity(r) && lockable('income', r.terms.basis)).map(r => r.unitId),
    deductions: dated.filter(r => hasActivity(r) && lockable('deductions', r.terms.basis)).map(r => r.unitId),
    o2: dated.filter(r => hasActivity(r) || (openOf.get(r.unitId)?.adjustmentIds.length ?? 0) > 0).map(r => r.unitId),
  };
  const ownerOf = new Map(dated.map(r => [r.unitId, r.ownerId]));
  const counts = Object.fromEntries(STAGES.map(stage => [stage, {
    locked: steps[stage].filter(id => byUnit.get(id)?.[stage]).length,
    total: steps[stage].filter(id => byUnit.get(id)?.[stage] || !finals.has(ownerOf.get(id) ?? '')).length,
  }])) as Record<Stage, { locked: number; total: number }>;

  // Debts held back (held owner adjustments that are charges). One with no unit counts on the owner's first unit, as
  // the statement would put it once released.
  const firstOf = new Map<string, string>();
  for (const u of inputs.units) {
    if (firstOf.has(u.owner_id)) continue;
    const ofOwner = inputs.units.filter(x => x.owner_id === u.owner_id).map(x => unitForMonth(x, month));
    firstOf.set(u.owner_id, (ofOwner.find(x => modelOf(x) !== 'master_lease') ?? ofOwner[0]).id);
  }
  const heldRows = inputs.units.length ? await all<{ owner_id: string; unit_id: string | null; amount: number }>(env, `
    SELECT owner_id, unit_id, sum(amount)::int AS amount FROM owner_adjustments WHERE state = 'held' AND amount < 0
      AND owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) GROUP BY owner_id, unit_id`, ids(inputs.units.map(u => u.owner_id))) : [];
  const held = new Map<string, number>();
  for (const h of heldRows) {
    const unitId = h.unit_id ?? firstOf.get(h.owner_id);
    if (unitId) held.set(unitId, (held.get(unitId) ?? 0) + Number(h.amount));
  }
  return { inputs, dated, open, locks: byUnit, finals, held, steps, counts };
}

/** The locks of a month, for some units or all. */
export async function locksFor(env: Env, month: string, unitIds?: string[]): Promise<LockRow[]> {
  if (!(await hasLocksTable(queryOf(env)))) return [];
  return all<LockRow>(env, `SELECT id, month, unit_id, stage, locked_by_name, locked_at FROM owner_report_locks WHERE month = ?
    ${unitIds ? 'AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''} ORDER BY unit_id, stage`, month, ...(unitIds ? [ids(unitIds)] : []));
}

/** The company's share of late changes that counts in each unit-month from `fromMonth` to `toMonth` (both included), by
 *  `${unitId}|${month}`: the total and each row (its description and amount), oldest first. All units when `unitIds`
 *  is null. Empty until migration 0304 has run. The company views add it to the company's result for the month. */
export async function companyLateFor(env: Env, unitIds: string[] | null, fromMonth: string, toMonth: string): Promise<Map<string, { amount: number; items: { label: string; amount: number }[] }>> {
  const out = new Map<string, { amount: number; items: { label: string; amount: number }[] }>();
  if ((unitIds && !unitIds.length) || !(await hasCompanyLateTable(queryOf(env)))) return out;
  const rows = await all<{ unit_id: string; month: string; amount: number; description: string }>(env, `
    SELECT unit_id, month, amount, description FROM company_late_changes WHERE month >= ? AND month <= ?
    ${unitIds ? 'AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''} ORDER BY month, created_at, id`,
    fromMonth, toMonth, ...(unitIds ? [ids(unitIds)] : []));
  for (const r of rows) {
    const key = `${r.unit_id}|${r.month}`;
    const x = out.get(key) ?? { amount: 0, items: [] };
    x.amount += Number(r.amount);
    x.items.push({ label: r.description, amount: Number(r.amount) });
    out.set(key, x);
  }
  return out;
}

/** How many units are on the month's income step, and how many of them have their income locked: the figures Owner
 *  statement close shows on its Income step (Airbnb reconciliation shows them too). */
export async function incomeLockCounts(env: Env, month: string): Promise<{ locked: number; total: number }> {
  return (await incomeStep(env, month)).counts;
}

/** For each unit, the months whose `stage` is locked. */
export async function lockedMonthsFor(env: Env, unitIds: string[], stage: Stage): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!unitIds.length || !(await hasLocksTable(queryOf(env)))) return out;
  const rows = await all<{ unit_id: string; month: string }>(env,
    `SELECT unit_id, month FROM owner_report_locks WHERE stage = ? AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, stage, ids(unitIds));
  for (const r of rows) { const s = out.get(r.unit_id) ?? new Set<string>(); s.add(r.month); out.set(r.unit_id, s); }
  return out;
}

/** For each unit, the months whose income is locked. */
export const incomeLockedMonths = (env: Env, unitIds: string[]) => lockedMonthsFor(env, unitIds, 'income');

/** Locks one step of `month` for these units. Each lock keeps what the month is worked out from now: income, the stays
 *  (and a long-term let's rent); deductions, the costs and the misc charge; O2, the owner adjustments its statement
 *  takes. Left as they are, and listed apart: a unit already locked (`already`); one that cannot be locked on this step
 *  (`notLockable`: a fixed rent or master lease on income and deductions); one whose owner's statement for the month is
 *  final (`final`: a lock would keep today's figures, not what that statement paid); an id that is not a unit
 *  (`unknown`). Every unit of the ticked units' owners is loaded, so each owner's first unit (which carries an owner
 *  adjustment with no unit) is the one the statement uses. */
export async function lockStage(env: Env, who: { userId: string; fullName: string }, month: string, stage: Stage, unitIds: string[]):
  Promise<{ locked: string[]; already: string[]; notLockable: string[]; final: string[]; unknown: string[] }> {
  const q = queryOf(env);
  const owners = (await all<{ owner_id: string }>(env, 'SELECT DISTINCT owner_id FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(unitIds))).map(r => r.owner_id);
  const [settings, inputs, existing, finals, statements] = await Promise.all([
    statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month), { ownerIds: owners }), locksFor(env, month, unitIds), finalOwners(env, month),
    stage === 'o2' ? all<{ id: string; owner_id: string }>(env, 'SELECT id, owner_id FROM owner_statements WHERE period_start = ?', `${month}-01`) : Promise.resolve([]),
  ]);
  const known = new Set(inputs.units.map(u => u.id));
  const unknown = unitIds.filter(id => !known.has(id));
  const ticked = new Set(unitIds);
  const already = new Set(existing.filter(l => l.stage === stage).map(l => l.unit_id));
  // The month as its statement works it out now, with every other lock applied (deductions), or as a statement being
  // built now would take its owner adjustments (O2).
  const statementOf = new Map(statements.map(s => [s.owner_id, s.id]));
  const rows = stage === 'income' ? [] : computeMonth(month, inputs, settings, stage === 'o2' ? 'open' : 'dated', ownerId => statementOf.get(ownerId) ?? null);
  const notLockable: string[] = [], final: string[] = [];
  const toLock: { id: string; unit_id: string; frozen: unknown }[] = [];
  for (const u of inputs.units) {
    if (!ticked.has(u.id) || already.has(u.id)) continue;
    const terms = termsFor(unitForMonth(u, month), settings.defaultFeePct);
    if (!lockable(stage, terms.basis)) { notLockable.push(u.id); continue; }
    if (finals.has(u.owner_id)) { final.push(u.id); continue; }
    const m = rows.find(r => r.unitId === u.id);
    const frozen = stage === 'income' ? freezeIncome(u.id, month, inputs.stays, terms)
      : stage === 'deductions' ? freezeDeductions(m!, inputs.costs) : freezeO2(m!, inputs.adjustments);
    toLock.push({ id: `lock-${crypto.randomUUID()}`, unit_id: u.id, frozen });
  }
  // ON CONFLICT: a unit locked by someone else a moment ago counts as already locked.
  const inserted = toLock.length ? await all<{ unit_id: string }>(env, `
    INSERT INTO owner_report_locks (id, month, unit_id, stage, frozen, locked_by, locked_by_name, locked_at)
    SELECT x.id, ?, x.unit_id, ?, x.frozen, ?, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, frozen jsonb)
    ON CONFLICT (month, unit_id, stage) DO NOTHING RETURNING unit_id`,
    month, stage, who.userId, who.fullName, nowIso(), JSON.stringify(toLock)) : [];
  const locked = inserted.map(r => r.unit_id);
  if (locked.length) {
    await auditMany(env, locked.map(id => ({ actorId: who.userId, actorLabel: who.fullName, action: 'owner_report.lock', entityTable: 'units', entityId: id, after: { month, stage } })));
  }
  return { locked, already: [...already, ...toLock.map(r => r.unit_id).filter(id => !locked.includes(id))], notLockable, final, unknown };
}

/** Locks `month`'s income for these units (lockStage). */
export const lockIncome = (env: Env, who: { userId: string; fullName: string }, month: string, unitIds: string[]) => lockStage(env, who, month, 'income', unitIds);

/** The adjustments these locks have posted, by lock id: whether each can still be changed (open or held, on no
 *  statement or on one that is still a draft, and not kept by an O2 lock) and whether a draft statement prints it. One
 *  query for any number of locks. */
async function postedFor(env: Env, lockIds: string[]): Promise<Map<string, PostedLate[]>> {
  const out = new Map<string, PostedLate[]>(lockIds.map(id => [id, []]));
  if (!lockIds.length) return out;
  const rows = await all<{ id: string; reference: string; month: string; amount: number; movable: boolean; on_draft: boolean | null }>(env, `
    SELECT a.id, a.reference, substr(a.occurred_on, 1, 7) AS month, a.amount,
           (a.state IN ('open','held') AND (a.statement_id IS NULL OR s.state = 'provisional')
             AND NOT EXISTS (SELECT 1 FROM owner_report_locks k WHERE k.stage = 'o2' AND k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id)))) AS movable,
           (s.state = 'provisional') AS on_draft
    FROM owner_adjustments a LEFT JOIN owner_statements s ON s.id = a.statement_id
    WHERE a.source = 'stage_lock' AND a.reference IN (SELECT 'stage-lock:' || x FROM jsonb_array_elements_text(?::text::jsonb) x)
    ORDER BY a.occurred_on, a.id`, ids(lockIds));
  for (const r of rows) {
    out.get(r.reference.slice('stage-lock:'.length))?.push({ id: r.id, month: r.month, amount: Number(r.amount), movable: !!r.movable, onDraft: !!r.on_draft });
  }
  return out;
}

/** Unlocks one step of one unit's month (a reason is required by the route). Brings the month back to today's data:
 *  the late differences it posted that can still change are withdrawn; any already settled on a final statement (or
 *  kept by an O2 lock) stay, and the month carries the same amount back so the owner is not paid twice, dated on the
 *  first month from it whose O2 is open. Refused while the month itself is final. `regenerate`: the months whose draft
 *  printed a withdrawn difference (finalise refuses them until generated again). An O2 lock posted nothing: unlocking it
 *  lets the month's statement take today's owner adjustments again. */
export async function unlockStage(env: Env, who: { userId: string; fullName: string }, month: string, stage: Stage, unitId: string, reason: string): Promise<{ ok: true; regenerate: string[] } | { problem: string; status: 404 | 409 }> {
  return transaction(env, async tx => {
    // After any late update already running: one that read this lock must not post for it once it is gone.
    await takeLateIncomeLock(tx);
    const lock = await one<{ id: string; owner_id: string }>(tx, `
      SELECT l.id, u.owner_id FROM owner_report_locks l JOIN units u ON u.id = l.unit_id
      WHERE l.month = ? AND l.unit_id = ? AND l.stage = ? FOR UPDATE OF l`, month, unitId, stage);
    if (!lock) return { problem: 'That step is not locked for this unit.', status: 404 as const };
    const final = !!(await one(tx, `SELECT 1 AS x FROM owner_statements WHERE owner_id = ? AND period_start = ? AND state IN ${FINAL}`, lock.owner_id, `${month}-01`));
    const plan = planUnlock((await postedFor(tx, [lock.id])).get(lock.id) ?? [], final, monthLabel(month));
    if (plan.problem) return { problem: plan.problem, status: 409 as const };
    const at = nowIso();
    // A carried amount goes on the unlocked month, or the first month from it whose O2 is open.
    const closed = (await closedMonthsFor(tx, [unitId], month, 'o2')).get(unitId) ?? new Set<string>();
    const on = closed.has(month) ? openMonthAfter(month, closed) : month;
    if (plan.remove.length) await run(tx, 'DELETE FROM owner_adjustments WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(plan.remove));
    if (plan.carried) {
      const amount = -plan.carried.amount;
      await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'stage_lock', ?, ?, ?)`,
        `adj-lock-${crypto.randomUUID()}`, lock.owner_id, unitId, amount >= 0 ? 'credit' : 'charge', amount,
        carriedText(plan.carried.months.map(monthLabel)), `${on}-01`, `stage-lock-carried:${lock.id}`, who.userId, at, at);
    }
    // The company's share (chew's choice A) the same way: a row on a month that is O2-locked or final is settled and
    // stays, and the unlocked month takes the opposite amount, so the company counts the change once.
    let company = { withdrawn: 0, carried: 0 };
    if (await hasCompanyLateTable(queryOf(tx))) {
      const rows = await all<{ id: string; month: string; amount: number }>(tx,
        'SELECT id, month, amount FROM company_late_changes WHERE reference = ? ORDER BY month, id', `stage-lock:${lock.id}`);
      const c = planUnlock(rows.map(r => ({ id: r.id, month: r.month, amount: Number(r.amount), movable: !closed.has(r.month) })), false, monthLabel(month));
      if (c.remove.length) await run(tx, 'DELETE FROM company_late_changes WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(c.remove));
      if (c.carried) {
        await run(tx, `INSERT INTO company_late_changes (id, unit_id, month, amount, description, reference, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          `clc-${crypto.randomUUID()}`, unitId, on, -c.carried.amount, companyCarriedText(c.carried.months.map(monthLabel)), `stage-lock-carried:${lock.id}`, at, at);
      }
      company = { withdrawn: c.remove.length, carried: c.carried?.amount ?? 0 };
    }
    await run(tx, 'DELETE FROM owner_report_locks WHERE id = ?', lock.id);
    await audit(tx, { actorId: who.userId, actorLabel: who.fullName, action: 'owner_report.unlock', entityTable: 'units', entityId: unitId,
      after: { month, stage, reason, withdrawn: plan.remove.length, carried: plan.carried?.amount ?? 0, company } });
    return { ok: true as const, regenerate: plan.regenerate };
  });
}

/** For every income and deductions lock in scope: its share of the difference between what the owner is due on the live
 *  figures and on the locked ones (income first, then deductions: stageLocks.ts splitLate), kept as one owner
 *  adjustment on the next open month (inserted, topped up or withdrawn); a month whose O2 is locked is not open. The
 *  company's share of the same difference (companyFigure, chew's choice A) is kept the same way in company_late_changes,
 *  on the same month; a row whose month has since been O2-locked or made final stays as it is. Safe to run as often as
 *  anything calls it (statement generation, Airbnb reconciliation, the 15-minute cron): the writes happen in one
 *  transaction under one advisory lock, and each lock posts only what is still missing. `months`: the months whose
 *  statement the update changed (or would change, with dryRun): generate them again. */
export async function syncLate(env: Env, scope: { unitIds?: string[]; ownerIds?: string[] } = {}, o: { dryRun?: boolean } = {}): Promise<{
  inserted: number; updated: number; removed: number; planned: number; months: string[]; company: { inserted: number; updated: number; removed: number };
}> {
  const out = { inserted: 0, updated: 0, removed: 0, planned: 0, months: [] as string[], company: { inserted: 0, updated: 0, removed: 0 } };
  const q = queryOf(env);
  if (!(await hasLocksTable(q))) return out;
  if ((scope.unitIds && !scope.unitIds.length) || (scope.ownerIds && !scope.ownerIds.length)) return out;
  const locks = await all<{ id: string; month: string; unit_id: string; owner_id: string; stage: 'income' | 'deductions' }>(env, `
    SELECT l.id, l.month, l.unit_id, l.stage, u.owner_id FROM owner_report_locks l JOIN units u ON u.id = l.unit_id WHERE l.stage IN ('income', 'deductions')
    ${scope.unitIds ? 'AND l.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : scope.ownerIds ? 'AND u.owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''}
    ORDER BY l.month, l.unit_id, l.stage`, ...(scope.unitIds ? [ids(scope.unitIds)] : scope.ownerIds ? [ids(scope.ownerIds)] : []));
  if (!locks.length) return out;

  // What each lock's difference is now, month by month (a few months at most: the ones still being closed).
  const settings = await statementSettings(q);
  const due: { lockId: string; stage: 'income' | 'deductions'; ownerId: string; unitId: string; month: string; diff: number; companyDiff: number; target: string; held: boolean; text: string }[] = [];
  for (const month of [...new Set(locks.map(l => l.month))]) {
    const mine = locks.filter(l => l.month === month);
    const unitIds = [...new Set(mine.map(l => l.unit_id))];
    const inputs = await withYearToDate(q, await loadInputs(q, `${month}-01`, monthEndExclusive(month), { unitIds }), month, settings);
    const has = (unitId: string, stage: 'income' | 'deductions') => mine.some(l => l.unit_id === unitId && l.stage === stage);
    const statement = computeMonth(month, inputs, settings, 'dated');
    const both = unitIds.some(id => has(id, 'income') && has(id, 'deductions'));
    const incomeLive = both ? computeMonth(month, { ...inputs, frozen: undefined, deductions: withoutMisc(inputs.deductions) }, settings, 'dated') : [];
    const live = computeMonth(month, { ...inputs, frozen: undefined, deductions: undefined }, settings, 'dated');
    const closed = await closedMonthsFor(env, unitIds, month, 'o2');
    for (const unitId of unitIds) {
      const s = statement.find(r => r.unitId === unitId), v = live.find(r => r.unitId === unitId), x = incomeLive.find(r => r.unitId === unitId);
      const unit = inputs.units.find(u => u.id === unitId);
      if (!s || !v || !unit) continue;
      const locked = { income: has(unitId, 'income'), deductions: has(unitId, 'deductions') };
      const split = splitLate({ statement: s.payoutBeforeAdjustments, incomeLive: x?.payoutBeforeAdjustments, live: v.payoutBeforeAdjustments }, locked);
      // The company's share, split the same way: what the change leaves the company after the owner's share.
      const companySplit = splitLate({ statement: companyFigure(s), incomeLive: x ? companyFigure(x) : undefined, live: companyFigure(v) }, locked);
      const target = openMonthAfter(month, closed.get(unitId) ?? new Set());
      const held = termsFor(unitForMonth(unit, month), settings.defaultFeePct).model === 'management_yearly_guarantee';
      for (const l of mine.filter(k => k.unit_id === unitId)) {
        due.push({ lockId: l.id, stage: l.stage, ownerId: l.owner_id, unitId, month, target, held,
          diff: (l.stage === 'income' ? split.income : split.deductions) ?? 0,
          companyDiff: (l.stage === 'income' ? companySplit.income : companySplit.deductions) ?? 0,
          text: lateText(l.stage, `${unit.property_name} ${unit.unit_number}`, monthLabel(month)) });
      }
    }
  }

  await transaction(env, async tx => {
    await takeLateIncomeLock(tx);
    const alive = new Set((await all<{ id: string }>(tx, 'SELECT id FROM owner_report_locks WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(due.map(d => d.lockId)))).map(r => r.id));
    const posted = await postedFor(tx, [...alive]);
    // The company's rows already posted, by lock. One on a month that is now O2-locked or final for the unit is settled.
    const company = alive.size > 0 && await hasCompanyLateTable(queryOf(tx));
    const postedCompany = new Map<string, { id: string; month: string; amount: number }[]>();
    let closedNow = new Map<string, Set<string>>();
    if (company) {
      const rows = await all<{ id: string; reference: string; month: string; amount: number }>(tx, `
        SELECT id, reference, month, amount FROM company_late_changes
        WHERE reference IN (SELECT 'stage-lock:' || x FROM jsonb_array_elements_text(?::text::jsonb) x) ORDER BY month, id`, ids([...alive]));
      for (const r of rows) {
        const k = r.reference.slice('stage-lock:'.length);
        postedCompany.set(k, [...(postedCompany.get(k) ?? []), { id: r.id, month: r.month, amount: Number(r.amount) }]);
      }
      const live = due.filter(d => alive.has(d.lockId));
      closedNow = await closedMonthsFor(tx, [...new Set(live.map(d => d.unitId))], live.reduce((m, d) => (d.month < m ? d.month : m), '9999-12'), 'o2');
    }
    const at = nowIso();
    const inserts: Record<string, unknown>[] = [], updates: { id: string; amount: number; kind: string }[] = [], removes: string[] = [];
    const cInserts: Record<string, unknown>[] = [], cUpdates: { id: string; amount: number }[] = [], cRemoves: string[] = [];
    const audits: AuditEntry[] = [];
    const months = new Set<string>();
    for (const d of due) {
      if (!alive.has(d.lockId)) continue;
      const mine = posted.get(d.lockId) ?? [];
      const plan = planLate(d.diff, mine, d.target);
      if (plan.kind !== 'none') {
        out.planned++;
        const on = plan.kind === 'insert' ? plan.month : mine.find(p => p.id === plan.id)?.month;
        if (on) months.add(on);
        if (plan.kind === 'insert') {
          inserts.push({ id: `adj-lock-${crypto.randomUUID()}`, owner_id: d.ownerId, unit_id: d.unitId, kind: plan.amount >= 0 ? 'credit' : 'charge', amount: plan.amount,
            description: d.text, occurred_on: `${plan.month}-01`, reference: `stage-lock:${d.lockId}`, state: d.held ? 'held' : 'open' });
        } else if (plan.kind === 'update') updates.push({ id: plan.id, amount: plan.amount, kind: plan.amount >= 0 ? 'credit' : 'charge' });
        else removes.push(plan.id);
        audits.push({ actorId: null, actorLabel: d.stage === 'income' ? 'Late income update' : 'Late deductions update', action: `owner_report.late_${d.stage}.${plan.kind}`,
          entityTable: 'units', entityId: d.unitId, after: { month: d.month, lockId: d.lockId, diff: d.diff, plan }, source: 'system' });
      }
      if (!company) continue;
      const closed = closedNow.get(d.unitId) ?? new Set<string>();
      const cMine: PostedLate[] = (postedCompany.get(d.lockId) ?? []).map(p => ({ ...p, movable: !closed.has(p.month) }));
      const cPlan = planLate(d.companyDiff, cMine, d.target);
      if (cPlan.kind === 'none') continue;
      if (cPlan.kind === 'insert') {
        cInserts.push({ id: `clc-${crypto.randomUUID()}`, unit_id: d.unitId, month: cPlan.month, amount: cPlan.amount, description: d.text, reference: `stage-lock:${d.lockId}` });
      } else if (cPlan.kind === 'update') cUpdates.push({ id: cPlan.id, amount: cPlan.amount });
      else cRemoves.push(cPlan.id);
      audits.push({ actorId: null, actorLabel: 'Late company update', action: `owner_report.late_company.${cPlan.kind}`,
        entityTable: 'units', entityId: d.unitId, after: { month: d.month, lockId: d.lockId, stage: d.stage, diff: d.companyDiff, plan: cPlan }, source: 'system' });
    }
    out.months = [...months].sort();
    if (o.dryRun || !audits.length) return;
    if (inserts.length) await run(tx, `
      INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
      SELECT x.id, x.owner_id, x.unit_id, x.kind, x.amount, x.description, x.occurred_on, x.reference, x.state, 'stage_lock', NULL, ?, ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, owner_id text, unit_id text, kind text, amount integer, description text, occurred_on text, reference text, state text)`,
      at, at, JSON.stringify(inserts));
    if (updates.length) await run(tx, `
      UPDATE owner_adjustments a SET amount = x.amount, kind = x.kind, updated_at = ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, amount integer, kind text) WHERE a.id = x.id`, at, JSON.stringify(updates));
    if (removes.length) await run(tx, 'DELETE FROM owner_adjustments WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(removes));
    if (cInserts.length) await run(tx, `
      INSERT INTO company_late_changes (id, unit_id, month, amount, description, reference, created_at, updated_at)
      SELECT x.id, x.unit_id, x.month, x.amount, x.description, x.reference, ?, ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, month text, amount integer, description text, reference text)`,
      at, at, JSON.stringify(cInserts));
    if (cUpdates.length) await run(tx, `
      UPDATE company_late_changes c SET amount = x.amount, updated_at = ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, amount integer) WHERE c.id = x.id`, at, JSON.stringify(cUpdates));
    if (cRemoves.length) await run(tx, 'DELETE FROM company_late_changes WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(cRemoves));
    await auditMany(tx, audits);
    out.inserted = inserts.length; out.updated = updates.length; out.removed = removes.length;
    out.company = { inserted: cInserts.length, updated: cUpdates.length, removed: cRemoves.length };
  });
  return out;
}
