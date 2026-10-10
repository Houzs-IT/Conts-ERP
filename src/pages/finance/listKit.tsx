import { useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from '../../components/Icon';
import { useSearchParams } from 'react-router-dom';
import { cx } from '../../lib/design-tokens';
import { useApi } from '../../lib/useApi';

/**
 * Small pieces the finance and owner lists share so thousands of rows read the same way on every screen:
 * filters live in the URL, the previous page stays on screen while the next one loads, headers stick,
 * phones get cards.
 */

/** Query-string state: `get` reads a key, `set` merges a patch (null or '' removes the key). Replaces the
 *  history entry, so stepping through filters does not fill the back button. */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const get = (key: string, fallback = '') => params.get(key) ?? fallback;
  const set = (patch: Record<string, string | number | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') next.delete(k); else next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };
  return { get, set, params };
}

export function useMedia(query: string) {
  const read = () => typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(query).matches;
  const [on, setOn] = useState(read);
  useEffect(() => {
    if (!('matchMedia' in window)) return;
    const mql = window.matchMedia(query);
    const fn = () => setOn(mql.matches);
    mql.addEventListener('change', fn);
    return () => mql.removeEventListener('change', fn);
  }, [query]);
  return on;
}
/** Same breakpoint as AppShell's narrow layout. */
export const usePhone = () => useMedia('(max-width: 767.98px)');

/** Card body wrapper whose header row can stick to the page while it scrolls. `overflow: clip` keeps the
 *  rounded corners without becoming a scroll container (which would stop the header sticking). */
export function ListCard({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <div className="relative bg-card border border-solid border-line rounded-card [overflow:clip] shrink-0">
      <BusyBar on={!!busy} />
      {children}
    </div>
  );
}

/** A thin bar along the top edge while a newer page is on its way; the rows below stay put. */
export function BusyBar({ on }: { on: boolean }) {
  return (
    <div aria-hidden className={cx('absolute left-0 right-0 top-0 h-[2px] z-[3] overflow-hidden pointer-events-none transition-opacity duration-150', on ? 'opacity-100' : 'opacity-0')}>
      <div className="h-full w-1/3 bg-gold [animation:list-busy_1.1s_ease-in-out_infinite]" />
      <style>{'@keyframes list-busy{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
    </div>
  );
}

/** Classes for a header row that sticks to the top of the scrolling page. The page (AppShell's main) has
 *  24px top padding on desktop, and sticky offsets start inside it, so -24px puts the header flush with
 *  the top edge instead of letting rows show through above it. Phones use cards, not this header. */
// items-center: a header that wraps to two lines ("Booking revenue, month") stays level with its one-line neighbours.
export const STICKY_HEAD = 'items-center sticky -top-6 z-[2] bg-muted [border-bottom:1px_solid_var(--color-line)] text-meta font-semibold text-muted-ink';

/** Search box that commits after a short pause, so each keystroke is not a request. */
export function SearchBox({ value, onChange, placeholder, label, className }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string;
}) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setText(value); last.current = value; } }, [value]);
  useEffect(() => {
    if (text === last.current) return;
    const t = setTimeout(() => { last.current = text; onChange(text.trim()); }, 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className={cx('relative flex items-center', className)}>
      <span className="sr-only absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">{label}</span>
      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-[11px] text-muted-ink pointer-events-none">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input type="search" value={text} onChange={e => setText(e.target.value)} placeholder={placeholder}
        className="block w-full box-border h-9 pl-[33px] pr-3 border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-copy" />
    </label>
  );
}

/** Native select styled like the rest of the filters. The first option is the "everything" choice. */
export function FilterSelect({ label, value, onChange, all, options, className }: {
  label: string; value: string; onChange: (v: string) => void; all: string; options: { value: string; label: string }[]; className?: string;
}) {
  // Same face as the shared Select: no native arrow, one lucide chevron, "All ..." reads as a real choice.
  return (
    <label className={cx('relative flex items-center min-w-0', className)}>
      <span className="absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} title={label}
        className="block w-full box-border h-9 pl-3 pr-8 appearance-none border border-solid border-line rounded-control outline-none bg-card font-sans text-copy text-ink cursor-pointer min-w-0 text-ellipsis">
        <option value="">{all}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="absolute right-2.5 flex pointer-events-none text-muted-ink"><Icon name="ChevronDown" size="sm" /></span>
    </label>
  );
}

/** Pill with an optional count, for category / state chips. */
export function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={cx('inline-flex shrink-0 items-center gap-[7px] h-8 px-[12px] rounded-full cursor-pointer whitespace-nowrap font-sans text-copy font-medium border border-solid',
        on ? 'border-black bg-black text-white' : 'border-line bg-card text-muted-ink')}>
      {children}
      {count !== undefined && (
        <span className={cx('text-caption font-semibold py-px px-[6px] rounded-full tabular-nums', on ? 'bg-[rgba(255,255,255,0.18)] text-white' : 'bg-muted text-muted-ink')}>
          {count.toLocaleString('en-MY')}
        </span>
      )}
    </button>
  );
}

/** Previous / next month stepper. */
export function MonthStepper({ label, onStep, note }: { label: string; onStep: (by: number) => void; note?: string }) {
  return (
    <div className="flex items-center h-9 rounded-control border border-solid border-line bg-card shrink-0">
      <button aria-label="Previous month" onClick={() => onStep(-1)} className="h-full w-8 grid place-items-center cursor-pointer bg-transparent border-none text-muted-ink hover:text-ink"><Icon name="ChevronLeft" size="sm" /></button>
      <span className="px-1 min-w-[96px] text-center text-copy font-medium tabular-nums whitespace-nowrap">{label}{note ? <span className="text-muted-ink font-normal"> · {note}</span> : null}</span>
      <button aria-label="Next month" onClick={() => onStep(1)} className="h-full w-8 grid place-items-center cursor-pointer bg-transparent border-none text-muted-ink hover:text-ink"><Icon name="ChevronRight" size="sm" /></button>
    </div>
  );
}

export const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface FinanceFilters {
  buildings: { id: string; name: string; units: number }[];
  units: { id: string; unitNumber: string; buildingId: string; ownerId: string | null }[];
  owners: { id: string; name: string }[];
}
/** Buildings, units and owners for filter menus, loaded once per screen. */
export function useFinanceFilters() {
  return useApi<FinanceFilters>('/finance/filters').data;
}
