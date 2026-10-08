import type { ReactNode } from 'react';
import { Button } from './Button';
import Icon from './Icon';

/**
 * Reason plus next action, always. Never a bare "No data".
 * Two different situations, never mixed up:
 *  - `kind="empty"` (default): nothing exists yet. Say why and offer the first action ("Start inspection").
 *  - `kind="filtered"`: records exist but none match. Offer "Clear filters" as a quiet link.
 * `bare` drops the card frame for use inside a card that already has one.
 */
export function EmptyState({ title, body, action, secondary, kind = 'empty', icon, bare }: {
  title: string; body?: ReactNode;
  action?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  kind?: 'empty' | 'filtered';
  icon?: string;
  bare?: boolean;
}) {
  const filtered = kind === 'filtered';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8,
      padding: filtered ? '32px 22px' : '40px 24px', width: '100%', boxSizing: 'border-box', flexShrink: 0,
      ...(bare ? {} : { background: 'var(--color-surface-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-card)' }),
    }}>
      {!filtered && (
        <span aria-hidden style={{ width: 40, height: 40, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--color-surface-muted)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
          <Icon name={icon ?? 'Inbox'} size="base" />
        </span>
      )}
      <span style={{ fontSize: filtered ? 13 : 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</span>
      {body && <span style={{ fontSize: 13, color: 'var(--color-text-muted)', textWrap: 'pretty', maxWidth: 460 }}>{body}</span>}
      {(action || secondary) && (
        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {secondary && <Button size="sm" variant="secondary" onClick={secondary.onClick}>{secondary.label}</Button>}
          {action && (filtered
            ? <Button size="sm" variant="secondary" onClick={action.onClick}>{action.label}</Button>
            : <Button size="sm" variant="primary" onClick={action.onClick}>{action.label}</Button>)}
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
