import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
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

/** Racks & Bins — ported from 2990's SCM (warehouse_racks), drawn in Conts. Rack/bin location
 *  master inside a warehouse. */

interface Rack { id: string; warehouseId: string; rack: string; position: string; status: 'ACTIVE' | 'INACTIVE'; reserved: boolean; notes: string; warehouseCode: string; warehouseName: string }
interface Payload { data: Rack[]; generatedAt: string }
interface Wh { id: string; code: string; name: string }

const WH_FALLBACK: { data: Wh[] } = { data: [
  { id: 'wh1', code: 'WH-MAIN', name: 'Main Warehouse' }, { id: 'wh2', code: 'WH-KL', name: 'KL Showroom Store' },
] };
const FALLBACK: Payload = { generatedAt: '', data: [
  { id: 'k1', warehouseId: 'wh1', rack: 'A-01', position: 'Aisle A, level 1', status: 'ACTIVE', reserved: false, notes: '', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse' },
  { id: 'k2', warehouseId: 'wh1', rack: 'A-02', position: 'Aisle A, level 2', status: 'ACTIVE', reserved: true, notes: 'Reserved for sofas', warehouseCode: 'WH-MAIN', warehouseName: 'Main Warehouse' },
] };

const emptyRack = (whId: string): Rack => ({ id: '', warehouseId: whId, rack: '', position: '', status: 'ACTIVE', reserved: false, notes: '', warehouseCode: '', warehouseName: '' });

export default function RacksBinsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/racks', FALLBACK);
  const warehouses = useApi<{ data: Wh[] }>('/warehouses', WH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [whFilter, setWhFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Rack; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<Rack[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Rack>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(r => !removed.has(r.id)).map(r => ({ ...r, ...edits[r.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => (whFilter === 'all' || r.warehouseId === whFilter) && (!q || `${r.rack} ${r.position}`.toLowerCase().includes(q)));

  function save(draft: Rack, isNew: boolean) {
    const wh = warehouses.find(w => w.id === draft.warehouseId);
    const withWh = { ...draft, warehouseCode: wh?.code ?? draft.warehouseCode, warehouseName: wh?.name ?? draft.warehouseName };
    if (isNew) { setAdded(a => [{ ...withWh, id: `rk-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); api.post('/racks', draft).catch(notifyFailure); toast({ tone: 'success', title: 'Rack added.', body: draft.rack }); }
    else { setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...withWh } })); api.patch(`/racks/${draft.id}`, { rack: draft.rack, position: draft.position, status: draft.status, reserved: draft.reserved, notes: draft.notes }).catch(notifyFailure); toast({ tone: 'success', title: 'Rack updated.', body: draft.rack }); }
    setDrawer(null);
  }
  function remove(r: Rack) { setRemoved(s => new Set(s).add(r.id)); api.del(`/racks/${r.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Rack removed.', body: r.rack }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Racks & bins" sub={`${all.length} rack locations`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyRack(warehouses[0]?.id ?? ''), isNew: true })}>New rack</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last racks we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="all">All warehouses</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rack / position..." aria-label="Search racks"
          className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line)]">
              {['Rack / bin', 'Warehouse', 'Position', 'Reserved', 'Status'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 3 ? 'text-center' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={5}><TableSkeleton rows={6} cols={5} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">{q || whFilter !== 'all' ? 'No racks match.' : 'No racks yet.'}</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Map out the rack and bin locations in each warehouse.</span></div></td></tr>
              : rows.map(r => (
                <tr key={r.id} onClick={() => { if (canWrite) setDrawer({ draft: r, isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold bg-muted border border-solid border-line rounded-full px-2.5 py-0.5">{r.rack}</span></td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{r.warehouseName || r.warehouseCode || '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{r.position || '—'}</td>
                  <td className="py-[13px] px-4 text-center">{r.reserved ? <StatusBadge tone="warning" label="Reserved" /> : <span className="text-muted-ink">—</span>}</td>
                  <td className="py-[13px] px-4"><StatusBadge entity="active_flag" value={r.status === 'ACTIVE' ? 'active' : 'inactive'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <RackDrawer draft={drawer.draft} isNew={drawer.isNew} warehouses={warehouses} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => remove(drawer.draft)} />}
    </>
  );
}


function RackDrawer({ draft, isNew, warehouses, onClose, onSave, onDelete }: { draft: Rack; isNew: boolean; warehouses: Wh[]; onClose: () => void; onSave: (d: Rack, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Rack>(draft);
  const canSave = f.warehouseId !== '' && f.rack.trim() !== '';
  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New rack / bin' : 'Edit rack / bin'}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={f.warehouseId} disabled={!isNew} onChange={e => setF(s => ({ ...s, warehouseId: e.target.value }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60">
            <option value="">Select a warehouse…</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Rack / bin code" placeholder="e.g. A-01" value={f.rack} onChange={e => setF(s => ({ ...s, rack: e.target.value }))} />
          <Field label="Position" placeholder="Optional" value={f.position} onChange={e => setF(s => ({ ...s, position: e.target.value }))} />
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer text-[13.5px]"><input type="checkbox" checked={f.reserved} onChange={e => setF(s => ({ ...s, reserved: e.target.checked }))} className="w-4 h-4 accent-black cursor-pointer" />Reserved location</label>
        <Field label="Notes" placeholder="Optional" value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} />
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Status</label>
          <select value={f.status} onChange={e => setF(s => ({ ...s, status: e.target.value as Rack['status'] }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete rack ${draft.rack}?`, body: 'It is deleted for good and drops off the rack list.', confirmLabel: 'Delete rack', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a warehouse and enter a code" onClick={() => onSave(f, isNew)}>{isNew ? 'Add rack' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
