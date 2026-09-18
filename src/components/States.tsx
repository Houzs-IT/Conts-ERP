import type { ReactNode } from 'react';
import { Button } from './Button';

/** Reason plus next action, always. Never a bare "No data". */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 11, padding: 28, maxWidth: 460,
      background: 'var(--color-surface-card)', border: '1px solid var(--color-border-default)',
      borderRadius: 'var(--radius-card)',
    }}>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
      {body && <span style={{ fontSize: 13, color: 'var(--color-text-muted)', textWrap: 'pretty' }}>{body}</span>}
      {action && (
        <div style={{ marginTop: 4, alignSelf: 'flex-start' }}>
          <Button size="sm" variant="primary" onClick={action.onClick}>{action.label}</Button>
        </div>
      )}
    </div>
  );
}

/** Skeletons only for predictable blocks. Never over a value already loaded. */
export function Skeleton({ width = '100%', height = 14, radius = 4 }: { width?: number | string; height?: number; radius?: number }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius }} />;
}

export function SkeletonRows({ rows = 5, height = 48 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={height} radius={0} />)}
    </div>
  );
}

/** Keep the content that loaded and name only what failed. */
export function PartialFailure({ list }: { list: string[] }) {
  return (
    <div style={{
      padding: '12px 14px', borderLeft: '2px solid var(--color-warning-line)',
      background: 'var(--color-warning)', color: 'var(--color-warning-fg)', fontSize: 12,
    }}>
      Some data could not load: {list.join(', ')}. Everything else is current.
    </div>
  );
}

/** Visible but not editable. Restriction plus the route to get access. */
export function PermissionNote({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 'var(--text-small)', color: 'var(--color-text-muted)' }}>{children}</span>;
}
