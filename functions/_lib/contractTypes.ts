import { type Env, all } from './db';
import { hasColumn } from './auth';
import { isRevenueModel, type RevenueModel } from './revenueModel';

/** The contract types (PS, PS GRR, RTR, ...) kept by staff on Units > Unit settings (owner, 4 Nov 2026; migration 0206).
 *  A type is a code, a label and package, and the revenue model the owner statement works it out by. Before 0206 it is the
 *  fixed list below, the one owner_contracts.contract_code was checked against. */
export interface ContractTypeRow {
  code: string; label: string; package: string | null; revenueModel: RevenueModel; blurb: string | null;
  isDefaultForModel: boolean; sortOrder: number; isActive: boolean;
}

export const CONTRACT_CODE_PATTERN = /^[A-Z0-9 ]{1,20}$/;

/** Guaranteed rent (GRR) was removed (owner, 4 Nov 2026: "there is only 6 now, don't let GRR go in"). Every way in refuses it
 *  with this; the grr model stays in code only for units with no contract whose old split still reads GRR. */
export const NO_GRR = 'Guaranteed rent (GRR) is no longer a contract type. Pick one of the six.';

const builtIn = (n: number, code: string, label: string, pkg: string | null, revenueModel: RevenueModel, blurb: string, isDefaultForModel = true): ContractTypeRow =>
  ({ code, label, package: pkg, revenueModel, blurb, isDefaultForModel, sortOrder: n * 10, isActive: true });

export const BUILT_IN_CONTRACT_TYPES: readonly ContractTypeRow[] = [
  builtIn(1, 'PS', 'Airbnb profit sharing', 'Package A', 'management', 'We run it on the channels and split the profit'),
  builtIn(2, 'PS GRR', 'Profit sharing with monthly GRR', 'Package B', 'management_guarantee', 'A split, with a minimum for the owner every month'),
  builtIn(3, 'LT', 'Airbnb long term', 'Package C', 'long_term', 'Let to one tenant, not on the channels'),
  builtIn(4, 'PS YGRR', 'Profit sharing with yearly GRR', 'Package D', 'management_yearly_guarantee', 'A split, with a minimum for the owner each contract year'),
  builtIn(5, 'RTR', 'Rent to rent', null, 'master_lease', 'We rent the unit from the owner and run it'),
  builtIn(6, 'MANAGE', 'Listing management', null, 'management', 'We manage the listing for a fee, no guarantee', false),
];

export const contractTypesReady = (env: Env): Promise<boolean> => hasColumn(env, 'contract_types', 'code').catch(() => false);

/** Every type, hidden ones too (a contract may still have one), in the order staff set. */
export async function contractTypes(env: Env): Promise<ContractTypeRow[]> {
  if (!(await contractTypesReady(env))) return [...BUILT_IN_CONTRACT_TYPES];
  const rows = await all<{ code: string; label: string; package: string | null; revenue_model: RevenueModel; blurb: string | null; is_default_for_model: boolean; sort_order: number; is_active: boolean }>(env,
    'SELECT code, label, package, revenue_model, blurb, is_default_for_model, sort_order, is_active FROM contract_types ORDER BY sort_order, code');
  return rows.map(r => ({
    code: r.code, label: r.label, package: r.package, revenueModel: r.revenue_model, blurb: r.blurb,
    isDefaultForModel: r.is_default_for_model === true, sortOrder: Number(r.sort_order), isActive: r.is_active === true,
  }));
}

export interface ContractTypeFields { label?: string; package?: string | null; revenueModel?: RevenueModel; blurb?: string | null; sortOrder?: number; isActive?: boolean; isDefaultForModel?: boolean }

/** The fields of a POST or PATCH body that are present, checked; `fields` names each one that is not valid. */
export function parseTypeFields(b: Record<string, unknown>): { set: ContractTypeFields; fields: Record<string, string> } {
  const set: ContractTypeFields = {}, fields: Record<string, string> = {};
  if (b.label !== undefined) {
    const v = typeof b.label === 'string' ? b.label.trim() : '';
    if (!v || v.length > 80) fields.label = 'Enter a name of up to 80 characters.'; else set.label = v;
  }
  if (b.package !== undefined) {
    const v = b.package === null ? '' : typeof b.package === 'string' ? b.package.trim() : null;
    if (v === null || v.length > 30) fields.package = 'Enter up to 30 characters, or leave it empty.'; else set.package = v || null;
  }
  if (b.revenueModel !== undefined) {
    if (b.revenueModel === 'grr') fields.revenueModel = NO_GRR;
    else if (isRevenueModel(b.revenueModel)) set.revenueModel = b.revenueModel; else fields.revenueModel = 'Pick one income model.';
  }
  if (b.blurb !== undefined) {
    const v = b.blurb === null ? '' : typeof b.blurb === 'string' ? b.blurb.trim() : null;
    if (v === null || v.length > 200) fields.blurb = 'Enter up to 200 characters, or leave it empty.'; else set.blurb = v || null;
  }
  if (b.sortOrder !== undefined) {
    if (typeof b.sortOrder === 'number' && Number.isInteger(b.sortOrder) && b.sortOrder >= 0 && b.sortOrder <= 100000) set.sortOrder = b.sortOrder; else fields.sortOrder = 'Enter a whole number.';
  }
  for (const k of ['isActive', 'isDefaultForModel'] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] === 'boolean') set[k] = b[k]; else fields[k] = 'Yes or no.';
  }
  return { set, fields };
}
