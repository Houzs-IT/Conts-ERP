import { type Env, one, all, run, audit, nowIso } from './db';
import type { Session } from './auth';
import { PURPOSES, USED_BY, invalidBeds, invalidBays, type Bed, type BayInput } from './unitPurpose';

export const MASTER_ROLES = ['management', 'operations_manager', 'finance_admin'];
export const PACKAGES = ['Package A', 'Package B', 'Package C', 'Package D'];
export const TERMS = ['Long term', 'Short term'];
export const SPLITS = ['Not set', 'Profit share', 'GRR — guaranteed rent'];

export const GUARANTEE_PERIODS = ['month', 'year'];
export const LAYOUT_TYPES = ['studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_plus_bedroom', 'duplex', 'dual_key', 'penthouse', 'other'];

/** Owner identity and bank fields the unit endpoints once took. They belong to the owner profile (owners/[id]), so a unit
 *  request carrying one is refused rather than silently changing the owner of every unit they have. */
export const OWNER_FIELDS = ['ownerName', 'ic', 'bankName', 'bankAccount', 'accountHolder'];
export const ownerFieldIn = (b: object) => OWNER_FIELDS.find(k => k in b) ?? null;

export interface UnitInput {
  buildingId?: string; parentUnitId?: string | null; listingName?: string; unitCode?: string; address?: string;
  /** The owner, picked from the owner profiles. Their name, IC and bank details are edited on the owner, never here. */
  ownerId?: string;
  pkg?: string; term?: string; split?: string; splitValue?: number | null; guaranteePeriod?: string;
  bedrooms?: number; bathrooms?: number; sizeSqft?: number | null;
  /** Migration 0123; null clears it. */
  layoutType?: string | null;
  /** Migration 0125: rental, showroom or warehouse; who uses it (null clears); beds; car park bays (the whole list). */
  purpose?: string; usedBy?: string | null; beds?: Bed[]; parkingBays?: BayInput[];
  /** With a purpose change: end the contract in force today when it does not fit the new purpose. */
  endContract?: boolean;
  /** The standard clean's price on this unit (sen): the unit's one 'cleaning' row in unit_expenses, which cleanPrice()
   *  reads. null clears it (amount 0, so cleans charge the last price used or the default). */
  cleaningPrice?: number | null;
  /** The deep clean's price (sen): the unit's 'cleaning_deep' row, read by cleanPrice() for a deep clean. null clears it. */
  deepCleaningPrice?: number | null;
  expenses?: { id?: string; category: string; amount: number; note?: string }[];
  contract?: { feePct: number; startedOn: string; renewsOn: string };
}

/** IC and bank numbers leave the server as '••••' + the last four (like the owner profile). The Units form sends
 *  back whatever it shows, so a value still carrying the mask means "unchanged" and must never be stored. */
export const MASK = '••••';
export const masked = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  return s ? (s.length > 4 ? MASK + s.slice(-4) : MASK) : '';
};
/** The value to store: undefined when the form sent the masked value back (keep what is stored). */
export const typed = (v: string | undefined) => (typeof v === 'string' && v.includes(MASK.charAt(0)) ? undefined : v);

/** The first problem with the input, or null. Field name matches the form so the screen can mark it. */
export function invalidUnit(b: UnitInput): { field: string; message: string } | null {
  if (b.pkg !== undefined && !PACKAGES.includes(b.pkg)) return { field: 'pkg', message: 'Pick a package.' };
  if (b.term !== undefined && !TERMS.includes(b.term)) return { field: 'term', message: 'Pick a term.' };
  if (b.split !== undefined && !SPLITS.includes(b.split)) return { field: 'split', message: 'Pick a split.' };
  if (b.splitValue != null && (!Number.isInteger(b.splitValue) || b.splitValue < 0)) return { field: 'splitValue', message: 'Enter a whole number.' };
  if (b.guaranteePeriod !== undefined && !GUARANTEE_PERIODS.includes(b.guaranteePeriod)) return { field: 'guaranteePeriod', message: 'Pick month or year.' };
  if (b.bedrooms !== undefined && (!Number.isInteger(b.bedrooms) || b.bedrooms < 0 || b.bedrooms > 20)) return { field: 'bedrooms', message: 'Bedrooms must be a whole number from 0 to 20.' };
  if (b.bathrooms !== undefined && (!Number.isInteger(b.bathrooms) || b.bathrooms < 0 || b.bathrooms > 20)) return { field: 'bathrooms', message: 'Bathrooms must be a whole number from 0 to 20.' };
  if (b.sizeSqft != null && (!Number.isInteger(b.sizeSqft) || b.sizeSqft < 1 || b.sizeSqft > 100000)) return { field: 'sizeSqft', message: 'Enter the size in whole square feet.' };
  if (b.layoutType != null && !LAYOUT_TYPES.includes(b.layoutType)) return { field: 'layoutType', message: 'Pick a layout type.' };
  if (b.purpose !== undefined && !(PURPOSES as readonly string[]).includes(b.purpose)) return { field: 'purpose', message: 'Pick rental, showroom or warehouse.' };
  if (b.usedBy != null && !(USED_BY as readonly string[]).includes(b.usedBy)) return { field: 'usedBy', message: 'Pick who uses the unit.' };
  if (b.beds !== undefined) { const m = invalidBeds(b.beds); if (m) return { field: 'beds', message: m }; }
  if (b.parkingBays !== undefined) { const m = invalidBays(b.parkingBays); if (m) return { field: 'parkingBays', message: m }; }
  if (b.cleaningPrice != null && (!Number.isInteger(b.cleaningPrice) || b.cleaningPrice < 0 || b.cleaningPrice > 10_000_000)) return { field: 'cleaningPrice', message: 'Enter the cleaning price in ringgit, RM 0.00 or more.' };
  if (b.deepCleaningPrice != null && (!Number.isInteger(b.deepCleaningPrice) || b.deepCleaningPrice < 0 || b.deepCleaningPrice > 10_000_000)) return { field: 'deepCleaningPrice', message: 'Enter the deep cleaning price in ringgit, RM 0.00 or more.' };
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

/** Sets the unit's standard or deep cleaning price: updates its first 'cleaning' or 'cleaning_deep' row in unit_expenses (the row cleanPrice() in
 *  functions/_lib/cleaning.ts reads), or adds one after the others. Every other row is left as it is. */
export async function saveCleaningPrice(env: Env, unitId: string, amount: number, category: 'cleaning' | 'cleaning_deep' = 'cleaning') {
  const row = await one<{ id: string }>(env, `SELECT id FROM unit_expenses WHERE unit_id = ? AND category = ? ORDER BY sort_order LIMIT 1`, unitId, category);
  if (row) { await run(env, 'UPDATE unit_expenses SET amount = ? WHERE id = ?', amount, row.id); return; }
  await run(env, `INSERT INTO unit_expenses (id, unit_id, category, amount, note, sort_order)
    SELECT ?, ?, ?, ?, '', COALESCE(MAX(sort_order) + 1, 0) FROM unit_expenses WHERE unit_id = ?`, crypto.randomUUID(), unitId, category, amount, unitId);
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

export async function auditUnit(env: Env, session: Session, action: string, unitId: string, after: unknown, before?: unknown) {
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action, entityTable: 'units', entityId: unitId, before, after });
}

export { all };
