import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';

/** Carriers & Rates (Delivery Rate Cards) — ported from 2990's SCM, drawn in Conts. A card is
 *  one carrier's freight tariff; its rules feed the pure pricing engine. Money integer sen. */

type Basis = 'SET' | 'ITEM';
type Agg = 'UNIT' | 'DROP' | 'CUSTOMER' | 'TRIP';
type Rounding = 'NONE' | 'NEAREST_10C' | 'NEAREST_RM';
type RuleType = 'POSITIONAL_TIER' | 'OVERAGE' | 'SOFA_BRACKET' | 'OUTSTATION' | 'OUTSTATION_TRIP' | 'DISPOSE' | 'SETUP' | 'DISMANTLE' | 'SERVICE' | 'PICKUP' | 'INSPECTION' | 'TRANSFER';

interface Rule { id?: string; ruleType: RuleType; tierPosition: number | null; bracketMin: number | null; bracketMax: number | null; zone: string; amountSen: number }
interface RateCard { id: string; name: string; carrierCompanyId: string; carrierLabel: string; carrierName: string; basis: Basis; aggregation: Agg; minChargeSen: number | null; capSen: number | null; rounding: Rounding; isActive: boolean; notes: string; ruleCount: number; rules?: Rule[] }
interface Payload { data: RateCard[]; generatedAt: string }
interface Carrier { id: string; code: string; name: string }

const RULE_LABEL: Record<RuleType, string> = {
  POSITIONAL_TIER: 'Positional tier', OVERAGE: 'Overage cap', SOFA_BRACKET: 'Sofa bracket',
  OUTSTATION: 'Outstation (per drop)', OUTSTATION_TRIP: 'Outstation (per trip)',
  DISPOSE: 'Dispose', SETUP: 'Setup', DISMANTLE: 'Dismantle', SERVICE: 'Service', PICKUP: 'Pickup', INSPECTION: 'Inspection', TRANSFER: 'Transfer',
};
const RULE_TYPES = Object.keys(RULE_LABEL) as RuleType[];
const ZONES = ['KL', 'PJ', 'KLANG', 'KAJANG', 'RAWANG', 'PUCHONG', 'NS', 'MELAKA', 'JOHOR', 'PENANG', 'KEDAH', 'PERAK', 'PAHANG', 'EAST'];
const AGG_LABEL: Record<Agg, string> = { UNIT: 'Per unit (set/item)', DROP: 'Per drop', CUSTOMER: 'Per customer', TRIP: 'Per trip (flat)' };
const ROUND_LABEL: Record<Rounding, string> = { NONE: 'No rounding', NEAREST_10C: 'Nearest 10 sen', NEAREST_RM: 'Nearest RM' };


const FALLBACK: Payload = { generatedAt: '', data: [
  { id: 'rc1', name: 'Own fleet — Klang Valley', carrierCompanyId: '', carrierLabel: 'Own fleet', carrierName: '', basis: 'SET', aggregation: 'UNIT', minChargeSen: 8000, capSen: null, rounding: 'NEAREST_RM', isActive: true, notes: '', ruleCount: 3 },
  { id: 'rc2', name: 'GDEX — outstation', carrierCompanyId: '', carrierLabel: 'GDEX', carrierName: 'GDEX Logistics', basis: 'SET', aggregation: 'DROP', minChargeSen: 15000, capSen: 90000, rounding: 'NONE', isActive: true, notes: '', ruleCount: 5 },
] };
const CARRIERS_FALLBACK: { data: Carrier[] } = { data: [
  { id: 't1', code: '3PL-LALA', name: 'Lalamove Malaysia' }, { id: 't2', code: '3PL-GDEX', name: 'GDEX Logistics' },
] };

export default function RateCardsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/rate-cards', FALLBACK);
  const carriers = useApi<{ data: Carrier[] }>('/threepl-companies?active=1', CARRIERS_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ card: RateCard; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<RateCard[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<RateCard>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(c => !removed.has(c.id)).map(c => ({ ...c, ...edits[c.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(c => !q || `${c.name} ${c.carrierLabel} ${c.carrierName}`.toLowerCase().includes(q));

  const columns = useMemo<Column<RateCard>[]>(() => [
    { key: 'name', label: 'Card', value: c => c.name, hideable: false, render: c => <span className="font-medium">{c.name}</span> },
    { key: 'carrier', label: 'Carrier', value: c => c.carrierName || c.carrierLabel },
    { key: 'charged', label: 'Charged', value: c => `${AGG_LABEL[c.aggregation]}${c.aggregation === 'UNIT' ? ` · ${c.basis === 'ITEM' ? 'item' : 'set'}` : ''}` },
    { key: 'rules', label: 'Rules', type: 'number', value: c => c.ruleCount, width: 80 },
    { key: 'min', label: 'Min', type: 'money', value: c => c.minChargeSen },
    { key: 'cap', label: 'Cap', type: 'money', value: c => c.capSen },
    { key: 'status', label: 'Status', type: 'status', value: c => (c.isActive ? 'active' : 'inactive'), entity: 'active_flag' },
  ], []);

  async function openNew() { setDrawer({ card: { id: '', name: '', carrierCompanyId: '', carrierLabel: '', carrierName: '', basis: 'SET', aggregation: 'UNIT', minChargeSen: null, capSen: null, rounding: 'NONE', isActive: true, notes: '', ruleCount: 0, rules: [] }, isNew: true }); }
  async function openEdit(c: RateCard) {
    let rules = c.rules;
    if (!rules) { try { const r = await api.get<{ data: { rules: Rule[] } }>(`/rate-cards/${c.id}`); rules = r.data.rules; } catch { rules = []; } }
    setDrawer({ card: { ...c, rules: rules ?? [] }, isNew: false });
  }

  function save(card: RateCard, isNew: boolean) {
    const body = { name: card.name, carrierCompanyId: card.carrierCompanyId || null, carrierLabel: card.carrierLabel, basis: card.basis, aggregation: card.aggregation, minChargeSen: card.minChargeSen, capSen: card.capSen, rounding: card.rounding, isActive: card.isActive, notes: card.notes, rules: card.rules ?? [] };
    const ruleCount = (card.rules ?? []).length;
    if (isNew) { setAdded(a => [{ ...card, id: `rc-new-${crypto.randomUUID().slice(0, 8)}`, ruleCount }, ...a]); persist(api.post('/rate-cards', body), { reload, ok: () => toast({ tone: 'success', title: 'Rate card added.', body: card.name }) }); }
    else { setEdits(e => ({ ...e, [card.id]: { ...e[card.id], ...card, ruleCount } })); persist(api.patch(`/rate-cards/${card.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Rate card updated.', body: card.name }) }); }
    setDrawer(null);
  }
  function remove(c: RateCard) { setRemoved(r => new Set(r).add(c.id)); persist(api.del(`/rate-cards/${c.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Rate card removed.', body: c.name }) }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Carriers & rates" sub={data ? `${all.length} ${all.length === 1 ? 'rate card' : 'rate cards'}` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={openNew}>New rate card</Button> : undefined} />
      <DataTable<RateCard>
        id="scm.rate-cards" columns={columns} rows={data ? rows : null} rowKey={c => c.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? c => { void openEdit(c); } : undefined}
        noun={['rate card', 'rate cards']} exportName="rate-cards"
        toolbar={<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rate cards..." aria-label="Search rate cards"
          className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[260px] max-w-full" />}
        filtered={!!q} onClearFilters={() => setSearch('')}
        empty={{ title: 'No rate cards yet.', body: 'Set up a freight tariff per carrier — tiers, sofa brackets, outstation surcharges and the min/cap/rounding envelope.', action: canWrite ? { label: 'New rate card', onClick: () => { void openNew(); } } : undefined }} />
      {drawer && <CardDrawer card={drawer.card} isNew={drawer.isNew} carriers={carriers} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => remove(drawer.card)} />}
    </>
  );
}


function needsTier(t: RuleType) { return t === 'POSITIONAL_TIER' || t === 'OVERAGE'; }
function needsBracket(t: RuleType) { return t === 'SOFA_BRACKET'; }
function needsZone(t: RuleType) { return t === 'OUTSTATION' || t === 'OUTSTATION_TRIP'; }

function CardDrawer({ card, isNew, carriers, onClose, onSave, onDelete }: { card: RateCard; isNew: boolean; carriers: Carrier[]; onClose: () => void; onSave: (c: RateCard, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<RateCard>(card);
  const [rules, setRules] = useState<Rule[]>(card.rules ?? []);
  const set = <K extends keyof RateCard>(k: K, v: RateCard[K]) => setF(s => ({ ...s, [k]: v }));
  const capBelowMin = f.capSen != null && f.minChargeSen != null && f.capSen < f.minChargeSen;
  const canSave = f.name.trim() !== '' && !capBelowMin;

  const addRule = () => setRules(rs => [...rs, { ruleType: 'POSITIONAL_TIER', tierPosition: rs.length + 1, bracketMin: null, bracketMax: null, zone: '', amountSen: 0 }]);
  const setRule = (i: number, patch: Partial<Rule>) => setRules(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const delRule = (i: number) => setRules(rs => rs.filter((_, j) => j !== i));

  return (
    <Drawer open onClose={onClose} width={880}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New rate card' : 'Edit rate card'}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
          <div className="col-span-2 md:col-span-1"><Field label="Card name" placeholder="e.g. Own fleet — KV" value={f.name} onChange={e => set('name', e.target.value)} /></div>
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Carrier</label>
            <select value={f.carrierCompanyId} onChange={e => set('carrierCompanyId', e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Own fleet / none</option>
              {carriers.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </div>
          <Field label="Carrier label" placeholder="Optional" value={f.carrierLabel} onChange={e => set('carrierLabel', e.target.value)} />
          <Sel label="Charged per" value={f.aggregation} onChange={v => set('aggregation', v as Agg)} options={(Object.keys(AGG_LABEL) as Agg[]).map(a => ({ value: a, label: AGG_LABEL[a] }))} />
          <Sel label="Unit basis" value={f.basis} onChange={v => set('basis', v as Basis)} options={[{ value: 'SET', label: 'Set' }, { value: 'ITEM', label: 'Item' }]} />
          <Sel label="Rounding" value={f.rounding} onChange={v => set('rounding', v as Rounding)} options={(Object.keys(ROUND_LABEL) as Rounding[]).map(r => ({ value: r, label: ROUND_LABEL[r] }))} />
          <MoneyInput label="Minimum charge (RM)" placeholder="Optional" valueSen={f.minChargeSen} onChangeSen={n => set('minChargeSen', n)} />
          <MoneyInput label="Charge cap (RM)" placeholder="Optional" valueSen={f.capSen} onChangeSen={n => set('capSen', n)} error={capBelowMin ? 'Cannot be below the minimum charge.' : undefined} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between"><div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Priced rules</div><Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />} onClick={addRule}>Add rule</Button></div>
          <div className="overflow-x-auto border border-solid border-line rounded-card">
            <table className="w-full border-collapse min-w-[720px]">
              <thead><tr className="bg-muted">{['Type', 'Detail', 'Amount (RM)', ''].map((h, i) => <th key={h} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 2 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>
                {rules.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-[12.5px] text-muted-ink">No rules yet. Add tiers, sofa brackets, outstation surcharges or occurrence charges.</td></tr>
                : rules.map((r, i) => (
                  <tr key={i} className="[border-top:1px_solid_var(--color-line-soft)] align-top">
                    <td className="py-2 px-3">
                      <select value={r.ruleType} onChange={e => setRule(i, { ruleType: e.target.value as RuleType })} className="h-8 box-border px-2 py-0 font-sans text-[12.5px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
                        {RULE_TYPES.map(t => <option key={t} value={t}>{RULE_LABEL[t]}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1.5 flex-wrap items-center">
                        {needsTier(r.ruleType) && <NumIn label={r.ruleType === 'OVERAGE' ? 'cap N' : 'position'} value={r.tierPosition} onChange={v => setRule(i, { tierPosition: v })} />}
                        {needsBracket(r.ruleType) && <><NumIn label="min" value={r.bracketMin} onChange={v => setRule(i, { bracketMin: v })} /><NumIn label="max (blank=+)" value={r.bracketMax} onChange={v => setRule(i, { bracketMax: v })} /></>}
                        {needsZone(r.ruleType) && <select value={r.zone} onChange={e => setRule(i, { zone: e.target.value })} className="h-8 box-border px-2 py-0 font-sans text-[12.5px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer"><option value="">zone…</option>{ZONES.map(z => <option key={z} value={z}>{z}</option>)}</select>}
                        {!needsTier(r.ruleType) && !needsBracket(r.ruleType) && !needsZone(r.ruleType) && <span className="text-[12px] text-muted-ink">per occurrence</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right"><MoneyInput aria-label="Amount (RM)" valueSen={r.amountSen || null} onChangeSen={n => setRule(i, { amountSen: n ?? 0 })} className="h-8 w-[100px] box-border px-2 py-0 text-right font-sans text-[12.5px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" /></td>
                    <td className="py-2 px-3 text-right"><button onClick={() => delRule(i)} aria-label="Remove rule" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><Trash2 size={14} strokeWidth={1.75} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Notes" placeholder="Optional" value={f.notes} onChange={e => set('notes', e.target.value)} />
          <Sel label="Status" value={f.isActive ? '1' : '0'} onChange={v => set('isActive', v === '1')} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete rate card ${card.name}?`, body: 'The card and all its rates are deleted for good.', confirmLabel: 'Delete rate card', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason={capBelowMin ? 'Fix the charge cap first' : 'Enter a card name first'} onClick={() => onSave({ ...f, rules }, isNew)}>{isNew ? 'Create card' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}

function NumIn({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return <NumberInput aria-label={label} placeholder={label} min={0} grouping={false} value={value} onChange={onChange}
    className="h-8 w-[96px] box-border px-2 py-0 font-sans text-[12.5px] text-ink bg-card border border-solid border-line rounded-control outline-none" />;
}
function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">{label}</label><select value={value} onChange={e => onChange(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
}
