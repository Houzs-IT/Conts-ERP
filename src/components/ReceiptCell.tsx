import { useRef, useState } from 'react';
import { api, downloadFile, errorMessage, notifyFailure } from '../lib/api';
import { useToast } from './Toast';
import { cx } from '../lib/design-tokens';

const LINK = 'p-0 bg-transparent border-none cursor-pointer text-meta underline [font-family:inherit] disabled:opacity-60 disabled:cursor-default';

/** A bill's receipt in a list: "Receipt" opens it; an owner-paid bill without one (src/lib/receipts.ts missingReceipt)
 *  reads "No receipt" with "Add receipt", which uploads the file to the unit and attaches it
 *  (PATCH /api/expenses/:id { receiptDocumentId }, allowed on a final month: it changes no figure). */
export function ReceiptCell({ expenseId, unitId, receiptDocumentId, missing, canAdd, onAdded, className }: {
  expenseId: string; unitId: string; receiptDocumentId: string | null; missing: boolean; canAdd: boolean; onAdded: () => void; className?: string;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (receiptDocumentId) {
    return <button type="button" onClick={e => { e.stopPropagation(); downloadFile(`/documents/${receiptDocumentId}/download`).catch(notifyFailure); }}
      className={cx(LINK, 'text-gold-ink', className)}>Receipt</button>;
  }
  if (!missing) return <span className={cx('text-meta text-muted-ink', className)}>—</span>;

  async function attach(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('unitId', unitId); fd.append('kind', 'receipt');
      const doc = await api.post<{ id: string }>('/documents', fd);
      await api.patch(`/expenses/${encodeURIComponent(expenseId)}`, { receiptDocumentId: doc.id });
      toast({ tone: 'success', title: 'Receipt added.', body: 'It shows on the bill and on the owner statement line.' });
      onAdded();
    } catch (e) {
      toast({ tone: 'critical', title: 'Receipt was not added.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return (
    <span className={cx('inline-flex items-baseline gap-x-1.5 flex-wrap', className)} onClick={e => e.stopPropagation()}>
      <span className="text-meta text-warning font-medium whitespace-nowrap">No receipt</span>
      {canAdd && <>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={cx(LINK, 'text-ink whitespace-nowrap')}>
          {busy ? 'Adding…' : 'Add receipt'}
        </button>
        <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={e => void attach(e.target.files?.[0])} />
      </>}
    </span>
  );
}
