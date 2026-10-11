import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { MoneyText, moneyString } from '../components/MoneyText';
import { DataTable, type Column } from '../components/DataTable';
import { api } from '../lib/api';
import { fetchAllPages } from '../lib/export';
import { DecisionDialog } from '../components/ApprovalBanner';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { statusLabel } from '../lib/status';
import { type Approval, type ApprovalStatus, type Decision } from '../lib/approvals';
import { date, dateTime, plural } from '../lib/format';
import { useUrlState, SearchBox, FilterSelect, Chip } from './finance/listKit';

interface Payload {
  view: 'pending' | 'decided'; total: number; page: number; pageSize: number;
  counts: { pending: number; decided: number; approved: number; rejected: number; cancelled: number };
  pendingAmount: number;
  kinds: { value: string; label: string; count: number }[];
  rules: { enabled: boolean; financeAdminLimit: number; expenseThreshold: number; managementCount: number; you: 'any' | 'below_limit' | 'none' };
  data: Approval[];
}
const PAGE_SIZE = 50;

/** Approvals: money leaving the company waits here for a second person (functions/_lib/approvals.ts). Switched off
 *  by default (owner, 11 Oct 2026): the menu hides the page, and here a note says so while any request left from
 *  before stays listed so it can be withdrawn. */
export default function ApprovalsPage() {
  const url = useUrlState();
  const navigate = useNavigate();
  const view = url.get('view') === 'decided' ? 'decided' : 'pending';
  const kind = url.get('kind'), q = url.get('q'), status = url.get('status'), mine = url.get('mine') === '1';
  const page = Math.max(1, Number(url.get('page')) || 1);
  const size = [25, 50, 100, 200].includes(Number(url.get('size'))) ? Number(url.get('size')) : PAGE_SIZE;
  const query = new URLSearchParams({ view, pageSize: String(size), ...(kind ? { kind } : {}), ...(q ? { q } : {}), ...(status && view === 'decided' ? { status } : {}), ...(mine ? { mine: '1' } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  const { data, loading, error, reload } = useApi<Payload>(`/approvals?${query}`);
  const [open, setOpen] = useState<{ a: Approval; decision: Decision } | null>(null);
  const rows = data?.data ?? [];
  const r = data?.rules;

  const off = !!r && !r.enabled;
  const sub = off ? 'Switched off: money actions happen at once' : data
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
  const filtered = !!(q || kind || mine || status) || view === 'decided';
  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const base = Object.fromEntries([...query.entries()].filter(([k]) => k !== 'page' && k !== 'pageSize'));
    return (await fetchAllPages<Approval>(async (p, n) => {
      const r = await api.get<Payload>('/approvals', { ...base, page: p, pageSize: n });
      return { rows: r.data, total: r.total };
    }, { size: 200, onProgress })).rows;
  }
  const decidedLine = (a: Approval) => a.status === 'pending' ? null
    : `${statusLabel('approval', a.status)} by ${a.decidedBy?.name ?? 'someone'}${a.decidedAt ? `, ${dateTime(a.decidedAt)}` : ''}${a.selfApproved ? ' (self-approved, only management user)' : ''}${a.decisionNote ? ` · ${a.decisionNote}` : ''}`;

  const columns = useMemo<Column<Approval>[]>(() => [
    { key: 'type', label: 'Type', value: a => a.kindLabel, width: 140, hideable: false,
      render: a => <span className="font-medium">{a.kindLabel}</span> },
    { key: 'request', label: 'Request', value: a => a.summary, text: a => `${a.summary} ${a.reason}`, exportValue: a => a.summary, width: 320,
      render: a => (
        <span className="flex flex-col gap-[2px] min-w-0">
          <span className="text-copy text-pretty whitespace-normal">{a.summary}</span>
          <span className="text-caption text-muted-ink text-pretty whitespace-normal">Reason: {a.reason}</span>
          {decidedLine(a) && <span className="text-caption text-muted-ink text-pretty whitespace-normal">{decidedLine(a)}</span>}
        </span>
      ) },
    { key: 'reason', label: 'Reason', value: a => a.reason, hidden: true, width: 220 },
    { key: 'amount', label: 'Amount', type: 'money', value: a => a.amount, width: 130,
      render: a => <MoneyText sen={a.amount} mode="exact" strong className="text-copy" /> },
    { key: 'asked', label: 'Asked by', value: a => a.requestedBy.name, width: 150, sub: a => date(a.requestedAt) },
    { key: 'askedOn', label: 'Asked on', type: 'datetime', value: a => a.requestedAt, hidden: true },
    { key: 'status', label: 'Status', type: 'status', value: a => a.status, entity: 'approval', width: 120 },
    { key: 'decided', label: 'Decision', value: a => decidedLine(a), hidden: true, width: 240 },
    { key: 'action', label: 'Action', align: 'right', noExport: true, sortable: false, filter: false, width: 220, render: a => actions(a) },
  ], [view]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Approvals" sub={sub} />

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
            options={(['approved', 'rejected', 'cancelled'] as ApprovalStatus[]).map(s => ({ value: s, label: data ? `${statusLabel('approval', s)} · ${data.counts[s as 'approved'] ?? 0}` : statusLabel('approval', s) }))} />
        )}
      </div>
      {off && (
        <div role="status" className="shrink-0 rounded-card border border-solid border-line bg-card px-[14px] py-[11px] flex flex-col gap-[2px]">
          <span className="text-copy font-semibold text-ink">Approvals are switched off</span>
          <span className="text-meta text-muted-ink text-pretty">
            Refunds, payout runs, owner credits and charges, expenses and debt write-offs happen at once, without a second person. Management can turn approvals back on in Settings.
            {data!.counts.pending > 0 ? ` ${plural(data!.counts.pending, 'request')} left from before can only be withdrawn.` : ''}
          </span>
        </div>
      )}
      {r && !off && (
        <p className="m-0 shrink-0 text-meta text-muted-ink text-pretty">
          Refunds, payout runs, owner credits and charges, expenses above {moneyString(r.expenseThreshold, 'exact')} and debt write-offs wait here until someone other than the person who asked approves them.
          Finance admins approve amounts below {moneyString(r.financeAdminLimit, 'exact')}; management approves any amount.{r.managementCount === 1 ? ' With one management user, that user may approve their own request with a written reason.' : ''} Limits are in Settings.
        </p>
      )}

      <DataTable<Approval> id="approvals" columns={columns} rows={data ? rows : null} rowKey={a => a.id}
        loading={loading} error={error} onRetry={reload} noun={['request', 'requests']} exportName="approvals"
        server={{ total: data?.total ?? rows.length, page: data?.page ?? page, pageSize: data?.pageSize ?? size, sizes: [25, 50, 100, 200], defaultPageSize: PAGE_SIZE, fetchAll }}
        viewParams={['view', 'kind', 'q', 'status', 'mine']} filtered={filtered} onClearFilters={() => url.set({ view: null, kind: null, q: null, status: null, mine: null, page: null })}
        empty={off ? { title: 'Nothing waiting for approval', body: 'Approvals are switched off, so nothing waits here.', icon: 'ShieldCheck' } : { title: 'Nothing waiting for approval', body: 'When someone asks for a refund, a payout run, an owner credit or charge, a large expense or a write-off, it waits here.', icon: 'ShieldCheck' }}
        renderCard={a => (
          <span className="flex flex-col gap-[6px]">
            <span className="flex items-start justify-between gap-3">
              <span className="text-copy font-semibold">{a.kindLabel}</span>
              <MoneyText sen={a.amount} mode="exact" strong className="text-copy" />
            </span>
            <span className="text-meta text-ink text-pretty">{a.summary}</span>
            <span className="text-caption text-muted-ink text-pretty">{a.requestedBy.name}, {date(a.requestedAt)} · {a.reason}</span>
            {decidedLine(a) && <span className="text-caption text-muted-ink text-pretty">{decidedLine(a)}</span>}
            <span className="flex items-center justify-between gap-2 flex-wrap">
              <StatusBadge entity="approval" value={a.status} size="sm" />
              {actions(a)}
            </span>
          </span>
        )} />
      {open && <DecisionDialog a={open.a} decision={open.decision} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); void refreshNavCounts(); }} />}
    </>
  );
}
