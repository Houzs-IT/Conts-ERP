import { color, radius, text } from '../theme';

/** Shown above content that failed to refresh. The stale figures stay visible —
 *  blanking a screen the user was reading is worse than a labelled staleness. */
export function StaleBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '11px 14px', borderRadius: radius.control,
      background: 'var(--color-warning)', borderLeft: '2px solid var(--color-warning-line)', color: 'var(--color-warning-fg)',
    }}>
      <span style={{ fontSize: text.small, flex: 1, minWidth: 200, textWrap: 'pretty' }}>{message}</span>
      <button onClick={onRetry} style={{
        height: 30, padding: '0 12px', borderRadius: radius.control, border: '1px solid var(--color-warning-line)',
        background: 'transparent', color: 'var(--color-warning-fg)', font: 'inherit', fontSize: text.meta, fontWeight: 600, cursor: 'pointer',
      }}>Retry</button>
    </div>
  );
}

/** Skeleton rows for a table that has never loaded. */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14,
          padding: '14px 22px', borderBottom: `1px solid ${color.borderMuted}`,
        }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton" style={{ height: 13, width: c === 0 ? '70%' : '45%' }} />
          ))}
        </div>
      ))}
    </div>
  );
}
