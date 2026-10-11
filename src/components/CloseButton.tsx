import Icon from './Icon';
import { cx } from '../lib/design-tokens';

/**
 * The X at the top right of every drawer and panel. One size everywhere (36px, a comfortable thumb target on a
 * phone); `onDark` is for a header drawn on black, such as the reservation drawer's.
 */
export function CloseButton({ onClick, onDark = false, disabled = false, className }: {
  onClick: () => void;
  onDark?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label="Close"
      className={cx('w-9 h-9 flex-none grid place-items-center rounded-control border-none cursor-pointer outline-none',
        'transition-colors duration-[var(--motion-fast)] focus-visible:[box-shadow:0_0_0_2px_var(--color-gold)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        onDark ? 'bg-[rgba(255,255,255,0.14)] text-white hover:bg-[rgba(255,255,255,0.24)]' : 'bg-transparent text-muted-ink hover:bg-muted hover:text-ink',
        className)}>
      <Icon name="X" size="sm" />
    </button>
  );
}
