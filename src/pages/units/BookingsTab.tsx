import { useSearchParams } from 'react-router-dom';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import ChannelMark from '../../components/ChannelMark';
import { ListPager } from '../../components/ListPager';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { channel as CH } from '../../theme';
import { cx } from '../../lib/design-tokens';
import { useApi } from '../../lib/useApi';
import { rm, dateRange, dateShort, count } from '../../lib/format';
import { type UnitDetail } from './shared';

type When = 'upcoming' | 'past' | 'cancelled' | 'all';
const WHENS: { key: When; label: string; empty: string }[] = [
  { key: 'upcoming', label: 'Upcoming', empty: 'No upcoming bookings for this unit.' },
  { key: 'past', label: 'Past', empty: 'No past bookings for this unit.' },
  { key: 'cancelled', label: 'Cancelled', empty: 'No cancelled bookings for this unit.' },
  { key: 'all', label: 'All', empty: 'No bookings for this unit yet.' },
];
const isWhen = (s: string | null): s is When => WHENS.some(w => w.key === s);
const PAGE_SIZE = 20;

type Stay = UnitDetail['stays'][number];
interface StaysPage {
  when: When; page: number; pageSize: number; total: number; today: string;
  counts: Record<When, number>; totalGross?: number; rows: Stay[];
}

const COLS = 'grid-cols-[minmax(130px,1.2fr)_minmax(150px,1.5fr)_minmax(150px,1.3fr)_64px_minmax(96px,0.9fr)_minmax(104px,0.9fr)]';
const nightsOf = (s: Stay) => Math.max(0, Math.round((Date.parse(s.checkOut) - Date.parse(s.checkIn)) / 864e5));

/** The unit's bookings, a page at a time. Filter and page live in the address (?when=&page=). */
export default function BookingsTab({ unitId }: { unitId: string }) {
  const [params, setParams] = useSearchParams();
  const when: When = isWhen(params.get('when')) ? (params.get('when') as When) : 'upcoming';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = useApi<StaysPage>(`/units/stays?unitId=${encodeURIComponent(unitId)}&when=${when}&page=${page}&pageSize=${PAGE_SIZE}`);
  // The previous page stays on screen while the next one loads, so rows never blank out.
  const d = q.data;
  const stale = q.loading && !!d;

  const set = (next: { when?: When; page?: number }) => setParams(p => {
    const n = new URLSearchParams(p);
    const w = next.when ?? when, pg = next.page ?? (next.when ? 1 : page);
    if (w === 'upcoming') n.delete('when'); else n.set('when', w);
    if (pg <= 1) n.delete('page'); else n.set('page', String(pg));
    return n;
  }, { replace: true });

  const money = d?.rows.some(r => r.grossBookingValue !== undefined) ?? false;
  const summary = d && d.total > 0
    ? `${count(d.total)} ${d.total === 1 ? 'booking' : 'bookings'}${d.totalGross != null ? ` · ${rm(d.totalGross, { cents: false })} gross` : ''}`
    : null;

  return (
    <Card>
      <div className="py-4 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-heading font-semibold">Bookings</span>
          <span className="text-meta text-muted-ink min-h-[18px]">{summary ?? (d ? '' : 'Loading…')}</span>
        </div>
        <div role="group" aria-label="Which bookings" className="flex w-full sm:w-auto sm:inline-flex overflow-x-auto [scrollbar-width:none] border border-solid border-line rounded-control flex-none">
          {WHENS.map((w, i) => {
            const on = w.key === when;
            const n = d?.counts[w.key];
            return (
              <button key={w.key} type="button" aria-pressed={on} onClick={() => set({ when: w.key })}
                className={cx('h-9 sm:h-8 px-2 sm:px-3 cursor-pointer [font:inherit] text-meta! whitespace-nowrap [border-top:0] [border-right:0] [border-bottom:0] flex-1 sm:flex-none',
                  i === 0 ? '[border-left:0]' : '[border-left:1px_solid_var(--color-line)]', on ? 'bg-black text-white' : 'bg-card text-muted-ink')}>
                {w.label}{n != null && <span className={cx('ml-1.5 [font-variant-numeric:tabular-nums]', on ? 'text-white/70' : 'text-faint')}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {q.error && !d && <div className="p-4"><StaleBanner message={q.error} onRetry={q.reload} /></div>}
      {!d && !q.error && <TableSkeleton rows={6} cols={5} />}
      {d && d.rows.length === 0 && (
        <div className="py-10 px-5 text-center text-copy text-muted-ink">{WHENS.find(w => w.key === when)!.empty}</div>
      )}

      {d && d.rows.length > 0 && (
        <div className={cx('transition-opacity duration-150', stale && 'opacity-60')} aria-busy={stale}>
          <div className={cx(COLS, 'hidden md:grid gap-[14px] py-[9px] px-5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-meta font-semibold text-muted-ink')}>
            <div>Booking</div><div>Guest</div><div>Dates</div><div className="text-right">Nights</div>
            <div className="text-right">{money ? 'Gross' : ''}</div><div>Status</div>
          </div>
          {d.rows.map(s => (
            <div key={s.id}>
              {/* Desktop row */}
              <div className={cx(COLS, 'hidden md:grid gap-[14px] items-center min-h-[52px] py-[8px] px-5 [border-bottom:1px_solid_var(--color-line-soft)]')}>
                <div className="flex items-center gap-[9px] min-w-0">
                  <span title={CH[s.channel].label} className="flex flex-none"><ChannelMark ch={s.channel} size={20} /></span>
                  <span className="sr-only">{CH[s.channel].label}</span>
                  <span className="font-mono text-meta whitespace-nowrap overflow-hidden text-ellipsis" title={s.externalRef ?? undefined}>{s.externalRef ?? '—'}</span>
                </div>
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-copy whitespace-nowrap overflow-hidden text-ellipsis" title={s.guestName ?? undefined}>{s.guestName ?? 'No guest'}</span>
                  <span className="text-meta text-muted-ink">{s.guestsCount} {s.guestsCount === 1 ? 'guest' : 'guests'}</span>
                </div>
                <span className="text-copy whitespace-nowrap">{dateRange(s.checkIn, s.checkOut)}</span>
                <span className="text-copy text-right [font-variant-numeric:tabular-nums]">{nightsOf(s)}</span>
                <span className="text-copy text-right font-medium [font-variant-numeric:tabular-nums] whitespace-nowrap">
                  {s.grossBookingValue != null && s.grossBookingValue > 0 ? rm(s.grossBookingValue, { cents: false }) : money ? '—' : ''}
                </span>
                <div><StatusBadge entity="booking" value={s.state} /></div>
              </div>
              {/* Phone row */}
              <div className="md:hidden flex items-center gap-3 py-3 px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
                <span title={CH[s.channel].label} className="flex flex-none"><ChannelMark ch={s.channel} size={26} /></span>
                <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                  <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{s.guestName ?? 'No guest'}</span>
                  <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">
                    {/* The year only when it is not this year: room for the nights on a phone row. */}
                    {dateShort(s.checkIn)} – {dateShort(s.checkOut)}{s.checkOut.slice(0, 4) !== d.today.slice(0, 4) ? ` ${s.checkOut.slice(0, 4)}` : ''} · {nightsOf(s)} {nightsOf(s) === 1 ? 'night' : 'nights'}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1 flex-none">
                  {s.grossBookingValue != null && s.grossBookingValue > 0 && (
                    <span className="text-copy font-medium [font-variant-numeric:tabular-nums]">{rm(s.grossBookingValue, { cents: false })}</span>
                  )}
                  <StatusBadge entity="booking" value={s.state} size="sm" />
                </div>
              </div>
            </div>
          ))}
          <ListPager page={d.page} pageSize={d.pageSize} total={d.total} onPage={p => set({ page: p })} busy={stale} noun="bookings" />
        </div>
      )}
    </Card>
  );
}
