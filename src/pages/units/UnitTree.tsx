import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../components/Card';
import Icon from '../../components/Icon';
import { tone as T } from '../../theme';
import { cx } from '../../lib/design-tokens';
import type { UnitReadiness } from '../../lib/types';
import { READINESS } from '../../lib/vocabulary';
import { titleCase } from '../../lib/format';
import { READY_TONE, type Building, type Unit } from './shared';
import { MODEL } from '../../lib/revenueModel';

interface Props {
  buildings: Building[];
  units: Unit[];
  selectedId: string;
  readiness: Record<string, UnitReadiness>;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onEditBuilding: (b: Building) => void;
  onAddUnit: (buildingId: string) => void;
  onAddSubUnit: (buildingId: string, parent: Unit) => void;
  /** Fill the height of its pane (the Units screen's sticky left column) and scroll inside it. */
  fill?: boolean;
}

const NO_STATE = 'State not set';
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
const stateOf = (b: Building) => b.state?.trim() || NO_STATE;
const byState = (a: string, b: string) => (a === NO_STATE ? 1 : b === NO_STATE ? -1 : byName(a, b));
const unitKey = (u: Unit) => u.unitCode || u.listingName;

/** The unit at the top of the tree: what the Units screen opens when the address names none. */
export function firstUnitId(buildings: Building[], units: Unit[]): string | undefined {
  const order = [...buildings].sort((a, b) => byState(stateOf(a), stateOf(b)) || byName(a.name, b.name));
  for (const b of order) {
    const top = units.filter(u => u.buildingId === b.id && !u.parentUnitId).sort((x, y) => byName(unitKey(x), unitKey(y)));
    if (top.length) return top[0].id;
  }
  return units[0]?.id;
}

/** State, then building, then unit, then sub-unit. Buildings start folded, except the one holding the open
 *  unit, so 20-odd buildings read as a short list. A search (kept in the address as ?q=) opens every
 *  building with a hit and keeps a building whose name matches, or the units in it that do. */
export default function UnitTree({ buildings, units, selectedId, readiness, canEdit, onSelect, onEditBuilding, onAddUnit, onAddSubUnit, fill }: Props) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const setQ = (v: string) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set('q', v); else n.delete('q'); return n; }, { replace: true });
  // Only what the user toggled by hand; everything else follows the default (open if it holds the open unit).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const needle = q.trim().toLowerCase();
  const listRef = useRef<HTMLDivElement>(null);

  const { kidsOf, topOf } = useMemo(() => {
    const kidsOf = new Map<string, Unit[]>(), topOf = new Map<string, Unit[]>();
    for (const u of units) {
      if (u.parentUnitId) { const l = kidsOf.get(u.parentUnitId) ?? []; l.push(u); kidsOf.set(u.parentUnitId, l); }
      else { const l = topOf.get(u.buildingId) ?? []; l.push(u); topOf.set(u.buildingId, l); }
    }
    for (const l of topOf.values()) l.sort((a, b) => byName(unitKey(a), unitKey(b)));
    return { kidsOf, topOf };
  }, [units]);

  const selected = units.find(u => u.id === selectedId);
  const selectedBuilding = selected?.buildingId;

  const hit = (u: Unit) => !needle || [u.unitCode, u.listingName, u.ownerName].some(s => (s ?? '').toLowerCase().includes(needle));
  const buildingHit = (b: Building) => !!needle && b.name.toLowerCase().includes(needle);
  const childrenOf = (uid: string) => kidsOf.get(uid) ?? [];
  const topUnitsOf = (b: Building) => (topOf.get(b.id) ?? [])
    .filter(u => !needle || buildingHit(b) || hit(u) || childrenOf(u.id).some(hit));

  const groups = useMemo(() => {
    const groupsByState = new Map<string, Building[]>();
    for (const b of buildings) {
      const key = stateOf(b);
      const l = groupsByState.get(key) ?? []; l.push(b); groupsByState.set(key, l);
    }
    for (const l of groupsByState.values()) l.sort((a, b) => byName(a.name, b.name));
    return [...groupsByState.entries()].sort(([a], [b]) => byState(a, b));
  }, [buildings]);

  const shownGroups = groups
    .map(([state, list]) => [state, list.filter(b => !needle || buildingHit(b) || topUnitsOf(b).length > 0)] as const)
    .filter(([, list]) => list.length > 0);
  const matchCount = needle ? shownGroups.reduce((n, [, list]) => n + list.reduce((m, b) => m + topUnitsOf(b).length, 0), 0) : 0;

  const isOpen = (b: Building) => (needle ? true : toggled[b.id] ?? b.id === selectedBuilding);
  const anyOpen = !needle && buildings.some(isOpen);
  const setAll = (open: boolean) => setToggled(Object.fromEntries(buildings.map(b => [b.id, open])));

  // Bring the open unit into view once, when the tree first has it (a link can open a unit far down the list).
  const scrolledFor = useRef('');
  useEffect(() => {
    if (!selectedId || scrolledFor.current === selectedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>('[aria-current="true"]');
    if (!el) return;
    scrolledFor.current = selectedId;
    const box = listRef.current;
    if (el.offsetTop < box.scrollTop || el.offsetTop > box.scrollTop + box.clientHeight - 40) box.scrollTop = el.offsetTop - box.clientHeight / 3;
  });

  const dot = (id: string) => {
    const r = readiness[id];
    return r ? <span title={READINESS[r].label} aria-label={READINESS[r].label} className="w-2 h-2 rounded-full flex-none" style={{ background: T[READY_TONE[r]].line }} /> : null;
  };

  return (
    <Card style={fill ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : undefined}>
      <div className="py-[10px] px-3 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2 flex-none">
        <div className="relative flex items-center">
          <span className="absolute left-[10px] text-muted-ink flex pointer-events-none"><Icon name="Search" size="sm" /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, listing, owner, building" aria-label="Search units"
            className="field-input h-[36px]! w-full pl-[32px]! pr-[32px]! text-copy!" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear search"
              className="absolute right-[6px] w-6 h-6 grid place-items-center rounded-control bg-transparent [border:none] cursor-pointer text-muted-ink hover:bg-muted"><Icon name="X" size="sm" /></button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 min-h-[20px]">
          <span className="text-meta font-semibold text-muted-ink [font-variant-numeric:tabular-nums]">
            {needle ? `${matchCount} of ${units.length} units match` : 'Buildings'}
          </span>
          {!needle && buildings.length > 1 && (
            <button type="button" onClick={() => setAll(!anyOpen)}
              className="bg-transparent [border:none] p-0 cursor-pointer [font:inherit] text-meta! font-medium text-gold-ink whitespace-nowrap">
              {anyOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      </div>
      <div ref={listRef} className={cx('relative overflow-y-auto overscroll-contain [scrollbar-width:thin]', fill ? 'flex-1 min-h-0' : 'max-h-[68vh]')}>
        {shownGroups.length === 0 && <div className="p-6 text-center text-copy text-muted-ink">{needle ? 'Nothing matches that search.' : 'No buildings yet.'}</div>}
        {shownGroups.map(([state, list]) => (
          <div key={state}>
            <div className="sticky top-0 z-[1] py-[8px] px-4 bg-page [border-bottom:1px_solid_var(--color-line-soft)] text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink flex justify-between">
              <span>{state.toUpperCase()}</span>
              <span className="[font-variant-numeric:tabular-nums]">{list.reduce((s, b) => s + topUnitsOf(b).length, 0)} units</span>
            </div>
            {list.map(b => {
              const us = topUnitsOf(b);
              const open = isOpen(b);
              const holdsSelected = b.id === selectedBuilding;
              return (
                <div key={b.id}>
                  <div className={cx('flex items-center gap-2 py-[9px] pr-3 pl-[12px] [border-bottom:1px_solid_var(--color-line-soft)]', !open && holdsSelected && 'shadow-[inset_3px_0_0_var(--color-gold)]')}>
                    <button onClick={() => setToggled(c => ({ ...c, [b.id]: !open }))} aria-expanded={open} disabled={!!needle}
                      className="flex items-center gap-2 flex-1 bg-transparent [border:none] cursor-pointer disabled:cursor-default [font:inherit] text-left min-w-0 p-0 text-ink">
                      <span className="[transition:transform_160ms] text-muted-ink flex flex-none" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}><Icon name="ChevronRight" size="sm" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={b.name}>{b.name}</span>
                        {b.city && <span className="block text-caption text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{b.city}</span>}
                      </span>
                      <span className="flex-none min-w-[26px] h-[20px] px-1.5 box-border rounded-pill bg-muted text-caption font-semibold text-muted-ink grid place-items-center [font-variant-numeric:tabular-nums]"
                        title={`${us.length} ${us.length === 1 ? 'unit' : 'units'}`}>{us.length}</span>
                    </button>
                    {canEdit && <>
                      <button onClick={() => onEditBuilding(b)} aria-label={`Edit ${b.name}`} title="Edit building"
                        className="w-[26px] h-[26px] flex-none grid place-items-center rounded-control border-none bg-transparent text-muted-ink cursor-pointer hover:bg-muted"><Icon name="Pencil" size="sm" /></button>
                      <button onClick={() => onAddUnit(b.id)} aria-label={`Add a unit to ${b.name}`} title="Add unit"
                        className="w-[26px] h-[26px] flex-none grid place-items-center rounded-control border border-solid border-line bg-card cursor-pointer text-muted-ink"><Icon name="Plus" size="sm" /></button>
                    </>}
                  </div>
                  {open && us.map(u => {
                    const on = u.id === selectedId;
                    const kids = childrenOf(u.id);
                    return (
                      <div key={u.id}>
                        <div className={cx('flex items-center gap-1 pr-2 [border-bottom:1px_solid_var(--color-line-soft)]', on ? 'bg-gold-tint shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card hover:bg-page')}>
                          <button onClick={() => onSelect(u.id)} aria-current={on ? 'true' : undefined} title={[u.unitCode, u.listingName].filter(Boolean).join(' · ')}
                            className="flex items-center gap-[10px] flex-1 min-w-0 py-[8px] pr-1 pl-[34px] [border:none] bg-transparent cursor-pointer [font:inherit] text-left text-ink">
                            {dot(u.id)}
                            <span className="flex-1 min-w-0">
                              <span className={cx('block text-copy whitespace-nowrap overflow-hidden text-ellipsis', on ? 'font-semibold' : 'font-medium')}>{u.unitCode || 'New unit'}</span>
                              <span className="block text-caption text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.ownerName ? titleCase(u.ownerName) : 'No owner yet'}{kids.length ? ` · ${kids.length} sub-unit${kids.length > 1 ? 's' : ''}` : ''}</span>
                            </span>
                            <span className="text-caption font-bold text-gold-ink flex-none" title={u.termsLabel ?? (u.revenueModel ? MODEL[u.revenueModel].label : u.pkg)}>{u.revenueModel ? MODEL[u.revenueModel].short : u.pkg.replace('Package ', 'Pkg ')}</span>
                          </button>
                          {canEdit && (
                            <button onClick={() => onAddSubUnit(b.id, u)} aria-label={`Add a sub-unit under ${u.unitCode || 'this unit'}`} title="Add sub-unit"
                              className="w-[24px] h-[24px] flex-none grid place-items-center rounded-control border border-solid border-line bg-card cursor-pointer text-muted-ink"><Icon name="Plus" size="sm" /></button>
                          )}
                        </div>
                        {kids.filter(k => !needle || buildingHit(b) || hit(u) || hit(k)).map(su => {
                          const son = su.id === selectedId;
                          return (
                            <button key={su.id} onClick={() => onSelect(su.id)} aria-current={son ? 'true' : undefined}
                              className={cx('flex items-center gap-[10px] w-full py-[8px] pr-4 pl-[54px] [border:none] [border-bottom:1px_solid_var(--color-line-soft)]! cursor-pointer [font:inherit] text-left text-ink', son ? 'bg-gold-tint shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card hover:bg-page')}>
                              {dot(su.id)}
                              <span className="flex-1 min-w-0">
                                <span className={cx('flex items-center gap-1.5 text-meta whitespace-nowrap overflow-hidden text-ellipsis', son ? 'font-semibold' : 'font-medium')}>
                                  <span className="overflow-hidden text-ellipsis">{su.unitCode || 'New sub-unit'}</span>
                                  <span className="text-caption font-bold tracking-[0.06em] text-gold-ink flex-none">SUB</span>
                                </span>
                                <span className="block text-caption text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{su.listingName || 'Room / floor'}</span>
                              </span>
                              <span className="text-caption font-bold text-muted-ink flex-none">{su.split === 'Not set' ? '' : su.split.split(' ')[0]}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}
