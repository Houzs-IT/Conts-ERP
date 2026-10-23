import { mayWork } from '../lib/areaAccess';
import { useMemo, useState, type ReactNode } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, PhoneInput } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm } from '../lib/format';
import { statusLabel } from '../lib/status';
import { CloseButton } from '../components/CloseButton';

/** Customers (debtors) — sell-side counterpart of Suppliers, drawn in Conts. Money sen. */

type Status = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
const STATUSES: Status[] = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

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

type Draft = Omit<Customer, 'creditLimitSen'> & { creditLimitSen: number | null };
const toDraft = (c: Customer): Draft => ({ ...c });
const emptyDraft = (): Draft => toDraft(C({ id: '', code: '', name: '' }));

const emailBad = (v: string) => v.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

export default function CustomersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/customers', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayWork(user, 'scSales');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<Customer[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Customer>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(c => !removed.has(c.id)).map(c => ({ ...c, ...edits[c.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(c => (statusFilter === 'all' || c.status === statusFilter) && (!q || `${c.code} ${c.name} ${c.contactPerson}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Customer>[]>(() => [
    { key: 'code', label: 'Code', type: 'ref', value: c => c.code, hideable: false },
    { key: 'name', label: 'Name', value: c => c.name },
    { key: 'contact', label: 'Contact', value: c => c.contactPerson },
    { key: 'phone', label: 'Phone', type: 'phone', value: c => c.phone },
    { key: 'terms', label: 'Terms', value: c => c.paymentTerms },
    { key: 'credit', label: 'Credit limit', type: 'money', value: c => c.creditLimitSen, render: c => c.creditLimitSen ? <span className="tabular-nums">{rm(c.creditLimitSen, { cents: false })}</span> : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: c => c.status, entity: 'customer' },
  ], []);

  function save(draft: Draft, isNew: boolean) {
    const { creditLimitSen, ...rest } = draft;
    const body = { ...rest, creditLimitSen: creditLimitSen ?? 0 };
    if (isNew) { setAdded(a => [C({ ...body, id: `cust-new-${crypto.randomUUID().slice(0, 8)}` }), ...a]); persist(api.post('/customers', body), { reload, ok: () => toast({ tone: 'success', title: 'Customer added.', body: `${body.code} ${body.name}` }) }); }
    else { setEdits(e => ({ ...e, [rest.id]: { ...e[rest.id], ...body } })); persist(api.patch(`/customers/${rest.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Customer updated.', body: `${body.code} ${body.name}` }) }); }
    setDrawer(null);
  }
  function remove(c: Customer) { setRemoved(r => new Set(r).add(c.id)); persist(api.del(`/customers/${c.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Customer removed.', body: c.code }) }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Customers" sub={data ? `${all.length} ${all.length === 1 ? 'customer' : 'customers'} · ${all.filter(c => c.status === 'ACTIVE').length} active` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyDraft(), isNew: true })}>New customer</Button> : undefined} />
      <DataTable<Customer>
        id="customers" columns={columns} rows={data ? rows : null} rowKey={c => c.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? c => setDrawer({ draft: toDraft(c), isNew: false }) : undefined}
        noun={['customer', 'customers']} exportName="customers"
        toolbar={<>
          <Segmented label="Status" options={[{ key: 'all' as const, label: 'All' }, ...STATUSES.map(s => ({ key: s, label: statusLabel('customer', s) }))]} value={statusFilter} onChange={setStatusFilter} />
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers..." aria-label="Search customers"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No customers yet.', body: 'Add the customers you sell to.', action: canWrite ? { label: 'New customer', onClick: () => setDrawer({ draft: emptyDraft(), isNew: true }) } : undefined }} />
      {drawer && <CustomerDrawer draft={drawer.draft} isNew={drawer.isNew} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => { const c = all.find(x => x.id === drawer.draft.id); if (c) remove(c); }} />}
    </>
  );
}

function CustomerDrawer({ draft, isNew, onClose, onSave, onDelete }: { draft: Draft; isNew: boolean; onClose: () => void; onSave: (d: Draft, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const canSave = f.code.trim() !== '' && f.name.trim() !== '' && !emailBad(f.email);
  return (
    <Drawer open onClose={onClose} width={640}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New customer' : 'Edit customer'}</h2><CloseButton onClick={onClose} /></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <Section title="Identity">
          <Field label="Code" placeholder="e.g. CUST-VJ" value={f.code} onChange={set('code')} />
          <Field label="Name" value={f.name} onChange={set('name')} />
          <Sel label="Status" value={f.status} onChange={set('status')} options={STATUSES.map(s => ({ value: s, label: statusLabel('customer', s) }))} />
          <Field label="Type" placeholder="Individual / Company" value={f.customerType} onChange={set('customerType')} />
        </Section>
        <Section title="Contact">
          <Field label="Contact person" value={f.contactPerson} onChange={set('contactPerson')} />
          <PhoneInput label="Phone" value={f.phone} onChange={v => setF(s => ({ ...s, phone: v }))} />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} error={emailBad(f.email) ? 'Check the email, or leave it blank.' : undefined} />
          <div className="sm:col-span-2"><Field label="Address" value={f.address} onChange={set('address')} /></div>
          <Field label="Postcode" value={f.postcode} onChange={set('postcode')} />
          <Field label="State" value={f.state} onChange={set('state')} />
        </Section>
        <Section title="Terms & finance">
          <Field label="Payment terms" placeholder="e.g. 30 days" value={f.paymentTerms} onChange={set('paymentTerms')} />
          <MoneyInput label="Credit limit (RM)" valueSen={f.creditLimitSen} onChangeSen={v => setF(s => ({ ...s, creditLimitSen: v }))} />
          <Field label="TIN number" value={f.tinNumber} onChange={set('tinNumber')} />
          <Field label="Business reg. no" value={f.businessRegNo} onChange={set('businessRegNo')} />
          <div className="sm:col-span-2"><Field label="Notes" placeholder="Optional" value={f.notes} onChange={set('notes')} /></div>
        </Section>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete customer ${draft.name}?`, body: 'It is deleted for good and drops off the customer list.', confirmLabel: 'Delete customer', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason={emailBad(f.email) ? 'Check the email first' : 'Enter a code and a name first'} onClick={() => onSave(f, isNew)}>{isNew ? 'Create customer' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-2.5"><div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">{title}</div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">{children}</div></div>;
}
function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void; options: { value: string; label: string }[] }) {
  return <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">{label}</label><select value={value} onChange={onChange} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
}
