import { mayRun } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { CloseButton } from '../components/CloseButton';

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
  const canWrite = mayRun(user, 'scWarehouse');
  const [whFilter, setWhFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Rack; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<Rack[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Rack>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(r => !removed.has(r.id)).map(r => ({ ...r, ...edits[r.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => (whFilter === 'all' || r.warehouseId === whFilter) && (!q || `${r.rack} ${r.position}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Rack>[]>(() => [
    { key: 'rack', label: 'Rack / bin', type: 'ref', value: r => r.rack, hideable: false },
    { key: 'warehouse', label: 'Warehouse', value: r => r.warehouseName || r.warehouseCode, filter: { kind: 'select' } },
    { key: 'position', label: 'Position', value: r => r.position },
    { key: 'reserved', label: 'Reserved', type: 'status', align: 'center', width: 120, value: r => (r.reserved ? 'Reserved' : 'Not reserved'), status: r => (r.reserved ? { label: 'Reserved', tone: 'warning' } : null) },
    { key: 'status', label: 'Status', type: 'status', value: r => r.status, entity: 'active_flag' },
  ], []);

  function save(draft: Rack, isNew: boolean) {
    const wh = warehouses.find(w => w.id === draft.warehouseId);
    const withWh = { ...draft, warehouseCode: wh?.code ?? draft.warehouseCode, warehouseName: wh?.name ?? draft.warehouseName };
    if (isNew) { setAdded(a => [{ ...withWh, id: `rk-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); persist(api.post('/racks', draft), { reload, ok: () => toast({ tone: 'success', title: 'Rack added.', body: draft.rack }) }); }
    else { setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...withWh } })); persist(api.patch(`/racks/${draft.id}`, { rack: draft.rack, position: draft.position, status: draft.status, reserved: draft.reserved, notes: draft.notes }), { reload, ok: () => toast({ tone: 'success', title: 'Rack updated.', body: draft.rack }) }); }
    setDrawer(null);
  }
  function remove(r: Rack) { setRemoved(s => new Set(s).add(r.id)); persist(api.del(`/racks/${r.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Rack removed.', body: r.rack }) }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Racks & bins" sub={data ? `${all.length} ${all.length === 1 ? 'rack location' : 'rack locations'}` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyRack(warehouses[0]?.id ?? ''), isNew: true })}>New rack</Button> : undefined} />
      <DataTable<Rack>
        id="scm.racks-bins" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? r => setDrawer({ draft: r, isNew: false }) : undefined}
        noun={['rack', 'racks']} exportName="racks-bins"
        toolbar={<>
          <div className="flex items-center gap-2.5">
            <label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
            <select value={whFilter} onChange={e => setWhFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="all">All warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          </div>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rack / position..." aria-label="Search racks"
            className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
        </>}
        filtered={!!q || whFilter !== 'all'} onClearFilters={() => { setSearch(''); setWhFilter('all'); }}
        empty={{ title: 'No racks yet.', body: 'Map out the rack and bin locations in each warehouse.', action: canWrite ? { label: 'New rack', onClick: () => setDrawer({ draft: emptyRack(warehouses[0]?.id ?? ''), isNew: true }) } : undefined }} />
      {drawer && <RackDrawer draft={drawer.draft} isNew={drawer.isNew} warehouses={warehouses} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => remove(drawer.draft)} />}
    </>
  );
}

function RackDrawer({ draft, isNew, warehouses, onClose, onSave, onDelete }: { draft: Rack; isNew: boolean; warehouses: Wh[]; onClose: () => void; onSave: (d: Rack, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Rack>(draft);
  const canSave = f.warehouseId !== '' && f.rack.trim() !== '';
  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New rack / bin' : 'Edit rack / bin'}</h2><CloseButton onClick={onClose} /></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Warehouse</label>
          <select value={f.warehouseId} disabled={!isNew} onChange={e => setF(s => ({ ...s, warehouseId: e.target.value }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60">
            <option value="">Select a warehouse…</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
