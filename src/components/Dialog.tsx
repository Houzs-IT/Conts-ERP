import { useEffect, useRef, type ReactNode, type WheelEvent } from 'react';

/** The wheel over a side drawer's dimmed strip scrolls the list under it, as the owner expects when he reads down the
 *  reservations with one open. The strip is position: fixed, so the browser would hand that scroll to the window (which
 *  never scrolls) rather than to the list. Finds the scroll box under the pointer and moves it, innermost first. */
function scrollUnder(e: WheelEvent<HTMLDivElement>) {
  const strip = e.currentTarget;
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  let dy = e.deltaY * scale;
  let dx = e.deltaX * scale;
  const under = document.elementsFromPoint(e.clientX, e.clientY).find(el => !strip.parentElement!.contains(el));
  for (let el = under as HTMLElement | null; el && (dy || dx); el = el.parentElement) {
    const cs = getComputedStyle(el);
    const canY = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
    const canX = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth;
    if (!canY && !canX) continue;
    const top = el.scrollTop, left = el.scrollLeft;
    el.scrollBy({ top: canY ? dy : 0, left: canX ? dx : 0 });
    if (el.scrollTop !== top) dy = 0;
    if (el.scrollLeft !== left) dx = 0;
  }
}

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
      <div onClick={onClose} onWheel={scrollUnder} style={{ flex: 1 }} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        data-side-drawer
        style={{
          width: `min(${width}px, 100%)`, height: '100%', overflowY: 'auto', overscrollBehavior: 'contain',
          background: 'var(--color-surface-card)', boxShadow: '-12px 0 40px rgba(21,21,21,0.18)',
          display: 'flex', flexDirection: 'column', animation: 'rise var(--motion-slow) var(--ease-out) both',
        }}
      >
        {children}
      </div>
    </div>
  );
}
