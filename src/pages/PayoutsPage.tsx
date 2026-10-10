import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { Select } from '../components/Select';
import { MoneyText, moneyString } from '../components/MoneyText';
import { TableSkeleton } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { api } from '../lib/api';
import { fetchAllPages } from '../lib/export';
import { runEach, skippedNote } from '../lib/bulk';
import { refreshNavCounts } from '../lib/navBadges';
import { masked, date as fmtDate, monthLabel, plural, titleCase } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { PAYOUT, bankName } from '../lib/vocabulary';
import type { PayoutState } from '../lib/types';
import { useUrlState, SearchBox, FilterSelect } from './finance/listKit';
import ApprovalBanner from '../components/ApprovalBanner';
import { stagedToast, type Approval, type Staged } from '../lib/approvals';

interface Payout {
  id: string; ref?: string; period?: string | null; ownerName: string; amount: number; state: PayoutState; method: string;
  bankName: string | null; bankLast4: string | null; paidAt: string | null; failureReason: string | null;
}
interface Payload {
  data: Payout[]; generatedAt: string;
  total?: number; page?: number; pageSize?: number; counts?: Record<PayoutState, number>; outstanding?: number; periods?: string[];
}
const PAGE_SIZE = 100;
const SIZES = [50, 100, 200, 500];

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

/** Bank never shows more than the tail; the raw number needs an audited reveal on the owner profile. */
const destination = (p: Payout) => p.bankLast4 ? `${bankName(p.bankName) ?? 'Bank'} ${masked(p.bankLast4)}` : (bankName(p.bankName) ?? 'No bank account');
const valueDate = (p: Payout) =>
  p.state === 'paid' && p.paidAt ? fmtDate(p.paidAt)
    : p.state === 'processing' ? 'Transfer in progress'
    : p.state === 'failed' ? 'On hold'
    : 'Not in a run yet';

export default function PayoutsPage() {
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
  const toast = useToast();

  const [confirm, setConfirm] = useState<{ payout: Payout; kind: 'retry' | 'paid' } | null>(null);
  const [bulkPaid, setBulkPaid] = useState<{ rows: Payout[]; clear: () => void } | null>(null);
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
  const due = data?.outstanding ?? allRows.filter(r => r.state !== 'paid').reduce((s, r) => s + r.amount, 0);

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
      reload(); void refreshNavCounts();
      toast(kind === 'retry'
        ? { tone: 'success', title: 'Payout back to processing.', body: `${titleCase(p.ownerName)}: make the transfer at the bank, then mark it paid.` }
        : { tone: 'success', title: 'Recorded as paid.', body: `${titleCase(p.ownerName)}: ${moneyString(p.amount, 'exact')} recorded as transferred.` });
    } catch (e) {
      toast({ tone: 'critical', title: 'Payout was not updated.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
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
    reload(); void refreshNavCounts();
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

  const columns = useMemo<Column<Payout>[]>(() => [
    { key: 'owner', label: 'Owner', value: r => titleCase(r.ownerName), hideable: false, width: 220,
      render: r => <span className="font-medium block truncate" title={r.ownerName}>{titleCase(r.ownerName)}</span>,
      sub: r => <span className="font-mono text-caption">{r.ref ?? r.id}{r.period ? ` · ${monthLabel(r.period)}` : ''}</span> },
    { key: 'ref', label: 'Reference', type: 'ref', value: r => r.ref ?? r.id, hidden: true, width: 140 },
    { key: 'period', label: 'Statement month', value: r => r.period ?? null, text: r => (r.period ? monthLabel(r.period) : ''), hidden: true, width: 130 },
    { key: 'method', label: 'Method', value: r => r.method, width: 110 },
    { key: 'destination', label: 'Destination', value: r => destination(r), width: 170 },
    { key: 'paidOn', label: 'Paid on', type: 'date', value: r => (r.state === 'paid' ? r.paidAt : null), width: 150,
      render: r => <span className="text-muted-ink whitespace-nowrap">{valueDate(r)}</span> },
    { key: 'amount', label: 'Amount', type: 'money', value: r => r.amount, width: 130,
      render: r => <MoneyText sen={r.amount} mode="exact" strong className="text-copy" /> },
    { key: 'status', label: 'Status', type: 'status', value: r => r.state, width: 120,
      status: r => ({ label: PAYOUT[r.state].label, tone: PAYOUT[r.state].tone }) },
    { key: 'failure', label: 'Failure reason', value: r => r.failureReason, hidden: true, width: 220 },
    { key: 'action', label: 'Action', width: 130, align: 'right', noExport: true, sortable: false, filter: false,
      render: r => (
        <span className="flex justify-end" onClick={e => e.stopPropagation()}>
          {r.state === 'failed' && <Button size="sm" variant="primary" onClick={() => setConfirm({ payout: r, kind: 'retry' })}>Try again</Button>}
          {r.state === 'processing' && <Button size="sm" variant="secondary" onClick={() => setConfirm({ payout: r, kind: 'paid' })}>Mark paid</Button>}
          {r.state === 'pending' && <span className="text-caption text-muted-ink">In the next run</span>}
          {r.state === 'paid' && <span className="text-caption text-faint">Settled</span>}
        </span>
      ) },
  ], []);

  const spec: DialogSpec | null = bulkPaid
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
          confirmLabel: 'Move to processing', busyLabel: 'Saving...',
          onConfirm: () => transition(confirm.payout, 'retry'),
        }
      : {
          title: `Mark ${moneyString(confirm.payout.amount, 'exact')} to ${titleCase(confirm.payout.ownerName)} as paid?`,
          body: 'Only once the bank confirms the transfer left the account. The owner statement moves to Paid and the owner is told by email.',
          meta: `${destination(confirm.payout)} · ${confirm.payout.method}`,
          confirmLabel: 'Mark paid', busyLabel: 'Saving...',
          onConfirm: () => transition(confirm.payout, 'paid'),
        };

  return (
    <>
      <PageHeader
        title="Payouts"
        sub={`${moneyString(due, 'exact')} not yet paid · ${plural(counts.pending, 'payout')} waiting for a run · ${counts.failed} failed`}
        primary={<Button size="sm" variant="primary" icon={<Icon name="PlayCircle" size="sm" />} onClick={() => setRunOpen(true)}
          disabled={counts.pending === 0} disabledReason="No payouts are waiting. Payouts appear here when statements are sent.">Start payout run</Button>}
      />

      <ApprovalBanner items={runs.data?.data ?? []} onChanged={() => { runs.reload(); reload(); void refreshNavCounts(); }} />

      {/* Failed payouts are surfaced first, with the reason and the fix. */}
      {(filter === 'all' || filter === 'failed') && failed.map(p => (
        <Card key={p.id} style={{ borderLeft: '3px solid var(--color-critical-line)' }}>
          <div className="px-5 py-[15px] flex items-center gap-4 flex-wrap">
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <div className="flex items-center gap-[9px]">
                <span className="text-copy font-semibold">{titleCase(p.ownerName)}</span>
                <Badge tone={PAYOUT.failed.tone} label={PAYOUT.failed.label} />
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
        empty={{ icon: 'Banknote', title: 'No payouts yet', body: 'A payout is created for each owner statement when it is sent. Send statements from Owner statements, then start a payout run here.' }}
        selectable={canAct ? (r => r.state === 'processing') : false}
        bulkActions={canAct ? ((picked, clear) => (
          <Button size="sm" variant="primary" icon={<Icon name="CheckCircle2" size="sm" />} onClick={() => setBulkPaid({ rows: picked, clear })}>Mark paid</Button>
        )) : undefined}
        toolbar={<>
          <SearchBox className="flex-[2_1_240px]" label="Search payouts" placeholder="Search owner" value={q} onChange={v => url.set({ q: v || null, page: null })} />
          <FilterSelect className="flex-[1_1_180px]" label="Statement month" all="All statement months" value={period} onChange={v => url.set({ period: v || null, page: null })}
            options={(data?.periods ?? []).map(p => ({ value: p, label: monthLabel(p) }))} />
          <Select label="Filter by status" value={filter} onChange={v => setFilter(v as Filter)} className="flex-[1_1_180px]"
            options={[{ value: 'all', label: `All statuses · ${allCount}` }, ...GROUP_ORDER.map(s => ({ value: s, label: `${PAYOUT[s].label} · ${counts[s]}` }))]} />
        </>}
        renderCard={r => (
          <span className="flex items-start gap-3 text-ink">
            <span className="flex flex-col gap-[3px] min-w-0 flex-1">
              <span className="text-copy font-medium truncate">{titleCase(r.ownerName)}</span>
              <span className="text-meta text-muted-ink truncate">{destination(r)} · {r.method}</span>
              <span className="text-meta text-muted-ink">{r.period ? `${monthLabel(r.period)} statement · ` : ''}{valueDate(r)}</span>
              {r.state === 'processing' && <Button size="sm" variant="secondary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={e => { e.stopPropagation(); setConfirm({ payout: r, kind: 'paid' }); }}>Mark paid</Button>}
            </span>
            <span className="flex flex-col items-end gap-[5px] shrink-0">
              <MoneyText sen={r.amount} mode="exact" strong className="text-copy" />
              <Badge tone={PAYOUT[r.state].tone} label={PAYOUT[r.state].label} size="sm" />
            </span>
          </span>
        )}
        footer={
          <div className="flex items-center justify-between gap-3 flex-wrap px-[22px] max-md:px-4 py-[11px] [border-top:1px_solid_var(--color-line)] bg-page text-meta text-muted-ink">
            <span>{total.toLocaleString('en-MY')} of {allCount.toLocaleString('en-MY')} payouts</span>
            <span>Only the last four digits of any account are shown. Nothing here sends money: transfers are made at the bank.</span>
          </div>
        }
      />

      <Dialog spec={spec} busy={busy} onClose={() => { if (!busy) { setConfirm(null); setBulkPaid(null); } }} />
      {runOpen && <RunDialog onClose={() => setRunOpen(false)} onDone={() => { setRunOpen(false); reload(); runs.reload(); void refreshNavCounts(); }} />}
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
  const can = (p: Payout) => !!p.bankLast4;
  const chosen = rows.filter(p => can(p) && !off[p.id]);
  const total = chosen.reduce((n, p) => n + p.amount, 0);

  async function start() {
    setBusy(true);
    try {
      // Money leaving: the run waits for a second person, and the payouts move only when it is approved.
      const res = await api.post<Staged & { run: string; queued: number; total: number; skipped: { id: string; reason: string }[] }>('/payouts/run', { payoutIds: chosen.map(p => p.id), reason: reason.trim() || undefined });
      toast(res.skipped.length
        ? { tone: 'warning', title: `Run ${res.run} sent for approval with ${plural(res.queued, 'payout')}; ${res.skipped.length} left out.`, body: res.skipped[0].reason }
        : { ...stagedToast(res), title: `Run ${res.run} sent for approval: ${plural(res.queued, 'payout')}, ${moneyString(res.total, 'exact')}.` });
      onDone();
    } catch (e) {
      toast({ tone: 'critical', title: 'The run was not started.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
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
            The run is sent for approval first: once someone else approves it, the ticked payouts move to <strong className="text-ink font-semibold">Processing</strong>. That records that you are making these transfers; it does not send money. Make each transfer in the bank's own system, then mark it paid here.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto [border-top:1px_solid_var(--color-line-soft)]">
          {loading && !data ? <TableSkeleton rows={4} cols={3} />
            : error ? <div className="p-5 text-copy text-[var(--color-critical-fg)]">{error}</div>
            : rows.length === 0 ? <div className="p-5 text-copy text-muted-ink">No payouts are waiting.</div>
            : rows.map(p => (
              <label key={p.id} className={cx('flex items-center gap-3 px-[22px] py-[10px] [border-bottom:1px_solid_var(--color-line-soft)]', can(p) ? 'cursor-pointer' : 'cursor-not-allowed opacity-70')}>
                <input type="checkbox" disabled={!can(p) || busy} checked={can(p) && !off[p.id]} onChange={() => setOff(o => ({ ...o, [p.id]: !o[p.id] }))} className="w-4 h-4 accent-[#151515]" />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-copy font-medium truncate">{titleCase(p.ownerName)}</span>
                  <span className="text-meta text-muted-ink truncate">{can(p) ? destination(p) : 'No bank account on file. Add it on the owner profile first.'}{p.period ? ` · ${monthLabel(p.period)}` : ''}</span>
                </span>
                <MoneyText sen={p.amount} mode="exact" className="text-copy" />
              </label>
            ))}
        </div>
        <div className="px-[22px] pt-3 pb-1 [border-top:1px_solid_var(--color-line)] flex flex-col gap-[6px]">
          <label htmlFor="run-reason" className="text-meta font-medium text-muted-ink">Note for the approver (optional)</label>
          <input id="run-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="e.g. September 2026 owner payouts"
            className="block w-full box-border h-9 px-3 border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-copy" />
        </div>
        <div className="py-[14px] px-[22px] bg-page flex items-center justify-between gap-3 flex-wrap">
          <span className="text-meta text-muted-ink">{plural(chosen.length, 'payout')} · <MoneyText sen={total} mode="exact" strong className="text-ink" /></span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={start} disabled={chosen.length === 0} disabledReason="Tick at least one payout with a bank account.">Send run for approval</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
