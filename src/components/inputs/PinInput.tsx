import { useId, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx } from '../../lib/design-tokens';
import { InputShell } from './InputShell';

export interface PinInputProps {
  value: string;
  onChange: (digits: string) => void;
  label?: string;
  /** Digits in the PIN. 6 for the field app. */
  length?: number;
  /** current-password to sign in, new-password when choosing one, so a password manager offers the right thing. */
  autoComplete?: 'current-password' | 'new-password';
  help?: ReactNode;
  error?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  required?: boolean;
}

/** A PIN drawn as one box per digit. One real input lies invisibly over the boxes, so typing, paste, backspace,
 *  the phone's number pad and password managers behave as in any field; the boxes only draw it. Dots by default,
 *  since a PIN is typed on a shared phone in front of others; the eye shows the digits. No maxLength, for the
 *  reason CodeInput gives: the digits are kept and then trimmed to the length. */
export function PinInput({ value, onChange, length = 6, label = 'PIN', autoComplete = 'current-password', help, error, ...rest }: PinInputProps) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  // The box the next digit goes in; the last one stays lit once the PIN is full.
  const next = Math.min(value.length, length - 1);
  // The caret is invisible, so it is kept at the end: a tap in the middle never inserts a digit out of sight.
  const toEnd = (el: HTMLInputElement) => { if (el.selectionStart !== el.value.length) el.setSelectionRange(el.value.length, el.value.length); };

  return (
    <InputShell id={id} label={label} help={help} error={error}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0 grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
          {Array.from({ length }, (_, i) => {
            const digit = value[i];
            return (
              <div key={i} aria-hidden
                className={cx(
                  'h-12 grid place-items-center rounded-control border border-solid bg-card text-[20px] font-semibold tabular-nums text-ink transition-[border-color,box-shadow] duration-[var(--motion-fast)]',
                  error ? 'border-danger-line'
                    : focused && i === next ? 'border-[var(--color-border-focus)] [box-shadow:0_0_0_2px_color-mix(in_srgb,var(--color-border-focus)_35%,transparent)]'
                    : digit ? 'border-[var(--color-text-muted)]' : 'border-line',
                  rest.disabled && 'opacity-50',
                )}>
                {digit && (show ? digit : <span className="w-2.5 h-2.5 rounded-full bg-ink" />)}
              </div>
            );
          })}
          <input
            {...rest}
            id={id}
            type={show ? 'text' : 'password'}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={autoComplete}
            spellCheck={false}
            value={value}
            aria-invalid={!!error || undefined}
            aria-describedby={error || help ? `${id}-help` : undefined}
            onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
            onFocus={e => { setFocused(true); toEnd(e.currentTarget); }}
            onBlur={() => setFocused(false)}
            onSelect={e => toEnd(e.currentTarget)}
            // 16px so iOS does not zoom the page; opacity 0 hides the text, the caret and the focus ring the boxes redraw.
            className="absolute inset-0 w-full h-full m-0 p-0 border-0 opacity-0 text-[16px] cursor-text disabled:cursor-default"
          />
        </div>
        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide PIN' : 'Show PIN'} aria-controls={id} aria-pressed={show}
          className="flex-none w-11 h-12 grid place-items-center rounded-control bg-transparent border-0 cursor-pointer text-muted-ink hover:text-ink outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-border-focus)]">
          {show ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
        </button>
      </div>
    </InputShell>
  );
}
