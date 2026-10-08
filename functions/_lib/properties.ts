import { type Env, one, all, run, audit, nowIso } from './db';
import type { Session } from './auth';

export const MASTER_ROLES = ['management', 'operations_manager', 'finance_admin'];
export const PACKAGES = ['Package A', 'Package B', 'Package C'];
export const TERMS = ['Long term', 'Short term'];
export const SPLITS = ['Not set', 'Profit share', 'GRR — guaranteed rent'];

export const GUARANTEE_PERIODS = ['month', 'year'];

export interface UnitInput {
  buildingId?: string; parentUnitId?: string | null; listingName?: string; unitCode?: string; address?: string;
  ownerName?: string; ic?: string; bankName?: string; bankAccount?: string; accountHolder?: string;
  pkg?: string; term?: string; split?: string; splitValue?: number | null; guaranteePeriod?: string;
  bedrooms?: number;
  expenses?: { id?: string; category: string; amount: number; note?: string }[];
  contract?: { feePct: number; startedOn: string; renewsOn: string };
}

/** The first problem with the input, or null. Field name matches the form so the screen can mark it. */
export function invalidUnit(b: UnitInput): { field: string; message: string } | null {
  if (b.pkg !== undefined && !PACKAGES.includes(b.pkg)) return { field: 'pkg', message: 'Pick a package.' };
  if (b.term !== undefined && !TERMS.includes(b.term)) return { field: 'term', message: 'Pick a term.' };
  if (b.split !== undefined && !SPLITS.includes(b.split)) return { field: 'split', message: 'Pick a split.' };
  if (b.splitValue != null && (!Number.isInteger(b.splitValue) || b.splitValue < 0)) return { field: 'splitValue', message: 'Enter a whole number.' };
  if (b.guaranteePeriod !== undefined && !GUARANTEE_PERIODS.includes(b.guaranteePeriod)) return { field: 'guaranteePeriod', message: 'Pick month or year.' };
  if (b.bedrooms !== undefined && (!Number.isInteger(b.bedrooms) || b.bedrooms < 0 || b.bedrooms > 20)) return { field: 'bedrooms', message: 'Bedrooms must be a whole number from 0 to 20.' };
  if (b.contract) {
    if (!(b.contract.feePct >= 0 && b.contract.feePct <= 100)) return { field: 'feePct', message: 'The fee must be between 0 and 100.' };
    if (!b.contract.startedOn) return { field: 'startedOn', message: 'Enter the start date.' };
  }
  for (const e of b.expenses ?? []) {
    if (!e.category?.trim()) return { field: 'expenses', message: 'Every expense needs a category.' };
    if (!Number.isInteger(e.amount) || e.amount < 0) return { field: 'expenses', message: 'Expense amounts must be whole sen, zero or more.' };
  }
  return null;
}

/** The owner a unit belongs to: reuse the one with the same ID number or name, otherwise create. */
export async function ownerFor(env: Env, b: UnitInput): Promise<string> {
  const name = (b.ownerName ?? '').trim() || 'New owner';
  const ic = (b.ic ?? '').trim() || null;
  const found = ic
    ? await one<{ id: string }>(env, 'SELECT id FROM owners WHERE ic_number = ? LIMIT 1', ic)
    : await one<{ id: string }>(env, 'SELECT id FROM owners WHERE lower(display_name) = lower(?) LIMIT 1', name);
  if (found) return found.id;
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO owners (id, display_name, email, ic_number, bank_name, bank_account_holder, bank_account_number, bank_account_last4, created_at, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
    id, name, ic, b.bankName ?? null, b.accountHolder ?? null, b.bankAccount ?? null, (b.bankAccount ?? '').slice(-4) || null, now, now);
  return id;
}

export async function saveExpenses(env: Env, unitId: string, list: NonNullable<UnitInput['expenses']>) {
  await run(env, 'DELETE FROM unit_expenses WHERE unit_id = ?', unitId);
  let i = 0;
  for (const e of list) {
    await run(env, 'INSERT INTO unit_expenses (id, unit_id, category, amount, note, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), unitId, e.category.trim(), e.amount, (e.note ?? '').slice(0, 300), i++);
  }
}

/** Creates or updates the owner's contract row for a unit and links it. Returns the contract id. */
export async function saveContract(env: Env, unitId: string, ownerId: string, c: NonNullable<UnitInput['contract']>): Promise<string> {
  const cur = await one<{ contract_id: string | null }>(env, 'SELECT contract_id FROM units WHERE id = ?', unitId);
  const now = nowIso();
  if (cur?.contract_id) {
    await run(env, 'UPDATE owner_contracts SET management_fee_pct = ?, starts_on = ?, renews_on = ? WHERE id = ?', c.feePct, c.startedOn, c.renewsOn || null, cur.contract_id);
    return cur.contract_id;
  }
  const id = crypto.randomUUID();
  await run(env, 'INSERT INTO owner_contracts (id, owner_id, management_fee_pct, starts_on, renews_on, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, ownerId, c.feePct, c.startedOn, c.renewsOn || null, now);
  await run(env, 'UPDATE units SET contract_id = ? WHERE id = ?', id, unitId);
  return id;
}

export async function auditUnit(env: Env, session: Session, action: string, unitId: string, after: unknown) {
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action, entityTable: 'units', entityId: unitId, after });
}

export { all };
