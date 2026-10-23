import { useEffect, useRef } from 'react';
import { Phone, MessageCircle } from 'lucide-react';
import { Button, ButtonLink } from './Button';

/** "Forgot your PIN?" on the worker sign-in: ways to reach the office, which gives a new PIN on Workers.
 *  The browser's own modal dialog keeps focus inside, closes on Escape and returns focus to the button. On a phone
 *  it rises from the bottom, where the thumb is. */
export function PinHelpSheet({ open, onClose, supportPhone, employeeNo }: { open: boolean; onClose: () => void; supportPhone: string; employeeNo: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // The server sends the number formatted with its country code (+60 11-...), so its digits dial as they are. Not
  // lib/phone: its phone library would join the first download every page waits for.
  const digits = supportPhone.replace(/\D/g, '');
  const message = encodeURIComponent(`Hi, I forgot my PIN for the field app. My employee ID is EMP-${employeeNo}`);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="pin-help-title"
      // A tap on the dimmed area outside the sheet closes it; the sheet itself fills the dialog box.
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-[400px] p-0 border-0 bg-transparent backdrop:bg-[var(--color-surface-scrim)]">
      <div className="bg-card text-ink rounded-t-[20px] sm:rounded-card shadow-[var(--shadow-overlay)] px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="pin-help-title" className="m-0 text-title font-semibold">Forgot your PIN?</h2>
          <p className="m-0 text-copy text-muted-ink text-pretty">
            The office gives you a new PIN in a minute. Your employee ID stays the same.
          </p>
        </div>
        {digits ? (
          <div className="flex flex-col gap-2">
            <ButtonLink variant="primary" size="touch" href={`tel:+${digits}`} icon={<Phone size={18} aria-hidden />} style={{ width: '100%' }}>
              Call the office
            </ButtonLink>
            <ButtonLink variant="secondary" size="touch" href={`https://wa.me/${digits}?text=${message}`} target="_blank" rel="noreferrer"
              icon={<MessageCircle size={18} aria-hidden />} style={{ width: '100%' }}>
              WhatsApp the office
            </ButtonLink>
            <span className="text-meta text-muted-ink text-center tabular-nums">{supportPhone}</span>
          </div>
        ) : (
          <p className="m-0 text-copy">Ask the office or your supervisor for a new PIN.</p>
        )}
        <p className="m-0 text-meta text-muted-ink text-pretty">
          Your supervisor can also give you a new PIN on the Workers page, under Give app access.
        </p>
        <Button type="button" variant="tertiary" size="touch" onClick={onClose} style={{ width: '100%' }}>Close</Button>
      </div>
    </dialog>
  );
}
