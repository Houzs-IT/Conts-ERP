import { useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import type { Receipt } from '../../lib/claims';
import { FORM_FOOTER } from './FormLayout';

export function ReviewFooter({ receipt, isBusy, isReading, onSend, onDone }: { receipt: Receipt; isBusy: boolean; isReading: boolean; onSend: () => void; onDone: () => void }) {
  const toast = useToast();
  const [isSendingBack, setIsSendingBack] = useState(false);
  return (
    <>
      <div className={FORM_FOOTER}>
        <Button variant="secondary" disabled={isBusy} onClick={() => setIsSendingBack(true)}>Send back</Button>
        <Button variant="primary" loading={isBusy} disabled={isReading} disabledReason="Reading the papers first." onClick={onSend}>Send to finance</Button>
      </div>
      <ConfirmDialog spec={isSendingBack ? {
        title: `Send ${receipt.receiptNo} back`, body: 'The person who handed it in sees your reason and can hand in a replacement.', confirmLabel: 'Send back', danger: true,
        reason: { label: 'Why is it sent back?', maxLength: 300 },
        onConfirm: async reason => {
          try {
            await api.post(`/claims/reno-review/${receipt.id}/reject`, { reason: reason.trim() });
            toast({ tone: 'success', title: `Receipt ${receipt.receiptNo} sent back` });
            onDone();
          } catch (e) { toast({ tone: 'critical', title: 'Not sent back', body: errorMessage(e) }); }
        },
      } : null} onClose={() => setIsSendingBack(false)} />
    </>
  );
}
