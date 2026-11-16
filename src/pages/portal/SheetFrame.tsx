import { useEffect, useState, type ReactNode } from 'react';
import { color, radius } from '../../theme';

export interface SheetFrameProps {
  label: string;
  isSaving: boolean;
  onCancel: () => void;
  body: ReactNode;
  footer: ReactNode;
}

interface ViewportBox {
  top: number;
  height: number | null;
}

function useViewportBox(): ViewportBox {
  const [box, setBox] = useState<ViewportBox>({ top: 0, height: null });
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const sync = (): void => setBox({ top: viewport.offsetTop, height: viewport.height });
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, []);
  return box;
}

function useLockedPageScroll(): void {
  useEffect(() => {
    const { body, documentElement } = document;
    const previousBody = body.style.overflow;
    const previousRoot = documentElement.style.overflow;
    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousBody;
      documentElement.style.overflow = previousRoot;
    };
  }, []);
}

export default function SheetFrame({ label, isSaving, onCancel, body, footer }: SheetFrameProps) {
  const box = useViewportBox();
  useLockedPageScroll();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !isSaving) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSaving, onCancel]);

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, top: box.top, height: box.height ?? '100dvh', zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div aria-hidden onClick={isSaving ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: 'var(--color-surface-scrim)' }} />
      <div role="dialog" aria-modal="true" aria-label={label}
        style={{
          position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', boxSizing: 'border-box', maxHeight: '100%', display: 'flex', flexDirection: 'column', minHeight: 0,
          background: color.card, borderRadius: `${radius.dialog}px ${radius.dialog}px 0 0`, boxShadow: 'var(--shadow-overlay)',
        }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>{body}</div>
        <div style={{ flex: 'none', display: 'flex', gap: 10, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${color.border}` }}>{footer}</div>
      </div>
    </div>
  );
}
