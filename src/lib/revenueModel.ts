import type { StatusTone } from './status';
/** Revenue models and expense payers as the screens name them. The server's rules are in
 *  functions/_lib/revenueModel.ts and functions/_lib/ownerStatement.ts. */

export type RevenueModel = 'management' | 'management_guarantee' | 'management_yearly_guarantee' | 'grr' | 'master_lease' | 'long_term' | 'wh_long_term';

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
  { key: 'wh_long_term', label: 'Showroom / warehouse let', short: 'WH LT', blurb: 'A showroom or warehouse let long term to one tenant (e.g. Dream Crafter)',
    statement: 'The owner gets the tenant\'s rent less the operator share and owner-paid costs.' },
];
/** Let to one tenant: the owner gets the tenant's rent less the operator share (functions/_lib/revenueModel.ts). */
export const isTenancy = (m: string): boolean => m === 'long_term' || m === 'wh_long_term';
export const MODEL: Record<RevenueModel, typeof MODELS[number]> = Object.fromEntries(MODELS.map(m => [m.key, m])) as Record<RevenueModel, typeof MODELS[number]>;

/** The colour each model's label takes (StatusBadge tone). */
export const MODEL_TONE: Record<RevenueModel, StatusTone> = {
  management: 'accent',
  management_guarantee: 'info',
  management_yearly_guarantee: 'info',
  grr: 'success',
  master_lease: 'warning',
  long_term: 'neutral',
  wh_long_term: 'danger',
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

/** The staff's contract codes (sheet UNIT, 17 Oct 2026) and the model each is worked out by (functions/_lib/unitPurpose.ts).
 *  A rental unit takes PS, PS GRR, PS YGRR, LT, RTR or MANAGE (GRR only if it already has it); a showroom or warehouse
 *  takes a WH lease, a WH LT let or nothing. */
export type ContractCode = 'PS' | 'PS GRR' | 'PS YGRR' | 'LT' | 'RTR' | 'MANAGE' | 'WH' | 'WH LT' | 'GRR';
export const CODES: { code: ContractCode; pkg?: string; model: RevenueModel; label: string; blurb: string }[] = [
  { code: 'PS', pkg: '(Package A)', model: 'management', label: 'Airbnb profit sharing', blurb: 'We run it on the channels and split the profit' },
  { code: 'PS GRR', pkg: '(Package B)', model: 'management_guarantee', label: 'Profit sharing, monthly GRR', blurb: 'A split, with a minimum for the owner every month' },
  { code: 'LT', pkg: '(Package C)', model: 'long_term', label: 'Airbnb long term', blurb: 'Let to one tenant, not on the channels' },
  { code: 'PS YGRR', pkg: '(Package D)', model: 'management_yearly_guarantee', label: 'Profit sharing, yearly GRR', blurb: 'A split, with a minimum for the owner each contract year' },
  { code: 'RTR', pkg:'-', model: 'master_lease', label: 'Rent to rent', blurb: 'We rent the unit from the owner and run it' },
  { code: 'MANAGE', pkg:'-',model: 'management', label: 'Listing management', blurb: 'We manage the listing for a fee, no guarantee' },
  { code: 'WH', model: 'master_lease', label: 'Warehouse / showroom lease', blurb: 'Fixed monthly rent to the owner' },
  { code: 'WH LT', model: 'wh_long_term', label: 'Showroom / warehouse long-term', blurb: 'Let to one tenant (e.g. Dream Crafter); owner gets the rent less our share' },
  { code: 'GRR', model: 'grr', label: 'Guaranteed rent', blurb: 'Fixed rent to the owner each month (older contracts)' },
];
export const CODE: Record<ContractCode, typeof CODES[number]> = Object.fromEntries(CODES.map(c => [c.code, c])) as Record<ContractCode, typeof CODES[number]>;
export const codeName = (c: ContractCode): string => CODE[c]?.pkg ? `${c} ${CODE[c].pkg}` : c;
export const codeFromModel = (m: RevenueModel): ContractCode =>
  ({ management: 'PS', management_guarantee: 'PS GRR', management_yearly_guarantee: 'PS YGRR', grr: 'GRR', master_lease: 'RTR', long_term: 'LT', wh_long_term: 'WH LT' } as const)[m];

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
export const BED_SIZES: { value: string; label: string }[] = [
  { value: 'king', label: 'King' }, { value: 'queen', label: 'Queen' }, { value: 'super_single', label: 'Super single' }, { value: 'single', label: 'Single' }, { value: 'sofa_bed', label: 'Sofa bed' },
  { value: 'single_floor_mattress', label: 'Single floor mattress' }, { value: 'double_decker', label: 'Double decker' },
];
