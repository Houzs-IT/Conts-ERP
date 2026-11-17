import { cx } from '../lib/design-tokens';
import { rm, rmDeduction } from '../lib/format';

/** One line of a money breakdown. `sen` is an integer in sen. `kind`: 'neg' a deduction (shown with a minus, in
 *  red), 'sub' a subtotal (bold, a solid rule under it), 'total' the figure that matters (larger, in green). */
export interface MoneyLine { label: string; sen: number; kind?: 'neg' | 'sub' | 'total' }

/**
 * A money breakdown (Conts DS v2, the prototype's ui.money): label on the left, the amount on the right, always with
 * its sen. Plain lines that are zero go quiet so the lines that carry money stand out. Amounts are tabular.
 */
export function MoneyLines({ lines, className }: { lines: readonly MoneyLine[]; className?: string }) {
  return (
    <div className={cx('ds-money', className)}>
      {lines.map((l, i) => (
        <div key={`${l.label}-${i}`} className={cx(l.kind === 'neg' && 'is-neg', l.kind === 'sub' && 'is-sub', l.kind === 'total' && 'is-total', !l.kind && !l.sen && 'is-zero')}>
          <span>{l.label}</span>
          <span>{l.kind === 'neg' && l.sen ? rmDeduction(l.sen) : rm(l.kind === 'neg' ? Math.abs(l.sen) : l.sen)}</span>
        </div>
      ))}
    </div>
  );
}
