import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { Floating } from './DataTableParts';
import { cx } from '../lib/design-tokens';
import { useMedia } from '../lib/useMedia';
import { count as fmtCount, date as fmtDate, dateRange, dateShort, todayMyt } from '../lib/format';
import { DateField } from './inputs';

/**
 * The one compact toolbar above a list or a report (redesign phase 2, the prototype's toolbar): search, then a Filters
 * button with a count that opens grouped choices (each with its count), a date button with presets, and whatever the
 * page keeps beside them (a month stepper, a view switch). What is narrowed shows underneath as small removable chips
 * with Clear all, and the list updates at once. Below 640px the panels open as bottom sheets.
 *
 * It only arranges the controls: every value stays in the page (its URL or state), so a page keeps its behaviour.
 */

export interface ToolbarOption { value: string; label: string; count?: number; /** A channel mark or icon before the label. */ icon?: ReactNode }

export interface ToolbarFilter {
  key: string;
  /** Group title in the panel and the chip's prefix ("Building: Agile"). */
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ToolbarOption[];
  /** The "everything" choice, listed first. Its value is `all` (default ''); picking it removes the chip. */
  allLabel?: string;
  all?: string;
  /** Several values at once: `value` holds them comma-separated, each its own chip. */
  multi?: boolean;
  /** The chip's prefix when it differs from the group title ("Hidden" for "Hide these statuses"). */
  chipLabel?: string;
}

export interface ToolbarDate {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets: { value: string; label: string; sub?: string }[];
  /** The preset that counts as "not narrowed"; when set, any other preset also shows as a chip. */
  def?: string;
  /** A custom From / To under the presets (inclusive dates). */
  custom?: { from: string; to: string; onApply: (from: string, to: string) => void };
}

/** A chip the page builds itself (a range, a quick filter), removable on its own. */
export interface ToolbarChip { key: string; label: string; onRemove: () => void }

export function ListToolbar({ search, leading, filters = [], filtersLabel = 'Filters', panelExtra, chips: extraChips = [], date, after, right, below, count, bare, className, onClearAll }: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; debounce?: boolean };
  /** Controls before Filters, e.g. a unit picker. */
  leading?: ReactNode;
  filters?: ToolbarFilter[];
  /** More inside the Filters panel (a range filter), under the groups. */
  panelExtra?: ReactNode;
  chips?: ToolbarChip[];
  date?: ToolbarDate;
  /** Controls after the date, on the same row (a month stepper, Grouped / List). */
  after?: ReactNode;
  /** Pushed to the right end of the row (Export, a view switch). */
  right?: ReactNode;
  /** A second row inside the toolbar: the page's one either/or view switch (contract, status) with its counts. */
  below?: ReactNode;
  /** "Showing 12 of 130", at the end of the chip row. */
  count?: ReactNode;
  /** Inside another card: no card of its own. */
  bare?: boolean;
  className?: string;
  /** The panel button's name when the table below already has its own Filters button (one group, e.g. "Department"). */
  filtersLabel?: string;
  /** Extra resets for Clear all (the page's own chips); filters and search are cleared already. */
  onClearAll?: () => void;
}) {
  const [panel, setPanel] = useState<null | 'filters' | 'date'>(null);
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const dateBtn = useRef<HTMLButtonElement>(null);

  const allOf = (f: ToolbarFilter) => f.all ?? '';
  const valuesOf = (f: ToolbarFilter) => (f.multi ? f.value.split(',').filter(Boolean) : f.value !== allOf(f) ? [f.value] : []);
  const onFilters = filters.filter(f => valuesOf(f).length > 0);
  const nFilters = onFilters.reduce((n, f) => n + valuesOf(f).length, 0) + extraChips.length;
  const datePreset = date ? date.presets.find(p => p.value === date.value) ?? date.presets[0] : null;
  const dateOn = !!date && date.def !== undefined && date.value !== date.def;

  const chips: ToolbarChip[] = [];
  if (search && search.value.trim()) chips.push({ key: '_search', label: `Search: ${search.value.trim()}`, onRemove: () => search.onChange('') });
  for (const f of onFilters) {
    for (const v of valuesOf(f)) {
      const o = f.options.find(x => x.value === v);
      chips.push({ key: `${f.key}:${v}`, label: `${f.chipLabel ?? f.label}: ${o?.label ?? v}`,
        onRemove: () => f.onChange(f.multi ? valuesOf(f).filter(x => x !== v).join(',') : allOf(f)) });
    }
  }
  chips.push(...extraChips);
  if (date && dateOn && datePreset) chips.push({ key: '_date', label: `${date.label}: ${datePreset.label}`, onRemove: () => date.onChange(date.def!) });
  const clearAll = () => {
    if (search) search.onChange('');
    for (const f of filters) if (f.value !== allOf(f)) f.onChange(allOf(f));
    for (const c of extraChips) c.onRemove();
    if (date && dateOn) date.onChange(date.def!);
    onClearAll?.();
  };

  const hasFilters = filters.length > 0 || !!panelExtra;
  const row = (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      {search && <ToolbarSearch {...search} />}
      {leading}
      {hasFilters && (
        <TbButton btnRef={filtersBtn} icon="ListFilter" on={nFilters > 0} expanded={panel === 'filters'} onClick={() => setPanel(p => (p === 'filters' ? null : 'filters'))}
          label={nFilters ? `${filtersLabel}, ${nFilters} on` : filtersLabel}>
          {filtersLabel}{nFilters > 0 && <span className="min-w-[18px] h-[18px] px-[5px] grid place-items-center rounded-full bg-primary text-on-primary text-caption font-semibold tabular-nums">{nFilters}</span>}
        </TbButton>
      )}
      {date && datePreset && (
        <TbButton btnRef={dateBtn} icon="CalendarDays" on={dateOn} expanded={panel === 'date'} onClick={() => setPanel(p => (p === 'date' ? null : 'date'))} label={`${date.label}: ${datePreset.label}`} caret>
          <span className="truncate">{datePreset.label}</span>
        </TbButton>
      )}
      {after}
      {right && <span className="ml-auto flex items-center gap-1.5 flex-wrap max-sm:ml-0">{right}</span>}
    </div>
  );

  const chipRow = (chips.length > 0 || count) ? (
    <div className="flex flex-wrap items-center gap-1.5 mt-[7px]">
      {chips.map(c => (
        <span key={c.key} className="inline-flex items-center gap-0.5 h-6 max-sm:h-8 pl-[9px] pr-[3px] max-w-full rounded-full bg-muted border border-solid border-line-soft text-meta text-ink-2">
          <span className="truncate">{c.label}</span>
          <button type="button" onClick={c.onRemove} aria-label={`Remove ${c.label}`}
            className="w-5 h-5 max-sm:w-7 max-sm:h-7 grid place-items-center rounded-full border-none bg-transparent text-muted-ink cursor-pointer hover:bg-line-soft hover:text-ink">
            <Icon name="X" size="sm" style={{ width: 12, height: 12 }} />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={clearAll} className="h-6 px-1 border-none bg-transparent text-meta font-semibold text-primary cursor-pointer hover:underline">Clear all</button>
      )}
      {count && <span className="ml-auto text-meta text-muted-ink max-sm:ml-0 max-sm:basis-full">{count}</span>}
    </div>
  ) : null;

  return (
    <section aria-label="List tools" className={cx(!bare && 'bg-card border border-solid border-line rounded-card shadow-[var(--shadow-card)] px-2.5 py-2', 'min-w-0', className)}>
      {row}
      {below && <div className="flex flex-wrap items-center gap-2 mt-2 min-w-0">{below}</div>}
      {chipRow}
      <Panel open={panel === 'filters'} anchor={filtersBtn} onClose={() => setPanel(null)} label={filtersLabel}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <b className="text-copy">{filtersLabel}</b>
          {nFilters > 0 && <button type="button" onClick={() => { for (const f of onFilters) f.onChange(allOf(f)); for (const c of extraChips) c.onRemove(); }}
            className="h-7 px-1 border-none bg-transparent text-meta font-semibold text-primary cursor-pointer">Clear all</button>}
        </div>
        {filters.map(f => (
          <div key={f.key} className="py-1.5">
            <h5 className="m-0 mb-1.5 text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">{f.label}</h5>
            <div className="flex flex-wrap gap-1.5">
              {[...(f.allLabel ? [{ value: allOf(f), label: f.allLabel } as ToolbarOption] : []), ...f.options].map(o => {
                const vs = valuesOf(f);
                const picked = f.multi ? (o.value === allOf(f) ? vs.length === 0 : vs.includes(o.value)) : f.value === o.value;
                const empty = o.count === 0 && !picked;
                const pick = () => f.onChange(!f.multi || o.value === allOf(f) ? o.value : (picked ? vs.filter(x => x !== o.value) : [...vs, o.value]).join(','));
                return (
                  <button key={o.value} type="button" aria-pressed={picked} disabled={empty} onClick={pick}
                    className={cx('inline-flex items-center gap-1.5 min-h-[30px] max-sm:min-h-10 max-w-full px-2.5 rounded-full border border-solid font-sans text-meta font-medium cursor-pointer',
                      picked ? 'bg-black border-black text-white' : empty ? 'bg-card border-line-soft text-faint cursor-not-allowed' : 'bg-card border-line text-ink hover:bg-muted')}>
                    {o.icon}
                    <span className="truncate">{o.label}</span>
                    {o.count !== undefined && <span className={cx('tabular-nums', picked ? 'opacity-75' : 'text-muted-ink')}>{fmtCount(o.count)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {panelExtra && <div className="py-1.5">{panelExtra}</div>}
      </Panel>
      {date && (
        <Panel open={panel === 'date'} anchor={dateBtn} onClose={() => setPanel(null)} label={date.label} width={260}>
          <h5 className="m-0 mb-1 text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">{date.label}</h5>
          {date.presets.map(p => (
            <button key={p.value} type="button" aria-pressed={p.value === date.value} onClick={() => { date.onChange(p.value); setPanel(null); }}
              className={cx('w-full flex items-center justify-between gap-3 min-h-9 max-sm:min-h-11 px-2 rounded-[8px] border-none font-sans text-copy text-left cursor-pointer',
                p.value === date.value ? 'bg-muted text-ink font-semibold' : 'bg-transparent text-ink hover:bg-muted')}>
              <span>{p.label}</span>
              <span className="text-meta text-muted-ink font-normal">{p.sub ?? ''}</span>
            </button>
          ))}
          {date.custom && <CustomRange {...date.custom} onDone={() => setPanel(null)} />}
        </Panel>
      )}
    </section>
  );
}

/** A toolbar button: icon, label, an optional caret; dark outline while it narrows the list. */
export function TbButton({ icon, children, on, expanded, onClick, label, caret, btnRef }: {
  icon: string; children: ReactNode; on?: boolean; expanded?: boolean; onClick: () => void; label: string; caret?: boolean; btnRef?: RefObject<HTMLButtonElement>;
}) {
  return (
    <button ref={btnRef} type="button" onClick={onClick} aria-haspopup="dialog" aria-expanded={expanded} aria-label={label}
      className={cx('inline-flex items-center gap-1.5 h-[34px] max-sm:h-10 max-w-full px-2.5 rounded-control border border-solid bg-card font-sans text-copy font-semibold whitespace-nowrap cursor-pointer outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-gold)]',
        on ? 'border-ink text-ink' : 'border-line text-ink-2 hover:bg-muted')}>
      <Icon name={icon} size="sm" />
      {children}
      {caret && <Icon name="ChevronDown" size="sm" style={{ width: 12, height: 12 }} />}
    </button>
  );
}

export function ToolbarSearch({ value, onChange, placeholder, label, debounce = true, className }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; debounce?: boolean; className?: string }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setText(value); last.current = value; } }, [value]);
  useEffect(() => {
    if (!debounce || text === last.current) return;
    const t = setTimeout(() => { last.current = text; onChange(text); }, 250);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className={cx('relative flex items-center flex-[1_1_220px] min-w-[180px] max-w-[360px] max-sm:max-w-none', className)}>
      <span className="sr-only">{label ?? placeholder}</span>
      <span className="absolute left-2.5 flex text-muted-ink pointer-events-none"><Icon name="Search" size="sm" /></span>
      <input type="search" value={text} placeholder={placeholder} aria-label={label ?? placeholder}
        onChange={e => { setText(e.target.value); if (!debounce) { last.current = e.target.value; onChange(e.target.value); } }}
        className="block w-full box-border h-[34px] max-sm:h-10 pl-8 pr-2.5 rounded-control border border-solid border-line bg-card font-sans text-copy text-ink outline-none focus:border-ink" />
    </label>
  );
}

/** A popover beside its button on a wide screen; a bottom sheet over a scrim below 640px. */
function Panel({ open, anchor, onClose, label, width = 340, children }: {
  open: boolean; anchor: RefObject<HTMLButtonElement>; onClose: () => void; label: string; width?: number; children: ReactNode;
}) {
  const phone = useMedia('(max-width: 640px)');
  useEffect(() => {
    if (!open || !phone) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.current?.focus(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, phone, onClose, anchor]);
  if (!open) return null;
  if (phone) {
    return createPortal(
      <>
        <div aria-hidden onClick={onClose} className="fixed inset-0 z-[74] bg-[color-mix(in_srgb,var(--color-black)_32%,transparent)]" />
        <div role="dialog" aria-label={label} className="fixed left-0 right-0 bottom-0 z-[75] max-h-[82dvh] overflow-auto bg-card rounded-t-[16px] border border-solid border-line shadow-[var(--shadow-overlay)] px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom,0px))] text-ink font-sans">
          <div aria-hidden className="mx-auto mb-2 w-9 h-1 rounded-full bg-line" />
          {children}
          <button type="button" onClick={onClose} className="mt-3 w-full h-11 rounded-control border-none bg-black text-white font-sans text-copy font-semibold cursor-pointer">Done</button>
        </div>
      </>,
      document.body,
    );
  }
  return (
    <Floating anchor={anchor} open={open} onClose={onClose} width={width} maxHeight={520} label={label}>
      <div className="px-3 py-2.5">{children}</div>
    </Floating>
  );
}

function CustomRange({ from, to, onApply, onDone }: { from: string; to: string; onApply: (from: string, to: string) => void; onDone: () => void }) {
  const [f, setF] = useState(from), [t, setT] = useState(to);
  const bad = !!(f && t && t < f);
  return (
    <div className="mt-2 pt-2 flex flex-col gap-2 [border-top:1px_solid_var(--color-line-soft)]">
      <h5 className="m-0 text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">Custom range</h5>
      <div className="grid grid-cols-2 gap-2">
        <DateField label="From" value={f} onChange={setF} />
        <DateField label="To" value={t} min={f || undefined} onChange={setT} />
      </div>
      <button type="button" disabled={bad || (!f && !t)} onClick={() => { onApply(f, t); onDone(); }}
        className="self-end h-[34px] max-sm:h-10 px-3 rounded-control border-none bg-primary text-on-primary font-sans text-copy font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
        {bad ? 'The end is before the start' : 'Apply'}
      </button>
    </div>
  );
}

const shiftDay = (iso: string, days: number) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
const monthStart = (iso: string, add = 0) => { const d = new Date(Date.parse(iso.slice(0, 7) + '-01T00:00:00Z')); d.setUTCMonth(d.getUTCMonth() + add); return d.toISOString().slice(0, 10); };

/** A from / to preset (inclusive dates; '' is open). */
export interface DatePreset { key: string; label: string; from: string; to: string }

/** The usual presets: Today, Next 7 days, This month, Last month. */
export function defaultDatePresets(today = todayMyt()): DatePreset[] {
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'next7', label: 'Next 7 days', from: today, to: shiftDay(today, 6) },
    { key: 'month', label: 'This month', from: monthStart(today), to: shiftDay(monthStart(today, 1), -1) },
    { key: 'lastm', label: 'Last month', from: monthStart(today, -1), to: shiftDay(monthStart(today), -1) },
  ];
}

/** What a from / to filter says: the preset's name, else the range. */
export function dateFilterLabel(from: string, to: string, presets: DatePreset[] = defaultDatePresets(), anyLabel = 'Any dates') {
  if (!from && !to) return anyLabel;
  const p = presets.find(x => x.from === from && x.to === to);
  if (p) return p.label;
  if (from && to) return from === to ? fmtDate(from) : dateRange(from, to);
  return from ? `From ${fmtDate(from)}` : `Until ${fmtDate(to)}`;
}

/**
 * The toolbar's date button for a page that keeps a from / to pair (URL keys or state): its presets, an
 * "any" choice (or the page's default range), and a custom From / To. Picking anything other than the default
 * shows a chip.
 */
export function rangeDate({ label, from, to, onChange, presets = defaultDatePresets(), anyLabel = 'Any dates', def }: {
  label: string; from: string; to: string; onChange: (from: string, to: string) => void;
  presets?: DatePreset[]; anyLabel?: string;
  /** The range that counts as "not narrowed" (default: no dates). */
  def?: { from: string; to: string };
}): ToolbarDate {
  const key = (a: string, b: string) => (a || b ? `${a}|${b}` : '');
  const d = def ? key(def.from, def.to) : '';
  const list = [
    ...(def ? [] : [{ value: '', label: anyLabel }]),
    ...presets.map(p => ({ value: key(p.from, p.to), label: p.label, sub: p.from === p.to ? dateShort(p.from) : p.from && p.to ? `${dateShort(p.from)} – ${dateShort(p.to)}` : '' })),
  ];
  const value = key(from, to);
  if (!list.some(p => p.value === value)) list.push({ value, label: dateFilterLabel(from, to, presets, anyLabel), sub: '' });
  return {
    label, value, def: d, presets: list,
    onChange: v => { const [a = '', b = ''] = v ? v.split('|') : []; onChange(a, b); },
    custom: { from, to, onApply: onChange },
  };
}

/**
 * A phone card (the prototype's two-line card, about 64px): line 1 the name (a channel mark or icon before it)
 * with the key figure on the right; line 2 one muted line of context with the status pill on the right.
 * Use it as a DataTable `renderCard`.
 */
export function PhoneCard({ lead, title, right, meta, badge, titleMuted }: {
  lead?: ReactNode; title: ReactNode; right?: ReactNode; meta?: ReactNode; badge?: ReactNode; titleMuted?: boolean;
}) {
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-[3px] min-w-0">
      <span className="flex items-center gap-[7px] min-w-0">
        {lead}
        <span className={cx('min-w-0 text-heading font-semibold whitespace-nowrap overflow-hidden text-ellipsis', titleMuted && 'text-muted-ink')}>{title}</span>
      </span>
      <span className="text-heading font-semibold text-right whitespace-nowrap tabular-nums">{right}</span>
      <span className="min-w-0 text-copy text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{meta}</span>
      <span className="justify-self-end">{badge}</span>
    </span>
  );
}

/** The date button alone, for a toolbar slot whose chips another part already draws (a DataTable's date column). */
export function ToolbarDateButton({ date }: { date: ToolbarDate }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const preset = date.presets.find(p => p.value === date.value) ?? date.presets[0];
  const on = date.def !== undefined && date.value !== date.def;
  return (
    <>
      <TbButton btnRef={btn} icon="CalendarDays" on={on} expanded={open} onClick={() => setOpen(v => !v)} label={`${date.label}: ${preset?.label ?? ''}`} caret>
        <span className="truncate">{preset?.label}</span>
      </TbButton>
      <Panel open={open} anchor={btn} onClose={() => setOpen(false)} label={date.label} width={280}>
        <h5 className="m-0 mb-1 text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">{date.label}</h5>
        {date.presets.map(p => (
          <button key={p.value} type="button" aria-pressed={p.value === date.value} onClick={() => { date.onChange(p.value); setOpen(false); }}
            className={cx('w-full flex items-center justify-between gap-3 min-h-9 max-sm:min-h-11 px-2 rounded-[8px] border-none font-sans text-copy text-left cursor-pointer',
              p.value === date.value ? 'bg-muted text-ink font-semibold' : 'bg-transparent text-ink hover:bg-muted')}>
            <span>{p.label}</span>
            <span className="text-meta text-muted-ink font-normal">{p.sub ?? ''}</span>
          </button>
        ))}
        {date.custom && <CustomRange {...date.custom} onDone={() => setOpen(false)} />}
      </Panel>
    </>
  );
}
