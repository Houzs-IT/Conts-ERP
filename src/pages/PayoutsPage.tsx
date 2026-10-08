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
import { rm, masked, date as fmtDate, todayMyt, monthLabel } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { PAYOUT } from '../lib/vocabulary';
import type { PayoutState } from '../lib/types';
import { useUrlState, usePhone, ListCard, Pager, SearchBox, FilterSelect, STICKY_HEAD } from './finance/listKit';

interface Payout {
  id: string; ref?: string; period?: string | null; ownerName: string; amount: number; state: PayoutState; method: string;
  bankName: string | null; bankLast4: string | null; paidAt: string | null; failureReason: string | null;
}
interface Payload {
  data: Payout[]; generatedAt: string;
  total?: number; page?: number; pageSize?: number; counts?: Record<PayoutState, number>; outstanding?: number; periods?: string[];
}
const PAGE_SIZE = 100;

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
const gridCols = 'grid-cols-[minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(92px,0.8fr)_minmax(118px,1fr)]';
const today = () => todayMyt();

/** Bank never shows more than the tail — the raw number would need an audited reveal. */
const destination = (p: Payout) => p.bankLast4 ? `${p.bankName ?? 'Bank'} ${masked(p.bankLast4)}` : (p.bankName ?? '—');
const valueDate = (p: Payout) =>
  p.state === 'paid' && p.paidAt ? fmtDate(p.paidAt)
    : p.state === 'processing' ? 'In transit'
    : p.state === 'failed' ? 'On hold'
    : 'Scheduled';

export default function PayoutsPage() {
  const url = useUrlState();
  const phone = usePhone();
  const filter: Filter = (GROUP_ORDER as string[]).includes(url.get('state')) ? url.get('state') as PayoutState : 'all';
  const setFilter = (f: Filter) => url.set({ state: f === 'all' ? null : f, page: null });
  const period = url.get('period'), q = url.get('q');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), ...(filter !== 'all' ? { state: filter } : {}), ...(period ? { period } : {}), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  const { data, loading, error, reload } = useApi<Payload>(`/payouts?${query}`, FALLBACK);
  const toast = useToast();

  const [edits, setEdits] = useState<Record<string, Partial<Payout>>>({});
  const [confirm, setConfirm] = useState<{ payout: Payout; kind: 'retry' | 'paid' } | null>(null);

  const allRows = useMemo(
    () => (data?.data ?? []).map(p => ({ ...p, ...edits[p.id] })),
    [data, edits],
  );

  // Counts and the outstanding amount come from the server, so they cover every payout, not just this page.
  const counts = useMemo(() => {
    if (data?.counts) return data.counts;
    const c: Record<PayoutState, number> = { failed: 0, pending: 0, processing: 0, paid: 0 };
    allRows.forEach(r => { c[r.state] += 1; });
    return c;
  }, [allRows, data]);
  const allCount = GROUP_ORDER.reduce((n, st) => n + counts[st], 0);

  const failed = allRows.filter(r => r.state === 'failed');
  const due = data?.outstanding ?? allRows.filter(r => r.state !== 'paid').reduce((s, r) => s + r.amount, 0);

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
        sub={`${rm(due)} outstanding · ${counts.failed} ${counts.failed === 1 ? 'payout' : 'payouts'} failed and needing attention`}
        right={
          <label className="relative flex items-center">
            <span className="absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">Filter by status</span>
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as Filter)}
              className="h-9 py-0 pr-[30px] pl-3 rounded-control border border-solid border-line bg-card text-ink font-sans text-[16px] font-normal cursor-pointer appearance-none"
            >
              <option value="all">{`All statuses · ${allCount}`}</option>
              {GROUP_ORDER.map(s => <option key={s} value={s}>{`${PAYOUT[s].label} · ${counts[s]}`}</option>)}
            </select>
            <Icon name="ChevronDown" size="sm" color="var(--color-muted-ink)" style={{ position: 'absolute', right: 9, pointerEvents: 'none' }} />
          </label>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div className="flex flex-wrap gap-2">
        <SearchBox className="flex-[2_1_240px]" label="Search payouts" placeholder="Search owner" value={q} onChange={v => url.set({ q: v || null, page: null })} />
        <FilterSelect className="flex-[1_1_180px]" label="Statement month" all="All statement months" value={period} onChange={v => url.set({ period: v || null, page: null })}
          options={(data?.periods ?? []).map(p => ({ value: p, label: monthLabel(p) }))} />
      </div>

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
          action={{ label: 'Clear filters', onClick: () => url.set({ state: null, period: null, q: null, page: null }) }}
        />
      ) : (
        <ListCard busy={loading && !!data}>
          {phone ? (
            <div>
              {visible.map(r => (
                <div key={r.id} className="flex items-start gap-3 py-[11px] px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
                  <div className="flex flex-col gap-[3px] min-w-0 flex-1">
                    <span className="text-[13.5px] font-medium truncate">{r.ownerName}</span>
                    <span className="text-[12px] text-muted-ink truncate">{destination(r)} · {r.method}</span>
                    <span className="text-[11.5px] text-muted-ink">{r.period ? `${monthLabel(r.period)} statement · ` : ''}{valueDate(r)}</span>
                    {r.state === 'processing' && <button onClick={() => setConfirm({ payout: r, kind: 'paid' })} className={cx(ghostBtn, 'self-start mt-1')}>Mark paid</button>}
                  </div>
                  <div className="flex flex-col items-end gap-[5px] shrink-0">
                    <span className="text-[13.5px] font-semibold tabular-nums">{rm(r.amount)}</span>
                    <Badge tone={PAYOUT[r.state].tone} label={PAYOUT[r.state].label} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div role="table" aria-label="Payouts">
              <div role="row" className={`grid ${gridCols} gap-[14px] px-[22px] py-[9px] ${STICKY_HEAD}`}>
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
                  <div className="flex items-center gap-2 px-[22px] py-[7px] bg-page [border-bottom:1px_solid_var(--color-line-soft)]">
                    <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-muted-ink">{PAYOUT[g.state].label}</span>
                    <span className="text-[11px] text-faint">{g.items.length}</span>
                  </div>
                  {g.items.map(r => (
                    <div role="row" key={r.id} className={`grid ${gridCols} gap-[14px] items-center min-h-[50px] px-[22px] py-[7px] [border-bottom:1px_solid_var(--color-line-soft)]`}>
                      <div className="flex flex-col gap-px min-w-0">
                        <span className="text-[13.5px] font-medium truncate" title={r.ownerName}>{r.ownerName}</span>
                        <span className="font-mono text-[11px] text-muted-ink truncate">{r.ref ?? r.id}{r.period ? ` · ${monthLabel(r.period)}` : ''}</span>
                      </div>
                      <div className="text-[12.5px]">{r.method}</div>
                      {/* Only ever the tail of the account number is rendered. */}
                      <div className="text-[12.5px] truncate" title={destination(r)}>{destination(r)}</div>
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
          )}

          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? visible.length} unit="payouts" onPage={p => url.set({ page: p > 1 ? p : null })} />
          <div className="flex items-center justify-between gap-3 flex-wrap px-[22px] py-[11px] [border-top:1px_solid_var(--color-line)] bg-page text-[12px] text-muted-ink">
            <span>{(data?.total ?? visible.length).toLocaleString('en-MY')} of {allCount.toLocaleString('en-MY')} payouts</span>
            <span>Only the last four digits of any account are ever shown.</span>
          </div>
        </ListCard>
      )}

      <Dialog spec={spec} busy={false} onClose={() => setConfirm(null)} />
    </>
  );
}

// font: inherit in the originals meant these controls rendered at the inherited
// 16px / 400, not the (overridden) 12.5 / 500 — so the classes match the pixels.
const darkBtn = 'h-[34px] px-[13px] py-0 rounded-control bg-black text-white border-none font-sans text-[16px] font-normal cursor-pointer whitespace-nowrap';
const ghostBtn = 'h-[34px] px-[13px] py-0 rounded-control bg-card text-ink border border-solid border-line font-sans text-[16px] font-normal cursor-pointer whitespace-nowrap';
