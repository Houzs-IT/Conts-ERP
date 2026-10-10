import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';

/** Warehouses — warehouse master, ported from 2990's SCM and drawn in Conts. Racks
 *  (bin management) are a later Warehouse-ops slice. */

interface Warehouse { id: string; code: string; name: string; location: string; isActive: boolean; isDefault: boolean }
interface Payload { data: Warehouse[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'w1', code: 'WH-MAIN', name: 'Main Warehouse', location: 'Shah Alam, Selangor', isActive: true, isDefault: true },
    { id: 'w2', code: 'WH-KL', name: 'KL Transit Hub', location: 'Kuala Lumpur', isActive: true, isDefault: false },
    { id: 'w3', code: 'WH-JB', name: 'Johor Store', location: 'Johor Bahru', isActive: false, isDefault: false },
  ],
};

type Draft = Warehouse & { isNew: boolean };
const emptyDraft = (): Draft => ({ id: '', code: '', name: '', location: '', isActive: true, isDefault: false, isNew: true });

export default function WarehousesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/warehouses', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [drawer, setDrawer] = useState<Draft | null>(null);
  const [added, setAdded] = useState<Warehouse[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Warehouse>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () => [...added, ...(data?.data ?? [])].filter(w => !removed.has(w.id)).map(w => ({ ...w, ...edits[w.id] }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    [added, data, edits, removed],
  );

  const columns = useMemo<Column<Warehouse>[]>(() => [
    { key: 'code', label: 'Code', type: 'ref', value: w => w.code, hideable: false },
    { key: 'name', label: 'Name', value: w => w.name },
    { key: 'location', label: 'Location', value: w => w.location },
    { key: 'default', label: 'Default', value: w => (w.isDefault ? 'Default' : ''), filter: { kind: 'select' }, width: 110,
      render: w => w.isDefault
        ? <span className="inline-flex items-center text-[12px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--color-gold-50)] text-gold-ink">Default</span>
        : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: w => (w.isActive ? 'ACTIVE' : 'INACTIVE'), status: w => (w.isActive ? { label: 'Active', tone: 'success' } : { label: 'Inactive', tone: 'neutral' }) },
  ], []);

  function save(d: Draft) {
    const body = { code: d.code.trim(), name: d.name.trim(), location: d.location.trim(), isActive: d.isActive, isDefault: d.isDefault };
    // Reflect the single-default rule locally too.
    if (d.isDefault) setEdits(e => { const next = { ...e }; rows.forEach(w => { if (w.id !== d.id) next[w.id] = { ...next[w.id], isDefault: false }; }); return next; });
    if (d.isNew) {
      setAdded(a => [{ ...body, id: `wh-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]);
      api.post('/warehouses', body).catch(notifyFailure);
      toast({ tone: 'success', title: 'Warehouse added.', body: `${body.code} ${body.name}` });
    } else {
      setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } }));
      api.patch(`/warehouses/${d.id}`, body).catch(notifyFailure);
      toast({ tone: 'success', title: 'Warehouse updated.', body: `${body.code} ${body.name}` });
    }
    setDrawer(null);
  }

  function remove(w: Warehouse) {
    setRemoved(r => new Set(r).add(w.id));
    api.del(`/warehouses/${w.id}`).catch(notifyFailure);
    toast({ tone: 'success', title: 'Warehouse removed.', body: w.code });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Warehouses" sub={`${rows.length} warehouses`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New warehouse</Button> : undefined} />

      <DataTable<Warehouse>
        id="scm.warehouses" columns={columns} rows={data ? rows : null} rowKey={w => w.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? w => setDrawer({ ...w, isNew: false }) : undefined}
        noun={['warehouse', 'warehouses']} exportName="warehouses"
        empty={{ title: 'No warehouses yet.', action: canWrite ? { label: 'New warehouse', onClick: () => setDrawer(emptyDraft()) } : undefined }} />

      {drawer && <WarehouseDrawer draft={drawer} onClose={() => setDrawer(null)} onSave={save}
        onDelete={drawer.isNew ? undefined : () => { const w = rows.find(x => x.id === drawer.id); if (w) remove(w); }} />}
    </>
  );
}

function WarehouseDrawer({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const canSave = f.code.trim() !== '' && f.name.trim() !== '';

  return (
    <Drawer open onClose={onClose} width={480}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{draft.isNew ? 'New warehouse' : 'Edit warehouse'}</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Code" placeholder="e.g. WH-MAIN" value={f.code} onChange={set('code')} />
          <Field label="Name" placeholder="Warehouse name" value={f.name} onChange={set('name')} />
          <div className="col-span-2"><Field label="Location" placeholder="Optional" value={f.location} onChange={set('location')} /></div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.isActive ? '1' : '0'} onChange={e => setF(s => ({ ...s, isActive: e.target.value === '1' }))}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Default warehouse</label>
            <select value={f.isDefault ? '1' : '0'} onChange={e => setF(s => ({ ...s, isDefault: e.target.value === '1' }))}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="0">No</option>
              <option value="1">Yes — default</option>
            </select>
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{onDelete && <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Delete</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a code and a name" onClick={() => onSave(f)}>{draft.isNew ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
