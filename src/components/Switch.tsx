import { cx } from '../lib/design-tokens';

/**
 * The one on/off switch (owner, 3 Nov 2026: the same control looks the same everywhere). Conts DS v2: on is Conts
 * green, off is the strong line colour; the knob takes the card colour, so it shows against the track in both themes.
 * 38 x 22 with a pointer, 46 x 28 on a touch screen, plus a 44px tap area on a phone (.hit-target).
 * `stopPropagation` for a switch inside a clickable row, so flipping it does not also open the row.
 */
export function Switch({ checked, onChange, label, disabled, stopPropagation }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; stopPropagation?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={e => { if (stopPropagation) e.stopPropagation(); onChange(!checked); }}
      className={cx('hit-target flex-none w-[38px] h-[22px] [@media(pointer:coarse)]:w-[46px] [@media(pointer:coarse)]:h-[28px] rounded-full border-none p-[3px] cursor-pointer flex items-center disabled:cursor-not-allowed disabled:opacity-50',
        'outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-gold)]',
        '[transition:background_var(--motion-fast)_var(--ease-out)]', checked ? 'bg-primary justify-end' : 'bg-line-strong justify-start')}>
      <span className="w-4 h-4 [@media(pointer:coarse)]:w-[22px] [@media(pointer:coarse)]:h-[22px] rounded-full bg-card [box-shadow:0_1px_2px_rgba(0,0,0,0.2)]" />
    </button>
  );
}
