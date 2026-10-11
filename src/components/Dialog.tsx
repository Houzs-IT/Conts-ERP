import { useEffect, useRef, type ReactNode } from 'react';

/** Confirmations live in ConfirmDialog.tsx; this file keeps the side drawer. */
export function Drawer({ open, onClose, children, width = 480 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A dialog opened over the drawer (record payment, a confirmation) closes first; the drawer only on the next Escape.
      const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')];
      if (dialogs.length && dialogs[dialogs.length - 1] !== panel.current) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end',
      background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both',
    }}>
      <div onClick={onClose} style={{ flex: 1 }} />
      <div
        ref={panel}
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
