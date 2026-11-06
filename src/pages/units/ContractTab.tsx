import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Icon from '../../components/Icon';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { MoneyText } from '../../components/MoneyText';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { date, monthLabel, rm, todayMyt } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { typeOf, codeName, codeLabel, codeFromModel, isTenancy, type ContractType, type RevenueModel, type ContractCode, type UnitPurpose } from '../../lib/revenueModel';
import { useContractTypes } from '../../lib/useContractTypes';
import { ExtendContractModal, GenerateAgreement } from './ContractExtras';
import { CodeBadge } from './UnitExtras';
import { DataTable, type Column } from '../../components/DataTable';
import { RecordHistory } from '../../components/RecordHistory';
import { isPlaceholderOwner } from './shared';
import { ContractFields, ModelChip, draftOf, bodyOf, problems, pctText, type ContractView, type Draft } from './contractForm';

export { ModelChip };

/** The Contract tab: pick ONE revenue model, then fill only that model's fields. Below, last month's statement for
 *  this unit worked out on the terms as they stand in the form (the statement engine, on the server), and the
 *  unit's earlier contracts. */

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
  /** The codes this unit may take (the same for every purpose, migration 0181). */
  allowedCodes?: ContractCode[];
  current: ContractView; history: ContractView[]; example: Example | null;
  /** The contract that applies until the current one's later start date, if any. */
  untilThen?: ContractView | null;
}

const historyColumns = (types: readonly ContractType[]): Column<ContractView>[] => [
  { key: 'code', label: 'Code', value: h => h.contractCode ?? codeFromModel(types, h.revenueModel), width: 90, render: h => <CodeBadge code={h.contractCode ?? codeFromModel(types, h.revenueModel)} types={types} size="sm" /> },
  { key: 'model', label: 'Contract type', value: h => codeLabel(types, h.contractCode ?? codeFromModel(types, h.revenueModel)), width: 190, render: h => <span><ModelChip model={h.revenueModel} label={codeLabel(types, h.contractCode ?? codeFromModel(types, h.revenueModel))} /></span> },
  { key: 'terms', label: 'Terms', value: h => h.termsLabel, width: 200 },
  { key: 'starts', label: 'From', type: 'date', value: h => h.startsOn, width: 116, render: h => <span className="whitespace-nowrap">{h.startsOn ? date(h.startsOn) : 'No start'}</span> },
  { key: 'ends', label: 'To', type: 'date', value: h => h.endsOn, width: 116, render: h => <span className="whitespace-nowrap">{h.endsOn ? date(h.endsOn) : 'Open'}</span> },
];

export default function ContractTab({ unitId, canEdit, onSaved, footer }: { unitId: string; canEdit: boolean; onSaved: () => void; footer?: ReactNode }) {
  const toast = useToast();
  const types = useContractTypes();
  const { data, loading, error, reload } = useApi<Payload>(`/units/${encodeURIComponent(unitId)}/contract`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<'update' | 'new'>('update');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Example | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [extending, setExtending] = useState(false);
  const [picked, setPicked] = useState(false);

  const current = data?.current ?? null;
  const allowedCodes = data?.allowedCodes;
  const original = useMemo(() => {
    if (!current) return null;
    const o = draftOf(current, types);
    // No contract yet on a unit whose own split is not a code it may take (a showroom): start from the first it may.
    if (!current.id && allowedCodes?.length && !allowedCodes.includes(o.contractCode)) return { ...o, contractCode: allowedCodes[0], revenueModel: typeOf(types, allowedCodes[0])?.revenueModel ?? o.revenueModel };
    return o;
  }, [current, allowedCodes, types]);
  useEffect(() => { if (original) { setDraft(original); setMode('update'); setFields({}); setPreview(null); setPicked(false); } }, [original]);
  const d = draft ?? original;
  // A contract with no saved type is read from its terms; saving would lock that guess in, so the type is chosen first.
  const typeUnset = !!current?.id && current.typeStored === false && mode === 'update';
  const dirty = (!!d && !!original && JSON.stringify(d) !== JSON.stringify(original)) || (typeUnset && picked);
  const local: Record<string, string> = { ...(d ? problems(d) : {}), ...(typeUnset && !picked ? { contractCode: 'Choose the contract type first.' } : {}) };
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

  if (isPlaceholderOwner(data?.unit.ownerName)) {
    return <Card><div className="p-8 text-center text-copy text-muted-ink">Pick the owner on the Details tab first. A contract is made with the owner, so this unit has none until then.</div></Card>;
  }
  if (!d || !current) {
    return <Card><div className="p-8 text-center text-copy text-muted-ink">{loading ? 'Loading the contract…' : error ?? 'The contract could not be loaded.'}</div></Card>;
  }
  const set = (p: Partial<Draft>) => { setDraft({ ...d, ...p }); setFields({}); };
  // The current code stays offered even if the list has moved on (an older GRR), so the form can show it.
  const offered = types.filter(t => (data?.allowedCodes ? data.allowedCodes.includes(t.code) : t.isActive) || t.code === d.contractCode);
  const example = preview ?? data?.example ?? null;
  const guess = current.contractCode ?? codeFromModel(types, current.revenueModel);

  async function save() {
    if (!d) return;
    setSaving(true);
    try {
      const r = await api.put<{ split: boolean }>(`/units/${encodeURIComponent(unitId)}/contract`, { ...bodyOf(d), mode });
      toast({ tone: 'success', title: mode === 'new' ? 'New contract started.' : 'Contract saved.',
        body: `${codeName(types, d.contractCode)}: ${codeLabel(types, d.contractCode)}.${r.split ? ' This unit now has its own contract; the other units keep theirs.' : ''} Draft owner statements change when regenerated; final ones keep their figures.` });
      setMode('update'); reload(); onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Contract was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setSaving(false); }
  }

  const saveButton = (
    <Button size="sm" variant="primary" loading={saving} disabled={!dirty || Object.keys(local).length > 0}
      disabledReason={Object.values(local)[0] ?? 'Nothing has changed'} onClick={() => void save()}>{mode === 'new' ? 'Start contract' : 'Save contract'}</Button>
  );

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Income model</span>
            <span className="text-meta text-muted-ink">
              {current.id && current.contractCode && <><CodeBadge code={current.contractCode} types={types} size="sm" />{' '}</>}
              {current.id && current.startsOn && current.startsOn.slice(0, 10) > todayMyt() ? <>Starts {date(current.startsOn)} · {current.termsLabel}{data!.untilThen ? <>. Until then: {data!.untilThen.termsLabel}</> : ''}</>
                : current.id ? <>In force {current.startsOn ? `from ${date(current.startsOn)}` : ''}{current.endsOn ? ` to ${date(current.endsOn)}` : ''} · {current.termsLabel}</> : <>No contract record yet: the unit's own split is used ({current.termsLabel}). Saving creates its contract.</>}
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
              {saveButton}
            </div>
          )}
        </div>
        <fieldset disabled={!canEdit} className="p-5 m-0 border-0 min-w-0 flex flex-col gap-5">
          {mode === 'new' && <div className="py-[10px] px-[14px] rounded-control bg-gold-tint text-copy">A new contract from its start date. The current one ends the day before and stays in this unit's history; statements before the new start keep using it.</div>}
          {current.sharedWith > 0 && mode === 'update' && <div className="py-[10px] px-[14px] rounded-control bg-muted text-meta text-muted-ink">This contract record also covers {current.sharedWith} other {current.sharedWith === 1 ? 'unit' : 'units'} of the owner. Saving here gives this unit its own copy; the others are not changed.</div>}

          <ContractFields d={d} set={set} errors={shown} types={types} offered={offered} onPickType={() => setPicked(true)}
            afterSelect={typeUnset && !picked && (
              <div className="flex flex-wrap items-center justify-between gap-3 py-[10px] px-[14px] rounded-control bg-gold-tint text-copy">
                <span>Type not set. This contract has no saved type; it is being read as <b>{codeName(types, guess)}</b> from its terms. Choose the type above, or keep this one, before saving.</span>
                <Button size="sm" variant="secondary" onClick={() => setPicked(true)}>Keep {guess}</Button>
              </div>
            )} />
        </fieldset>
      </Card>

      {extending && current.id && <ExtendContractModal unitId={unitId} unitLabel={data!.unit.label}
        current={{ code: current.contractCode ?? codeFromModel(types, current.revenueModel), termsLabel: current.termsLabel, startsOn: current.startsOn, endsOn: current.endsOn }}
        onClose={() => setExtending(false)} onSaved={() => { setExtending(false); reload(); onSaved(); }} />}
      <StatementExample example={example} month={data!.month} draft={dirty && !!preview} busy={previewing} />

      {data!.history.length > 0 && (
        <Card>
          <div id="contract-history" className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Contract history</span>
            <span className="text-meta text-muted-ink">Earlier contracts of this unit. A month before the current contract started is worked out on the one in force then.</span>
          </div>
          <DataTable<ContractView> id="unit.contracts" urlPrefix="ct." bare noViews noToolbar pageSize={0} maxHeight="none"
            columns={historyColumns(types)} rows={data!.history} rowKey={h => h.id ?? `${h.startsOn}|${h.revenueModel}`} noun={['contract', 'contracts']} />
        </Card>
      )}
      {/* Who changed the terms and when, field by field: this contract and the unit's earlier ones (at most 10). */}
      {current.id && (
        <RecordHistory key={current.id} entity="owner_contracts" id={current.id} title="History of changes" refreshKey={data}
          also={data!.history.flatMap(h => (h.id ? [['owner_contracts', h.id] as [string, string]] : [])).slice(0, 10)} />
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
