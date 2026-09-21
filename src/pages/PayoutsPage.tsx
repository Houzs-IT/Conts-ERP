import { useMemo, useState } from 'react';
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
  id: string; ref?: string; ownerName: string; amount: number; state: PayoutState; method: string;
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

// COLS as an arbitrary grid-template-columns utility (underscores == spaces).
const gridCols = 'grid-cols-[minmax(150px,1.4fr)_minmax(86px,0.7fr)_minmax(140px,1.1fr)_minmax(104px,0.9fr)_minmax(104px,0.9fr)_minmax(92px,0.8fr)_minmax(120px,1fr)]';
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
  async function transition(p: Payout, kind: 'retry' | 'paid') {
    const next: PayoutState = kind === 'retry' ? 'processing' : 'paid';
    const patch: Partial<Payout> = kind === 'retry'
      ? { state: 'processing', failureReason: null }
      : { state: 'paid', paidAt: today() };
    setConfirm(null);
    try {
      await api.patch('/payouts', { id: p.id, state: next });
      setEdits(e => ({ ...e, [p.id]: { ...e[p.id], ...patch } }));
      reload();
      if (kind === 'retry') {
        toast({ tone: 'success', title: 'Payout resubmitted.', body: `${p.ownerName}'s transfer is processing again.` });
      } else {
        toast({ tone: 'success', title: 'Marked as paid.', body: `${p.ownerName} — ${rm(p.amount)} recorded as transferred.` });
      }
    } catch (e) {
      toast({ tone: 'critical', title: 'Payout was not updated.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
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
          <label className="relative flex items-center">
            <span className="absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">Filter by status</span>
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as Filter)}
              className="h-9 py-0 pr-[30px] pl-3 rounded-control border border-solid border-line bg-card text-ink font-sans text-[16px] font-normal cursor-pointer appearance-none"
            >
              <option value="all">{`All statuses · ${allRows.length}`}</option>
              {GROUP_ORDER.map(s => <option key={s} value={s}>{`${PAYOUT[s].label} · ${counts[s]}`}</option>)}
            </select>
            <Icon name="ChevronDown" size="sm" color="var(--color-muted-ink)" style={{ position: 'absolute', right: 9, pointerEvents: 'none' }} />
          </label>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      {/* Failed payouts are surfaced first, with the reason and the one-tap fix. */}
      {(filter === 'all' || filter === 'failed') && failed.map(p => (
        <Card key={p.id} style={{ borderLeft: '3px solid var(--color-critical-line)' }}>
          <div className="px-5 py-[15px] flex items-center gap-4 flex-wrap">
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <div className="flex items-center gap-[9px]">
                <span className="text-[14px] font-semibold">{p.ownerName}</span>
                <Badge tone={PAYOUT.failed.tone} label={PAYOUT.failed.label} />
              </div>
              <span className="text-[12.5px] text-muted-ink text-pretty">{p.failureReason}</span>
              <span className="text-[11px] text-faint">{`${destination(p)} · ${p.method}`}</span>
            </div>
            <span className="text-[16px] font-semibold tabular-nums">{rm(p.amount)}</span>
            <button onClick={() => setConfirm({ payout: p, kind: 'retry' })} className={darkBtn}>Retry payout</button>
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
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className={`grid ${gridCols} gap-[14px] px-[22px] py-[9px] bg-muted border-b border-solid border-line text-[12px] font-semibold text-muted-ink`}>
                <div>Owner</div>
                <div>Method</div>
                <div>Destination</div>
                <div>Value date</div>
                <div className="text-right">Amount</div>
                <div>Status</div>
                <div className="text-right">Action</div>
              </div>

              {loading && allRows.length === 0 ? <TableSkeleton rows={6} cols={7} /> : groups.map(g => (
                <div key={g.state}>
                  <div className="flex items-center gap-2 px-[22px] py-[7px] bg-page border-b border-solid border-line-soft">
                    <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-muted-ink">{PAYOUT[g.state].label}</span>
                    <span className="text-[11px] text-faint">{g.items.length}</span>
                  </div>
                  {g.items.map(r => (
                    <div key={r.id} className={`grid ${gridCols} gap-[14px] items-center min-h-[52px] px-[22px] py-[9px] border-b border-solid border-line-soft`}>
                      <div className="flex flex-col gap-px min-w-0">
                        <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{r.ownerName}</span>
                        <span className="font-mono text-[11px] text-muted-ink">{r.ref ?? r.id}</span>
                      </div>
                      <div className="text-[12.5px]">{r.method}</div>
                      {/* Only ever the tail of the account number is rendered. */}
                      <div className="text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis">{destination(r)}</div>
                      <div className="text-[12.5px] text-muted-ink">{valueDate(r)}</div>
                      <div className="text-right text-[13px] font-semibold tabular-nums">{rm(r.amount)}</div>
                      <div><Badge tone={PAYOUT[r.state].tone} label={PAYOUT[r.state].label} /></div>
                      <div className="flex justify-end">
                        {r.state === 'failed' && <button onClick={() => setConfirm({ payout: r, kind: 'retry' })} className={darkBtn}>Retry payout</button>}
                        {r.state === 'processing' && <button onClick={() => setConfirm({ payout: r, kind: 'paid' })} className={ghostBtn}>Mark paid</button>}
                        {(r.state === 'pending' || r.state === 'paid') && <span className="text-[11px] text-faint">{r.state === 'paid' ? 'Settled' : 'Awaiting run'}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap px-[22px] py-[11px] border-t border-solid border-line bg-page text-[12px] text-muted-ink">
            <span>{visible.length} of {allRows.length} payouts</span>
            <span>Only the last four digits of any account are ever shown.</span>
          </div>
        </Card>
      )}

      <Dialog spec={spec} busy={false} onClose={() => setConfirm(null)} />
    </>
  );
}

// font: inherit in the originals meant these controls rendered at the inherited
// 16px / 400, not the (overridden) 12.5 / 500 — so the classes match the pixels.
const darkBtn = 'h-[34px] px-[13px] py-0 rounded-control bg-black text-white border-none font-sans text-[16px] font-normal cursor-pointer whitespace-nowrap';
const ghostBtn = 'h-[34px] px-[13px] py-0 rounded-control bg-card text-ink border border-solid border-line font-sans text-[16px] font-normal cursor-pointer whitespace-nowrap';
