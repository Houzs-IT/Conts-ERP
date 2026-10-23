import { useEffect, type ReactNode } from 'react';

/** Form-bearing dialog shell: the shared Dialog is confirmation-only, so dialogs with fields (invite, edit, org
 *  structure, moving people) use this lightweight overlay. */
export function Modal({ title, sub, onClose, children, footer, width = 460 }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode; width?: number;
}) {
  useEffect(() => {
    // An open dropdown inside (Department, Position) takes the first Escape; the dialog closes on the next.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] animate-[fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-h-[calc(100vh-48px)] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]" style={{ maxWidth: width }}>
        <div className="pt-5 px-[22px] pb-1 flex flex-col gap-1">
          <h2 className="m-0 text-title leading-[1.3] font-semibold">{title}</h2>
          {sub && <p className="m-0 text-copy leading-[1.5] text-muted-ink">{sub}</p>}
        </div>
        <div className="py-4 px-[22px]">{children}</div>
        <div className="py-3.5 px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-2 flex-wrap sticky bottom-0">{footer}</div>
      </div>
    </div>
  );
}
