import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { MoneyText, moneyString } from '../components/MoneyText';
import { DataTable, type Column } from '../components/DataTable';
import { api } from '../lib/api';
import { fetchAllPages } from '../lib/export';
import ChannelMark from '../components/ChannelMark';
import { VoidDocumentDialog, type GuestDocument } from '../components/booking/GuestDocuments';
import { useApi } from '../lib/useApi';
import { date, monthLabel, plural } from '../lib/format';
import { cx } from '../lib/design-tokens';
import type { BookingChannel } from '../lib/types';
import { useUrlState, SearchBox, FilterSelect, Chip } from './finance/listKit';

interface Payload {
  total: number; page: number; pageSize: number;
  counts: { all: number; invoice: number; receipt: number; void: number };
  liveAmounts: { invoice: number; receipt: number };
  months: string[];
  data: GuestDocument[];
}
const PAGE_SIZE = 50;
type Tab = 'all' | 'invoice' | 'receipt' | 'void';

/** Every invoice and official receipt issued to guests. A voided document keeps its number, struck through. */
export default function GuestDocumentsPage() {
  const url = useUrlState();
  const navigate = useNavigate();
  const tab = (['invoice', 'receipt', 'void'].includes(url.get('tab')) ? url.get('tab') : 'all') as Tab;
  const month = url.get('month'), q = url.get('q');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const size = [25, 50, 100, 200].includes(Number(url.get('size'))) ? Number(url.get('size')) : PAGE_SIZE;
  const query = new URLSearchParams({
    pageSize: String(size), ...(tab === 'invoice' || tab === 'receipt' ? { type: tab } : {}), ...(tab === 'void' ? { status: 'void' } : {}),
    ...(month ? { month } : {}), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}),
  });
  const { data, loading, error, reload } = useApi<Payload>(`/guest-documents?${query}`);
  const [voiding, setVoiding] = useState<GuestDocument | null>(null);
  const rows = data?.data ?? [];
  const setTab = (t: Tab) => url.set({ tab: t === 'all' ? null : t, page: null });

  const view = (d: GuestDocument) => window.open(d.pdf, '_blank', 'noopener');
  const actions = (d: GuestDocument) => (
    <div className="flex items-center gap-2 justify-end">
      <Button size="sm" variant="secondary" onClick={() => view(d)}>View</Button>
      {!d.voidedAt && <Button size="sm" variant="tertiary" onClick={() => setVoiding(d)}>Void</Button>}
    </div>
  );
  const no = (d: GuestDocument) => <span className={cx('font-mono text-copy font-medium', d.voidedAt && 'line-through text-muted-ink')}>{d.docNo}</span>;
  const status = (d: GuestDocument) => d.voidedAt ? <Badge tone="critical" label="Void" size="sm" /> : <Badge tone="success" label="Issued" size="sm" />;

  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const base = Object.fromEntries([...query.entries()].filter(([k]) => k !== 'page' && k !== 'pageSize'));
    return (await fetchAllPages<GuestDocument>(async (p, n) => {
      const r = await api.get<Payload>('/guest-documents', { ...base, page: p, pageSize: n });
      return { rows: r.data, total: r.total };
    }, { size: 200, onProgress })).rows;
  }
  const columns = useMemo<Column<GuestDocument>[]>(() => [
    { key: 'no', label: 'Number', type: 'ref', value: d => d.docNo, hideable: false, width: 150,
      render: d => no(d), sub: d => (d.voidedAt ? <span title={d.voidReason ?? ''}>Void: {d.voidReason}</span> : null) },
    { key: 'type', label: 'Type', value: d => d.typeLabel, width: 110 },
    { key: 'guest', label: 'Guest', value: d => d.guestName ?? 'Guest', width: 170 },
    { key: 'booking', label: 'Booking', value: d => d.bookingRef, width: 170, sub: d => d.unit,
      render: d => (
        <span className="flex items-center gap-2 min-w-0">
          {d.channel && <ChannelMark ch={d.channel as BookingChannel} size={18} />}
          <button type="button" onClick={e => { e.stopPropagation(); navigate(`/reservations/bookings?open=${encodeURIComponent(d.reservationId)}`); }}
            className="p-0 border-none bg-transparent [font:inherit] text-copy text-ink underline cursor-pointer text-left truncate">{d.bookingRef ?? 'Booking'}</button>
        </span>
      ) },
    { key: 'unit', label: 'Unit', value: d => d.unit, hidden: true, width: 140 },
    { key: 'issued', label: 'Issued', type: 'date', value: d => d.issuedAt, width: 120, sub: d => d.issuedBy },
    { key: 'issuedBy', label: 'Issued by', value: d => d.issuedBy, hidden: true, width: 140 },
    { key: 'amount', label: 'Amount', type: 'money', value: d => d.amount, width: 130,
      render: d => <MoneyText sen={d.amount} mode="exact" strong className={cx('text-copy', d.voidedAt && 'line-through')} /> },
    { key: 'status', label: 'Status', type: 'status', value: d => (d.voidedAt ? 'Void' : 'Issued'), render: d => status(d), width: 100 },
    { key: 'voidReason', label: 'Void reason', value: d => d.voidReason, hidden: true, width: 200 },
    { key: 'action', label: 'Action', align: 'right', noExport: true, sortable: false, filter: false, width: 150, render: d => actions(d) },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Guest documents"
        sub={data ? `${plural(data.counts.invoice, 'invoice')} · ${plural(data.counts.receipt, 'receipt')} · ${data.counts.void} void · receipts ${moneyString(data.liveAmounts.receipt, 'exact')}` : 'Invoices and official receipts issued to guests'} />

      <div className="flex gap-2 overflow-x-auto pb-[2px] shrink-0 [scrollbar-width:none]">
        <Chip on={tab === 'all'} onClick={() => setTab('all')} count={data?.counts.all}>All</Chip>
        <Chip on={tab === 'invoice'} onClick={() => setTab('invoice')} count={data?.counts.invoice}>Invoices</Chip>
        <Chip on={tab === 'receipt'} onClick={() => setTab('receipt')} count={data?.counts.receipt}>Receipts</Chip>
        <Chip on={tab === 'void'} onClick={() => setTab('void')} count={data?.counts.void}>Void</Chip>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <SearchBox className="flex-[2_1_240px]" label="Search documents" placeholder="Search number, guest, booking or unit" value={q} onChange={v => url.set({ q: v || null, page: null })} />
        <FilterSelect className="flex-[1_1_180px]" label="Month issued" all="All months" value={month} onChange={v => url.set({ month: v || null, page: null })}
          options={(data?.months ?? []).map(m => ({ value: m, label: monthLabel(m) }))} />
      </div>

      <DataTable<GuestDocument> id="guest-documents" columns={columns} rows={data ? rows : null} rowKey={d => d.id}
        loading={loading} error={error} onRetry={reload} noun={['document', 'documents']} exportName="guest-documents"
        server={{ total: data?.total ?? rows.length, page: data?.page ?? page, pageSize: data?.pageSize ?? size, sizes: [25, 50, 100, 200], defaultPageSize: PAGE_SIZE, fetchAll }}
        viewParams={['tab', 'month', 'q']} filtered={tab !== 'all' || !!q || !!month} onClearFilters={() => url.set({ tab: null, month: null, q: null, page: null })}
        empty={{ title: 'No guest documents yet', body: "Issue an invoice or an official receipt from a booking's money section. Each gets the next INV- or OR- number.", icon: 'FileText', action: { label: 'Open bookings', onClick: () => navigate('/reservations/bookings') } }}
        footer={<div className="px-[22px] py-[11px] [border-top:1px_solid_var(--color-line)] bg-page text-meta text-muted-ink">A voided number is never issued again. View opens the document ready to print or save as PDF.</div>}
        renderCard={d => (
          <span className="flex flex-col gap-[5px]">
            <span className="flex items-center justify-between gap-3">{no(d)}<MoneyText sen={d.amount} mode="exact" strong className="text-copy" /></span>
            <span className="text-meta text-ink truncate">{d.typeLabel} · {d.guestName ?? 'Guest'}</span>
            <span className="text-caption text-muted-ink truncate">{[d.bookingRef, d.unit].filter(Boolean).join(' · ')} · {date(d.issuedAt)}</span>
            {d.voidedAt && <span className="text-caption text-[var(--color-critical-fg)] text-pretty">Voided {date(d.voidedAt)}: {d.voidReason}</span>}
            <span className="flex items-center justify-between gap-2">{status(d)}{actions(d)}</span>
          </span>
        )} />
      {voiding && <VoidDocumentDialog doc={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); reload(); }} />}
    </>
  );
}
