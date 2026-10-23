import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { Floating } from './DataTableParts';
import { cx } from '../lib/design-tokens';

export interface SelectOption { value: string; label: string; group?: string; hint?: string; disabled?: boolean }

const CONTROL = 'h-9 rounded-control border border-solid border-line bg-card text-ink font-sans text-copy cursor-pointer';

/**
 * The styled dropdown every filter bar uses. It stays a native <select> underneath, so phones get their
 * own picker and keyboards work, but it looks the same everywhere: 36px, 13px text, one chevron.
 * `label` is always given; `showLabel` prints it above, otherwise it is for screen readers only.
 */
export function Select({ value, onChange, options, label, showLabel, placeholder, className, disabled, size = 'sm' }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; label: string;
  showLabel?: boolean; placeholder?: string; className?: string; disabled?: boolean; size?: 'sm' | 'md';
}) {
  const id = useId();
  const groups = useMemo(() => {
    const m = new Map<string, SelectOption[]>();
    for (const o of options) { const k = o.group ?? ''; if (!m.has(k)) m.set(k, []); m.get(k)!.push(o); }
    return [...m.entries()];
  }, [options]);
  return (
    <div className={cx('flex flex-col gap-1.5 min-w-0', className)}>
      <label htmlFor={id} className={showLabel ? 'text-meta font-medium text-muted-ink' : 'absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]'}>{label}</label>
      <div className="relative flex items-center min-w-0">
        <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
          className={cx(CONTROL, 'w-full appearance-none pl-3 pr-8 truncate disabled:cursor-not-allowed disabled:text-faint', size === 'md' && 'h-10')}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {groups.map(([g, opts]) => g
            ? <optgroup key={g} label={g}>{opts.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</optgroup>
            : opts.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
        </select>
        <Icon name="ChevronDown" size="sm" color="var(--color-muted-ink)" style={{ position: 'absolute', right: 10, pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

/**
 * A searchable picker for long lists (139 units): type to filter, options grouped (by building) and
 * sorted A to Z, arrow keys and Enter to choose, Escape to close. `allLabel` adds a first "All ..." row.
 */
export function SearchSelect({ value, onChange, options, label, showLabel, allLabel, placeholder = 'Search', className, menuClassName, renderOption, size = 'sm' }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; label: string;
  showLabel?: boolean; allLabel?: string; placeholder?: string; className?: string;
  /** Classes for the open list, e.g. min-w-[300px] when the button is narrower than the options need. */
  menuClassName?: string;
  renderOption?: (o: SelectOption) => ReactNode;
  /** md = 40px, the height of the text fields in a dialog form; sm = 36px for filter bars. */
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const sorted = useMemo(() => [...options].sort((a, b) =>
    (a.group ?? '').localeCompare(b.group ?? '', 'en', { numeric: true }) || a.label.localeCompare(b.label, 'en', { numeric: true })), [options]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const hits = t ? sorted.filter(o => `${o.group ?? ''} ${o.label} ${o.hint ?? ''}`.toLowerCase().includes(t)) : sorted;
    return allLabel && !t ? [{ value: '', label: allLabel }, ...hits] : hits;
  }, [sorted, q, allLabel]);
  const current = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, shown.findIndex(o => o.value === value)));
    input.current?.focus();
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(0); }, [q]);

  const choose = (o?: SelectOption) => { if (!o || o.disabled) return; onChange(o.value); setOpen(false); setQ(''); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]); }
  };

  let lastGroup: string | undefined;
  return (
    <div ref={box} className={cx('relative flex flex-col gap-1.5 min-w-0', className)}>
      <span className={showLabel ? 'text-meta font-medium text-muted-ink' : 'absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]'}>{label}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? allLabel ?? 'none'}`}
        onClick={() => setOpen(v => !v)}
        className={cx(CONTROL, 'w-full flex items-center gap-2 pl-3 pr-2 text-left', size === 'md' && 'h-10')}>
        <span className={cx('flex-1 min-w-0 truncate', !current && !/^All/.test(allLabel ?? '') && 'text-muted-ink')}>{current ? (current.group ? `${current.label}` : current.label) : (allLabel ?? 'Choose')}</span>
        <Icon name="ChevronDown" size="sm" color="var(--color-muted-ink)" />
      </button>
      {open && (
        <div className={cx('absolute z-30 top-[calc(100%+4px)] left-0 w-full max-w-[calc(100vw-32px)]', size === 'md' ? 'min-w-0' : 'min-w-[260px]', 'bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)] overflow-hidden', menuClassName)}>
          <div className="flex items-center gap-2 px-3 h-10 [border-bottom:1px_solid_var(--color-line-soft)]">
            <Icon name="Search" size="sm" color="var(--color-muted-ink)" />
            <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
              role="combobox" aria-controls={listId} aria-expanded aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="flex-1 min-w-0 border-none outline-none bg-transparent font-sans text-copy text-ink" />
          </div>
          <div id={listId} role="listbox" aria-label={label} className="max-h-[300px] overflow-y-auto py-1">
            {shown.length === 0 && <div className="px-3 py-3 text-meta text-muted-ink">No match for "{q.trim()}".</div>}
            {shown.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={`${o.value}-${i}`}>
                  {head && <div className="px-3 pt-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">{head}</div>}
                  <div id={`${listId}-${i}`} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}
                    onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); choose(o); }}
                    className={cx('mx-1 px-2.5 py-[7px] rounded-control flex items-center gap-2 text-copy cursor-pointer',
                      i === active ? 'bg-muted' : '', o.value === value ? 'font-semibold' : '', o.disabled && 'text-faint cursor-not-allowed')}>
                    <span className="flex-1 min-w-0 truncate">{renderOption ? renderOption(o) : o.label}</span>
                    {o.hint && <span className="text-caption text-muted-ink flex-none">{o.hint}</span>}
                    {o.value === value && <Icon name="Check" size="sm" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A text field with suggestions underneath, for free-text values that should stay consistent (a department, a job title).
 * Typing filters the list as you go; arrow keys and Enter pick, Escape closes the list. Whatever is typed is the value,
 * so a new name needs no extra step. Looks like the dialog-size Select beside it.
 */
export function ComboInput({ value, onChange, options, label, placeholder, maxLength = 80, error }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; label: string;
  placeholder?: string; maxLength?: number; error?: string;
}) {
  const [open, setOpen] = useState(false);
  // The list filters only once the person types; opening it on a filled field shows every option.
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const field = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;

  const shown = useMemo(() => {
    const t = typed ? value.trim().toLowerCase() : '';
    const sorted = [...options].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label));
    return t ? sorted.filter(o => `${o.group ?? ''} ${o.label}`.toLowerCase().includes(t)) : sorted;
  }, [options, value, typed]);

  useEffect(() => { setActive(-1); }, [value]);
  useEffect(() => { if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, listId]);

  const show = () => { setTyped(false); setActive(-1); setOpen(true); };
  const pick = (o: SelectOption) => { onChange(o.value); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); setActive(0); } else setActive(a => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    // Enter in an open list picks the highlighted row, or just closes the list: it never sends the form behind it.
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); else setOpen(false); }
    // Only an open list takes Escape; with it closed, the dialog around the field closes as usual.
    else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  };

  let lastGroup: string | undefined;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-meta font-medium text-muted-ink">{label}</label>
      <div ref={field} className="relative flex items-center min-w-0">
        <input id={id} value={value} placeholder={placeholder} maxLength={maxLength} autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-error` : undefined}
          onChange={e => { onChange(e.target.value); setTyped(true); setOpen(true); }}
          onClick={() => { if (!open) show(); }} onKeyDown={onKey}
          className="field-input" style={{ paddingRight: 36 }} />
        <button type="button" tabIndex={-1} aria-label={`Show ${label.toLowerCase()} suggestions`} onMouseDown={e => e.preventDefault()}
          onClick={() => (open ? setOpen(false) : show())}
          className="absolute right-1 w-8 h-8 grid place-items-center bg-transparent border-none cursor-pointer text-muted-ink">
          <Icon name="ChevronDown" size="sm" />
        </button>
      </div>
      <Floating anchor={field} open={open && shown.length > 0} onClose={() => setOpen(false)} label={label}
        width={field.current?.offsetWidth} maxHeight={260}>
        <div id={listId} role="listbox" aria-label={label} className="py-1">
          {shown.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <Fragment key={`${o.value}-${i}`}>
                {head && <div className="px-3 pt-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">{head}</div>}
                <div id={`${listId}-${i}`} role="option" aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(o); }}
                  className={cx('mx-1 px-2.5 py-[7px] rounded-control flex items-center gap-2 text-copy cursor-pointer', i === active && 'bg-muted', o.value === value && 'font-semibold')}>
                  <span className="flex-1 min-w-0 truncate">{o.label}</span>
                  {o.value === value && <Icon name="Check" size="sm" />}
                </div>
              </Fragment>
            );
          })}
        </div>
      </Floating>
      {error && <span id={`${id}-error`} className="text-meta text-danger">{error}</span>}
    </div>
  );
}

export interface MenuItem { key: string; label: string; hint?: string; icon?: string; danger?: boolean; disabledReason?: string; onSelect: () => void }

/**
 * A button that opens a short list of actions, each with a one-line consequence. Items that cannot run
 * stay visible, greyed, with the reason (never silently missing). The trigger is whatever you pass, e.g.
 * a status pill, so this doubles as the status menu: show only the allowed next states.
 */
export function Menu({ trigger, items, label, align = 'right' }: { trigger: ReactNode; items: MenuItem[]; label: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={box} className="relative inline-flex">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 p-0 bg-transparent border-none cursor-pointer font-sans">
        {trigger}
      </button>
      {open && (
        <div role="menu" aria-label={label}
          className={cx('absolute z-30 top-[calc(100%+6px)] min-w-[240px] max-w-[calc(100vw-32px)] bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)] py-1', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it, i) => {
            const off = !!it.disabledReason;
            return (
              <Fragment key={it.key}>
              {it.danger && i > 0 && !items[i - 1].danger && <div role="separator" className="my-1 mx-1 h-px bg-line-soft" />}
              <button type="button" role="menuitem" aria-disabled={off} title={it.disabledReason}
                onClick={() => { if (off) return; setOpen(false); it.onSelect(); }}
                className={cx('w-full flex items-start gap-2.5 px-3 py-2 bg-transparent border-none text-left font-sans',
                  off ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted')}>
                {it.icon && <span className={cx('mt-px', off ? 'text-faint' : it.danger ? 'text-danger' : 'text-ink-2')}><Icon name={it.icon} size="sm" /></span>}
                <span className="flex flex-col gap-px min-w-0">
                  <span className={cx('text-copy font-medium', off ? 'text-faint' : it.danger ? 'text-danger' : 'text-ink')}>{it.label}</span>
                  {(it.disabledReason || it.hint) && <span className="text-meta text-muted-ink">{it.disabledReason ?? it.hint}</span>}
                </span>
              </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
