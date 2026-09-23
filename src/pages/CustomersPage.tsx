import { useMemo, useState, type ReactNode } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
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
import type { Tone } from '../lib/types';

/** Customers (debtors) — sell-side counterpart of Suppliers, drawn in Conts. Money sen. */

type Status = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
const STATUSES: Status[] = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
const STATUS_LABEL: Record<Status, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', BLOCKED: 'Blocked' };
const STATUS_TONE: Record<Status, Tone> = { ACTIVE: 'success', INACTIVE: 'neutral', BLOCKED: 'critical' };

interface Customer {
  id: string; code: string; name: string; status: Status; contactPerson: string; phone: string; email: string;
  address: string; area: string; postcode: string; state: string; country: string; paymentTerms: string;
  creditLimitSen: number; currency: string; tinNumber: string; businessRegNo: string; customerType: string; notes: string;
}
interface Payload { data: Customer[]; generatedAt: string }

const C = (o: Partial<Customer> & Pick<Customer, 'id' | 'code' | 'name'>): Customer => ({
  status: 'ACTIVE', contactPerson: '', phone: '', email: '', address: '', area: '', postcode: '', state: '', country: 'Malaysia',
  paymentTerms: '', creditLimitSen: 0, currency: 'MYR', tinNumber: '', businessRegNo: '', customerType: '', notes: '', ...o,
});
const FALLBACK: Payload = { generatedAt: '', data: [
  C({ id: 'c1', code: 'CUST-VJ', name: 'Vista Jaya Residences', contactPerson: 'Property Manager', phone: '+60312223344', state: 'Selangor', paymentTerms: '30 days', creditLimitSen: 5000000 }),
  C({ id: 'c2', code: 'CUST-ARC', name: 'Arcoris Owner', contactPerson: 'Mr Tan', phone: '+60198887766', state: 'Kuala Lumpur', paymentTerms: 'COD' }),
] };

const senToRm = (sen: number | null | undefined) => (sen == null ? '' : String(sen / 100));
const rmToSen = (v: string): number => { const n = Number(v); return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : 0; };
type Draft = Omit<Customer, 'creditLimitSen'> & { creditLimit: string };
const toDraft = (c: Customer): Draft => ({ ...c, creditLimit: senToRm(c.creditLimitSen) });
const emptyDraft = (): Draft => toDraft(C({ id: '', code: '', name: '' }));

export default function CustomersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/customers', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<Customer[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Customer>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(c => !removed.has(c.id)).map(c => ({ ...c, ...edits[c.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(c => (statusFilter === 'all' || c.status === statusFilter) && (!q || `${c.code} ${c.name} ${c.contactPerson}`.toLowerCase().includes(q)));

  function save(draft: Draft, isNew: boolean) {
    const { creditLimit, ...rest } = draft;
    const body = { ...rest, creditLimitSen: rmToSen(creditLimit) };
    if (isNew) { setAdded(a => [C({ ...body, id: `cust-new-${crypto.randomUUID().slice(0, 8)}` }), ...a]); api.post('/customers', body).catch(notifyFailure); toast({ tone: 'success', title: 'Customer added.', body: `${body.code} ${body.name}` }); }
    else { setEdits(e => ({ ...e, [rest.id]: { ...e[rest.id], ...body } })); api.patch(`/customers/${rest.id}`, body).catch(notifyFailure); toast({ tone: 'success', title: 'Customer updated.', body: `${body.code} ${body.name}` }); }
    setDrawer(null);
  }
  function remove(c: Customer) { setRemoved(r => new Set(r).add(c.id)); api.del(`/customers/${c.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Customer removed.', body: c.code }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Customers" sub={`${all.length} customers · ${all.filter(c => c.status === 'ACTIVE').length} active`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyDraft(), isNew: true })}>New customer</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last customer list we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-2 flex-wrap"><Chip label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />{STATUSES.map(s => <Chip key={s} label={STATUS_LABEL[s]} active={statusFilter === s} onClick={() => setStatusFilter(s)} />)}</div>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers..." aria-label="Search customers"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Code', 'Name', 'Contact', 'Phone', 'Terms', 'Credit limit', 'Status'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 5 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={7}><TableSkeleton rows={6} cols={7} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={7}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">{q || statusFilter !== 'all' ? 'No customers match.' : 'No customers yet.'}</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Add the customers you sell to.</span></div></td></tr>
              : rows.map(c => (
                <tr key={c.id} onClick={() => { if (canWrite) setDrawer({ draft: toDraft(c), isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] bg-muted border border-solid border-line rounded-full px-2.5 py-0.5">{c.code}</span></td>
                  <td className="py-[13px] px-4 text-[13.5px]">{c.name}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{c.contactPerson || '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink tabular-nums">{c.phone || '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-[var(--color-ink-2)]">{c.paymentTerms || '—'}</td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px]">{c.creditLimitSen ? rm(c.creditLimitSen, { cents: false }) : '—'}</td>
                  <td className="py-[13px] px-4"><StatusPill status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <CustomerDrawer draft={drawer.draft} isNew={drawer.isNew} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => { const c = all.find(x => x.id === drawer.draft.id); if (c) remove(c); }} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
function StatusPill({ status }: { status: Status }) {
  const t = STATUS_TONE[status];
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE[t].bg, TONE[t].text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_LABEL[status]}</span>;
}

function CustomerDrawer({ draft, isNew, onClose, onSave, onDelete }: { draft: Draft; isNew: boolean; onClose: () => void; onSave: (d: Draft, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const canSave = f.code.trim() !== '' && f.name.trim() !== '';
  return (
    <Drawer open onClose={onClose} width={640}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New customer' : 'Edit customer'}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <Section title="Identity">
          <Field label="Code" placeholder="e.g. CUST-VJ" value={f.code} onChange={set('code')} />
          <Field label="Name" value={f.name} onChange={set('name')} />
          <Sel label="Status" value={f.status} onChange={set('status')} options={STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }))} />
          <Field label="Type" placeholder="Individual / Company" value={f.customerType} onChange={set('customerType')} />
        </Section>
        <Section title="Contact">
          <Field label="Contact person" value={f.contactPerson} onChange={set('contactPerson')} />
          <Field label="Phone" value={f.phone} onChange={set('phone')} />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} />
          <div className="col-span-2"><Field label="Address" value={f.address} onChange={set('address')} /></div>
          <Field label="Postcode" value={f.postcode} onChange={set('postcode')} />
          <Field label="State" value={f.state} onChange={set('state')} />
        </Section>
        <Section title="Terms & finance">
          <Field label="Payment terms" placeholder="e.g. 30 days" value={f.paymentTerms} onChange={set('paymentTerms')} />
          <Field label="Credit limit (RM)" type="number" numeric step="0.01" value={f.creditLimit} onChange={set('creditLimit')} />
          <Field label="TIN number" value={f.tinNumber} onChange={set('tinNumber')} />
          <Field label="Business reg. no" value={f.businessRegNo} onChange={set('businessRegNo')} />
          <div className="col-span-2"><Field label="Notes" placeholder="Optional" value={f.notes} onChange={set('notes')} /></div>
        </Section>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{onDelete && <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Delete</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a code and a name first" onClick={() => onSave(f, isNew)}>{isNew ? 'Create customer' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2.5"><div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">{title}</div><div className="grid grid-cols-2 gap-3.5">{children}</div></div>;
}
function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void; options: { value: string; label: string }[] }) {
  return <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">{label}</label><select value={value} onChange={onChange} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
}
