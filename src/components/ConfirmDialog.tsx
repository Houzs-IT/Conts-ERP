import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export interface ConfirmSpec {
  title: string;
  body?: ReactNode;
  /** Context line: what this affects, what it costs, when it happens. */
  meta?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  /** The button that backs out. Default "Cancel"; say "Keep booking" where Cancel would be ambiguous. */
  cancelLabel?: string;
  /** Destructive or money-moving actions: the confirm button is red. */
  danger?: boolean;
  /** Ask why before going ahead. The reason is passed to onConfirm and should be written to the audit log. */
  reason?: { label?: string; placeholder?: string; optional?: boolean; maxLength?: number };
  /** Extra actions rendered left of confirm, e.g. Block dates or Create reservation on the calendar. */
  extraActions?: { label: string; onClick: () => void; variant?: 'secondary' | 'danger' }[];
  onConfirm: (reason: string) => Promise<void> | void;
}

/**
 * The one confirmation dialog. It names the action and its target; a destructive one says the consequence and how to
 * undo it. Focus moves into the dialog and returns to the trigger; Escape and the backdrop cancel unless it is busy.
 * Pass `busy` when the caller tracks it; otherwise the dialog shows busy while onConfirm's promise runs.
 */
export function ConfirmDialog({ spec, busy: busyProp, onClose }: { spec: ConfirmSpec | null; busy?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLFormElement>(null);
  const returnTo = useRef<Element | null>(null);
  const [reason, setReason] = useState('');
  const [running, setRunning] = useState(false);
  const busy = busyProp ?? running;

  useEffect(() => { if (spec) setReason(''); }, [spec]);
  useEffect(() => {
    if (!spec) return;
    returnTo.current = document.activeElement;
    (ref.current?.querySelector<HTMLElement>('textarea') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      (returnTo.current as HTMLElement | null)?.focus?.();
    };
  }, [spec, busy, onClose]);

  if (!spec) return null;
  const needReason = !!spec.reason && !spec.reason.optional;
  const blocked = needReason && !reason.trim();

  async function go() {
    if (!spec || blocked || busy) return;
    const r = spec.onConfirm(reason.trim());
    if (r && typeof (r as Promise<void>).then === 'function' && busyProp === undefined) {
      setRunning(true);
      try { await r; } finally { setRunning(false); }
    }
  }

  return createPortal(
    <div role="alertdialog" aria-modal="true" aria-label={spec.title}
      className="fixed inset-0 z-[80] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <form ref={ref} onSubmit={e => { e.preventDefault(); void go(); }}
        className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="px-[22px] pt-[22px] pb-[18px] flex flex-col gap-[9px]">
          <h2 className="m-0 text-title font-semibold [text-wrap:pretty]">{spec.title}</h2>
          {spec.body && <div className="m-0 text-copy text-muted-ink [text-wrap:pretty]">{spec.body}</div>}
          {spec.meta && <div className="mt-[3px] py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta">{spec.meta}</div>}
          {spec.reason && (
            <div className="flex flex-col gap-[6px] mt-1">
              <label htmlFor="confirm-reason" className="text-meta font-medium text-muted-ink">{spec.reason.label ?? 'Reason'}{spec.reason.optional ? ' (optional)' : ' (required)'}</label>
              <textarea id="confirm-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={spec.reason.maxLength ?? 300}
                placeholder={spec.reason.placeholder} required={needReason}
                className="block w-full box-border text-ink bg-card border border-solid border-line rounded-control outline-none font-sans text-copy py-[10px] px-3 resize-y focus:border-gold" />
            </div>
          )}
        </div>
        <div className="py-[14px] px-[22px] border-0 border-t border-solid border-line bg-page flex items-center justify-end gap-[9px] flex-wrap">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy} disabledReason="Working on it.">{spec.cancelLabel ?? 'Cancel'}</Button>
          {spec.extraActions?.map(a => (
            <Button key={a.label} type="button" size="sm" variant={a.variant ?? 'secondary'} onClick={a.onClick} disabled={busy} disabledReason="Working on it.">{a.label}</Button>
          ))}
          <Button type="submit" size="sm" variant={spec.danger ? 'danger' : 'primary'} loading={busy} disabled={blocked}
            disabledReason={blocked ? 'Write a reason first.' : undefined}>
            {busy ? (spec.busyLabel ?? 'Working…') : spec.confirmLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/**
 * Ask from an event handler: `const [dialog, ask] = useConfirm();` then
 * `const r = await ask({ title, confirmLabel, danger: true }); if (r === null) return;` and render `{dialog}`.
 * Resolves with the reason ('' when none was asked) or null when the person backed out.
 */
export function useConfirm(): [ReactNode, (spec: Omit<ConfirmSpec, 'onConfirm'>) => Promise<string | null>] {
  const [state, setState] = useState<{ spec: ConfirmSpec; resolve: (v: string | null) => void } | null>(null);
  const ask = useCallback((spec: Omit<ConfirmSpec, 'onConfirm'>) => new Promise<string | null>(resolve => {
    setState({ spec: { ...spec, onConfirm: r => { setState(null); resolve(r); } }, resolve });
  }), []);
  const el = <ConfirmDialog spec={state?.spec ?? null} busy={false} onClose={() => { state?.resolve(null); setState(null); }} />;
  return [el, ask];
}

/**
 * A button that asks first. Use it for every destructive or money-moving action (delete, cancel a document, remove a
 * payment): `<ConfirmButton confirm={{ title: 'Delete this supplier?', confirmLabel: 'Delete supplier' }} onConfirm={remove}>Delete</ConfirmButton>`.
 * The dialog is red (danger) unless `confirm.danger` is set to false.
 */
export function ConfirmButton({ confirm, onConfirm, children, variant = 'danger', size = 'sm', icon, disabled, disabledReason, style }: {
  confirm: Omit<ConfirmSpec, 'onConfirm'>; onConfirm: (reason: string) => Promise<void> | void; children: ReactNode;
  variant?: 'danger' | 'secondary' | 'primary' | 'tertiary'; size?: 'sm' | 'md'; icon?: ReactNode; disabled?: boolean; disabledReason?: string; style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} icon={icon} disabled={disabled} disabledReason={disabledReason} style={style} onClick={() => setOpen(true)}>{children}</Button>
      <ConfirmDialog onClose={() => setOpen(false)}
        spec={open ? { danger: true, ...confirm, onConfirm: async r => { await onConfirm(r); setOpen(false); } } : null} />
    </>
  );
}
