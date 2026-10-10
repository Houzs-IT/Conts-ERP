import { useMemo, useState, type ReactNode } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { PhoneInput, phoneProblem } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { TONE, cx } from '../lib/design-tokens';

/** 3PL Companies — ported from 2990's SCM, drawn in Conts. Third-party logistics providers
 *  that drivers/vehicles can belong to. A master. */

interface ThreePl {
  id: string; code: string; name: string; registrationNo: string; contactName: string; contactPhone: string;
  officePhone: string; email: string; address: string; isActive: boolean; notes: string;
}
interface Payload { data: ThreePl[]; generatedAt: string }

const T = (o: Partial<ThreePl> & Pick<ThreePl, 'id' | 'code' | 'name'>): ThreePl => ({
  registrationNo: '', contactName: '', contactPhone: '', officePhone: '', email: '', address: '', isActive: true, notes: '', ...o,
});
const FALLBACK: Payload = { generatedAt: '', data: [
  T({ id: 't1', code: '3PL-LALA', name: 'Lalamove Malaysia', contactName: 'Ops Desk', contactPhone: '+60322998800', isActive: true }),
  T({ id: 't2', code: '3PL-GDEX', name: 'GDEX Logistics', contactName: 'Mr Lim', contactPhone: '+60312345678', officePhone: '03-1234 5678', isActive: true }),
] };

export default function ThreePLCompaniesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/threepl-companies', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: ThreePl; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<ThreePl[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<ThreePl>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(c => !removed.has(c.id)).map(c => ({ ...c, ...edits[c.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(c => (filter === 'all' || (filter === 'active') === c.isActive) && (!q || `${c.code} ${c.name} ${c.contactName}`.toLowerCase().includes(q)));

  function save(draft: ThreePl, isNew: boolean) {
    if (isNew) { setAdded(a => [T({ ...draft, id: `tpl-new-${crypto.randomUUID().slice(0, 8)}` }), ...a]); api.post('/threepl-companies', draft).catch(notifyFailure); toast({ tone: 'success', title: '3PL company added.', body: `${draft.code} ${draft.name}` }); }
    else { setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...draft } })); api.patch(`/threepl-companies/${draft.id}`, draft).catch(notifyFailure); toast({ tone: 'success', title: '3PL company updated.', body: `${draft.code} ${draft.name}` }); }
    setDrawer(null);
  }
  function remove(c: ThreePl) { setRemoved(r => new Set(r).add(c.id)); api.del(`/threepl-companies/${c.id}`).catch(notifyFailure); toast({ tone: 'success', title: '3PL company removed.', body: c.code }); setDrawer(null); }

  return (
    <>
      <PageHeader title="3PL companies" sub={`${all.length} providers · ${all.filter(c => c.isActive).length} active`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: T({ id: '', code: '', name: '' }), isNew: true })}>New company</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last 3PL list we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {(['all', 'active', 'inactive'] as const).map(f => <Chip key={f} label={f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'} active={filter === f} onClick={() => setFilter(f)} />)}
        </div>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search 3PL companies..." aria-label="Search 3PL companies"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[720px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Code', 'Name', 'Contact', 'Phone', 'Email', 'Status'].map((h) => <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={6} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">{q || filter !== 'all' ? 'No companies match.' : 'No 3PL companies yet.'}</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Add the third-party couriers and hauliers you dispatch through.</span></div></td></tr>
              : rows.map(c => (
                <tr key={c.id} onClick={() => { if (canWrite) setDrawer({ draft: c, isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] bg-muted border border-solid border-line rounded-full px-2.5 py-0.5">{c.code}</span></td>
                  <td className="py-[13px] px-4 text-[13.5px]">{c.name}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{c.contactName || '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink tabular-nums">{c.contactPhone || c.officePhone || '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{c.email || '—'}</td>
                  <td className="py-[13px] px-4"><StatusPill active={c.isActive} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <ThreePlDrawer draft={drawer.draft} isNew={drawer.isNew} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => remove(drawer.draft)} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
function StatusPill({ active }: { active: boolean }) {
  const t = active ? TONE.success : TONE.neutral;
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', t.bg, t.text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{active ? 'Active' : 'Inactive'}</span>;
}

function ThreePlDrawer({ draft, isNew, onClose, onSave, onDelete }: { draft: ThreePl; isNew: boolean; onClose: () => void; onSave: (d: ThreePl, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<ThreePl>(draft);
  const set = <K extends keyof ThreePl>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as ThreePl[K] }));
  const phoneBad = !!(phoneProblem(f.contactPhone) || phoneProblem(f.officePhone));
  const canSave = f.code.trim() !== '' && f.name.trim() !== '' && !phoneBad;
  return (
    <Drawer open onClose={onClose} width={620}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New 3PL company' : 'Edit 3PL company'}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <Section title="Identity">
          <Field label="Code" placeholder="e.g. 3PL-GDEX" value={f.code} onChange={set('code')} />
          <Field label="Name" value={f.name} onChange={set('name')} />
          <Field label="Registration no" value={f.registrationNo} onChange={set('registrationNo')} />
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.isActive ? '1' : '0'} onChange={e => setF(s => ({ ...s, isActive: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option><option value="0">Inactive</option>
            </select>
          </div>
        </Section>
        <Section title="Contact">
          <Field label="Contact person" value={f.contactName} onChange={set('contactName')} />
          <PhoneInput label="Contact phone" value={f.contactPhone} onChange={v => setF(s => ({ ...s, contactPhone: v }))} />
          <PhoneInput label="Office phone" value={f.officePhone} onChange={v => setF(s => ({ ...s, officePhone: v }))} />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} />
          <div className="col-span-2"><Field label="Address" value={f.address} onChange={set('address')} /></div>
          <div className="col-span-2"><Field label="Notes" placeholder="Optional" value={f.notes} onChange={set('notes')} /></div>
        </Section>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{onDelete && <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Delete</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason={phoneBad ? 'Fix the phone numbers first' : 'Enter a code and a name first'} onClick={() => onSave(f, isNew)}>{isNew ? 'Create company' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2.5"><div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">{title}</div><div className="grid grid-cols-2 gap-3.5">{children}</div></div>;
}
