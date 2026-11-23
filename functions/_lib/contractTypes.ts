import { type Env, all } from './db';
import { hasColumn } from './auth';
import { isRevenueModel, isShare, isTenancy, MODEL_LABEL, type RevenueModel } from './revenueModel';

export const CONTRACT_TYPE_OPTION_KEYS = ['hasFixedOwnerAmount', 'hasAgentShare', 'hasNoOperatorShare', 'hasRentOutGrid'] as const;
export type ContractTypeOptionKey = typeof CONTRACT_TYPE_OPTION_KEYS[number];
export type ContractTypeOptions = Record<ContractTypeOptionKey, boolean>;

export const OPTION_FITS: Record<ContractTypeOptionKey, (model: RevenueModel) => boolean> = {
  hasFixedOwnerAmount: isShare,
  hasAgentShare: isShare,
  hasNoOperatorShare: isTenancy,
  hasRentOutGrid: model => model === 'master_lease',
};

export const legacyOptions = (code: string, model: RevenueModel): ContractTypeOptions => ({
  hasFixedOwnerAmount: code === 'MANAGE' && isShare(model),
  hasAgentShare: isShare(model),
  hasNoOperatorShare: isTenancy(model),
  hasRentOutGrid: code === 'RTR' && model === 'master_lease',
});

export function misfitOptions(model: RevenueModel, options: ContractTypeOptions): Record<string, string> {
  return Object.fromEntries(CONTRACT_TYPE_OPTION_KEYS
    .filter(key => options[key] && !OPTION_FITS[key](model))
    .map(key => [key, `This does not fit ${MODEL_LABEL[model]}.`]));
}

/** The contract types (PS, PS GRR, RTR, ...) kept by staff on Units > Unit settings (owner, 4 Nov 2026; migration 0206).
 *  A type is a code, a label and package, and the revenue model the owner statement works it out by. Before 0206 it is the
 *  fixed list below, the one owner_contracts.contract_code was checked against. */
export interface ContractTypeRow extends ContractTypeOptions {
  code: string; label: string; package: string | null; revenueModel: RevenueModel; blurb: string | null;
  isDefaultForModel: boolean; sortOrder: number; isActive: boolean;
}

export const CONTRACT_CODE_PATTERN = /^[A-Z0-9 ]{1,20}$/;

/** Guaranteed rent (GRR) was removed (owner, 4 Nov 2026: "there is only 6 now, don't let GRR go in"). Every way in refuses it
 *  with this; the grr model stays in code only for units with no contract whose old split still reads GRR. */
export const NO_GRR = 'Guaranteed rent (GRR) is no longer a contract type. Pick one of the six.';

const builtIn = (n: number, code: string, label: string, pkg: string | null, revenueModel: RevenueModel, blurb: string, isDefaultForModel = true): ContractTypeRow =>
  ({ code, label, package: pkg, revenueModel, blurb, isDefaultForModel, sortOrder: n * 10, isActive: true, ...legacyOptions(code, revenueModel) });

export const BUILT_IN_CONTRACT_TYPES: readonly ContractTypeRow[] = [
  builtIn(1, 'PS', 'Airbnb profit sharing', 'Package A', 'management', 'We run it on the channels and split the profit'),
  builtIn(2, 'PS GRR', 'Profit sharing with monthly GRR', 'Package B', 'management_guarantee', 'A split, with a minimum for the owner every month'),
  builtIn(3, 'LT', 'Airbnb long term', 'Package C', 'long_term', 'Let to one tenant, not on the channels'),
  builtIn(4, 'PS YGRR', 'Profit sharing with yearly GRR', 'Package D', 'management_yearly_guarantee', 'A split, with a minimum for the owner each contract year'),
  builtIn(5, 'RTR', 'Rent to rent', null, 'master_lease', 'We rent the unit from the owner and run it'),
  builtIn(6, 'MANAGE', 'Listing management', null, 'management', 'We manage the listing for a fee, no guarantee', false),
];

export const contractTypesReady = (env: Env): Promise<boolean> => hasColumn(env, 'contract_types', 'code');

export const contractTypeOptionsReady = (env: Env): Promise<boolean> => hasColumn(env, 'contract_types', 'has_agent_share');

export const OPTION_COLUMNS = 'has_fixed_owner_amount, has_agent_share, has_no_operator_share, has_rent_out_grid';
export const optionValues = (options: ContractTypeOptions): boolean[] =>
  [options.hasFixedOwnerAmount, options.hasAgentShare, options.hasNoOperatorShare, options.hasRentOutGrid];

export interface StoredOptionColumns {
  code: string; revenue_model: RevenueModel;
  has_fixed_owner_amount?: boolean; has_agent_share?: boolean; has_no_operator_share?: boolean; has_rent_out_grid?: boolean;
}
export const storedOptions = (row: StoredOptionColumns, hasOptionColumns: boolean): ContractTypeOptions => (hasOptionColumns ? {
  hasFixedOwnerAmount: row.has_fixed_owner_amount === true,
  hasAgentShare: row.has_agent_share === true,
  hasNoOperatorShare: row.has_no_operator_share === true,
  hasRentOutGrid: row.has_rent_out_grid === true,
} : legacyOptions(row.code, row.revenue_model));

export const mergeOptions = (base: ContractTypeOptions, changes: Partial<ContractTypeOptions>): ContractTypeOptions => ({
  hasFixedOwnerAmount: changes.hasFixedOwnerAmount ?? base.hasFixedOwnerAmount,
  hasAgentShare: changes.hasAgentShare ?? base.hasAgentShare,
  hasNoOperatorShare: changes.hasNoOperatorShare ?? base.hasNoOperatorShare,
  hasRentOutGrid: changes.hasRentOutGrid ?? base.hasRentOutGrid,
});
export const changedOptionKeys = (before: ContractTypeOptions, after: ContractTypeOptions): ContractTypeOptionKey[] =>
  CONTRACT_TYPE_OPTION_KEYS.filter(key => before[key] !== after[key]);
export const OPTIONS_NOT_READY = 'The contract type options cannot be changed on this database yet.';

export const optionsOfType =(types: readonly ContractTypeRow[], code: string, model: RevenueModel): ContractTypeOptions =>
  types.find(type => type.code === code) ?? legacyOptions(code, model);

/** Every type, hidden ones too (a contract may still have one), in the order staff set. */
export async function contractTypes(env: Env): Promise<ContractTypeRow[]> {
  if (!(await contractTypesReady(env))) return [...BUILT_IN_CONTRACT_TYPES];
  const hasOptionColumns = await contractTypeOptionsReady(env);
  const rows = await all<StoredOptionColumns & { label: string; package: string | null; blurb: string | null; is_default_for_model: boolean; sort_order: number; is_active: boolean }>(env,
    `SELECT code, label, package, revenue_model, blurb, is_default_for_model, sort_order, is_active${hasOptionColumns ? `, ${OPTION_COLUMNS}` : ''} FROM contract_types ORDER BY sort_order, code`);
  return rows.map(r => ({
    code: r.code, label: r.label, package: r.package, revenueModel: r.revenue_model, blurb: r.blurb,
    isDefaultForModel: r.is_default_for_model === true, sortOrder: Number(r.sort_order), isActive: r.is_active === true,
    ...storedOptions(r, hasOptionColumns),
  }));
}

export interface ContractTypeFields extends Partial<ContractTypeOptions> { label?: string; package?: string | null; revenueModel?: RevenueModel; blurb?: string | null; sortOrder?: number; isActive?: boolean; isDefaultForModel?: boolean }

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
  for (const k of ['isActive', 'isDefaultForModel', ...CONTRACT_TYPE_OPTION_KEYS] as const) {
    if (b[k] === undefined) continue;
    if (typeof b[k] === 'boolean') set[k] = b[k]; else fields[k] = 'Yes or no.';
  }
  return { set, fields };
}
