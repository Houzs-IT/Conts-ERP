import { useId } from 'react';
import ChannelMark from './ChannelMark';
import type { BookingChannel } from '../lib/types';

export interface Choice<V extends string> { value: V; label: string; channel?: BookingChannel; disabled?: boolean }

/**
 * One-tap choice chips (Conts DS v2, the prototype's ui.f.choice): for channel, reason, type, priority or who pays,
 * in place of a dropdown when there are six options or fewer. A chip can carry its channel's logo. The chosen chip
 * is filled with ink. Exactly one value; `value` '' means none chosen yet. 44px tall on a touch screen.
 */
export function ChoiceChips<V extends string>({ label, options, value, onChange, required, help, disabled }: {
  label?: string; options: readonly Choice<V>[]; value: V | ''; onChange: (v: V) => void;
  required?: boolean; help?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {label && <span id={`${id}-l`} className="ds-label">{label}{required && <span className="ds-req" aria-hidden>*</span>}</span>}
      <div role="radiogroup" aria-labelledby={label ? `${id}-l` : undefined} aria-label={label ? undefined : 'Choose one'} aria-required={required || undefined} className="ds-choice">
        {options.map(o => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} aria-pressed={o.value === value}
            disabled={disabled || o.disabled} onClick={() => onChange(o.value)}>
            {o.channel && <ChannelMark ch={o.channel} size={18} />}
            {o.label}
          </button>
        ))}
      </div>
      {help && <span className="text-meta text-muted-ink">{help}</span>}
    </div>
  );
}
