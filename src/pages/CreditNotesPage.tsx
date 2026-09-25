import { useMemo, useState } from 'react';
import { Search, Plus, X, Trash2 } from 'lucide-react';
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
import { rm, date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

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
const STATUS_LABEL: Record<Status, string> = { DRAFT: 'Draft', POSTED: 'Posted', CANCELLED: 'Cancelled' };
const STATUS_TONE: Record<Status, keyof typeof TONE> = { DRAFT: 'warning', POSTED: 'success', CANCELLED: 'neutral' };

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
const rmToSen = (v: string) => { const n = Number(v); return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : 0; };

export default function CreditNotesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/credit-notes');
  const suppliers = useApi<{ data: Opt[] }>('/suppliers').data?.data ?? [];
  const salesInvoices = (useApi<{ data: Si[] }>('/sales-invoices').data?.data ?? []).filter(s => s.status !== 'CANCELLED');
  const purchaseInvoices = (useApi<{ data: Pi[] }>('/purchase-invoices').data?.data ?? []).filter(p => p.status !== 'CANCELLED');
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);

  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'view'; id: string } | null>(null);

  const all = useMemo(() => data?.data ?? [], [data]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(n => (kindFilter === 'all' || n.kind === kindFilter) && (statusFilter === 'all' || n.status === statusFilter)
    && (!q || `${n.noteNumber} ${n.partyName} ${n.sourceDocNo} ${n.salesInvoiceNumber} ${n.purchaseInvoiceNumber}`.toLowerCase().includes(q)));

  function done(title: string, body: string) { toast({ tone: 'success', title, body }); reload(); }

  return (
    <>
      <PageHeader title="Credit / debit notes" sub={`${all.length} notes · only posted notes change what is owed`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>New note</Button> : undefined} />

      {error && <StaleBanner message={`Showing the last notes we have. ${error}`} onRetry={reload} />}

      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {(['all', 'CN', 'DN', 'SCN'] as const).map(k => <Chip key={k} label={k === 'all' ? 'All' : KIND_LABEL[k] + 's'} active={kindFilter === k} onClick={() => setKindFilter(k)} />)}
        </div>
        <div className="flex gap-2.5 items-center flex-wrap">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as Status | 'all')} aria-label="Status"
            className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="all">All statuses</option>
            {(['DRAFT', 'POSTED', 'CANCELLED'] as const).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search note, customer or supplier..." aria-label="Search notes"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['Note', 'Type', 'Customer / supplier', 'Against', 'Date', 'Status', 'Amount'].map((h, i) => (
                  <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 6 ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && all.length === 0 ? (
                <tr><td colSpan={7}><TableSkeleton rows={5} cols={7} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7}>
                  <div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center">
                    <span className="text-[14px] font-semibold">{q || kindFilter !== 'all' || statusFilter !== 'all' ? 'No notes match.' : 'No credit or debit notes yet.'}</span>
                    <span className="text-[12.5px] text-muted-ink max-w-[420px]">Raise a note to correct what a customer or supplier owes, e.g. after goods are returned.</span>
                  </div>
                </td></tr>
              ) : rows.map(n => (
                <tr key={n.id} onClick={() => setDrawer({ mode: 'view', id: n.id })} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)] cursor-pointer hover:bg-muted">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{n.noteNumber}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-[var(--color-ink-2)]">{KIND_LABEL[n.kind]}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{n.partyName}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{against(n) || '—'}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)]">{n.noteDate ? date(n.noteDate) : '—'}</td>
                  <td className="py-[13px] px-4"><StatusPill status={n.status} /></td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px] font-semibold">{n.status === 'CANCELLED' ? <span className="text-muted-ink line-through">{rm(n.totalSen)}</span> : rm(n.totalSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {drawer?.mode === 'new' && <NewNoteDrawer suppliers={suppliers} salesInvoices={salesInvoices} purchaseInvoices={purchaseInvoices} canWrite={canWrite}
        onClose={() => setDrawer(null)} onDone={(title, body) => { setDrawer(null); done(title, body); }} />}
      {drawer?.mode === 'view' && <ViewNoteDrawer id={drawer.id} canWrite={canWrite} onClose={() => setDrawer(null)} onDone={(title, body) => { setDrawer(null); done(title, body); }} />}
    </>
  );
}

const against = (n: Note) => [n.salesInvoiceNumber, n.soDocNo, n.purchaseInvoiceNumber, n.sourceDocNo].filter(Boolean).join(' · ');

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
function StatusPill({ status }: { status: Status }) {
  const t = TONE[STATUS_TONE[status]];
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', t.bg, t.text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_LABEL[status]}</span>;
}

/* ---------- new note ---------- */

function NewNoteDrawer({ suppliers, salesInvoices, purchaseInvoices, canWrite, onClose, onDone }: {
  suppliers: Opt[]; salesInvoices: Si[]; purchaseInvoices: Pi[]; canWrite: boolean; onClose: () => void; onDone: (title: string, body: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('CN');
  const [supplierId, setSupplierId] = useState('');
  const [purchaseInvoiceId, setPurchaseInvoiceId] = useState('');
  const [salesInvoiceId, setSalesInvoiceId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceDocNo, setSourceDocNo] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<{ description: string; amount: string }[]>([{ description: '', amount: '' }]);
  const [busy, setBusy] = useState(false);

  const isSupplier = kind === 'SCN';
  const si = salesInvoices.find(s => s.id === salesInvoiceId);
  const built = lines.map(l => ({ description: l.description.trim(), amountSen: rmToSen(l.amount) })).filter(l => l.amountSen > 0);
  const total = built.reduce((s, l) => s + l.amountSen, 0);
  const hasParty = isSupplier ? supplierId !== '' : (salesInvoiceId !== '' || partyName.trim() !== '');
  const canSave = canWrite && hasParty && built.length > 0 && !busy;
  const setLine = (i: number, k: 'description' | 'amount', v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));

  // Waits for the server at every step; "Save and post" is the draft then the post, as in Houzs.
  async function save(post: boolean) {
    setBusy(true);
    try {
      const body = isSupplier
        ? { kind, supplierId, purchaseInvoiceId: purchaseInvoiceId || undefined }
        : { kind, salesInvoiceId: salesInvoiceId || undefined, partyName: salesInvoiceId ? undefined : partyName.trim() };
      const r = await api.post<{ id: string; noteNumber: string }>('/credit-notes', { ...body, noteDate, sourceDocNo, reason, lines: built });
      if (post) await api.patch(`/credit-notes/${r.id}`, { status: 'POSTED' });
      onDone(post ? `${KIND_LABEL[kind]} posted.` : 'Draft saved.', `${r.noteNumber} · ${rm(total)}`);
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width={760}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">New note</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
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
          <div className="grid grid-cols-2 gap-3.5">
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
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-[7px]"><label className={labelCls} htmlFor="cn-si">Against sales invoice (optional)</label>
              <select id="cn-si" value={salesInvoiceId} onChange={e => setSalesInvoiceId(e.target.value)} className={selectCls}>
                <option value="">None — name the customer instead</option>
                {salesInvoices.map(s => <option key={s.id} value={s.id}>{s.invoiceNumber} · {s.customerName}</option>)}
              </select>
            </div>
            <Field label="Customer" placeholder="Customer name" value={si ? si.customerName : partyName} disabled={!!si} onChange={e => setPartyName(e.target.value)} />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3.5">
          <Field label="Note date" type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)} />
          <Field label="Source document (optional)" placeholder="e.g. PRET-2026-0001" value={sourceDocNo} onChange={e => setSourceDocNo(e.target.value)} />
          <Field label="Reason (optional)" placeholder="e.g. Goods returned" value={reason} onChange={e => setReason(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-ink">Lines</div>
          <div className="border border-solid border-line rounded-card overflow-hidden">
            {lines.map((l, i) => (
              <div key={i} className={cx('grid grid-cols-[1fr_140px_36px] gap-2.5 items-center py-2 px-3', i > 0 && '[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]')}>
                <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Description" aria-label={`Line ${i + 1} description`}
                  className="h-8 box-border px-2 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" />
                <input type="number" min={0} step="0.01" value={l.amount} onChange={e => setLine(i, 'amount', e.target.value)} placeholder="Amount (RM)" aria-label={`Line ${i + 1} amount`}
                  className="h-8 box-border px-2 py-0 text-right font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none" />
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}
                  className="h-8 w-8 grid place-items-center bg-transparent border-none cursor-pointer text-muted-ink rounded-control hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setLines(ls => [...ls, { description: '', amount: '' }])} disabled={lines.length >= 50}>Add line</Button>
            <div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[120px] text-right">{rm(total)}</span></div>
          </div>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="secondary" disabled={!canSave} disabledReason="Name who it's for and add a line with an amount" onClick={() => void save(false)}>Save draft</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Name who it's for and add a line with an amount" loading={busy} onClick={() => void save(true)}>Save and post</Button>
      </div>
    </Drawer>
  );
}

/* ---------- view / post / cancel ---------- */

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
        <div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{n?.noteNumber ?? 'Note'}</h2>{n && <StatusPill status={n.status} />}</div>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button>
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
            <div className="overflow-x-auto border border-solid border-line rounded-card">
              <table className="w-full border-collapse min-w-[360px]">
                <thead><tr className="bg-muted">{['Description', 'Amount'].map((th, i) => <th key={th} className={cx('py-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-ink', i === 0 ? 'text-left' : 'text-right')}>{th}</th>)}</tr></thead>
                <tbody>
                  {(n.lines ?? []).map((l, i) => (
                    <tr key={i} className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)]">
                      <td className="py-2 px-3 text-[13px]">{l.description || '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[13px]">{rm(l.amountSen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end"><div className="flex gap-8 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums w-[120px] text-right">{rm(n.totalSen)}</span></div></div>
            {n.status === 'DRAFT' && <div className="text-[12.5px] text-muted-ink">This is a draft. It changes nothing until it is posted.</div>}
            {n.status === 'POSTED' && <div className="text-[12.5px] text-muted-ink">Posted notes are never edited. To correct it, cancel it and raise a new one.</div>}
          </>
        )}
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{canWrite && n && n.status !== 'CANCELLED' && <Button size="sm" variant="danger" disabled={busy} onClick={() => void setStatus('CANCELLED')}>Cancel note</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {canWrite && n?.status === 'DRAFT' && <Button size="sm" variant="primary" loading={busy} onClick={() => void setStatus('POSTED')}>Post</Button>}
        </div>
      </div>
    </Drawer>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[11px] uppercase tracking-[0.08em] text-muted-ink">{label}</span><span className="text-[13.5px]">{value}</span></div>;
}
