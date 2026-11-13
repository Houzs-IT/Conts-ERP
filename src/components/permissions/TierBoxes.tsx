import { cx } from '../../lib/design-tokens';
import { TIER_LEVELS, type TierLevel, type TierState } from '../../lib/roleGrid';
import { LEVEL_COLOR } from './shared';

export const TIER_LABEL: Record<TierLevel, string> = { view: 'View', edit: 'Edit', full: 'Full' };
export const TIER_HINT: Record<TierLevel, string> = { view: 'Read only', edit: 'Create and change', full: 'Delete and approve' };

export interface TierBoxesProps {
  states: Record<TierLevel, TierState>;
  label: string;
  isDisabled: boolean;
  isChanged: boolean;
  onRaise: (tier: TierLevel) => void;
  onLower: (tier: TierLevel) => void;
}

export function TierBoxes({ states, label, isDisabled, isChanged, onRaise, onLower }: TierBoxesProps) {
  return (
    <>
      {TIER_LEVELS.map(tier => (
        <label key={tier} className={cx('flex justify-center items-center self-stretch max-md:min-h-11', isDisabled ? 'cursor-default' : 'cursor-pointer')}>
          <input
            type="checkbox"
            aria-label={`${label}: ${TIER_LABEL[tier]}`}
            checked={states[tier] === 'on'}
            disabled={isDisabled}
            ref={input => { if (input) input.indeterminate = states[tier] === 'mixed'; }}
            onChange={event => (event.target.checked ? onRaise(tier) : onLower(tier))}
            className="h-[18px] w-[18px] m-0 cursor-pointer disabled:cursor-default max-md:h-[22px] max-md:w-[22px]"
            style={{ accentColor: LEVEL_COLOR[tier], boxShadow: isChanged ? '0 0 0 2px var(--color-gold)' : undefined, borderRadius: 3 }}
          />
        </label>
      ))}
    </>
  );
}
