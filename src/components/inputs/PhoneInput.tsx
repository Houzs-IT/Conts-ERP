import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/design-tokens';
import {
  HOME_COUNTRY, callingCodeOf, countryOf, formatLocalAsTyped, parseLocal, parsePhone, phoneCountries, readInternationalAsTyped,
  type CountryCode,
} from '../../lib/phone';
import { SearchSelect } from '../Select';
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
  /** The country picked when the field starts empty. Malaysia unless said otherwise. */
  defaultCountry?: CountryCode;
}

/** Spaces, dashes and brackets are kept as typed; anything else (letters, stray symbols) is dropped. */
export const cleanPhone = (raw: string) => raw.replace(/[^\d+\-() ]/g, '').replace(/(?!^)\+/g, '');

/** A plain-English note when a phone (as stored, any country) cannot be dialled; undefined when it is fine or empty. */
export function phoneProblem(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const digits = value.replace(/\D/g, '').length;
  if (digits > 15) return 'Too long for a phone number (at most 15 digits).';
  if (parsePhone(value)?.possible) return undefined;
  return digits < 7
    ? 'Too short for a phone number. Example: +60 12-345 6789.'
    : 'Not a complete number for its country. Check the country code and the digits, e.g. +60 12-345 6789.';
}

const COUNTRIES = phoneCountries();
// Rows read "Malaysia  +60", sorted by name; the button shows only +60. Found by name, by +60 or 60, or by the
// letter code (MY), which is never shown.
const OPTIONS = COUNTRIES.map(c => ({ value: c.code, label: c.name, hint: `+${c.callingCode}`, keywords: c.code }));

const digitsOf = (s: string) => s.replace(/\D/g, '');
/** The caret position just after the n-th digit of `text` (0 = start). */
function caretAfterDigits(text: string, n: number) {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) if (/\d/.test(text[i]) && ++seen === n) return i + 1;
  return text.length;
}

/** Country and local part for a stored or incoming value: 60189800069 -> MY, "18-980 0069". */
function split(value: string, fallback: CountryCode): { country: CountryCode; draft: string } {
  const p = parsePhone(value, fallback);
  const country = p ? countryOf(p) : undefined;
  if (p && country) return { country, draft: p.possible ? p.national : formatLocalAsTyped(p.digits.slice(p.callingCode.length), country) };
  return { country: fallback, draft: value };
}

/** What the field hands back: "+60 18-980 0069" once complete, "+60 18980" while still being typed, '' when empty. */
function joined(draft: string, country: CountryCode) {
  if (draft.trim().startsWith('+')) return draft.trim();
  const d = digitsOf(draft);
  if (!d) return '';
  const p = parseLocal(d, country);
  if (p?.possible) return p.international;
  return `+${callingCodeOf(country)} ${p ? p.digits.slice(p.callingCode.length) : d}`;
}

/** A bare number that is clearly another country's, written with its code and no + (6596532231): that country. */
function bareInternational(d: string, country: CountryCode) {
  if (!d || d.startsWith('0')) return null;
  const asIntl = parsePhone(`+${d}`);
  if (!asIntl?.valid || parseLocal(d, country)?.valid) return null;
  const c = countryOf(asIntl);
  return c ? { country: c, draft: asIntl.national } : null;
}

/** Country picker (searchable, shows "+60") beside the number, formatted as it is typed in that country's grouping without
 *  moving the caret. Typing or pasting "+code ..." picks the country; so does a pasted number that is clearly another
 *  country's. The value handed back is the international form, +60 18-980 0069, which every screen reads. */
export function PhoneInput({ value, onChange, label, help, error, placeholder, className, style, defaultCountry = HOME_COUNTRY, ...rest }: PhoneInputProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => split(value, defaultCountry), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [draft, setDraft] = useState(initial.draft);
  const [touched, setTouched] = useState(false);
  const emitted = useRef<string | null>(null);
  const pendingCaret = useRef<number | null>(null);
  // A keystroke the formatter undoes (a typed dash) leaves the draft unchanged, so React would skip the render and the
  // caret fix would wait for the next key. Bumping this forces that render, as NumericInput does.
  const [, rerender] = useState(0);

  // Follow a value from outside (a reset, a loaded record), never our own emission coming back.
  useEffect(() => {
    if (emitted.current !== null && value === emitted.current) return;
    emitted.current = null;
    const next = split(value, defaultCountry);
    setCountry(next.country);
    setDraft(next.draft);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (pendingCaret.current != null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  });

  function emit(nextDraft: string, nextCountry: CountryCode) {
    const v = joined(nextDraft, nextCountry);
    if (v === value) return;
    emitted.current = v;
    onChange(v);
  }

  function show(nextDraft: string, nextCountry: CountryCode, caret: number | null) {
    pendingCaret.current = caret;
    if (nextCountry !== country) setCountry(nextCountry);
    setDraft(nextDraft);
    rerender(n => n + 1);
    emit(nextDraft, nextCountry);
  }

  function onInput(raw: string, caret: number, inputType: string) {
    let text = cleanPhone(raw);
    let digitsBefore = digitsOf(text.slice(0, caret)).length;
    // Deleting a dash or space the formatter put there would come straight back: delete the digit beside it instead.
    if (digitsOf(text) === digitsOf(draft) && text.length < draft.length) {
      if (inputType === 'deleteContentBackward' && digitsBefore > 0) {
        const at = caretAfterDigits(text, digitsBefore);
        text = text.slice(0, at - 1) + text.slice(at);
        digitsBefore--;
      } else if (inputType === 'deleteContentForward') {
        const at = caretAfterDigits(text, digitsBefore + 1);
        if (at > 0) text = text.slice(0, at - 1) + text.slice(at);
      }
    }
    const d = digitsOf(text);
    const intl = text.trim().startsWith('+') || d.startsWith('00');
    if (intl) {
      const rest = d.startsWith('00') && !text.trim().startsWith('+') ? d.slice(2) : d;
      const read = rest ? readInternationalAsTyped(rest) : null;
      if (!read) { show(text.trim().startsWith('+') ? `+${rest}` : text, country, null); return; }
      const local = formatLocalAsTyped(read.national, read.country);
      show(local, read.country, local.length);
      return;
    }
    if (inputType === 'insertFromPaste' || inputType === 'insertReplacementText') {
      const other = bareInternational(d, country);
      if (other) { show(other.draft, other.country, other.draft.length); return; }
    }
    const local = formatLocalAsTyped(d, country);
    show(local, country, caretAfterDigits(local, digitsBefore));
  }

  function onBlur() {
    setTouched(true);
    const d = digitsOf(draft);
    if (!d || draft.trim().startsWith('+')) return;
    const other = bareInternational(d, country);
    if (other) { show(other.draft, other.country, null); return; }
    const p = parseLocal(d, country);
    if (p?.possible && p.national !== draft) { setDraft(p.national); emit(p.national, country); }
  }

  function pickCountry(c: string) {
    const next = c as CountryCode;
    const local = draft.trim().startsWith('+') ? '' : formatLocalAsTyped(digitsOf(draft), next);
    setCountry(next);
    setDraft(local);
    emit(local, next);
    ref.current?.focus();
  }

  const problem = touched ? phoneProblem(joined(draft, country)) : undefined;
  const shown = error || problem || (touched && rest.required && !draft.trim() ? 'Required.' : undefined);
  const example = useMemo(() => placeholder ?? (country === 'MY' ? '12-345 6789' : ''), [placeholder, country]);
  return (
    <InputShell id={id} label={label} help={help} error={shown}>
      {/* One joined box: the code's right edge meets the number's left edge, both the number's height. The focused
          half sits on top so its focus border is never hidden under its neighbour's. */}
      <div style={{ display: 'flex', minWidth: 0 }}>
        <SearchSelect
          label={`Country code${label ? ` for ${label.toLowerCase()}` : ''}`}
          value={country}
          onChange={pickCountry}
          options={OPTIONS}
          placeholder="Country or code"
          size="md"
          className="flex-none w-[88px]"
          buttonClassName={cx('h-auto flex-1 rounded-r-none relative focus-visible:z-[1]', shown && 'border-[color:var(--color-critical-line)]')}
          menuWidth={300}
          shortLabel={o => o.hint ?? o.label}
        />
        <input
          ref={ref}
          id={id}
          aria-label={rest['aria-label']}
          disabled={rest.disabled}
          required={rest.required}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={example}
          value={draft}
          aria-invalid={!!shown || undefined}
          aria-describedby={shown || help ? `${id}-help` : undefined}
          onChange={e => onInput(e.target.value, e.target.selectionStart ?? e.target.value.length, (e.nativeEvent as InputEvent).inputType ?? '')}
          onBlur={onBlur}
          className={cx(className ?? 'field-input', PHONE_SIZING, 'relative focus:z-[1]')}
          style={{ flex: '1 1 0', minWidth: 0, marginLeft: -1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, fontVariantNumeric: 'tabular-nums', ...(shown ? { borderColor: 'var(--color-critical-line)' } : {}), ...style }}
        />
      </div>
    </InputShell>
  );
}
