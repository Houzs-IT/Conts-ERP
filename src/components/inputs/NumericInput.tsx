import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode,
} from 'react';
import { cx } from '../../lib/design-tokens';
import { InputShell, PHONE_SIZING } from './InputShell';
import { caretAfterClean, cleanNumberText, formatScaled, noticeText, parseScaled } from './numberText';

/** Props every numeric input shares. With `label` it renders like Field; without, bare (give it aria-label). */
export interface NumericBaseProps {
  label?: string;
  'aria-label'?: string;
  help?: ReactNode;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  name?: string;
  id?: string;
  /** Replaces the default `field-input` look, for table cells and toolbars that carry their own classes. */
  className?: string;
  style?: CSSProperties;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

interface EngineProps extends NumericBaseProps {
  /** The number scaled by 10^decimals (sen for money), or null when empty. */
  scaled: number | null;
  onScaled: (n: number | null) => void;
  decimals: number;
  allowNegative: boolean;
  /** Bounds, also scaled. Out-of-range values are kept and explained, never silently clamped. */
  minScaled?: number;
  maxScaled?: number;
  describeBound: (scaled: number) => string;
  fixed: boolean;
  grouping: boolean;
  /** ArrowUp/ArrowDown change the value by this much (scaled). Omit to leave the arrows alone. */
  stepScaled?: number;
  inputMode: 'decimal' | 'numeric';
  leading?: ReactNode;
  trailing?: ReactNode;
  hint?: (scaled: number | null) => string | undefined;
}

/** One engine for money, counts and percentages. A text input, never type="number": the wheel cannot change it,
 *  the field may sit empty while being retyped, pasted "RM 1,234.50" is understood, the caret stays where it was,
 *  and the thousands separator only appears once the field is left. */
export function NumericInput(p: EngineProps) {
  const autoId = useId();
  const id = p.id ?? autoId;
  const ref = useRef<HTMLInputElement>(null);
  const display = (n: number | null) => (n == null ? '' : formatScaled(n, p.decimals, { grouping: p.grouping, fixed: p.fixed }));
  const [draft, setDraft] = useState(() => display(p.scaled));
  const [notice, setNotice] = useState<string>();
  const [touched, setTouched] = useState(false);
  const focused = useRef(false);
  const emitted = useRef<{ value: number | null } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  // Typing a character the cleaner drops (a comma, "RM") leaves the draft unchanged, so React would skip the render
  // and the caret fix below would wait, stale, for the next keystroke. Bumping this forces that render.
  const [, rerender] = useState(0);

  // Follow the value from outside (a reset, a loaded record) but never fight the user mid-edit: a change that is
  // just our own emission coming back, possibly coerced by the parent (null -> 0), waits until blur.
  useEffect(() => {
    if (emitted.current) { emitted.current = null; if (focused.current) return; }
    if (focused.current && parseScaled(draft, p.decimals) === p.scaled) return;
    setDraft(display(p.scaled));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.scaled]);

  useLayoutEffect(() => {
    if (pendingCaret.current != null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  });

  function emit(next: number | null) {
    if (next === p.scaled) return;
    emitted.current = { value: next };
    p.onScaled(next);
  }

  function onChange(raw: string, caret: number | null) {
    const { text, notice: why } = cleanNumberText(raw, p.decimals, p.allowNegative);
    pendingCaret.current = text !== raw && caret != null ? caretAfterClean(raw, caret, p.decimals, p.allowNegative) : null;
    setNotice(why ? noticeText(why, p.decimals) : undefined);
    setDraft(text);
    if (text !== raw) rerender(n => n + 1);
    emit(parseScaled(text, p.decimals));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    p.onKeyDown?.(e);
    if (e.defaultPrevented || !p.stepScaled || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    let next = (parseScaled(draft, p.decimals) ?? 0) + (e.key === 'ArrowUp' ? p.stepScaled : -p.stepScaled);
    if (p.minScaled != null) next = Math.max(p.minScaled, next);
    if (p.maxScaled != null) next = Math.min(p.maxScaled, next);
    if (!p.allowNegative) next = Math.max(0, next);
    setDraft(formatScaled(next, p.decimals, { grouping: false, fixed: p.fixed }));
    emit(next);
  }

  const current = parseScaled(draft, p.decimals);
  let rangeError: string | undefined;
  if (current != null && p.minScaled != null && current < p.minScaled) rangeError = `Must be at least ${p.describeBound(p.minScaled)}.`;
  else if (current != null && p.maxScaled != null && current > p.maxScaled) rangeError = `Must be ${p.describeBound(p.maxScaled)} or less.`;
  else if (current == null && p.required && touched) rangeError = 'Required.';
  const error = p.error || (touched ? rangeError : undefined);
  const help = notice ?? p.hint?.(current) ?? p.help;

  return (
    <InputShell id={id} label={p.label} help={help} error={error} leading={p.leading} trailing={p.trailing}>
      <input
        ref={ref}
        id={id}
        name={p.name}
        type="text"
        inputMode={p.inputMode}
        autoComplete="off"
        spellCheck={false}
        aria-label={p['aria-label']}
        aria-invalid={!!error || undefined}
        aria-describedby={error || help ? `${id}-help` : undefined}
        aria-required={p.required || undefined}
        placeholder={p.placeholder}
        disabled={p.disabled}
        readOnly={p.readOnly}
        autoFocus={p.autoFocus}
        value={draft}
        onChange={e => onChange(e.target.value, e.target.selectionStart)}
        onFocus={() => { focused.current = true; }}
        onBlur={e => {
          focused.current = false;
          setTouched(true);
          setNotice(undefined);
          // A pending emission that the parent coerced (empty -> 0) shows its stored value from here on.
          emitted.current = null;
          setDraft(display(p.scaled));
          p.onBlur?.(e);
        }}
        onKeyDown={onKeyDown}
        className={cx(p.className ?? 'field-input', PHONE_SIZING)}
        style={{
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          ...(p.leading ? { paddingLeft: 40 } : {}),
          ...(p.trailing ? { paddingRight: 40 } : {}),
          ...(error ? { borderColor: 'var(--color-critical-line)' } : {}),
          ...p.style,
        }}
      />
    </InputShell>
  );
}
