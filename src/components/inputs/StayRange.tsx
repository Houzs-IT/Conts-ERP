import { useId } from 'react';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { nights as nightsLabel } from '../../lib/format';
import { PHONE_SIZING } from './InputShell';

/** Whole nights from check-in to checkout (yyyy-mm-dd strings, compared as calendar days, so no time zone moves them). */
export function nightsBetween(from: string, to: string): number | null {
  const a = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)) : NaN;
  const b = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) : NaN;
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
}

/**
 * A stay in one control (Conts DS v2, the prototype's ui.f.stay): check-in, an arrow, checkout, and the night count
 * kept up to date on the right. Use it instead of two separate date fields. Values stay ISO (yyyy-mm-dd), as every
 * date input's value does; the browser's own picker shows them. A checkout on or before check-in reads "Check dates".
 */
export function StayRange({ from, to, onChange, label = 'Stay', required, min, help, error, disabled }: {
  from: string; to: string; onChange: (from: string, to: string) => void;
  label?: string; required?: boolean; min?: string; help?: string; error?: string; disabled?: boolean;
}) {
  const id = useId();
  const n = nightsBetween(from, to);
  const bad = n !== null && n <= 0;
  const message = error || help;
  return (
    <div className="ds-stay flex flex-col gap-1.5 min-w-0">
      {label && <label htmlFor={`${id}-from`} className="ds-label">{label}{required && <span className="ds-req" aria-hidden>*</span>}</label>}
      <div className="ds-ctl ds-drange" style={error || bad ? { borderColor: 'var(--color-critical-line)' } : undefined}>
        <input id={`${id}-from`} type="date" aria-label="Check-in" value={from} min={min} required={required} disabled={disabled}
          className={PHONE_SIZING} onChange={e => onChange(e.target.value, to)} />
        <span className="ds-arr" aria-hidden><Icon name="ArrowRight" size="sm" /></span>
        <input type="date" aria-label="Checkout" value={to} min={from || min} required={required} disabled={disabled}
          className={PHONE_SIZING} onChange={e => onChange(from, e.target.value)} />
        <span className={cx('ds-nights', bad && 'is-bad')} aria-live="polite">{n === null ? '' : bad ? 'Check dates' : nightsLabel(n)}</span>
      </div>
      {message && <span className={cx('text-meta', error ? 'text-danger' : 'text-muted-ink')}>{message}</span>}
    </div>
  );
}
