import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useConfirm } from './ConfirmDialog';
import { Button } from './Button';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]):not([type=hidden]):not([type=checkbox]):not([type=radio]), select:not([disabled]), textarea:not([disabled])';

/**
 * The one way a dialog behaves, whatever it looks like (owner, 3 Nov 2026):
 *  - focus moves into it (the first field, else the dialog) and back to what opened it on close; Tab stays inside;
 *  - Escape and a click on the dimmed backdrop close it, unless it is busy;
 *  - once a field in it has changed (typed, a native checkbox or date, a pick in the shared Select), Escape and the
 *    backdrop ask "Discard your changes?" instead of throwing the work away. Cancel (the footer button) still closes at
 *    once: it is a deliberate choice. A choice made with plain buttons is not seen: pass `dirty` for those.
 * A dialog opened over this one (a confirmation, a picker) takes Escape first.
 * `dirty` replaces the guess when the caller knows better: false for a picker whose only field is a search box.
 */
export function DialogFrame({ label, onClose, busy, dirty, children, className, panelClassName, panelStyle, role = 'dialog', initialFocus = 'field' }: {
  label: string; onClose: () => void; busy?: boolean; dirty?: boolean; children: ReactNode;
  /** Overlay classes; the default centres the panel on a dimmed page. */
  className?: string;
  panelClassName?: string; panelStyle?: CSSProperties;
  role?: 'dialog' | 'alertdialog';
  /** 'field': the first field, else the dialog itself. 'panel': the dialog itself (read-only dialogs, long forms). */
  initialFocus?: 'field' | 'panel';
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const typed = useRef(false);
  const [discard, ask] = useConfirm();
  const state = useRef({ onClose, busy, dirty });
  state.current = { onClose, busy, dirty };

  const requestClose = useCallback(async () => {
    const s = state.current;
    if (s.busy) return;
    if (s.dirty ?? typed.current) {
      const r = await ask({ title: 'Discard your changes?', body: 'What you typed in this dialog will not be saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
      if (r === null) return;
    }
    state.current.onClose();
  }, [ask]);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const p = panel.current;
    if (p && !p.contains(document.activeElement)) {
      const first = initialFocus === 'field' ? p.querySelector<HTMLElement>(FIELD) : null;
      (first ?? p).focus({ preventScroll: true });
    }
    return () => { if (returnTo?.isConnected) returnTo.focus({ preventScroll: true }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    const mark = (e: Event) => { if ((e.target as HTMLElement | null)?.closest?.('[data-dialog-ignore-dirty]')) return; typed.current = true; };
    p.addEventListener('input', mark);
    p.addEventListener('change', mark);
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Escape' && e.key !== 'Tab') || e.defaultPrevented) return;
      // Only the topmost modal answers: a confirmation or another dialog opened over this one goes first.
      const modals = [...document.querySelectorAll('[role=dialog][aria-modal=true], [role=alertdialog]')];
      if (modals.length && modals[modals.length - 1] !== overlay.current) return;
      if (e.key === 'Escape') { e.preventDefault(); void requestClose(); return; }
      const items = [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || at === p)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
      else if (!p.contains(at)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { p.removeEventListener('input', mark); p.removeEventListener('change', mark); document.removeEventListener('keydown', onKey); };
  }, [requestClose]);

  return (
    <div ref={overlay} role={role} aria-modal="true" aria-label={label}
      className={className ?? 'fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]'}>
      <div onClick={() => void requestClose()} className="absolute inset-0" aria-hidden />
      <div ref={panel} tabIndex={-1} className={`outline-none ${panelClassName ?? 'relative w-full'}`} style={panelStyle}>
        {children}
      </div>
      {discard}
    </div>
  );
}

/**
 * THE dialog: title, optional sub line, body, and the buttons at the foot (Cancel left of the main action, on the right).
 * Every form dialog in Property OS renders this, directly or through a one-line local wrapper, so a change here is a
 * change everywhere (owner, 3 Nov 2026). Behaviour (focus, Escape, backdrop, keep-open when dirty) comes from DialogFrame.
 * The header and footer stay put and the body scrolls when the form is taller than the screen. Pass `onSubmit` to make
 * Enter submit: the body and footer then sit in one form, and a submit button in the footer triggers it.
 * ConfirmDialog is for yes/no confirmations; Drawer for side panels.
 */
export function Modal({ title, sub, onClose, children, footer, width = 460, busy, dirty, onSubmit }: {
  title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; footer: ReactNode; width?: number;
  busy?: boolean; dirty?: boolean; onSubmit?: () => void;
}) {
  const inner = (
    <>
      <div className="flex-none pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
        <h2 className="m-0 text-title leading-[1.3] font-semibold [text-wrap:pretty]">{title}</h2>
        {sub && <div className="m-0 text-copy leading-[1.5] text-muted-ink [text-wrap:pretty]">{sub}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-4 px-[22px] flex flex-col gap-[14px]">{children}</div>
      <div className="flex-none py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">{footer}</div>
    </>
  );
  // Portalled to the page body: opened inside a drawer (which animates with a transform), a fixed overlay would
  // otherwise be pinned to the drawer instead of covering the screen.
  return createPortal(
    <DialogFrame label={title} onClose={onClose} busy={busy} dirty={dirty}
      panelClassName="relative w-full max-h-[calc(100dvh-32px)] flex flex-col bg-card rounded-card overflow-hidden [box-shadow:var(--shadow-overlay)] [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]"
      panelStyle={{ maxWidth: width }}>
      {onSubmit
        ? <form className="contents" onSubmit={e => { e.preventDefault(); onSubmit(); }}>{inner}</form>
        : inner}
    </DialogFrame>,
    document.body,
  );
}

/** The common form dialog: Modal with Cancel and one submit button. Enter submits once the form can be sent. */
export function FormModal({ title, sub, onClose, onSubmit, submitLabel, canSubmit, disabledReason = 'Fill the required fields first', width = 480, busy, children }: {
  title: string; sub?: ReactNode; onClose: () => void; onSubmit: () => void; submitLabel: string; canSubmit: boolean;
  disabledReason?: string; width?: number; busy?: boolean; children: ReactNode;
}) {
  return (
    <Modal title={title} sub={sub} onClose={onClose} width={width} busy={busy} onSubmit={() => { if (canSubmit) onSubmit(); }}
      footer={<>
        <Button size="sm" variant="secondary" type="button" onClick={onClose} disabled={busy} disabledReason="Working on it.">Cancel</Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!canSubmit} disabledReason={disabledReason}>{submitLabel}</Button>
      </>}>
      {children}
    </Modal>
  );
}
