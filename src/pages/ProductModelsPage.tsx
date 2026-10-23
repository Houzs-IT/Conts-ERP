import { mayRun } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { CloseButton } from '../components/CloseButton';

/** Product Models — model master, ported from 2990's SCM (logic) and drawn in Conts.
 *  A model groups SKUs of one design. The deep variant/allowed-options editor is a
 *  later slice (Variants tier); this is the model master. */

type Category = 'SOFA' | 'BEDFRAME' | 'ACCESSORY' | 'MATTRESS' | 'BEDLINES' | 'DINING' | 'DIFFUSER' | 'CARPET' | 'SERVICE';
const CATEGORIES: Category[] = ['SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'BEDLINES', 'DINING', 'DIFFUSER', 'CARPET', 'SERVICE'];
const CAT_LABEL: Record<Category, string> = {
  SOFA: 'Sofa', BEDFRAME: 'Bedframe', ACCESSORY: 'Accessory', MATTRESS: 'Mattress',
  BEDLINES: 'Bedlines', DINING: 'Dining', DIFFUSER: 'Diffuser', CARPET: 'Carpet', SERVICE: 'Service',
};

interface Model {
  id: string; modelCode: string; name: string; category: Category;
  branding: string; description: string; photoUrl: string; active: boolean;
}
interface Payload { data: Model[]; generatedAt: string }

const M = (o: Partial<Model> & Pick<Model, 'id' | 'modelCode' | 'name' | 'category'>): Model => ({
  branding: '', description: '', photoUrl: '', active: true, ...o,
});

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    M({ id: 'm1', modelCode: 'EMMA', name: 'Emma Sofa', category: 'SOFA', branding: '', description: 'Modular fabric sofa family' }),
    M({ id: 'm2', modelCode: 'NORDIC', name: 'Nordic Bedframe', category: 'BEDFRAME', description: 'Oak slat bedframe' }),
    M({ id: 'm3', modelCode: 'HILTON', name: 'Hilton Mattress', category: 'MATTRESS', branding: 'HILTON', description: 'Pocket-spring mattress' }),
    M({ id: 'm4', modelCode: 'OSLO', name: 'Oslo Dining Set', category: 'DINING', description: 'Solid oak dining range' }),
    M({ id: 'm5', modelCode: 'LEGACY-01', name: 'Legacy Console', category: 'ACCESSORY', description: 'Discontinued', active: false }),
  ],
};

type Draft = Model;
const emptyDraft = (): Draft => M({ id: '', modelCode: '', name: '', category: 'SOFA' });

export default function ProductModelsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/product-models', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayRun(user, 'scProcurement');

  const [cat, setCat] = useState<'all' | Category>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Draft; isNew: boolean } | null>(null);

  const [added, setAdded] = useState<Model[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Model>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(
    () => [...added, ...(data?.data ?? [])].filter(m => !removed.has(m.id)).map(m => ({ ...m, ...edits[m.id] })),
    [added, data, edits, removed],
  );

  const q = search.trim().toLowerCase();
  const rows = all.filter(m =>
    (cat === 'all' || m.category === cat) &&
    (!q || `${m.modelCode} ${m.name} ${m.branding}`.toLowerCase().includes(q)),
  );

  const columns = useMemo<Column<Model>[]>(() => [
    { key: 'code', label: 'Model code', type: 'ref', value: m => m.modelCode, hideable: false },
    { key: 'name', label: 'Name', value: m => m.name },
    { key: 'category', label: 'Category', value: m => m.category, text: m => CAT_LABEL[m.category], filter: { kind: 'select' },
      render: m => <span className="inline-block text-[11px] font-semibold uppercase tracking-[0.06em] bg-[var(--color-gold-50)] text-gold-ink px-2.5 py-0.5 rounded-full">{CAT_LABEL[m.category]}</span> },
    { key: 'branding', label: 'Branding', value: m => m.branding },
    { key: 'status', label: 'Status', type: 'status', value: m => (m.active ? 'ACTIVE' : 'INACTIVE'), entity: 'active_flag' },
  ], []);

  function save(d: Draft, isNew: boolean) {
    const body = { modelCode: d.modelCode.trim(), name: d.name.trim(), category: d.category, branding: d.branding.trim(), description: d.description.trim(), photoUrl: d.photoUrl.trim(), active: d.active };
    if (isNew) {
      setAdded(a => [M({ ...body, id: `pmdl-new-${crypto.randomUUID().slice(0, 8)}` }), ...a]);
      persist(api.post('/product-models', body), { reload, ok: () => toast({ tone: 'success', title: 'Model added.', body: `${body.modelCode} ${body.name}` }) });
    } else {
      setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } }));
      persist(api.patch(`/product-models/${d.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Model updated.', body: `${body.modelCode} ${body.name}` }) });
    }
    setDrawer(null);
  }

  function remove(m: Model) {
    setRemoved(r => new Set(r).add(m.id));
    persist(api.del(`/product-models/${m.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Model removed.', body: m.modelCode }) });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader
        title="Product models"
        sub={data ? `${all.length} ${all.length === 1 ? 'model' : 'models'} · groups SKUs of one design` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyDraft(), isNew: true })}>New model</Button> : undefined}
      />

      <DataTable<Model>
        id="scm.product-models" columns={columns} rows={data ? rows : null} rowKey={m => m.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? m => setDrawer({ draft: { ...m }, isNew: false }) : undefined}
        noun={['model', 'models']} exportName="product-models"
        toolbar={<>
          <Segmented label="Category" options={[{ key: 'all' as const, label: 'All' }, ...CATEGORIES.map(c => ({ key: c, label: CAT_LABEL[c] }))]} value={cat} onChange={setCat} />
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models..." aria-label="Search models"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
          </div>
        </>}
        filtered={!!q || cat !== 'all'} onClearFilters={() => { setSearch(''); setCat('all'); }}
        empty={{ title: 'No models yet.', body: 'A model groups the SKUs of one design — add one to start.', action: canWrite ? { label: 'New model', onClick: () => setDrawer({ draft: emptyDraft(), isNew: true }) } : undefined }} />

      {drawer && <ModelDrawer draft={drawer.draft} isNew={drawer.isNew} onClose={() => setDrawer(null)} onSave={save}
        onDelete={drawer.isNew ? undefined : () => { const m = all.find(x => x.id === drawer.draft.id); if (m) remove(m); }} />}
    </>
  );
}

/* ---------- primitives ---------- */


/* ---------- New / Edit drawer ---------- */

function ModelDrawer({ draft, isNew, onClose, onSave, onDelete }: { draft: Draft; isNew: boolean; onClose: () => void; onSave: (d: Draft, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const canSave = f.modelCode.trim() !== '' && f.name.trim() !== '';

  return (
    <Drawer open onClose={onClose} width={560}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New model' : 'Edit model'}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Model code" placeholder="e.g. EMMA" value={f.modelCode} onChange={set('modelCode')} />
          <Field label="Name" placeholder="Model name" value={f.name} onChange={set('name')} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Category</label>
            <select value={f.category} onChange={set('category')}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.active ? '1' : '0'} onChange={e => setF(s => ({ ...s, active: e.target.value === '1' }))}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
          <Field label="Branding" placeholder="Optional" value={f.branding} onChange={set('branding')} />
          <Field label="Photo URL" placeholder="Optional" value={f.photoUrl} onChange={set('photoUrl')} />
          <div className="sm:col-span-2"><Field label="Description" placeholder="Optional" value={f.description} onChange={set('description')} /></div>
        </div>
        <p className="mt-4 text-[12px] text-muted-ink">Variant options (fabrics, sizes, compartments) are edited in the Variants tab — coming in a later slice.</p>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete model ${draft.modelCode}?`, body: 'It is deleted for good and drops off the model list.', confirmLabel: 'Delete model', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a model code and a name first" onClick={() => onSave(f, isNew)}>{isNew ? 'Create model' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
