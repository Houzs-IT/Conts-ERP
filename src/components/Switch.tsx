import { cx } from '../lib/design-tokens';

/**
 * The one on/off switch (owner, 3 Nov 2026: the same control looks the same everywhere). On is ink, off is the strong
 * line colour; the knob takes the card colour, so it shows against the track in both themes. On a touch phone it has a 44px tap area (.hit-target).
 * `stopPropagation` for a switch inside a clickable row, so flipping it does not also open the row.
 */
export function Switch({ checked, onChange, label, disabled, stopPropagation }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; stopPropagation?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={e => { if (stopPropagation) e.stopPropagation(); onChange(!checked); }}
      className={cx('hit-target flex-none w-11 h-6 rounded-full border-none p-0.5 cursor-pointer flex items-center disabled:cursor-not-allowed disabled:opacity-50',
        '[transition:background_var(--motion-fast)_var(--ease-out)]', checked ? 'bg-ink justify-end' : 'bg-line-strong justify-start')}>
      <span className="w-5 h-5 rounded-full bg-card [box-shadow:0_1px_2px_rgba(21,21,21,0.25)]" />
    </button>
  );
}
