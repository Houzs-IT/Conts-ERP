// Renovation quotations: every quotation (newest first) with its current
// revision, customer, building / unit, total and status; filter by status or
// search; "New Quotation" opens the New Sales Order page saving as a quotation.
// ?newFor=<projectId> opens it for that project (the project page's "Create quotation").

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Edit3, ExternalLink, FileText, LayoutGrid, Plus, Table as TableIcon, Wrench, X } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { brandingToneForLabel } from '../../lib/brandingTone';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/dataTableTypes';
import { FilterPills } from '../../components/FilterPills';
import { StatCard } from '../../components/StatCard';
import { ResizableDetailDrawer } from '../../components/ResizableDetailDrawer';
import { useAuth } from '../../auth/AuthContext';
import { refusalOf, useQuotation, useQuotations, type QuotationListRow } from '../../lib/renovation/api';
import { fmtDate, rm, StatusPill } from './shared';
import { cn } from '../../lib/utils';

const FILTERS = [
  { value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'SENT', label: 'Sent' },
  { value: 'ACCEPTED', label: 'Accepted' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'EXPIRED', label: 'Expired' },
];

/* The same columns, names and order as the Sales Orders list (owner, 5 Nov 2026: "它就是 sales order 来的"). */
/* Table or Cards, as on the sales order list (owner, 6 Nov 2026); remembered per browser. */
type ListView = 'table' | 'cards';
const VIEW_KEY = 'renovation-quotations-view';
const readView = (): ListView => {
  try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table'; } catch { return 'table'; }
};

function ViewToggle({ value, onChange }: { value: ListView; onChange: (v: ListView) => void }) {
  const btn = (which: ListView, label: string, Icon: typeof TableIcon) => (
    <button type="button" onClick={() => onChange(which)} aria-pressed={value === which}
      className={cn('inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors',
        value === which ? 'bg-primary text-white shadow-sm' : 'text-ink-secondary hover:bg-primary-soft hover:text-primary')}>
      <Icon size={13} />{label}
    </button>
  );
  return <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-1 shadow-stone">{btn('table', 'Table', TableIcon)}{btn('cards', 'Cards', LayoutGrid)}</div>;
}

function QuotationCards({ rows, onOpen }: { rows: QuotationListRow[]; onOpen: (r: QuotationListRow) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <button key={r.id} type="button" onClick={() => onOpen(r)}
          className="group relative overflow-hidden rounded-lg border border-border bg-surface px-4 py-4 text-left shadow-stone transition-all duration-200 hover:-translate-y-px hover:border-primary/40 hover:shadow-slab focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30">
          <div className="flex items-center justify-between gap-2">
            <span className="font-docno text-[12.5px] font-semibold text-ink">{r.docNo}</span>
            <StatusPill status={r.status} />
          </div>
          <div className="mt-2 truncate text-[15px] font-semibold text-ink">{r.customerName || '—'}</div>
          <div className="mt-1 flex items-center gap-2">
            {r.brandName && <Badge tone={brandingToneForLabel(r.brandName)} variant="soft" size="xs">{r.brandName}</Badge>}
            <span className="text-[11.5px] text-ink-muted">{fmtDate(r.docDate)}</span>
          </div>
          <div className="mt-3.5 flex items-end justify-between border-t border-border-subtle pt-3">
            <div className="min-w-0">
              <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Project</div>
              <div className="mt-0.5 truncate font-mono text-[12px] font-semibold text-ink-secondary">{r.projectCode || '—'}</div>
            </div>
            <span className="font-money text-[15px] font-bold text-ink">{rm(r.totalSen)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

const COLUMNS: Column<QuotationListRow>[] = [
  { key: 'docNo', label: 'Doc. No.', alwaysVisible: true, getValue: (r) => r.docNo, disableFilter: true,
    render: (r) => <span className="font-mono font-semibold text-primary">{r.docNo}</span> },
  { key: 'date', label: 'Date', width: '116px', getValue: (r) => r.docDate, filterType: 'date', dateValue: (r) => r.docDate, filterLabel: fmtDate,
    render: (r) => <span className="text-ink-secondary">{fmtDate(r.docDate)}</span> },
  { key: 'customer', label: 'Debtor Name', getValue: (r) => r.customerName || '', render: (r) => <span className="font-semibold">{r.customerName || '—'}</span> },
  { key: 'branding', label: 'Branding', width: '150px', getValue: (r) => r.brandName ?? '',
    render: (r) => (r.brandName ? <Badge tone={brandingToneForLabel(r.brandName)} variant="soft" size="xs">{r.brandName.toUpperCase()}</Badge> : <span className="text-ink-muted">—</span>) },
  { key: 'projectCode', label: 'Project ID', getValue: (r) => r.projectCode ?? '', render: (r) => <span className="font-mono text-[12px] text-ink-secondary">{r.projectCode ?? '—'}</span> },
  { key: 'project', label: 'Project Name', getValue: (r) => r.projectName ?? (r.projectId ? `#${r.projectId}` : ''),
    render: (r) => <span className="text-ink-secondary">{r.projectName ?? (r.projectId ? `#${r.projectId}` : '—')}</span> },
  { key: 'unit', label: 'Building / unit', getValue: (r) => [r.building, r.unitNo].filter(Boolean).join(' '),
    render: (r) => <span className="text-ink-secondary">{[r.building, r.unitNo].filter(Boolean).join(' ') || '—'}</span> },
  { key: 'total', label: 'Total', align: 'right', getValue: (r) => r.totalSen,
    exportValue: (r) => r.totalSen / 100, disableFilter: true,
    total: (rows) => rm(rows.reduce((s, r) => s + r.totalSen, 0)),
    render: (r) => <span className="font-semibold tabular-nums">{rm(r.totalSen)}</span> },
  { key: 'status', label: 'Status', getValue: (r) => r.status, filterLabel: (v) => FILTERS.find((f) => f.value === v)?.label ?? v,
    render: (r) => (
      <span className="inline-flex items-center gap-2">
        <StatusPill status={r.status} />
        {r.convertedSoDocNo && <Link to={`/scm/renovation/contracts/${encodeURIComponent(r.convertedSoDocNo)}`} onClick={(e) => e.stopPropagation()} className="text-[12px] text-primary">{r.convertedSoDocNo}</Link>}
      </span>
    ) },
];

const label = 'font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted';

function Meta({ k, v }: { k: string; v: ReactNode }) {
  return <div><dt className={label}>{k}</dt><dd className="mt-0.5 text-[13px] font-semibold text-ink">{v || '—'}</dd></div>;
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="mb-2.5 mt-6 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">{children}</div>;
}

// Quick view from the list, the same shape as the sales order list's drawer; the editor stays the full page.
function QuotationDrawer({ row, onClose }: { row: QuotationListRow | null; onClose: () => void }) {
  const navigate = useNavigate();
  const view = useQuotation(row?.id);
  const rev = view.data?.revision;
  const h = rev?.header;
  const t = rev?.totals;
  const openFull = () => row && navigate(`/scm/renovation/quotations/${row.id}`);
  return (
    <ResizableDetailDrawer open={!!row} onClose={onClose} ariaLabel={row ? `Quotation ${row.docNo}` : 'Quotation details'}>
      {row && (
        <>
          <div className="flex h-[60px] shrink-0 items-center gap-3 bg-sidebar px-5 text-sidebar-ink">
            <button type="button" onClick={onClose} className="text-sidebar-ink-muted hover:text-sidebar-ink" aria-label="Close details"><X size={18} /></button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[14px] font-bold tracking-wide">{row.docNo}</div>
              <div className="mt-0.5 text-[11px] text-sidebar-ink-muted">Quotation</div>
            </div>
            <button type="button" onClick={openFull}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent-bright/40 px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-bright hover:bg-accent-bright/10">
              Open full page <ExternalLink size={12} />
            </button>
            <StatusPill status={row.status} />
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="text-[19px] font-bold text-ink">{row.customerName || '—'}</div>
            <div className="mt-1.5 text-[12.5px] text-ink-muted">Dated {fmtDate(row.docDate)} · revision {row.currentRev}</div>

            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-2 px-4 py-4">
              <Meta k="Project" v={row.projectName ?? (row.projectId ? `#${row.projectId}` : 'Not linked yet')} />
              <Meta k="Building / unit" v={[row.building, row.unitNo].filter(Boolean).join(' ')} />
              <Meta k="Prepared by" v={h?.preparedBy} />
              <Meta k="Valid until" v={h?.validUntil ? fmtDate(h.validUntil) : null} />
              <Meta k="Attention" v={h?.attention} />
              <Meta k="Sales order" v={row.convertedSoDocNo
                ? <Link to={`/scm/renovation/contracts/${encodeURIComponent(row.convertedSoDocNo)}`} className="text-primary">{row.convertedSoDocNo}</Link>
                : null} />
            </dl>

            <Heading>Customer &amp; site</Heading>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {([['Phone', h?.customerPhone], ['Email', h?.customerEmail], ['Site', h?.siteAddress]] as const).map(([k, v]) => (
                <div key={k} className="flex items-start gap-3 border-b border-border-subtle px-4 py-2.5 last:border-b-0">
                  <span className={cn(label, 'w-20 shrink-0')}>{k}</span>
                  <span className="flex-1 text-[13px] font-semibold leading-relaxed text-ink">{v || '—'}</span>
                </div>
              ))}
            </div>

            <Heading>Quotation lines</Heading>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className={cn(label, 'grid grid-cols-[minmax(0,1fr)_40px_96px] gap-2 border-b border-border-subtle bg-surface-2 px-4 py-2')}>
                <span>Item</span><span className="text-right">Qty</span><span className="text-right">Amount</span>
              </div>
              {view.isLoading && <div className="px-4 py-8 text-center text-[12px] text-ink-muted">Loading lines…</div>}
              {view.error && <div className="px-4 py-8 text-center text-[12px] text-err">{refusalOf(view.error).message}</div>}
              {rev && rev.sections.every((s) => s.lines.length === 0) && <div className="px-4 py-8 text-center text-[12px] text-ink-muted">No lines</div>}
              {rev?.sections.filter((s) => s.lines.length > 0).map((s, si) => (
                <div key={s.id ?? si}>
                  {s.heading && <div className="border-b border-border-subtle bg-surface-2/60 px-4 py-1.5 text-[11.5px] font-bold text-ink">{s.heading}</div>}
                  {s.lines.filter((l) => l.kind === 'ITEM' || l.kind === 'CHILD').map((l, i) => (
                    <div key={l.id ?? i} className="grid grid-cols-[minmax(0,1fr)_40px_96px] items-start gap-2 border-b border-border-subtle px-4 py-2.5">
                      <div className={cn('min-w-0 text-[12.5px] leading-snug text-ink', l.kind === 'CHILD' && 'pl-3 text-ink-secondary')}>
                        {l.itemCode && <span className="font-medium">{l.itemCode} </span>}{l.description}
                      </div>
                      <span className="text-right font-money text-[12.5px] text-ink-secondary">{l.qty}</span>
                      <span className="text-right font-money text-[12.5px] font-semibold text-ink">{l.isFoc ? 'FOC' : rm(l.netSen)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1.5 rounded-lg border border-border bg-surface px-5 py-4 text-[12px]">
              {t && t.totalDiscountSen > 0 && <>
                <div className="flex justify-between"><span className="text-ink-muted">List price</span><span className="font-money font-semibold">{rm(t.listSen)}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">Discounts</span><span className="font-money font-semibold text-err">-{rm(t.totalDiscountSen)}</span></div>
              </>}
              <div className="flex justify-between">
                <span className="text-[13px] font-semibold text-ink">Total</span>
                <span className="font-money text-[15px] font-bold text-ink">{rm(t?.finalSen ?? row.totalSen)}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
            <Button variant="primary" icon={<Edit3 size={14} />} onClick={openFull}>{view.data?.editable ? 'Edit quotation' : 'View quotation'}</Button>
          </div>
        </>
      )}
    </ResizableDetailDrawer>
  );
}

const sumSen = (rows: QuotationListRow[]) => rows.reduce((s, r) => s + r.totalSen, 0);

export function QuotationsList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [params] = useSearchParams();
  const newFor = Number(params.get('newFor')) || null;
  useEffect(() => { if (newFor) navigate(`/scm/renovation/quotations/new?projectId=${newFor}`, { replace: true }); }, [newFor, navigate]);
  const [selected, setSelected] = useState<QuotationListRow | null>(null);
  // Every status is loaded at once so the cards and pill counts stay whole; the pills filter on screen.
  // ponytail: the server returns the newest 200, move status to the server when a company outgrows that.
  const list = useQuotations({ q: q || null });
  const { can } = useAuth();
  const canQuote = can('scm.renovation.quote');
  const all = list.data?.quotations ?? [];
  const rows = status ? all.filter((r) => r.status === status) : all;
  const of = (s: string) => all.filter((r) => r.status === s);
  const [view, setView] = useState<ListView>(readView);
  const changeView = (v: ListView) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* remembered for this visit only */ }
  };
  const pending = list.isLoading;
  const failed = { failed: Boolean(list.error), onRetry: () => void list.refetch() };
  return (
    // The list makes room for the drawer on desktop, as on the sales order list.
    <div className={cn('transition-[padding] duration-200', selected && 'md:pr-[540px]')}>
      <PageHeader
        eyebrow="Renovation"
        title="Quotations"
        description="Quotations for renovation projects. An accepted revision converts to the sales order in one step."
        primaryAction={canQuote ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate('/scm/renovation/quotations/new')}>New Quotation</Button> : undefined}
        secondaryActions={[
          { label: 'SO Maintenance', icon: Wrench, onClick: () => navigate('/scm/sales-orders/maintenance') },
        ]}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard pending={pending} {...failed} label="Total Quotations" value={all.length.toLocaleString('en-MY')} subtitle="All matching quotations" rail="bg-primary" active />
        <StatCard pending={pending} {...failed} label="Open Value" value={rm(sumSen([...of('DRAFT'), ...of('SENT')]))} subtitle={`${of('DRAFT').length + of('SENT').length} draft or sent`} rail="bg-accent" />
        <StatCard pending={pending} {...failed} label="Accepted" value={rm(sumSen(of('ACCEPTED')))} subtitle={`${of('ACCEPTED').length} quotations`} tone="success" rail="bg-synced" />
        <StatCard pending={pending} {...failed} label="Rejected / Expired" value={rm(sumSen([...of('REJECTED'), ...of('EXPIRED')]))} subtitle={`${of('REJECTED').length + of('EXPIRED').length} quotations`} tone="error" rail="bg-err" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterPills
          options={FILTERS.map((f) => ({ ...f, count: pending ? undefined : f.value ? of(f.value).length : all.length }))}
          value={status}
          onChange={setStatus}
        />
        <div className="flex-1" />
        {view === 'cards' && <input aria-label="Search quotations" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, customer, building…" className="h-9 w-64 max-w-full rounded-md border border-border bg-surface px-3 text-[13px] text-ink focus:border-primary focus:outline-none" />}
        <ViewToggle value={view} onChange={changeView} />
      </div>

      {view === 'cards' ? (
        rows.length === 0
          ? <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center text-[13px] font-semibold text-ink shadow-stone">{q || status ? 'No quotations match.' : 'No quotations yet.'}</div>
          : <QuotationCards rows={rows} onOpen={setSelected} />
      ) : (
      <DataTable<QuotationListRow>
        tableId="renovation-quotations"
        documentLabel="Quotations"
        exportName="quotations"
        rows={rows}
        loading={list.isLoading}
        error={list.error ? refusalOf(list.error).message : null}
        columns={COLUMNS}
        getRowKey={(r) => r.id}
        onRowClick={setSelected}
        mobileCard={{ primary: 'docNo', cells: ['status', 'customer', 'unit', 'date', 'total'] }}
        emptyLabel={q || status ? 'No quotations match.' : 'No quotations yet.'}
        search={{
          value: q,
          onChange: setQ,
          placeholder: 'Search number, customer, building…',
          scope: 'server',
          totalRecords: rows.length,
          countPending: list.isLoading,
        }}
      />
      )}
      <QuotationDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
