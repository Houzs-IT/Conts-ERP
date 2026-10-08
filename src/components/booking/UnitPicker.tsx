import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';

export interface PickerUnit { id: string; unitNumber: string; propertyName: string }

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** A unit chooser for 100+ units: type to search unit or building, results grouped by building A-Z.
 *  Arrow keys move, Enter picks, Escape closes. */
export function UnitPicker({ units, value, onChange, label = 'Unit', placeholder = 'Search unit or building' }: {
  units: PickerUnit[]; value: string; onChange: (id: string) => void; label?: string; placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = units.find(u => u.id === value) ?? null;

  const flat = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return units
      .filter(u => { const hay = `${u.propertyName} ${u.unitNumber}`.toLowerCase(); return words.every(w => hay.includes(w)); })
      .sort((a, b) => byName(a.propertyName, b.propertyName) || byName(a.unitNumber, b.unitNumber));
  }, [units, q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function pick(u: PickerUnit) { onChange(u.id); setOpen(false); setQ(''); }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { if (open && flat[active]) { e.preventDefault(); pick(flat[active]); } }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); } }
  }

  let lastBuilding = '';
  return (
    <div ref={wrap} className="relative flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-[12px] font-medium text-muted-ink">{label}</label>
      <div className="relative">
        <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid pointer-events-none"><Icon name="Search" size="sm" /></span>
        <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
          value={open ? q : selected ? `${selected.propertyName} ${selected.unitNumber}` : ''}
          placeholder={units.length ? placeholder : 'Loading units…'}
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={onKey}
          className="h-10 w-full box-border rounded-control border border-solid border-line bg-white text-ink [font:inherit] text-[13px] pl-[32px] pr-8 py-0 outline-none focus:border-ink" />
        <span className="absolute right-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid pointer-events-none"><Icon name="ChevronsUpDown" size="sm" /></span>
      </div>
      {open && (
        <ul id={`${id}-list`} ref={listRef} role="listbox"
          className="absolute z-[80] left-0 right-0 top-full mt-1 m-0 p-1 list-none max-h-[280px] overflow-y-auto bg-card border border-solid border-line rounded-control shadow-[var(--shadow-overlay)]">
          {flat.length === 0 && <li className="px-3 py-2 text-[12.5px] text-muted-ink">No unit matches “{q}”.</li>}
          {flat.map((u, i) => {
            const head = u.propertyName !== lastBuilding;
            lastBuilding = u.propertyName;
            return (
              <li key={u.id} role="presentation">
                {head && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.propertyName}</div>}
                <div role="option" aria-selected={u.id === value} data-i={i}
                  onMouseDown={e => { e.preventDefault(); pick(u); }} onMouseEnter={() => setActive(i)}
                  className={cx('px-3 py-[7px] rounded-[6px] text-[13px] cursor-pointer flex items-center justify-between gap-2',
                    i === active ? 'bg-muted' : '', u.id === value ? 'font-semibold' : '')}>
                  <span>{u.unitNumber}</span>
                  {u.id === value && <Icon name="Check" size="sm" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
