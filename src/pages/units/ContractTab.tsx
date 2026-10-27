import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Icon from '../../components/Icon';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, PercentInput, DateField } from '../../components/inputs';
import { MoneyText } from '../../components/MoneyText';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { date, monthLabel, rm } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { MODEL, MODEL_TONE, CODES, CODE, codeName, codeFromModel, isTenancy, PURPOSE_LABEL, type RevenueModel, type ContractCode, type UnitPurpose } from '../../lib/revenueModel';
import { ExtendContractModal, GenerateAgreement } from './ContractExtras';
import { CodeBadge } from './UnitExtras';
import { DataTable, type Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

/** The Contract tab: pick ONE revenue model, then fill only that model's fields. Below, last month's statement for
 *  this unit worked out on the terms as they stand in the form (the statement engine, on the server), and the
 *  unit's earlier contracts. */

interface ContractView {
  id: string | null; revenueModel: RevenueModel; termsLabel: string;
  ownerPct: number | null; managementPct: number | null; agentPct: number | null; agentName: string | null;
  minimumGuarantee: number; guaranteeStartsOn: string | null; guaranteeEndsOn: string | null;
  /** PS YGRR: the guarantee for each contract year, sen. */
  yearlyGuarantee?: number; contractCode?: ContractCode; agreementDocumentId?: string | null;
  monthlyRent: number; deposit: number | null; tenantName: string | null;
  startsOn: string | null; endsOn: string | null; renewsOn: string | null; miscCharges: boolean; sharedWith: number; createdAt: string | null;
  /** MANAGE: the owner's amount a month, sen. */
  ownerAmount?: number | null;
  /** Rent to rent (0161), recorded only. Sen or null. */
  rentToRent?: Partial<Record<RentToRentKey, number | null>>;
}
/** The rent-to-rent grid beyond the rent and deposit (0161): what else we pay the owner, and what we rent it out for. */
const RENT_TO_RENT_KEYS = ['depositUtilities', 'depositCard', 'rentOutAmount', 'rentOutDeposit', 'rentOutDepositUtilities', 'rentOutDepositCard'] as const;
export type RentToRentKey = typeof RENT_TO_RENT_KEYS[number];
export interface Example {
  month: string; model: RevenueModel; nights: number; occupancy: number;
  income: number; costs: { label: string; amount: number }[]; costsTotal: number; net: number;
  ownerPct: number | null; ownerShare: number; operatorShare: number; managementShare: number; agentShare: number;
  guarantee: number; topUp: number; rent: number; payout: number; adjustments: number; netPayout: number;
  company: { income: number; costs: number; rentToOwner: number; result: number } | null; otherPayers: number;
  yearly?: { annual: number; due: number; yearFrom: string; yearTo: string; trueUp: boolean; sharesBefore: number | null; yearShares: number | null } | null;
}
interface Payload {
  month: string; unit: { id: string; label: string; ownerName: string; purpose?: UnitPurpose };
  /** The codes this unit may take: a showroom or warehouse only WH (0125). */
  allowedCodes?: ContractCode[];
  current: ContractView; history: ContractView[]; example: Example | null;
}

interface Draft {
  revenueModel: RevenueModel; contractCode: ContractCode; yearlyGuarantee: number | null; ownerPct: number | null; managementPct: number | null; agentPct: number | null; agentName: string;
  minimumGuarantee: number | null; guaranteeStartsOn: string; guaranteeEndsOn: string;
  monthlyRent: number | null; deposit: number | null; tenantName: string; ltFeePct: number | null;
  startsOn: string; endsOn: string; renewsOn: string; miscCharges: boolean;
  ownerAmount: number | null;
  depositUtilities: number | null; depositCard: number | null;
  rentOutAmount: number | null; rentOutDeposit: number | null; rentOutDepositUtilities: number | null; rentOutDepositCard: number | null;
}
const senOrEmpty = (sen: number | null | undefined) => (sen ? sen : null);
const pctOf = (n: number | null | undefined) => (n == null ? null : Number(n.toFixed(2)));
const pctText = (n: number | null | undefined) => (n == null ? '' : String(Number(n.toFixed(2))));

function draftOf(c: ContractView): Draft {
  return {
    revenueModel: c.revenueModel, contractCode: c.contractCode ?? codeFromModel(c.revenueModel), yearlyGuarantee: senOrEmpty(c.yearlyGuarantee),
    ownerPct: pctOf(c.ownerPct ?? 75), managementPct: pctOf(c.managementPct != null && !isTenancy(c.revenueModel) ? c.managementPct : c.ownerPct != null ? 100 - c.ownerPct - (c.agentPct ?? 0) : 25),
    agentPct: pctOf(c.agentPct ?? 0), agentName: c.agentName ?? '',
    minimumGuarantee: senOrEmpty(c.minimumGuarantee), guaranteeStartsOn: c.guaranteeStartsOn ?? '', guaranteeEndsOn: c.guaranteeEndsOn ?? '',
    monthlyRent: senOrEmpty(c.monthlyRent), deposit: senOrEmpty(c.deposit), tenantName: c.tenantName ?? '', ltFeePct: pctOf(isTenancy(c.revenueModel) ? c.managementPct : 10),
    startsOn: c.startsOn?.slice(0, 10) ?? '', endsOn: c.endsOn?.slice(0, 10) ?? '', renewsOn: c.renewsOn?.slice(0, 10) ?? '', miscCharges: c.miscCharges,
    ownerAmount: senOrEmpty(c.ownerAmount),
    depositUtilities: c.rentToRent?.depositUtilities ?? null, depositCard: c.rentToRent?.depositCard ?? null,
    rentOutAmount: c.rentToRent?.rentOutAmount ?? null, rentOutDeposit: c.rentToRent?.rentOutDeposit ?? null,
    rentOutDepositUtilities: c.rentToRent?.rentOutDepositUtilities ?? null, rentOutDepositCard: c.rentToRent?.rentOutDepositCard ?? null,
  };
}
function bodyOf(d: Draft) {
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
    // LT (Package C) has no operator share (staff sheet UNIT, 26 Oct 2026); WH LT keeps its own.
    ...(isTenancy(m) ? { tenantName: d.tenantName, managementPct: d.contractCode === 'LT' ? 0 : d.ltFeePct ?? 0 } : {}),
    startsOn: d.startsOn, endsOn: d.endsOn || null, renewsOn: d.renewsOn || null,
  };
}
/** Problems the form can see before asking the server (the server checks the same and more). */
function problems(d: Draft): Record<string, string> {
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
const manageOwnerPct = (d: Draft) => Number((100 - (d.managementPct ?? 0) - (d.agentPct ?? 0)).toFixed(2));
const isShare = (m: RevenueModel) => m === 'management' || m === 'management_guarantee' || m === 'management_yearly_guarantee';

const HISTORY_COLUMNS: Column<ContractView>[] = [
  { key: 'code', label: 'Code', value: h => h.contractCode ?? codeFromModel(h.revenueModel), width: 90, render: h => <CodeBadge code={h.contractCode ?? codeFromModel(h.revenueModel)} size="sm" /> },
  { key: 'model', label: 'Contract type', value: h => CODE[h.contractCode ?? codeFromModel(h.revenueModel)].label, width: 190, render: h => <span><ModelChip model={h.revenueModel} label={CODE[h.contractCode ?? codeFromModel(h.revenueModel)].label} /></span> },
  { key: 'terms', label: 'Terms', value: h => h.termsLabel, width: 200 },
  { key: 'starts', label: 'From', type: 'date', value: h => h.startsOn, width: 116, render: h => <span className="whitespace-nowrap">{h.startsOn ? date(h.startsOn) : 'No start'}</span> },
  { key: 'ends', label: 'To', type: 'date', value: h => h.endsOn, width: 116, render: h => <span className="whitespace-nowrap">{h.endsOn ? date(h.endsOn) : 'Open'}</span> },
];

export function ModelChip({ model, label }: { model: RevenueModel; label?: string }) {
  return <StatusBadge tone={MODEL_TONE[model]} label={label ?? MODEL[model].label} />;
}

export default function ContractTab({ unitId, canEdit, onSaved, footer }: { unitId: string; canEdit: boolean; onSaved: () => void; footer?: ReactNode }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Payload>(`/units/${encodeURIComponent(unitId)}/contract`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<'update' | 'new'>('update');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Example | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [extending, setExtending] = useState(false);

  const current = data?.current ?? null;
  const allowedCodes = data?.allowedCodes;
  const original = useMemo(() => {
    if (!current) return null;
    const o = draftOf(current);
    // No contract yet on a unit whose own split is not a code it may take (a showroom): start from the first it may.
    if (!current.id && allowedCodes?.length && !allowedCodes.includes(o.contractCode)) return { ...o, contractCode: allowedCodes[0], revenueModel: CODE[allowedCodes[0]].model };
    return o;
  }, [current, allowedCodes]);
  useEffect(() => { if (original) { setDraft(original); setMode('update'); setFields({}); setPreview(null); } }, [original]);
  const d = draft ?? original;
  const dirty = !!d && !!original && JSON.stringify(d) !== JSON.stringify(original);
  const local = d ? problems(d) : {};
  const shown = { ...local, ...fields };

  // The example follows the form: once the terms change, the server works last month out again on them.
  useEffect(() => {
    if (!d || !dirty || Object.keys(problems(d)).length) { setPreview(null); return; }
    const t = setTimeout(() => {
      setPreviewing(true);
      api.post<{ example: Example | null }>(`/units/${encodeURIComponent(unitId)}/contract`, { ...bodyOf(d), month: data?.month })
        .then(r => setPreview(r.example)).catch(() => setPreview(null)).finally(() => setPreviewing(false));
    }, 350);
    return () => clearTimeout(t);
  }, [d, dirty, unitId, data?.month]);

  if (!d || !current) {
    return <Card><div className="p-8 text-center text-copy text-muted-ink">{loading ? 'Loading the contract…' : error ?? 'The contract could not be loaded.'}</div></Card>;
  }
  const set = (p: Partial<Draft>) => { setDraft({ ...d, ...p }); setFields({}); };
  const m = d.revenueModel;
  const share = isShare(m);
  const purpose = data?.unit.purpose ?? 'rental';
  // The current code stays offered even if the list has moved on (an older GRR), so the form can show it.
  const offered = CODES.filter(c => (data?.allowedCodes ?? CODES.filter(x => x.code !== 'WH' && x.code !== 'WH LT' && x.code !== 'GRR').map(x => x.code)).includes(c.code) || c.code === d.contractCode);
  const example = preview ?? data?.example ?? null;

  async function save() {
    if (!d) return;
    setSaving(true);
    try {
      const r = await api.put<{ split: boolean }>(`/units/${encodeURIComponent(unitId)}/contract`, { ...bodyOf(d), mode });
      toast({ tone: 'success', title: mode === 'new' ? 'New contract started.' : 'Contract saved.',
        body: `${codeName(d.contractCode)}: ${CODE[d.contractCode].label}.${r.split ? ' This unit now has its own contract; the other units keep theirs.' : ''} Draft owner statements change when regenerated; final ones keep their figures.` });
      setMode('update'); reload(); onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Contract was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setSaving(false); }
  }

  const pct = (k: 'ownerPct' | 'managementPct' | 'agentPct' | 'ltFeePct', label: string) => (
    <PercentInput label={label} value={d[k]} onChange={v => set({ [k]: v })} error={shown[k === 'ltFeePct' ? 'managementPct' : k]} />
  );
  const money = (k: 'minimumGuarantee' | 'yearlyGuarantee' | 'monthlyRent' | 'deposit' | 'ownerAmount' | RentToRentKey, label: string, help?: string) => (
    <MoneyInput label={label} placeholder="e.g. 3,000.00" valueSen={d[k]} onChangeSen={v => set({ [k]: v })} error={shown[k]} help={help} />
  );
  const day = (k: 'startsOn' | 'endsOn' | 'renewsOn' | 'guaranteeStartsOn' | 'guaranteeEndsOn', label: string) => (
    <DateField label={label} value={d[k]} onChange={v => set({ [k]: v })} error={shown[k]}
      min={k === 'endsOn' || k === 'renewsOn' ? d.startsOn || undefined : k === 'guaranteeEndsOn' ? d.guaranteeStartsOn || undefined : undefined} />
  );

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Income model</span>
            <span className="text-meta text-muted-ink">
              {current.id && current.contractCode && <><CodeBadge code={current.contractCode} size="sm" />{' '}</>}
              {current.id ? <>In force {current.startsOn ? `from ${date(current.startsOn)}` : ''}{current.endsOn ? ` to ${date(current.endsOn)}` : ''} · {current.termsLabel}</> : <>No contract record yet: the unit's own split is used ({current.termsLabel}). Saving creates its contract.</>}
              {data!.history.length > 0 && <> · <a href="#contract-history" className="text-gold-ink">Contract history ({data!.history.length})</a></>}
            </span>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {dirty && <span className="text-meta text-warning">Unsaved changes</span>}
              <GenerateAgreement unitId={unitId} refreshKey={(current.id ?? 'none') + (current.startsOn ?? '')} />
              {current.id && mode === 'update' && !dirty && <Button size="sm" variant="secondary" icon={<Icon name="CalendarPlus" size="sm" />} onClick={() => setExtending(true)}>Extend / renew</Button>}
              {current.id && mode === 'update' && <Button size="sm" variant="secondary" onClick={() => { setMode('new'); set({ startsOn: '', endsOn: '', renewsOn: '' }); }}>Start a new contract</Button>}
              {mode === 'new' && <Button size="sm" variant="tertiary" onClick={() => { setMode('update'); setDraft(original); }}>Cancel new contract</Button>}
              <Button size="sm" variant="primary" loading={saving} disabled={!dirty || Object.keys(local).length > 0}
                disabledReason={Object.values(local)[0] ?? 'Nothing has changed'} onClick={() => void save()}>{mode === 'new' ? 'Start contract' : 'Save contract'}</Button>
            </div>
          )}
        </div>
        <fieldset disabled={!canEdit} className="p-5 m-0 border-0 min-w-0 flex flex-col gap-5">
          {mode === 'new' && <div className="py-[10px] px-[14px] rounded-control bg-gold-tint text-copy">A new contract from its start date. The current one ends the day before and stays in this unit's history; statements before the new start keep using it.</div>}
          {current.sharedWith > 0 && mode === 'update' && <div className="py-[10px] px-[14px] rounded-control bg-muted text-meta text-muted-ink">This contract record also covers {current.sharedWith} other {current.sharedWith === 1 ? 'unit' : 'units'} of the owner. Saving here gives this unit its own copy; the others are not changed.</div>}

          {purpose !== 'rental' && <div className="py-[10px] px-[14px] rounded-control bg-muted text-meta text-muted-ink">A {PURPOSE_LABEL[purpose].toLowerCase()} unit is not run on the channels: it takes a WH lease (a fixed monthly rent to the owner) or a WH LT let (one tenant, such as Dream Crafter, rents it; the owner gets the rent less the operator share).</div>}
          <Select label="Income model" showLabel size="md" className="max-w-[560px]" value={d.contractCode}
            options={offered.map(o => ({ value: o.code, label: `${o.code}${o.pkg && o.pkg !== '-' ? ` ${o.pkg}` : ''} - ${o.label}` }))}
            onChange={v => { const o = CODE[v as ContractCode]; set({ contractCode: o.code, revenueModel: o.model }); }} />
          {(() => {
            const o = CODE[d.contractCode];
            return (
              <div aria-live="polite" className="flex flex-col gap-2 rounded-card [border:1px_solid_var(--color-line)] bg-page p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">Selected model</span>
                  <ModelChip model={m} label={o.code} />
                </div>
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-copy">
                  <dt className="text-muted-ink">Type</dt><dd className="m-0 font-medium text-ink">{o.label}{o.pkg && o.pkg !== '-' ? ` ${o.pkg}` : ''}</dd>
                  <dt className="text-muted-ink">Terms</dt><dd className="m-0 text-ink [text-wrap:pretty]">{o.blurb}</dd>
                  <dt className="text-muted-ink">Statement</dt><dd className="m-0 text-ink [text-wrap:pretty]">{MODEL[m].statement}</dd>
                </dl>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
              <Field label="Tenant" placeholder="Tenant's name" value={d.tenantName} onChange={e => set({ tenantName: e.target.value })} error={shown.tenantName} />
              {money('monthlyRent', 'Monthly rent from tenant (RM)')}
              {d.contractCode !== 'LT' && pct('ltFeePct', 'Operator share % of the rent')}
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
            const gridCols = 'grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 px-4';
            const gap = (d.rentOutAmount ?? 0) - (d.monthlyRent ?? 0);
            return (
              <div role="group" aria-label="Rent to rent terms" className="rounded-card [border:1px_solid_var(--color-line)] bg-page overflow-hidden max-w-[760px]">
                <div className={cx(gridCols, 'py-2.5 bg-muted text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink')}>
                  <span aria-hidden />
                  <span className="text-right">Costing Rental Amount</span>
                  <span className="text-right">Rental Out Amount</span>
                </div>
                {rows.map(([label, pay, rentOut]) => (
                  <div key={pay} className={cx(gridCols, 'items-start py-2.5 [border-top:1px_solid_var(--color-line-soft)]')}>
                    <span className="min-h-10 flex items-center text-copy text-muted-ink">{label}</span>
                    <MoneyInput prefix aria-label={`${label}, Costing Rental Amount`} placeholder="0.00" valueSen={d[pay]} onChangeSen={v => set({ [pay]: v })} error={shown[pay]} />
                    <MoneyInput prefix aria-label={`${label}, Rental Out Amount`} placeholder="0.00" valueSen={d[rentOut]} onChangeSen={v => set({ [rentOut]: v })} error={shown[rentOut]} />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
        </fieldset>
      </Card>

      {extending && current.id && <ExtendContractModal unitId={unitId} unitLabel={data!.unit.label}
        current={{ code: current.contractCode ?? codeFromModel(current.revenueModel), termsLabel: current.termsLabel, startsOn: current.startsOn, endsOn: current.endsOn }}
        onClose={() => setExtending(false)} onSaved={() => { setExtending(false); reload(); onSaved(); }} />}
      <StatementExample example={example} month={data!.month} draft={dirty && !!preview} busy={previewing} />

      {data!.history.length > 0 && (
        <Card>
          <div id="contract-history" className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Contract history</span>
            <span className="text-meta text-muted-ink">Earlier contracts of this unit. A month before the current contract started is worked out on the one in force then.</span>
          </div>
          <DataTable<ContractView> id="unit.contracts" urlPrefix="ct." bare noViews noToolbar pageSize={0} maxHeight="none"
            columns={HISTORY_COLUMNS} rows={data!.history} rowKey={h => h.id ?? `${h.startsOn}|${h.revenueModel}`} noun={['contract', 'contracts']} />
        </Card>
      )}
      {footer}
    </>
  );
}

/** "How this month's statement works": the engine's figures for one month, line by line, in plain words. */
export function StatementExample({ example: x, month, draft, busy }: { example: Example | null; month: string; draft?: boolean; busy?: boolean }) {
  const Row = ({ label, sen, strong, sub }: { label: ReactNode; sen: number; strong?: boolean; sub?: boolean }) => (
    <div className={cx('flex items-baseline justify-between gap-4 py-[7px]', strong && '[border-top:1px_solid_var(--color-line)] mt-1 pt-[9px]', sub && 'pl-4')}>
      <span className={cx('text-copy min-w-0', strong ? 'font-semibold text-ink' : sub ? 'text-muted-ink' : 'text-ink')}>{label}</span>
      <MoneyText sen={sen} mode="exact" className={cx('text-copy text-right whitespace-nowrap', strong ? 'font-semibold' : '')} />
    </div>
  );
  return (
    <Card>
      <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">How the {monthLabel(month)} statement works</span>
        <span className="text-meta text-muted-ink">{busy ? 'Working it out…' : draft ? 'On the terms in the form (not saved)' : `This unit's real ${monthLabel(month)} figures`}</span>
      </div>
      {!x ? <div className="py-4 px-5 text-copy text-muted-ink">No figures for {monthLabel(month)}.</div> : (
        <div className="py-3 px-5 bg-page">
          {x.model === 'master_lease' ? <>
            <p className="m-0 mb-2 text-copy">No owner statement: the company rents the unit and keeps its profit or loss.</p>
            {x.company && <>
              <Row label="Unit income (reservations)" sen={x.company.income} />
              <Row label="Costs on the unit (all payers)" sen={-x.company.costs} />
              <Row label="Lease rent paid to the owner" sen={-x.company.rentToOwner} />
              <Row label="Company result" sen={x.company.result} strong />
            </>}
          </> : x.model === 'grr' ? <>
            <Row label="Fixed rent to the owner" sen={x.rent} />
            {x.adjustments !== 0 && <Row label="Owner Adjustments" sen={x.adjustments} />}
            <Row label="Net Payout to Owner" sen={x.netPayout} strong />
            {x.company && <p className="m-0 mt-2 text-meta text-muted-ink">The company's side: the unit earned {rm(x.company.income)} and cost {rm(x.company.costs)}; after the rent the company {x.company.result >= 0 ? 'keeps' : 'loses'} {rm(Math.abs(x.company.result))}.</p>}
          </> : isTenancy(x.model) ? <>
            <Row label="Monthly rent from the tenant" sen={x.income} />
            {x.costs.map(c => <Row key={c.label} label={c.label} sen={-c.amount} sub />)}
            {x.operatorShare !== 0 && <Row label={`${pctText(100 - (x.ownerPct ?? 100))}% To Operator (of the rent)`} sen={-x.operatorShare} />}
            {x.adjustments !== 0 && <Row label="Owner Adjustments" sen={x.adjustments} />}
            <Row label="Net Payout to Owner" sen={x.netPayout} strong />
          </> : <>
            <Row label={`Hospitality Income (${x.nights} ${x.nights === 1 ? 'night' : 'nights'}, ${Math.round(x.occupancy * 100)}% occupied)`} sen={x.income} />
            {x.costs.map(c => <Row key={c.label} label={c.label} sen={-c.amount} sub />)}
            <Row label="Net Income" sen={x.net} strong />
            <Row label={`Owner ${pctText(x.ownerPct)}%`} sen={x.ownerShare} />
            <Row label={x.agentShare ? 'Management' : `Management ${pctText(100 - (x.ownerPct ?? 0))}%`} sen={x.managementShare} sub />
            {x.agentShare > 0 && <Row label="Agent" sen={x.agentShare} sub />}
            {x.guarantee > 0 && !x.yearly && <Row label={x.topUp > 0 ? `Below the ${rm(x.guarantee)} minimum: company tops up` : `Above the ${rm(x.guarantee)} minimum: no top-up`} sen={x.topUp} />}
            {x.yearly?.trueUp && x.yearly.yearShares != null && <Row label={x.topUp > 0 ? `Contract year ${x.yearly.yearFrom} to ${x.yearly.yearTo}: owner's shares ${rm(x.yearly.yearShares)}, below the ${rm(x.yearly.due)} yearly guarantee, company tops up` : `Contract year ${x.yearly.yearFrom} to ${x.yearly.yearTo}: owner's shares ${rm(x.yearly.yearShares)}, above the ${rm(x.yearly.due)} yearly guarantee`} sen={x.topUp} />}
            {x.adjustments !== 0 && <Row label="Owner Adjustments" sen={x.adjustments} />}
            <Row label="Net Payout to Owner" sen={x.netPayout} strong />
          </>}
          {x.yearly && !x.yearly.trueUp && <p className="m-0 mt-2 text-meta text-muted-ink">Yearly guarantee {rm(x.yearly.due)}: checked on the {x.yearly.yearTo} statement, the last of the contract year from {x.yearly.yearFrom}.</p>}
          {x.otherPayers > 0 && <p className="m-0 mt-2 text-meta text-muted-ink">{rm(x.otherPayers)} of costs paid by the company, a tenant or a guest are not on the statement.</p>}
        </div>
      )}
    </Card>
  );
}
