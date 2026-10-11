import { type Env, all } from './db';
import { monthEndExclusive } from './revenue';
import { modelOf, type RevenueModel } from './revenueModel';
import { UNIT_SQL } from './ownerStatement';
import { LOCKED_SQL } from './expenses';

/** A month's costs on a unit, or on every unit of an owner, grouped the way the owner reads them (owner, 11 Oct 2026):
 *    Cleaning        every clean charged to the unit (category cleaning / housekeeping)
 *    Maintenance     repairs (category maintenance, or raised from a maintenance job)
 *    Paid on behalf  bills The Conts pays for the owner: water, electricity, Wi-Fi, Indah Water, the building's
 *                    maintenance fee and anything else
 *  Only what the owner pays (charge_to 'owner') is deducted, before the operator's share, exactly as the statement
 *  deducts it (ownerStatement.ts reads the same rows); what the company, a tenant or a guest paid is shown apart.
 *  Owner credits and charges (owner_adjustments, the workbook's O2 lines such as "MAINTENANCE FEE SEPT 26") are listed
 *  with the paid-on-behalf bills but stay where the statement puts them: after the split. */

/** The statement's deduction rows (ownerStatement.ts DEDUCTIONS, printed on the Owner Income Report as the workbook
 *  names them) in the words the screens use. */
export const DEDUCTION_WORDS: Record<string, string> = {
  cleaning_basic: 'Cleaning', cleaning_deep: 'Deep cleaning', electricity: 'Electricity (paid on behalf)', water: 'Water (paid on behalf)',
  internet: 'Wi-Fi (paid on behalf)', sewerage: 'IndahWater (paid on behalf)', additional: 'Maintenance job and other paid on behalf',
  misc: 'Miscellaneous charges',
};

export type CostGroup = 'cleaning' | 'maintenance' | 'paid_on_behalf';
export const KINDS: { key: string; label: string; group: CostGroup }[] = [
  { key: 'cleaning', label: 'Cleaning', group: 'cleaning' },
  { key: 'maintenance', label: 'Maintenance', group: 'maintenance' },
  { key: 'water', label: 'Water', group: 'paid_on_behalf' },
  { key: 'electricity', label: 'Electricity', group: 'paid_on_behalf' },
  { key: 'internet', label: 'Wi-Fi', group: 'paid_on_behalf' },
  { key: 'sewerage', label: 'IndahWater', group: 'paid_on_behalf' },
  { key: 'building_fee', label: 'Building maintenance fee', group: 'paid_on_behalf' },
  { key: 'other', label: 'Other', group: 'paid_on_behalf' },
];
const KIND = new Map(KINDS.map(k => [k.key, k]));

/** The building's maintenance fee has no category of its own: it is stored as 'other' (the statement's Additional
 *  Deduction, where every owner-paid bill outside the named utilities goes) with a description starting
 *  "Building maintenance fee" (BillModal writes it so). */
export const BUILDING_FEE = /^building maintenance fee\b/i;

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

interface Totals { cleaning: number; maintenance: number; paidOnBehalf: number; deducted: number; notCharged: number; credits: number; charges: number }
const zero = (): Totals => ({ cleaning: 0, maintenance: 0, paidOnBehalf: 0, deducted: 0, notCharged: 0, credits: 0, charges: 0 });

export interface CostItem {
  id: string; unitId: string; unitLabel: string; kind: string; kindLabel: string; group: CostGroup; category: string; description: string;
  amount: number; chargeTo: string; incurredOn: string; reference: string | null; receiptDocumentId: string | null; locked: boolean;
}
export interface AdjustmentItem {
  id: string; unitId: string; unitLabel: string; placedOnFirstUnit: boolean; kind: string; amount: number; description: string;
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
  const [expenses, adjustments] = await Promise.all([
    all<any>(env, `
      SELECT e.id, e.unit_id, e.category, e.description, e.amount, e.incurred_on, e.charge_to, e.reference, e.maintenance_id, e.receipt_document_id,
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
    };
  });
  const adj: AdjustmentItem[] = adjustments.flatMap(a => {
    const placed = byId.get(a.unit_id ?? firstOf(a.owner_id)?.id);
    if (!placed) return [];
    const occurred = String(a.occurred_on).slice(0, 10);
    return [{
      id: a.id, unitId: placed.id, unitLabel: label(placed), placedOnFirstUnit: !a.unit_id, kind: a.kind, amount: Number(a.amount),
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
      if (it.group === 'cleaning') b.totals.cleaning += it.amount; else if (it.group === 'maintenance') b.totals.maintenance += it.amount; else b.totals.paidOnBehalf += it.amount;
    } else { k.others += it.amount; b.totals.notCharged += it.amount; }
    b.kinds.set(it.kind, k);
  };
  for (const it of items) { add(bucket(it.unitId), it); add(all_, it); }
  // Only the month's own credits and charges count in the month's figures; waiting ones are listed, not totalled.
  for (const a of adj) {
    if (!a.inMonth || a.state === 'held') continue;
    for (const b of [bucket(a.unitId), all_]) { if (a.amount < 0) b.totals.charges += -a.amount; else b.totals.credits += a.amount; }
  }
  const shape = (b: typeof all_) => ({
    totals: b.totals,
    kinds: KINDS.map(k => ({ key: k.key, label: k.label, group: k.group, amount: b.kinds.get(k.key)?.owner ?? 0, others: b.kinds.get(k.key)?.others ?? 0 })),
  });
  const model = (u: any): RevenueModel => modelOf(u);
  return {
    month,
    units: units.map(u => ({
      unitId: u.id, unitLabel: label(u), revenueModel: model(u),
      // A fixed rent or a master lease pays the owner the same whatever the costs: they are the company's.
      deductsFromOwner: model(u) !== 'grr' && model(u) !== 'master_lease',
      ...shape(bucket(u.id)),
    })),
    total: shape(all_),
    items, adjustments: adj,
  };
}
