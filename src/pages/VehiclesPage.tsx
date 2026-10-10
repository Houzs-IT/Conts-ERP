import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';

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

  const rows = useMemo(() => [...added, ...(data?.data ?? [])].filter(v => !removed.has(v.id)).map(v => ({ ...v, ...edits[v.id] })), [added, data, edits, removed]);

  function save(d: Draft) {
    const body = { code: d.code.trim(), plate: d.plate.trim(), vehicleType: d.vehicleType.trim(), capacityM3Milli: d.capacityM3Milli, active: d.active, notes: d.notes.trim() };
    if (d.isNew) { setAdded(a => [{ ...body, id: `veh-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); api.post('/vehicles', body).catch(notifyFailure); toast({ tone: 'success', title: 'Vehicle added.', body: body.code }); }
    else { setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } })); api.patch(`/vehicles/${d.id}`, body).catch(notifyFailure); toast({ tone: 'success', title: 'Vehicle updated.', body: body.code }); }
    setDrawer(null);
  }
  function remove(v: Vehicle) { setRemoved(r => new Set(r).add(v.id)); api.del(`/vehicles/${v.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Vehicle removed.', body: v.code }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Vehicles" sub={`${rows.length} vehicles · ${rows.filter(v => v.active).length} active`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New vehicle</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last vehicle list we have. ${error}`} onRetry={reload} />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[620px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line)]">
              {['Code', 'Plate', 'Type', 'Capacity (m³)', 'Status'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 3 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 ? <tr><td colSpan={5}><TableSkeleton rows={5} cols={5} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">No vehicles yet.</div></td></tr>
              : rows.map(v => (
                <tr key={v.id} onClick={() => { if (canWrite) setDrawer({ ...v, isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] bg-muted border border-solid border-line rounded-full px-2.5 py-0.5">{v.code}</span></td>
                  <td className="py-[13px] px-4 text-[13.5px] tabular-nums">{v.plate || '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-[var(--color-ink-2)]">{v.vehicleType || '—'}</td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px]">{v.capacityM3Milli ? (v.capacityM3Milli / 1000).toFixed(1) : '—'}</td>
                  <td className="py-[13px] px-4"><StatusBadge entity="active_flag" value={v.active ? 'active' : 'inactive'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Code" placeholder="e.g. LRY-01" value={f.code} onChange={set('code')} />
          <Field label="Plate" value={f.plate} onChange={set('plate')} />
          <Field label="Type" placeholder="e.g. 3-tonne lorry" value={f.vehicleType} onChange={set('vehicleType')} />
          <Field label="Capacity (m³)" type="number" numeric step="0.1" value={f.capacityM3Milli ? String(f.capacityM3Milli / 1000) : ''} onChange={e => setF(s => ({ ...s, capacityM3Milli: e.target.value.trim() ? Math.round(Number(e.target.value) * 1000) : 0 }))} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.active ? '1' : '0'} onChange={e => setF(s => ({ ...s, active: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option><option value="0">Inactive</option>
            </select>
          </div>
          <div className="col-span-2"><Field label="Notes" placeholder="Optional" value={f.notes} onChange={set('notes')} /></div>
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
