import { useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { dateShort, monthLabel, plural, weekdayDate, year } from '../../lib/format';

/* Day arithmetic on bare YYYY-MM-DD strings, in UTC so no time zone can shift a day. */
export const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** Monday of the week the day falls in. */
export const mondayOf = (d: string) => addDaysIso(d, -((weekday(d) + 6) % 7));
const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
const monthLength = (d: string) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const shiftMonth = (d: string, n: number) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); };
const ymd = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: string | null | undefined): v is string => !!v && ymd.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** "11–24 Oct 2026" or "28 Sep – 11 Oct 2026": the shortest unambiguous label for an inclusive range. */
export function rangeLabel(first: string, last: string, withYear = true) {
  const y = withYear ? ` ${year(last)}` : '';
  if (first === last) return `${dateShort(first)}${y}`;
  if (first.slice(0, 7) === last.slice(0, 7)) return `${Number(first.slice(8))}–${dateShort(last)}${y}`;
  return `${dateShort(first)} – ${dateShort(last)}${year(first) !== year(last) && withYear ? ` ${year(first)}` : ''}${y}`;
}

/** One month of days, Monday first. Days between `from` and `to` are shaded; `today` is ringed. */
export function MonthGrid({ month, today, from, to, onPick, onMonth }: {
  month: string; today: string; from?: string; to?: string; onPick: (day: string) => void; onMonth: (month: string) => void;
}) {
  const first = firstOfMonth(month);
  const lead = (weekday(first) + 6) % 7;
  const n = monthLength(first);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => addDaysIso(first, i))];
  while (cells.length % 7) cells.push(null);
  const nav = 'w-8 h-8 grid place-items-center rounded-control border-none bg-transparent hover:bg-muted cursor-pointer text-ink';
  return (
    <div className="w-[252px] max-w-full">
      <div className="flex items-center justify-between mb-1">
        <button type="button" className={nav} onClick={() => onMonth(shiftMonth(first, -1))} aria-label="Previous month"><Icon name="ChevronLeft" size="sm" /></button>
        <span className="text-copy font-semibold">{monthLabel(first, { long: true })}</span>
        <button type="button" className={nav} onClick={() => onMonth(shiftMonth(first, 1))} aria-label="Next month"><Icon name="ChevronRight" size="sm" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-caption text-muted-ink mb-0.5" aria-hidden>
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <span key={d} className="h-6 leading-6">{d}</span>)}
      </div>
      <div role="grid" className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const inRange = !!from && !!to && d >= from && d <= to;
          const edge = d === from || d === to;
          return (
            <button key={d} type="button" role="gridcell" aria-selected={inRange} onClick={() => onPick(d)} aria-label={weekdayDate(d)}
              className={cx('h-9 md:h-8 p-0 border-none cursor-pointer font-sans text-copy [font-variant-numeric:tabular-nums]',
                edge ? 'bg-black text-white font-semibold rounded-control' : inRange ? 'bg-gold-tint text-ink' : 'bg-transparent text-ink hover:bg-muted rounded-control',
                d === today && !edge && 'font-semibold [box-shadow:inset_0_0_0_1.5px_var(--color-gold)] rounded-control')}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A popover anchored under its trigger on desktop, a sheet along the bottom on phones. Escape or a click outside closes it. */
export function Popover({ open, onClose, phone, children, align = 'left', label }: {
  open: boolean; onClose: () => void; phone: boolean; children: ReactNode; align?: 'left' | 'right'; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-popover-trigger]')) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      {phone && <div aria-hidden className="fixed inset-0 z-[60] bg-black/30" />}
      <div ref={ref} role="dialog" aria-label={label}
        className={phone
          ? 'fixed left-0 right-0 bottom-0 z-[61] bg-card rounded-t-[14px] shadow-[var(--shadow-overlay)] p-4 pb-[max(16px,env(safe-area-inset-bottom))] max-h-[85dvh] overflow-y-auto'
          : cx('absolute top-[calc(100%+6px)] z-[61] bg-card rounded-card border border-solid border-line shadow-[var(--shadow-overlay)] p-3', align === 'right' ? 'right-0' : 'left-0')}>
        {children}
      </div>
    </>
  );
}

const quickBtn = 'h-9 md:h-8 px-2.5 text-left rounded-control border-none bg-transparent hover:bg-muted cursor-pointer font-sans text-copy text-ink whitespace-nowrap';
const sizeBtn = (on: boolean) => cx('h-9 md:h-8 px-2.5 rounded-pill border border-solid cursor-pointer font-sans text-meta whitespace-nowrap',
  on ? 'bg-black text-white border-black font-semibold' : 'bg-card text-ink border-line hover:bg-muted font-medium');

export const WINDOW_SIZES = [7, 14, 30] as const;
export const MAX_WINDOW = 92;
/** How many days before today a window opens on when it follows today: today then sits near the left edge with
 *  the last two check-outs still in view, as on Airbnb's multi-calendar. */
export const LEAD_DAYS = 2;

/**
 * The Calendar's date control: [<] [11 Oct – 9 Nov 2026 v] [>] [Today]. The label opens a month picker to jump to
 * any day, quick ranges, and the window size (1 week, 2 weeks, 30 days or a custom length up to the API's 92 days).
 */
export function CalendarRangeControl({ start, days, today, phone, onChange, isDefault }: {
  start: string; days: number; today: string; phone: boolean; isDefault: boolean;
  onChange: (start: string | null, days: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const last = addDaysIso(start, days - 1);
  const [month, setMonth] = useState(firstOfMonth(start));
  const [customDays, setCustomDays] = useState(String(days));
  useEffect(() => { if (open) { setMonth(firstOfMonth(start)); setCustomDays(String(days)); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = Math.min(7, days);
  const go = (s: string | null, n = days) => { onChange(s, Math.max(1, Math.min(MAX_WINDOW, n))); };
  const monthStart = firstOfMonth(today), nextMonth = shiftMonth(today, 1);
  const quick: { label: string; on: () => void }[] = [
    { label: 'Today', on: () => go(null) },
    { label: 'This week', on: () => go(mondayOf(today), 7) },
    { label: 'Next 2 weeks', on: () => go(today, 14) },
    { label: 'This month', on: () => go(monthStart, monthLength(monthStart)) },
    { label: 'Next month', on: () => go(nextMonth, monthLength(nextMonth)) },
  ];
  const custom = !WINDOW_SIZES.includes(days as typeof WINDOW_SIZES[number]);
  const seg = 'h-full min-w-10 md:min-w-0 px-2.5 grid place-items-center bg-transparent hover:bg-muted border-none cursor-pointer font-sans text-copy text-ink';
  const n = Number(customDays);
  const customOk = Number.isInteger(n) && n >= 1 && n <= MAX_WINDOW;

  return (
    <div className="relative flex flex-1 md:flex-none min-w-0">
      <div className="flex flex-1 md:flex-none min-w-0 items-stretch h-[42px] md:h-9 box-border rounded-control border border-solid border-line bg-card overflow-hidden">
        <button type="button" onClick={() => go(addDaysIso(start, -step))} className={seg} aria-label={`Back ${plural(step, 'day')}`} title={`Back ${plural(step, 'day')}`}><Icon name="ChevronLeft" size="sm" /></button>
        <button type="button" data-popover-trigger onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="dialog"
          title="Pick dates"
          className="flex-1 md:flex-none min-w-0 px-2 md:px-3 inline-flex items-center justify-center gap-1.5 bg-transparent hover:bg-muted border-none [border-left:1px_solid_var(--color-line)] [border-right:1px_solid_var(--color-line)] cursor-pointer font-sans text-copy font-medium text-ink whitespace-nowrap [font-variant-numeric:tabular-nums] md:min-w-[176px]">
          {!phone && <Icon name="CalendarDays" size="sm" color="var(--color-text-muted)" />}
          <span className="min-w-0 overflow-hidden">{rangeLabel(start, last, !phone)}</span>
          <Icon name="ChevronDown" size="sm" color="var(--color-text-muted)" />
        </button>
        <button type="button" onClick={() => go(addDaysIso(start, step))} className={seg} aria-label={`Forward ${plural(step, 'day')}`} title={`Forward ${plural(step, 'day')}`}><Icon name="ChevronRight" size="sm" /></button>
        <button type="button" onClick={() => go(null)} disabled={isDefault}
          className={`${seg} [border-left:1px_solid_var(--color-line)]! px-2 md:px-3 font-medium disabled:text-faint disabled:cursor-default disabled:hover:bg-transparent`}>Today</button>
      </div>
      <Popover open={open} onClose={() => setOpen(false)} phone={phone} label="Pick dates">
        <div className="flex flex-col md:flex-row gap-3 md:gap-4">
          <div className="flex md:flex-col gap-1 overflow-x-auto [scrollbar-width:none] md:w-[124px] md:[border-right:1px_solid_var(--color-line-soft)] md:pr-3">
            {quick.map(q => (
              <button key={q.label} type="button" className={cx(quickBtn, 'max-md:border max-md:border-solid max-md:border-line max-md:rounded-pill')} onClick={() => { q.on(); setOpen(false); }}>{q.label}</button>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <MonthGrid month={month} today={today} from={start} to={last} onMonth={setMonth}
              onPick={d => { go(d); setOpen(false); }} />
            <div className="flex flex-col gap-1.5">
              <span className="text-meta text-muted-ink">Show</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {WINDOW_SIZES.map(s => (
                  <button key={s} type="button" className={sizeBtn(days === s)} aria-pressed={days === s} onClick={() => { go(start, s); setOpen(false); }}>
                    {s === 7 ? '1 week' : s === 14 ? '2 weeks' : '30 days'}
                  </button>
                ))}
                <label className={cx(sizeBtn(custom), 'inline-flex items-center gap-1 pr-1.5 cursor-text')}>
                  <input type="number" inputMode="numeric" min={1} max={MAX_WINDOW} value={customDays} aria-label={`Custom number of days, up to ${MAX_WINDOW}`}
                    onChange={e => setCustomDays(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && customOk) { go(start, n); setOpen(false); } }}
                    className="w-10 h-6 border-none bg-transparent text-inherit font-sans text-meta text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  days
                </label>
                <button type="button" disabled={!customOk || n === days} onClick={() => { go(start, n); setOpen(false); }}
                  className="h-9 md:h-8 px-2 rounded-control border-none bg-transparent cursor-pointer font-sans text-meta font-semibold text-[var(--color-text-accent)] disabled:text-faint disabled:cursor-default">Apply</button>
              </div>
              {!customOk && customDays !== '' && <span className="text-meta text-danger">Pick 1 to {MAX_WINDOW} days.</span>}
            </div>
          </div>
        </div>
      </Popover>
    </div>
  );
}

/**
 * A compact one-day picker: [< Sat 11 Oct v >] with Today and Tomorrow inside the menu. Used where a list shows one
 * day at a time (the Cleaning board), so it reads like the Calendar's control instead of a bare browser date box.
 */
export function DayPicker({ value, today, phone, onChange, label = 'Day' }: {
  value: string; today: string; phone: boolean; onChange: (day: string) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(firstOfMonth(value));
  useEffect(() => { if (open) setMonth(firstOfMonth(value)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const seg = 'h-full min-w-10 md:min-w-9 px-2 grid place-items-center bg-transparent hover:bg-muted border-none cursor-pointer font-sans text-copy text-ink';
  const tomorrow = addDaysIso(today, 1);
  const word = value === today ? 'Today' : value === tomorrow ? 'Tomorrow' : value === addDaysIso(today, -1) ? 'Yesterday' : null;
  const chip = (d: string, text: string) => (
    <button type="button" className={sizeBtn(value === d)} aria-pressed={value === d} onClick={() => { onChange(d); setOpen(false); }}>{text}</button>
  );
  return (
    <div className="relative flex min-w-0">
      <div role="group" aria-label={label} className="flex min-w-0 items-stretch h-[42px] md:h-9 box-border rounded-control border border-solid border-line bg-card overflow-hidden">
        <button type="button" className={seg} onClick={() => onChange(addDaysIso(value, -1))} aria-label="Previous day" title="Previous day"><Icon name="ChevronLeft" size="sm" /></button>
        <button type="button" data-popover-trigger onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="dialog" title="Pick a day"
          className="min-w-0 px-2.5 inline-flex items-center gap-1.5 bg-transparent hover:bg-muted border-none [border-left:1px_solid_var(--color-line)] [border-right:1px_solid_var(--color-line)] cursor-pointer font-sans text-copy text-ink whitespace-nowrap [font-variant-numeric:tabular-nums]">
          <Icon name="CalendarDays" size="sm" color="var(--color-text-muted)" />
          {word && <b className="font-semibold">{word}</b>}
          <span className={word ? 'text-muted-ink' : 'font-medium'}>{weekdayDate(value)}</span>
          <Icon name="ChevronDown" size="sm" color="var(--color-text-muted)" />
        </button>
        <button type="button" className={seg} onClick={() => onChange(addDaysIso(value, 1))} aria-label="Next day" title="Next day"><Icon name="ChevronRight" size="sm" /></button>
      </div>
      <Popover open={open} onClose={() => setOpen(false)} phone={phone} label={`Pick a ${label.toLowerCase()}`}>
        <div className="flex flex-col gap-2.5">
          <div className="flex gap-1.5">{chip(addDaysIso(today, -1), 'Yesterday')}{chip(today, 'Today')}{chip(tomorrow, 'Tomorrow')}</div>
          <MonthGrid month={month} today={today} from={value} to={value} onMonth={setMonth} onPick={d => { onChange(d); setOpen(false); }} />
        </div>
      </Popover>
    </div>
  );
}
