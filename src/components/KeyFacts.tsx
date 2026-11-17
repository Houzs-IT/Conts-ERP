import type { ReactNode } from 'react';
import { cx } from '../lib/design-tokens';

export type KeyFact = readonly [label: string, value: ReactNode] | { label: string; value: ReactNode };

/** Columns so no cell is left alone on a row: 3 for 3, 6, 5, 8..., 2 or 4 for even counts, otherwise 3. */
export function keyFactColumns(n: number): number {
  const c = n % 3 === 0 || (n > 4 && n % 3 !== 1) ? 3 : n % 2 === 0 ? (n >= 4 ? 4 : 2) : 3;
  return Math.max(1, Math.min(c, n));
}

/**
 * Key facts about a record (Conts DS v2, the prototype's ui.kv): a clean grid of small uppercase labels over their
 * values, on the muted surface, with hairlines between the cells. It picks its own column count so no cell is left
 * alone on a row; `cols` forces one. Two columns on a phone. Values are tabular and truncate with an ellipsis.
 */
export function KeyFacts({ items, cols, className }: { items: readonly KeyFact[]; cols?: number; className?: string }) {
  const pairs = items.map(it => (Array.isArray(it) ? { label: it[0], value: it[1] } : it as { label: string; value: ReactNode }));
  if (!pairs.length) return null;
  return (
    <dl className={cx('ds-kv', className)} style={{ ['--kc' as string]: Math.min(cols ?? keyFactColumns(pairs.length), pairs.length) }}>
      {pairs.map(p => (
        <div key={p.label}>
          <dt>{p.label}</dt>
          <dd title={typeof p.value === 'string' ? p.value : undefined}>{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}
