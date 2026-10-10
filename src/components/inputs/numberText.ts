/** Pure text <-> number helpers behind the shared inputs. No floats on the way in:
 *  "12.30" becomes 1230 sen by splitting on the point, so 12.30 can never land as 1229. */

const MAX_INT_DIGITS = 12;

export interface CleanResult {
  text: string;
  /** Set when the user typed something the field cannot hold, so the field can say why. */
  notice?: 'negative' | 'decimals' | 'whole';
}

/** Keep only what a number can be made of: digits, one point, a leading minus. "RM 1,234.50" -> "1234.50". */
export function cleanNumberText(raw: string, decimals: number, allowNegative: boolean): CleanResult {
  let notice: CleanResult['notice'];
  let s = raw.replace(/[^\d.\-]/g, '');
  const wantsNegative = s.startsWith('-');
  if (s.includes('-')) {
    if (wantsNegative && !allowNegative) notice = 'negative';
    s = s.replace(/-/g, '');
  }
  const dot = s.indexOf('.');
  if (dot >= 0) {
    let whole = s.slice(0, dot);
    let frac = s.slice(dot + 1).replace(/\./g, '');
    if (decimals === 0) {
      if (frac) notice = notice ?? 'whole';
      frac = '';
      s = whole;
    } else {
      if (frac.length > decimals) { frac = frac.slice(0, decimals); notice = notice ?? 'decimals'; }
      whole = whole.slice(0, MAX_INT_DIGITS);
      s = `${whole}.${frac}`;
    }
  } else {
    s = s.slice(0, MAX_INT_DIGITS);
  }
  return { text: (wantsNegative && allowNegative ? '-' : '') + s, notice };
}

/** Parse cleaned (or display) text into an integer scaled by 10^decimals. Null when there is no number yet. */
export function parseScaled(text: string, decimals: number): number | null {
  const m = /^\s*(-)?([\d,]*)(?:\.(\d*))?\s*$/.exec(text);
  if (!m) return null;
  const whole = m[2].replace(/,/g, '');
  const frac = m[3] ?? '';
  if (!whole && !frac) return null;
  const scale = 10 ** decimals;
  const n = Number(whole || '0') * scale + Number((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (!Number.isSafeInteger(n)) return null;
  return m[1] && n !== 0 ? -n : n;
}

/** Text for an integer scaled by 10^decimals. `fixed` pads to all decimals (money), otherwise trailing zeros go. */
export function formatScaled(n: number, decimals: number, opts: { grouping: boolean; fixed: boolean }): string {
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  const scale = 10 ** decimals;
  const whole = Math.floor(abs / scale);
  let frac = decimals ? String(abs % scale).padStart(decimals, '0') : '';
  if (!opts.fixed) frac = frac.replace(/0+$/, '');
  const wholeText = opts.grouping ? String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(whole);
  return (neg ? '-' : '') + wholeText + (frac ? `.${frac}` : '');
}

/** Number of characters of `cleaned` that sit before the caret, so the caret stays put when characters are dropped. */
export function caretAfterClean(raw: string, caret: number, decimals: number, allowNegative: boolean): number {
  return cleanNumberText(raw.slice(0, caret), decimals, allowNegative).text.length;
}

export function noticeText(notice: NonNullable<CleanResult['notice']>, decimals: number): string {
  if (notice === 'negative') return 'This cannot be negative.';
  if (notice === 'whole') return 'Whole numbers only.';
  return decimals === 1 ? 'Only one decimal place is kept.' : `Only ${decimals} decimal places are kept.`;
}
