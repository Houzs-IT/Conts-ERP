import { radius, text } from '../theme';
import { RowsSkeleton } from './Loading';
import { Button } from './Button';

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
      <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  );
}

/** Skeleton rows for a list that has never loaded: the same rows DataTable draws (Loading.tsx), without its header. */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return <RowsSkeleton rows={rows} cols={cols} header={false} />;
}
