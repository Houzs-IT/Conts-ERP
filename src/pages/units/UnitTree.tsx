import { useState } from 'react';
import { Card } from '../../components/Card';
import Icon from '../../components/Icon';
import { tone as T } from '../../theme';
import { cx } from '../../lib/design-tokens';
import type { UnitReadiness } from '../../lib/types';
import { READY_TONE, cap, type Building, type Unit } from './shared';

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
}

/** State, then building, then unit, then sub-unit. Search keeps a building whose name matches, or the units in it that do. */
export default function UnitTree({ buildings, units, selectedId, readiness, canEdit, onSelect, onEditBuilding, onAddUnit, onAddSubUnit }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  const hit = (u: Unit) => !needle || [u.unitCode, u.listingName, u.ownerName].some(s => s.toLowerCase().includes(needle));
  const buildingHit = (b: Building) => !!needle && b.name.toLowerCase().includes(needle);
  const childrenOf = (uid: string) => units.filter(u => u.parentUnitId === uid);
  const topUnitsOf = (b: Building) => units.filter(u => u.buildingId === b.id && !u.parentUnitId)
    .filter(u => buildingHit(b) || hit(u) || childrenOf(u.id).some(hit));

  const byState: Record<string, Building[]> = {};
  buildings.filter(b => !needle || buildingHit(b) || topUnitsOf(b).length > 0).forEach(b => (byState[b.state] ??= []).push(b));

  const dot = (id: string) => {
    const r = readiness[id];
    return r ? <span title={cap(r)} aria-label={cap(r)} className="w-2 h-2 rounded-full flex-none" style={{ background: T[READY_TONE[r]].line }} /> : null;
  };

  return (
    <Card>
      <div className="py-[10px] px-3 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2">
        <div className="relative flex items-center">
          <span className="absolute left-[10px] text-muted-ink flex pointer-events-none"><Icon name="Search" size="sm" /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, listing, owner, building" aria-label="Search units"
            className="field-input h-[36px]! w-full pl-[32px]! text-[13px]!" />
        </div>
        <span className="text-[12px] font-semibold text-muted-ink">{units.length} units · {buildings.length} buildings</span>
      </div>
      <div className="max-h-[68vh] overflow-y-auto">
        {Object.keys(byState).length === 0 && <div className="p-6 text-center text-[13px] text-muted-ink">{needle ? 'Nothing matches that search.' : 'No buildings yet.'}</div>}
        {Object.entries(byState).map(([state, list]) => (
          <div key={state}>
            <div className="py-[9px] px-4 bg-page [border-bottom:1px_solid_var(--color-line-soft)] text-[10.5px] font-bold tracking-[0.08em] text-muted-ink flex justify-between">
              <span>{state.toUpperCase()}</span><span>{list.reduce((s, b) => s + topUnitsOf(b).length, 0)} units</span>
            </div>
            {list.map(b => {
              const us = topUnitsOf(b);
              const open = !!needle || !collapsed[b.id];
              return (
                <div key={b.id}>
                  <div className="flex items-center gap-2 py-[10px] pr-3 pl-[14px] [border-bottom:1px_solid_var(--color-line-soft)]">
                    <button onClick={() => setCollapsed(c => ({ ...c, [b.id]: open }))} aria-expanded={open}
                      className="flex items-center gap-2 flex-1 bg-transparent [border:none] cursor-pointer [font:inherit] text-left min-w-0 p-0">
                      <span className="[transition:transform_160ms] text-muted-ink flex" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}><Icon name="ChevronRight" size="sm" /></span>
                      <span className="min-w-0">
                        <div className="text-[13px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{b.name}</div>
                        <div className="text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{b.city}</div>
                      </span>
                      <span className="text-[11.5px] text-muted-ink flex-none ml-auto">{us.length}</span>
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
                        <div className={cx('flex items-center gap-1 pr-2 [border-bottom:1px_solid_var(--color-line-soft)]', on ? 'bg-gold-tint shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card')}>
                          <button onClick={() => onSelect(u.id)} aria-current={on ? 'true' : undefined}
                            className="flex items-center gap-[10px] flex-1 min-w-0 py-[9px] pr-1 pl-[34px] [border:none] bg-transparent cursor-pointer [font:inherit] text-left">
                            {dot(u.id)}
                            <span className="flex-1 min-w-0">
                              <div className={cx('text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis', on ? 'font-semibold' : 'font-medium')}>{u.unitCode || 'New unit'}</div>
                              <div className="text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.ownerName || 'No owner yet'}{kids.length ? ` · ${kids.length} sub-unit${kids.length > 1 ? 's' : ''}` : ''}</div>
                            </span>
                            <span className="text-[9.5px] font-bold text-gold-ink flex-none">{u.pkg.replace('Package ', 'Pkg ')}</span>
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
                              className={cx('flex items-center gap-[10px] w-full py-[8px] pr-4 pl-[54px] [border:none] [border-bottom:1px_solid_var(--color-line-soft)]! cursor-pointer [font:inherit] text-left', son ? 'bg-gold-tint shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card')}>
                              {dot(su.id)}
                              <span className="flex-1 min-w-0">
                                <div className={cx('flex items-center gap-1.5 text-[12px] whitespace-nowrap overflow-hidden text-ellipsis', son ? 'font-semibold' : 'font-medium')}>
                                  <span className="overflow-hidden text-ellipsis">{su.unitCode || 'New sub-unit'}</span>
                                  <span className="text-[8.5px] font-bold tracking-[0.06em] text-gold-ink flex-none">SUB</span>
                                </div>
                                <div className="text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{su.listingName || 'Room / floor'}</div>
                              </span>
                              <span className="text-[9.5px] font-bold text-muted-ink flex-none">{su.split === 'Not set' ? '' : su.split.split(' ')[0]}</span>
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
