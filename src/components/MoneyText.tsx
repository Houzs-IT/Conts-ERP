import type { CSSProperties } from 'react';
import { rm, rmCompact } from '../lib/format';

/**
 * One way to print money (UI audit, design checklist):
 *  - `exact`  RM 4,364.86: statements, payouts, expenses (always with sen).
 *  - `whole`  RM 4,365: KPIs, lists, calendars.
 *  - `compact` RM 14k: charts only.
 * A negative amount, or one passed as `deduction`, reads "− RM 679" with a real minus sign.
 * `tone="auto"` colours a negative red; deductions themselves stay ink (they are expected).
 */
export function MoneyText({ sen, mode = 'whole', deduction, tone, strong, style, className }: {
  sen: number; mode?: 'exact' | 'whole' | 'compact'; deduction?: boolean;
  tone?: 'auto' | 'muted'; strong?: boolean; style?: CSSProperties; className?: string;
}) {
  const negative = sen < 0 || (deduction && sen > 0);
  const abs = Math.abs(sen);
  const body = mode === 'compact' ? rmCompact(abs) : rm(abs, { cents: mode === 'exact' });
  const text = negative && abs !== 0 ? `− ${body}` : body;
  const colour = tone === 'auto' && sen < 0 ? 'var(--color-critical-fg)' : tone === 'muted' ? 'var(--color-text-muted)' : undefined;
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...(colour ? { color: colour } : {}), ...(strong ? { fontWeight: 600 } : {}), ...style }}>
      {text}
    </span>
  );
}

/** The plain-string twin, for titles, toasts and CSV. */
export function moneyString(sen: number, mode: 'exact' | 'whole' | 'compact' = 'whole', deduction = false) {
  const abs = Math.abs(sen);
  const body = mode === 'compact' ? rmCompact(abs) : rm(abs, { cents: mode === 'exact' });
  return (sen < 0 || (deduction && sen > 0)) && abs !== 0 ? `− ${body}` : body;
}
