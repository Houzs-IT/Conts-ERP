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
import { rm } from '../lib/format';
import type { Tone, StatementState } from '../lib/types';

const STATE_TONE: Record<StatementState, Tone> = {
  provisional: 'neutral', finalised: 'warning', sent: 'info', paid: 'success',
};
const STATE_LABEL: Record<StatementState, string> = {
  provisional: 'Provisional', finalised: 'Not sent', sent: 'Sent', paid: 'Paid',
};

interface Statement {
  id: string; ownerName: string; unitsLabel: string; state: StatementState;
  grossBookingValue: number; managementFee: number; expensesTotal: number; netPayout: number;
}
interface Payload { data: Statement[]; summary: { notSent: number }; generatedAt: string; filtersApplied: Record<string, string> }

const FALLBACK: Payload = {
  generatedAt: '', filtersApplied: { period: '2026-08' }, summary: { notSent: 2 },
  data: [
    { id: 's1', ownerName: 'Lim Chee Keong', unitsLabel: 'Vista Jaya One #A-12-03', grossBookingValue: 926000, managementFee: 231500, expensesTotal: 46300, netPayout: 648200, state: 'paid' },
    { id: 's2', ownerName: 'Rajesh Kumar', unitsLabel: 'Tribeca #2207', grossBookingValue: 1048000, managementFee: 262000, expensesTotal: 31800, netPayout: 754200, state: 'paid' },
    { id: 's3', ownerName: 'Wong Mei Ling', unitsLabel: 'Arcoris #B-08-11', grossBookingValue: 714000, managementFee: 178500, expensesTotal: 24000, netPayout: 511500, state: 'paid' },
    { id: 's4', ownerName: 'Nur Aisyah', unitsLabel: 'The Establishment #A-21-02', grossBookingValue: 769000, managementFee: 192200, expensesTotal: 51200, netPayout: 525600, state: 'finalised' },
    { id: 's5', ownerName: 'Tan Boon Huat', unitsLabel: 'Sentral Suites #C-31-14', grossBookingValue: 498000, managementFee: 124500, expensesTotal: 164000, netPayout: 209500, state: 'finalised' },
    { id: 's6', ownerName: 'Goh Family Trust', unitsLabel: '3 units \u00b7 Sunway Velocity', grossBookingValue: 2134000, managementFee: 533500, expensesTotal: 89400, netPayout: 1511100, state: 'provisional' },
  ],
};

const COLS = '32px minmax(170px,1.8fr) minmax(120px,1fr) minmax(100px,1fr) minmax(100px,1fr) minmax(120px,1fr) minmax(120px,1fr)';

export default function StatementsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/statements?period=2026-08', FALLBACK);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<null | 'send' | 'generate'>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = data?.data ?? [];
  const selected = rows.filter(r => sel[r.id]);
  const sendable = rows.filter(r => r.state === 'finalised');

  async function run() {
    setBusy(true);
    try {
      if (confirm === 'send') {
        const res = await api.post<{ sent: number; failed: { id: string; reason: string }[] }>(
          '/statements/send', { statementIds: selected.map(s => s.id) });
        // Partial failure names only what did not go, and keeps the rest.
        if (res.failed.length) {
          toast({ tone: 'warning', title: `${res.sent} sent, ${res.failed.length} not.`, body: res.failed[0].reason });
        } else {
          toast({ tone: 'success', title: `${res.sent} ${res.sent === 1 ? 'statement' : 'statements'} sent.`, body: 'Owners were emailed and the statements are live on their portals.' });
        }
        setSel({});
      } else {
        const res = await api.post<{ count: number; period: string }>('/statements/generate', { period: '2026-09' });
        toast({ tone: 'success', title: `Generated for ${res.count} owners.`, body: 'Review the provisional figures before sending.' });
      }
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'That did not go through.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <PageHeader title="Owner statements" sub={`August 2026 &middot; ${sendable.length} not sent`}
        right={<button onClick={() => setConfirm('generate')} style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer' }}>Generate</button>} />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <Card>
        {selected.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '11px 22px', background: color.black, color: '#FFFFFF' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{selected.length} of {sendable.length} selected</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setSel({})} style={{ fontSize: text.small, fontWeight: 500, color: color.onDark, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear</button>
              <button onClick={() => setConfirm('send')} style={{ padding: '7px 13px', borderRadius: radius.control, background: color.gold, color: color.black, fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Send selected</button>
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div /><div>Owner</div>
              <div style={{ textAlign: 'right' }}>Gross</div><div style={{ textAlign: 'right' }}>Fees</div>
              <div style={{ textAlign: 'right' }}>Expenses</div><div style={{ textAlign: 'right' }}>Net payout</div><div>Status</div>
            </div>

            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={7} /> : rows.map(s => {
              const can = s.state === 'finalised';
              const on = !!sel[s.id];
              return (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 50, padding: '8px 22px', borderBottom: `1px solid ${color.borderMuted}`, background: on ? color.goldTint : '#FFFFFF' }}>
                  <input type="checkbox" disabled={!can} checked={on}
                    aria-label={can ? `Select ${s.ownerName}` : `${s.ownerName} cannot be sent — ${STATE_LABEL[s.state]}`}
                    onChange={() => setSel(v => ({ ...v, [s.id]: !v[s.id] }))}
                    style={{ width: 17, height: 17, accentColor: '#11694A', cursor: can ? 'pointer' : 'not-allowed' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.ownerName}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.unitsLabel}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13 }}>{rm(s.grossBookingValue, { cents: false })}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, color: color.textMuted }}>&minus; {rm(s.managementFee, { cents: false })}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, color: color.textMuted }}>&minus; {rm(s.expensesTotal, { cents: false })}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{rm(s.netPayout)}</div>
                  <div><Badge tone={STATE_TONE[s.state]} label={STATE_LABEL[s.state]} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Dialog
        busy={busy}
        onClose={() => setConfirm(null)}
        spec={!confirm ? null : confirm === 'send' ? {
          title: `Send ${selected.length} ${selected.length === 1 ? 'statement' : 'statements'}?`,
          body: 'Owners receive an email and a portal notification with the PDF. Sent statements cannot be edited, only superseded by an adjustment.',
          meta: `${rm(selected.reduce((s, r) => s + r.netPayout, 0))} total &middot; finalised statements only`,
          confirmLabel: 'Send', busyLabel: 'Sending\u2026', onConfirm: run,
        } : {
          title: 'Generate September statements?',
          body: 'Draws every settled booking, fee and documented expense for the period. Statements land as Provisional and must be reviewed before sending.',
          meta: 'A period that has already been sent cannot be regenerated.',
          confirmLabel: 'Generate', busyLabel: 'Generating\u2026', onConfirm: run,
        }}
      />
    </>
  );
}
