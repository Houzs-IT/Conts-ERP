import { useId } from 'react';
import { InputShell, PHONE_SIZING } from './InputShell';

export interface EmployeeIdInputProps {
  /** The digits after EMP-. */
  value: string;
  onChange: (digits: string) => void;
  label?: string;
  error?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
}

/** Employee ID with EMP- fixed in front: only the number is typed, so the prefix can never be deleted or typed
 *  twice. A paste or a password manager's saved "EMP-012" is cut back to "012". */
export function EmployeeIdInput({ value, onChange, label = 'Employee ID', error, ...rest }: EmployeeIdInputProps) {
  const id = useId();
  return (
    <InputShell id={id} label={label} error={error}
      leading={<span className="text-copy font-medium text-muted-ink tabular-nums tracking-[0.04em]">EMP-</span>}>
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="001"
        value={value}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-help` : undefined}
        onChange={e => onChange(e.target.value.replace(/^\s*EMP-?/i, '').replace(/\D/g, '').slice(0, 7))}
        className={`field-input ${PHONE_SIZING}`}
        style={{ paddingLeft: 56, letterSpacing: '0.04em', fontVariantNumeric: 'tabular-nums' }}
      />
    </InputShell>
  );
}
