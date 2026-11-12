import { Link } from 'react-router-dom';
import { StatTile } from '../../components/Metric';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { PageControls } from '../../components/PageControls';
import { StatusBadge } from '../../components/StatusBadge';
import { DateField } from '../../components/inputs/DateField';
import { StaleBanner } from '../../components/DataState';
import { useApi } from '../../lib/useApi';
import { count, date, dateRange, plural } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { channelLabel } from '../../components/ChannelMark';
import { useUrlState, FilterSelect } from '../finance/listKit';
import { ListToolbar } from '../../components/ListToolbar';
import type { BookingChannel } from '../../lib/types';
import type { PlaceRow } from './ReviewsOverview';
const Tile = StatTile;

interface Stay {
  reservationId: string; channel: BookingChannel; guestName: string; checkIn: string; checkOut: string; bookingRef: string | null;
  unitId: string; unitNumber: string; propertyId: string | null; propertyName: string | null; threadId: string | null;
  daysSinceCheckout: number; windowClosed: boolean;
}
interface Payload {
  from: string; to: string; page: number; pageSize: number; total: number;
  totals: { checkedOut: number; reviewed: number; notReviewed: number; windowClosed: number; reviewRate: number | null };
  windowDays: Record<string, number>;
  perUnit: { unitId: string; unitNumber: string; propertyId: string | null; propertyName: string | null; withoutReview: number; windowOpen: number }[];
  data: Stay[];
}
const CHANNELS = [{ value: 'airbnb', label: 'Airbnb' }, { value: 'booking_com', label: 'Booking.com' }, { value: 'agoda', label: 'Agoda' }, { value: 'direct', label: 'Direct' }];

/** Outstanding tab: finished reservations that have not left a review, newest checkout first, with how many days
 *  ago the guest left. Past the channel's review window (src/lib/reviewRules.ts) a stay is "Window closed": it can
 *  no longer be reviewed, so it is not worth chasing. */
export function OutstandingStays() {
  const url = useUrlState();
  const f = { from: url.get('from'), to: url.get('to'), channel: url.get('channel'), propertyId: url.get('propertyId'), unitId: url.get('unitId'), window: url.get('window') };
  const page = Math.max(1, Number(url.get('page')) || 1);
  const size = [25, 50, 100].includes(Number(url.get('size'))) ? Number(url.get('size')) : 50;
  const q = new URLSearchParams(Object.entries({ ...f, page: String(page), pageSize: String(size) }).filter(([, v]) => v) as [string, string][]);
  const { data, loading, error, reload } = useApi<Payload>(`/reviews/unreviewed?${q}`);
  const places = useApi<{ data: PlaceRow[] }>('/reviews/units');
  const t = data?.totals;
  const buildings = [...new Map((places.data?.data ?? []).filter(p => p.propertyId).map(p => [p.propertyId!, p.propertyName ?? ''])).entries()];
  const units = (places.data?.data ?? []).filter(p => !f.propertyId || p.propertyId === f.propertyId);
  const set = (patch: Record<string, string | null>) => url.set({ ...patch, page: null });
  const windows = data ? Object.entries(data.windowDays).map(([c, d]) => `${channelLabel(c as BookingChannel)} ${d} days`).join(', ') : '';

  const columns: Column<Stay>[] = [
    { key: 'guest', label: 'Guest', value: r => r.guestName, hideable: false, phone: 'title', width: 160,
      render: r => <Link to={`/reservations/bookings?open=${encodeURIComponent(r.reservationId)}`} className="font-medium text-ink no-underline hover:underline" onClick={e => e.stopPropagation()}>{r.guestName}</Link>,
      sub: r => r.bookingRef ?? '' },
    { key: 'unit', label: 'Unit', value: r => `${r.propertyName ?? ''} ${r.unitNumber}`.trim(), render: r => r.unitNumber, sub: r => r.propertyName ?? '', width: 150 },
    { key: 'channel', label: 'Channel', type: 'channel', value: r => r.channel, width: 110 },
    { key: 'stay', label: 'Stay', type: 'date', value: r => r.checkOut, render: r => dateRange(r.checkIn, r.checkOut), width: 200 },
    { key: 'days', label: 'Since checkout', type: 'number', value: r => r.daysSinceCheckout, align: 'right', width: 110, phone: 'right',
      render: r => <span className="tabular-nums">{plural(r.daysSinceCheckout, 'day')}</span> },
    { key: 'window', label: 'Review window', type: 'status', width: 130, phone: 'badge',
      status: r => r.windowClosed ? { label: 'Window closed', tone: 'neutral' } : { label: 'Can still review', tone: 'info' },
      render: r => <StatusBadge tone={r.windowClosed ? 'neutral' : 'info'} label={r.windowClosed ? 'Window closed' : 'Can still review'} size="sm" /> },
    { key: 'message', label: '', sortable: false, noExport: true, width: 120, phone: 'meta',
      render: r => r.threadId ? <Link to={`/communication/inbox?thread=${encodeURIComponent(r.threadId)}`} onClick={e => e.stopPropagation()} className="text-ink-2 text-meta">Message guest</Link> : null },
  ];

  return (
    <>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        <Tile label="Checked out" value={t ? count(t.checkedOut) : '—'} hint={data ? `${dateRange(data.from, data.to)}` : undefined} />
        <Tile label="Reviewed" value={t ? count(t.reviewed) : '—'} />
        <Tile label="No review yet" value={t ? count(t.notReviewed) : '—'} tone={t?.notReviewed ? 'warning' : undefined} hint={t ? `${count(t.notReviewed - t.windowClosed)} can still review` : undefined} />
        <Tile label="Review rate" value={t?.reviewRate != null ? `${t.reviewRate}%` : '—'} />
        <Tile label="Window closed" value={t ? count(t.windowClosed) : '—'} hint={windows ? `After ${windows}` : undefined} />
      </div>

      <ListToolbar
        leading={<FilterSelect className="flex-[0_1_200px] min-w-[150px]" label="Unit" all="All units" value={f.unitId} onChange={v => set({ unitId: v || null })}
          options={units.map(u => ({ value: u.unitId ?? '', label: `${u.propertyName ?? ''} ${u.unitNumber ?? ''}`.trim() }))} />}
        filters={[
          { key: 'channel', label: 'Channel', value: f.channel, onChange: v => set({ channel: v || null }), allLabel: 'All channels', options: CHANNELS },
          { key: 'building', label: 'Building', value: f.propertyId, onChange: v => set({ propertyId: v || null, unitId: null }), allLabel: 'All buildings',
            options: buildings.map(([id, name]) => ({ value: id, label: name })) },
          { key: 'window', label: 'Review window', value: f.window, onChange: v => set({ window: v || null }), allLabel: 'Open or closed',
            options: [{ value: 'open', label: 'Can still review' }, { value: 'closed', label: 'Window closed' }] },
        ]}
        panelExtra={<>
          <h5 className="m-0 mb-1.5 text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">Checked out</h5>
          <div className="grid grid-cols-2 gap-1.5">
            <DateField aria-label="Checked out from" value={f.from || data?.from || ''} onChange={v => set({ from: v || null })} />
            <DateField aria-label="Checked out to" value={f.to || data?.to || ''} onChange={v => set({ to: v || null })} />
          </div>
        </>}
        chips={[
          ...(f.unitId ? [{ key: 'unit', label: `Unit: ${(() => { const u = units.find(x => x.unitId === f.unitId); return u ? `${u.propertyName ?? ''} ${u.unitNumber ?? ''}`.trim() : f.unitId; })()}`, onRemove: () => set({ unitId: null }) }] : []),
          ...(f.from || f.to ? [{ key: 'dates', label: `Checked out: ${f.from ? date(f.from) : 'any'} to ${f.to ? date(f.to) : 'any'}`, onRemove: () => set({ from: null, to: null }) }] : []),
        ]}
        count={data ? <span className="tabular-nums">{dateRange(data.from, data.to)}</span> : undefined}
      />

      {data && data.perUnit.length > 0 && (
        <Card>
          <div className="px-4 sm:px-5 py-3 flex flex-col gap-2">
            <span className="text-caption font-semibold tracking-[0.12em] uppercase text-muted-ink">No review yet, per unit</span>
            <div className="flex flex-wrap gap-2">
              {data.perUnit.map(u => {
                const on = f.unitId === u.unitId;
                return (
                  <button key={u.unitId} type="button" onClick={() => set({ unitId: on ? null : u.unitId })} aria-pressed={on}
                    className={cx('inline-flex items-center gap-2 h-8 px-3 rounded-full border border-solid cursor-pointer [font-family:inherit] text-meta',
                      on ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>
                    <span className="truncate max-w-[180px]">{u.propertyName} {u.unitNumber}</span>
                    <span className="font-semibold tabular-nums">{u.withoutReview}</span>
                    {u.windowOpen > 0 && <span className={on ? 'text-on-dark' : 'text-muted-ink'}>· {u.windowOpen} open</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <DataTable<Stay> id="reviews.outstanding" urlPrefix="s" columns={columns} rows={data?.data ?? null} rowKey={r => r.reservationId}
        loading={loading} error={error} onRetry={reload} pageSize={0} noViews defaultSort="stay:desc" noun={['reservation', 'reservations']}
        exportName="reservations-without-review" rowTone={r => (r.windowClosed ? 'muted' : null)}
        filtered={Object.values(f).some(Boolean)} onClearFilters={() => set({ from: null, to: null, channel: null, propertyId: null, unitId: null, window: null })}
        empty={{ title: 'Every finished reservation in this range left a review', icon: 'Star' }} />
      {data && data.total > size && (
        <Card><PageControls page={page} pageSize={size} total={data.total} onPage={p => url.set({ page: p > 1 ? String(p) : null })}
          onSize={s => url.set({ size: String(s), page: null })} noun="reservations" /></Card>
      )}
    </>
  );
}
