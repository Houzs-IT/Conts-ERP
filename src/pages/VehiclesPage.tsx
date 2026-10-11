import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { NumberInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { CloseButton } from '../components/CloseButton';

/** Vehicles master — the delivery fleet, drawn in Conts. Capacity is stored in milli-m3. */

interface Vehicle { id: string; code: string; plate: string; vehicleType: string; capacityM3Milli: number; active: boolean; notes: string }
interface Payload { data: Vehicle[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'v1', code: 'LRY-01', plate: 'WXY 1234', vehicleType: '1-tonne lorry', capacityM3Milli: 8000, active: true, notes: '' },
    { id: 'v2', code: 'LRY-02', plate: 'VBA 8890', vehicleType: '3-tonne lorry', capacityM3Milli: 18000, active: true, notes: '' },
    { id: 'v3', code: 'VAN-01', plate: 'BKL 2201', vehicleType: 'Panel van', capacityM3Milli: 4000, active: false, notes: 'Under repair' },
  ],
};
type Draft = Vehicle & { isNew: boolean };
const emptyDraft = (): Draft => ({ id: '', code: '', plate: '', vehicleType: '', capacityM3Milli: 0, active: true, notes: '', isNew: true });

export default function VehiclesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/vehicles', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [drawer, setDrawer] = useState<Draft | null>(null);
  const [added, setAdded] = useState<Vehicle[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Vehicle>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const rows = useMemo(() => [...added, ...(data?.data ?? [])].filter(v => !removed.has(v.id)).map(v => ({ ...v, ...edits[v.id] })), [added, data, edits, removed]);

  const columns = useMemo<Column<Vehicle>[]>(() => [
    { key: 'code', label: 'Code', type: 'ref', value: v => v.code, hideable: false },
    { key: 'plate', label: 'Plate', value: v => v.plate || null },
    { key: 'type', label: 'Type', value: v => v.vehicleType || null },
    { key: 'capacity', label: 'Capacity (m³)', type: 'number', value: v => v.capacityM3Milli ? v.capacityM3Milli / 1000 : null, render: v => <span className="tabular-nums">{v.capacityM3Milli ? (v.capacityM3Milli / 1000).toFixed(1) : '—'}</span> },
    { key: 'status', label: 'Status', type: 'status', value: v => (v.active ? 'ACTIVE' : 'INACTIVE'), entity: 'active_flag' },
  ], []);

  function save(d: Draft) {
    const body = { code: d.code.trim(), plate: d.plate.trim(), vehicleType: d.vehicleType.trim(), capacityM3Milli: d.capacityM3Milli, active: d.active, notes: d.notes.trim() };
    if (d.isNew) { setAdded(a => [{ ...body, id: `veh-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); persist(api.post('/vehicles', body), { reload, ok: () => toast({ tone: 'success', title: 'Vehicle added.', body: body.code }) }); }
    else { setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } })); persist(api.patch(`/vehicles/${d.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Vehicle updated.', body: body.code }) }); }
    setDrawer(null);
  }
  function remove(v: Vehicle) { setRemoved(r => new Set(r).add(v.id)); persist(api.del(`/vehicles/${v.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Vehicle removed.', body: v.code }) }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Vehicles" sub={data ? `${rows.length} ${rows.length === 1 ? 'vehicle' : 'vehicles'} · ${rows.filter(v => v.active).length} active` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New vehicle</Button> : undefined} />
      <DataTable<Vehicle>
        id="scm.vehicles" columns={columns} rows={data ? rows : null} rowKey={v => v.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? v => setDrawer({ ...v, isNew: false }) : undefined}
        noun={['vehicle', 'vehicles']} exportName="vehicles"
        empty={{ title: 'No vehicles yet.', body: 'Add the lorries and vans in your delivery fleet.', action: canWrite ? { label: 'New vehicle', onClick: () => setDrawer(emptyDraft()) } : undefined }} />
      {drawer && <VehicleDrawer draft={drawer} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => { const v = rows.find(x => x.id === drawer.id); if (v) remove(v); }} />}
    </>
  );
}

function VehicleDrawer({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const canSave = f.code.trim() !== '';
  return (
    <Drawer open onClose={onClose} width={480}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{draft.isNew ? 'New vehicle' : 'Edit vehicle'}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Code" placeholder="e.g. LRY-01" value={f.code} onChange={set('code')} />
          <Field label="Plate" value={f.plate} onChange={set('plate')} />
          <Field label="Type" placeholder="e.g. 3-tonne lorry" value={f.vehicleType} onChange={set('vehicleType')} />
          <NumberInput label="Capacity (m³)" min={0} decimals={3} value={f.capacityM3Milli ? f.capacityM3Milli / 1000 : null} onChange={n => setF(s => ({ ...s, capacityM3Milli: n == null ? 0 : Math.round(n * 1000) }))} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.active ? '1' : '0'} onChange={e => setF(s => ({ ...s, active: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option><option value="0">Inactive</option>
            </select>
          </div>
          <div className="sm:col-span-2"><Field label="Notes" placeholder="Optional" value={f.notes} onChange={set('notes')} /></div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete vehicle ${draft.code}?`, body: 'It is deleted for good and drops off the vehicle list.', confirmLabel: 'Delete vehicle', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a code" onClick={() => onSave(f)}>{draft.isNew ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
