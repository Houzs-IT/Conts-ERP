/** What the Unit report's Monthly and Yearly views share, so the two list the same units under the same kinds with the
 *  same income (owner, 19 Nov 2026). */
import { type Env, all } from './db';
import { hasColumn } from './auth';
import { unitForMonth, type UnitRow, type UnitMonth } from './ownerStatement';
import { type RevenueModel } from './revenueModel';
import { codeOf } from './unitPurpose';
import type { ContractTypeRow } from './contractTypes';
import { monthEndExclusive } from './revenue';
import type { ReportGroup } from '../../src/lib/ownerOverall';

/** A type is grouped by its income model; one whose owner is paid a fixed amount is in the MANAGE group. GRR is no
 *  longer a contract type (contractTypes.ts NO_GRR), so it has no group of its own. */
const MODEL_GROUP: Partial<Record<RevenueModel, ReportGroup>> = {
  management: 'PS', management_guarantee: 'PS', management_yearly_guarantee: 'PS', long_term: 'LT', master_lease: 'RTR',
};

const TRADED = new Set(['master_lease', 'long_term']);
/** A unit the company trades itself while paying the owner a fixed rent: a master lease (RTR) and a long-term let
 *  (Package C). The owner's workbook reports both this way (整体报告, LONG TERM rows: revenue = the stays, GP less the
 *  LT rent = gain/loss; owner, 19 Nov 2026), so the report reads them as GRR: stays are income, the rent is the owner base. */
export const isTraded = (model: string | null | undefined): boolean => TRADED.has(model ?? '');
export const asTrading = (u: UnitRow): UnitRow => ({
  ...u,
  revenue_model: isTraded(u.revenue_model) ? 'grr' : u.revenue_model,
  history: u.history?.map(h => (isTraded(h.revenue_model) ? { ...h, revenue_model: 'grr' } : h)),
});

/** The unit's kind on the report that month and its staff code. A unit with no contract for the month is NONE (owner,
 *  19 Nov 2026: list it anyway, its contract is added later), never left out. */
export function groupOf(types: readonly ContractTypeRow[], u: UnitRow, m: UnitMonth, month: string): { group: ReportGroup; code: string | null } {
  if (m.terms.source !== 'contract') return { group: 'NONE', code: null };
  // The stored code belongs to the current contract; a month under an earlier one reads its code from that model.
  const stored = unitForMonth(u, month).contract_id === u.contract_id ? u.contract_code : null;
  const code = codeOf(types, m.terms.model as RevenueModel, stored);
  const group = types.find(type => type.code === code)?.hasFixedOwnerAmount ? 'MANAGE' : MODEL_GROUP[m.terms.model as RevenueModel];
  return { group: group ?? 'NONE', code: code || null };
}

/** Showroom and warehouse units are not rentals, so the Unit report leaves them out (owner, 19 Nov 2026). */
export async function nonRentalUnits(env: Env): Promise<Set<string>> {
  if (!(await hasColumn(env, 'units', 'purpose'))) return new Set();
  const rows = await all<{ id: string }>(env, `SELECT id FROM units WHERE purpose IS NOT NULL AND purpose <> 'rental'`);
  return new Set(rows.map(r => r.id));
}

const DAY = 864e5;
const days = (from: string, toEx: string) => Math.max(0, Math.round((Date.parse(`${toEx}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY));
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/** A rent to rent's income from its tenant: the contract's rent-out amount for each month (owner, 19 Nov 2026), in sen,
 *  by the share of the month the contract covers. Key: `unitId|yyyy-mm`. */
export async function rentOutIncome(env: Env, months: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!months.length || !(await hasColumn(env, 'owner_contracts', 'rent_out_amount'))) return out;
  const rows = await all<{ unit_id: string; rent_out_amount: number; starts_on: string | null; ends_on: string | null }>(env,
    `SELECT unit_id, rent_out_amount, starts_on::text AS starts_on, ends_on::text AS ends_on FROM owner_contracts
     WHERE revenue_model = 'master_lease' AND rent_out_amount > 0 AND unit_id IS NOT NULL`);
  for (const month of months) {
    const start = `${month}-01`, endEx = monthEndExclusive(month), inMonth = days(start, endEx);
    for (const r of rows) {
      const from = r.starts_on && r.starts_on > start ? r.starts_on.slice(0, 10) : start;
      const toEx = r.ends_on && nextDay(r.ends_on.slice(0, 10)) < endEx ? nextDay(r.ends_on.slice(0, 10)) : endEx;
      const covered = days(from, toEx);
      if (!covered) continue;
      const key = `${r.unit_id}|${month}`;
      out.set(key, (out.get(key) ?? 0) + Math.round((Number(r.rent_out_amount) * covered) / inMonth));
    }
  }
  return out;
}
