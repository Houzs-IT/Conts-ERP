import { useId } from 'react';
import Icon from './Icon';

/**
 * A number stepped with minus and plus (Conts DS v2, the prototype's ui.f.stepper): guests, beds, quantities.
 * Stays within `min` and `max`; the buttons at either end are disabled rather than doing nothing. 44px on touch.
 */
export function Stepper({ label, value, onChange, min = 0, max = 99, step = 1, help, disabled }: {
  label?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; help?: string; disabled?: boolean;
}) {
  const id = useId();
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {label && <span id={`${id}-l`} className="ds-label">{label}</span>}
      <div className="ds-stepper self-start" role="group" aria-labelledby={label ? `${id}-l` : undefined}>
        <button type="button" aria-label="Less" disabled={disabled || value <= min} onClick={() => set(value - step)}><Icon name="Minus" size="sm" /></button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label="More" disabled={disabled || value >= max} onClick={() => set(value + step)}><Icon name="Plus" size="sm" /></button>
      </div>
      {help && <span className="text-meta text-muted-ink">{help}</span>}
    </div>
  );
}
