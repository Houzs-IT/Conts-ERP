import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { plural } from '../../lib/format';
import {
  TIER_LEVELS, bulkKeysOf, lowerBelow, raiseTo, resetToRole, tierState, type RoleLevels, type TierLevel, type TierState,
} from '../../lib/roleGrid';
import { GroupToggle } from './GroupToggle';
import { RoleDifferenceMark } from './RoleDifferenceMark';
import { COMPANY_LABEL, SIDE_OPTIONS, categorySide, useToggleSet } from './shared';
import { TIER_HINT, TIER_LABEL, TierBoxes } from './TierBoxes';

/** `ownGrant`: given one by one, so the group row's ticks leave it alone (owner statement close part 2b). */
export interface GridArea { key: string; label: string; ownGrant?: boolean }
export interface GridCategory { group: string; areas: GridArea[] }
export interface RoleCompany { key: string; label: string; categories: GridCategory[] }

export function groupByCompany(categories: GridCategory[]): RoleCompany[] {
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
  roleLevels?: RoleLevels;
}

const ROW = 'grid items-center px-5 grid-cols-[minmax(0,1fr)_repeat(3,64px)] max-md:px-4 max-md:grid-cols-[minmax(0,1fr)_repeat(3,46px)]';

const GROUP_BUTTON = 'flex items-center gap-2 min-w-0 min-h-8 max-md:min-h-11 p-0 pr-1.5 border-0 rounded-control bg-transparent text-left [font-family:inherit] text-copy font-medium text-ink cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-border-focus)]';

const statesFor =(levels: RoleLevels, keys: string[]): Record<TierLevel, TierState> => ({
  view: tierState(levels, keys, 'view'),
  edit: tierState(levels, keys, 'edit'),
  full: tierState(levels, keys, 'full'),
});

export default function RoleGrid({ companies, levels, savedLevels, isLocked, onChange, roleLevels }: RoleGridProps) {
  const openGroups = useToggleSet();
  const collapsedCompanies = useToggleSet();

  const differenceFor = (label: string, keys: string[]) => roleLevels && (
    <RoleDifferenceMark label={label} areaKeys={keys} levels={levels} roleLevels={roleLevels} isLocked={isLocked}
      onReset={() => onChange(resetToRole(levels, roleLevels, keys))} />
  );

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
          <GroupToggle label={company.label} note={plural(company.categories.length, 'group')}
            isOpen={!collapsedCompanies.has(company.key)} onToggle={() => collapsedCompanies.toggle(company.key)}
            className="px-3 max-md:px-2 pt-2 pb-1 bg-transparent text-muted-ink hover:text-ink" labelClassName={COMPANY_LABEL} />
          {!collapsedCompanies.has(company.key) && company.categories.map(category => {
            const isExpandable = category.areas.length > 1;
            const isOpen = isExpandable && openGroups.has(category.group);
            const groupLabel = (
              <>
                <span>{category.group}</span>
                <span className="text-caption font-normal text-muted-ink whitespace-nowrap">{plural(category.areas.length, 'area')}</span>
              </>
            );
            return (
              <div key={category.group}>
                <div className={cx(ROW, 'min-h-[42px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                  <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0 text-copy font-medium">
                    {isExpandable ? (
                      <button type="button" onClick={() => openGroups.toggle(category.group)} aria-expanded={isOpen} className={GROUP_BUTTON}>
                        <span className="grid place-items-center size-6 max-md:size-8 flex-none text-muted-ink">
                          <span className={cx('grid transition-transform duration-150 motion-reduce:transition-none', !isOpen && '-rotate-90')}><Icon name="ChevronDown" size="sm" /></span>
                        </span>
                        {groupLabel}
                      </button>
                    ) : (
                      <>
                        <span className="size-6 max-md:size-8 flex-none" />
                        {groupLabel}
                      </>
                    )}
                    {differenceFor(category.group, bulkKeysOf(category))}
                  </div>
                  {boxesFor(category.group, bulkKeysOf(category))}
                </div>
                {isOpen && category.areas.map(area => (
                  <div key={area.key} className={cx(ROW, 'min-h-[42px] bg-muted pl-[46px] max-md:pl-[38px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0 text-copy">
                      <span>{area.label}</span>
                      {area.ownGrant && (
                        <span title={`The ${category.group} ticks above do not change this. Tick it here to give it.`}
                          className="rounded-full px-2 py-px text-caption font-medium text-muted-ink [border:1px_solid_var(--color-line)]">Set on its own</span>
                      )}
                      {differenceFor(area.label, [area.key])}
                    </div>
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
