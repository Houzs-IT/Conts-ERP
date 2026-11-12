import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { Floating } from './DataTableParts';
import { cx } from '../lib/design-tokens';
import { useMedia } from '../lib/useMedia';
import { count as fmtCount } from '../lib/format';

/**
 * The one compact toolbar above a list or a report (redesign phase 2, the prototype's toolbar): search, then a Filters
 * button with a count that opens grouped choices (each with its count), a date button with presets, and whatever the
 * page keeps beside them (a month stepper, a view switch). What is narrowed shows underneath as small removable chips
 * with Clear all, and the list updates at once. Below 640px the panels open as bottom sheets.
 *
 * It only arranges the controls: every value stays in the page (its URL or state), so a page keeps its behaviour.
 */

export interface ToolbarOption { value: string; label: string; count?: number }

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
}

export interface ToolbarDate {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets: { value: string; label: string; sub?: string }[];
  /** The preset that counts as "not narrowed"; when set, any other preset also shows as a chip. */
  def?: string;
}

/** A chip the page builds itself (a range, a quick filter), removable on its own. */
export interface ToolbarChip { key: string; label: string; onRemove: () => void }

export function ListToolbar({ search, leading, filters = [], panelExtra, chips: extraChips = [], date, after, right, below, count, bare, className, onClearAll }: {
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
  /** Extra resets for Clear all (the page's own chips); filters and search are cleared already. */
  onClearAll?: () => void;
}) {
  const [panel, setPanel] = useState<null | 'filters' | 'date'>(null);
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const dateBtn = useRef<HTMLButtonElement>(null);

  const allOf = (f: ToolbarFilter) => f.all ?? '';
  const onFilters = filters.filter(f => f.value !== allOf(f));
  const nFilters = onFilters.length + extraChips.length;
  const datePreset = date ? date.presets.find(p => p.value === date.value) ?? date.presets[0] : null;
  const dateOn = !!date && date.def !== undefined && date.value !== date.def;

  const chips: ToolbarChip[] = [];
  if (search && search.value.trim()) chips.push({ key: '_search', label: `Search: ${search.value.trim()}`, onRemove: () => search.onChange('') });
  for (const f of onFilters) {
    const o = f.options.find(x => x.value === f.value);
    chips.push({ key: f.key, label: `${f.label}: ${o?.label ?? f.value}`, onRemove: () => f.onChange(allOf(f)) });
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
          label={nFilters ? `Filters, ${nFilters} on` : 'Filters'}>
          Filters{nFilters > 0 && <span className="min-w-[18px] h-[18px] px-[5px] grid place-items-center rounded-full bg-primary text-on-primary text-caption font-semibold tabular-nums">{nFilters}</span>}
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
      <Panel open={panel === 'filters'} anchor={filtersBtn} onClose={() => setPanel(null)} label="Filters">
        <div className="flex items-center justify-between gap-2 mb-1">
          <b className="text-copy">Filters</b>
          {nFilters > 0 && <button type="button" onClick={() => { for (const f of onFilters) f.onChange(allOf(f)); for (const c of extraChips) c.onRemove(); }}
            className="h-7 px-1 border-none bg-transparent text-meta font-semibold text-primary cursor-pointer">Clear all</button>}
        </div>
        {filters.map(f => (
          <div key={f.key} className="py-1.5">
            <h5 className="m-0 mb-1.5 text-caption font-semibold uppercase tracking-[0.08em] text-muted-ink">{f.label}</h5>
            <div className="flex flex-wrap gap-1.5">
              {[...(f.allLabel ? [{ value: allOf(f), label: f.allLabel } as ToolbarOption] : []), ...f.options].map(o => {
                const picked = f.value === o.value;
                const empty = o.count === 0 && !picked;
                return (
                  <button key={o.value} type="button" aria-pressed={picked} disabled={empty} onClick={() => f.onChange(o.value)}
                    className={cx('inline-flex items-center gap-1.5 min-h-[30px] max-sm:min-h-10 max-w-full px-2.5 rounded-full border border-solid font-sans text-meta font-medium cursor-pointer',
                      picked ? 'bg-black border-black text-white' : empty ? 'bg-card border-line-soft text-faint cursor-not-allowed' : 'bg-card border-line text-ink hover:bg-muted')}>
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

export function ToolbarSearch({ value, onChange, placeholder, label, debounce = true }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; debounce?: boolean }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setText(value); last.current = value; } }, [value]);
  useEffect(() => {
    if (!debounce || text === last.current) return;
    const t = setTimeout(() => { last.current = text; onChange(text); }, 250);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="relative flex items-center flex-[1_1_220px] min-w-[180px] max-w-[360px] max-sm:max-w-none">
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
