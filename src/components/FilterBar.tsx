import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Icon from './Icon';
import { Segmented, type SegmentOption } from './Metric';
import { cx } from '../lib/design-tokens';
import { count } from '../lib/format';

/**
 * The filter row above a list, the same on every screen. The main views (mutually exclusive: All, Arriving
 * today, Paid ...) sit in one Segmented track that never wraps; on a phone it scrolls sideways. Flags that
 * describe a record rather than a view of the list (Missing ID, VIP, Asked by me ...) go behind one Filter
 * button, so a long row of chips never spills onto a second and third line.
 */

export interface FilterTag { key: string; label: string; count?: number; tone?: 'danger' | 'warning' }

export interface FilterTags {
  items: FilterTag[];
  /** Keys currently on. */
  active: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** The tags share one setting with the views (picking one replaces the view), so they read as radio choices. */
  single?: boolean;
}

export function FilterBar<K extends string>({ label, views, value, onChange, tags, className }: {
  label: string; views: SegmentOption<K>[]; value: K | ''; onChange: (k: K) => void; tags?: FilterTags; className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-2 min-w-0 max-w-full', className)}>
      <Segmented label={label} options={views} value={value} onChange={onChange} />
      {tags && tags.items.length > 0 && <FilterMenu {...tags} />}
    </div>
  );
}

/** The Filter button and its menu. Each option carries its count; an option with nothing in it stays listed,
 *  greyed, so the menu does not change shape as the counts move. */
export function FilterMenu({ items, active, onToggle, onClear, single, label = 'Filter' }: FilterTags & { label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const on = items.filter(t => active.includes(t.key));

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  };

  return (
    <div ref={box} className="relative flex-none">
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}
        aria-label={on.length ? `${label}: ${on.map(t => t.label).join(', ')}` : label}
        className={cx('inline-flex items-center gap-1.5 h-[38px] px-3 rounded-control border border-solid bg-card cursor-pointer font-sans text-copy whitespace-nowrap outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-gold)]',
          on.length ? 'border-ink text-ink font-medium' : 'border-line text-muted-ink hover:text-ink')}>
        <Icon name="ListFilter" size="sm" />
        {label}
        {on.length > 0 && <span className="tabular-nums">· {on.length}</span>}
        {on.some(t => t.tone && t.count) && <span aria-hidden className={cx('w-1.5 h-1.5 rounded-full', on.some(t => t.tone === 'danger') ? 'bg-danger-line' : 'bg-warning-line')} />}
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} onKeyDown={onMenuKey}
          className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[220px] max-w-[calc(100vw-32px)] p-1 bg-card border border-solid border-line rounded-control shadow-[var(--shadow-overlay)]">
          {items.map(t => {
            const checked = active.includes(t.key);
            const empty = t.count === 0 && !checked;
            const flagged = !!t.tone && !!t.count;
            return (
              <button key={t.key} type="button" role={single ? 'menuitemradio' : 'menuitemcheckbox'} aria-checked={checked}
                aria-disabled={empty} disabled={empty} onClick={() => { onToggle(t.key); if (single) { setOpen(false); trigger.current?.focus(); } }}
                className={cx('w-full flex items-center gap-2.5 h-10 md:h-8 px-2 rounded-[6px] bg-transparent border-none font-sans text-copy text-left outline-none focus-visible:bg-muted',
                  empty ? 'cursor-not-allowed text-faint' : 'cursor-pointer text-ink hover:bg-muted')}>
                <span className={cx('w-4 h-4 flex-none grid place-items-center box-border border border-solid', single ? 'rounded-full' : 'rounded-[4px]',
                  checked ? 'bg-black border-black text-white' : empty ? 'bg-card border-line' : 'bg-card border-line-strong')}>
                  {checked && <Icon name="Check" size="sm" style={{ width: 12, height: 12 }} />}
                </span>
                <span className="flex-1 min-w-0 truncate">{t.label}</span>
                {t.count !== undefined && (
                  <span className={cx('inline-flex items-center gap-1 text-meta tabular-nums', flagged ? (t.tone === 'danger' ? 'text-danger' : 'text-warning') : empty ? 'text-faint' : 'text-muted-ink')}>
                    {flagged && <span aria-hidden className={cx('w-1.5 h-1.5 rounded-full', t.tone === 'danger' ? 'bg-danger-line' : 'bg-warning-line')} />}
                    {empty ? '(0)' : count(t.count)}
                  </span>
                )}
              </button>
            );
          })}
          <div className="mt-1 pt-1 border-0 border-t border-solid border-line-soft flex px-1">
            <button type="button" disabled={on.length === 0} onClick={() => { onClear(); setOpen(false); trigger.current?.focus(); }}
              className="h-7 px-1 bg-transparent border-none font-sans text-meta font-medium text-accent cursor-pointer disabled:text-faint disabled:cursor-not-allowed outline-none focus-visible:underline">
              Clear filter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
