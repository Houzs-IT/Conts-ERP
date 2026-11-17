import ChannelMark from '../ChannelMark';
import { CHANNEL } from '../../lib/vocabulary';
import { statusOf, statusOptions } from '../../lib/status';
import { count } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import type { ToolbarFilter } from '../ListToolbar';
import type { BookingChannel } from '../../lib/types';

export const ALL_CHANNELS: BookingChannel[] = ['airbnb', 'booking_com', 'agoda', 'direct', 'maintenance_block', 'owner_stay'];

type Off = Partial<Record<BookingChannel, boolean>>;

/**
 * The calendar's filters in the compact toolbar (Conts DS v2): Building and the statuses to hide go in the Filters
 * panel, each with its count; the channel toggles stay on the board as a legend (prototype `rops-legend`). Filters
 * only hide bars; the free count always counts every reservation.
 */
export function calendarFilterGroups({ properties, counted, property, setProperty, statusOff, setStatusOff, statusCounts }: {
  properties: { id: string; name: string; units: number }[]; counted: boolean; property: string; setProperty: (p: string) => void;
  statusOff: Record<string, boolean>; setStatusOff: (fn: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  statusCounts?: Record<string, number>;
}): ToolbarFilter[] {
  const statuses = statusOptions('calendar').map(o => o.value);
  return [
    {
      key: 'building', label: 'Building', allLabel: 'All buildings',
      options: properties.map(p => ({ value: p.id, label: p.name, count: counted ? p.units : undefined })),
      value: property === 'all' ? '' : property,
      onChange: v => setProperty(v || 'all'),
    },
    {
      key: 'status', label: 'Hide these statuses', chipLabel: 'Hidden', multi: true,
      options: statuses.map(v => ({ value: v, label: statusOf('calendar', v).label, count: statusCounts ? statusCounts[v] ?? 0 : undefined })),
      value: statuses.filter(v => statusOff[v]).join(','),
      onChange: v => setStatusOff(() => Object.fromEntries(v.split(',').filter(Boolean).map(x => [x, true]))),
    },
  ];
}

/** The channel legend: one chip per channel with its count in the window; tap to hide or show its bars. */
export function ChannelLegend({ channels = ALL_CHANNELS, off, setOff, counts }: {
  channels?: BookingChannel[]; off: Off; setOff: (fn: (o: Off) => Off) => void; counts?: Partial<Record<BookingChannel, number>>;
}) {
  const anyOff = channels.some(k => off[k]);
  return (
    <div role="group" aria-label="Channels" className="flex flex-wrap items-center gap-1.5 min-w-0">
      {channels.map(k => {
        const on = !off[k]; const c = CHANNEL[k];
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => setOff(o => ({ ...o, [k]: on }))}
            title={on ? `Hide ${c.label}` : `Show ${c.label}`}
            className={cx('inline-flex items-center gap-1.5 h-10 md:h-7 pl-1 pr-2.5 rounded-pill border border-solid border-line bg-card cursor-pointer font-sans text-meta font-semibold text-ink-2',
              !on && 'opacity-45 line-through')}>
            <ChannelMark ch={k} size={16} muted={!on} />
            {c.label}
            {counts && <span className="font-normal text-muted-ink tabular-nums no-underline">{count(counts[k] ?? 0)}</span>}
          </button>
        );
      })}
      <button type="button" onClick={() => setOff(() => (anyOff ? {} : Object.fromEntries(channels.map(k => [k, true]))))}
        className="h-10 md:h-7 px-1.5 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-[var(--color-text-accent)]">
        {anyOff ? 'Select all' : 'Deselect all'}
      </button>
    </div>
  );
}
