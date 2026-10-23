import { mayWork } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
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
import { rm } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { CloseButton } from '../components/CloseButton';

/** Fabric library — ported from 2990's SCM, drawn in Conts. Upholstery fabric catalogue
 *  with a pricing tier + surcharge. Furniture-specific. */

interface Fabric { id: string; fabricCode: string; label: string; tier: string; defaultSurchargeSen: number; sofaTier: string; bedframeTier: string; active: boolean; sortOrder: number }
interface Payload { data: Fabric[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'fab-std-grey', fabricCode: 'F-STD-GRY', label: 'Standard Grey Weave', tier: 'standard', defaultSurchargeSen: 0, sofaTier: 'T1', bedframeTier: 'T1', active: true, sortOrder: 1 },
    { id: 'fab-prem-navy', fabricCode: 'F-PRM-NVY', label: 'Premium Navy Velvet', tier: 'premium', defaultSurchargeSen: 15000, sofaTier: 'T2', bedframeTier: 'T2', active: true, sortOrder: 2 },
    { id: 'fab-lux-emerald', fabricCode: 'F-LUX-EMR', label: 'Luxe Emerald Bouclé', tier: 'luxury', defaultSurchargeSen: 35000, sofaTier: 'T3', bedframeTier: 'T3', active: true, sortOrder: 3 },
    { id: 'fab-legacy-tan', fabricCode: '', label: 'Legacy Tan Linen', tier: 'standard', defaultSurchargeSen: 0, sofaTier: '', bedframeTier: '', active: false, sortOrder: 9 },
  ],
};
type Draft = Fabric & { isNew: boolean };
const emptyDraft = (): Draft => ({ id: '', fabricCode: '', label: '', tier: 'standard', defaultSurchargeSen: 0, sofaTier: '', bedframeTier: '', active: true, sortOrder: 0, isNew: true });

export default function FabricsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/fabrics', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayWork(user, 'scProcurement');
  const [drawer, setDrawer] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState<Fabric[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Fabric>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => [...added, ...(data?.data ?? [])].filter(f => !removed.has(f.id)).map(f => ({ ...f, ...edits[f.id] }))
    .filter(f => !q || `${f.id} ${f.fabricCode} ${f.label} ${f.tier}`.toLowerCase().includes(q)).sort((a, b) => a.sortOrder - b.sortOrder), [added, data, edits, removed, q]);

  const columns = useMemo<Column<Fabric>[]>(() => [
    { key: 'code', label: 'Code', type: 'ref', value: f => f.fabricCode || f.id, hideable: false },
    { key: 'label', label: 'Label', value: f => f.label, width: 200 },
    { key: 'tier', label: 'Tier', value: f => f.tier, filter: { kind: 'select' },
      render: f => <StatusBadge entity="fabric_tier" value={f.tier} size="sm" /> },
    { key: 'surcharge', label: 'Surcharge', type: 'money', value: f => f.defaultSurchargeSen,
      render: f => f.defaultSurchargeSen ? <span className="tabular-nums whitespace-nowrap">+ {rm(f.defaultSurchargeSen)}</span> : <span className="text-muted-ink">—</span> },
    { key: 'tiers', label: 'Sofa / Bed tier', value: f => [f.sofaTier, f.bedframeTier].filter(Boolean).join(' / ') },
    { key: 'status', label: 'Status', type: 'status', value: f => (f.active ? 'ACTIVE' : 'INACTIVE'), entity: 'active_flag' },
  ], []);

  function save(d: Draft) {
    const body = { id: d.id.trim(), fabricCode: d.fabricCode.trim(), label: d.label.trim(), tier: d.tier.trim() || 'standard', defaultSurchargeSen: d.defaultSurchargeSen, sofaTier: d.sofaTier.trim(), bedframeTier: d.bedframeTier.trim(), active: d.active, sortOrder: d.sortOrder };
    if (d.isNew) { if (!rows.some(x => x.id === body.id)) setAdded(a => [{ ...body }, ...a]); persist(api.post('/fabrics', body), { reload, ok: () => toast({ tone: 'success', title: 'Fabric added.', body: body.label }) }); }
    else { setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } })); persist(api.patch(`/fabrics/${d.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Fabric updated.', body: body.label }) }); }
    setDrawer(null);
  }
  function remove(f: Fabric) { setRemoved(r => new Set(r).add(f.id)); persist(api.del(`/fabrics/${f.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Fabric removed.', body: f.label }) }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Fabric library" sub={data ? `${rows.length} ${rows.length === 1 ? 'fabric' : 'fabrics'} · upholstery catalogue` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New fabric</Button> : undefined} />
      <DataTable<Fabric>
        id="scm.fabrics" columns={columns} rows={data ? rows : null} rowKey={f => f.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? f => setDrawer({ ...f, isNew: false }) : undefined}
        noun={['fabric', 'fabrics']} exportName="fabrics"
        toolbar={<div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fabrics..." aria-label="Search fabrics"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
        </div>}
        filtered={!!q} onClearFilters={() => setSearch('')}
        empty={{ title: 'No fabrics yet.', action: canWrite ? { label: 'New fabric', onClick: () => setDrawer(emptyDraft()) } : undefined }} />
      {drawer && <FabricDrawer draft={drawer} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => { const f = rows.find(x => x.id === drawer.id); if (f) remove(f); }} />}
    </>
  );
}

function FabricDrawer({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const [surchargeSen, setSurchargeSen] = useState<number | null>(draft.defaultSurchargeSen || null);
  const [sortOrder, setSortOrder] = useState<number | null>(draft.sortOrder);
  const canSave = f.id.trim() !== '' && f.label.trim() !== '';
  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{draft.isNew ? 'New fabric' : 'Edit fabric'}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Id (slug)" placeholder="e.g. fab-prem-navy" value={f.id} onChange={set('id')} disabled={!draft.isNew} help={draft.isNew ? undefined : 'Id is fixed once created.'} />
          <Field label="Fabric code" placeholder="e.g. F-PRM-NVY" value={f.fabricCode} onChange={set('fabricCode')} />
          <div className="sm:col-span-2"><Field label="Label" placeholder="e.g. Premium Navy Velvet" value={f.label} onChange={set('label')} /></div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Tier</label>
            <select value={f.tier} onChange={set('tier')} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="standard">Standard</option><option value="premium">Premium</option><option value="luxury">Luxury</option>
            </select>
          </div>
          <MoneyInput label="Surcharge (RM)" valueSen={surchargeSen} onChangeSen={setSurchargeSen} />
          <Field label="Sofa tier" placeholder="e.g. T2" value={f.sofaTier} onChange={set('sofaTier')} />
          <Field label="Bedframe tier" placeholder="e.g. T2" value={f.bedframeTier} onChange={set('bedframeTier')} />
          <NumberInput label="Sort order" grouping={false} allowNegative value={sortOrder} onChange={setSortOrder} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.active ? '1' : '0'} onChange={e => setF(s => ({ ...s, active: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option><option value="0">Inactive</option>
            </select>
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete fabric ${draft.label}?`, body: 'It is deleted for good and drops off the fabric library.', confirmLabel: 'Delete fabric', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an id and a label" onClick={() => onSave({ ...f, defaultSurchargeSen: surchargeSen ?? 0, sortOrder: sortOrder ?? 0 })}>{draft.isNew ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
