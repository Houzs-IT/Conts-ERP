import type { StatusTone } from './status';
/** Revenue models and expense payers as the screens name them. The server's rules are in
 *  functions/_lib/revenueModel.ts and functions/_lib/ownerStatement.ts. */

export type RevenueModel = 'management' | 'management_guarantee' | 'management_yearly_guarantee' | 'grr' | 'master_lease' | 'long_term';

export const MODELS: { key: RevenueModel; label: string; short: string; blurb: string; statement: string }[] = [
  { key: 'management', label: 'Income split', short: 'Split', blurb: 'We manage the unit and split the profit',
    statement: 'Income less owner-paid costs, then split: owner %, operator %, agent %.' },
  { key: 'management_guarantee', label: 'Split + minimum', short: 'Split + min.', blurb: 'As above, owner gets at least a monthly minimum (Package D)',
    statement: 'The owner gets the higher of their share and the minimum; the company tops up the difference.' },
  { key: 'management_yearly_guarantee', label: 'Split + yearly minimum', short: 'Split + yr min.', blurb: 'As a split, owner gets at least a set amount each contract year',
    statement: 'A plain split every month. On the last statement of each contract year the shares for the year are added up; the company tops up any shortfall against the yearly guarantee.' },
  { key: 'grr', label: 'Guaranteed rent', short: 'GRR', blurb: 'Fixed rent to the owner each month',
    statement: 'The owner gets the fixed rent. Income and costs are the company\'s.' },
  { key: 'master_lease', label: 'Master lease', short: 'Lease', blurb: 'We rent the unit from the owner',
    statement: 'No owner statement. The rent is a company cost; the unit\'s profit or loss is the company\'s.' },
  { key: 'long_term', label: 'Long-term let', short: 'Long-term', blurb: 'Let to one tenant, not on channels',
    statement: 'The owner gets the tenant\'s rent less owner-paid costs. No operator share.' },
];
/** Let to one tenant: the owner gets the tenant's rent less the operator share (functions/_lib/revenueModel.ts). */
export const isTenancy = (m: string): boolean => m === 'long_term';
export const MODEL: Record<RevenueModel, typeof MODELS[number]> = Object.fromEntries(MODELS.map(m => [m.key, m])) as Record<RevenueModel, typeof MODELS[number]>;

/** The colour each model's label takes (StatusBadge tone). */
export const MODEL_TONE: Record<RevenueModel, StatusTone> = {
  management: 'accent',
  management_guarantee: 'info',
  management_yearly_guarantee: 'info',
  grr: 'success',
  master_lease: 'warning',
  long_term: 'neutral',
};

/** Who pays an expense (expenses.charge_to). Only the owner's reach the statement. */
export const PAYERS: { value: string; label: string; help: string }[] = [
  { value: 'owner', label: 'Owner (via statement)', help: 'Deducted on the owner statement.' },
  { value: 'the_conts', label: 'The Conts', help: 'The Conts pays. Shows in The Conts\' share of the unit only.' },
  { value: 'tenant', label: 'Tenant', help: 'The tenant pays. Not on the owner statement.' },
  { value: 'guest_deposit', label: 'Guest', help: 'Charged to the guest (deposit). Not on the owner statement.' },
];
export const PAYER_LABEL: Record<string, string> = { owner: 'Owner', the_conts: 'The Conts', tenant: 'Tenant', guest_deposit: 'Guest deposit', warranty: 'Warranty' };

/** The categories an expense is entered under, in the owner's words. Value = expenses.category. */
export const ENTRY_CATEGORIES: { value: string; label: string }[] = [
  { value: 'electricity', label: 'Electricity' }, { value: 'water', label: 'Water' }, { value: 'internet', label: 'Internet' },
  { value: 'sewerage', label: 'Indah Water' }, { value: 'cleaning', label: 'Cleaning' }, { value: 'maintenance', label: 'Maintenance' },
  { value: 'other', label: 'Misc' },
];
export const CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(ENTRY_CATEGORIES.map(c => [c.value, c.label])),
  housekeeping: 'Cleaning', utilities: 'Utilities', consumables: 'Consumables', furniture: 'Furniture', management_fee: 'Operator share', channel_fee: 'Service fee',
};

/** The staff's contract type code (PS, PS GRR, ...). Staff keep the list on Unit settings (GET /api/contract-types);
 *  an unknown or hidden code is shown as it is. */
export type ContractCode = string;
export interface ContractType {
  code: ContractCode; label: string; package: string | null; revenueModel: RevenueModel; blurb: string | null;
  isDefaultForModel: boolean; sortOrder: number; isActive: boolean;
  /** How many contracts use it (the list endpoint only). */
  contracts?: number;
}
const builtIn = (n: number, code: string, label: string, pkg: string | null, revenueModel: RevenueModel, blurb: string, isDefaultForModel = true): ContractType =>
  ({ code, label, package: pkg, revenueModel, blurb, isDefaultForModel, sortOrder: n * 10, isActive: true });
/** The types before migration 0206 (functions/_lib/contractTypes.ts), shown until the list arrives. */
export const BUILT_IN_CONTRACT_TYPES: readonly ContractType[] = [
  builtIn(1, 'PS', 'Airbnb profit sharing', 'Package A', 'management', 'We run it on the channels and split the profit'),
  builtIn(2, 'PS GRR', 'Profit sharing with monthly GRR', 'Package B', 'management_guarantee', 'A split, with a minimum for the owner every month'),
  builtIn(3, 'LT', 'Airbnb long term', 'Package C', 'long_term', 'Let to one tenant, not on the channels'),
  builtIn(4, 'PS YGRR', 'Profit sharing with yearly GRR', 'Package D', 'management_yearly_guarantee', 'A split, with a minimum for the owner each contract year'),
  builtIn(5, 'RTR', 'Rent to rent', null, 'master_lease', 'We rent the unit from the owner and run it'),
  builtIn(6, 'MANAGE', 'Listing management', null, 'management', 'We manage the listing for a fee, no guarantee', false),
];
export const typeOf = (types: readonly ContractType[], code: string | null | undefined): ContractType | undefined => types.find(t => t.code === code);
/** "PS (Package A)"; just the code for a type with no package or one that is not on the list. */
export const codeName = (types: readonly ContractType[], code: ContractCode): string => {
  const pkg = typeOf(types, code)?.package;
  return pkg ? `${code} (${pkg})` : code;
};
/** "Package B" for PS GRR, null for the types that have none (RTR, MANAGE, GRR, or no contract). */
export const packageOf = (types: readonly ContractType[], code: ContractCode | null | undefined): string | null => typeOf(types, code)?.package ?? null;
/** The type's label; the code itself when the type is not on the list. */
export const codeLabel = (types: readonly ContractType[], code: ContractCode): string => typeOf(types, code)?.label ?? code;
/** The type a contract with no saved type is read as: its model's default. */
export const codeFromModel = (types: readonly ContractType[], m: RevenueModel): ContractCode =>
  (types.find(t => t.revenueModel === m && t.isDefaultForModel) ?? types.find(t => t.revenueModel === m))?.code ?? '';
/** Filter and picker options for every type, hidden ones too (a contract may still have one): "PS (Package A) · Airbnb profit sharing". */
export const typeOptions = (types: readonly ContractType[]): { value: string; label: string }[] =>
  types.map(t => ({ value: t.code, label: `${codeName(types, t.code)} · ${t.label}` }));
/** The types a unit may take: the active ones, and its own even when hidden. */
export const offeredTypes = (types: readonly ContractType[], current?: ContractCode | null): ContractType[] => types.filter(t => t.isActive || t.code === current);

export type UnitPurpose = 'rental' | 'showroom' | 'warehouse';
export const PURPOSES: { value: UnitPurpose; label: string; help: string }[] = [
  { value: 'rental', label: 'Rental', help: 'Short stays sold on Airbnb, Booking.com and the other channels.' },
  { value: 'showroom', label: 'Showroom', help: 'A Dream Crafter or Inhouse Reno display unit. Never on the channels.' },
  { value: 'warehouse', label: 'Warehouse', help: 'A renovation warehouse. Never on the channels.' },
];
export const PURPOSE_LABEL: Record<UnitPurpose, string> = { rental: 'Rental', showroom: 'Showroom', warehouse: 'Warehouse' };
export const USED_BY: { value: string; label: string }[] = [
  { value: 'the_conts', label: 'The Conts' }, { value: 'dream_crafter', label: 'Dream Crafter' }, { value: 'inhouse_reno', label: 'Inhouse Reno' },
];
/** The bed sizes before migration 0210. Since then staff keep the list on Unit settings (GET /api/unit-bed-sizes). */
export const BED_SIZES: { value: string; label: string }[] = [
  { value: 'king', label: 'King' }, { value: 'queen', label: 'Queen' }, { value: 'super_single', label: 'Super single' }, { value: 'single', label: 'Single' }, { value: 'sofa_bed', label: 'Sofa bed' },
  { value: 'single_floor_mattress', label: 'Single floor mattress' }, { value: 'double_decker', label: 'Double decker' },
];
