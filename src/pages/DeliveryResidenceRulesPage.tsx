import { useMemo, useState } from 'react';
import { Plus, Trash2, X, Check } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { NumberInput, TimeField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';

/** Delivery Residence Rules — ported from 2990's SCM, drawn in Conts. Per-building-type
 *  delivery config the TMS scheduler reads (service duration, time window, lift/registration). */

interface Rule {
  id: string; buildingType: string; serviceDurationMinutes: number; earliestDeliveryTime: string; latestDeliveryTime: string;
  requiresLiftBooking: boolean; requiresRegistration: boolean; notes: string; isActive: boolean;
}
interface Payload { data: Rule[]; generatedAt: string }

const R = (o: Partial<Rule> & Pick<Rule, 'id' | 'buildingType'>): Rule => ({
  serviceDurationMinutes: 60, earliestDeliveryTime: '', latestDeliveryTime: '', requiresLiftBooking: false, requiresRegistration: false, notes: '', isActive: true, ...o,
});
const FALLBACK: Payload = { generatedAt: '', data: [
  R({ id: 'r1', buildingType: 'High-rise condo', serviceDurationMinutes: 90, earliestDeliveryTime: '09:00', latestDeliveryTime: '17:00', requiresLiftBooking: true, requiresRegistration: true }),
  R({ id: 'r2', buildingType: 'Landed / terrace', serviceDurationMinutes: 45, earliestDeliveryTime: '08:00', latestDeliveryTime: '18:00' }),
] };

const dur = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;

export default function DeliveryResidenceRulesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/residence-rules', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Rule; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<Rule[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Rule>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(r => !removed.has(r.id)).map(r => ({ ...r, ...edits[r.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => !q || r.buildingType.toLowerCase().includes(q));

  const columns = useMemo<Column<Rule>[]>(() => [
    { key: 'building', label: 'Building type', value: r => r.buildingType, hideable: false },
    { key: 'service', label: 'Service time', type: 'number', align: 'left', value: r => r.serviceDurationMinutes, render: r => <span className="tabular-nums">{dur(r.serviceDurationMinutes)}</span> },
    { key: 'window', label: 'Delivery window', value: r => (r.earliestDeliveryTime || r.latestDeliveryTime ? `${r.earliestDeliveryTime || '—'} – ${r.latestDeliveryTime || '—'}` : 'Any time') },
    { key: 'lift', label: 'Lift booking', value: r => (r.requiresLiftBooking ? 'Yes' : 'No'), filter: { kind: 'select' }, align: 'center', width: 110, render: r => r.requiresLiftBooking ? <Check size={16} strokeWidth={2} className="inline text-gold-ink" /> : <span className="text-muted-ink">—</span> },
    { key: 'registration', label: 'Registration', value: r => (r.requiresRegistration ? 'Yes' : 'No'), filter: { kind: 'select' }, align: 'center', width: 110, render: r => r.requiresRegistration ? <Check size={16} strokeWidth={2} className="inline text-gold-ink" /> : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: r => (r.isActive ? 'active' : 'inactive'), entity: 'active_flag' },
  ], []);

  function save(draft: Rule, isNew: boolean) {
    if (isNew) { setAdded(a => [R({ ...draft, id: `rr-new-${crypto.randomUUID().slice(0, 8)}` }), ...a]); persist(api.post('/residence-rules', draft), { reload, ok: () => toast({ tone: 'success', title: 'Rule added.', body: draft.buildingType }) }); }
    else { setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...draft } })); persist(api.patch(`/residence-rules/${draft.id}`, draft), { reload, ok: () => toast({ tone: 'success', title: 'Rule updated.', body: draft.buildingType }) }); }
    setDrawer(null);
  }
  function remove(r: Rule) { setRemoved(s => new Set(s).add(r.id)); persist(api.del(`/residence-rules/${r.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Rule removed.', body: r.buildingType }) }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Residence rules" sub={`${all.length} ${all.length === 1 ? 'building-type rule' : 'building-type rules'}`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: R({ id: '', buildingType: '' }), isNew: true })}>New rule</Button> : undefined} />
      <DataTable<Rule>
        id="scm.residence-rules" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? r => setDrawer({ draft: r, isNew: false }) : undefined}
        noun={['rule', 'rules']} exportName="residence-rules"
        toolbar={<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search building type..." aria-label="Search residence rules"
          className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />}
        filtered={!!q} onClearFilters={() => setSearch('')}
        empty={{ title: 'No residence rules yet.', body: 'Set per-building delivery windows and access requirements for the planner.', action: canWrite ? { label: 'New rule', onClick: () => setDrawer({ draft: R({ id: '', buildingType: '' }), isNew: true }) } : undefined }} />
      {drawer && <RuleDrawer draft={drawer.draft} isNew={drawer.isNew} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => remove(drawer.draft)} />}
    </>
  );
}


function RuleDrawer({ draft, isNew, onClose, onSave, onDelete }: { draft: Rule; isNew: boolean; onClose: () => void; onSave: (d: Rule, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Rule>(draft);
  const [minutes, setMinutes] = useState<number | null>(draft.serviceDurationMinutes);
  const windowBackwards = !!f.earliestDeliveryTime && !!f.latestDeliveryTime && f.latestDeliveryTime < f.earliestDeliveryTime;
  const canSave = f.buildingType.trim() !== '' && minutes != null && !windowBackwards;
  const blocker = f.buildingType.trim() === '' ? 'Enter a building type first' : minutes == null ? 'Enter the service duration' : 'Latest delivery cannot be before earliest delivery';
  const check = (k: 'requiresLiftBooking' | 'requiresRegistration') => (
    <label className="flex items-center gap-2.5 cursor-pointer text-[13.5px]">
      <input type="checkbox" checked={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.checked }))} className="w-4 h-4 accent-black cursor-pointer" />
      {k === 'requiresLiftBooking' ? 'Requires lift booking' : 'Requires registration'}
    </label>
  );
  return (
    <Drawer open onClose={onClose} width={560}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New residence rule' : 'Edit residence rule'}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <Field label="Building type" placeholder="e.g. High-rise condo" value={f.buildingType} onChange={e => setF(s => ({ ...s, buildingType: e.target.value }))} />
        <NumberInput label="Service duration (minutes)" required min={0} suffix="min" value={minutes} onChange={setMinutes} error={minutes == null ? 'Enter the service duration.' : undefined} />
        <div className="grid grid-cols-2 gap-3.5">
          <TimeField label="Earliest delivery" value={f.earliestDeliveryTime} onChange={v => setF(s => ({ ...s, earliestDeliveryTime: v }))} />
          <TimeField label="Latest delivery" min={f.earliestDeliveryTime || undefined} value={f.latestDeliveryTime} onChange={v => setF(s => ({ ...s, latestDeliveryTime: v }))} />
        </div>
        <div className="flex flex-col gap-2.5 py-1">{check('requiresLiftBooking')}{check('requiresRegistration')}</div>
        <Field label="Notes" placeholder="Optional" value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} />
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Status</label>
          <select value={f.isActive ? '1' : '0'} onChange={e => setF(s => ({ ...s, isActive: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="1">Active</option><option value="0">Inactive</option>
          </select>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete the ${draft.buildingType} rule?`, body: 'It is deleted for good and drops off the residence rules list.', confirmLabel: 'Delete rule', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason={blocker} onClick={() => onSave({ ...f, serviceDurationMinutes: minutes ?? 0 }, isNew)}>{isNew ? 'Add rule' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
