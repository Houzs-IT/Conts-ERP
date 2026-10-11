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

/** Categories — the product-category display master (label, icon, sort), ported from
 *  2990's SCM and drawn in Conts. */

interface Category { id: string; label: string; icon: string; tbc: boolean; heroImageKey: string; sortOrder: number }
interface Payload { data: Category[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'sofa', label: 'Sofa', icon: 'sofa', tbc: false, heroImageKey: '', sortOrder: 1 },
    { id: 'bedframe', label: 'Bedframe', icon: 'bed', tbc: false, heroImageKey: '', sortOrder: 2 },
    { id: 'mattress', label: 'Mattress', icon: 'bed-double', tbc: false, heroImageKey: '', sortOrder: 3 },
    { id: 'dining', label: 'Dining', icon: 'utensils', tbc: false, heroImageKey: '', sortOrder: 4 },
    { id: 'accessory', label: 'Accessory', icon: 'lamp', tbc: true, heroImageKey: '', sortOrder: 5 },
  ],
};

type Draft = Category & { isNew: boolean };
const emptyDraft = (): Draft => ({ id: '', label: '', icon: '', tbc: false, heroImageKey: '', sortOrder: 0, isNew: true });

export default function CategoriesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/categories', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [drawer, setDrawer] = useState<Draft | null>(null);
  const [added, setAdded] = useState<Category[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Category>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const rows = useMemo(
    () => [...added, ...(data?.data ?? [])].filter(c => !removed.has(c.id)).map(c => ({ ...c, ...edits[c.id] })).sort((a, b) => a.sortOrder - b.sortOrder),
    [added, data, edits, removed],
  );

  const columns = useMemo<Column<Category>[]>(() => [
    { key: 'sort', label: 'Sort', type: 'number', value: c => c.sortOrder, width: 80 },
    { key: 'id', label: 'Id', type: 'ref', value: c => c.id, hideable: false },
    { key: 'label', label: 'Label', value: c => c.label },
    { key: 'icon', label: 'Icon', value: c => c.icon },
    { key: 'status', label: 'Status', type: 'status', value: c => (c.tbc ? 'To confirm' : 'Confirmed'), status: c => (c.tbc ? { label: 'To confirm', tone: 'warning' } : null) },
  ], []);

  function save(d: Draft) {
    const body = { id: d.id.trim(), label: d.label.trim(), icon: d.icon.trim(), tbc: d.tbc, heroImageKey: d.heroImageKey.trim(), sortOrder: d.sortOrder };
    if (d.isNew) {
      setAdded(a => [{ ...body }, ...a]);
      persist(api.post('/categories', body), { reload, ok: () => toast({ tone: 'success', title: 'Category added.', body: body.label }) });
    } else {
      setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } }));
      persist(api.patch(`/categories/${d.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Category updated.', body: body.label }) });
    }
    setDrawer(null);
  }

  function remove(c: Category) {
    setRemoved(r => new Set(r).add(c.id));
    persist(api.del(`/categories/${c.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Category removed.', body: c.label }) });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Categories" sub={`${rows.length} product categories`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New category</Button> : undefined} />

      <DataTable<Category>
        id="scm.categories" columns={columns} rows={data ? rows : null} rowKey={c => c.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? c => setDrawer({ ...c, isNew: false }) : undefined}
        noun={['category', 'categories']} exportName="categories"
        empty={{ title: 'No categories yet.', action: canWrite ? { label: 'New category', onClick: () => setDrawer(emptyDraft()) } : undefined }} />

      {drawer && <CategoryDrawer draft={drawer} onClose={() => setDrawer(null)} onSave={save}
        onDelete={drawer.isNew ? undefined : () => { const c = rows.find(x => x.id === drawer.id); if (c) remove(c); }} />}
    </>
  );
}

function CategoryDrawer({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const [sortOrder, setSortOrder] = useState<number | null>(draft.sortOrder);
  const canSave = f.id.trim() !== '' && f.label.trim() !== '' && f.icon.trim() !== '';

  return (
    <Drawer open onClose={onClose} width={480}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{draft.isNew ? 'New category' : 'Edit category'}</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Id (slug)" placeholder="e.g. sofa" value={f.id} onChange={set('id')} disabled={!draft.isNew} help={draft.isNew ? undefined : 'Id is fixed once created.'} />
          <NumberInput label="Sort order" grouping={false} allowNegative value={sortOrder} onChange={setSortOrder} />
          <Field label="Label" placeholder="e.g. Sofa" value={f.label} onChange={set('label')} />
          <Field label="Icon name" placeholder="lucide icon, e.g. sofa" value={f.icon} onChange={set('icon')} />
          <div className="col-span-2"><Field label="Hero image key" placeholder="Optional" value={f.heroImageKey} onChange={set('heroImageKey')} /></div>
          <div className="col-span-2 flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">To be confirmed</label>
            <select value={f.tbc ? '1' : '0'} onChange={e => setF(s => ({ ...s, tbc: e.target.value === '1' }))}
              className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="0">Confirmed</option>
              <option value="1">To confirm (placeholder)</option>
            </select>
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete category ${draft.label}?`, body: 'It is deleted for good and drops off the category list.', confirmLabel: 'Delete category', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an id, label and icon" onClick={() => onSave({ ...f, sortOrder: sortOrder ?? 0 })}>{draft.isNew ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
