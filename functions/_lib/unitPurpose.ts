/** What a unit is for, its beds and car park bays, and the staff's contract codes (migration 0125; staff comment sheet
 *  UNIT and the owner's clarification of 17 Oct 2026).
 *
 *  A rental unit is sold on the channels as before. A showroom (Dream Crafter / Inhouse Reno display unit) or a
 *  warehouse (renovation warehouse) is never connected to the channels: it is left out of Channex, price pushes, the
 *  reservations calendar, pricing and occupancy figures, and takes no reservations (so no turnover cleans). */
import { type Env, one, all, run, nowIso } from './db';
import { hasColumn } from './auth';
import type { RevenueModel } from './revenueModel';

export const PURPOSES = ['rental', 'showroom', 'warehouse'] as const;
export type Purpose = typeof PURPOSES[number];
export const PURPOSE_LABEL: Record<Purpose, string> = { rental: 'Rental', showroom: 'Showroom', warehouse: 'Warehouse' };
export const USED_BY = ['the_conts', 'dream_crafter', 'inhouse_reno'] as const;
export type UsedBy = typeof USED_BY[number];

export const BED_SIZES = ['king', 'queen', 'super_single', 'single', 'sofa_bed', 'single_floor_mattress', 'double_decker'] as const;
export type BedSize = typeof BED_SIZES[number];
export interface Bed { size: BedSize; quantity: number }

/** True once migration 0125 is on this database. */
export const purposeReady = (env: Env) => hasColumn(env, 'units', 'purpose').catch(() => false);

/** " AND u.purpose = 'rental'" when the column exists, else nothing (every unit was a rental before 0125). */
export async function rentalOnly(env: Env, alias = 'u'): Promise<string> {
  return (await purposeReady(env)) ? ` AND ${alias}.purpose = 'rental'` : '';
}
/** The unit's purpose; 'rental' for a unit on a database without the column. */
export async function purposeOf(env: Env, unitId: string): Promise<Purpose | null> {
  if (!(await purposeReady(env))) return (await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', unitId)) ? 'rental' : null;
  const r = await one<{ purpose: string }>(env, 'SELECT purpose FROM units WHERE id = ?', unitId);
  return r ? (r.purpose as Purpose) : null;
}
export const NOT_ON_CHANNELS = 'Showroom and warehouse units are not connected to the channels.';

/** Problems with a beds list, or null. Sizes from BED_SIZES, 1 to 20 of each, one row per size. */
export function invalidBeds(v: unknown): string | null {
  if (!Array.isArray(v)) return 'Beds must be a list.';
  if (v.length > BED_SIZES.length) return 'One line per bed size.';
  const seen = new Set<string>();
  for (const b of v) {
    if (!b || typeof b !== 'object' || !(BED_SIZES as readonly string[]).includes((b as Bed).size)) return 'Pick a bed size.';
    if (seen.has((b as Bed).size)) return 'Each bed size once; change its quantity instead.';
    seen.add((b as Bed).size);
    const q = (b as Bed).quantity;
    if (!Number.isInteger(q) || q < 1 || q > 20) return 'Enter 1 to 20 beds.';
  }
  return null;
}

export interface BayInput { lotNumber: string; level?: string | null; note?: string | null }
export function invalidBays(v: unknown): string | null {
  if (!Array.isArray(v)) return 'Car park bays must be a list.';
  if (v.length > 30) return 'At most 30 bays on a unit.';
  for (const b of v) {
    if (!b || typeof b !== 'object' || typeof (b as BayInput).lotNumber !== 'string' || !(b as BayInput).lotNumber.trim()) return 'Every bay needs its lot number.';
    if ((b as BayInput).lotNumber.trim().length > 40) return 'A lot number is at most 40 characters.';
    const lv = (b as BayInput).level, nt = (b as BayInput).note;
    if (lv != null && (typeof lv !== 'string' || lv.length > 40)) return 'The level is at most 40 characters.';
    if (nt != null && (typeof nt !== 'string' || nt.length > 200)) return 'The note is at most 200 characters.';
  }
  return null;
}

/* ---- contract codes ---- */

/** The staff's list (sheet UNIT): each code and the revenue model the statement works it out by. GRR is the older
 *  guaranteed-rent model, kept for the contracts that have it. */
export const CONTRACT_CODES = ['PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE', 'WH', 'WH LT', 'GRR'] as const;
export type ContractCode = typeof CONTRACT_CODES[number];
export const CODE_MODEL: Record<ContractCode, RevenueModel> = {
  PS: 'management', 'PS GRR': 'management_guarantee', 'PS YGRR': 'management_yearly_guarantee', LT: 'long_term',
  RTR: 'master_lease', MANAGE: 'management', WH: 'master_lease', 'WH LT': 'wh_long_term', GRR: 'grr',
};
export const CODE_LABEL: Record<ContractCode, string> = {
  PS: 'Airbnb profit sharing', 'PS GRR': 'Profit sharing with monthly GRR', 'PS YGRR': 'Profit sharing with yearly GRR',
  LT: 'Airbnb long term', RTR: 'Rent to rent', MANAGE: 'Listing management', WH: 'Warehouse / showroom lease', 'WH LT': 'Showroom / warehouse long-term', GRR: 'Guaranteed rent',
};
export const isContractCode = (v: unknown): v is ContractCode => typeof v === 'string' && (CONTRACT_CODES as readonly string[]).includes(v);

/** The code of a contract row: its own, else read from its model as the staff name them. */
export function codeOf(revenueModel: RevenueModel, stored?: string | null): ContractCode {
  if (isContractCode(stored)) return stored;
  return ({ management: 'PS', management_guarantee: 'PS GRR', management_yearly_guarantee: 'PS YGRR', grr: 'GRR', master_lease: 'RTR', long_term: 'LT', wh_long_term: 'WH LT' } as const)[revenueModel];
}

/** Which codes a unit of each purpose may take (owner, 17 Oct 2026; WH LT 22 Oct 2026). A rental unit already on the older GRR keeps it. */
export function codesFor(purpose: Purpose, currentCode?: ContractCode | null): ContractCode[] {
  if (purpose !== 'rental') return ['WH', 'WH LT'];
  const list: ContractCode[] = ['PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE'];
  return currentCode === 'GRR' ? [...list, 'GRR'] : list;
}

/* ---- reading and saving a unit's purpose, beds and bays ---- */

export interface UnitExtras { purpose: Purpose; usedBy: UsedBy | null; beds: Bed[]; parkingBays: { id: string; lotNumber: string; level: string | null; note: string | null }[] }

/** Purpose, used-by, beds and bays for the given units (all units when ids is null). Defaults before 0125. */
export async function extrasFor(env: Env, ids: string[] | null): Promise<Map<string, UnitExtras>> {
  const out = new Map<string, UnitExtras>();
  if (!(await purposeReady(env))) return out;
  const filter = ids ? ' WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : '';
  const args = ids ? [JSON.stringify(ids)] : [];
  const [units, bays] = await Promise.all([
    all<{ id: string; purpose: Purpose; used_by: UsedBy | null; beds: unknown }>(env, `SELECT id, purpose, used_by, beds FROM units${ids ? ' WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''}`, ...args),
    all<{ id: string; unit_id: string; lot_number: string; level: string | null; note: string | null }>(env, `SELECT id, unit_id, lot_number, level, note FROM unit_parking_bays${filter} ORDER BY unit_id, sort_order, lot_number`, ...args),
  ]);
  for (const u of units) {
    const beds = typeof u.beds === 'string' ? JSON.parse(u.beds) : u.beds;
    out.set(u.id, { purpose: u.purpose, usedBy: u.used_by, beds: Array.isArray(beds) ? beds : [], parkingBays: [] });
  }
  for (const b of bays) out.get(b.unit_id)?.parkingBays.push({ id: b.id, lotNumber: b.lot_number, level: b.level, note: b.note });
  return out;
}

/** "1 King · 2 Single". */
export function bedsLabel(beds: Bed[]): string {
  const name: Record<BedSize, string> = { king: 'King', queen: 'Queen', super_single: 'Super single', single: 'Single', sofa_bed: 'Sofa bed', single_floor_mattress: 'Single floor mattress', double_decker: 'Double decker' };
  return beds.map(b => `${b.quantity} ${name[b.size] ?? b.size}`).join(' · ');
}
/** "LEVEL 5-100 (Tandem)": level first, then the lot, then the note (staff sheet UNIT, 23 Oct 2026). A level typed
 *  as "L5" or "Level 5" is not doubled up. */
export function bayLabel(b: { lotNumber: string; level?: string | null; note?: string | null }): string {
  const lot = b.lotNumber.trim(), level = b.level?.trim().replace(/^(level|lvl|l)\s*(?=\d)/i, ''), note = b.note?.trim();
  return `${level ? `LEVEL ${level}-${lot}` : lot}${note ? ` (${note})` : ''}`;
}
/** "2 bays: LEVEL 2-105, LEVEL 2-106". */
export function baysLabel(bays: { lotNumber: string; level?: string | null; note?: string | null }[]): string {
  if (!bays.length) return '';
  return `${bays.length} ${bays.length === 1 ? 'bay' : 'bays'}: ${bays.map(bayLabel).join(', ')}`;
}

export async function saveBays(env: Env, unitId: string, bays: BayInput[]) {
  await run(env, 'DELETE FROM unit_parking_bays WHERE unit_id = ?', unitId);
  if (!bays.length) return;
  const now = nowIso();
  await run(env, `INSERT INTO unit_parking_bays (id, unit_id, lot_number, level, note, sort_order, created_at)
    SELECT gen_random_uuid()::text, ?, x.lot, NULLIF(x.level, ''), NULLIF(x.note, ''), x.n, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(lot text, level text, note text, n int)`,
    unitId, now, JSON.stringify(bays.map((b, n) => ({ lot: b.lotNumber.trim(), level: b.level?.trim() ?? '', note: b.note?.trim() ?? '', n }))));
}

/** "2 bays: LEVEL 2-105, LEVEL 2-106" for one unit, or null (also before 0125). For the screens that show how to get in. */
export async function parkingFor(env: Env, unitId: string): Promise<string | null> {
  if (!(await purposeReady(env))) return null;
  const bays = await all<{ lot_number: string; level: string | null; note: string | null }>(env, 'SELECT lot_number, level, note FROM unit_parking_bays WHERE unit_id = ? ORDER BY sort_order, lot_number', unitId);
  return baysLabel(bays.map(b => ({ lotNumber: b.lot_number, level: b.level, note: b.note }))) || null;
}
