import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface DialogSpec {
  title: string;
  body: string;
  /** Context line: what this affects, what it costs, when it happens. */
  meta?: string;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  /** Extra actions rendered left of confirm — e.g. Block dates, Create reservation. */
  extraActions?: { label: string; onClick: () => void; variant?: 'secondary' | 'danger' }[];
  onConfirm: () => Promise<void> | void;
}

/**
 * Confirmation states the action and its target, and a destructive one states the
 * consequence and the recovery. Focus is trapped and returns to the trigger.
 */
export function Dialog({ spec, busy, onClose }: { spec: DialogSpec | null; busy: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!spec) return;
    returnTo.current = document.activeElement;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (returnTo.current as HTMLElement | null)?.focus?.();
    };
  }, [spec, busy, onClose]);

  if (!spec) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={spec.title}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24,
        background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both',
      }}
    >
      <div onClick={busy ? undefined : onClose} style={{ position: 'absolute', inset: 0 }} />
      <div
        ref={ref}
        style={{
          position: 'relative', width: '100%', maxWidth: 440, background: 'var(--color-surface-card)',
          borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden',
          animation: 'dialog-in var(--motion-slow) var(--ease-out) both',
        }}
      >
        <div style={{ padding: '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <h2 style={{ margin: 0, fontSize: 19, lineHeight: 1.3, fontWeight: 600, textWrap: 'pretty' }}>{spec.title}</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-muted)', textWrap: 'pretty' }}>{spec.body}</p>
          {spec.meta && (
            <div style={{
              marginTop: 3, padding: '9px 11px', borderRadius: 'var(--radius-control)',
              background: 'var(--color-surface-page)', border: '1px solid var(--color-border-default)', fontSize: 12,
            }}>{spec.meta}</div>
          )}
        </div>
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--color-border-default)',
          background: 'var(--color-surface-page)', display: 'flex', alignItems: 'center',
          justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap',
        }}>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          {spec.extraActions?.map(a => (
            <Button key={a.label} size="sm" variant={a.variant ?? 'secondary'} onClick={a.onClick} disabled={busy}>{a.label}</Button>
          ))}
          <Button
            size="sm"
            variant={spec.danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void spec.onConfirm()}
          >
            {busy ? (spec.busyLabel ?? 'Working\u2026') : spec.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children, width = 480 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end',
      background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both',
    }}>
      <div onClick={onClose} style={{ flex: 1 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: `min(${width}px, 100%)`, height: '100%', overflowY: 'auto',
          background: 'var(--color-surface-card)', boxShadow: '-12px 0 40px rgba(21,21,21,0.18)',
          display: 'flex', flexDirection: 'column', animation: 'rise var(--motion-slow) var(--ease-out) both',
        }}
      >
        {children}
      </div>
    </div>
  );
}
