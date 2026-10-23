import { mayWork } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, DateField, PHONE_SIZING } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { TableSkeleton } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date, todayMyt } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';
import { statusLabel } from '../lib/status';
import { Eyebrow, Figure, Segmented } from '../components/Metric';
import { FilterSelect } from './finance/listKit';
import { CloseButton } from '../components/CloseButton';

/** Credit / debit notes — copied from Houzs ERP (Finance › Money in), drawn in Conts.
 *  A note is a draft until posted; only a posted note changes what a customer or supplier owes
 *  (Accounting). A posted note is never edited — cancel it and raise it again. */

type Kind = 'CN' | 'DN' | 'SCN';
type Status = 'DRAFT' | 'POSTED' | 'CANCELLED';
const KIND_LABEL: Record<Kind, string> = { CN: 'Credit note', DN: 'Debit note', SCN: 'Supplier credit note' };
const KIND_HELP: Record<Kind, string> = {
  CN: 'To a customer — they owe less (e.g. goods returned, price corrected down).',
  DN: 'To a customer — they owe more (e.g. an undercharge corrected).',
  SCN: 'From a supplier — we owe them less (e.g. goods sent back).',
};

interface NoteLine { description: string; amountSen: number }
interface Note {
  id: string; noteNumber: string; kind: Kind; partyType: string; partyName: string; supplierId: string;
  soDocNo: string; salesInvoiceNumber: string; purchaseInvoiceNumber: string; sourceDocNo: string;
  noteDate: string; totalSen: number; reason: string; notes: string; status: Status; lines?: NoteLine[];
}
interface Payload { data: Note[]; generatedAt: string }
interface Opt { id: string; code: string; name: string }
interface Si { id: string; invoiceNumber: string; customerName: string; outstandingSen: number; status: string }
interface Pi { id: string; invoiceNumber: string; supplierId: string; outstandingSen: number; status: string }

const selectCls = 'h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer';
const labelCls = 'text-[12px] font-medium text-muted-ink';

export default function CreditNotesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/credit-notes');
  const suppliers = useApi<{ data: Opt[] }>('/suppliers').data?.data ?? [];
  const salesInvoices = (useApi<{ data: Si[] }>('/sales-invoices').data?.data ?? []).filter(s => s.status !== 'CANCELLED');
  const purchaseInvoices = (useApi<{ data: Pi[] }>('/purchase-invoices').data?.data ?? []).filter(p => p.status !== 'CANCELLED');
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayWork(user, 'scInvoices');

  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; id: string } | null>(null);

  const all = useMemo(() => data?.data ?? [], [data]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(n => (kindFilter === 'all' || n.kind === kindFilter) && (statusFilter === 'all' || n.status === statusFilter)
    && (!q || `${n.noteNumber} ${n.partyName} ${n.sourceDocNo} ${n.salesInvoiceNumber} ${n.purchaseInvoiceNumber}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Note>[]>(() => [
    { key: 'noteNumber', label: 'Note', type: 'ref', value: n => n.noteNumber, hideable: false },
    { key: 'kind', label: 'Type', value: n => KIND_LABEL[n.kind] ?? n.kind, filter: { kind: 'select' } },
    { key: 'party', label: 'Customer / supplier', value: n => n.partyName },
    { key: 'against', label: 'Against', value: n => against(n) || null },
    { key: 'noteDate', label: 'Date', type: 'date', value: n => n.noteDate || null },
    { key: 'status', label: 'Status', type: 'status', value: n => n.status, entity: 'credit_note' },
    { key: 'amount', label: 'Amount', type: 'money', value: n => n.totalSen, render: n => n.status === 'CANCELLED' ? <span className="tabular-nums text-muted-ink line-through">{rm(n.totalSen)}</span> : <span className="tabular-nums">{rm(n.totalSen)}</span> },
  ], []);

  function done(title: string, body: string) { toast({ tone: 'success', title, body }); reload(); }

  return (
    <>
      <PageHeader title="Credit / debit notes" sub={data ? `${all.length} ${all.length === 1 ? 'note' : 'notes'} · only posted notes change what is owed` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New note</Button> : undefined} />

      <DataTable<Note>
        id="scm.credit-notes" columns={columns} rows={data ? rows : null} rowKey={n => n.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={n => setDrawer({ mode: 'view', id: n.id })}
        noun={['note', 'notes']} exportName="credit-debit-notes"
        toolbar={<>
          <Segmented<Kind | 'all'> label="Note type" value={kindFilter} onChange={setKindFilter}
            options={(['all', 'CN', 'DN', 'SCN'] as const).map(k => ({ key: k, label: k === 'all' ? 'All' : KIND_LABEL[k] + 's' }))} />
          <FilterSelect label="Status" all="All statuses" value={statusFilter === 'all' ? '' : statusFilter} onChange={v => setStatusFilter((v || 'all') as Status | 'all')}
            options={(['DRAFT', 'POSTED', 'CANCELLED'] as const).map(s => ({ value: s, label: statusLabel('credit_note', s) }))} />
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search note, customer or supplier..." aria-label="Search notes"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-copy text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || kindFilter !== 'all' || statusFilter !== 'all'} onClearFilters={() => { setSearch(''); setKindFilter('all'); setStatusFilter('all'); }}
        empty={{ title: 'No credit or debit notes yet.', body: 'Raise a note to correct what a customer or supplier owes, e.g. after goods are returned.', action: canWrite ? { label: 'New note', onClick: () => setDrawer({ mode: 'new' }) } : undefined }} />

      {drawer?.mode === 'new' && <NewNoteDrawer suppliers={suppliers} salesInvoices={salesInvoices} purchaseInvoices={purchaseInvoices} canWrite={canWrite}
        onClose={() => setDrawer(null)} onDone={(title, body) => { setDrawer(null); done(title, body); }} />}
      {drawer?.mode === 'view' && <ViewNoteDrawer id={drawer.id} canWrite={canWrite} onClose={() => setDrawer(null)} onDone={(title, body) => { setDrawer(null); done(title, body); }} />}
    </>
  );
}

const against = (n: Note) => [n.salesInvoiceNumber, n.soDocNo, n.purchaseInvoiceNumber, n.sourceDocNo].filter(Boolean).join(' · ');


/* ---------- new note ---------- */

function NewNoteDrawer({ suppliers, salesInvoices, purchaseInvoices, canWrite, onClose, onDone }: {
  suppliers: Opt[]; salesInvoices: Si[]; purchaseInvoices: Pi[]; canWrite: boolean; onClose: () => void; onDone: (title: string, body: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('CN');
  const [supplierId, setSupplierId] = useState('');
  const [purchaseInvoiceId, setPurchaseInvoiceId] = useState('');
  const [salesInvoiceId, setSalesInvoiceId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [noteDate, setNoteDate] = useState(todayMyt());
  const [sourceDocNo, setSourceDocNo] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<{ description: string; amountSen: number | null }[]>([{ description: '', amountSen: null }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const isSupplier = kind === 'SCN';
  const si = salesInvoices.find(s => s.id === salesInvoiceId);
  const used = lines.map((l, i) => ({ i, description: l.description.trim(), amountSen: l.amountSen ?? 0 })).filter(l => l.amountSen > 0 || l.description !== '');
  const built = used.filter(l => l.amountSen > 0).map(({ description, amountSen }) => ({ description, amountSen }));
  const total = built.reduce((s, l) => s + l.amountSen, 0);
  const hasParty = isSupplier ? supplierId !== '' : (salesInvoiceId !== '' || partyName.trim() !== '');
  const canSave = canWrite && hasParty && built.length > 0 && !busy;
  const setLine = (i: number, patch: Partial<{ description: string; amountSen: number | null }>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));

  // Waits for the server at every step; "Save and post" is the draft then the post, as in Houzs.
  async function save(post: boolean) {
    const e: Record<string, string> = {};
    used.forEach(l => { if (l.amountSen <= 0) e[`amount.${l.i}`] = 'Enter an amount above zero.'; });
    if (!noteDate) e.noteDate = 'Enter the note date.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = isSupplier
        ? { kind, supplierId, purchaseInvoiceId: purchaseInvoiceId || undefined }
        : { kind, salesInvoiceId: salesInvoiceId || undefined, partyName: salesInvoiceId ? undefined : partyName.trim() };
      const r = await api.post<{ id: string; noteNumber: string }>('/credit-notes', { ...body, noteDate, sourceDocNo, reason, lines: built });
      if (post) await api.patch(`/credit-notes/${r.id}`, { status: 'POSTED' });
      onDone(post ? `${KIND_LABEL[kind]} posted.` : 'Draft saved.', `${r.noteNumber} · ${rm(total)}`);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) {
          const m = /^lines\.(\d+)\.amountSen$/.exec(k);
          if (m) { const src = used.filter(l => l.amountSen > 0)[Number(m[1])]; if (src) mapped[`amount.${src.i}`] = v; } else mapped[k] = v;
        }
        setErrors(mapped);
      }
      notifyFailure(err);
    } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New note</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        <div className="flex flex-col gap-[7px]">
          <label className={labelCls} htmlFor="cn-kind">Type</label>
          <select id="cn-kind" value={kind} onChange={e => setKind(e.target.value as Kind)} className={selectCls}>
            {(['CN', 'DN', 'SCN'] as const).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <span className="text-[12px] text-muted-ink">{KIND_HELP[kind]}</span>
        </div>

        {isSupplier ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-[7px]"><label className={labelCls} htmlFor="cn-sup">Supplier</label>
              <select id="cn-sup" value={supplierId} onChange={e => { setSupplierId(e.target.value); setPurchaseInvoiceId(''); }} className={selectCls}>
                <option value="">Select a supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-[7px]"><label className={labelCls} htmlFor="cn-pi">Against purchase invoice (optional)</label>
              <select id="cn-pi" value={purchaseInvoiceId} onChange={e => setPurchaseInvoiceId(e.target.value)} className={selectCls} disabled={!supplierId}>
                <option value="">None</option>
                {purchaseInvoices.filter(p => p.supplierId === supplierId).map(p => <option key={p.id} value={p.id}>{p.invoiceNumber} · {rm(p.outstandingSen)} outstanding</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-[7px]"><label className={labelCls} htmlFor="cn-si">Against sales invoice (optional)</label>
              <select id="cn-si" value={salesInvoiceId} onChange={e => setSalesInvoiceId(e.target.value)} className={selectCls}>
                <option value="">None — name the customer instead</option>
                {salesInvoices.map(s => <option key={s.id} value={s.id}>{s.invoiceNumber} · {s.customerName}</option>)}
              </select>
            </div>
            <Field label="Customer" placeholder="Customer name" value={si ? si.customerName : partyName} disabled={!!si} onChange={e => setPartyName(e.target.value)} />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <DateField label="Note date" required value={noteDate} error={errors.noteDate} onChange={setNoteDate} />
          <Field label="Source document (optional)" placeholder="e.g. PRET-2026-0001" value={sourceDocNo} onChange={e => setSourceDocNo(e.target.value)} />
          <Field label="Reason (optional)" placeholder="e.g. Goods returned" value={reason} onChange={e => setReason(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines</div>
          <div className="border border-solid border-line rounded-card overflow-hidden">
            {lines.map((l, i) => (
              <div key={i} className={cx('grid grid-cols-[minmax(0,1fr)_120px_36px] sm:grid-cols-[minmax(0,1fr)_140px_36px] gap-2.5 items-center py-2 px-3', i > 0 && '[border-top:1px_solid_var(--color-line-soft)]')}>
                <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Description" aria-label={`Line ${i + 1} description`}
                  className={cx('h-8 w-full min-w-0 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none', PHONE_SIZING)} />
                <MoneyInput valueSen={l.amountSen} onChangeSen={v => setLine(i, { amountSen: v })} placeholder="Amount (RM)" aria-label={`Line ${i + 1} amount`} error={errors[`amount.${i}`]}
                  className="h-8 box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}
                  className="h-8 w-8 grid place-items-center bg-transparent border-none cursor-pointer text-muted-ink rounded-control hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setLines(ls => [...ls, { description: '', amountSen: null }])} disabled={lines.length >= 50}>Add line</Button>
            <div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div>
          </div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="secondary" disabled={!canSave} disabledReason="Name who it's for and add a line with an amount" onClick={() => void save(false)}>Save draft</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Name who it's for and add a line with an amount" loading={busy} onClick={() => void save(true)}>Save and post</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view / post / cancel ---------- */

const LINE_COLUMNS: Column<NoteLine & { i: number }>[] = [
  { key: 'description', label: 'Description', value: l => l.description || null, render: l => l.description || <span className="text-muted-ink">—</span>, hideable: false },
  { key: 'amount', label: 'Amount', type: 'money', value: l => l.amountSen },
];

function ViewNoteDrawer({ id, canWrite, onClose, onDone }: { id: string; canWrite: boolean; onClose: () => void; onDone: (title: string, body: string) => void }) {
  const { data, loading } = useApi<{ data: Note }>(`/credit-notes/${id}`);
  const n = data?.data;
  const [busy, setBusy] = useState(false);

  async function setStatus(status: 'POSTED' | 'CANCELLED') {
    if (!n) return;
    setBusy(true);
    try {
      await api.patch(`/credit-notes/${n.id}`, { status });
      onDone(status === 'POSTED' ? `${KIND_LABEL[n.kind]} posted.` : 'Note cancelled.', n.noteNumber);
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width={620}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{n?.noteNumber ?? 'Note'}</h2>{n && <StatusBadge entity="credit_note" value={n.status} />}</div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-5">
        {loading && !n ? <TableSkeleton rows={3} cols={2} /> : n && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-[13px]">
              <Meta label="Type" value={KIND_LABEL[n.kind]} />
              <Meta label={n.partyType === 'SUPPLIER' ? 'Supplier' : 'Customer'} value={n.partyName} />
              <Meta label="Date" value={n.noteDate ? date(n.noteDate) : '—'} />
              <Meta label="Against" value={against(n) || '—'} />
              <Meta label="Reason" value={n.reason || '—'} />
            </div>
            <div className="border border-solid border-line rounded-card overflow-hidden">
              <DataTable<NoteLine & { i: number }>
                id="scm.credit-note.lines" urlPrefix="lines." columns={LINE_COLUMNS} rows={(n.lines ?? []).map((l, i) => ({ ...l, i }))} rowKey={l => String(l.i)}
                bare noViews noToolbar pageSize={0} noun={['line', 'lines']} exportName={`${n.noteNumber}-lines`}
                empty={{ title: 'No lines on this note.' }} />
            </div>
            <div className="flex justify-end"><div className="flex flex-col items-end gap-1"><Eyebrow>Total</Eyebrow><Figure value={rm(n.totalSen)} className="text-[20px] font-semibold tracking-[-0.015em]" /></div></div>
            {n.status === 'DRAFT' && <div className="text-[12.5px] text-muted-ink">This is a draft. It changes nothing until it is posted.</div>}
            {n.status === 'POSTED' && <div className="text-[12.5px] text-muted-ink">Posted notes are never edited. To correct it, cancel it and raise a new one.</div>}
          </>
        )}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{canWrite && n && n.status !== 'CANCELLED' && <ConfirmButton disabled={busy} confirm={{ title: `Cancel ${n.noteNumber}?`, body: n.status === 'POSTED' ? 'It is marked Cancelled and its effect on the balance is removed.' : 'It is marked Cancelled and can no longer be posted.', confirmLabel: 'Cancel note', cancelLabel: 'Keep note' }} onConfirm={() => setStatus('CANCELLED')}>Cancel note</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {canWrite && n?.status === 'DRAFT' && <Button size="sm" variant="primary" loading={busy} onClick={() => void setStatus('POSTED')}>Post</Button>}
        </div>
      </div>
    </Drawer>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-1 min-w-0"><Eyebrow>{label}</Eyebrow><span className="text-copy break-words">{value}</span></div>;
}
