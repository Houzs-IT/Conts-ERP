import { useMemo, useState } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
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
import { rm } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

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
const TIER_TONE: Record<string, 'neutral' | 'info' | 'success'> = { standard: 'neutral', premium: 'info', luxury: 'success' };

export default function FabricsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/fabrics', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [drawer, setDrawer] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState<Fabric[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Fabric>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => [...added, ...(data?.data ?? [])].filter(f => !removed.has(f.id)).map(f => ({ ...f, ...edits[f.id] }))
    .filter(f => !q || `${f.id} ${f.fabricCode} ${f.label} ${f.tier}`.toLowerCase().includes(q)).sort((a, b) => a.sortOrder - b.sortOrder), [added, data, edits, removed, q]);

  function save(d: Draft) {
    const body = { id: d.id.trim(), fabricCode: d.fabricCode.trim(), label: d.label.trim(), tier: d.tier.trim() || 'standard', defaultSurchargeSen: d.defaultSurchargeSen, sofaTier: d.sofaTier.trim(), bedframeTier: d.bedframeTier.trim(), active: d.active, sortOrder: d.sortOrder };
    if (d.isNew) { setAdded(a => [{ ...body }, ...a]); api.post('/fabrics', body).catch(notifyFailure); toast({ tone: 'success', title: 'Fabric added.', body: body.label }); }
    else { setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } })); api.patch(`/fabrics/${d.id}`, body).catch(notifyFailure); toast({ tone: 'success', title: 'Fabric updated.', body: body.label }); }
    setDrawer(null);
  }
  function remove(f: Fabric) { setRemoved(r => new Set(r).add(f.id)); api.del(`/fabrics/${f.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Fabric removed.', body: f.label }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Fabric library" sub={`${rows.length} fabrics · upholstery catalogue`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New fabric</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last fabric list we have. ${error}`} onRetry={reload} />}
      <div className="flex justify-end">
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fabrics..." aria-label="Search fabrics"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Code', 'Label', 'Tier', 'Surcharge', 'Sofa / Bed tier', 'Status'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 3 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={5} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">No fabrics yet.</div></td></tr>
              : rows.map(f => (
                <tr key={f.id} onClick={() => { if (canWrite) setDrawer({ ...f, isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[12.5px] text-muted-ink">{f.fabricCode || f.id}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{f.label}</td>
                  <td className="py-[13px] px-4"><span className={cx('inline-block text-[11px] font-semibold uppercase tracking-[0.06em] px-2.5 py-0.5 rounded-full', TONE[TIER_TONE[f.tier] ?? 'neutral'].bg, TONE[TIER_TONE[f.tier] ?? 'neutral'].text)}>{f.tier}</span></td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px]">{f.defaultSurchargeSen ? `+ ${rm(f.defaultSurchargeSen)}` : '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-[var(--color-ink-2)]">{[f.sofaTier, f.bedframeTier].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="py-[13px] px-4"><ActivePill active={f.active} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <FabricDrawer draft={drawer} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => { const f = rows.find(x => x.id === drawer.id); if (f) remove(f); }} />}
    </>
  );
}

function ActivePill({ active }: { active: boolean }) {
  const t = active ? TONE.success : TONE.neutral;
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', t.bg, t.text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{active ? 'Active' : 'Inactive'}</span>;
}

function FabricDrawer({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const canSave = f.id.trim() !== '' && f.label.trim() !== '';
  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{draft.isNew ? 'New fabric' : 'Edit fabric'}</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Id (slug)" placeholder="e.g. fab-prem-navy" value={f.id} onChange={set('id')} disabled={!draft.isNew} help={draft.isNew ? undefined : 'Id is fixed once created.'} />
          <Field label="Fabric code" placeholder="e.g. F-PRM-NVY" value={f.fabricCode} onChange={set('fabricCode')} />
          <div className="col-span-2"><Field label="Label" placeholder="e.g. Premium Navy Velvet" value={f.label} onChange={set('label')} /></div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Tier</label>
            <select value={f.tier} onChange={set('tier')} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="standard">Standard</option><option value="premium">Premium</option><option value="luxury">Luxury</option>
            </select>
          </div>
          <Field label="Surcharge (RM)" type="number" numeric step="0.01" value={f.defaultSurchargeSen ? String(f.defaultSurchargeSen / 100) : ''} onChange={e => setF(s => ({ ...s, defaultSurchargeSen: e.target.value.trim() ? Math.round(Number(e.target.value) * 100) : 0 }))} />
          <Field label="Sofa tier" placeholder="e.g. T2" value={f.sofaTier} onChange={set('sofaTier')} />
          <Field label="Bedframe tier" placeholder="e.g. T2" value={f.bedframeTier} onChange={set('bedframeTier')} />
          <Field label="Sort order" type="number" numeric value={String(f.sortOrder)} onChange={e => setF(s => ({ ...s, sortOrder: Math.round(Number(e.target.value) || 0) }))} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.active ? '1' : '0'} onChange={e => setF(s => ({ ...s, active: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option><option value="0">Inactive</option>
            </select>
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{onDelete && <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Delete</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter an id and a label" onClick={() => onSave(f)}>{draft.isNew ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
