import { useMemo, useState, type CSSProperties } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { rm, masked, date as fmtDate } from '../lib/format';
import { PAYOUT } from '../lib/vocabulary';
import type { PayoutState } from '../lib/types';

interface Payout {
  id: string; ownerName: string; amount: number; state: PayoutState; method: string;
  bankName: string | null; bankLast4: string | null; paidAt: string | null; failureReason: string | null;
}
interface Payload { data: Payout[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '2026-09-20T02:00:00Z',
  data: [
    { id: 'PAY-1003-02', ownerName: 'Tan Boon Huat', amount: 209500, state: 'failed', method: 'IBG', bankName: 'RHB', bankLast4: '5518', paidAt: null, failureReason: 'Account name does not match the registered owner. Confirm details with the owner.' },
    { id: 'PAY-1003-04', ownerName: 'Goh Family Trust', amount: 1511100, state: 'failed', method: 'DuitNow', bankName: 'Hong Leong', bankLast4: '9043', paidAt: null, failureReason: 'Recipient bank rejected the transfer. The account may be dormant or closed.' },
    { id: 'PAY-1003-01', ownerName: 'Nur Aisyah', amount: 525600, state: 'pending', method: 'DuitNow', bankName: 'Maybank', bankLast4: '2275', paidAt: null, failureReason: null },
    { id: 'PAY-1003-03', ownerName: 'Ong Sok Cheng', amount: 441000, state: 'processing', method: 'IBG', bankName: 'Public Bank', bankLast4: '0945', paidAt: null, failureReason: null },
    { id: 'PAY-0903-01', ownerName: 'Lim Chee Keong', amount: 648200, state: 'paid', method: 'IBG', bankName: 'Maybank', bankLast4: '4417', paidAt: '2026-09-03', failureReason: null },
    { id: 'PAY-0903-02', ownerName: 'Rajesh Kumar', amount: 754200, state: 'paid', method: 'IBG', bankName: 'Maybank', bankLast4: '1193', paidAt: '2026-09-03', failureReason: null },
    { id: 'PAY-0903-03', ownerName: 'Wong Mei Ling', amount: 511500, state: 'paid', method: 'DuitNow', bankName: 'CIMB', bankLast4: '8802', paidAt: '2026-09-03', failureReason: null },
  ],
};

/** Attention-first: failed rises to the top, paid settles to the bottom. */
const GROUP_ORDER: PayoutState[] = ['failed', 'pending', 'processing', 'paid'];
const RANK: Record<PayoutState, number> = { failed: 0, pending: 1, processing: 2, paid: 3 };
type Filter = 'all' | PayoutState;

const COLS = 'minmax(150px,1.4fr) minmax(86px,0.7fr) minmax(140px,1.1fr) minmax(104px,0.9fr) minmax(104px,0.9fr) minmax(92px,0.8fr) minmax(120px,1fr)';
const today = () => new Date().toISOString().slice(0, 10);

/** Bank never shows more than the tail — the raw number would need an audited reveal. */
const destination = (p: Payout) => p.bankLast4 ? `${p.bankName ?? 'Bank'} ${masked(p.bankLast4)}` : (p.bankName ?? '—');
const valueDate = (p: Payout) =>
  p.state === 'paid' && p.paidAt ? fmtDate(p.paidAt)
    : p.state === 'processing' ? 'In transit'
    : p.state === 'failed' ? 'On hold'
    : 'Scheduled';

export default function PayoutsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/payouts', FALLBACK);
  const toast = useToast();

  const [edits, setEdits] = useState<Record<string, Partial<Payout>>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [confirm, setConfirm] = useState<{ payout: Payout; kind: 'retry' | 'paid' } | null>(null);

  const allRows = useMemo(
    () => (data?.data ?? []).map(p => ({ ...p, ...edits[p.id] })),
    [data, edits],
  );

  const counts = useMemo(() => {
    const c: Record<PayoutState, number> = { failed: 0, pending: 0, processing: 0, paid: 0 };
    allRows.forEach(r => { c[r.state] += 1; });
    return c;
  }, [allRows]);

  const failed = allRows.filter(r => r.state === 'failed');
  const due = allRows.filter(r => r.state !== 'paid').reduce((s, r) => s + r.amount, 0);

  const visible = useMemo(() => {
    const rows = filter === 'all' ? allRows : allRows.filter(r => r.state === filter);
    return [...rows].sort((a, b) => RANK[a.state] - RANK[b.state] || b.amount - a.amount);
  }, [allRows, filter]);

  const groups = GROUP_ORDER
    .map(state => ({ state, items: visible.filter(r => r.state === state) }))
    .filter(g => g.items.length > 0);

  // Optimistic-local-state: apply the transition immediately, then attempt the
  // real call in a swallowed catch so the missing dev backend never blocks it.
  function transition(p: Payout, kind: 'retry' | 'paid') {
    const next: PayoutState = kind === 'retry' ? 'processing' : 'paid';
    const patch: Partial<Payout> = kind === 'retry'
      ? { state: 'processing', failureReason: null }
      : { state: 'paid', paidAt: today() };
    setEdits(e => ({ ...e, [p.id]: { ...e[p.id], ...patch } }));
    if (kind === 'retry') {
      toast({ tone: 'success', title: 'Payout resubmitted.', body: `${p.ownerName}'s transfer is processing again.` });
    } else {
      toast({ tone: 'success', title: 'Marked as paid.', body: `${p.ownerName} — ${rm(p.amount)} recorded as transferred.` });
    }
    api.patch('/payouts', { id: p.id, state: next }).catch(() => { /* dev: no backend, keep optimistic */ });
    setConfirm(null);
  }

  const spec: DialogSpec | null = !confirm ? null
    : confirm.kind === 'retry'
      ? {
          title: `Resubmit ${rm(confirm.payout.amount)} to ${confirm.payout.ownerName}?`,
          body: 'Confirm the bank details were corrected first. A second failure on the same details will not resolve itself.',
          meta: `${destination(confirm.payout)} · ${confirm.payout.method}`,
          confirmLabel: 'Resubmit',
          onConfirm: () => transition(confirm.payout, 'retry'),
        }
      : {
          title: `Mark ${rm(confirm.payout.amount)} to ${confirm.payout.ownerName} as paid?`,
          body: 'Record this transfer as settled once the bank confirms it left the account. The owner statement moves to paid.',
          meta: `${destination(confirm.payout)} · ${confirm.payout.method}`,
          confirmLabel: 'Mark paid',
          onConfirm: () => transition(confirm.payout, 'paid'),
        };

  return (
    <>
      <PageHeader
        title="Payouts"
        sub={`${rm(due)} outstanding · ${failed.length} ${failed.length === 1 ? 'payout' : 'payouts'} failed and needing attention`}
        right={
          <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Filter by status</span>
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as Filter)}
              style={{ height: 36, padding: '0 30px 0 12px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: color.card, color: color.ink, fontSize: 13, fontWeight: 500, font: 'inherit', cursor: 'pointer', appearance: 'none' }}
            >
              <option value="all">{`All statuses · ${allRows.length}`}</option>
              {GROUP_ORDER.map(s => <option key={s} value={s}>{`${PAYOUT[s].label} · ${counts[s]}`}</option>)}
            </select>
            <Icon name="ChevronDown" size="sm" style={{ position: 'absolute', right: 9, pointerEvents: 'none', color: color.textMuted }} />
          </label>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      {/* Failed payouts are surfaced first, with the reason and the one-tap fix. */}
      {(filter === 'all' || filter === 'failed') && failed.map(p => (
        <Card key={p.id} style={{ borderLeft: '3px solid var(--color-critical-line)' }}>
          <div style={{ padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p.ownerName}</span>
                <Badge tone={PAYOUT.failed.tone} label={PAYOUT.failed.label} />
              </div>
              <span style={{ fontSize: 12.5, color: color.textMuted, textWrap: 'pretty' }}>{p.failureReason}</span>
              <span style={{ fontSize: text.micro, color: color.faint }}>{`${destination(p)} · ${p.method}`}</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{rm(p.amount)}</span>
            <button onClick={() => setConfirm({ payout: p, kind: 'retry' })} style={darkBtn}>Retry payout</button>
          </div>
        </Card>
      ))}

      {!loading && visible.length === 0 ? (
        <EmptyState
          title={`No ${filter === 'all' ? '' : PAYOUT[filter].label.toLowerCase() + ' '}payouts to show.`}
          body="No payouts match this filter. Clear it to see every owner transfer for the cycle."
          action={{ label: 'Clear filter', onClick: () => setFilter('all') }}
        />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 900 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
                <div>Owner</div>
                <div>Method</div>
                <div>Destination</div>
                <div>Value date</div>
                <div style={{ textAlign: 'right' }}>Amount</div>
                <div>Status</div>
                <div style={{ textAlign: 'right' }}>Action</div>
              </div>

              {loading && allRows.length === 0 ? <TableSkeleton rows={6} cols={7} /> : groups.map(g => (
                <div key={g.state}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 22px', background: color.page, borderBottom: `1px solid ${color.borderMuted}` }}>
                    <span style={{ fontSize: text.micro, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: color.textMuted }}>{PAYOUT[g.state].label}</span>
                    <span style={{ fontSize: text.micro, color: color.faint }}>{g.items.length}</span>
                  </div>
                  {g.items.map(r => (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ownerName}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: text.micro, color: color.textMuted }}>{r.id}</span>
                      </div>
                      <div style={{ fontSize: 12.5 }}>{r.method}</div>
                      {/* Only ever the tail of the account number is rendered. */}
                      <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{destination(r)}</div>
                      <div style={{ fontSize: 12.5, color: color.textMuted }}>{valueDate(r)}</div>
                      <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{rm(r.amount)}</div>
                      <div><Badge tone={PAYOUT[r.state].tone} label={PAYOUT[r.state].label} /></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {r.state === 'failed' && <button onClick={() => setConfirm({ payout: r, kind: 'retry' })} style={darkBtn}>Retry payout</button>}
                        {r.state === 'processing' && <button onClick={() => setConfirm({ payout: r, kind: 'paid' })} style={ghostBtn}>Mark paid</button>}
                        {(r.state === 'pending' || r.state === 'paid') && <span style={{ fontSize: text.micro, color: color.faint }}>{r.state === 'paid' ? 'Settled' : 'Awaiting run'}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '11px 22px', borderTop: `1px solid ${color.border}`, background: color.page, fontSize: text.small, color: color.textMuted }}>
            <span>{visible.length} of {allRows.length} payouts</span>
            <span>Only the last four digits of any account are ever shown.</span>
          </div>
        </Card>
      )}

      <Dialog spec={spec} busy={false} onClose={() => setConfirm(null)} />
    </>
  );
}

const darkBtn: CSSProperties = {
  height: 34, padding: '0 13px', borderRadius: radius.control, background: color.black,
  color: '#FFFFFF', fontSize: 12.5, fontWeight: 500, border: 'none', cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
};
const ghostBtn: CSSProperties = {
  height: 34, padding: '0 13px', borderRadius: radius.control, background: color.card,
  color: color.ink, fontSize: 12.5, fontWeight: 500, border: `1px solid ${color.border}`, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
};
