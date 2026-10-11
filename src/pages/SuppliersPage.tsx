import { useMemo, useState, type ReactNode } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, PhoneInput, phoneProblem } from '../components/inputs';
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

/** Suppliers — supplier master, ported from 2990's SCM (logic) and drawn in Conts.
 *  Money is integer sen; the form takes RM. Bindings/scorecard deferred to later slices. */

type Status = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
const STATUSES: Status[] = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

interface Supplier {
  id: string; code: string; name: string; status: Status;
  contactPerson: string; attention: string; phone: string; mobile: string; whatsappNumber: string; fax: string;
  email: string; website: string; address: string; area: string; postcode: string; state: string; country: string;
  paymentTerms: string; creditLimitSen: number; currency: string; statementType: string; agingBasis: string;
  supplierType: string; category: string; businessNature: string; tinNumber: string; businessRegNo: string;
  rating: number; notes: string;
}
interface Payload { data: Supplier[]; generatedAt: string }

const S = (o: Partial<Supplier> & Pick<Supplier, 'id' | 'code' | 'name'>): Supplier => ({
  status: 'ACTIVE', contactPerson: '', attention: '', phone: '', mobile: '', whatsappNumber: '', fax: '',
  email: '', website: '', address: '', area: '', postcode: '', state: '', country: 'Malaysia',
  paymentTerms: '', creditLimitSen: 0, currency: 'MYR', statementType: 'OPEN_ITEM', agingBasis: 'INVOICE_DATE',
  supplierType: '', category: '', businessNature: '', tinNumber: '', businessRegNo: '', rating: 0, notes: '', ...o,
});

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    S({ id: 's1', code: 'SUP-EMMA', name: 'Emma Furnishings Sdn Bhd', contactPerson: 'Alicia Tan', phone: '+60123456789', email: 'sales@emma.my', state: 'Selangor', category: 'Sofa, Bedframe', paymentTerms: '30 days', creditLimitSen: 5000000 }),
    S({ id: 's2', code: 'SUP-HILTON', name: 'Hilton Bedding Manufacturing', contactPerson: 'Rajesh Kumar', phone: '+60198887766', email: 'orders@hiltonbedding.my', state: 'Johor', category: 'Mattress', paymentTerms: '60 days', creditLimitSen: 8000000 }),
    S({ id: 's3', code: 'SUP-NORDIC', name: 'Nordic Woodcraft', contactPerson: 'Lim Wei Jie', phone: '+60127773344', email: 'hello@nordicwood.my', state: 'Selangor', category: 'Bedframe, Dining', paymentTerms: '30 days', creditLimitSen: 3000000 }),
    S({ id: 's4', code: 'SUP-TEXTILE', name: 'KL Textile & Carpet Co', contactPerson: 'Nurul Aina', phone: '+60133221100', email: 'sales@kltextile.my', state: 'Kuala Lumpur', category: 'Carpet, Bedlines', status: 'INACTIVE', paymentTerms: 'COD' }),
  ],
};

type Draft = Omit<Supplier, 'creditLimitSen' | 'rating'> & { creditLimitSen: number | null; rating: number | null };
const toDraft = (s: Supplier): Draft => s;
const emptyDraft = (): Draft => toDraft(S({ id: '', code: '', name: '' }));

const emailBad = (v: string) => v.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

export default function SuppliersPage() {
  const { data, loading, error, reload } = useApi<Payload>('/suppliers', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Draft; isNew: boolean } | null>(null);

  const [added, setAdded] = useState<Supplier[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Supplier>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(
    () => [...added, ...(data?.data ?? [])].filter(s => !removed.has(s.id)).map(s => ({ ...s, ...edits[s.id] })),
    [added, data, edits, removed],
  );

  const q = search.trim().toLowerCase();
  const rows = all.filter(s =>
    (statusFilter === 'all' || s.status === statusFilter) &&
    (!q || `${s.code} ${s.name} ${s.contactPerson} ${s.category}`.toLowerCase().includes(q)),
  );

  const columns = useMemo<Column<Supplier>[]>(() => [
    { key: 'code', label: 'Code', type: 'ref', value: s => s.code, hideable: false },
    { key: 'name', label: 'Name', value: s => s.name, width: 200 },
    { key: 'contact', label: 'Contact', value: s => s.contactPerson },
    { key: 'phone', label: 'Phone', type: 'phone', value: s => s.phone, width: 140 },
    { key: 'category', label: 'Category', value: s => s.category },
    { key: 'terms', label: 'Terms', value: s => s.paymentTerms, width: 110 },
    { key: 'credit', label: 'Credit limit', type: 'money', value: s => s.creditLimitSen, render: s => s.creditLimitSen ? <span className="tabular-nums whitespace-nowrap">{rm(s.creditLimitSen, { cents: false })}</span> : <span className="text-muted-ink">—</span> },
    { key: 'status', label: 'Status', type: 'status', value: s => s.status, entity: 'supplier' },
  ], []);

  function save(draft: Draft, isNew: boolean) {
    const body = { ...draft, creditLimitSen: draft.creditLimitSen ?? 0, rating: draft.rating ?? 0 };
    if (isNew) {
      const local = S({ ...body, id: `sup-new-${crypto.randomUUID().slice(0, 8)}` });
      setAdded(a => [local, ...a]);
      persist(api.post('/suppliers', body), { reload, ok: () => toast({ tone: 'success', title: 'Supplier added.', body: `${body.code} ${body.name}` }) });
    } else {
      setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...body } }));
      persist(api.patch(`/suppliers/${draft.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Supplier updated.', body: `${body.code} ${body.name}` }) });
    }
    setDrawer(null);
  }

  function remove(s: Supplier) {
    setRemoved(r => new Set(r).add(s.id));
    persist(api.del(`/suppliers/${s.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Supplier removed.', body: s.code }) });
    setDrawer(null);
  }

  const activeCount = all.filter(s => s.status === 'ACTIVE').length;

  return (
    <>
      <PageHeader
        title="Suppliers"
        sub={data ? `${all.length} ${all.length === 1 ? 'supplier' : 'suppliers'} · ${activeCount} active` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyDraft(), isNew: true })}>New supplier</Button> : undefined}
      />

      <DataTable<Supplier>
        id="scm.suppliers" columns={columns} rows={data ? rows : null} rowKey={s => s.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? s => setDrawer({ draft: toDraft(s), isNew: false }) : undefined}
        noun={['supplier', 'suppliers']} exportName="suppliers"
        toolbar={<>
          <Segmented label="Status" options={[{ key: 'all' as const, label: 'All' }, ...STATUSES.map(s => ({ key: s, label: statusLabel('supplier', s) }))]} value={statusFilter} onChange={setStatusFilter} />
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search suppliers..." aria-label="Search suppliers"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
          </div>
        </>}
        filtered={!!q || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'No suppliers yet.', body: 'Add the suppliers you buy furniture, fittings and services from.', action: canWrite ? { label: 'New supplier', onClick: () => setDrawer({ draft: emptyDraft(), isNew: true }) } : undefined }} />

      {drawer && <SupplierDrawer draft={drawer.draft} isNew={drawer.isNew} onClose={() => setDrawer(null)} onSave={save}
        onDelete={drawer.isNew ? undefined : () => { const s = all.find(x => x.id === drawer.draft.id); if (s) remove(s); }} />}
    </>
  );
}

/* ---------- primitives ---------- */


/* ---------- New / Edit drawer ---------- */

function SupplierDrawer({ draft, isNew, onClose, onSave, onDelete }: { draft: Draft; isNew: boolean; onClose: () => void; onSave: (d: Draft, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const setPhone = (k: 'phone' | 'mobile' | 'whatsappNumber') => (v: string) => setF(s => ({ ...s, [k]: v }));
  const canSave = f.code.trim() !== '' && f.name.trim() !== '' && !emailBad(f.email);
  const [tried, setTried] = useState(false);
  const ratingError = tried && f.rating != null && (f.rating < 0 || f.rating > 5) ? 'Must be 0 to 5.' : undefined;
  const phoneError = (v: string) => (tried ? phoneProblem(v) : undefined);

  function submit() {
    setTried(true);
    const ratingBad = f.rating != null && (f.rating < 0 || f.rating > 5);
    if (ratingBad || [f.phone, f.mobile, f.whatsappNumber].some(v => phoneProblem(v))) return;
    onSave(f, isNew);
  }

  return (
    <Drawer open onClose={onClose} width={680}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{isNew ? 'New supplier' : 'Edit supplier'}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <Section title="Identity">
          <Field label="Code" placeholder="e.g. SUP-EMMA" value={f.code} onChange={set('code')} />
          <Field label="Name" placeholder="Supplier name" value={f.name} onChange={set('name')} />
          <Sel label="Status" value={f.status} onChange={set('status')} options={STATUSES.map(s => ({ value: s, label: statusLabel('supplier', s) }))} />
          <Field label="Category" placeholder="e.g. Sofa, Bedframe" value={f.category} onChange={set('category')} />
          <Field label="Supplier type" placeholder="Manufacturer / Trader / 3PL" value={f.supplierType} onChange={set('supplierType')} />
          <Field label="Business nature" placeholder="Optional" value={f.businessNature} onChange={set('businessNature')} />
        </Section>
        <Section title="Contact">
          <Field label="Contact person" value={f.contactPerson} onChange={set('contactPerson')} />
          <Field label="Attention" value={f.attention} onChange={set('attention')} />
          <PhoneInput label="Phone" value={f.phone} onChange={setPhone('phone')} error={phoneError(f.phone)} />
          <PhoneInput label="Mobile" value={f.mobile} onChange={setPhone('mobile')} error={phoneError(f.mobile)} />
          <PhoneInput label="WhatsApp" value={f.whatsappNumber} onChange={setPhone('whatsappNumber')} error={phoneError(f.whatsappNumber)} />
          <Field label="Fax" value={f.fax} onChange={set('fax')} />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} error={emailBad(f.email) ? 'Check the email, or leave it blank.' : undefined} />
          <Field label="Website" value={f.website} onChange={set('website')} />
        </Section>
        <Section title="Address">
          <div className="sm:col-span-2"><Field label="Address" value={f.address} onChange={set('address')} /></div>
          <Field label="Area" value={f.area} onChange={set('area')} />
          <Field label="Postcode" value={f.postcode} onChange={set('postcode')} />
          <Field label="State" value={f.state} onChange={set('state')} />
          <Field label="Country" value={f.country} onChange={set('country')} />
        </Section>
        <Section title="Terms & finance">
          <Field label="Payment terms" placeholder="e.g. 30 days" value={f.paymentTerms} onChange={set('paymentTerms')} />
          <MoneyInput label="Credit limit (RM)" valueSen={f.creditLimitSen} onChangeSen={v => setF(s => ({ ...s, creditLimitSen: v }))} />
          <Field label="Currency" value={f.currency} onChange={set('currency')} />
          <Field label="Statement type" value={f.statementType} onChange={set('statementType')} />
          <Field label="Aging basis" value={f.agingBasis} onChange={set('agingBasis')} />
          <NumberInput label="Rating (0–5)" min={0} max={5} value={f.rating} onChange={v => setF(s => ({ ...s, rating: v }))} error={ratingError} />
          <Field label="TIN number" value={f.tinNumber} onChange={set('tinNumber')} />
          <Field label="Business reg. no" value={f.businessRegNo} onChange={set('businessRegNo')} />
          <div className="sm:col-span-2"><Field label="Notes" placeholder="Optional" value={f.notes} onChange={set('notes')} /></div>
        </Section>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete supplier ${draft.name}?`, body: 'It is deleted for good and drops off the supplier list.', confirmLabel: 'Delete supplier', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason={emailBad(f.email) ? 'Check the email first' : 'Enter a code and a name first'} onClick={submit}>{isNew ? 'Create supplier' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">{children}</div>
    </div>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-[12px] font-medium text-muted-ink">{label}</label>
      <select value={value} onChange={onChange}
        className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
