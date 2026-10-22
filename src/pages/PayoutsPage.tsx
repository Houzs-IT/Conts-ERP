import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { SectionHead, PayoutBadge, payoutDestination, payoutStatus, type PayoutRow } from './owners/OwnerMoney';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { ConfirmDialog, type ConfirmSpec } from '../components/ConfirmDialog';
import { HistoryDrawer } from '../components/RecordHistory';
import { useToast } from '../components/Toast';
import { Select } from '../components/Select';
import { MoneyText, moneyString } from '../components/MoneyText';
import { TableSkeleton } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { api, errorMessage } from '../lib/api';
import { fetchAllPages } from '../lib/export';
import { runEach, skippedNote } from '../lib/bulk';
import { refreshNavCounts } from '../lib/navBadges';
import { monthLabel, plural, titleCase, count } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { PAYOUT } from '../lib/vocabulary';
import type { PayoutState } from '../lib/types';
import { useUrlState, SearchBox, FilterSelect } from './finance/listKit';
import ApprovalBanner from '../components/ApprovalBanner';
import { isStaged, stagedToast, useApprovalsOn, type Approval, type Staged } from '../lib/approvals';
import { statusLabel } from '../lib/status';
import { StatRow, StatTile } from '../components/Metric';

type Payout = PayoutRow;
interface Payload {
  data: Payout[]; generatedAt: string;
  total?: number; page?: number; pageSize?: number; counts?: Record<PayoutState, number>; outstanding?: number; periods?: string[];
}
const PAGE_SIZE = 100;
const SIZES = [50, 100, 200, 500];
/** Statements per print page: each is two A4 sheets per unit, all laid out by the browser at once. */
const PRINT_MAX = 100;

const FALLBACK: Payload = {
  generatedAt: '2026-09-20T02:00:00Z',
  data: [
    { id: 'PAY-1003-02', ownerName: 'Tan Boon Huat', amount: 209500, state: 'failed', method: 'IBG', bankName: 'RHBB', bankLast4: '5518', paidAt: null, failureReason: 'Account name does not match the registered owner. Confirm details with the owner.' },
    { id: 'PAY-1003-01', ownerName: 'Nur Aisyah', amount: 525600, state: 'pending', method: 'DuitNow', bankName: 'MBBB', bankLast4: '2275', paidAt: null, failureReason: null },
    { id: 'PAY-1003-03', ownerName: 'Ong Sok Cheng', amount: 441000, state: 'processing', method: 'IBG', bankName: 'PBBB', bankLast4: '0945', paidAt: null, failureReason: null },
    { id: 'PAY-0903-01', ownerName: 'Lim Chee Keong', amount: 648200, state: 'paid', method: 'IBG', bankName: 'MBBB', bankLast4: '4417', paidAt: '2026-09-03', failureReason: null },
  ],
};

/** Attention-first: failed rises to the top, paid settles to the bottom. */
const GROUP_ORDER: PayoutState[] = ['failed', 'pending', 'processing', 'paid'];
const RANK: Record<PayoutState, number> = { failed: 0, pending: 1, processing: 2, paid: 3 };
type Filter = 'all' | PayoutState;

const destination = payoutDestination;

/** `embedded`: shown as the Owners list's Payouts tab (owner, 11 Oct 2026), under the Owners title. */
export default function PayoutsPage({ embedded = false }: { embedded?: boolean }) {
  const url = useUrlState();
  const { user } = useSession();
  const canAct = !!user && user.role !== 'owner';
  const filter: Filter = (GROUP_ORDER as string[]).includes(url.get('state')) ? url.get('state') as PayoutState : 'all';
  const setFilter = (f: Filter) => url.set({ state: f === 'all' ? null : f, page: null });
  const period = url.get('period'), q = url.get('q');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const size = SIZES.includes(Number(url.get('size'))) ? Number(url.get('size')) : PAGE_SIZE;
  const query = new URLSearchParams({ pageSize: String(size), ...(filter !== 'all' ? { state: filter } : {}), ...(period ? { period } : {}), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  const { data, loading, error, reload } = useApi<Payload>(`/payouts?${query}`, FALLBACK);
  const runs = useApi<{ data: Approval[] }>('/approvals?entity=payouts');
  // The header and the run button speak for every payout, not for the search or month being looked at.
  const overall = useApi<Payload>('/payouts?pageSize=1');
  const toast = useToast();
  const navigate = useNavigate();

  const [confirm, setConfirm] = useState<{ payout: Payout; kind: 'retry' | 'paid' } | null>(null);
  const [bulkPaid, setBulkPaid] = useState<{ rows: Payout[]; clear: () => void } | null>(null);
  const [historyOf, setHistoryOf] = useState<Payout | null>(null);
  const historyButton = (r: Payout) => (
    <button type="button" onClick={() => setHistoryOf(r)} aria-label={`History of the payout to ${titleCase(r.ownerName)}`} title="History"
      className="w-8 h-8 flex-none grid place-items-center rounded-control border border-solid border-line bg-card text-muted-ink cursor-pointer hover:bg-muted hover:text-ink">
      <Icon name="History" size="sm" />
    </button>
  );
  const [busy, setBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  const allRows = useMemo(() => data?.data ?? [], [data]);

  // Counts and the outstanding amount come from the server, so they cover every payout, not just this page.
  const counts = useMemo(() => {
    if (data?.counts) return data.counts;
    const c: Record<PayoutState, number> = { failed: 0, pending: 0, processing: 0, paid: 0 };
    allRows.forEach(r => { c[r.state] += 1; });
    return c;
  }, [allRows, data]);
  const allCount = GROUP_ORDER.reduce((n, st) => n + counts[st], 0);

  const failed = allRows.filter(r => r.state === 'failed');
  const sum = overall.data?.counts && overall.data.outstanding !== undefined ? { counts: overall.data.counts, due: overall.data.outstanding } : null;

  // The server already answers in attention order (failed, pending, processing, paid); the sample data does not.
  const visible = useMemo(() => {
    const rows = filter === 'all' ? allRows : allRows.filter(r => r.state === filter);
    return [...rows].sort((a, b) => RANK[a.state] - RANK[b.state]);
  }, [allRows, filter]);
  const total = data?.total ?? visible.length;
  const filtered = filter !== 'all' || !!period || !!q;

  // The row changes only after the server has accepted the change.
  async function transition(p: Payout, kind: 'retry' | 'paid') {
    const next: PayoutState = kind === 'retry' ? 'processing' : 'paid';
    setBusy(true);
    try {
      await api.patch('/payouts', { id: p.id, state: next });
      setConfirm(null);
      reload(); overall.reload(); void refreshNavCounts();
      toast(kind === 'retry'
        ? { tone: 'success', title: 'Payout back to processing.', body: `${titleCase(p.ownerName)}: make the transfer at the bank, then mark it paid.` }
        : { tone: 'success', title: 'Recorded as paid.', body: `${titleCase(p.ownerName)}: ${moneyString(p.amount, 'exact')} recorded as transferred.` });
    } catch (e) {
      toast({ tone: 'critical', title: 'Payout was not updated.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  // One PATCH per payout, so each keeps its own role check, audit line and owner email.
  async function markAllPaid() {
    if (!bulkPaid) return;
    const rows = bulkPaid.rows;
    setBusy(true);
    const { ok, failed: left } = await runEach(rows, p => api.patch('/payouts', { id: p.id, state: 'paid' }), p => titleCase(p.ownerName));
    setBusy(false);
    bulkPaid.clear();
    setBulkPaid(null);
    reload(); overall.reload(); void refreshNavCounts();
    toast({
      tone: left.length ? 'warning' : 'success',
      title: ok ? `${plural(ok, 'payout')} recorded as paid.` : 'No payout was updated.',
      body: left.length ? skippedNote(left) : 'The owners were told by email and their statements moved to Paid.',
    });
  }

  /** Every payout under the status, month and search, for the table's Export. The endpoint pages at up to 500. */
  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const r = await fetchAllPages<Payout>(async (pg, sz) => {
      const p = await api.get<Payload>(`/payouts?${new URLSearchParams({ pageSize: String(sz), page: String(pg), ...(filter !== 'all' ? { state: filter } : {}), ...(period ? { period } : {}), ...(q ? { q } : {}) })}`);
      return { rows: p.data, total: p.total ?? p.data.length };
    }, { size: 500, onProgress });
    return r.rows;
  }

  /** Every matching payout's owner statement on one print page (browser Save as PDF; the server has no PDF renderer). */
  const [gathering, setGathering] = useState(false);
  async function printStatements() {
    if (gathering) return;
    setGathering(true);
    try {
      const list = await fetchAll(() => {});
      const ids = [...new Set(list.map(r => r.statementId).filter((s): s is string => !!s))];
      if (!ids.length) { toast({ tone: 'warning', title: 'No owner statements to print.', body: 'None of these payouts came from an owner statement.' }); return; }
      const missing = list.filter(r => !r.statementId).length;
      if (ids.length > PRINT_MAX || missing) {
        toast({ tone: 'warning', title: `Printing ${plural(Math.min(ids.length, PRINT_MAX), 'statement')}.`,
          body: [missing && `${plural(missing, 'payout')} had no owner statement.`, ids.length > PRINT_MAX && `Only the first ${PRINT_MAX} of ${ids.length} fit on one page. Narrow the filters to get the rest.`].filter(Boolean).join(' ') });
      }
      navigate(`/finance/statements/print?${new URLSearchParams({ ids: ids.slice(0, PRINT_MAX).join(',') })}`);
    } catch (e) {
      toast({ tone: 'critical', title: 'Statements could not be gathered.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setGathering(false); }
  }

  const columns = useMemo<Column<Payout>[]>(() => [
    { key: 'owner', label: 'Owner', value: r => titleCase(r.ownerName), hideable: false, width: 220,
      render: r => <span className="font-medium block truncate" title={r.ownerName}>{titleCase(r.ownerName)}</span>,
      sub: r => <span className="font-mono text-caption">{r.ref ?? r.id}{r.period ? ` · ${monthLabel(r.period)}` : ''}</span> },
    { key: 'ref', label: 'Reference', type: 'ref', value: r => r.ref ?? r.id, hidden: true, width: 140 },
    { key: 'period', label: 'Statement month', value: r => r.period ?? null, text: r => (r.period ? monthLabel(r.period) : ''), hidden: true, width: 130 },
    { key: 'method', label: 'Method', value: r => r.method, width: 110 },
    { key: 'destination', label: 'Destination', value: r => destination(r), width: 170 },
    { key: 'amount', label: 'Amount', type: 'money', value: r => r.amount, width: 130,
      render: r => <MoneyText sen={r.amount} mode="exact" strong className="text-copy" /> },
    { key: 'status', label: 'Status', type: 'status', value: r => r.state, entity: 'payout', text: r => payoutStatus(r), width: 170,
      render: r => <PayoutBadge p={r} /> },
    { key: 'failure', label: 'Failure reason', value: r => r.failureReason, hidden: true, width: 220 },
    { key: 'action', label: 'Action', width: 170, align: 'right', noExport: true, sortable: false, filter: false,
      render: r => (
        <span className="flex justify-end items-center gap-2" onClick={e => e.stopPropagation()}>
          {r.state === 'failed' && <Button size="sm" variant="primary" onClick={() => setConfirm({ payout: r, kind: 'retry' })}>Try again</Button>}
          {r.state === 'processing' && <Button size="sm" variant="secondary" onClick={() => setConfirm({ payout: r, kind: 'paid' })}>Mark paid</Button>}
          {r.state === 'pending' && <span className="text-caption text-muted-ink">In the next run</span>}
          {r.state === 'paid' && <span className="text-caption text-faint">Settled</span>}
          {historyButton(r)}
        </span>
      ) },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const spec: ConfirmSpec | null = bulkPaid
    ? {
        title: `Mark ${plural(bulkPaid.rows.length, 'payout')} as paid?`,
        body: 'Only once the bank confirms each transfer left the account. Each owner statement moves to Paid and each owner is told by email.',
        meta: `${moneyString(bulkPaid.rows.reduce((n, r) => n + r.amount, 0), 'exact')} in all · processing payouts only`,
        confirmLabel: 'Mark paid', busyLabel: 'Saving...',
        onConfirm: markAllPaid,
      }
    : !confirm ? null
    : confirm.kind === 'retry'
      ? {
          title: `Try ${moneyString(confirm.payout.amount, 'exact')} to ${titleCase(confirm.payout.ownerName)} again?`,
          body: 'Confirm the bank details were corrected first. This moves the payout back to Processing; it does not send money. Make the transfer at the bank, then mark it paid.',
          meta: `${destination(confirm.payout)} · ${confirm.payout.method}`,
          danger: true, confirmLabel: 'Move to processing', busyLabel: 'Saving...',
          onConfirm: () => transition(confirm.payout, 'retry'),
        }
      : {
          title: `Mark ${moneyString(confirm.payout.amount, 'exact')} to ${titleCase(confirm.payout.ownerName)} as paid?`,
          body: 'Only once the bank confirms the transfer left the account. The owner statement moves to Paid and the owner is told by email.',
          meta: `${destination(confirm.payout)} · ${confirm.payout.method}`,
          danger: true, confirmLabel: 'Mark paid', busyLabel: 'Saving...',
          onConfirm: () => transition(confirm.payout, 'paid'),
        };

  return (
    <>
      <SectionHead embedded={embedded}
        title="Owner payouts"
        sub={sum ? `${moneyString(sum.due, 'exact')} not yet paid · ${plural(sum.counts.pending, 'payout')} waiting for a run · ${sum.counts.failed} failed` : ' '}
        primary={<Button size="sm" variant="primary" icon={<Icon name="PlayCircle" size="sm" />} onClick={() => setRunOpen(true)}
          disabled={!sum || sum.counts.pending === 0} disabledReason="No owner payouts are waiting. They appear here when owner statements are sent.">Start payout run</Button>}
      />

      <StatRow cols={3}>
        <StatTile className="col-span-2 sm:col-span-1" label="Not yet paid" value={sum ? moneyString(sum.due, 'exact') : overall.loading ? undefined : '—'} hero />
        <StatTile label="Waiting for a run" value={sum ? count(sum.counts.pending) : overall.loading ? undefined : '—'} />
        <StatTile label={statusLabel('payout', 'failed')} value={sum ? count(sum.counts.failed) : overall.loading ? undefined : '—'} tone={sum?.counts.failed ? 'critical' : undefined} />
      </StatRow>

      <ApprovalBanner items={runs.data?.data ?? []} onChanged={() => { runs.reload(); reload(); overall.reload(); void refreshNavCounts(); }} />

      {/* Failed payouts are surfaced first, with the reason and the fix. */}
      {(filter === 'all' || filter === 'failed') && failed.map(p => (
        <Card key={p.id} style={{ borderColor: 'var(--color-critical-line)' }}>
          <div className="px-5 py-[15px] flex items-center gap-4 flex-wrap">
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <div className="flex items-center gap-[9px]">
                <span className="text-copy font-semibold">{titleCase(p.ownerName)}</span>
                <StatusBadge tone={PAYOUT.failed.tone} label={PAYOUT.failed.label} />
              </div>
              <span className="text-meta text-muted-ink text-pretty">{p.failureReason}</span>
              <span className="text-caption text-faint">{`${destination(p)} · ${p.method}`}</span>
            </div>
            <MoneyText sen={p.amount} mode="exact" strong className="text-heading" />
            <Button size="sm" variant="primary" onClick={() => setConfirm({ payout: p, kind: 'retry' })}>Try again</Button>
          </div>
        </Card>
      ))}

      <DataTable<Payout>
        id="payouts" columns={columns} rows={data ? visible : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload}
        server={{ total, page: data?.page ?? page, pageSize: data?.pageSize ?? size, sizes: SIZES, defaultPageSize: PAGE_SIZE, fetchAll }}
        viewParams={['state', 'period', 'q']} filtered={filtered} onClearFilters={() => url.set({ state: null, period: null, q: null, page: null })}
        noun={['payout', 'payouts']} exportName="payouts"
        extraExports={[{ icon: 'Printer', label: 'PDF statements', hint: "Opens every matching owner statement together. Download PDF there saves them as one file.", run: () => void printStatements() }]}
        empty={{ icon: 'Banknote', title: 'No owner payouts yet', body: 'An owner payout is created for each owner statement when it is sent. Send statements from the Statements tab, then start a payout run here.' }}
        selectable={canAct ? (r => r.state === 'processing') : false}
        bulkActions={canAct ? ((picked, clear) => (
          <Button size="sm" variant="primary" icon={<Icon name="CheckCircle2" size="sm" />} onClick={() => setBulkPaid({ rows: picked, clear })}>Mark paid</Button>
        )) : undefined}
        toolbar={<>
          <SearchBox className="flex-[2_1_240px]" label="Search payouts" placeholder="Search owner" value={q} onChange={v => url.set({ q: v || null, page: null })} />
          <FilterSelect className="flex-[1_1_180px]" label="Statement month" all="All statement months" value={period} onChange={v => url.set({ period: v || null, page: null })}
            options={(data?.periods ?? []).map(p => ({ value: p, label: monthLabel(p) }))} />
          <Select label="Filter by status" value={filter} onChange={v => setFilter(v as Filter)} className="flex-[1_1_180px]"
            options={[{ value: 'all', label: data ? `All statuses · ${allCount}` : 'All statuses' }, ...GROUP_ORDER.map(s => ({ value: s, label: data ? `${statusLabel('payout', s)} · ${counts[s]}` : statusLabel('payout', s) }))]} />
        </>}
        renderCard={r => (
          <span className="flex items-start gap-3 text-ink">
            <span className="flex flex-col gap-[3px] min-w-0 flex-1">
              <span className="text-copy font-medium truncate">{titleCase(r.ownerName)}</span>
              <span className="text-meta text-muted-ink truncate">{destination(r)} · {r.method}</span>
              <span className="text-meta text-muted-ink">{r.period ? `${monthLabel(r.period)} statement` : ''}</span>
              {r.state === 'processing' && <Button size="sm" variant="secondary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={e => { e.stopPropagation(); setConfirm({ payout: r, kind: 'paid' }); }}>Mark paid</Button>}
            </span>
            <span className="flex flex-col items-end gap-[5px] shrink-0">
              <MoneyText sen={r.amount} mode="exact" strong className="text-copy" />
              <PayoutBadge p={r} size="sm" />
              <span onClick={e => e.stopPropagation()}>{historyButton(r)}</span>
            </span>
          </span>
        )}
        footer={
          <div className="flex items-center justify-between gap-3 flex-wrap px-[22px] max-md:px-4 py-3 [border-top:1px_solid_var(--color-line-soft)] text-meta text-muted-ink">
            <span>{data ? `${count(total)} of ${count(allCount)} payouts` : ''}</span>
            <span>Only the last four digits of any account are shown. Nothing here sends money: transfers are made at the bank.</span>
          </div>
        }
      />

      <ConfirmDialog spec={spec} busy={busy} onClose={() => { if (!busy) { setConfirm(null); setBulkPaid(null); } }} />
      <HistoryDrawer onClose={() => setHistoryOf(null)}
        target={historyOf && { entity: 'payouts', id: historyOf.id, title: `Payout to ${titleCase(historyOf.ownerName)}`, sub: `${moneyString(historyOf.amount, 'exact')}${historyOf.period ? ` · ${monthLabel(historyOf.period)} statement` : ''}` }} />
      {runOpen && <RunDialog onClose={() => setRunOpen(false)} onDone={() => { setRunOpen(false); reload(); overall.reload(); runs.reload(); void refreshNavCounts(); }} />}
    </>
  );
}

/**
 * Start payout run: pick the pending payouts that are being transferred now. They move to In progress
 * (Processing). The bank transfer itself happens in the bank's own system; each payout is then marked
 * paid. Payouts with no bank account cannot join and say so.
 */
function RunDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, loading, error } = useApi<Payload>('/payouts?state=pending&pageSize=500');
  const rows = useMemo(() => data?.data ?? [], [data]);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const approvalsOn = useApprovalsOn();
  const can = (p: Payout) => !!p.bankLast4;
  const chosen = rows.filter(p => can(p) && !off[p.id]);
  const total = chosen.reduce((n, p) => n + p.amount, 0);

  async function start() {
    setBusy(true);
    try {
      type Started = { run: string; started: number; total: number; skipped: { id: string; reason: string }[] };
      const res = await api.post<(Staged & { run: string; queued: number; total: number; skipped: { id: string; reason: string }[] }) | Started>('/payouts/run', { payoutIds: chosen.map(p => p.id), reason: reason.trim() || undefined });
      // With approvals on, the run waits for a second person and the payouts move only when it is approved.
      if (!isStaged(res)) {
        toast(res.skipped.length
          ? { tone: 'warning', title: `${plural(res.started, 'payout')} in run ${res.run}, ${res.skipped.length} not.`, body: res.skipped[0].reason }
          : { tone: 'success', title: `Payout run ${res.run} started.`, body: `${plural(res.started, 'payout')}, ${moneyString(res.total, 'exact')}. Make the transfers at the bank, then mark each one paid.` });
        onDone();
        return;
      }
      toast(res.skipped.length
        ? { tone: 'warning', title: `Run ${res.run} sent for approval with ${plural(res.queued, 'payout')}; ${res.skipped.length} left out.`, body: res.skipped[0].reason }
        : { ...stagedToast(res), title: `Run ${res.run} sent for approval: ${plural(res.queued, 'payout')}, ${moneyString(res.total, 'exact')}.` });
      onDone();
    } catch (e) {
      toast({ tone: 'critical', title: 'The run was not started.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Start payout run"
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[560px] max-h-[88vh] flex flex-col bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden">
        <div className="px-[22px] pt-[22px] pb-3 flex flex-col gap-2">
          <h2 className="m-0 text-title font-semibold">Start payout run</h2>
          <p className="m-0 text-copy text-muted-ink text-pretty">
            {approvalsOn ? 'The run is sent for approval first: once someone else approves it, the ticked payouts move to ' : 'The ticked payouts move to '}<strong className="text-ink font-semibold">Processing</strong>. That records that you are making these transfers; it does not send money. Make each transfer in the bank's own system, then mark it paid here.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto [border-top:1px_solid_var(--color-line-soft)]">
          {loading && !data ? <TableSkeleton rows={4} cols={3} />
            : error ? <div className="p-5 text-copy text-danger">{error}</div>
            : rows.length === 0 ? <div className="p-5 text-copy text-muted-ink">No payouts are waiting.</div>
            : rows.map(p => (
              <label key={p.id} className={cx('flex items-center gap-3 px-[22px] py-[10px] [border-bottom:1px_solid_var(--color-line-soft)]', can(p) ? 'cursor-pointer' : 'cursor-not-allowed opacity-70')}>
                <input type="checkbox" disabled={!can(p) || busy} checked={can(p) && !off[p.id]} onChange={() => setOff(o => ({ ...o, [p.id]: !o[p.id] }))} className="w-4 h-4 accent-black" />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-copy font-medium truncate">{titleCase(p.ownerName)}</span>
                  <span className="text-meta text-muted-ink truncate">{can(p) ? destination(p) : 'No bank account on file. Add it on the owner profile first.'}{p.period ? ` · ${monthLabel(p.period)}` : ''}</span>
                </span>
                <MoneyText sen={p.amount} mode="exact" className="text-copy" />
              </label>
            ))}
        </div>
        {approvalsOn && <div className="px-[22px] pt-3 pb-1 [border-top:1px_solid_var(--color-line)] flex flex-col gap-[6px]">
          <label htmlFor="run-reason" className="text-meta font-medium text-muted-ink">Note for the approver (optional)</label>
          <input id="run-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="e.g. September 2026 owner payouts"
            className="block w-full box-border h-9 px-3 border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-copy" />
        </div>}
        <div className={cx('py-[14px] px-[22px] bg-page flex items-center justify-between gap-3 flex-wrap', !approvalsOn && '[border-top:1px_solid_var(--color-line)]')}>
          <span className="text-meta text-muted-ink">{plural(chosen.length, 'payout')} · <MoneyText sen={total} mode="exact" strong className="text-ink" /></span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={start} disabled={chosen.length === 0} disabledReason="Tick at least one payout with a bank account.">{approvalsOn ? 'Send run for approval' : 'Start payout run'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
