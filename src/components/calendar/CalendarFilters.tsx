import Icon from '../Icon';
import ChannelMark from '../ChannelMark';
import { Button } from '../Button';
import { Select } from '../Select';
import { CHANNEL } from '../../lib/vocabulary';
import { StatusFilterMenu } from '../StatusBadge';
import type { BookingChannel } from '../../lib/types';
import { plural } from '../../lib/format';

export const ALL_CHANNELS: BookingChannel[] = ['airbnb', 'booking_com', 'agoda', 'direct', 'maintenance_block', 'owner_stay'];

type Off = Partial<Record<BookingChannel, boolean>>;

/** One row: property, channel toggles, a status menu and Reset. `channels` is the toggles to offer
 *  (booking sites some shown unit is on, plus direct, block and owner stay); all six if omitted. */
export function CalendarFilters({ channels = ALL_CHANNELS, properties, counted = true, property, setProperty, off, setOff, statusOff, setStatusOff, onReset, dirty }: {
  channels?: BookingChannel[];
  properties: { id: string; name: string; units: number }[]; counted?: boolean; property: string; setProperty: (p: string) => void;
  off: Off; setOff: (fn: (o: Off) => Off) => void;
  statusOff: Record<string, boolean>; setStatusOff: (fn: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  onReset: () => void; dirty: boolean;
}) {
  const anyOff = channels.some(k => off[k]);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <Select label="Building" value={property} onChange={setProperty} className="w-full sm:w-[240px]"
        options={[
          // vocab-ok: properties is the prop's name; the label itself says buildings
          { value: 'all', label: counted ? `All buildings (${plural(properties.reduce((n, p) => n + p.units, 0), 'unit')})` : 'All buildings' },
          ...properties.map(p => ({ value: p.id, label: `${p.name} (${p.units})` })),
        ]} />

      <div role="group" aria-label="Channels" className="flex flex-wrap items-center gap-1.5">
        {channels.map(k => {
          const on = !off[k]; const c = CHANNEL[k];
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setOff(o => ({ ...o, [k]: on }))}
              title={on ? `Hide ${c.label}` : `Show ${c.label}`}
              className="inline-flex items-center gap-1.5 h-10 md:h-8 pl-1.5 md:pl-1 pr-2.5 rounded-pill border border-solid cursor-pointer font-sans text-copy font-medium transition-colors"
              style={on
                ? { background: c.tint, borderColor: `color-mix(in srgb, ${c.color} 35%, transparent)`, color: c.ink }
                : { background: 'var(--color-surface-card)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-faint)' }}>
              <ChannelMark ch={k} size={16} muted={!on} />
              {c.label}
            </button>
          );
        })}
        <button type="button" onClick={() => setOff(() => (anyOff ? {} : Object.fromEntries(channels.map(k => [k, true]))))}
          className="h-10 md:h-8 px-1.5 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-[var(--color-text-accent)]">
          {anyOff ? 'Select all' : 'Deselect all'}
        </button>
      </div>

      <StatusFilterMenu entity="calendar" off={statusOff} onChange={setStatusOff} />

      {dirty && (
        <Button variant="tertiary" size="sm" icon={<Icon name="RotateCcw" size="sm" />} onClick={onReset}>Clear filters</Button>
      )}
    </div>
  );
}
