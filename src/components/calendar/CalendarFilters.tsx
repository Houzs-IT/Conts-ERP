import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import ChannelMark from '../ChannelMark';
import { CHANNEL, TONE } from '../../lib/vocabulary';
import type { BookingChannel, Tone } from '../../lib/types';
import { selectCls } from './types';

export const ALL_CHANNELS: BookingChannel[] = ['airbnb', 'booking_com', 'agoda', 'direct', 'maintenance_block', 'owner_stay'];

/** Booking-status filters. `blocked` is a pseudo-status: the maintenance
 *  hold channel has no reservation_state, so it filters that channel. */
export const STATUS_FILTERS: { key: string; label: string; tone: Tone }[] = [
  { key: 'confirmed', label: 'Confirmed', tone: 'info' },
  { key: 'checked_in', label: 'Checked in', tone: 'success' },
  { key: 'checked_out', label: 'Checked out', tone: 'neutral' },
  { key: 'pending', label: 'Pending', tone: 'warning' },
  { key: 'blocked', label: 'Blocked', tone: 'critical' },
];

type Off = Partial<Record<BookingChannel, boolean>>;

/** One row: property, channel toggles, a status menu and Reset. `channels` is the toggles to offer
 *  (booking sites some shown unit is on, plus direct, block and owner stay); all six if omitted. */
export function CalendarFilters({ channels = ALL_CHANNELS, properties, property, setProperty, off, setOff, statusOff, setStatusOff, onReset, dirty }: {
  channels?: BookingChannel[];
  properties: string[]; property: string; setProperty: (p: string) => void;
  off: Off; setOff: (fn: (o: Off) => Off) => void;
  statusOff: Record<string, boolean>; setStatusOff: (fn: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  onReset: () => void; dirty: boolean;
}) {
  const anyOff = channels.some(k => off[k]);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <select value={property} onChange={e => setProperty(e.target.value)} aria-label="Property"
        className={`${selectCls} h-10 md:h-8 text-[13px] w-full sm:w-auto sm:max-w-[220px]`}>
        <option value="all">All properties</option>
        {properties.map(p => <option key={p} value={p}>{p}</option>)}
      </select>

      <div role="group" aria-label="Channels" className="flex flex-wrap items-center gap-1.5">
        {channels.map(k => {
          const on = !off[k]; const c = CHANNEL[k];
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setOff(o => ({ ...o, [k]: on }))}
              title={on ? `Hide ${c.label}` : `Show ${c.label}`}
              className="inline-flex items-center gap-1.5 h-10 md:h-8 pl-1.5 md:pl-1 pr-2.5 rounded-pill border border-solid cursor-pointer font-sans text-[12.5px] font-medium transition-colors"
              style={on
                ? { background: c.tint, borderColor: `color-mix(in srgb, ${c.color} 35%, transparent)`, color: c.ink }
                : { background: 'var(--color-surface-card)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-faint)' }}>
              <ChannelMark ch={k} size={16} muted={!on} />
              {c.label}
            </button>
          );
        })}
        <button type="button" onClick={() => setOff(() => (anyOff ? {} : Object.fromEntries(channels.map(k => [k, true]))))}
          className="h-10 md:h-8 px-1.5 bg-transparent border-none cursor-pointer font-sans text-[12px] font-medium text-[var(--color-text-accent)]">
          {anyOff ? 'Select all' : 'Deselect all'}
        </button>
      </div>

      <StatusMenu statusOff={statusOff} setStatusOff={setStatusOff} />

      {dirty && (
        <button type="button" onClick={onReset}
          className="inline-flex items-center gap-1 h-10 md:h-8 px-1.5 bg-transparent border-none cursor-pointer font-sans text-[12px] font-medium text-muted-ink hover:text-ink">
          <Icon name="RotateCcw" size="sm" style={{ width: 13, height: 13 }} />Reset
        </button>
      )}
    </div>
  );
}

function StatusMenu({ statusOff, setStatusOff }: {
  statusOff: Record<string, boolean>; setStatusOff: (fn: (o: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const shown = STATUS_FILTERS.filter(s => !statusOff[s.key]);
  const summary = shown.length === STATUS_FILTERS.length ? 'All' : shown.length === 0 ? 'None' : `${shown.length} of ${STATUS_FILTERS.length}`;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 h-10 md:h-8 px-2.5 rounded-control border border-solid border-line bg-card cursor-pointer font-sans text-[12.5px] text-ink">
        <span className="text-muted-ink">Status</span>
        <span className="font-semibold">{summary}</span>
        <Icon name="ChevronDown" size="sm" style={{ width: 14, height: 14 }} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-30 min-w-[200px] p-1 bg-card border border-solid border-line rounded-control shadow-[var(--shadow-overlay)]">
          {STATUS_FILTERS.map(s => {
            const on = !statusOff[s.key];
            return (
              <button key={s.key} type="button" role="menuitemcheckbox" aria-checked={on}
                onClick={() => setStatusOff(o => ({ ...o, [s.key]: on }))}
                className="w-full flex items-center gap-2.5 h-10 md:h-8 px-2 rounded-[6px] bg-transparent hover:bg-muted border-none cursor-pointer font-sans text-[13px] text-ink text-left">
                <span className={`w-4 h-4 flex-none rounded-[4px] grid place-items-center box-border border border-solid ${on ? 'bg-black border-black' : 'bg-card border-line-strong'}`}>
                  {on && <Icon name="Check" size="sm" color="#FFFFFF" style={{ width: 12, height: 12 }} />}
                </span>
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: TONE[s.tone].line }} />
                {s.label}
              </button>
            );
          })}
          <div className="mt-1 pt-1 [border-top:1px_solid_var(--color-line-soft)] flex justify-between px-1">
            <button type="button" onClick={() => setStatusOff(() => ({}))} className="h-7 px-1 bg-transparent border-none cursor-pointer font-sans text-[12px] font-medium text-[var(--color-text-accent)]">Show all</button>
            <button type="button" onClick={() => setOpen(false)} className="h-7 px-1 bg-transparent border-none cursor-pointer font-sans text-[12px] font-medium text-muted-ink">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
