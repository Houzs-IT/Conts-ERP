import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Cleaner } from '../lib/useCleaners';
import Icon from './Icon';
import { Button } from './Button';
import { cx } from '../lib/design-tokens';
import { dayLabel, mytDay } from './ops/OpsUi';

/** Hint shown beside a cleaner in a picker: the outsourced company, or the load on `day` (the roster must be
 *  fetched for that same day: useCleaners' `date`). */
export const cleanerHint = (c: Cleaner, day?: string) => (c.employmentType === 'outsourced' ? (c.vendorName ?? 'Outsourced')
  : `${c.busy} open ${!day || day === mytDay(0) ? 'today' : `on ${dayLabel(day)}`}`);

/** Tick one or more cleaners (owner, 11 Oct 2026: a big unit can take two or three people). The order they are
 *  ticked in is kept: the first one is the job's main cleaner. */
export function CleanerChecklist({ cleaners, value, onChange, label = 'Cleaners', error, day }: {
  cleaners: Cleaner[]; value: string[]; onChange: (ids: string[]) => void; label?: string; error?: string | null; day?: string;
}) {
  const toggle = (id: string, on: boolean) => onChange(on ? [...value.filter(v => v !== id), id] : value.filter(v => v !== id));
  return (
    <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5 min-w-0">
      <legend className="p-0 mb-1.5 text-meta font-semibold text-muted-ink">{label}{value.length > 1 ? ` · ${value.length} picked` : ''}</legend>
      <div className={cx('max-h-[240px] overflow-y-auto overscroll-contain rounded-control border border-solid', error ? 'border-danger' : 'border-line')}>
        {cleaners.length === 0 && <p className="m-0 p-3 text-copy text-muted-ink">No active cleaners on the roster.</p>}
        {cleaners.map(c => {
          const on = value.includes(c.id);
          const n = value.indexOf(c.id) + 1;
          return (
            <label key={c.id} className={cx('min-h-11 flex items-center gap-2.5 px-3 py-2 cursor-pointer text-copy [&+&]:[border-top:1px_solid_var(--color-line-soft)]', on ? 'bg-gold-tint' : 'hover:bg-page')}>
              <input type="checkbox" checked={on} onChange={e => toggle(c.id, e.target.checked)} className="w-4 h-4 m-0 flex-none accent-[var(--color-brand-black)]" />
              <span className="flex-1 min-w-0 truncate font-medium text-ink">{c.name}</span>
              {on && value.length > 1 && n === 1 && <span className="text-caption text-gold-ink whitespace-nowrap">Main</span>}
              <span className="text-meta text-muted-ink whitespace-nowrap">{cleanerHint(c, day)}</span>
            </label>
          );
        })}
      </div>
      {error && <span className="text-meta text-danger">{error}</span>}
    </fieldset>
  );
}

/** The cleaners on one job as removable chips, plus a picker to add another. Every change is saved at once by the
 *  caller (onChange gets the whole new list). */
export function CleanerChips({ cleaners, value, names, onChange, disabled, required }: {
  cleaners: Cleaner[]; value: string[]; names: Record<string, string>; onChange: (ids: string[]) => void; disabled?: boolean;
  /** An empty list shows as needing attention (a job on the board), not as optional (a new job). */
  required?: boolean;
}) {
  const others = cleaners.filter(c => !value.includes(c.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      {value.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1 max-md:gap-2 h-8 max-md:h-11 pl-2.5 max-md:pl-3.5 pr-1 max-md:pr-0 rounded-full border border-solid border-line bg-card text-copy max-w-full">
          <span className="truncate">{names[id] ?? cleaners.find(c => c.id === id)?.name ?? 'Cleaner'}</span>
          {i === 0 && value.length > 1 && <span className="text-caption text-gold-ink">Main</span>}
          <button type="button" disabled={disabled} onClick={() => onChange(value.filter(v => v !== id))} aria-label={`Take ${names[id] ?? 'this cleaner'} off the job`}
            title="Take off this job" className="w-6 h-6 max-md:w-11 max-md:h-11 max-md:rounded-l-none max-md:[border-left:1px_solid_var(--color-line)] grid place-items-center rounded-full border-0 bg-transparent text-muted-ink hover:bg-muted cursor-pointer disabled:cursor-default">
            <Icon name="X" size="sm" />
          </button>
        </span>
      ))}
      {others.length > 0 && (
        <AddCleaners others={others} disabled={disabled} label={value.length ? 'Add cleaner' : 'Pick cleaners'}
          tone={value.length ? 'add' : required ? 'missing' : 'empty'} onAdd={ids => onChange([...value, ...ids])} />
      )}
    </div>
  );
}

/** Ticks several cleaners and adds them in one save, so a team of three is one change, not three. The panel is
 *  portalled to the body: the job drawer's slide-in transform would otherwise move a fixed panel and its scroll box clip it. Outside click or Escape drops the ticks. */
function AddCleaners({ others, disabled, label, tone, onAdd }: {
  others: Cleaner[]; disabled?: boolean; label: string; tone: 'add' | 'missing' | 'empty'; onAdd: (ids: string[]) => void;
}) {
  const [at, setAt] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const shut = (refocus = false) => { setAt(null); setPicked([]); if (refocus) trigger.current?.focus(); };
  useEffect(() => {
    if (!at) return;
    panel.current?.querySelector<HTMLInputElement>('input[type=checkbox]')?.focus();
    const outside = (e: Event) => { if (!wrap.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) shut(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); shut(true); } };
    const away = () => shut();
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', away);
    };
  }, [at]);
  const open = () => {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 32);
    const below = window.innerHeight - r.bottom - 16;
    // Opens upward only when the space below would squeeze the list to less than about four rows.
    const up = below < 260 && r.top > below;
    const maxHeight = Math.min(380, up ? r.top - 16 : below);
    setAt({ top: up ? r.top - 6 - maxHeight : r.bottom + 6, left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)), maxHeight });
  };
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(v => v !== id) : [...p, id]));
  const add = () => { if (picked.length) onAdd(picked); shut(true); };
  return (
    <span ref={wrap} className="contents">
      <button ref={trigger} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={!!at} onClick={() => (at ? shut() : open())}
        className={cx('inline-flex items-center gap-1.5 h-8 max-md:h-11 pl-2.5 pr-2 rounded-full border border-solid bg-card text-copy text-ink cursor-pointer [font-family:inherit] transition-colors duration-150 hover:bg-page disabled:cursor-default disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-black)]',
          tone === 'add' ? 'border-dashed border-line' : tone === 'missing' ? 'border-danger' : 'border-line', at && 'bg-page')}>
        <Icon name="Plus" size="sm" />{label}
        <span className={cx('grid transition-transform duration-150', at && 'rotate-180')}><Icon name="ChevronDown" size="sm" /></span>
      </button>
      {at && createPortal(
        <div ref={panel} role="dialog" aria-label="Pick cleaners to add" style={{ top: at.top, left: at.left, maxHeight: at.maxHeight }}
          className="fixed z-[90] w-[280px] max-w-[calc(100vw-32px)] flex flex-col bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)] overflow-hidden">
          <div className="px-3 pt-2.5 pb-2 text-meta font-semibold text-muted-ink">
            {picked.length ? `${picked.length} picked` : 'Tick one or more'}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1">
            {others.map(c => {
              const on = picked.includes(c.id);
              return (
                <label key={c.id} className={cx('min-h-11 flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] cursor-pointer text-copy', on ? 'bg-gold-tint' : 'hover:bg-muted')}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                    className="w-4 h-4 m-0 flex-none accent-[var(--color-brand-black)]" />
                  <span className="flex-1 min-w-0 truncate font-medium text-ink">{c.name}</span>
                  {c.employmentType === 'outsourced' && <span className="text-meta text-muted-ink whitespace-nowrap">{c.vendorName ?? 'Outsourced'}</span>}
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2 p-2 [border-top:1px_solid_var(--color-line-soft)]">
            <Button type="button" variant="ghost" size="sm" onClick={() => shut(true)}>Cancel</Button>
            <Button type="button" variant="primary" size="sm" disabled={!picked.length} disabledReason="Tick a cleaner first" onClick={add}>
              {picked.length > 1 ? `Add ${picked.length}` : 'Add'}
            </Button>
          </div>
        </div>, document.body,
      )}
    </span>
  );
}
