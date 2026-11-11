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
import { auditMany } from './history';
import { loadInputs, computeMonth, statementSettings, withYearToDate, freezeIncome, termsFor, unitForMonth, hasLocksTable, type Query } from './ownerStatement';
import { monthEndExclusive } from './revenue';
import { finalMonthsFor } from './expenses';
import { type Stage, openMonthAfter, planLate, planUnlock, carriedText, lateText, monthLabel, type PostedLate } from './stageLocks';

export interface LockRow { id: string; month: string; unit_id: string; stage: Stage; locked_by_name: string; locked_at: string }

const FINAL = `('finalised','sent','paid')`;
const ids = (list: string[]) => JSON.stringify([...new Set(list)]);

/** The locks of a month, for some units or all. */
export async function locksFor(env: Env, month: string, unitIds?: string[]): Promise<LockRow[]> {
  if (!(await hasLocksTable((sql, ...args) => all(env, sql, ...args)))) return [];
  return all<LockRow>(env, `SELECT id, month, unit_id, stage, locked_by_name, locked_at FROM owner_report_locks WHERE month = ?
    ${unitIds ? 'AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''} ORDER BY unit_id, stage`, month, ...(unitIds ? [ids(unitIds)] : []));
}

/** Locks `month`'s income for these units: each keeps the stays (and a long-term let's rent) it is worked out from now.
 *  A unit already locked is left as it is and reported as `already`; an id that is not a unit is `unknown`. */
export async function lockIncome(env: Env, who: { userId: string; fullName: string }, month: string, unitIds: string[]): Promise<{ locked: string[]; already: string[]; unknown: string[] }> {
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const [settings, inputs] = await Promise.all([statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month), { unitIds })]);
  const known = new Set(inputs.units.map(u => u.id));
  const unknown = unitIds.filter(id => !known.has(id));
  const rows = inputs.units.map(u => ({
    id: `lock-${crypto.randomUUID()}`, unit_id: u.id,
    frozen: freezeIncome(u.id, month, inputs.stays, termsFor(unitForMonth(u, month), settings.defaultFeePct)),
  }));
  if (!rows.length) return { locked: [], already: [], unknown };
  const inserted = await all<{ unit_id: string }>(env, `
    INSERT INTO owner_report_locks (id, month, unit_id, stage, frozen, locked_by, locked_by_name, locked_at)
    SELECT x.id, ?, x.unit_id, 'income', x.frozen, ?, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, frozen jsonb)
    ON CONFLICT (month, unit_id, stage) DO NOTHING RETURNING unit_id`,
    month, who.userId, who.fullName, nowIso(), JSON.stringify(rows));
  const locked = inserted.map(r => r.unit_id);
  if (locked.length) {
    await auditMany(env, locked.map(id => ({ actorId: who.userId, actorLabel: who.fullName, action: 'owner_report.lock', entityTable: 'units', entityId: id, after: { month, stage: 'income' } })));
  }
  return { locked, already: [...known].filter(id => !locked.includes(id)), unknown };
}

/** The adjustments a lock has posted, and whether each can still be changed: open or held, and on no statement or on
 *  one that is still a draft. */
async function postedFor(env: Env, lockId: string): Promise<PostedLate[]> {
  const rows = await all<{ id: string; month: string; amount: number; movable: boolean }>(env, `
    SELECT a.id, substr(a.occurred_on, 1, 7) AS month, a.amount,
           (a.state IN ('open','held') AND (a.statement_id IS NULL OR EXISTS (SELECT 1 FROM owner_statements s WHERE s.id = a.statement_id AND s.state = 'provisional'))) AS movable
    FROM owner_adjustments a WHERE a.source = 'stage_lock' AND a.reference = ? ORDER BY a.occurred_on, a.id`, `stage-lock:${lockId}`);
  return rows.map(r => ({ id: r.id, month: r.month, amount: Number(r.amount), movable: !!r.movable }));
}

/** Unlocks one step of one unit's month (a reason is required by the route). Brings the month back to today's data:
 *  the late differences it posted that can still change are withdrawn; any already settled on a final statement stay,
 *  and the month carries the same amount back so the owner is not paid twice. Refused while the month itself is final. */
export async function unlockStage(env: Env, who: { userId: string; fullName: string }, month: string, stage: Stage, unitId: string, reason: string): Promise<{ ok: true } | { problem: string; status: 404 | 409 }> {
  return transaction(env, async tx => {
    const lock = await one<{ id: string; owner_id: string }>(tx, `
      SELECT l.id, u.owner_id FROM owner_report_locks l JOIN units u ON u.id = l.unit_id
      WHERE l.month = ? AND l.unit_id = ? AND l.stage = ? FOR UPDATE OF l`, month, unitId, stage);
    if (!lock) return { problem: 'That step is not locked for this unit.', status: 404 as const };
    const final = !!(await one(tx, `SELECT 1 AS x FROM owner_statements WHERE owner_id = ? AND period_start = ? AND state IN ${FINAL}`, lock.owner_id, `${month}-01`));
    const plan = planUnlock(await postedFor(tx, lock.id), final, monthLabel(month));
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
    return { ok: true as const };
  });
}

/** For every income lock in scope: the difference between what the owner is due on the live figures and on the
 *  locked ones, kept as one owner adjustment on the next open month (inserted, topped up or withdrawn). Safe to run
 *  as often as anything calls it (statement generation, Airbnb reconciliation, the 15-minute cron): each lock is
 *  handled under its own advisory lock and posts only what is still missing. */
export async function syncLateIncome(env: Env, scope: { unitIds?: string[]; ownerIds?: string[] } = {}, o: { dryRun?: boolean } = {}): Promise<{ inserted: number; updated: number; removed: number; planned: number }> {
  const out = { inserted: 0, updated: 0, removed: 0, planned: 0 };
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  if (!(await hasLocksTable(q))) return out;
  if ((scope.unitIds && !scope.unitIds.length) || (scope.ownerIds && !scope.ownerIds.length)) return out;
  const locks = await all<{ id: string; month: string; unit_id: string; owner_id: string }>(env, `
    SELECT l.id, l.month, l.unit_id, u.owner_id FROM owner_report_locks l JOIN units u ON u.id = l.unit_id WHERE l.stage = 'income'
    ${scope.unitIds ? 'AND l.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : scope.ownerIds ? 'AND u.owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''}
    ORDER BY l.month, l.unit_id`, ...(scope.unitIds ? [ids(scope.unitIds)] : scope.ownerIds ? [ids(scope.ownerIds)] : []));
  if (!locks.length) return out;
  const settings = await statementSettings(q);
  const months = [...new Set(locks.map(l => l.month))];
  for (const month of months) {
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
      const diff = v.payoutBeforeAdjustments - f.payoutBeforeAdjustments;
      const target = openMonthAfter(month, finals.get(l.unit_id) ?? new Set());
      const held = termsFor(unitForMonth(unit, month), settings.defaultFeePct).model === 'management_yearly_guarantee';
      await transaction(env, async tx => {
        await one(tx, 'SELECT 1 AS x FROM (SELECT pg_advisory_xact_lock(hashtext(?::text))) k', `stage-lock:${l.id}`);
        if (!(await one(tx, 'SELECT 1 AS x FROM owner_report_locks WHERE id = ?', l.id))) return;
        const plan = planLate(diff, await postedFor(tx, l.id), target);
        if (plan.kind === 'none') return;
        out.planned++;
        if (o.dryRun) return;
        const at = nowIso();
        if (plan.kind === 'insert') {
          const id = `adj-lock-${crypto.randomUUID()}`;
          await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'stage_lock', NULL, ?, ?)`,
            id, l.owner_id, l.unit_id, plan.amount >= 0 ? 'credit' : 'charge', plan.amount,
            lateText(`${unit.property_name} ${unit.unit_number}`, monthLabel(month)), `${plan.month}-01`, `stage-lock:${l.id}`, held ? 'held' : 'open', at, at);
          out.inserted++;
        } else if (plan.kind === 'update') {
          await run(tx, `UPDATE owner_adjustments SET amount = ?, kind = ?, updated_at = ? WHERE id = ?`, plan.amount, plan.amount >= 0 ? 'credit' : 'charge', at, plan.id);
          out.updated++;
        } else {
          await run(tx, 'DELETE FROM owner_adjustments WHERE id = ?', plan.id);
          out.removed++;
        }
        await audit(tx, { actorId: null, actorLabel: 'Late income sync', action: `owner_report.late_income.${plan.kind}`, entityTable: 'units', entityId: l.unit_id,
          after: { month, lockId: l.id, diff, plan }, source: 'system' });
      });
    }
  }
  return out;
}
