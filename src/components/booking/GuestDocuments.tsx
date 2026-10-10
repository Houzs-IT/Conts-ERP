import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../Button';
import Icon from '../Icon';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { rm, date } from '../../lib/format';
import { cx } from '../../lib/design-tokens';

/** An invoice or official receipt issued for a booking (functions/_lib/guestDocuments.ts). */
export interface GuestDocument {
  id: string; type: 'invoice' | 'receipt'; typeLabel: string; docNo: string; reservationId: string; paymentId: string | null;
  amount: number; issuedAt: string; issuedBy: string | null; voidedAt: string | null; voidedBy: string | null; voidReason: string | null;
  guestName: string | null; bookingRef: string | null; unit: string | null; channel: string | null; pdf: string;
}
interface PaymentLite { id: string; amount: number; receivedOn: string | null; status: 'received' | 'expected'; kind: 'guest_payment' | 'ota_payout' | 'refund'; method: string | null }

const failMessage = (e: unknown) => (errorMessage(e, 'Try again in a moment.'));
const open = (d: GuestDocument) => window.open(d.pdf, '_blank', 'noopener');

/**
 * The booking drawer's documents: Issue invoice, Issue receipt for each received guest payment, and every document
 * issued with View and Void. Voided ones stay, struck through, with the reason.
 */
export function DocumentsSection({ reservationId, documents, payments, invoiceReason, onChanged }: {
  reservationId: string; documents: GuestDocument[]; payments: PaymentLite[]; invoiceReason: string | null; onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<GuestDocument | null>(null);
  const liveInvoice = documents.find(d => d.type === 'invoice' && !d.voidedAt);
  const receiptFor = (pid: string) => documents.find(d => d.type === 'receipt' && d.paymentId === pid && !d.voidedAt);
  const receiptable = payments.filter(p => p.kind === 'guest_payment' && p.status === 'received');

  async function issue(type: 'invoice' | 'receipt', paymentId?: string) {
    setBusy(paymentId ?? type);
    try {
      const d = await api.post<GuestDocument>('/guest-documents', { type, reservationId, paymentId });
      toast({ tone: 'success', title: `${d.typeLabel} ${d.docNo} issued.`, body: `${rm(d.amount)}. Press View to print it or save it as PDF.` });
      onChanged();
    } catch (e) {
      toast({ tone: 'critical', title: `${type === 'invoice' ? 'Invoice' : 'Receipt'} not issued.`, body: failMessage(e) });
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">Documents</div>
      <div className="border border-solid border-line rounded-card overflow-hidden">
        {documents.length === 0 && <div className="px-[14px] py-[10px] text-meta text-muted-ink">No invoice or receipt issued yet.</div>}
        {documents.map(d => (
          <div key={d.id} className="flex items-center justify-between gap-3 px-[14px] py-[8px] [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
            <span className="flex flex-col min-w-0">
              <span className={cx('text-copy font-medium font-mono', d.voidedAt && 'line-through text-muted-ink')}>{d.docNo}</span>
              <span className="text-caption text-muted-ink text-pretty">
                {d.typeLabel} · {rm(d.amount)} · {date(d.issuedAt)}{d.voidedAt ? ` · Void: ${d.voidReason}` : ''}
              </span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="tertiary" onClick={() => open(d)}>View</Button>
              {!d.voidedAt && <Button size="sm" variant="tertiary" onClick={() => setVoiding(d)}>Void</Button>}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />} loading={busy === 'invoice'}
          disabled={!!liveInvoice || !!invoiceReason} disabledReason={liveInvoice ? `Invoice ${liveInvoice.docNo} is already issued. Void it to issue a new one.` : invoiceReason ?? ''}
          onClick={() => issue('invoice')}>Issue invoice</Button>
        {receiptable.map(p => {
          const has = receiptFor(p.id);
          return (
            <Button key={p.id} size="sm" variant="secondary" icon={<Icon name="Receipt" size="sm" />} loading={busy === p.id}
              disabled={!!has} disabledReason={has ? `Receipt ${has.docNo} is already issued for this payment.` : ''}
              onClick={() => issue('receipt', p.id)}>
              {has ? `Receipt issued · ${rm(p.amount)}` : `Issue receipt · ${rm(p.amount)}${p.receivedOn ? ` · ${date(p.receivedOn)}` : ''}`}
            </Button>
          );
        })}
      </div>
      {receiptable.length === 0 && (
        <p className="m-0 text-caption text-muted-ink">A receipt is issued for a payment the guest made to us. Record it with Record payment first.</p>
      )}
      {voiding && <VoidDocumentDialog doc={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); onChanged(); }} />}
    </div>
  );
}

/** Void with a reason. The number stays taken and is never issued again. */
export function VoidDocumentDialog({ doc, onClose, onDone }: { doc: GuestDocument; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/guest-documents/${encodeURIComponent(doc.id)}/void`, { reason: reason.trim() });
      toast({ tone: 'neutral', title: `${doc.docNo} voided.`, body: 'The number stays on record, struck through. Issue a new document if one is needed.' });
      onDone();
    } catch (err) {
      setError(failMessage(err));
    }
    setBusy(false);
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Void ${doc.docNo}`} className="fixed inset-0 z-[80] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <form onSubmit={submit} className="relative w-full max-w-[460px] bg-card rounded-card shadow-[var(--shadow-overlay)] flex flex-col">
        <div className="px-[22px] pt-[22px] pb-2 flex flex-col gap-[6px]">
          <h2 className="m-0 text-title font-semibold">Void {doc.typeLabel.toLowerCase()} {doc.docNo}?</h2>
          <p className="m-0 text-copy text-muted-ink text-pretty">It stays on record marked void, with your reason. The number is never issued again. Tell the guest if they already have it.</p>
        </div>
        <div className="px-[22px] py-3 flex flex-col gap-3">
          <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta">{doc.guestName ?? 'Guest'} · {rm(doc.amount)} · issued {date(doc.issuedAt)}</div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="void-reason" className="text-meta font-medium text-muted-ink">Reason (required)</label>
            <textarea id="void-reason" autoFocus required value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
              placeholder="e.g. Wrong guest name; reissued"
              className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
          </div>
          {error && <p role="alert" className="m-0 text-meta text-danger">{error}</p>}
        </div>
        <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px] rounded-b-card">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button type="submit" size="sm" variant="danger" loading={busy} disabled={!reason.trim()} disabledReason="Write the reason first.">Void document</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
