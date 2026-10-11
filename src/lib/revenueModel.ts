import type { StatusTone } from './status';
/** Revenue models and expense payers as the screens name them. The server's rules are in
 *  functions/_lib/revenueModel.ts and functions/_lib/ownerStatement.ts. */

export type RevenueModel = 'management' | 'management_guarantee' | 'grr' | 'master_lease' | 'long_term';

export const MODELS: { key: RevenueModel; label: string; short: string; blurb: string; statement: string }[] = [
  { key: 'management', label: 'Management share', short: 'Share', blurb: 'We manage the unit and split the profit',
    statement: 'Income less owner-paid costs, then split: owner %, management %, agent %.' },
  { key: 'management_guarantee', label: 'Share + minimum', short: 'Share + min.', blurb: 'As above, owner gets at least a monthly minimum (Package D)',
    statement: 'The owner gets the higher of their share and the minimum; the company tops up the difference.' },
  { key: 'grr', label: 'Guaranteed rent', short: 'GRR', blurb: 'Fixed rent to the owner each month',
    statement: 'The owner gets the fixed rent. Income and costs are the company\'s.' },
  { key: 'master_lease', label: 'Master lease', short: 'Lease', blurb: 'We rent the unit from the owner',
    statement: 'No owner statement. The rent is a company cost; the unit\'s profit or loss is the company\'s.' },
  { key: 'long_term', label: 'Long-term let', short: 'Long-term', blurb: 'Let to one tenant, not on channels',
    statement: 'The owner gets the tenant\'s rent less the management fee and owner-paid costs.' },
];
export const MODEL: Record<RevenueModel, typeof MODELS[number]> = Object.fromEntries(MODELS.map(m => [m.key, m])) as Record<RevenueModel, typeof MODELS[number]>;

/** The colour each model's label takes (StatusBadge tone). */
export const MODEL_TONE: Record<RevenueModel, StatusTone> = {
  management: 'accent',
  management_guarantee: 'info',
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
  housekeeping: 'Cleaning', utilities: 'Utilities', consumables: 'Consumables', furniture: 'Furniture', management_fee: 'Management fee', channel_fee: 'Channel fee',
};
