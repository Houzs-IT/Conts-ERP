import { type Env, all } from './db';
import { monthEndExclusive } from './revenue';
import { modelOf, type RevenueModel } from './revenueModel';
import { UNIT_SQL } from './ownerStatement';
import { LOCKED_SQL } from './expenses';
import { CLEAN_KINDS_SQL } from './cleaning';

/** A month's costs on a unit, or on every unit of an owner, grouped the way the owner reads them (owner, 11 Oct 2026):
 *    Cleaning fees       every clean charged to the unit (category cleaning / housekeeping)
 *    Maintenance repair  repairs (category maintenance, or raised from a maintenance job), before the operator's share
 *    Utilities           water, electricity, Wi-Fi, Indah Water
 *    Maintenance fee     the condo management's monthly fee (below), after the operator's share
 *    Other fees          anything else, shown only when not zero
 *  The groups are for reading only: the statement's maths and the stored categories do not change.
 *  Only what the owner pays (charge_to 'owner') is deducted, before the operator's share, exactly as the statement
 *  deducts it (ownerStatement.ts reads the same rows); what the company, a tenant or a guest paid is shown apart.
 *  Owner credits and charges (owner_adjustments, the workbook's O2 lines such as "MAINTENANCE FEE SEPT 26") are listed
 *  with the bills but stay where the statement puts them: after the split.
 *  Maintenance fee (condo): the building's monthly fee comes off AFTER the operator's share, as on the owner's report.
 *  Added from the unit or owner page it is an owner charge (BillModal posts it to /api/owners/:id/adjustments). One
 *  saved before that as an 'other' expense ("Building maintenance fee ...") is deducted before the split; it is left
 *  as it is (no money moves on its own) and flagged so finance can check it. */

/** The statement's deduction rows (ownerStatement.ts DEDUCTIONS, printed on the Owner Income Report as the workbook
 *  names them) in the words the screens use. */
export const DEDUCTION_WORDS: Record<string, string> = {
  cleaning_basic: 'Cleaning fees', cleaning_deep: 'Cleaning fees (deep clean)', electricity: 'Utilities: electricity', water: 'Utilities: water',
  internet: 'Utilities: Wi-Fi', sewerage: 'Utilities: IndahWater', additional: 'Maintenance repair and other fees',
  misc: 'Other fees',
};

/** The owner's names for the groups (11 Oct 2026). */
export type CostGroup = 'cleaning' | 'maintenance' | 'utilities' | 'maintenance_fee' | 'other';
export const KINDS: { key: string; label: string; group: CostGroup }[] = [
  { key: 'cleaning', label: 'Cleaning fees', group: 'cleaning' },
  { key: 'maintenance', label: 'Maintenance repair', group: 'maintenance' },
  { key: 'water', label: 'Water', group: 'utilities' },
  { key: 'electricity', label: 'Electricity', group: 'utilities' },
  { key: 'internet', label: 'Wi-Fi', group: 'utilities' },
  { key: 'sewerage', label: 'IndahWater', group: 'utilities' },
  { key: 'building_fee', label: 'Maintenance fee (condo)', group: 'maintenance_fee' },
  { key: 'other', label: 'Other fees', group: 'other' },
];
const TOTAL_OF = { cleaning: 'cleaning', maintenance: 'maintenance', utilities: 'utilities', maintenance_fee: 'maintenanceFee', other: 'other' } as const;
const KIND = new Map(KINDS.map(k => [k.key, k]));

/** A maintenance fee saved as an expense before it became an owner charge: category 'other' with a description
 *  starting "Building maintenance fee". The statement deducts these before the split (Additional Deduction). */
export const BUILDING_FEE = /^building maintenance fee\b/i;
/** A maintenance-fee owner charge: "MAINTENANCE FEE SEPT 26", from the workbook ("O2: ...") or added here. */
export const MAINTENANCE_FEE_CHARGE = /^(o2:\s*)?maintenance fee\b/i;

export function kindOf(e: { category: string; description: string | null; maintenance_id: string | null }): string {
  const c = e.category;
  if (c === 'cleaning' || c === 'housekeeping') return 'cleaning';
  if (c === 'maintenance' || e.maintenance_id) return 'maintenance';
  if (c === 'water' || c === 'electricity' || c === 'internet' || c === 'sewerage') return c;
  if (c === 'other' && BUILDING_FEE.test(e.description ?? '')) return 'building_fee';
  // Indah Water entered as a utility before 'sewerage' existed (the statement reads it the same way).
  if (c === 'utilities' && /indah|sewer|iwk/i.test(e.description ?? '')) return 'sewerage';
  return 'other';
}

/** How a cost reached the unit (owner, 11 Oct 2026): a finished cleaning job, a maintenance job's billing date, a bill
 *  paid (utilities and the condo fee, from Add a bill or the monthly utility bills), anything else entered by hand,
 *  or the owner workbook import (ids 'wb-...'). Read from what the row is linked to; nothing extra is stored. */
export type CostSource = 'cleaning_job' | 'maintenance_job' | 'bill' | 'manual' | 'import';
const BILL_KINDS = new Set(['water', 'electricity', 'internet', 'sewerage', 'building_fee']);
export function sourceOf(e: { id: string; task_id: string | null; maintenance_id: string | null }, kind: string): CostSource {
  if (e.task_id) return 'cleaning_job';
  if (e.maintenance_id) return 'maintenance_job';
  if (String(e.id).startsWith('wb-')) return 'import';
  return BILL_KINDS.has(kind) ? 'bill' : 'manual';
}

/** maintenanceFee: the month's condo fee, after the split as an owner charge plus any still saved as an expense. */
interface Totals { cleaning: number; maintenance: number; utilities: number; maintenanceFee: number; other: number; deducted: number; notCharged: number; credits: number; charges: number }
const zero = (): Totals => ({ cleaning: 0, maintenance: 0, utilities: 0, maintenanceFee: 0, other: 0, deducted: 0, notCharged: 0, credits: 0, charges: 0 });

export interface CostItem {
  id: string; unitId: string; unitLabel: string; kind: string; kindLabel: string; group: CostGroup; category: string; description: string;
  amount: number; chargeTo: string; incurredOn: string; reference: string | null; receiptDocumentId: string | null; locked: boolean;
  source: CostSource; taskId: string | null; maintenanceId: string | null;
}
export interface AdjustmentItem {
  id: string; unitId: string; unitLabel: string; placedOnFirstUnit: boolean; kind: string; amount: number; description: string; isMaintenanceFee: boolean;
  occurredOn: string; reference: string | null; state: string; source: string; inMonth: boolean;
  statement: { id: string; period: string; state: string } | null;
}

export async function unitCosts(env: Env, month: string, scope: { unitId?: string; ownerId?: string }) {
  const from = `${month}-01`, toEx = monthEndExclusive(month);
  const where = scope.unitId ? 'WHERE u.id = ?' : 'WHERE u.owner_id = ?';
  const arg = scope.unitId ?? scope.ownerId;
  const units = await all<any>(env, `${UNIT_SQL} ${where} ORDER BY p.name, u.unit_number`, arg);
  const ids = JSON.stringify(units.map(u => u.id));
  const ownerIds = JSON.stringify([...new Set(units.map(u => u.owner_id))]);
  const [expenses, adjustments, cleans] = await Promise.all([
    all<any>(env, `
      SELECT e.id, e.unit_id, e.category, e.description, e.amount, e.incurred_on, e.charge_to, e.reference, e.maintenance_id, e.task_id, e.receipt_document_id,
             ${LOCKED_SQL} AS locked
      FROM expenses e JOIN units u ON u.id = e.unit_id
      WHERE e.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND e.incurred_on >= ? AND e.incurred_on < ?
      ORDER BY e.incurred_on, e.created_at`, ids, from, toEx),
    // Dated in the month, plus any still waiting for a statement: held ones, and open ones no statement carries yet.
    all<any>(env, `
      SELECT a.id, a.owner_id, a.unit_id, a.kind, a.amount, a.description, a.occurred_on, a.reference, a.state, a.source,
             s.id AS statement_id, s.period_start, s.state AS statement_state
      FROM owner_adjustments a LEFT JOIN owner_statements s ON s.id = a.statement_id
      WHERE a.owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
        AND ((a.occurred_on >= ? AND a.occurred_on < ?) OR a.state = 'held' OR (a.state = 'open' AND a.statement_id IS NULL AND a.occurred_on < ?))
      ORDER BY a.occurred_on, a.created_at`, ownerIds, from, toEx, toEx),
    // Finished cleans around the month that carry no cost: the day is worked out below in Malaysian time.
    all<any>(env, `
      SELECT t.id, t.unit_id, t.kind, t.title, COALESCE(t.completed_at, t.due_at) AS done_at
      FROM tasks t
      WHERE t.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND t.state = 'resolved' AND t.kind IN ${CLEAN_KINDS_SQL}
        AND COALESCE(t.completed_at, t.due_at) >= ? AND COALESCE(t.completed_at, t.due_at) < ?
        AND NOT EXISTS (SELECT 1 FROM expenses x WHERE x.task_id = t.id)
      ORDER BY 5`, ids, shiftDay(from, -1), shiftDay(toEx, 1)),
  ]);

  const label = (u: any) => `${u.property_name} ${u.unit_number}`;
  const byId = new Map(units.map(u => [u.id, u]));
  // An adjustment with no unit sits on the owner's first unit that has a statement, as computeMonth puts it. Viewing
  // one unit, that is worked out over all of the owner's units.
  const ownerUnits = scope.unitId && units.length ? await all<any>(env, `${UNIT_SQL} WHERE u.owner_id = ? ORDER BY p.name, u.unit_number`, units[0].owner_id) : units;
  const firstOf = (ownerId: string) => {
    const mine = ownerUnits.filter(u => u.owner_id === ownerId);
    return mine.find(u => modelOf(u) !== 'master_lease') ?? mine[0];
  };

  const items: CostItem[] = expenses.map(e => {
    const k = KIND.get(kindOf(e))!;
    return {
      id: e.id, unitId: e.unit_id, unitLabel: label(byId.get(e.unit_id)), kind: k.key, kindLabel: k.label, group: k.group, category: e.category,
      description: e.description ?? '', amount: Number(e.amount), chargeTo: e.charge_to, incurredOn: String(e.incurred_on).slice(0, 10),
      reference: e.reference ?? null, receiptDocumentId: e.receipt_document_id ?? null, locked: !!e.locked,
      source: sourceOf(e, k.key), taskId: e.task_id ?? null, maintenanceId: e.maintenance_id ?? null,
    };
  });
  // A finished clean with no cost: imported as done without a price, or finished on a day the unit already had a
  // cleaning cost, or before its month's statement was final. Listed so it can be charged (POST /api/expenses/clean-charges).
  const cleaningDays = new Set(items.filter(i => i.kind === 'cleaning').map(i => `${i.unitId}|${i.incurredOn}`));
  const unchargedCleans = cleans.flatMap(t => {
    const day = mytDay(t.done_at);
    if (!day || day < from || day >= toEx) return [];
    return [{ taskId: t.id, unitId: t.unit_id, unitLabel: label(byId.get(t.unit_id)), kind: t.kind, title: t.title, doneOn: day,
      sameDayCost: cleaningDays.has(`${t.unit_id}|${day}`) }];
  });
  const adj: AdjustmentItem[] = adjustments.flatMap(a => {
    const placed = byId.get(a.unit_id ?? firstOf(a.owner_id)?.id);
    if (!placed) return [];
    const occurred = String(a.occurred_on).slice(0, 10);
    return [{
      id: a.id, unitId: placed.id, unitLabel: label(placed), placedOnFirstUnit: !a.unit_id, kind: a.kind, amount: Number(a.amount),
      isMaintenanceFee: Number(a.amount) < 0 && MAINTENANCE_FEE_CHARGE.test(String(a.description)),
      description: String(a.description).replace(/^O2:\s*/i, ''), occurredOn: occurred, reference: a.reference ?? null, state: a.state, source: a.source,
      inMonth: occurred >= from && occurred < toEx,
      statement: a.statement_id ? { id: a.statement_id, period: String(a.period_start).slice(0, 7), state: a.statement_state } : null,
    }];
  });

  const per = new Map<string, { totals: Totals; kinds: Map<string, { owner: number; others: number }> }>();
  const all_ = { totals: zero(), kinds: new Map<string, { owner: number; others: number }>() };
  const bucket = (id: string) => { let b = per.get(id); if (!b) { b = { totals: zero(), kinds: new Map() }; per.set(id, b); } return b; };
  for (const u of units) bucket(u.id);
  const add = (b: typeof all_, it: CostItem) => {
    const k = b.kinds.get(it.kind) ?? { owner: 0, others: 0 };
    if (it.chargeTo === 'owner') {
      k.owner += it.amount; b.totals.deducted += it.amount;
      b.totals[TOTAL_OF[it.group]] += it.amount;
    } else { k.others += it.amount; b.totals.notCharged += it.amount; }
    b.kinds.set(it.kind, k);
  };
  for (const it of items) { add(bucket(it.unitId), it); add(all_, it); }
  // Only the month's own credits and charges count in the month's figures; waiting ones are listed, not totalled.
  // The month's maintenance-fee charges, after the split, shown against the Maintenance fee (condo) kind.
  const feeAfter = new Map<string, number>();
  for (const a of adj) {
    if (!a.inMonth || a.state === 'held') continue;
    for (const b of [bucket(a.unitId), all_]) { if (a.amount < 0) b.totals.charges += -a.amount; else b.totals.credits += a.amount; }
    if (a.amount < 0 && MAINTENANCE_FEE_CHARGE.test(a.description)) {
      for (const key of [a.unitId, '']) feeAfter.set(key, (feeAfter.get(key) ?? 0) - a.amount);
      for (const b of [bucket(a.unitId), all_]) b.totals.maintenanceFee += -a.amount;
    }
  }
  // afterSplit: the maintenance-fee charges (building_fee only); amount stays what is deducted before the split.
  const shape = (b: typeof all_, key: string) => ({
    totals: b.totals,
    kinds: KINDS.map(k => ({ key: k.key, label: k.label, group: k.group, amount: b.kinds.get(k.key)?.owner ?? 0, others: b.kinds.get(k.key)?.others ?? 0,
      afterSplit: k.key === 'building_fee' ? feeAfter.get(key) ?? 0 : 0 })),
  });
  const model = (u: any): RevenueModel => modelOf(u);
  return {
    month,
    units: units.map(u => ({
      unitId: u.id, unitLabel: label(u), revenueModel: model(u),
      // A fixed rent or a master lease pays the owner the same whatever the costs: they are the company's.
      deductsFromOwner: model(u) !== 'grr' && model(u) !== 'master_lease',
      ...shape(bucket(u.id), u.id),
    })),
    total: shape(all_, ''),
    items, adjustments: adj, unchargedCleans,
  };
}

const shiftDay = (d: string, by: number) => new Date(Date.parse(`${d}T00:00:00Z`) + by * 864e5).toISOString().slice(0, 10);
/** The Malaysian calendar day of a stored instant ('2026-10-03T04:00:00.000Z', '2026-10-03T12:00:00+08:00'). */
export function mytDay(at: string | null): string | null {
  const t = Date.parse(String(at ?? ''));
  return Number.isFinite(t) ? new Date(t + 8 * 3600e3).toISOString().slice(0, 10) : null;
}
