import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { rm, masked } from '../lib/format';
import type { Tone, PayoutState } from '../lib/types';

const STATE_TONE: Record<PayoutState, Tone> = {
  pending: 'neutral', processing: 'info', paid: 'success', failed: 'critical',
};
const STATE_LABEL: Record<PayoutState, string> = {
  pending: 'Pending', processing: 'Processing', paid: 'Paid', failed: 'Failed',
};

interface Payout {
  id: string; ownerName: string; amount: number; state: PayoutState;
  bankName: string | null; bankLast4: string | null; paidAt: string | null; failureReason: string | null;
}
interface Payload { data: Payout[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'PAY-0903-01', ownerName: 'Lim Chee Keong', amount: 648200, state: 'paid', bankName: 'Maybank', bankLast4: '4417', paidAt: '2026-09-03', failureReason: null },
    { id: 'PAY-0903-02', ownerName: 'Rajesh Kumar', amount: 754200, state: 'paid', bankName: 'Maybank', bankLast4: '1193', paidAt: '2026-09-03', failureReason: null },
    { id: 'PAY-0903-03', ownerName: 'Wong Mei Ling', amount: 511500, state: 'paid', bankName: 'CIMB', bankLast4: '8802', paidAt: '2026-09-03', failureReason: null },
    { id: 'PAY-1003-01', ownerName: 'Nur Aisyah', amount: 525600, state: 'pending', bankName: 'Maybank', bankLast4: '2275', paidAt: null, failureReason: null },
    { id: 'PAY-1003-02', ownerName: 'Tan Boon Huat', amount: 209500, state: 'failed', bankName: 'RHB', bankLast4: '5518', paidAt: null, failureReason: 'Account name does not match the registered owner. Confirm details with the owner.' },
  ],
};

const COLS = 'minmax(160px,1.4fr) minmax(150px,1.2fr) minmax(120px,1fr) minmax(120px,1fr) minmax(110px,0.9fr)';

export default function PayoutsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/payouts', FALLBACK);
  const [retry, setRetry] = useState<Payout | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = data?.data ?? [];
  const due = rows.filter(r => r.state !== 'paid').reduce((s, r) => s + r.amount, 0);
  const failed = rows.filter(r => r.state === 'failed');

  async function doRetry() {
    if (!retry) return;
    setBusy(true);
    try {
      await api.patch('/payouts', { id: retry.id, state: 'processing' });
      toast({ tone: 'success', title: 'Payout resubmitted.', body: `${retry.ownerName}'s transfer is processing again.` });
      setRetry(null);
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Could not resubmit.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Payouts" sub={`${rm(due)} outstanding &middot; ${failed.length} failed and needing attention`} />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      {failed.map(p => (
        <Card key={p.id} style={{ borderLeft: '3px solid #C2413B' }}>
          <div style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p.ownerName}</span>
                <Badge tone="critical" label="Failed" />
              </div>
              <span style={{ fontSize: 12.5, color: color.textMuted, textWrap: 'pretty' }}>{p.failureReason}</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{rm(p.amount)}</span>
            <button onClick={() => setRetry(p)} style={{ height: 34, padding: '0 13px', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 12.5, fontWeight: 500, border: 'none', cursor: 'pointer' }}>
              Retry payout
            </button>
          </div>
        </Card>
      ))}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 800 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Owner</div><div>Destination</div><div>Value date</div><div style={{ textAlign: 'right' }}>Amount</div><div>Status</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={5} cols={5} /> : rows.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.ownerName}</span>
                  <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{r.id}</span>
                </div>
                {/* Only ever the tail of the account number. */}
                <div style={{ fontSize: 12.5 }}>{r.bankName} {r.bankLast4 ? masked(r.bankLast4) : '\u2014'}</div>
                <div style={{ fontSize: 12.5 }}>{r.paidAt ?? 'Scheduled'}</div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{rm(r.amount)}</div>
                <div><Badge tone={STATE_TONE[r.state]} label={STATE_LABEL[r.state]} /></div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Dialog
        busy={busy}
        onClose={() => setRetry(null)}
        spec={!retry ? null : {
          title: `Resubmit ${rm(retry.amount)} to ${retry.ownerName}?`,
          body: 'Confirm the bank details were corrected first. A second failure on the same details will not resolve itself.',
          meta: `${retry.bankName} ${retry.bankLast4 ? masked(retry.bankLast4) : ''}`,
          confirmLabel: 'Resubmit', busyLabel: 'Submitting\u2026', onConfirm: doRetry,
        }}
      />
    </>
  );
}
