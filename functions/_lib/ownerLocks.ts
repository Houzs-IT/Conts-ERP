/** Owner report stage locks: locking a month's income unit by unit, unlocking it, and the late-income sync
 *  (spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md, plan
 *  docs/superpowers/plans/2026-11-11-owner-report-locks-part1-income.md). The rules are in stageLocks.ts.
 *
 *  A locked month is worked out from what the lock kept (ownerStatement.ts, FrozenIncome), so its income never changes.
 *  A booking changed afterwards (Airbnb reconciliation, a booking edit, a cancellation from HostPlatform or Channex)
 *  changes only the live figures; syncLateIncome compares the two and keeps one owner adjustment per lock on the next
 *  open month for the difference in what the owner is due (spec call 10: worked out again through the contract,
 *  guarantee included, not a flat %; a yearly-guarantee unit's is held for a person to check). */
import { type Env, all, one, run, transaction, nowIso, audit } from './db';
import { auditMany, type AuditEntry } from './history';
import { loadInputs, computeMonth, statementSettings, withYearToDate, freezeIncome, termsFor, unitForMonth, hasLocksTable, hasActivity, type Query, type Inputs, type UnitMonth } from './ownerStatement';
import { monthEndExclusive } from './revenue';
import { finalMonthsFor } from './expenses';
import { type Stage, openMonthAfter, planLate, planUnlock, carriedText, lateText, monthLabel, incomeLockable, type PostedLate } from './stageLocks';

export interface LockRow { id: string; month: string; unit_id: string; stage: Stage; locked_by_name: string; locked_at: string }

const FINAL = `('finalised','sent','paid')`;
const ids = (list: string[]) => JSON.stringify([...new Set(list)]);

/** The advisory lock that puts the late-income update, unlocking and statement generation one after another: each
 *  reads the owner adjustments the others write (review findings 1 and 2). */
export const LATE_INCOME_LOCK = 'owner-report-late-income';
const takeLateIncomeLock = (tx: Env) => one(tx, 'SELECT 1 AS x FROM (SELECT pg_advisory_xact_lock(hashtext(?::text))) k', LATE_INCOME_LOCK);

/** The owners whose statement for `month` is final (finalised, sent or paid). */
async function finalOwners(env: Env, month: string): Promise<Set<string>> {
  return new Set((await all<{ owner_id: string }>(env, `SELECT DISTINCT owner_id FROM owner_statements WHERE period_start = ? AND state IN ${FINAL}`, `${month}-01`)).map(r => r.owner_id));
}

/** The units on a month's income step: those with something in the month's owner statement whose income can be
 *  locked (not a fixed rent or a master lease), with their income lock, and whether their owner's statement for the
 *  month is final (a unit that is final and not locked cannot be locked any more). Owner statement close lists them;
 *  Airbnb reconciliation shows how many are locked. One place, so the two always count the same units. */
export async function incomeStep(env: Env, month: string): Promise<{ inputs: Inputs; rows: UnitMonth[]; locks: Map<string, LockRow>; finals: Set<string>; counts: { locked: number; total: number } }> {
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const [settings, loaded, locks, finals] = await Promise.all([statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month)), locksFor(env, month), finalOwners(env, month)]);
  const inputs = await withYearToDate(q, loaded, month, settings);
  const rows = computeMonth(month, inputs, settings, 'dated').filter(r => hasActivity(r) && incomeLockable(r.terms.basis));
  const income = new Map(locks.filter(l => l.stage === 'income').map(l => [l.unit_id, l]));
  return {
    inputs, rows, locks: income, finals,
    counts: { locked: rows.filter(r => income.has(r.unitId)).length, total: rows.filter(r => income.has(r.unitId) || !finals.has(r.ownerId)).length },
  };
}

/** The locks of a month, for some units or all. */
export async function locksFor(env: Env, month: string, unitIds?: string[]): Promise<LockRow[]> {
  if (!(await hasLocksTable((sql, ...args) => all(env, sql, ...args)))) return [];
  return all<LockRow>(env, `SELECT id, month, unit_id, stage, locked_by_name, locked_at FROM owner_report_locks WHERE month = ?
    ${unitIds ? 'AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''} ORDER BY unit_id, stage`, month, ...(unitIds ? [ids(unitIds)] : []));
}

/** How many units are on the month's income step, and how many of them have their income locked: the figures Owner
 *  statement close shows on its Income step (Airbnb reconciliation shows them too). */
export async function incomeLockCounts(env: Env, month: string): Promise<{ locked: number; total: number }> {
  return (await incomeStep(env, month)).counts;
}

/** For each unit, the months whose income is locked. */
export async function incomeLockedMonths(env: Env, unitIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!unitIds.length || !(await hasLocksTable((sql, ...args) => all(env, sql, ...args)))) return out;
  const rows = await all<{ unit_id: string; month: string }>(env,
    `SELECT unit_id, month FROM owner_report_locks WHERE stage = 'income' AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, ids(unitIds));
  for (const r of rows) { const s = out.get(r.unit_id) ?? new Set<string>(); s.add(r.month); out.set(r.unit_id, s); }
  return out;
}

/** Locks `month`'s income for these units: each keeps the stays (and a long-term let's rent) it is worked out from now.
 *  Left as they are, and listed apart: a unit already locked (`already`); one on a fixed rent or a master lease
 *  (`notLockable`: its owner is paid the same whatever it earns); one whose owner's statement for the month is final
 *  (`final`: a lock would keep today's stays, not what that statement paid); an id that is not a unit (`unknown`). */
export async function lockIncome(env: Env, who: { userId: string; fullName: string }, month: string, unitIds: string[]):
  Promise<{ locked: string[]; already: string[]; notLockable: string[]; final: string[]; unknown: string[] }> {
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const [settings, inputs, existing, finals] = await Promise.all([
    statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month), { unitIds }), locksFor(env, month, unitIds), finalOwners(env, month),
  ]);
  const known = new Set(inputs.units.map(u => u.id));
  const unknown = unitIds.filter(id => !known.has(id));
  const already = new Set(existing.filter(l => l.stage === 'income').map(l => l.unit_id));
  const notLockable: string[] = [], final: string[] = [];
  const rows: { id: string; unit_id: string; frozen: unknown }[] = [];
  for (const u of inputs.units) {
    if (already.has(u.id)) continue;
    const terms = termsFor(unitForMonth(u, month), settings.defaultFeePct);
    if (!incomeLockable(terms.basis)) notLockable.push(u.id);
    else if (finals.has(u.owner_id)) final.push(u.id);
    else rows.push({ id: `lock-${crypto.randomUUID()}`, unit_id: u.id, frozen: freezeIncome(u.id, month, inputs.stays, terms) });
  }
  // ON CONFLICT: a unit locked by someone else a moment ago counts as already locked.
  const inserted = rows.length ? await all<{ unit_id: string }>(env, `
    INSERT INTO owner_report_locks (id, month, unit_id, stage, frozen, locked_by, locked_by_name, locked_at)
    SELECT x.id, ?, x.unit_id, 'income', x.frozen, ?, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, frozen jsonb)
    ON CONFLICT (month, unit_id, stage) DO NOTHING RETURNING unit_id`,
    month, who.userId, who.fullName, nowIso(), JSON.stringify(rows)) : [];
  const locked = inserted.map(r => r.unit_id);
  if (locked.length) {
    await auditMany(env, locked.map(id => ({ actorId: who.userId, actorLabel: who.fullName, action: 'owner_report.lock', entityTable: 'units', entityId: id, after: { month, stage: 'income' } })));
  }
  return { locked, already: [...already, ...rows.map(r => r.unit_id).filter(id => !locked.includes(id))], notLockable, final, unknown };
}

/** The adjustments these locks have posted, by lock id: whether each can still be changed (open or held, and on no
 *  statement or on one that is still a draft) and whether a draft statement prints it. One query for any number of locks. */
async function postedFor(env: Env, lockIds: string[]): Promise<Map<string, PostedLate[]>> {
  const out = new Map<string, PostedLate[]>(lockIds.map(id => [id, []]));
  if (!lockIds.length) return out;
  const rows = await all<{ id: string; reference: string; month: string; amount: number; movable: boolean; on_draft: boolean | null }>(env, `
    SELECT a.id, a.reference, substr(a.occurred_on, 1, 7) AS month, a.amount,
           (a.state IN ('open','held') AND (a.statement_id IS NULL OR s.state = 'provisional')) AS movable,
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
 *  the late differences it posted that can still change are withdrawn; any already settled on a final statement stay,
 *  and the month carries the same amount back so the owner is not paid twice. Refused while the month itself is final.
 *  `regenerate`: the months whose draft printed a withdrawn difference (finalise refuses them until generated again). */
export async function unlockStage(env: Env, who: { userId: string; fullName: string }, month: string, stage: Stage, unitId: string, reason: string): Promise<{ ok: true; regenerate: string[] } | { problem: string; status: 404 | 409 }> {
  return transaction(env, async tx => {
    // After any late-income update already running: one that read this lock must not post for it once it is gone.
    await takeLateIncomeLock(tx);
    const lock = await one<{ id: string; owner_id: string }>(tx, `
      SELECT l.id, u.owner_id FROM owner_report_locks l JOIN units u ON u.id = l.unit_id
      WHERE l.month = ? AND l.unit_id = ? AND l.stage = ? FOR UPDATE OF l`, month, unitId, stage);
    if (!lock) return { problem: 'That step is not locked for this unit.', status: 404 as const };
    const final = !!(await one(tx, `SELECT 1 AS x FROM owner_statements WHERE owner_id = ? AND period_start = ? AND state IN ${FINAL}`, lock.owner_id, `${month}-01`));
    const plan = planUnlock((await postedFor(tx, [lock.id])).get(lock.id) ?? [], final, monthLabel(month));
    if (plan.problem) return { problem: plan.problem, status: 409 as const };
    const at = nowIso();
    if (plan.remove.length) await run(tx, 'DELETE FROM owner_adjustments WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(plan.remove));
    if (plan.carried) {
      const amount = -plan.carried.amount;
      await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'stage_lock', ?, ?, ?)`,
        `adj-lock-${crypto.randomUUID()}`, lock.owner_id, unitId, amount >= 0 ? 'credit' : 'charge', amount,
        carriedText(plan.carried.months.map(monthLabel)), `${month}-01`, `stage-lock-carried:${lock.id}`, who.userId, at, at);
    }
    await run(tx, 'DELETE FROM owner_report_locks WHERE id = ?', lock.id);
    await audit(tx, { actorId: who.userId, actorLabel: who.fullName, action: 'owner_report.unlock', entityTable: 'units', entityId: unitId,
      after: { month, stage, reason, withdrawn: plan.remove.length, carried: plan.carried?.amount ?? 0 } });
    return { ok: true as const, regenerate: plan.regenerate };
  });
}

/** For every income lock in scope: the difference between what the owner is due on the live figures and on the
 *  locked ones, kept as one owner adjustment on the next open month (inserted, topped up or withdrawn). Safe to run
 *  as often as anything calls it (statement generation, Airbnb reconciliation, the 15-minute cron): the writes happen
 *  in one transaction under one advisory lock, and each lock posts only what is still missing.
 *  `months`: the months whose statement the update changed (or would change, with dryRun): generate them again. */
export async function syncLateIncome(env: Env, scope: { unitIds?: string[]; ownerIds?: string[] } = {}, o: { dryRun?: boolean } = {}): Promise<{ inserted: number; updated: number; removed: number; planned: number; months: string[] }> {
  const out = { inserted: 0, updated: 0, removed: 0, planned: 0, months: [] as string[] };
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  if (!(await hasLocksTable(q))) return out;
  if ((scope.unitIds && !scope.unitIds.length) || (scope.ownerIds && !scope.ownerIds.length)) return out;
  const locks = await all<{ id: string; month: string; unit_id: string; owner_id: string }>(env, `
    SELECT l.id, l.month, l.unit_id, u.owner_id FROM owner_report_locks l JOIN units u ON u.id = l.unit_id WHERE l.stage = 'income'
    ${scope.unitIds ? 'AND l.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : scope.ownerIds ? 'AND u.owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''}
    ORDER BY l.month, l.unit_id`, ...(scope.unitIds ? [ids(scope.unitIds)] : scope.ownerIds ? [ids(scope.ownerIds)] : []));
  if (!locks.length) return out;

  // What each lock's difference is now, month by month (a few months at most: the ones still being closed).
  const settings = await statementSettings(q);
  const due: { lockId: string; ownerId: string; unitId: string; month: string; diff: number; target: string; held: boolean; text: string }[] = [];
  for (const month of [...new Set(locks.map(l => l.month))]) {
    const mine = locks.filter(l => l.month === month);
    const unitIds = [...new Set(mine.map(l => l.unit_id))];
    const inputs = await withYearToDate(q, await loadInputs(q, `${month}-01`, monthEndExclusive(month), { unitIds }), month, settings);
    const locked = computeMonth(month, inputs, settings, 'dated');
    const live = computeMonth(month, { ...inputs, frozen: undefined }, settings, 'dated');
    const finals = await finalMonthsFor(env, unitIds, month);
    for (const l of mine) {
      const f = locked.find(r => r.unitId === l.unit_id), v = live.find(r => r.unitId === l.unit_id);
      const unit = inputs.units.find(u => u.id === l.unit_id);
      if (!f || !v || !unit) continue;
      due.push({
        lockId: l.id, ownerId: l.owner_id, unitId: l.unit_id, month,
        diff: v.payoutBeforeAdjustments - f.payoutBeforeAdjustments,
        target: openMonthAfter(month, finals.get(l.unit_id) ?? new Set()),
        held: termsFor(unitForMonth(unit, month), settings.defaultFeePct).model === 'management_yearly_guarantee',
        text: lateText('income', `${unit.property_name} ${unit.unit_number}`, monthLabel(month)),
      });
    }
  }

  await transaction(env, async tx => {
    await takeLateIncomeLock(tx);
    const alive = new Set((await all<{ id: string }>(tx, 'SELECT id FROM owner_report_locks WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids(due.map(d => d.lockId)))).map(r => r.id));
    const posted = await postedFor(tx, [...alive]);
    const at = nowIso();
    const inserts: Record<string, unknown>[] = [], updates: { id: string; amount: number; kind: string }[] = [], removes: string[] = [];
    const audits: AuditEntry[] = [];
    const months = new Set<string>();
    for (const d of due) {
      if (!alive.has(d.lockId)) continue;
      const mine = posted.get(d.lockId) ?? [];
      const plan = planLate(d.diff, mine, d.target);
      if (plan.kind === 'none') continue;
      out.planned++;
      const on = plan.kind === 'insert' ? plan.month : mine.find(p => p.id === plan.id)?.month;
      if (on) months.add(on);
      if (plan.kind === 'insert') {
        inserts.push({ id: `adj-lock-${crypto.randomUUID()}`, owner_id: d.ownerId, unit_id: d.unitId, kind: plan.amount >= 0 ? 'credit' : 'charge', amount: plan.amount,
          description: d.text, occurred_on: `${plan.month}-01`, reference: `stage-lock:${d.lockId}`, state: d.held ? 'held' : 'open' });
      } else if (plan.kind === 'update') updates.push({ id: plan.id, amount: plan.amount, kind: plan.amount >= 0 ? 'credit' : 'charge' });
      else removes.push(plan.id);
      audits.push({ actorId: null, actorLabel: 'Late income update', action: `owner_report.late_income.${plan.kind}`, entityTable: 'units', entityId: d.unitId,
        after: { month: d.month, lockId: d.lockId, diff: d.diff, plan }, source: 'system' });
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
    await auditMany(tx, audits);
    out.inserted = inserts.length; out.updated = updates.length; out.removed = removes.length;
  });
  return out;
}
