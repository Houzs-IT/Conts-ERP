import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { MoneyText } from '../../components/MoneyText';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { date, monthLabel, rm } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { MODELS, MODEL, MODEL_TONE, type RevenueModel } from '../../lib/revenueModel';
import { DataTable, type Column } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

/** The Contract tab: pick ONE revenue model, then fill only that model's fields. Below, last month's statement for
 *  this unit worked out on the terms as they stand in the form (the statement engine, on the server), and the
 *  unit's earlier contracts. */

interface ContractView {
  id: string | null; revenueModel: RevenueModel; termsLabel: string;
  ownerPct: number | null; managementPct: number | null; agentPct: number | null; agentName: string | null;
  minimumGuarantee: number; guaranteeStartsOn: string | null; guaranteeEndsOn: string | null;
  monthlyRent: number; deposit: number | null; tenantName: string | null;
  startsOn: string | null; endsOn: string | null; renewsOn: string | null; miscCharges: boolean; sharedWith: number; createdAt: string | null;
}
export interface Example {
  month: string; model: RevenueModel; nights: number; occupancy: number;
  income: number; costs: { label: string; amount: number }[]; costsTotal: number; net: number;
  ownerPct: number | null; ownerShare: number; operatorShare: number; managementShare: number; agentShare: number;
  guarantee: number; topUp: number; rent: number; payout: number; adjustments: number; netPayout: number;
  company: { income: number; costs: number; rentToOwner: number; result: number } | null; otherPayers: number;
}
interface Payload { month: string; unit: { id: string; label: string; ownerName: string }; current: ContractView; history: ContractView[]; example: Example | null }

interface Draft {
  revenueModel: RevenueModel; ownerPct: string; managementPct: string; agentPct: string; agentName: string;
  minimumGuarantee: string; guaranteeStartsOn: string; guaranteeEndsOn: string;
  monthlyRent: string; deposit: string; tenantName: string; ltFeePct: string;
  startsOn: string; endsOn: string; renewsOn: string; miscCharges: boolean;
}
const ringgit = (sen: number | null | undefined) => (sen ? String(sen / 100) : '');
const toSen = (v: string) => Math.round(Number(v || 0) * 100);
const pctText = (n: number | null | undefined) => (n == null ? '' : String(Number(n.toFixed(2))));

function draftOf(c: ContractView): Draft {
  return {
    revenueModel: c.revenueModel,
    ownerPct: pctText(c.ownerPct ?? 75), managementPct: pctText(c.managementPct != null && c.revenueModel !== 'long_term' ? c.managementPct : c.ownerPct != null ? 100 - c.ownerPct - (c.agentPct ?? 0) : 25),
    agentPct: pctText(c.agentPct ?? 0), agentName: c.agentName ?? '',
    minimumGuarantee: ringgit(c.minimumGuarantee), guaranteeStartsOn: c.guaranteeStartsOn ?? '', guaranteeEndsOn: c.guaranteeEndsOn ?? '',
    monthlyRent: ringgit(c.monthlyRent), deposit: ringgit(c.deposit), tenantName: c.tenantName ?? '', ltFeePct: pctText(c.revenueModel === 'long_term' ? c.managementPct : 10),
    startsOn: c.startsOn?.slice(0, 10) ?? '', endsOn: c.endsOn?.slice(0, 10) ?? '', renewsOn: c.renewsOn?.slice(0, 10) ?? '', miscCharges: c.miscCharges,
  };
}
function bodyOf(d: Draft) {
  const m = d.revenueModel, share = m === 'management' || m === 'management_guarantee';
  return {
    revenueModel: m,
    ...(share ? { ownerPct: Number(d.ownerPct), managementPct: Number(d.managementPct), agentPct: Number(d.agentPct || 0), agentName: d.agentName || null, miscCharges: d.miscCharges } : {}),
    ...(m === 'management_guarantee' ? { minimumGuarantee: toSen(d.minimumGuarantee), guaranteeStartsOn: d.guaranteeStartsOn || null, guaranteeEndsOn: d.guaranteeEndsOn || null } : {}),
    ...(!share ? { monthlyRent: toSen(d.monthlyRent) } : {}),
    ...(m === 'master_lease' ? { deposit: d.deposit ? toSen(d.deposit) : null } : {}),
    ...(m === 'long_term' ? { tenantName: d.tenantName, managementPct: Number(d.ltFeePct || 0) } : {}),
    startsOn: d.startsOn, endsOn: d.endsOn || null, renewsOn: d.renewsOn || null,
  };
}
/** Problems the form can see before asking the server (the server checks the same and more). */
function problems(d: Draft): Record<string, string> {
  const f: Record<string, string> = {}, m = d.revenueModel;
  if (m === 'management' || m === 'management_guarantee') {
    const sum = Number(d.ownerPct || 0) + Number(d.managementPct || 0) + Number(d.agentPct || 0);
    if (Math.abs(sum - 100) > 0.001) f.ownerPct = `Owner, management and agent add up to ${Number(sum.toFixed(2))}%, not 100%.`;
    if (m === 'management_guarantee' && !(Number(d.minimumGuarantee) > 0)) f.minimumGuarantee = 'Enter the monthly minimum.';
  } else if (!(Number(d.monthlyRent) > 0)) f.monthlyRent = 'Enter the monthly rent.';
  if (m === 'long_term' && !d.tenantName.trim()) f.tenantName = 'Enter the tenant.';
  return f;
}

const HISTORY_COLUMNS: Column<ContractView>[] = [
  { key: 'model', label: 'Revenue model', value: h => MODEL[h.revenueModel].label, width: 170, render: h => <span><ModelChip model={h.revenueModel} /></span> },
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

  const current = data?.current ?? null;
  const original = useMemo(() => (current ? draftOf(current) : null), [current]);
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
  const share = m === 'management' || m === 'management_guarantee';
  const example = preview ?? data?.example ?? null;

  async function save() {
    if (!d) return;
    setSaving(true);
    try {
      const r = await api.put<{ split: boolean }>(`/units/${encodeURIComponent(unitId)}/contract`, { ...bodyOf(d), mode });
      toast({ tone: 'success', title: mode === 'new' ? 'New contract started.' : 'Contract saved.',
        body: `${MODEL[d.revenueModel].label}.${r.split ? ' This unit now has its own contract; the other units keep theirs.' : ''} Provisional statements change when regenerated; final ones keep their figures.` });
      setMode('update'); reload(); onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Contract was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setSaving(false); }
  }

  const pct = (k: 'ownerPct' | 'managementPct' | 'agentPct' | 'ltFeePct', label: string) => (
    <Field label={label} type="number" min={0} max={100} step="0.01" numeric value={d[k]} onChange={e => set({ [k]: e.target.value })} error={shown[k === 'ltFeePct' ? 'managementPct' : k]} />
  );
  const money = (k: 'minimumGuarantee' | 'monthlyRent' | 'deposit', label: string, help?: string) => (
    <Field label={label} type="number" min={0} step="0.01" numeric placeholder="e.g. 3000" value={d[k]} onChange={e => set({ [k]: e.target.value })} error={shown[k]} help={help} />
  );
  const day = (k: 'startsOn' | 'endsOn' | 'renewsOn' | 'guaranteeStartsOn' | 'guaranteeEndsOn', label: string) => (
    <Field label={label} type="date" value={d[k]} onChange={e => set({ [k]: e.target.value })} error={shown[k]} />
  );

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-heading font-semibold">Revenue model</span>
            <span className="text-meta text-muted-ink">
              {current.id ? <>In force {current.startsOn ? `from ${date(current.startsOn)}` : ''}{current.endsOn ? ` to ${date(current.endsOn)}` : ''} · {current.termsLabel}</> : <>No contract record yet: the unit's own split is used ({current.termsLabel}). Saving creates its contract.</>}
              {data!.history.length > 0 && <> · <a href="#contract-history" className="text-gold-ink">Contract history ({data!.history.length})</a></>}
            </span>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {dirty && <span className="text-meta text-warning">Unsaved changes</span>}
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

          <div role="radiogroup" aria-label="Revenue model" className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-5 gap-[10px]">
            {MODELS.map(o => {
              const on = o.key === m;
              return (
                <label key={o.key} className={cx('flex flex-col gap-1 rounded-card p-3 cursor-pointer min-w-0', on ? '[border:2px_solid_var(--color-gold)] bg-gold-tint' : '[border:1px_solid_var(--color-line)] bg-card hover:bg-page')}>
                  <span className="flex items-center gap-2">
                    <input type="radio" aria-label={o.label} name={`model-${unitId}`} checked={on} onChange={() => set({ revenueModel: o.key })} className="accent-[var(--color-gold-ink)]" />
                    <span className="text-copy font-semibold">{o.label}</span>
                  </span>
                  <span className="text-meta text-muted-ink [text-wrap:pretty]">{o.blurb}</span>
                </label>
              );
            })}
          </div>
          <p className="m-0 text-meta text-muted-ink">{MODEL[m].statement}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {share && <>
              {pct('ownerPct', 'Owner %')}
              {pct('managementPct', 'Management %')}
              {pct('agentPct', 'Agent %')}
              <Field label="Agent" placeholder="Who brought the unit in" value={d.agentName} onChange={e => set({ agentName: e.target.value })} />
            </>}
            {m === 'management_guarantee' && <>
              {money('minimumGuarantee', 'Monthly minimum (RM)', 'The owner gets at least this a month.')}
              {day('guaranteeStartsOn', 'Minimum applies from')}
              {day('guaranteeEndsOn', 'Minimum applies until')}
            </>}
            {m === 'grr' && money('monthlyRent', 'Monthly rent to owner (RM)', 'Paid whatever the unit earns.')}
            {m === 'master_lease' && <>
              {money('monthlyRent', 'Monthly rent we pay (RM)', 'Recorded as a company cost; no owner statement.')}
              {money('deposit', 'Deposit (RM)')}
            </>}
            {m === 'long_term' && <>
              <Field label="Tenant" placeholder="Tenant's name" value={d.tenantName} onChange={e => set({ tenantName: e.target.value })} error={shown.tenantName} />
              {money('monthlyRent', 'Monthly rent from tenant (RM)')}
              {pct('ltFeePct', 'Management fee % of the rent')}
            </>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {day('startsOn', m === 'master_lease' ? 'Lease starts' : m === 'long_term' ? 'Tenancy starts' : 'Contract starts')}
            {day('endsOn', m === 'master_lease' ? 'Lease ends' : m === 'long_term' ? 'Tenancy ends' : 'Contract ends')}
            {day('renewsOn', 'Renews on')}
            {share && (
              <label className="flex items-start gap-2 pt-[26px] text-copy cursor-pointer">
                <input type="checkbox" checked={d.miscCharges} onChange={e => set({ miscCharges: e.target.checked })} className="mt-[3px] accent-[var(--color-gold-ink)]" />
                <span>Deduct miscellaneous charges <span className="block text-meta text-muted-ink">RM 100 a month times occupancy</span></span>
              </label>
            )}
          </div>
          {m === 'long_term' && <p className="m-0 text-meta text-muted-ink">A long-term let is not sold on the channels; take it off the channels on the Overview tab.</p>}
        </fieldset>
      </Card>

      <StatementExample example={example} month={data!.month} draft={dirty && !!preview} busy={previewing} />

      {data!.history.length > 0 && (
        <Card>
          <div id="contract-history" className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
            <span className="text-heading font-semibold">Contract history</span>
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
        <span className="text-heading font-semibold">How the {monthLabel(month)} statement works</span>
        <span className="text-meta text-muted-ink">{busy ? 'Working it out…' : draft ? 'On the terms in the form (not saved)' : `This unit's real ${monthLabel(month)} figures`}</span>
      </div>
      {!x ? <div className="py-4 px-5 text-copy text-muted-ink">No figures for {monthLabel(month)}.</div> : (
        <div className="py-3 px-5 bg-page">
          {x.model === 'master_lease' ? <>
            <p className="m-0 mb-2 text-copy">No owner statement: the company rents the unit and keeps its profit or loss.</p>
            {x.company && <>
              <Row label="Unit income (bookings)" sen={x.company.income} />
              <Row label="Costs on the unit (all payers)" sen={-x.company.costs} />
              <Row label="Lease rent paid to the owner" sen={-x.company.rentToOwner} />
              <Row label="Company result" sen={x.company.result} strong />
            </>}
          </> : x.model === 'grr' ? <>
            <Row label="Fixed rent to the owner" sen={x.rent} />
            {x.adjustments !== 0 && <Row label="Owner credits & charges" sen={x.adjustments} />}
            <Row label="Net payout to owner" sen={x.netPayout} strong />
            {x.company && <p className="m-0 mt-2 text-meta text-muted-ink">The company's side: the unit earned {rm(x.company.income)} and cost {rm(x.company.costs)}; after the rent the company {x.company.result >= 0 ? 'keeps' : 'loses'} {rm(Math.abs(x.company.result))}.</p>}
          </> : x.model === 'long_term' ? <>
            <Row label="Monthly rent from the tenant" sen={x.income} />
            {x.costs.map(c => <Row key={c.label} label={c.label} sen={-c.amount} sub />)}
            <Row label={`Management fee ${pctText(100 - (x.ownerPct ?? 100))}% of the rent`} sen={-x.operatorShare} />
            {x.adjustments !== 0 && <Row label="Owner credits & charges" sen={x.adjustments} />}
            <Row label="Net payout to owner" sen={x.netPayout} strong />
          </> : <>
            <Row label={`Income (${x.nights} ${x.nights === 1 ? 'night' : 'nights'}, ${Math.round(x.occupancy * 100)}% occupied)`} sen={x.income} />
            {x.costs.map(c => <Row key={c.label} label={c.label} sen={-c.amount} sub />)}
            <Row label="Net income" sen={x.net} strong />
            <Row label={`Owner ${pctText(x.ownerPct)}%`} sen={x.ownerShare} />
            <Row label={x.agentShare ? 'Management' : `Management ${pctText(100 - (x.ownerPct ?? 0))}%`} sen={x.managementShare} sub />
            {x.agentShare > 0 && <Row label="Agent" sen={x.agentShare} sub />}
            {x.guarantee > 0 && <Row label={x.topUp > 0 ? `Below the ${rm(x.guarantee)} minimum: company tops up` : `Above the ${rm(x.guarantee)} minimum: no top-up`} sen={x.topUp} />}
            {x.adjustments !== 0 && <Row label="Owner credits & charges" sen={x.adjustments} />}
            <Row label="Net payout to owner" sen={x.netPayout} strong />
          </>}
          {x.otherPayers > 0 && <p className="m-0 mt-2 text-meta text-muted-ink">{rm(x.otherPayers)} of costs paid by the company, a tenant or a guest are not on the statement.</p>}
        </div>
      )}
    </Card>
  );
}
