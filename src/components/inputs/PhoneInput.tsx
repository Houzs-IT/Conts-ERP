import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/design-tokens';
import { phone } from '../../lib/format';
import { InputShell, PHONE_SIZING } from './InputShell';

export interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  'aria-label'?: string;
  help?: ReactNode;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Digit count a phone number may have, country code included (E.164 allows 15). */
const MIN_DIGITS = 7, MAX_DIGITS = 15;

/** Spaces, dashes and brackets are kept as typed; anything else (letters, stray symbols) is dropped. */
export const cleanPhone = (raw: string) => raw.replace(/[^\d+\-() ]/g, '').replace(/(?!^)\+/g, '');

export function phoneProblem(value: string): string | undefined {
  const digits = value.replace(/\D/g, '').length;
  if (!value.trim()) return undefined;
  if (digits < MIN_DIGITS) return `Too short for a phone number. Example: +60 12-345 6789.`;
  if (digits > MAX_DIGITS) return `Too long for a phone number (at most ${MAX_DIGITS} digits).`;
  return undefined;
}

/** Phone keypad on a phone, tel autofill, and a plain-English note when the number cannot be right. On leaving the
 *  field a usable number is written the way the app shows phones everywhere: 0123456789 becomes +60 12-345 6789. */
export function PhoneInput({ value, onChange, label, help, error, placeholder = '+60 12-345 6789', className, style, ...rest }: PhoneInputProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const shown = error || (touched ? phoneProblem(value) : undefined) || (touched && rest.required && !value.trim() ? 'Required.' : undefined);
  return (
    <InputShell id={id} label={label} help={help} error={shown}>
      <input
        {...rest}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={placeholder}
        value={value}
        aria-invalid={!!shown || undefined}
        aria-describedby={shown || help ? `${id}-help` : undefined}
        onChange={e => onChange(cleanPhone(e.target.value))}
        onBlur={() => { setTouched(true); const tidy = phoneProblem(value) ? value.replace(/\s+/g, ' ').trim() : phone(value); if (tidy !== value) onChange(tidy); }}
        className={cx(className ?? 'field-input', PHONE_SIZING)}
        style={{ ...(shown ? { borderColor: 'var(--color-critical-line)' } : {}), ...style }}
      />
    </InputShell>
  );
}
