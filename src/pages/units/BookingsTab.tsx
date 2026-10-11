import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import ChannelMark from '../../components/ChannelMark';
import { DataTable, type Column } from '../../components/DataTable';
import { Segmented } from '../../components/Metric';
import { channel as CH } from '../../theme';
import { cx } from '../../lib/design-tokens';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { fetchAllPages } from '../../lib/export';
import { rm, dateRange, dateShort, count } from '../../lib/format';
import { type UnitDetail } from './shared';

type When = 'upcoming' | 'past' | 'cancelled' | 'all';
const WHENS: { key: When; label: string; empty: string }[] = [
  { key: 'upcoming', label: 'Upcoming', empty: 'No upcoming reservations for this unit.' },
  { key: 'past', label: 'Past', empty: 'No past reservations for this unit.' },
  { key: 'cancelled', label: 'Cancelled', empty: 'No cancelled reservations for this unit.' },
  { key: 'all', label: 'All', empty: 'No reservations for this unit yet.' },
];
const isWhen = (s: string | null): s is When => WHENS.some(w => w.key === s);
const PAGE_SIZE = 20;
/** functions/api/units/stays.ts answers at most 100 a page. */
const SIZES = [20, 50, 100];

type Stay = UnitDetail['stays'][number];
interface StaysPage {
  when: When; page: number; pageSize: number; total: number; today: string;
  counts: Record<When, number>; totalGross?: number; rows: Stay[];
}

const nightsOf = (s: Stay) => Math.max(0, Math.round((Date.parse(s.checkOut) - Date.parse(s.checkIn)) / 864e5));

/** The unit's bookings, a page at a time. Filter, page and page size live in the address (?when=&page=&size=). */
export default function BookingsTab({ unitId }: { unitId: string }) {
  const [params, setParams] = useSearchParams();
  const when: When = isWhen(params.get('when')) ? (params.get('when') as When) : 'upcoming';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const size = SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : PAGE_SIZE;
  const base = `/units/stays?unitId=${encodeURIComponent(unitId)}&when=${when}`;
  const q = useApi<StaysPage>(`${base}&page=${page}&pageSize=${size}`);
  const d = q.data;

  const setWhen = (w: When) => setParams(p => {
    const n = new URLSearchParams(p);
    if (w === 'upcoming') n.delete('when'); else n.set('when', w);
    n.delete('page');
    return n;
  }, { replace: true });

  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const r = await fetchAllPages<Stay>(async (pg, sz) => {
      const p = await api.get<StaysPage>('/units/stays', { unitId, when, page: pg, pageSize: sz });
      return { rows: p.rows, total: p.total };
    }, { size: 100, onProgress });
    return r.rows;
  }

  const money = d?.rows.some(r => r.grossBookingValue !== undefined) ?? false;
  const summary = d && d.total > 0
    ? `${count(d.total)} ${d.total === 1 ? 'reservation' : 'reservations'}${d.totalGross != null ? ` · ${rm(d.totalGross, { cents: false })} guest total` : ''}`
    : null;

  const columns = useMemo<Column<Stay>[]>(() => [
    { key: 'reference', label: 'Reservation', type: 'ref', value: s => s.externalRef, width: 150, hideable: false,
      render: s => (
        <span className="flex items-center gap-[9px] min-w-0">
          <span title={CH[s.channel].label} className="flex flex-none"><ChannelMark ch={s.channel} size={20} /></span>
          <span className="sr-only">{CH[s.channel].label}</span>
          <span className="font-mono text-meta whitespace-nowrap overflow-hidden text-ellipsis" title={s.externalRef ?? undefined}>{s.externalRef ?? '—'}</span>
        </span>
      ) },
    { key: 'channel', label: 'Channel', type: 'channel', value: s => s.channel, hidden: true, width: 130 },
    { key: 'guest', label: 'Guest', value: s => s.guestName ?? 'No guest', width: 170,
      sub: s => `${s.guestsCount} ${s.guestsCount === 1 ? 'guest' : 'guests'}` },
    { key: 'stay', label: 'Dates', type: 'date', value: s => s.checkIn, width: 160,
      render: s => <span className="whitespace-nowrap">{dateRange(s.checkIn, s.checkOut)}</span>,
      exportKind: 'text', exportValue: s => `${s.checkIn} to ${s.checkOut}` },
    { key: 'nights', label: 'Nights', type: 'number', value: s => nightsOf(s), width: 70 },
    ...(money ? [{ key: 'gross', label: 'Guest total', type: 'money', value: s => (s.grossBookingValue != null && s.grossBookingValue > 0 ? s.grossBookingValue : null), width: 110,
      render: s => <span className="font-medium tabular-nums whitespace-nowrap">{s.grossBookingValue != null && s.grossBookingValue > 0 ? rm(s.grossBookingValue, { cents: false }) : '—'}</span> }] as Column<Stay>[] : []),
    { key: 'status', label: 'Status', type: 'status', value: s => s.state, entity: 'booking', width: 130,
      render: s => <StatusBadge entity="booking" value={s.state} /> },
  ], [money]);

  return (
    <DataTable<Stay>
      id="unit.bookings" columns={columns} rows={d ? d.rows : null} rowKey={s => s.id}
      loading={q.loading} error={q.error} onRetry={q.reload}
      server={{ total: d?.total ?? 0, page: d?.page ?? page, pageSize: d?.pageSize ?? size, sizes: SIZES, defaultPageSize: PAGE_SIZE, fetchAll }}
      noViews viewParams={['when']} selectionKey={when} noun={['reservation', 'reservations']} exportName={`unit-bookings-${when}`}
      empty={{ title: WHENS.find(w => w.key === when)!.empty, icon: 'CalendarDays' }}
      header={
        <div className="py-4 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Reservations</span>
            <span className="text-meta text-muted-ink min-h-[18px]">{summary ?? (d ? '' : 'Loading…')}</span>
          </div>
          <Segmented label="Which reservations" value={when} onChange={setWhen} className="w-full sm:w-auto flex-none [&>button]:flex-1 sm:[&>button]:flex-none"
            options={WHENS.map(w => {
              const n = d?.counts[w.key];
              return { key: w.key, label: <>{w.label}{n != null && <span className={cx('ml-1.5 tabular-nums', w.key === when ? 'text-muted-ink' : 'text-faint')}>{n}</span>}</> };
            })} />
        </div>
      }
      renderCard={s => (
        <span className="flex items-center gap-3">
          <span title={CH[s.channel].label} className="flex flex-none"><ChannelMark ch={s.channel} size={26} /></span>
          <span className="flex flex-col gap-[2px] flex-1 min-w-0">
            <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{s.guestName ?? 'No guest'}</span>
            <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">
              {/* The year only when it is not this year: room for the nights on a phone row. */}
              {dateShort(s.checkIn)} – {dateShort(s.checkOut)}{d && s.checkOut.slice(0, 4) !== d.today.slice(0, 4) ? ` ${s.checkOut.slice(0, 4)}` : ''} · {nightsOf(s)} {nightsOf(s) === 1 ? 'night' : 'nights'}
            </span>
          </span>
          <span className="flex flex-col items-end gap-1 flex-none">
            {s.grossBookingValue != null && s.grossBookingValue > 0 && (
              <span className="text-copy font-medium [font-variant-numeric:tabular-nums]">{rm(s.grossBookingValue, { cents: false })}</span>
            )}
            <StatusBadge entity="booking" value={s.state} size="sm" />
          </span>
        </span>
      )}
    />
  );
}
