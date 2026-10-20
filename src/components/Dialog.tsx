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
export function Drawer({ open, onClose, children, width = 480, labelledBy }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; labelledBy?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  // Focus goes into the drawer when it opens (unless a field inside already took it) and back to what opened it on close,
  // so a keyboard user is never left on the list hidden behind it.
  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => { if (returnTo?.isConnected) returnTo.focus(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Escape' && e.key !== 'Tab') || e.defaultPrevented) return;
      // A dialog opened over the drawer (record payment, a confirmation) closes first; the drawer only on the next Escape.
      const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')];
      if (dialogs.length && dialogs[dialogs.length - 1] !== panel.current) return;
      if (e.key === 'Escape') { onClose(); return; }
      // Tab wraps inside the drawer: the list behind it is covered, so focus there would be invisible.
      const items = [...panel.current!.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
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
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-side-drawer
        style={{
          width: `min(${width}px, 100%)`, height: '100%', overflowY: 'auto', overscrollBehavior: 'contain', outline: 'none',
          background: 'var(--color-surface-card)', boxShadow: '-12px 0 40px rgba(21,21,21,0.18)',
          display: 'flex', flexDirection: 'column', animation: 'rise var(--motion-slow) var(--ease-out) both',
        }}
      >
        {children}
      </div>
    </div>
  );
}
