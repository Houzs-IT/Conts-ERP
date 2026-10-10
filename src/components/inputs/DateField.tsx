import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/design-tokens';
import { date as fmtDate, dateTime as fmtDateTime } from '../../lib/format';
import { InputShell, PHONE_SIZING } from './InputShell';

interface BaseProps {
  /** yyyy-mm-dd for dates, HH:mm for times, yyyy-mm-ddTHH:mm for date and time. '' when empty. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  'aria-label'?: string;
  help?: ReactNode;
  error?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  name?: string;
  className?: string;
  style?: CSSProperties;
}

type Kind = 'date' | 'time' | 'datetime-local';

const describe = (kind: Kind, v: string) =>
  kind === 'date' ? fmtDate(v) : kind === 'time' ? v : fmtDateTime(`${v}:00+08:00`);

/** The browser's own picker (calendar on a phone, typeable segments on a desktop), wrapped so every date in the
 *  app has the same height, label, range check and plain-English message. Values compare as strings, which is
 *  exact for these fixed-width formats. */
function NativeField({ kind, value, onChange, label, help, error, min, max, className, style, ...rest }: BaseProps & { kind: Kind }) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  let problem: string | undefined;
  if (value && min && value < min) problem = `Must be on or after ${describe(kind, min)}.`;
  else if (value && max && value > max) problem = `Must be on or before ${describe(kind, max)}.`;
  else if (!value && rest.required && touched) problem = 'Required.';
  const shown = error || (touched || value ? problem : undefined);
  return (
    <InputShell id={id} label={label} help={help} error={shown}>
      <input
        {...rest}
        id={id}
        type={kind}
        value={value}
        min={min}
        max={max}
        aria-invalid={!!shown || undefined}
        aria-describedby={shown || help ? `${id}-help` : undefined}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        className={cx(className ?? 'field-input', PHONE_SIZING)}
        style={{ ...(shown ? { borderColor: 'var(--color-critical-line)' } : {}), ...style }}
      />
    </InputShell>
  );
}

export function DateField(props: BaseProps) { return <NativeField kind="date" {...props} />; }
export function TimeField(props: BaseProps) { return <NativeField kind="time" {...props} />; }
export function DateTimeField(props: BaseProps) { return <NativeField kind="datetime-local" {...props} />; }
