import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/States';
import { MoneyText, moneyString } from '../components/MoneyText';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import ChannelMark from '../components/ChannelMark';
import { VoidDocumentDialog, type GuestDocument } from '../components/booking/GuestDocuments';
import { useApi } from '../lib/useApi';
import { date, monthLabel, plural } from '../lib/format';
import { cx } from '../lib/design-tokens';
import type { BookingChannel } from '../lib/types';
import { useUrlState, usePhone, ListCard, Pager, SearchBox, FilterSelect, Chip, STICKY_HEAD } from './finance/listKit';

interface Payload {
  total: number; page: number; pageSize: number;
  counts: { all: number; invoice: number; receipt: number; void: number };
  liveAmounts: { invoice: number; receipt: number };
  months: string[];
  data: GuestDocument[];
}
const PAGE_SIZE = 50;
const cols = 'grid-cols-[minmax(130px,1fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(132px,0.9fr)]';
type Tab = 'all' | 'invoice' | 'receipt' | 'void';

/** Every invoice and official receipt issued to guests. A voided document keeps its number, struck through. */
export default function GuestDocumentsPage() {
  const url = useUrlState();
  const phone = usePhone();
  const navigate = useNavigate();
  const tab = (['invoice', 'receipt', 'void'].includes(url.get('tab')) ? url.get('tab') : 'all') as Tab;
  const month = url.get('month'), q = url.get('q');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const query = new URLSearchParams({
    pageSize: String(PAGE_SIZE), ...(tab === 'invoice' || tab === 'receipt' ? { type: tab } : {}), ...(tab === 'void' ? { status: 'void' } : {}),
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

  return (
    <>
      <PageHeader title="Guest documents"
        sub={data ? `${plural(data.counts.invoice, 'invoice')} · ${plural(data.counts.receipt, 'receipt')} · ${data.counts.void} void · receipts ${moneyString(data.liveAmounts.receipt, 'exact')}` : 'Invoices and official receipts issued to guests'} />
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

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

      {!loading && rows.length === 0 ? (
        tab === 'all' && !q && !month
          ? <EmptyState icon="FileText" title="No guest documents yet" body="Issue an invoice or an official receipt from a booking's money section. Each gets the next INV- or OR- number." action={{ label: 'Open bookings', onClick: () => navigate('/reservations/bookings') }} />
          : <EmptyState kind="filtered" title="No documents match these filters." action={{ label: 'Clear filters', onClick: () => url.set({ tab: null, month: null, q: null, page: null }) }} />
      ) : (
        <ListCard busy={loading && !!data}>
          {phone ? (
            <div>
              {loading && !data ? <TableSkeleton rows={5} cols={2} /> : rows.map(d => (
                <div key={d.id} className="flex flex-col gap-[5px] py-3 px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
                  <div className="flex items-center justify-between gap-3">{no(d)}<MoneyText sen={d.amount} mode="exact" strong className="text-copy" /></div>
                  <span className="text-meta text-ink truncate">{d.typeLabel} · {d.guestName ?? 'Guest'}</span>
                  <span className="text-caption text-muted-ink truncate">{[d.bookingRef, d.unit].filter(Boolean).join(' · ')} · {date(d.issuedAt)}</span>
                  {d.voidedAt && <span className="text-caption text-[var(--color-critical-fg)] text-pretty">Voided {date(d.voidedAt)}: {d.voidReason}</span>}
                  <div className="flex items-center justify-between gap-2">{status(d)}{actions(d)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div role="table" aria-label="Guest documents">
              <div role="row" className={`grid ${cols} gap-[14px] px-[22px] py-[9px] ${STICKY_HEAD}`}>
                <div>Number</div><div>Type</div><div>Guest</div><div>Booking</div><div>Issued</div><div className="text-right">Amount</div><div>Status</div><div className="text-right">Action</div>
              </div>
              {loading && !data ? <TableSkeleton rows={6} cols={8} /> : rows.map(d => (
                <div role="row" key={d.id} className={`grid ${cols} gap-[14px] items-center min-h-[52px] px-[22px] py-[8px] [border-bottom:1px_solid_var(--color-line-soft)]`}>
                  <div className="flex flex-col gap-px min-w-0">{no(d)}{d.voidedAt && <span className="text-caption text-muted-ink truncate" title={d.voidReason ?? ''}>Void: {d.voidReason}</span>}</div>
                  <div className="text-copy">{d.typeLabel}</div>
                  <div className="text-copy truncate" title={d.guestName ?? ''}>{d.guestName ?? 'Guest'}</div>
                  <div className="flex items-center gap-2 min-w-0">
                    {d.channel && <ChannelMark ch={d.channel as BookingChannel} size={18} />}
                    <span className="flex flex-col min-w-0">
                      <button type="button" onClick={() => navigate(`/reservations/bookings?open=${encodeURIComponent(d.reservationId)}`)}
                        className="p-0 border-none bg-transparent [font:inherit] text-copy text-ink underline cursor-pointer text-left truncate">{d.bookingRef ?? 'Booking'}</button>
                      <span className="text-caption text-muted-ink truncate">{d.unit}</span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0"><span className="text-copy">{date(d.issuedAt)}</span><span className="text-caption text-muted-ink truncate">{d.issuedBy}</span></div>
                  <div className="text-right"><MoneyText sen={d.amount} mode="exact" strong className={cx('text-copy', d.voidedAt && 'line-through')} /></div>
                  <div>{status(d)}</div>
                  {actions(d)}
                </div>
              ))}
            </div>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? rows.length} unit="documents" onPage={p => url.set({ page: p > 1 ? p : null })} />
          <div className="px-[22px] py-[11px] [border-top:1px_solid_var(--color-line)] bg-page text-meta text-muted-ink">
            A voided number is never issued again. View opens the document ready to print or save as PDF.
          </div>
        </ListCard>
      )}
      {voiding && <VoidDocumentDialog doc={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); reload(); }} />}
    </>
  );
}
