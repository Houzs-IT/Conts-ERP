import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';

export interface GroupToggleProps {
  label: string;
  note: string;
  isOpen: boolean;
  onToggle: () => void;
  className: string;
  labelClassName: string;
}

export function GroupToggle({ label, note, isOpen, onToggle, className, labelClassName }: GroupToggleProps) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={isOpen}
      className={cx('flex w-full items-center gap-2 text-left border-0 [font-family:inherit] cursor-pointer min-h-10 max-md:min-h-11',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-focus)]', className)}>
      <span className={cx('grid text-muted-ink transition-transform duration-150 motion-reduce:transition-none', !isOpen && '-rotate-90')}>
        <Icon name="ChevronDown" size="sm" />
      </span>
      <span className={labelClassName}>{label}</span>
      <span className="text-caption text-muted-ink">{note}</span>
    </button>
  );
}
