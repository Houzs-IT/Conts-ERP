import type { ReactElement, ReactNode } from 'react';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, PercentInput, DateField } from '../../components/inputs';
import { StatusBadge } from '../../components/StatusBadge';
import { rm, todayMyt } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { MODEL, MODEL_TONE, typeOf, codeName, codeFromModel, isTenancy, offeredTypes, type ContractType, type RevenueModel, type ContractCode } from '../../lib/revenueModel';

/** The contract terms form, shared by the Contract tab and the Add unit page: the draft, what it sends, what it checks
 *  before asking the server, and the boxes for the chosen package. */

/** The rent-to-rent grid beyond the rent and deposit (0161): what else we pay the owner, and what we rent it out for. */
export const RENT_TO_RENT_KEYS = ['depositUtilities', 'depositCard', 'rentOutAmount', 'rentOutDeposit', 'rentOutDepositUtilities', 'rentOutDepositCard'] as const;
export type RentToRentKey = typeof RENT_TO_RENT_KEYS[number];

export interface ContractView {
  id: string | null; revenueModel: RevenueModel; termsLabel: string;
  ownerPct: number | null; managementPct: number | null; agentPct: number | null; agentName: string | null;
  minimumGuarantee: number; guaranteeStartsOn: string | null; guaranteeEndsOn: string | null;
  /** PS YGRR: the guarantee for each contract year, sen. */
  yearlyGuarantee?: number; contractCode?: ContractCode; agreementDocumentId?: string | null;
  /** False while the code is only read from the terms; the tab then asks for the type before saving. */
  typeStored?: boolean;
  monthlyRent: number; deposit: number | null; tenantName: string | null;
  startsOn: string | null; endsOn: string | null; renewsOn: string | null; miscCharges: boolean; sharedWith: number; createdAt: string | null;
  /** MANAGE: the owner's amount a month, sen. */
  ownerAmount?: number | null;
  /** Rent to rent (0161), recorded only. Sen or null. */
  rentToRent?: Partial<Record<RentToRentKey, number | null>>;
}

export interface Draft {
  revenueModel: RevenueModel; contractCode: ContractCode; yearlyGuarantee: number | null; ownerPct: number | null; managementPct: number | null; agentPct: number | null; agentName: string;
  minimumGuarantee: number | null; guaranteeStartsOn: string; guaranteeEndsOn: string;
  monthlyRent: number | null; deposit: number | null; tenantName: string;
  startsOn: string; endsOn: string; renewsOn: string; miscCharges: boolean;
  ownerAmount: number | null;
  depositUtilities: number | null; depositCard: number | null;
  rentOutAmount: number | null; rentOutDeposit: number | null; rentOutDepositUtilities: number | null; rentOutDepositCard: number | null;
}
const senOrEmpty = (sen: number | null | undefined): number | null => (sen ? sen : null);
const pctOf = (n: number | null | undefined): number | null => (n == null ? null : Number(n.toFixed(2)));
export const pctText = (n: number | null | undefined): string => (n == null ? '' : String(Number(n.toFixed(2))));

export function draftOf(c: ContractView, types: readonly ContractType[]): Draft {
  return {
    revenueModel: c.revenueModel, contractCode: c.contractCode ?? codeFromModel(types, c.revenueModel), yearlyGuarantee: senOrEmpty(c.yearlyGuarantee),
    ownerPct: pctOf(c.ownerPct ?? 75), managementPct: pctOf(c.managementPct != null && !isTenancy(c.revenueModel) ? c.managementPct : c.ownerPct != null ? 100 - c.ownerPct - (c.agentPct ?? 0) : 25),
    agentPct: pctOf(c.agentPct ?? 0), agentName: c.agentName ?? '',
    minimumGuarantee: senOrEmpty(c.minimumGuarantee), guaranteeStartsOn: c.guaranteeStartsOn ?? '', guaranteeEndsOn: c.guaranteeEndsOn ?? '',
    monthlyRent: senOrEmpty(c.monthlyRent), deposit: senOrEmpty(c.deposit), tenantName: c.tenantName ?? '',
    startsOn: c.startsOn?.slice(0, 10) ?? '', endsOn: c.endsOn?.slice(0, 10) ?? '', renewsOn: c.renewsOn?.slice(0, 10) ?? '', miscCharges: c.miscCharges,
    ownerAmount: senOrEmpty(c.ownerAmount),
    depositUtilities: c.rentToRent?.depositUtilities ?? null, depositCard: c.rentToRent?.depositCard ?? null,
    rentOutAmount: c.rentToRent?.rentOutAmount ?? null, rentOutDeposit: c.rentToRent?.rentOutDeposit ?? null,
    rentOutDepositUtilities: c.rentToRent?.rentOutDepositUtilities ?? null, rentOutDepositCard: c.rentToRent?.rentOutDepositCard ?? null,
  };
}
/** An empty draft for a unit with no contract yet. With no type the code is '' (nothing picked) and the form shows only the package select. */
export function blankDraft(type?: ContractType): Draft {
  return {
    revenueModel: type?.revenueModel ?? 'management', contractCode: type?.code ?? '', yearlyGuarantee: null, ownerPct: 75, managementPct: 25, agentPct: 0, agentName: '',
    minimumGuarantee: null, guaranteeStartsOn: '', guaranteeEndsOn: '', monthlyRent: null, deposit: null, tenantName: '',
    startsOn: '', endsOn: '', renewsOn: '', miscCharges: false, ownerAmount: null,
    depositUtilities: null, depositCard: null, rentOutAmount: null, rentOutDeposit: null, rentOutDepositUtilities: null, rentOutDepositCard: null,
  };
}
export function bodyOf(d: Draft) {
  const m = d.revenueModel, share = isShare(m);
  return {
    revenueModel: m, contractCode: d.contractCode,
    ...(m === 'management_yearly_guarantee' ? { yearlyGuarantee: d.yearlyGuarantee ?? 0 } : {}),
    ...(share ? { ownerPct: d.contractCode === 'MANAGE' ? manageOwnerPct(d) : d.ownerPct ?? 0, managementPct: d.managementPct ?? 0, agentPct: d.agentPct ?? 0, agentName: d.agentName || null, miscCharges: d.miscCharges } : {}),
    ...(m === 'management_guarantee' ? { minimumGuarantee: d.minimumGuarantee ?? 0, guaranteeStartsOn: d.guaranteeStartsOn || null, guaranteeEndsOn: d.guaranteeEndsOn || null } : {}),
    ...(!share ? { monthlyRent: d.monthlyRent ?? 0 } : {}),
    ...(d.contractCode === 'MANAGE' ? { ownerAmount: d.ownerAmount ?? 0 } : {}),
    ...(m === 'master_lease' ? { deposit: d.deposit ?? null } : {}),
    ...(d.contractCode === 'RTR' ? Object.fromEntries(RENT_TO_RENT_KEYS.map(k => [k, d[k]])) : {}),
    // LT (Package C) has no operator share (staff sheet UNIT, 26 Oct 2026).
    ...(isTenancy(m) ? { tenantName: d.tenantName, managementPct: 0 } : {}),
    startsOn: d.startsOn, endsOn: d.endsOn || null, renewsOn: d.renewsOn || null,
  };
}
/** Problems the form can see before asking the server (the server checks the same and more). */
export function problems(d: Draft): Record<string, string> {
  const f: Record<string, string> = {}, m = d.revenueModel;
  if (isShare(m)) {
    const sum = (d.contractCode === 'MANAGE' ? manageOwnerPct(d) : d.ownerPct ?? 0) + (d.managementPct ?? 0) + (d.agentPct ?? 0);
    if (d.contractCode === 'MANAGE' && manageOwnerPct(d) < 0) f.managementPct = 'Management and agent add up to more than 100%.';
    else if (Math.abs(sum - 100) > 0.001) f.ownerPct = `Owner, management and agent add up to ${Number(sum.toFixed(2))}%, not 100%.`;
    if (m === 'management_guarantee' && !((d.minimumGuarantee ?? 0) > 0)) f.minimumGuarantee = 'Enter the monthly minimum.';
    if (m === 'management_yearly_guarantee' && !((d.yearlyGuarantee ?? 0) > 0)) f.yearlyGuarantee = 'Enter the guarantee for each contract year.';
    if (d.contractCode === 'MANAGE' && !((d.ownerAmount ?? 0) > 0)) f.ownerAmount = "Enter the owner's amount.";
  } else if (!((d.monthlyRent ?? 0) > 0)) f.monthlyRent = 'Enter the monthly rent.';
  if (isTenancy(m) && !d.tenantName.trim()) f.tenantName = 'Enter the tenant.';
  if (d.endsOn && d.startsOn && d.endsOn < d.startsOn) f.endsOn = 'The end date is before the start date.';
  if (m === 'management_guarantee' && d.guaranteeEndsOn && d.guaranteeStartsOn && d.guaranteeEndsOn < d.guaranteeStartsOn) f.guaranteeEndsOn = 'The guarantee ends before it starts.';
  return f;
}

/** MANAGE has no Owner % box: the owner's share of the split is what management and agent leave. */
export const manageOwnerPct = (d: Draft): number => Number((100 - (d.managementPct ?? 0) - (d.agentPct ?? 0)).toFixed(2));
export const isShare = (m: RevenueModel): boolean => m === 'management' || m === 'management_guarantee' || m === 'management_yearly_guarantee';

export function ModelChip({ model, label }: { model: RevenueModel; label?: string }): ReactElement {
  return <StatusBadge tone={MODEL_TONE[model]} label={label ?? MODEL[model].label} />;
}

export interface ContractFieldsProps {
  d: Draft; set: (p: Partial<Draft>) => void;
  /** Problems by field name, from the form's own checks and the server's answer. */
  errors: Record<string, string>;
  types: readonly ContractType[];
  /** The types the select offers. Default: the active ones and the draft's own. */
  offered?: readonly ContractType[];
  /** The label above the select. */
  label?: string;
  /** The narrow Scheduled changes panel: two columns, and a start date after today. */
  narrow?: boolean;
  /** Shown between the select and the model card (the Contract tab's "type not set" notice). */
  afterSelect?: ReactNode;
  /** Called when a type is picked in the select. */
  onPickType?: () => void;
}

/** The package select, the chosen model's card and only that model's boxes. Renders as direct children of its parent, which
 *  lays them out in a column. With no type picked yet (code '') only the select shows. */
export function ContractFields({ d, set, errors, types, offered, label = 'Income model', narrow, afterSelect, onPickType }: ContractFieldsProps): ReactElement {
  const m = d.revenueModel;
  const share = isShare(m);
  const choices = offered ?? offeredTypes(types, d.contractCode);
  const pct = (k: 'ownerPct' | 'managementPct' | 'agentPct', text: string) => (
    <PercentInput label={text} value={d[k]} onChange={v => set({ [k]: v })} error={errors[k]} />
  );
  const money = (k: 'minimumGuarantee' | 'yearlyGuarantee' | 'monthlyRent' | 'deposit' | 'ownerAmount' | RentToRentKey, text: string, help?: string) => (
    <MoneyInput label={text} placeholder="e.g. 3,000.00" valueSen={d[k]} onChangeSen={v => set({ [k]: v })} error={errors[k]} help={help} />
  );
  const day = (k: 'startsOn' | 'endsOn' | 'renewsOn' | 'guaranteeStartsOn' | 'guaranteeEndsOn', text: string) => (
    <DateField label={text} value={d[k]} onChange={v => set({ [k]: v })} error={errors[k]}
      min={k === 'endsOn' || k === 'renewsOn' ? d.startsOn || undefined : k === 'guaranteeEndsOn' ? d.guaranteeStartsOn || undefined : k === 'startsOn' && narrow ? todayMyt(1) : undefined} />
  );
  const formGrid = narrow ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4';
  const o = typeOf(types, d.contractCode);

  return (
    <>
      <Select label={label} showLabel size="md" className="max-w-[560px]" value={d.contractCode}
        options={[...(o ? [] : [{ value: d.contractCode, label: d.contractCode || 'Pick a package' }]), ...choices.map(t => ({ value: t.code, label: `${codeName(types, t.code)} - ${t.label}` }))]}
        onChange={v => { const picked = typeOf(types, v); if (picked) { set({ contractCode: picked.code, revenueModel: picked.revenueModel }); onPickType?.(); } }} />
      {afterSelect}
      {d.contractCode && (
        <div aria-live="polite" className="flex flex-col gap-2 rounded-card [border:1px_solid_var(--color-line)] bg-page p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">Selected model</span>
            <ModelChip model={m} label={d.contractCode} />
          </div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-copy">
            <dt className="text-muted-ink">Type</dt><dd className="m-0 font-medium text-ink">{o?.label ?? d.contractCode}{o?.package ? ` (${o.package})` : ''}</dd>
            <dt className="text-muted-ink">Terms</dt><dd className="m-0 text-ink [text-wrap:pretty]">{o?.blurb}</dd>
            <dt className="text-muted-ink">Statement</dt><dd className="m-0 text-ink [text-wrap:pretty]">{MODEL[m].statement}</dd>
          </dl>
        </div>
      )}

      {d.contractCode && <>
        <div className={formGrid}>
          {share && <>
            {/* MANAGE: the owner's amount in RM instead of a %; the owner % still makes the split up to 100 until
                the MANAGE payout is decided (PLAN-units-form.md Q6b). */}
            {d.contractCode === 'MANAGE' ? money('ownerAmount', 'Owner (RM)') : pct('ownerPct', 'Owner %')}
            {pct('managementPct', 'Management %')}
            {pct('agentPct', 'Agent %')}
            <Field label="Agent" placeholder="Who brought the unit in" value={d.agentName} onChange={e => set({ agentName: e.target.value })} />
          </>}
          {m === 'management_guarantee' && <>
            {money('minimumGuarantee', 'Monthly minimum (RM)', 'The owner gets at least this a month.')}
            {day('guaranteeStartsOn', 'Minimum applies from')}
            {day('guaranteeEndsOn', 'Minimum applies until')}
          </>}
          {m === 'management_yearly_guarantee' && money('yearlyGuarantee', 'Guarantee per contract year (RM)',
            `${(d.yearlyGuarantee ?? 0) > 0 ? `${rm(d.yearlyGuarantee ?? 0)} a year / 12 months = ${rm(Math.round((d.yearlyGuarantee ?? 0) / 12))} per month. ` : ''}Checked once a year: on the last statement of each contract year the company tops up any shortfall.`)}
          {m === 'grr' && money('monthlyRent', 'Monthly rent to owner (RM)', 'Paid whatever the unit earns.')}
          {m === 'master_lease' && d.contractCode !== 'RTR' && <>
            {money('monthlyRent', 'Monthly rent to the owner (RM)', 'Recorded as a company cost; no owner statement.')}
            {money('deposit', 'Deposit (RM)')}
          </>}
          {isTenancy(m) && <>
            <Field label="Tenant" placeholder="Tenant's name" value={d.tenantName} onChange={e => set({ tenantName: e.target.value })} error={errors.tenantName} />
            {money('monthlyRent', 'Monthly rent from tenant (RM)')}
          </>}
        </div>
        {d.contractCode === 'MANAGE' && (
          <p className="m-0 -mt-2 text-meta text-muted-ink">
            Operator share = {rm(d.ownerAmount ?? 0)} x {pctText(d.managementPct ?? 0)}% = <span className="font-semibold text-ink">{rm(Math.round(((d.ownerAmount ?? 0) * (d.managementPct ?? 0)) / 100))}</span>
          </p>
        )}
        {d.contractCode === 'RTR' && (() => {
          // One row per thing, one column per side: the row name is printed once, so the two sides read across.
          const rows = [
            ['Monthly rent', 'monthlyRent', 'rentOutAmount'],
            ['Deposit rental', 'deposit', 'rentOutDeposit'],
            ['Deposit utilities', 'depositUtilities', 'rentOutDepositUtilities'],
            ['Deposit card', 'depositCard', 'rentOutDepositCard'],
          ] as const;
          const gridCols = cx('grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 px-4', !narrow && 'sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)]');
          const gap = (d.rentOutAmount ?? 0) - (d.monthlyRent ?? 0);
          return (
            <div role="group" aria-label="Rent to rent terms" className="rounded-card [border:1px_solid_var(--color-line)] bg-page overflow-hidden max-w-[760px]">
              <div className={cx(gridCols, 'py-2.5 bg-muted text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink')}>
                <span aria-hidden />
                <span className="text-right">Costing Rental Amount</span>
                <span className="text-right">Rental Out Amount</span>
              </div>
              {rows.map(([text, pay, rentOut]) => (
                <div key={pay} className={cx(gridCols, 'items-start py-2.5 [border-top:1px_solid_var(--color-line-soft)]')}>
                  <span className="min-h-10 flex items-center text-copy text-muted-ink">{text}</span>
                  <MoneyInput prefix aria-label={`${text}, Costing Rental Amount`} placeholder="0.00" valueSen={d[pay]} onChangeSen={v => set({ [pay]: v })} error={errors[pay]} />
                  <MoneyInput prefix aria-label={`${text}, Rental Out Amount`} placeholder="0.00" valueSen={d[rentOut]} onChangeSen={v => set({ [rentOut]: v })} error={errors[rentOut]} />
                </div>
              ))}
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-2.5 [border-top:1px_solid_var(--color-line-soft)] text-meta text-muted-ink">
                <span>Recorded only. The unit's result still comes from its reservations.</span>
                {(d.monthlyRent ?? 0) > 0 && (d.rentOutAmount ?? 0) > 0 && (
                  <span className="text-ink tabular-nums">Rent out is <span className="font-semibold">{rm(Math.abs(gap))}</span> {gap >= 0 ? 'above' : 'below'} the rent we pay</span>
                )}
              </div>
            </div>
          );
        })()}
        <div className={formGrid}>
          {day('startsOn', m === 'master_lease' ? 'Lease starts' : isTenancy(m) ? 'Tenancy starts' : 'Contract starts')}
          {day('endsOn', m === 'master_lease' ? 'Lease ends' : isTenancy(m) ? 'Tenancy ends' : 'Contract ends')}
          {day('renewsOn', 'Renews on')}
          {share && (
            <label className="flex items-start gap-2 pt-[26px] text-copy cursor-pointer">
              <input type="checkbox" checked={d.miscCharges} onChange={e => set({ miscCharges: e.target.checked })} className="mt-[3px] accent-[var(--color-gold-ink)]" />
              <span>Deduct miscellaneous charges <span className="block text-meta text-muted-ink">RM 100 x the occupancy rate, never more than RM 100 (e.g. 80% occupied = RM 80)</span></span>
            </label>
          )}
        </div>
        {m === 'long_term' && <p className="m-0 text-meta text-muted-ink">A long-term let is not sold on the channels; take it off the channels on the Overview tab.</p>}
      </>}
    </>
  );
}
