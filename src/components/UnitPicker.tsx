import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { cx } from '../lib/design-tokens';
import { useUnitRoster, type RosterUnit } from '../lib/useUnitRoster';

const RECENT_KEY = 'unitPicker.recent';
const RECENT_MAX = 5;

function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : []; }
  catch { return []; }
}
function remember(id: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX))); } catch { /* private window: no recent list */ }
}

/** "2 bed · 2 bath" when the unit says, else nothing. */
export function roomsOf(u: Pick<RosterUnit, 'bedrooms' | 'bathrooms'>): string {
  const parts = [u.bedrooms != null ? (u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} bed`) : null, u.bathrooms != null ? `${u.bathrooms} bath` : null].filter(Boolean);
  return parts.join(' · ');
}
/** "C13-13A · Agile · 2 bed · 2 bath". */
export const unitLabel = (u: RosterUnit) => [u.unitNumber, u.propertyName, roomsOf(u)].filter(Boolean).join(' · ');

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Fuzzy: every typed word must appear in the building + unit text, ignoring dashes and spaces ("c13 13a", "agile c1313"),
 *  or the letters in order. A higher score sorts first: unit number starts with it, then contains it, then in order. */
function score(u: RosterUnit, q: string): number {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).map(squash).filter(Boolean);
  if (!words.length) return 1;
  const unit = squash(u.unitNumber), hay = squash(`${u.propertyName} ${u.unitNumber}`);
  if (words.every(w => hay.includes(w))) return words.some(w => unit.startsWith(w)) ? 3 : 2;
  const all = words.join('');
  let i = 0;
  for (const ch of hay) if (ch === all[i]) i++;
  return i === all.length ? 1 : 0;
}

/**
 * Pick one unit out of all of them, quickly: pick the building first (or type), each unit reads "C13-13A · Agile · 2 bed ·
 * 2 bath", the search forgives dashes and spaces, the last units picked sit at the top, and the arrow keys and Enter
 * work. Units come from GET /api/units unless `units` is given. Shared by every form that asks for a unit.
 */
export function UnitPicker({ value, onChange, units: given, label = 'Unit', error, placeholder = 'Pick a unit', disabled, autoFocus }: {
  value: string; onChange: (unitId: string, unit: RosterUnit | null) => void; units?: RosterUnit[];
  label?: string; error?: string | null; placeholder?: string; disabled?: boolean; autoFocus?: boolean;
}) {
  const roster = useUnitRoster();
  const units = given ?? roster;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [building, setBuilding] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = units.find(u => u.id === value) ?? null;

  const buildings = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const u of units) { const k = u.propertyId ?? u.propertyName; const b = m.get(k) ?? { name: u.propertyName, n: 0 }; b.n++; m.set(k, b); }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'en', { numeric: true }));
  }, [units]);

  // The rows shown: recent first (only with no search and no building picked), then by building, best match first.
  const rows = useMemo(() => {
    const inBuilding = building ? units.filter(u => (u.propertyId ?? u.propertyName) === building) : units;
    const hits = inBuilding.map(u => ({ u, s: score(u, q) })).filter(x => x.s > 0);
    hits.sort((a, b) => a.u.propertyName.localeCompare(b.u.propertyName, 'en', { numeric: true }) || b.s - a.s || a.u.unitNumber.localeCompare(b.u.unitNumber, 'en', { numeric: true }));
    const out: { u: RosterUnit; group: string }[] = [];
    if (!q.trim() && !building) for (const id of recent) { const u = units.find(x => x.id === id); if (u) out.push({ u, group: 'Recent' }); }
    for (const h of hits) out.push({ u: h.u, group: h.u.propertyName });
    return out;
  }, [units, building, q, recent]);

  useEffect(() => { setActive(0); }, [q, building]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const choose = (u?: RosterUnit) => {
    if (!u) return;
    remember(u.id); setRecent(readRecent());
    onChange(u.id, u); setOpen(false); setQ('');
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(''); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(rows[active]?.u); }
  };

  let lastGroup = '';
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-meta font-medium text-muted-ink">{label}</span>
      <div ref={box} className="relative">
      <button type="button" disabled={disabled} autoFocus={autoFocus} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current ? unitLabel(current) : 'none'}`}
        onClick={() => setOpen(v => !v)}
        className={cx('h-10 w-full flex items-center gap-2 pl-3 pr-2 text-left rounded-control border border-solid bg-card text-copy font-sans cursor-pointer disabled:cursor-default disabled:bg-muted',
          error ? 'border-danger' : 'border-line')}>
        {current ? (
          <span className="flex-1 min-w-0 truncate"><b className="text-ink">{current.unitNumber}</b><span className="text-muted-ink"> · {current.propertyName}{roomsOf(current) ? ` · ${roomsOf(current)}` : ''}</span></span>
        ) : <span className="flex-1 min-w-0 truncate text-muted-ink">{units.length ? placeholder : 'Loading units'}</span>}
        <Icon name="ChevronDown" size="sm" color="var(--color-muted-ink)" />
      </button>
      {open && (
        <div className="absolute z-30 top-[calc(100%+4px)] left-0 w-full min-w-[280px] max-w-[calc(100vw-32px)] bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-11 [border-bottom:1px_solid_var(--color-line-soft)]">
            <Icon name="Search" size="sm" color="var(--color-muted-ink)" />
            <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Unit or building, e.g. c13 13a"
              role="combobox" aria-controls={listId} aria-expanded aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
              className="flex-1 min-w-0 border-none outline-none bg-transparent font-sans text-copy text-ink" />
          </div>
          <div className="flex gap-1.5 px-2 py-2 overflow-x-auto [border-bottom:1px_solid_var(--color-line-soft)]" role="group" aria-label="Building">
            {[['', { name: 'All buildings', n: units.length }] as const, ...buildings].map(([k, b]) => (
              <button key={k || 'all'} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setBuilding(k); input.current?.focus(); }} aria-pressed={building === k}
                className={cx('flex-none h-8 px-2.5 rounded-pill border border-solid text-meta whitespace-nowrap cursor-pointer', building === k ? 'bg-black text-white border-black' : 'bg-card border-line text-ink hover:bg-muted')}>
                {b.name} <span className={building === k ? 'text-[var(--color-text-on-dark)] opacity-70' : 'text-muted-ink'}>{b.n}</span>
              </button>
            ))}
          </div>
          <div ref={list} id={listId} role="listbox" aria-label={label} className="max-h-[320px] overflow-y-auto pb-1">
            {rows.length === 0 && <div className="px-3 py-3 text-meta text-muted-ink">{q.trim() ? `No unit matches "${q.trim()}".` : 'No units in this building.'}</div>}
            {rows.map((r, i) => {
              const head = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              return (
                <div key={`${r.group}-${r.u.id}`}>
                  {head && <div className="sticky top-0 z-[1] bg-card px-3 pt-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">{head}</div>}
                  <div id={`${listId}-${i}`} data-i={i} role="option" aria-selected={r.u.id === value}
                    onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); choose(r.u); }}
                    className={cx('mx-1 px-2.5 min-h-9 py-1.5 rounded-control flex items-center gap-2 text-copy cursor-pointer', i === active && 'bg-muted')}>
                    <b className={cx('flex-none', r.u.id === value ? 'text-ink' : 'text-ink font-medium')}>{r.u.unitNumber}</b>
                    <span className="flex-1 min-w-0 truncate text-muted-ink">{r.u.propertyName}{roomsOf(r.u) ? ` · ${roomsOf(r.u)}` : ''}</span>
                    {r.u.id === value && <Icon name="Check" size="sm" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
      {error && <span className="text-meta text-danger">{error}</span>}
    </div>
  );
}
