import type { CSSProperties } from 'react';
import Icon from '../Icon';
import { countDifferences, differenceFromRole, type RoleDifference, type RoleLevels } from '../../lib/roleGrid';
import { TAG } from './shared';

interface DifferenceTone { label: string; hint: string; style: CSSProperties }

const TONE_BY_DIFFERENCE: Record<RoleDifference, DifferenceTone | null> = {
  extra: {
    label: 'Extra', hint: 'More than their role gives',
    style: { background: 'var(--color-info-bg)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' },
  },
  less: {
    label: 'Less', hint: 'Less than their role gives',
    style: { background: 'var(--color-warning-bg)', color: 'var(--color-warning-fg)', borderColor: 'var(--color-warning-line)' },
  },
  same: null,
};

const COUNT_STYLE: CSSProperties = { color: 'var(--color-text-muted)', borderColor: 'var(--color-line)' };

export interface RoleDifferenceMarkProps {
  label: string;
  areaKeys: string[];
  levels: RoleLevels;
  roleLevels: RoleLevels;
  isLocked: boolean;
  onReset: () => void;
}

function toneFor(areaKeys: string[], levels: RoleLevels, roleLevels: RoleLevels, differing: number): DifferenceTone {
  const [onlyKey] = areaKeys;
  const singleTone = areaKeys.length === 1 ? TONE_BY_DIFFERENCE[differenceFromRole(levels[onlyKey], roleLevels[onlyKey])] : null;
  return singleTone ?? { label: `${differing} custom`, hint: `${differing} areas differ from their role`, style: COUNT_STYLE };
}

export function RoleDifferenceMark({ label, areaKeys, levels, roleLevels, isLocked, onReset }: RoleDifferenceMarkProps) {
  const differing = countDifferences(levels, roleLevels, areaKeys);
  if (differing === 0) return null;
  const tone = toneFor(areaKeys, levels, roleLevels, differing);
  return (
    <span className="flex items-center gap-1">
      <span className={TAG} style={tone.style} title={tone.hint}>{tone.label}</span>
      {!isLocked && (
        <button type="button" onClick={onReset} aria-label={`Reset ${label} to their role`} title="Reset to their role"
          className="grid place-items-center size-7 max-md:size-11 p-0 border-0 rounded-control bg-transparent text-muted-ink cursor-pointer hover:bg-page hover:text-ink">
          <Icon name="RotateCcw" size="sm" />
        </button>
      )}
    </span>
  );
}
