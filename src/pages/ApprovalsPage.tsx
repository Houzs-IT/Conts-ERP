import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/States';
import { MoneyText, moneyString } from '../components/MoneyText';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { DecisionDialog } from '../components/ApprovalBanner';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { STATUS_LABEL, type Approval, type ApprovalStatus, type Decision } from '../lib/approvals';
import { date, dateTime, plural } from '../lib/format';
import { useUrlState, usePhone, ListCard, Pager, SearchBox, FilterSelect, Chip, STICKY_HEAD } from './finance/listKit';

interface Payload {
  view: 'pending' | 'decided'; total: number; page: number; pageSize: number;
  counts: { pending: number; decided: number; approved: number; rejected: number; cancelled: number };
  pendingAmount: number;
  kinds: { value: string; label: string; count: number }[];
  rules: { financeAdminLimit: number; expenseThreshold: number; managementCount: number; you: 'any' | 'below_limit' | 'none' };
  data: Approval[];
}
const PAGE_SIZE = 50;
const cols = 'grid-cols-[minmax(0,0.8fr)_minmax(0,2.8fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(200px,1.1fr)]';

/** Approvals: money leaving the company waits here for a second person (functions/_lib/approvals.ts). */
export default function ApprovalsPage() {
  const url = useUrlState();
  const phone = usePhone();
  const navigate = useNavigate();
  const view = url.get('view') === 'decided' ? 'decided' : 'pending';
  const kind = url.get('kind'), q = url.get('q'), status = url.get('status'), mine = url.get('mine') === '1';
  const page = Math.max(1, Number(url.get('page')) || 1);
  const query = new URLSearchParams({ view, pageSize: String(PAGE_SIZE), ...(kind ? { kind } : {}), ...(q ? { q } : {}), ...(status && view === 'decided' ? { status } : {}), ...(mine ? { mine: '1' } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  const { data, loading, error, reload } = useApi<Payload>(`/approvals?${query}`);
  const [open, setOpen] = useState<{ a: Approval; decision: Decision } | null>(null);
  const rows = data?.data ?? [];
  const r = data?.rules;

  const sub = data
    ? `${plural(data.counts.pending, 'request')} waiting · ${moneyString(data.pendingAmount, 'exact')} · ${r?.you === 'any' ? 'You approve any amount' : r?.you === 'below_limit' ? `You approve below ${moneyString(r.financeAdminLimit, 'exact')}` : 'You can ask, not approve'}`
    : 'Money requests waiting for a second person';

  const actions = (a: Approval) => (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {a.can.approve && <Button size="sm" variant="primary" onClick={() => setOpen({ a, decision: 'approve' })}>{a.can.selfApproval ? 'Approve own' : 'Approve'}</Button>}
      {a.can.reject && <Button size="sm" variant="secondary" onClick={() => setOpen({ a, decision: 'reject' })}>Reject</Button>}
      {a.can.cancel && <Button size="sm" variant="tertiary" onClick={() => setOpen({ a, decision: 'cancel' })}>Withdraw</Button>}
      {a.status === 'pending' && !a.can.approve && !a.can.cancel && <span className="text-caption text-muted-ink text-right">{a.can.why}</span>}
      {a.status !== 'pending' && a.link && <Button size="sm" variant="tertiary" onClick={() => navigate(a.link!)}>Open record</Button>}
    </div>
  );
  const decidedLine = (a: Approval) => a.status === 'pending' ? null
    : `${STATUS_LABEL[a.status].label} by ${a.decidedBy?.name ?? 'someone'}${a.decidedAt ? `, ${dateTime(a.decidedAt)}` : ''}${a.selfApproved ? ' (self-approved, only management user)' : ''}${a.decisionNote ? ` · ${a.decisionNote}` : ''}`;

  return (
    <>
      <PageHeader title="Approvals" sub={sub} />
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <div className="flex gap-2 overflow-x-auto pb-[2px] shrink-0 [scrollbar-width:none]">
        <Chip on={view === 'pending'} onClick={() => url.set({ view: null, status: null, page: null })} count={data?.counts.pending}>Waiting</Chip>
        <Chip on={view === 'decided'} onClick={() => url.set({ view: 'decided', page: null })} count={data?.counts.decided}>Decided</Chip>
        <Chip on={mine} onClick={() => url.set({ mine: mine ? null : '1', page: null })}>Asked by me</Chip>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <SearchBox className="flex-[2_1_240px]" label="Search requests" placeholder="Search owner, booking, reason or person" value={q} onChange={v => url.set({ q: v || null, page: null })} />
        <FilterSelect className="flex-[1_1_200px]" label="Request type" all="All request types" value={kind} onChange={v => url.set({ kind: v || null, page: null })}
          options={(data?.kinds ?? []).map(k => ({ value: k.value, label: `${k.label} · ${k.count}` }))} />
        {view === 'decided' && (
          <FilterSelect className="flex-[1_1_160px]" label="Outcome" all="All outcomes" value={status} onChange={v => url.set({ status: v || null, page: null })}
            options={(['approved', 'rejected', 'cancelled'] as ApprovalStatus[]).map(s => ({ value: s, label: `${STATUS_LABEL[s].label} · ${data?.counts[s as 'approved'] ?? 0}` }))} />
        )}
      </div>
      {r && (
        <p className="m-0 shrink-0 text-meta text-muted-ink text-pretty">
          Refunds, payout runs, owner credits and charges, expenses above {moneyString(r.expenseThreshold, 'exact')} and debt write-offs wait here until someone other than the person who asked approves them.
          Finance admins approve amounts below {moneyString(r.financeAdminLimit, 'exact')}; management approves any amount.{r.managementCount === 1 ? ' With one management user, that user may approve their own request with a written reason.' : ''} Limits are in Settings.
        </p>
      )}

      {!loading && rows.length === 0 ? (
        view === 'pending' && !q && !kind && !mine
          ? <EmptyState icon="ShieldCheck" title="Nothing waiting for approval" body="When someone asks for a refund, a payout run, an owner credit or charge, a large expense or a write-off, it waits here." />
          : <EmptyState kind="filtered" title="No requests match these filters." action={{ label: 'Clear filters', onClick: () => url.set({ kind: null, q: null, status: null, mine: null, page: null }) }} />
      ) : (
        <ListCard busy={loading && !!data}>
          {phone ? (
            <div>
              {loading && !data ? <TableSkeleton rows={5} cols={2} /> : rows.map(a => (
                <div key={a.id} className="flex flex-col gap-[6px] py-3 px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-copy font-semibold">{a.kindLabel}</span>
                    <MoneyText sen={a.amount} mode="exact" strong className="text-copy" />
                  </div>
                  <span className="text-meta text-ink text-pretty">{a.summary}</span>
                  <span className="text-caption text-muted-ink text-pretty">{a.requestedBy.name}, {date(a.requestedAt)} · {a.reason}</span>
                  {decidedLine(a) && <span className="text-caption text-muted-ink text-pretty">{decidedLine(a)}</span>}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge tone={STATUS_LABEL[a.status].tone} label={STATUS_LABEL[a.status].label} size="sm" />
                    {actions(a)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div role="table" aria-label="Approval requests">
              <div role="row" className={`grid ${cols} gap-[14px] px-[22px] py-[9px] ${STICKY_HEAD}`}>
                <div>Type</div><div>Request</div><div className="text-right">Amount</div><div>Asked by</div><div>Status</div><div className="text-right">Action</div>
              </div>
              {loading && !data ? <TableSkeleton rows={6} cols={6} /> : rows.map(a => (
                <div role="row" key={a.id} className={`grid ${cols} gap-[14px] items-center min-h-[56px] px-[22px] py-[9px] [border-bottom:1px_solid_var(--color-line-soft)]`}>
                  <div className="text-copy font-medium">{a.kindLabel}</div>
                  <div className="flex flex-col gap-[2px] min-w-0">
                    <span className="text-copy text-pretty">{a.summary}</span>
                    <span className="text-caption text-muted-ink text-pretty">Reason: {a.reason}</span>
                    {decidedLine(a) && <span className="text-caption text-muted-ink text-pretty">{decidedLine(a)}</span>}
                  </div>
                  <div className="text-right"><MoneyText sen={a.amount} mode="exact" strong className="text-copy" /></div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-copy truncate">{a.requestedBy.name}</span>
                    <span className="text-caption text-muted-ink">{date(a.requestedAt)}</span>
                  </div>
                  <div><Badge tone={STATUS_LABEL[a.status].tone} label={STATUS_LABEL[a.status].label} /></div>
                  {actions(a)}
                </div>
              ))}
            </div>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? rows.length} unit="requests" onPage={p => url.set({ page: p > 1 ? p : null })} />
        </ListCard>
      )}
      {open && <DecisionDialog a={open.a} decision={open.decision} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); void refreshNavCounts(); }} />}
    </>
  );
}
