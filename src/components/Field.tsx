import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Omit when the label is printed beside the field (settings rows); pass aria-label instead. */
  label?: ReactNode;
  /** Shown under the field. Error tone when `error` is set. */
  help?: string;
  error?: string;
  /** Right-aligned tabular input for money and metrics. */
  numeric?: boolean;
  trailing?: ReactNode;
}

/** Label persists above the field. Placeholder is an example, never a label. */
export function Field({ label, help, error, numeric, trailing, style, ...rest }: Props) {
  const id = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {label !== undefined && (
        <label htmlFor={id} style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          {...rest}
          id={id}
          aria-invalid={!!error}
          aria-describedby={error || help ? `${id}-help` : undefined}
          className="field-input"
          style={{
            ...(numeric ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : {}),
            ...(error ? { borderColor: 'var(--color-critical-line)' } : {}),
            ...(trailing ? { paddingRight: 44 } : {}),
            ...style,
          }}
        />
        {trailing && <span style={{ position: 'absolute', right: 12, display: 'flex' }}>{trailing}</span>}
      </div>
      {(error || help) && (
        <span id={`${id}-help`} style={{ fontSize: 'var(--text-small)', color: error ? 'var(--color-critical-fg)' : 'var(--color-text-muted)' }}>
          {error || help}
        </span>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<Props, 'type' | 'trailing'>) {
  const [show, setShow] = useState(false);
  return (
    <Field
      {...props}
      type={show ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          style={{ display: 'flex', background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--color-text-muted)' }}
        >
          {show ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
        </button>
      }
    />
  );
}
