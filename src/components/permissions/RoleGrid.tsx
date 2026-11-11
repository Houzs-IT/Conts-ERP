import { useState } from 'react';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import type { AccessCategory } from '../../lib/types';
import {
  TIER_LEVELS, areaKeysOf, lowerBelow, raiseTo, tierState, type RoleLevels, type TierLevel, type TierState,
} from '../../lib/roleGrid';
import { SIDE_OPTIONS, categorySide } from './shared';
import { TIER_HINT, TIER_LABEL, TierBoxes } from './TierBoxes';

export interface RoleCompany { key: string; label: string; categories: AccessCategory[] }

export function groupByCompany(categories: AccessCategory[]): RoleCompany[] {
  return SIDE_OPTIONS
    .map(option => ({
      key: option.value,
      label: option.value === 'both' ? 'Both companies' : option.label,
      categories: categories.filter(category => categorySide(category.group) === option.value),
    }))
    .filter(company => company.categories.length > 0);
}

export interface RoleGridProps {
  companies: RoleCompany[];
  levels: RoleLevels;
  savedLevels: RoleLevels;
  isLocked: boolean;
  onChange: (next: RoleLevels) => void;
}

const ROW = 'grid items-center px-5 grid-cols-[minmax(0,1fr)_repeat(3,64px)] max-md:px-4 max-md:grid-cols-[minmax(0,1fr)_repeat(3,46px)]';

const statesFor = (levels: RoleLevels, keys: string[]): Record<TierLevel, TierState> => ({
  view: tierState(levels, keys, 'view'),
  edit: tierState(levels, keys, 'edit'),
  full: tierState(levels, keys, 'full'),
});

export default function RoleGrid({ companies, levels, savedLevels, isLocked, onChange }: RoleGridProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (group: string) => setOpenGroups(previous => {
    const next = new Set(previous);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });

  const boxesFor = (label: string, keys: string[]) => (
    <TierBoxes
      states={statesFor(levels, keys)}
      label={label}
      isDisabled={isLocked}
      isChanged={keys.some(key => levels[key] !== savedLevels[key])}
      onRaise={tier => onChange(raiseTo(levels, keys, tier))}
      onLower={tier => onChange(lowerBelow(levels, keys, tier))}
    />
  );

  return (
    <div>
      <div className={cx(ROW, 'py-2.5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold text-ink')}>
        <div className="text-muted-ink">Group and area</div>
        {TIER_LEVELS.map(tier => <div key={tier} title={TIER_HINT[tier]} className="text-center">{TIER_LABEL[tier]}</div>)}
      </div>
      {companies.map(company => (
        <div key={company.key}>
          <div className="px-5 max-md:px-4 pt-3.5 pb-1.5 text-caption font-semibold uppercase tracking-wide text-muted-ink">{company.label}</div>
          {company.categories.map(category => {
            const isExpandable = category.areas.length > 1;
            const isOpen = isExpandable && openGroups.has(category.group);
            return (
              <div key={category.group}>
                <div className={cx(ROW, 'min-h-[42px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                  <div className="flex items-center gap-2 min-w-0 text-copy font-medium">
                    {isExpandable ? (
                      <button type="button" onClick={() => toggleGroup(category.group)} aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${category.group}`}
                        className="grid place-items-center size-6 max-md:size-8 p-0 border-0 rounded-control bg-transparent text-muted-ink cursor-pointer">
                        <span className={cx('grid transition-transform duration-150', !isOpen && '-rotate-90')}><Icon name="ChevronDown" size="sm" /></span>
                      </button>
                    ) : <span className="size-6 max-md:size-8 flex-none" />}
                    <span>{category.group}</span>
                    <span className="text-caption font-normal text-muted-ink whitespace-nowrap">{category.areas.length} {category.areas.length === 1 ? 'area' : 'areas'}</span>
                  </div>
                  {boxesFor(category.group, areaKeysOf([category]))}
                </div>
                {isOpen && category.areas.map(area => (
                  <div key={area.key} className={cx(ROW, 'min-h-[42px] bg-muted pl-[46px] max-md:pl-[38px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                    <div className="text-copy min-w-0">{area.label}</div>
                    {boxesFor(area.label, [area.key])}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
