import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import Icon from './Icon';
import { useToast } from './Toast';
import { ApiFailure } from '../lib/api';
import { decide, type Approval, type Decision } from '../lib/approvals';
import { rm, date, dateTime } from '../lib/format';
import { refreshNavCounts } from '../lib/navBadges';

/**
 * Money requests waiting for a second person, shown on the record they are about (a booking, an owner, the payouts
 * screen). Whoever may decide sees Approve and Reject here; the person who asked sees Withdraw. Nothing in the
 * request has happened yet, and the banner says so.
 */
export default function ApprovalBanner({ items, onChanged, compact }: { items: Approval[]; onChanged: () => void; compact?: boolean }) {
  const [open, setOpen] = useState<{ a: Approval; decision: Decision } | null>(null);
  if (!items.length) return null;
  return (
    <div role="status" className="rounded-card border border-solid border-[var(--color-warning-line)] bg-[var(--color-warning-bg)] flex flex-col">
      {items.map((a, i) => (
        <div key={a.id} className={`flex flex-col gap-[6px] px-[14px] py-[11px] ${i ? '[border-top:1px_solid_var(--color-warning-line)]' : ''}`}>
          <div className="flex items-start gap-2">
            <span className="mt-[2px] text-[var(--color-warning-fg)]"><Icon name="ShieldAlert" size="sm" /></span>
            <div className="flex flex-col gap-[2px] min-w-0 flex-1">
              <span className="text-copy font-semibold text-ink">{a.kindLabel} waiting for approval · {rm(a.amount)}</span>
              <span className="text-meta text-ink text-pretty">{a.summary}</span>
              <span className="text-caption text-muted-ink text-pretty">
                Asked by {a.requestedBy.name} on {date(a.requestedAt)} · Reason: {a.reason}
              </span>
              {!compact && <span className="text-caption text-muted-ink">Nothing has been paid or changed yet. It happens when the request is approved.</span>}
            </div>
          </div>
          {(a.can.approve || a.can.reject || a.can.cancel || a.can.why) && (
            <div className="flex items-center gap-2 flex-wrap pl-6">
              {a.can.approve && <Button size="sm" variant="primary" onClick={() => setOpen({ a, decision: 'approve' })}>{a.can.selfApproval ? 'Approve my own request' : 'Approve'}</Button>}
              {a.can.reject && <Button size="sm" variant="secondary" onClick={() => setOpen({ a, decision: 'reject' })}>Reject</Button>}
              {a.can.cancel && <Button size="sm" variant="tertiary" onClick={() => setOpen({ a, decision: 'cancel' })}>Withdraw</Button>}
              {!a.can.approve && a.can.why && <span className="text-caption text-muted-ink">{a.can.why}</span>}
            </div>
          )}
        </div>
      ))}
      {open && <DecisionDialog a={open.a} decision={open.decision} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} />}
    </div>
  );
}

const COPY: Record<Decision, { title: (a: Approval) => string; confirm: string; tone: 'primary' | 'danger' | 'secondary' }> = {
  approve: { title: a => `Approve ${a.kindLabel.toLowerCase()} of ${rm(a.amount)}?`, confirm: 'Approve and carry it out', tone: 'primary' },
  reject: { title: a => `Reject ${a.kindLabel.toLowerCase()} of ${rm(a.amount)}?`, confirm: 'Reject request', tone: 'danger' },
  cancel: { title: a => `Withdraw this ${a.kindLabel.toLowerCase()} request?`, confirm: 'Withdraw request', tone: 'secondary' },
};

/** Approve, reject or withdraw one request. A note is required to reject, and to approve your own request. */
export function DecisionDialog({ a, decision, onClose, onDone }: { a: Approval; decision: Decision; onClose: () => void; onDone: (a: Approval) => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsNote = decision === 'reject' || (decision === 'approve' && a.can.selfApproval);
  const c = COPY[decision];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (needsNote && !note.trim()) return;
    setBusy(true); setError(null);
    try {
      const done = await decide(a.id, decision, note.trim());
      toast(decision === 'approve'
        ? { tone: 'success', title: `Approved: ${rm(a.amount)}.`, body: `${a.summary}. It has been carried out.` }
        : decision === 'reject'
          ? { tone: 'neutral', title: 'Request rejected.', body: `${a.requestedBy.name} can see why on the Approvals page.` }
          : { tone: 'neutral', title: 'Request withdrawn.' });
      void refreshNavCounts();
      onDone(done);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Try again in a moment.');
    }
    setBusy(false);
  }

  const body: ReactNode = decision === 'approve'
    ? (a.can.selfApproval
      ? 'You asked for this yourself. Because you are the only management user, you may approve it, but you must write why; it is recorded as self-approved.'
      : 'Approving carries it out now, in one step with this approval, and both are kept in the audit log.')
    : decision === 'reject' ? 'Nothing is paid or changed. Say why, so the person who asked knows what to fix.'
    : 'Nothing is paid or changed. You can ask again later.';

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={c.title(a)}
      className="fixed inset-0 z-[80] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <form onSubmit={submit} className="relative w-full max-w-[480px] bg-card rounded-card shadow-[var(--shadow-overlay)] flex flex-col max-h-[90vh]">
        <div className="px-[22px] pt-[22px] pb-2 flex flex-col gap-[6px]">
          <h2 className="m-0 text-title font-semibold">{c.title(a)}</h2>
          <p className="m-0 text-copy text-muted-ink text-pretty">{body}</p>
        </div>
        <div className="px-[22px] py-3 flex flex-col gap-3 overflow-y-auto">
          <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta flex flex-col gap-[2px]">
            <span className="text-ink">{a.summary}</span>
            <span className="text-muted-ink">Asked by {a.requestedBy.name}, {dateTime(a.requestedAt)} · Reason: {a.reason}</span>
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ap-note" className="text-meta font-medium text-muted-ink">{needsNote ? (decision === 'reject' ? 'Why it is rejected (required)' : 'Why you approve your own request (required)') : 'Note (optional)'}</label>
            <textarea id="ap-note" autoFocus={needsNote} value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500} required={needsNote}
              className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
          </div>
          {error && <p role="alert" className="m-0 text-meta text-[var(--color-critical-fg)]">{error}</p>}
        </div>
        <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px] flex-wrap rounded-b-card">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Keep it waiting</Button>
          <Button type="submit" size="sm" variant={c.tone} loading={busy} disabled={needsNote && !note.trim()} disabledReason="Write the note first.">{c.confirm}</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
