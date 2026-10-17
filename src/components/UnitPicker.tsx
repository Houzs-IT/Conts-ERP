import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/design-tokens';
import Icon from './Icon';
import type { RosterUnit } from '../lib/useUnitRoster';

const RECENT_KEY = 'unitPicker.recent';
const RECENT_MAX = 5;

function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}
function pushRecent(id: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX))); }
  catch { /* private window: no recents, nothing else changes */ }
}

const code = (u: RosterUnit) => u.unitCode || u.unitNumber;
/** "2 bed · 2 bath", "Studio · 1 bath". */
export function bedBath(u: Pick<RosterUnit, 'bedrooms' | 'bathrooms'>): string {
  const bed = u.bedrooms == null ? null : u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} bed`;
  const bath = u.bathrooms == null ? null : `${u.bathrooms} bath`;
  return [bed, bath].filter(Boolean).join(' · ');
}
/** "C13-13A · Agile · 2 bed · 2 bath": the line a unit reads as everywhere a unit is picked. */
export const unitLine = (u: RosterUnit) => [code(u), u.propertyName, bedBath(u)].filter(Boolean).join(' · ');

interface Row { u: RosterUnit; group: string; pinned?: boolean }
/** A choice that is not a unit (e.g. External), always listed first above the buildings. */
export interface PinnedChoice { id: string; label: string }

/**
 * The one unit picker (owner, 11 Oct 2026, request M2): the units grouped by building under sticky headings, each
 * read as "C13-13A · Agile · 2 bed · 2 bath", the last few picked on this device first, and a search on building and
 * unit together ("agile 13a"). Keyboard: type to search, arrows to move, Enter to pick, Escape to close.
 */
export function UnitPicker({ units, value, onChange, label = 'Unit', placeholder = 'Search building or unit', disabled, error, autoFocus, pinned }: {
  units: RosterUnit[]; value: string; onChange: (id: string) => void; label?: string; placeholder?: string; disabled?: boolean; error?: string; autoFocus?: boolean;
  pinned?: PinnedChoice;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = units.find(u => u.id === value);
  const pinnedOn = !!pinned && value === pinned.id;

  const rows = useMemo<Row[]>(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (u: RosterUnit) => {
      const hay = `${u.propertyName} ${code(u)} ${u.unitNumber}`.toLowerCase();
      // Every word must match somewhere; "c1313a" also matches "C13-13A".
      return words.every(w => hay.includes(w) || hay.replace(/[^a-z0-9]/g, '').includes(w.replace(/[^a-z0-9]/g, '')));
    };
    const sorted = [...units].filter(hit).sort((a, b) =>
      a.propertyName.localeCompare(b.propertyName, 'en', { numeric: true }) || code(a).localeCompare(code(b), 'en', { numeric: true }));
    const recentRows = words.length ? [] : recent.map(id => units.find(u => u.id === id)).filter((u): u is RosterUnit => !!u).map(u => ({ u, group: 'Recent' }));
    const pin = pinned && (!words.length || words.every(w => pinned.label.toLowerCase().includes(w)))
      ? [{ u: { id: pinned.id, unitNumber: pinned.label, propertyName: '' }, group: '', pinned: true }] : [];
    return [...pin, ...recentRows, ...sorted.map(u => ({ u, group: u.propertyName }))];
  }, [units, q, recent, pinned]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, rows.findIndex(r => r.u.id === value)));
    input.current?.focus();
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(0); }, [q]);
  // Keep the highlighted unit in view below the sticky heading.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(r?: Row) {
    if (!r) return;
    onChange(r.u.id);
    if (!r.pinned) { pushRecent(r.u.id); setRecent(readRecent()); }
    setOpen(false); setQ('');
    trigger.current?.focus();
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); trigger.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'PageDown') { e.preventDefault(); setActive(a => Math.min(a + 8, rows.length - 1)); }
    else if (e.key === 'PageUp') { e.preventDefault(); setActive(a => Math.max(a - 8, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(rows[active]); }
    else if (e.key === 'Tab') setOpen(false);
  }

  // Grouped for sticky headings: a run of rows under each building (or Recent).
  const groups: { name: string; rows: { r: Row; i: number }[] }[] = [];
  rows.forEach((r, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === r.group) last.rows.push({ r, i }); else groups.push({ name: r.group, rows: [{ r, i }] });
  });

  return (
    <div ref={box} className="relative min-w-0">
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current ? unitLine(current) : pinnedOn ? pinned!.label : 'none picked'}`}
        disabled={disabled} autoFocus={autoFocus}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } else if (!open && e.key.length === 1 && /\S/.test(e.key)) { setQ(e.key); setOpen(true); } }}
        className={cx('w-full h-10 flex items-center gap-2 pl-3 pr-2 text-left rounded-control border border-solid bg-card font-sans text-copy cursor-pointer disabled:cursor-not-allowed disabled:bg-muted',
          error ? 'border-danger-line' : 'border-line')}>
        <Icon name="Building2" size="sm" color="var(--color-muted-ink)" />
        {current ? (
          <span className="flex-1 min-w-0 truncate">
            <b className="font-semibold text-ink">{code(current)}</b>
            <span className="text-muted-ink"> · {current.propertyName}{bedBath(current) ? ` · ${bedBath(current)}` : ''}</span>
          </span>
        ) : pinnedOn ? <span className="flex-1 min-w-0 truncate font-semibold text-ink">{pinned!.label}</span>
          : <span className="flex-1 min-w-0 truncate text-muted-ink">Pick the unit</span>}
        <Icon name="ChevronDown" size="sm" color="var(--color-muted-ink)" />
      </button>
      {open && (
        <div className="absolute z-40 top-[calc(100%+4px)] left-0 w-full min-w-[280px] max-w-[calc(100vw-32px)] bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-11 [border-bottom:1px_solid_var(--color-line-soft)]">
            <Icon name="Search" size="sm" color="var(--color-muted-ink)" />
            <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
              role="combobox" aria-controls={listId} aria-expanded aria-autocomplete="list" aria-label={`Search ${label.toLowerCase()}`}
              aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
              className="flex-1 min-w-0 border-none outline-none bg-transparent font-sans text-copy text-ink" />
            <span className="text-caption text-muted-ink tabular-nums flex-none">{rows.filter(r => !r.pinned && (q || r.group !== 'Recent')).length} units</span>
          </div>
          <div ref={list} id={listId} role="listbox" aria-label={label} className="max-h-[min(360px,50vh)] overflow-y-auto overscroll-contain">
            {rows.length === 0 && <div className="px-3 py-3 text-meta text-muted-ink">No unit matches "{q.trim()}".</div>}
            {groups.map((g, gi) => (
              <div key={`${g.name}-${gi}`} role="group" aria-label={g.name || pinned?.label} className={cx(!g.name && '[border-bottom:1px_solid_var(--color-line)] pb-0.5')}>
                {g.name && <div className="sticky top-0 z-[1] px-3 py-1.5 bg-page [border-bottom:1px_solid_var(--color-line-soft)] text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink flex justify-between">
                  <span className="truncate">{g.name}</span><span className="tabular-nums font-normal">{g.rows.length}</span>
                </div>}
                {g.rows.map(({ r, i }) => (
                  <div key={`${r.group}-${r.u.id}`} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={r.u.id === value}
                    onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); choose(r); }}
                    className={cx('mx-1 my-0.5 px-2.5 py-2 rounded-control flex items-center gap-2 text-copy cursor-pointer', i === active && 'bg-muted')}>
                    <span className="flex-1 min-w-0 truncate">
                      <span className={cx('text-ink', r.u.id === value ? 'font-semibold' : 'font-medium')}>{code(r.u)}</span>
                      {r.group === 'Recent' && <span className="text-muted-ink"> · {r.u.propertyName}</span>}
                    </span>
                    {bedBath(r.u) && <span className="text-meta text-muted-ink flex-none">{bedBath(r.u)}</span>}
                    {r.u.id === value && <Icon name="Check" size="sm" />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
