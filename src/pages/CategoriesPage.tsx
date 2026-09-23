import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { TONE, cx } from '../lib/design-tokens';

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

  const rows = useMemo(
    () => [...added, ...(data?.data ?? [])].filter(c => !removed.has(c.id)).map(c => ({ ...c, ...edits[c.id] })).sort((a, b) => a.sortOrder - b.sortOrder),
    [added, data, edits, removed],
  );

  function save(d: Draft) {
    const body = { id: d.id.trim(), label: d.label.trim(), icon: d.icon.trim(), tbc: d.tbc, heroImageKey: d.heroImageKey.trim(), sortOrder: d.sortOrder };
    if (d.isNew) {
      setAdded(a => [{ ...body }, ...a]);
      api.post('/categories', body).catch(notifyFailure);
      toast({ tone: 'success', title: 'Category added.', body: body.label });
    } else {
      setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } }));
      api.patch(`/categories/${d.id}`, body).catch(notifyFailure);
      toast({ tone: 'success', title: 'Category updated.', body: body.label });
    }
    setDrawer(null);
  }

  function remove(c: Category) {
    setRemoved(r => new Set(r).add(c.id));
    api.del(`/categories/${c.id}`).catch(notifyFailure);
    toast({ tone: 'success', title: 'Category removed.', body: c.label });
    setDrawer(null);
  }

  return (
    <>
      <PageHeader title="Categories" sub={`${rows.length} product categories`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New category</Button> : undefined} />

      {error && <StaleBanner message={`Showing the last category list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[560px]">
            <thead>
              <tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['Sort', 'Id', 'Label', 'Icon', 'Status'].map(h => (
                  <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={5}><TableSkeleton rows={5} cols={5} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">No categories yet.</div></td></tr>
              ) : rows.map(c => (
                <tr key={c.id} onClick={() => { if (canWrite) setDrawer({ ...c, isNew: false }); }}
                  className={cx('[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4 text-[13px] tabular-nums text-muted-ink">{c.sortOrder}</td>
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] bg-muted border border-solid border-line rounded-full px-2.5 py-0.5">{c.id}</span></td>
                  <td className="py-[13px] px-4 text-[13.5px]">{c.label}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-[var(--color-ink-2)]">{c.icon}</td>
                  <td className="py-[13px] px-4">{c.tbc
                    ? <span className={cx('inline-flex items-center text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE.warning.bg, TONE.warning.text)}>To confirm</span>
                    : <span className="text-[12.5px] text-muted-ink">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {drawer && <CategoryDrawer draft={drawer} onClose={() => setDrawer(null)} onSave={save}
        onDelete={drawer.isNew ? undefined : () => { const c = rows.find(x => x.id === drawer.id); if (c) remove(c); }} />}
    </>
  );
}

function CategoryDrawer({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
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
          <Field label="Sort order" type="number" numeric value={String(f.sortOrder)} onChange={e => setF(s => ({ ...s, sortOrder: Math.round(Number(e.target.value) || 0) }))} />
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
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{onDelete && <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Delete</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an id, label and icon" onClick={() => onSave(f)}>{draft.isNew ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
