import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/design-tokens';
import { InputShell, PHONE_SIZING } from './InputShell';

export interface CodeInputProps {
  value: string;
  onChange: (digits: string) => void;
  label?: string;
  /** Digits in the code. 6 for an authenticator app. */
  length?: number;
  help?: ReactNode;
  error?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  required?: boolean;
}

/** A one-time sign-in code. No maxLength on the element: a pasted "123 456" or "123-456" would be cut to "123 45"
 *  before the spaces were dropped; instead the digits are kept and then trimmed to the length. */
export function CodeInput({ value, onChange, length = 6, label = `${length}-digit code`, help, error, ...rest }: CodeInputProps) {
  const id = useId();
  return (
    <InputShell id={id} label={label} help={help} error={error}>
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        spellCheck={false}
        placeholder={'1234567890'.slice(0, length)}
        value={value}
        aria-invalid={!!error || undefined}
        aria-describedby={error || help ? `${id}-help` : undefined}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        className={cx('field-input', PHONE_SIZING)}
        style={{ letterSpacing: '0.2em', fontVariantNumeric: 'tabular-nums', ...(error ? { borderColor: 'var(--color-critical-line)' } : {}) }}
      />
    </InputShell>
  );
}
