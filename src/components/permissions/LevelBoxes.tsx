import { cx } from '../../lib/design-tokens';
import type { AccessLevel } from '../../lib/types';
import { LEVEL_COLOR } from './shared';

/** The levels as three cumulative boxes: a higher box implies the ones before it. No box ticked is No access. */
export const TIERS: readonly { level: AccessLevel; label: string }[] = [{ level: 'full', label: 'Full' }, { level: 'edit', label: 'Edit' }, { level: 'view', label: 'View' }];
const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, full: 3 };
// Unticking a box drops to the level below it, so unticking View leaves No access.
const BELOW: Record<AccessLevel, AccessLevel> = { none: 'none', view: 'none', edit: 'view', full: 'edit' };

export interface LevelBoxesProps {
  level: AccessLevel | undefined;
  label: string;
  disabled: boolean;
  /** Inherited from somewhere above: drawn lighter so the eye goes to the overrides. */
  faded?: boolean;
  changed?: boolean;
  onPick: (next: AccessLevel) => void;
}

/** The View, Edit and Full cells of one row (three grid cells). Each whole cell is the tap target, 44px tall on a phone. */
export function LevelBoxes({ level, label, disabled, faded = false, changed = false, onPick }: LevelBoxesProps) {
  const rank = RANK[level ?? 'none'];
  return (
    <>
      {TIERS.map(t => (
        <label key={t.level} className={cx('flex justify-center items-center self-stretch max-md:min-h-11', disabled ? 'cursor-default' : 'cursor-pointer', faded && 'opacity-60')}>
          <input type="checkbox" aria-label={`${label}: ${t.label}`} checked={rank >= RANK[t.level]} disabled={disabled}
            onChange={e => onPick(e.target.checked ? t.level : BELOW[t.level])}
            className="h-[18px] w-[18px] m-0 cursor-pointer disabled:cursor-default"
            style={{ accentColor: LEVEL_COLOR[t.level], boxShadow: changed ? '0 0 0 2px var(--color-gold)' : undefined, borderRadius: 3 }} />
        </label>
      ))}
    </>
  );
}
