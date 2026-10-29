import { maySee, mayWork } from '../lib/areaAccess';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { DateField, DateTimeField, MoneyInput } from '../components/inputs';
import Icon from '../components/Icon';
import { Select, SearchSelect, type SelectOption } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { Skeleton } from '../components/States';
import { AttachmentLabel, MediaGallery, FileList, FileDropRow } from '../components/Attachments';
import { DataTable, type Column } from '../components/DataTable';
import SplitPane from '../components/SplitPane';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';
import { useUnitRoster, type RosterUnit } from '../lib/useUnitRoster';
import { cx } from '../lib/design-tokens';
import { rm, plural, dateShort, date, monthLabel } from '../lib/format';
import { runEach, skippedNote } from '../lib/bulk';
import {
  PillTabs, Segmented, OpsModal, FormRow, INPUT, CloseButton, uploadTo, CATEGORY, stamp, hm, mytDay, type MediaItem, MaintenanceJobForm, AssigneePicker, useTechnicians, KIND_WORD } from '../components/ops/OpsUi';
import type { AnyTone } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';
import { CatalogPanel, ExchangeModal, type Sku, type SkuPayload, type CatalogInput } from './MaintenanceCatalog';
import { ServicePrices } from './ServicePrices';
import { JobMoneyPanel, JobProfitView } from '../components/ops/JobMoney';
import { HistoryDisclosure, PhoneHistory, RecordHistory } from '../components/RecordHistory';

/* ---------- the API's shape (functions/api/maintenance/issues.ts) ---------- */

interface Overlap { reservationId: string; guestName: string; checkIn: string; checkOut: string; checkInTime: string; checkOutTime: string }
interface RepairWin { id: string; startsAt: string; endsAt: string; note: string | null; overlaps: Overlap[] }
type ChargeTo = 'owner' | 'the_conts' | 'guest_deposit' | 'warranty';
interface Issue {
  id: string; unitId: string; unitNumber: string; propertyName: string; buildingId: string; title: string; detail: string | null; state: string;
  category: string; urgency: 'normal' | 'urgent'; source: string; sourceTaskId: string | null;
  vendorName: string | null; assigneeKind: 'in_house' | 'contractor' | null; reportedAt: string; resolvedAt: string | null;
  blocksUnit: boolean; ownerApprovalRequired: boolean; ownerApprovedAt: string | null; chargeTo: ChargeTo; reporter: string | null;
  startedAt: string | null; endedAt: string | null; photoCount: number; documentCount: number; windows: RepairWin[];
  quotedAmount: number | null; finalAmount: number | null; expensed: number | null; expensedOn: string | null; skuId: string | null; skuName: string | null; skuCode: string | null;
  ownerHasLogin: boolean; billingDate: string | null; collectedAt: string | null; contractorAmount: number | null; contractorPaidAt: string | null; staffPurchasesSen?: number | null;
  /** Migration 0126: job type, severity, parts and due date; approvalStatus is Needs owner approval / Approved / Not needed. */
  jobType?: JobType; severity?: 'minor' | 'major'; dueOn?: string | null; needsParts?: boolean; partsArrivedAt?: string | null;
  approvalStatus?: 'needed' | 'approved' | 'not_needed';
}
type JobType = 'urgent' | 'pass_key' | 'normal';
const JOB_TYPE: Record<JobType, string> = { urgent: 'Urgent', pass_key: 'Pass key', normal: 'Normal' };
const JOB_ORDER: Record<JobType, number> = { urgent: 0, pass_key: 1, normal: 2 };
const APPROVAL: Record<string, { label: string; tone: AnyTone }> = {
  needed: { label: 'Needs owner approval', tone: 'warning' }, approved: { label: 'Approved', tone: 'success' }, not_needed: { label: 'Not needed', tone: 'neutral' },
};
const typeOf = (i: Issue): JobType => i.jobType ?? (i.urgency === 'urgent' ? 'urgent' : 'normal');
/** Approved, but the parts it waits for have not come: still hidden from the technicians. */
const waitingParts = (i: Issue) => i.state !== 'resolved' && i.approvalStatus === 'approved' && !!i.needsParts && !i.partsArrivedAt;
/** `billing` is false until migration 0108 is applied; billing date, collected and contractor payment are then hidden. */
interface Payload { billing?: boolean; jobTypes?: boolean; data: Issue[] }
interface FileItem extends MediaItem { stage: 'before' | 'after' | null; uploadedAt: string; byteSize?: number }

type Tab = 'open' | 'approval' | 'done' | 'history' | 'catalog' | 'rules' | 'profit';
const PAYER: Record<ChargeTo, string> = { owner: 'Owner (on the statement)', the_conts: 'Company', guest_deposit: 'Guest (from the deposit)', warranty: 'Warranty' };
const PAYER_SHORT: Record<ChargeTo, string> = { owner: 'owner pays', the_conts: 'company pays', guest_deposit: 'guest pays', warranty: 'warranty' };
const SOURCE: Record<string, string> = { guest: 'Guest', cleaner: 'Cleaner', inspection: 'Inspection', staff: 'Office' };
// The item catalog: staff pick an item (or Other) on a job; management and operations keep the list (request M3).
const SHOW_CATALOG = true;
const DOC_KIND: Record<string, string> = { claim: 'Claim from the technician or contractor', invoice: 'Invoice to the payer', receipt: 'Receipt', pod: 'Proof of work', other: 'File' };
/** Who the money is collected from; the company and a warranty pay their own share, so nothing is collected. */
const COLLECT_FROM: Partial<Record<ChargeTo, string>> = { owner: 'the owner', guest_deposit: "the guest's deposit" };
const FIELD_ROLES = ['housekeeper', 'technician'];

const awaitingOwner = (i: Issue) => i.state !== 'resolved' && i.ownerApprovalRequired && !i.ownerApprovedAt && i.chargeTo === 'owner';
function statusOf(i: Issue): { label: string; tone: AnyTone } {
  if (i.state === 'resolved') return { label: i.finalAmount ? `Done · ${PAYER_SHORT[i.chargeTo]}` : 'Done', tone: 'success' };
  if (awaitingOwner(i)) return { label: 'Awaiting owner approval', tone: 'warning' };
  if (waitingParts(i)) return { label: 'Waiting for parts', tone: 'warning' };
  if (i.state === 'in_progress' || i.startedAt) return { label: i.endedAt ? 'Repair finished' : 'In progress', tone: 'info' };
  if (i.vendorName) return { label: 'Assigned', tone: 'neutral' };
  return { label: 'New', tone: 'neutral' };
}

export default function MaintenancePage() {
  const toast = useToast();
  const { user } = useSession();
  const money = maySee(user, 'finance');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('open');
  const [category, setCategory] = useState('');
  const [building, setBuilding] = useState('');
  const [q, setQ] = useState('');
  const selected = params.get('id');
  const setSelected = (id: string | null) => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('id', id); else n.delete('id'); return n; }, { replace: true });
  const [creating, setCreating] = useState(false);

  const { data, loading, error, reload: reloadData } = useApi<Payload>('/maintenance/issues');
  // The side menu's counts (open jobs, today's work) follow what was just done here.
  const reload = () => { reloadData(); void refreshNavCounts(); };
  const issues = data?.data ?? [];
  const sku = useApi<SkuPayload>(tab === 'catalog' || selected ? '/maintenance/skus' : null);

  // A link from a clean (?id=) opens the right tab.
  useEffect(() => {
    const it = issues.find(i => i.id === selected);
    if (it && tab !== 'history' && tab !== 'catalog' && tab !== 'rules' && tab !== 'profit') setTab(it.state === 'resolved' ? 'done' : awaitingOwner(it) ? 'approval' : 'open');
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthStart = mytDay(0).slice(0, 7);
  const open = issues.filter(i => i.state !== 'resolved');
  const approval = open.filter(awaitingOwner);
  const recentDone = issues.filter(i => i.state === 'resolved' && i.resolvedAt && Date.parse(i.resolvedAt) > Date.now() - 30 * 864e5);
  // The header counts what the tabs count: a job waiting for its owner sits under that tab, not under Open.
  const openTab = open.filter(i => !awaitingOwner(i));
  const urgent = openTab.filter(i => typeOf(i) === 'urgent').length;
  const monthCost = issues.filter(i => i.state === 'resolved' && (i.resolvedAt ?? '').slice(0, 7) === monthStart).reduce((s, i) => s + (i.finalAmount ?? 0), 0);

  const base = tab === 'open' ? openTab : tab === 'approval' ? approval : tab === 'done' ? recentDone : issues;
  const ql = q.trim().toLowerCase();
  const rows = base.filter(i => (!category || i.category === category) && (!building || i.buildingId === building)
    && (!ql || `${i.unitNumber} ${i.propertyName} ${i.title} ${i.vendorName ?? ''}`.toLowerCase().includes(ql)))
    // Open jobs in the order they are worked: Urgent, Pass key, then Normal one by one by due date (the day reported when none).
    .sort((a, b) => tab === 'open'
      ? JOB_ORDER[typeOf(a)] - JOB_ORDER[typeOf(b)] || (a.dueOn ?? a.reportedAt.slice(0, 10)).localeCompare(b.dueOn ?? b.reportedAt.slice(0, 10)) || a.reportedAt.localeCompare(b.reportedAt)
      : b.reportedAt.localeCompare(a.reportedAt));
  // Every building with units, not only those with a job loaded (request M1): a filter that lists a building with no
  // jobs simply shows none.
  const roster = useUnitRoster();
  const buildingOptions: SelectOption[] = useMemo(() => {
    const m = new Map<string, string>([...roster.filter(u => u.propertyId).map(u => [u.propertyId!, u.propertyName] as [string, string]), ...issues.map(i => [i.buildingId, i.propertyName] as [string, string])]);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'en', { numeric: true })).map(([value, label]) => ({ value, label }));
  }, [issues, roster]);
  const sel = issues.find(i => i.id === selected) ?? null;
  const historySpend = tab === 'history' ? rows.reduce((s, i) => s + (i.finalAmount ?? 0), 0) : 0;

  const sub = data
    ? `${openTab.length} open · ${urgent} urgent · ${approval.length} awaiting owner approval${money ? ` · this month ${rm(monthCost, { cents: false })}` : ''}`
    : 'Maintenance jobs on every unit';

  async function createSku(input: CatalogInput) {
    try { await api.post('/maintenance/skus', input); toast({ tone: 'success', title: 'Item added.' }); sku.reload(); return null; }
    catch (e) { return errorMessage(e, 'Not saved. Try again.'); }
  }
  async function updateSku(id: string, delta: Partial<Sku>) {
    try { await api.patch(`/maintenance/skus/${id}`, delta); toast({ tone: 'success', title: 'Catalog updated.' }); sku.reload(); return null; }
    catch (e) { const msg = errorMessage(e, 'Not saved. Try again.'); toast({ tone: 'critical', title: 'Not saved.', body: msg }); return msg; }
  }

  const list = (
    <>
      {error && data && <StaleBanner message={`Showing the last jobs we have. ${error}`} onRetry={reload} />}
      <IssueTable tab={tab} rows={data ? rows : null} loading={loading} error={data ? null : error} onRetry={reload} selected={selected} onSelect={setSelected}
        money={money} canBulk={!FIELD_ROLES.includes(user!.role)} onChanged={reload}
        filtered={!!(category || building || q)} onClearFilters={() => { setCategory(''); setBuilding(''); setQ(''); }}
        above={tab === 'history' && rows.length > 0 && money ? (
          <div className="text-copy text-muted-ink py-2 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)]">{rows.length} {rows.length === 1 ? 'job' : 'jobs'} · {rm(historySpend)} spent{q ? ` matching "${q}"` : ''}</div>
        ) : undefined}
        empty={{ title: tab === 'approval' ? 'Nothing is waiting for an owner.' : tab === 'done' ? 'No job finished in the last 30 days.' : tab === 'history' ? 'No jobs yet.' : 'No open maintenance jobs.',
          action: tab === 'open' ? { label: 'Add maintenance job', onClick: () => setCreating(true) } : undefined }} />
    </>
  );

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <PageHeader title="Maintenance" sub={sub}
        actions={<>
          <Button size="sm" variant="secondary" icon={<Icon name="Users" size="sm" />} onClick={() => navigate('/hr/employees?tab=employee-master')}>Technicians</Button>
          {data?.jobTypes && <Button size="sm" variant={tab === 'rules' ? 'primary' : 'secondary'} icon={<Icon name="ShieldCheck" size="sm" />} onClick={() => setTab(tab === 'rules' ? 'open' : 'rules')}>Approval rules</Button>}
          {money && <Button size="sm" variant={tab === 'profit' ? 'primary' : 'secondary'} icon={<Icon name="TrendingUp" size="sm" />} onClick={() => setTab(tab === 'profit' ? 'open' : 'profit')}>Profit by job</Button>}
          {SHOW_CATALOG && <Button size="sm" variant={tab === 'catalog' ? 'primary' : 'secondary'} icon={<Icon name="Package" size="sm" />} onClick={() => setTab(tab === 'catalog' ? 'open' : 'catalog')}>Item catalog</Button>}
        </>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>Add maintenance job</Button>} />

      {tab === 'rules' ? <ApprovalRulesPanel /> : tab === 'profit' ? <div className="flex-1 min-h-0 overflow-y-auto"><JobProfitView kind="maintenance" onOpen={id => { setTab('history'); setSelected(id); }} /></div> : tab === 'catalog' ? (
        <MaintenanceItems fallback={<CatalogPanel skus={sku.data?.data ?? []} loading={sku.loading} canWrite={mayWork(user, 'operations')} onCreate={createSku} onUpdate={updateSku} />} onChanged={sku.reload} />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <PillTabs value={tab} onChange={t => { setTab(t); setSelected(null); }} tabs={[
              { value: 'open', label: 'Open', count: data ? openTab.length : undefined },
              { value: 'approval', label: 'Awaiting owner approval', count: data ? approval.length : undefined },
              { value: 'done', label: 'Done' },
              { value: 'history', label: 'History' },
            ]} />
            <div className="flex gap-2 flex-wrap md:ml-auto max-md:w-full">
              {tab === 'history' && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit or problem" aria-label="Search" className={cx(INPUT, 'h-9 w-[200px] max-md:w-full')} />}
              <Select label="Category" value={category} onChange={setCategory} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} placeholder="All categories" className="w-[150px] max-md:flex-1" />
              <Select label="Building" value={building} onChange={setBuilding} options={buildingOptions} placeholder="All buildings" className="w-[170px] max-md:flex-1" />
            </div>
          </div>
          <SplitPane list={list} open={!!sel} onClose={() => setSelected(null)} width={580}
            detail={sel ? <IssueDetail key={sel.id} issue={sel} billing={!!data!.billing} money={money} skus={sku.data?.data ?? []} onClose={() => setSelected(null)} onChanged={reload} /> : null} />
        </>
      )}

      {creating && <NewJobModal units={roster} onClose={() => setCreating(false)} onDone={id => { setCreating(false); reload(); setTab('open'); setSelected(id); }} />}
    </div>
  );
}

/* ---------- the list ---------- */

const jobLabel = (i: Issue) => `${i.propertyName} ${i.unitNumber}`;
// Some rows are in progress without a start time (set before Start repair recorded one), so the state counts too.
const started = (i: Issue) => !!i.startedAt || i.state === 'in_progress';
type Move = 'start' | 'end' | 'reopen';
/** Why a ticked job is left alone by a move, or null when the move applies. */
function moveSkip(i: Issue, move: Move): string | null {
  if (move === 'reopen') return i.state === 'resolved' ? null : 'Not finished';
  if (i.state === 'resolved') return 'Already finished';
  if (move === 'start') return started(i) ? 'Already started' : awaitingOwner(i) ? "Waiting for the owner's approval" : null;
  return !i.startedAt ? 'Not started' : i.endedAt ? 'Repair already finished' : null;
}
const collectedText = (i: Issue) => (i.collectedAt ? `Collected ${dateShort(i.collectedAt)}` : COLLECT_FROM[i.chargeTo] && (i.finalAmount ?? i.quotedAmount) ? 'Not yet' : '');
const paidText = (i: Issue) => (i.contractorPaidAt ? `Paid ${dateShort(i.contractorPaidAt)}` : i.contractorAmount != null ? 'Not yet' : '');
const MOVE_DONE: Record<Move, string> = { start: 'started', end: 'marked repair finished', reopen: 'reopened' };

function IssueTable({ tab, rows, loading, error, onRetry, selected, onSelect, money, canBulk, onChanged, filtered, onClearFilters, empty, above }: {
  tab: Tab; rows: Issue[] | null; loading: boolean; error: string | null; onRetry: () => void; selected: string | null; onSelect: (id: string) => void;
  money: boolean; canBulk: boolean; onChanged: () => void; filtered: boolean; onClearFilters: () => void;
  empty: { title: string; action?: { label: string; onClick: () => void } }; above?: ReactNode;
}) {
  const toast = useToast();
  const [assigning, setAssigning] = useState<{ rows: Issue[]; clear: () => void } | null>(null);
  const [busy, setBusy] = useState<Move | null>(null);

  async function bulkMove(picked: Issue[], move: Move, clear: () => void) {
    const todo = picked.filter(i => !moveSkip(i, move));
    const left = picked.filter(i => moveSkip(i, move)).map(i => ({ label: jobLabel(i), reason: moveSkip(i, move)! }));
    setBusy(move);
    const res = await runEach(todo, i => (move === 'start' ? api.post(`/maintenance/issues/${i.id}/start`, {})
      : move === 'end' ? api.post(`/maintenance/issues/${i.id}/end`, {})
      : api.patch(`/maintenance/issues/${i.id}`, { state: 'reopened' })), jobLabel);
    setBusy(null);
    const failed = [...res.failed, ...left];
    toast({
      tone: res.ok === 0 ? 'critical' : failed.length ? 'warning' : 'success',
      title: res.ok ? `${plural(res.ok, 'job')} ${MOVE_DONE[move]}.` : 'No job changed.',
      body: skippedNote(failed) || undefined,
    });
    clear(); onChanged();
  }

  const columns = useMemo<Column<Issue>[]>(() => [
    { key: 'unit', label: 'Unit', value: i => i.unitNumber, text: i => `${i.unitNumber} ${i.propertyName}`, sub: i => i.propertyName, hideable: false, width: 120,
      render: i => <b className="text-ink">{i.unitNumber}</b> },
    { key: 'issue', label: 'Problem', value: i => i.title, width: 240,
      sub: i => <>From {SOURCE[i.source] ?? i.source}{i.reporter ? ` (${i.reporter})` : ''} · {stamp(i.reportedAt)}{i.windows.length > 0 && ` · window ${stamp(i.windows[0].startsAt)}`}{i.blocksUnit && ' · unit blocked'}</>,
      render: i => <span className="block whitespace-normal text-ink">{i.title}</span> },
    { key: 'category', label: 'Category', value: i => i.category, text: i => CATEGORY[i.category] ?? i.category, width: 120, filter: false, hidden: true },
    { key: 'urgency', label: 'Type', type: 'status', value: i => typeOf(i),
      status: i => ({ label: JOB_TYPE[typeOf(i)], tone: typeOf(i) === 'urgent' ? 'critical' : typeOf(i) === 'pass_key' ? 'info' : 'neutral' }), width: 110, phone: 'meta' },
    { key: 'status', label: 'Status', type: 'status', value: i => statusOf(i).label, status: i => { const s = statusOf(i); return { label: s.label, tone: s.tone === 'gold' ? 'neutral' : s.tone }; }, width: 160 },
    { key: 'assignee', label: 'Assigned to', value: i => i.vendorName, text: i => (i.vendorName ? `${i.vendorName} ${i.assigneeKind === 'in_house' ? '(in-house)' : '(contractor)'}` : 'Unassigned'), width: 160,
      render: i => (i.vendorName
        ? <span className="block truncate">{i.vendorName}<span className="text-muted-ink"> {i.assigneeKind === 'in_house' ? '(in-house)' : '(contractor)'}</span></span>
        : <span className="text-danger">Unassigned</span>) },
    { key: 'due', label: 'Due', type: 'date', value: i => i.dueOn ?? null, width: 110, hidden: true },
    { key: 'approval', label: 'Owner approval', type: 'status', value: i => i.approvalStatus ?? 'not_needed',
      status: i => { const a = APPROVAL[i.approvalStatus ?? 'not_needed']; return { label: a.label, tone: a.tone === 'gold' ? 'neutral' : a.tone }; }, width: 150 },
    ...(money ? [{ key: 'cost', label: 'Cost', type: 'money' as const, value: (i: Issue) => i.finalAmount ?? i.quotedAmount, width: 110, title: 'The final cost, or the quote while the job is open.',
      render: (i: Issue) => { const c = i.finalAmount ?? i.quotedAmount; return c == null ? <span className="text-faint">—</span> : <span className="tabular-nums whitespace-nowrap">{rm(c, { cents: false })}{i.finalAmount == null && <span className="text-muted-ink text-meta"> quote</span>}</span>; } }] : []),
    ...(money ? [
      { key: 'billing', label: 'Billing date', type: 'date' as const, value: (i: Issue) => i.billingDate, hidden: true, width: 130 },
      { key: 'collected', label: 'Collected', value: (i: Issue) => i.collectedAt, hidden: true, width: 130, title: 'When the money from the payer came in.',
        text: collectedText, render: (i: Issue) => <span className={i.collectedAt ? 'text-ink' : 'text-warning'}>{collectedText(i)}</span> },
      { key: 'owed', label: 'Owed to technician', type: 'money' as const, value: (i: Issue) => i.contractorAmount, hidden: true, width: 150 },
      { key: 'paid', label: 'Technician paid', value: (i: Issue) => i.contractorPaidAt, hidden: true, width: 140,
        text: paidText, render: (i: Issue) => <span className={i.contractorPaidAt ? 'text-ink' : 'text-warning'}>{paidText(i)}</span> },
    ] : []),
    { key: 'reported', label: 'Reported', type: 'datetime', value: i => i.reportedAt, hidden: true, width: 150 },
    { key: 'resolved', label: 'Finished', type: 'datetime', value: i => i.resolvedAt, hidden: true, width: 150 },
  ], [money]);

  return (
    <>
      <DataTable<Issue>
        id="maintenance.jobs" columns={columns} rows={rows} rowKey={i => i.id} loading={loading} error={error} onRetry={onRetry}
        renderCard={i => <JobCard i={i} money={money} />}
        onRowClick={i => onSelect(i.id)} rowTone={i => (i.id === selected ? 'gold' : i.state === 'resolved' ? 'muted' : null)}
        noun={['job', 'jobs']} exportName="maintenance-jobs" selectionKey={tab} above={above}
        filtered={filtered} onClearFilters={onClearFilters}
        empty={{ title: empty.title, icon: 'Wrench', action: empty.action }}
        selectable={canBulk}
        bulkActions={(picked, clear) => {
          const can = (m: Move) => picked.some(i => !moveSkip(i, m));
          return <>
            <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setAssigning({ rows: picked, clear })}>Assign</Button>
            {can('start') && <Button size="sm" variant="secondary" icon={<Icon name="Play" size="sm" />} loading={busy === 'start'} onClick={() => void bulkMove(picked, 'start', clear)}>Start repair</Button>}
            {can('end') && <Button size="sm" variant="secondary" icon={<Icon name="Flag" size="sm" />} loading={busy === 'end'} onClick={() => void bulkMove(picked, 'end', clear)}>Repair finished</Button>}
            {money && can('reopen') && <Button size="sm" variant="secondary" icon={<Icon name="RotateCcw" size="sm" />} loading={busy === 'reopen'} onClick={() => void bulkMove(picked, 'reopen', clear)}>Reopen</Button>}
          </>;
        }}
      />
      {assigning && <BulkAssignModal rows={assigning.rows} onClose={() => setAssigning(null)}
        onDone={() => { assigning.clear(); setAssigning(null); onChanged(); }} />}
    </>
  );
}

/** The phone row: unit and cost, the problem, category and who has it, then urgency and status. */
function JobCard({ i, money }: { i: Issue; money: boolean }) {
  const s = statusOf(i);
  const cost = i.finalAmount ?? i.quotedAmount;
  return (
    <span className="flex flex-col gap-1 min-w-0">
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate"><b className="text-copy text-ink">{i.unitNumber}</b><span className="text-meta text-muted-ink"> · {i.propertyName}</span></span>
        {money && cost != null && <span className="text-copy font-medium tabular-nums whitespace-nowrap">{rm(cost, { cents: false })}{i.finalAmount == null && <span className="text-meta text-muted-ink font-normal"> quote</span>}</span>}
      </span>
      <span className="text-copy text-ink [overflow-wrap:anywhere]">{i.title}</span>
      <span className="text-meta text-muted-ink">
        {CATEGORY[i.category] ?? i.category} · {i.vendorName ? i.vendorName : <span className="text-danger">Unassigned</span>} · reported {dateShort(i.reportedAt)}
      </span>
      <span className="flex gap-1.5 flex-wrap pt-0.5">
        {typeOf(i) !== 'normal' && <StatusBadge tone={typeOf(i) === 'urgent' ? 'critical' : 'info'}>{JOB_TYPE[typeOf(i)]}</StatusBadge>}
        {i.blocksUnit && i.state !== 'resolved' && <StatusBadge tone="critical">Unit blocked</StatusBadge>}
        {i.dueOn && typeOf(i) === 'normal' && i.state !== 'resolved' && <StatusBadge tone="neutral">Due {dateShort(i.dueOn)}</StatusBadge>}
        <StatusBadge tone={s.tone === 'gold' ? 'neutral' : s.tone}>{s.label}</StatusBadge>
        {i.approvalStatus === 'needed' && !awaitingOwner(i) ? null : i.approvalStatus === 'approved' && <StatusBadge tone="success">Owner approved</StatusBadge>}
      </span>
    </span>
  );
}

/** One technician or contractor for every ticked job (PATCH each job, as the detail panel does). */
function BulkAssignModal({ rows, onClose, onDone }: { rows: Issue[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const techs = useTechnicians();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!name.trim()) { setError('Pick who does the jobs.'); return; }
    setBusy(true); setError(null);
    const todo = rows.filter(i => i.state !== 'resolved');
    const left = rows.filter(i => i.state === 'resolved').map(i => ({ label: jobLabel(i), reason: 'Finished, reopen it first' }));
    const res = await runEach(todo, i => api.patch(`/maintenance/issues/${i.id}`, { assigneeName: name.trim() }), jobLabel);
    const failed = [...res.failed, ...left];
    toast({
      tone: res.ok === 0 ? 'critical' : failed.length ? 'warning' : 'success',
      title: res.ok ? `${plural(res.ok, 'job')} assigned to ${name.trim()}.` : 'No job assigned.',
      body: skippedNote(failed) || undefined,
    });
    onDone();
  }
  return (
    <OpsModal title="Assign jobs" sub={`${plural(rows.length, 'job')} ticked. Each goes to the same technician or contractor.`} onClose={onClose} busy={busy}
      footer={footer(onClose, busy, 'Assign', () => void save())}>
      <FormRow label="Assign to" error={error}><AssigneePicker value={name} onChange={v => { setName(v); setError(null); }} techs={techs} /></FormRow>
    </OpsModal>
  );
}

/* ---------- the detail panel ---------- */

function IssueDetail({ issue: i, billing, money, skus, onClose, onChanged }: { issue: Issue; billing: boolean; money: boolean; skus: Sku[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const files = useApi<{ data: FileItem[] }>(`/maintenance/issues/${i.id}/documents`);
  const techs = useTechnicians();
  const [confirmUi, ask] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(i.vendorName ?? '');
  const [item, setItem] = useState(i.skuId ?? 'other');
  const [quoteSen, setQuoteSen] = useState<number | null>(i.quotedAmount);
  const [billingDate, setBillingDate] = useState(i.billingDate ?? '');
  const [payer, setPayer] = useState<ChargeTo>(i.chargeTo);
  const [owedSen, setOwedSen] = useState<number | null>(i.contractorAmount);
  const [stage, setStage] = useState<'before' | 'after'>(i.endedAt || i.state === 'resolved' ? 'after' : 'before');
  const [docKind, setDocKind] = useState('claim');
  const [windowOpen, setWindowOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [exchange, setExchange] = useState(false);
  const done = i.state === 'resolved';
  const media = (files.data?.data ?? []).filter(f => f.kind === 'photo' || f.kind === 'video');
  const docs = (files.data?.data ?? []).filter(f => f.kind !== 'photo' && f.kind !== 'video');
  const shownMedia = media.filter(m => (m.stage ?? 'before') === stage);
  const counts = { before: media.filter(m => (m.stage ?? 'before') === 'before').length, after: media.filter(m => m.stage === 'after').length };
  const charge = i.finalAmount ?? i.quotedAmount;
  const collectFrom = COLLECT_FROM[i.chargeTo];
  const doneWhy = awaitingOwner(i) ? "Waiting for the owner's approval." : counts.after === 0 ? 'Add a photo of the fixed job first (Photos, Fixed).' : null;

  const refresh = useCallback(() => { files.reload(); onChanged(); }, [files, onChanged]);
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); return true; }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); return false; }
    finally { setBusy(null); }
  }
  // Approval and collection are money decisions, so each asks once with the unit, job and amount in view.
  async function recordApproval() {
    const ok = await ask({ title: "Record the owner's approval?", confirmLabel: 'Record approval',
      body: 'Only do this once the owner has said yes. The job can then go ahead.',
      meta: <>{i.propertyName} {i.unitNumber} · {i.title}<br />Quote: {i.quotedAmount != null ? rm(i.quotedAmount) : 'no amount yet'}</> });
    if (ok === null) return;
    void act('approve', () => api.post(`/maintenance/issues/${i.id}/approve`, { approved: true, quotedAmount: i.quotedAmount }), 'Approval recorded.', 'The job can go ahead.');
  }
  async function markCollected(day: string | null) {
    if (day) {
      const ok = await ask({ title: `Mark collected from ${collectFrom}?`, confirmLabel: 'Mark collected',
        meta: <>{i.propertyName} {i.unitNumber} · {i.title}<br />{charge != null ? rm(charge) : '—'}, collected {date(day)}</> });
      if (ok === null) return;
    }
    void act('collected', () => api.patch(`/maintenance/issues/${i.id}`, { collectedAt: day }), day ? 'Marked collected.' : 'Marked not collected.');
  }
  async function uploadDocs(list: FileList) {
    const picked = Array.from(list);
    setBusy('docs');
    const res = await runEach(picked, f => uploadTo(`/maintenance/issues/${i.id}/documents`, { kind: docKind })(f), f => f.name);
    setBusy(null);
    toast({ tone: res.ok === 0 ? 'critical' : res.failed.length ? 'warning' : 'success', title: res.ok ? `${plural(res.ok, 'file')} attached.` : 'Nothing attached.', body: skippedNote(res.failed) || undefined });
    refresh();
  }

  // One Save for the quote, the billing date and who pays: only what changed is sent.
  const billingDelta: Record<string, unknown> = {};
  if (!done && quoteSen !== i.quotedAmount) billingDelta.quotedAmount = quoteSen;
  if (billing && (billingDate || null) !== i.billingDate) billingDelta.billingDate = billingDate || null;
  if (!done && payer !== i.chargeTo) billingDelta.chargeTo = payer;

  const steps: { label: string; at: string | null; on: boolean; note?: string }[] = [
    { label: 'Reported', at: i.reportedAt, on: true, note: `${SOURCE[i.source] ?? i.source}${i.reporter ? `, ${i.reporter}` : ''}` },
    { label: 'Assigned', at: null, on: !!i.vendorName, note: i.vendorName ? `${i.vendorName}${i.assigneeKind ? ` (${KIND_WORD[i.assigneeKind].toLowerCase()})` : ''}` : undefined },
    { label: 'Quote', at: null, on: i.quotedAmount != null, note: money && i.quotedAmount != null ? `${rm(i.quotedAmount)}${i.billingDate ? `, billed ${date(i.billingDate)}` : ''}` : undefined },
    { label: i.ownerApprovalRequired ? (i.ownerApprovedAt ? 'Owner approved' : 'Owner approval') : 'Approval', at: i.ownerApprovedAt, on: !!i.ownerApprovedAt || (i.quotedAmount != null && !awaitingOwner(i)), note: awaitingOwner(i) ? 'Waiting for the owner' : !i.ownerApprovalRequired && i.quotedAmount != null ? 'Not needed' : undefined },
    { label: 'In progress', at: i.startedAt, on: started(i) },
    { label: 'Done', at: i.resolvedAt, on: done, note: done && money && i.finalAmount != null ? `${rm(i.finalAmount)}, ${PAYER_SHORT[i.chargeTo]}` : undefined },
  ];
  // "Next" is the first step not done AFTER the furthest one that is done, so a skipped step (no assignee, no quote) never shows as next.
  const lastOn = steps.reduce((n, s, k) => (s.on ? k : n), -1);
  const current = done ? -1 : steps.findIndex((s, k) => k > lastOn && !s.on);

  return (
    <div className="ops-detail flex flex-col gap-4 p-5 text-copy">
      {confirmUi}
      <div className="sticky top-0 z-[2] -mx-5 -mt-5 px-5 pt-4 pb-4 bg-black text-white flex items-start gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gold">{i.propertyName} · {i.unitNumber}</div>
          <div className="text-[19px] leading-tight font-semibold">{i.title}</div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {steps.map((s, k) => (
              <span key={s.label} title={s.label} className={cx('h-1.5 rounded-full flex-1 min-w-[18px]', s.on ? 'bg-gold' : k === current ? 'bg-faint' : 'bg-charcoal')} />
            ))}
          </div>
          <div className="text-meta text-on-dark">{current < 0 ? 'Done' : `Next: ${steps[current].label}`}</div>
        </div>
        <span className="[&_button]:text-white [&_button]:border-charcoal [&_button]:bg-transparent"><CloseButton onClick={onClose} /></span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <StatusBadge tone={typeOf(i) === 'urgent' ? 'critical' : typeOf(i) === 'pass_key' ? 'info' : 'neutral'}>{JOB_TYPE[typeOf(i)]}</StatusBadge>
        {i.approvalStatus === 'approved' && <StatusBadge tone="success">Owner approved</StatusBadge>}
        <StatusBadge tone="neutral">{CATEGORY[i.category] ?? i.category}</StatusBadge>
        <StatusBadge tone={statusOf(i).tone}>{statusOf(i).label}</StatusBadge>
        {i.blocksUnit && <StatusBadge tone="critical">Unit blocked</StatusBadge>}
        {money && billing && collectFrom && (done || i.collectedAt) && charge != null && charge > 0 && (i.collectedAt
          ? <StatusBadge tone="success">Collected</StatusBadge>
          : <StatusBadge tone="warning">Not collected</StatusBadge>)}
      </div>
      {i.detail && <p className="m-0 text-ink whitespace-pre-wrap">{i.detail}</p>}

      <ol className="m-0 p-0 list-none flex flex-col">
        {steps.map((s, n) => (
          <li key={s.label} className="flex gap-2.5 min-h-[30px]">
            <span className="flex flex-col items-center flex-none w-4 pt-1">
              <span className={cx('w-2.5 h-2.5 rounded-full', s.on ? 'bg-black' : n === current ? 'bg-gold' : 'bg-line')} />
              {n < steps.length - 1 && <span className={cx('w-px flex-1 mt-0.5', s.on ? 'bg-black' : 'bg-line')} />}
            </span>
            <span className={cx('pb-2', s.on ? 'text-ink' : n === current ? 'text-ink font-medium' : 'text-faint')}>
              {s.label}{s.at && <span className="text-muted-ink"> · {stamp(s.at)}</span>}{s.note && <span className="text-muted-ink"> · {s.note}</span>}
            </span>
          </li>
        ))}
      </ol>

      {awaitingOwner(i) && (
        <div className="rounded-control bg-warning-bg text-warning p-3 flex flex-col gap-2">
          <span>The quote{money && i.quotedAmount != null ? ` of ${rm(i.quotedAmount)}` : ''} is waiting for the owner's approval. Work cannot start until then.</span>
          <span className="text-meta">{i.ownerHasLogin ? 'The owner has been told and can approve it on the owner portal.' : 'This owner has no owner portal login, so they cannot approve it there. Ask them, then record their answer here.'}</span>
          {money && <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="secondary" loading={busy === 'approve'}
              onClick={() => void recordApproval()}>Record owner's approval</Button>
            {i.ownerHasLogin && <Button size="sm" variant="tertiary" loading={busy === 'resend'}
              onClick={() => void act('resend', () => api.post(`/maintenance/issues/${i.id}/request-approval`, {}), 'Sent to the owner again.')}>Send again</Button>}
          </div>}
        </div>
      )}

      {!done && i.jobType && <JobPlan i={i} busy={busy} act={act} />}
      {waitingParts(i) && <div className="rounded-control bg-warning-bg text-warning p-3">The owner approved. The technicians see this job once the parts are ticked as arrived.</div>}

      {!done && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">Assigned to</h3>
          <div className="max-sm:[&>div>span:last-child>button]:min-h-11"><AssigneePicker value={assignee} onChange={setAssignee} techs={techs} /></div>
          <Button size="sm" variant="secondary" className="self-start" disabled={!assignee.trim() || assignee.trim() === (i.vendorName ?? '')} disabledReason="Pick a different person."
            loading={busy === 'assign'} onClick={() => void act('assign', () => api.patch(`/maintenance/issues/${i.id}`, { assigneeName: assignee.trim() }), 'Job assigned.')}>Save</Button>
        </section>
      )}
      <section className="flex flex-col gap-2 rounded-card border border-solid border-line p-3.5">
        <h3 className="m-0 text-copy font-semibold">Items, cost and profit</h3>
        <JobMoneyPanel kind="maintenance" jobId={i.id} unitId={i.unitId} catalog={skus} onChanged={onChanged}
          itemsLocked={done ? 'The job is finished; reopen it to change its items.' : i.ownerApprovedAt && i.chargeTo === 'owner' ? 'The owner approved this quote, so its items stay as they are.' : null}
          fallback={<>
      {!done && (
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-copy font-semibold">Item</h3>
            <SearchSelect label="Item" size="md" value={item} onChange={setItem} placeholder="Search items by name or code"
              options={[...skus.filter(s => s.active || s.id === i.skuId).map(s => ({ value: s.id, label: s.name, hint: s.code, group: CATEGORY[s.category] ?? 'Other' })), { value: 'other', label: 'Other (not on the list)', group: 'Not in the catalog' }]} />
            <Button size="sm" variant="secondary" className="self-start" disabled={item === (i.skuId ?? 'other')} disabledReason="Pick a different item."
              loading={busy === 'item'} onClick={() => void act('item', () => api.patch(`/maintenance/issues/${i.id}`, { skuId: item === 'other' ? null : item }), 'Item saved.')}>Save</Button>
          </section>
        )}
        {done && <p className="m-0 text-muted-ink">Item: {i.skuName ? `${i.skuName}${i.skuCode ? ` (${i.skuCode})` : ''}` : 'Other (not on the list)'}.</p>}
              {done && <p className="m-0 text-muted-ink">Item: {i.skuName ? `${i.skuName}${i.skuCode ? ` (${i.skuCode})` : ''}` : 'Other (not on the list)'}.</p>}
          </>} />
      </section>
      {done && i.vendorName && <p className="m-0 text-muted-ink">Done by {i.vendorName}{i.assigneeKind ? ` (${KIND_WORD[i.assigneeKind].toLowerCase()})` : ''}.</p>}

      {money ? (
        <section className="flex flex-col gap-2.5 rounded-card border border-solid border-line p-3.5">
          <h3 className="m-0 text-copy font-semibold">Quote and billing</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormRow label={done ? 'Final amount' : 'Quote, RM'}>
              {done ? <span className="h-10 flex items-center tabular-nums">{i.finalAmount != null ? rm(i.finalAmount) : '—'}</span>
                : <MoneyInput prefix className={INPUT} valueSen={quoteSen} onChangeSen={setQuoteSen} aria-label="Quote in RM" />}
            </FormRow>
            {billing && <FormRow label="Billing date" hint="The cost goes on the unit in this month.">
              <DateField aria-label="Billing date" className={INPUT} value={billingDate} onChange={setBillingDate} />
            </FormRow>}
            <FormRow label="Who pays">
              {done ? <span className="h-10 flex items-center">{PAYER[i.chargeTo]}</span>
                : <select className={INPUT} value={payer} onChange={e => setPayer(e.target.value as ChargeTo)}>
                  {(['owner', 'the_conts', 'guest_deposit'] as ChargeTo[]).concat(i.chargeTo === 'warranty' ? ['warranty'] : []).map(p => <option key={p} value={p}>{PAYER[p]}</option>)}
                </select>}
            </FormRow>
          </div>
          {(!done || billing) && <Button size="sm" variant="secondary" className="self-start" disabled={!Object.keys(billingDelta).length} disabledReason="Change something first."
            loading={busy === 'billing'} onClick={() => void act('billing', () => api.patch(`/maintenance/issues/${i.id}`, billingDelta), 'Saved.',
              done && billingDelta.billingDate ? 'The cost on the unit moved to the new billing date.' : undefined)}>Save</Button>}

          {!done && i.chargeTo === 'owner' && i.quotedAmount != null && !awaitingOwner(i) && (
            <div className="flex items-center gap-3 flex-wrap pt-2.5 [border-top:1px_solid_var(--color-line-soft)]">
              <span className="flex-1 min-w-[180px] flex flex-col">
                <span className="font-medium">Owner approval</span>
                <span className="text-meta text-muted-ink">{i.ownerApprovedAt ? `Approved ${stamp(i.ownerApprovedAt)}.`
                  : 'Not sent. Send the quote if the owner should agree before work starts.'}</span>
              </span>
              {!i.ownerApprovedAt && <Button size="sm" variant="secondary" icon={<Icon name="Send" size="sm" />} loading={busy === 'ask'}
                onClick={() => void act('ask', () => api.post(`/maintenance/issues/${i.id}/request-approval`, {}), 'Sent to the owner for approval.',
                  i.ownerHasLogin ? 'They see it on the owner portal. Work waits until they approve.' : 'This owner has no portal login: ask them, then record their answer here.')}>Send to owner for approval</Button>}
            </div>
          )}

          {billing && (
            <div className="flex flex-col gap-2.5 pt-2.5 [border-top:1px_solid_var(--color-line-soft)]">
              {collectFrom ? (
                <DateMark label={`Collected from ${collectFrom}`} amount={charge} at={i.collectedAt} busy={busy === 'collected'} markLabel="Mark collected"
                  note={charge == null ? 'Add the quote first.' : i.chargeTo === 'owner' ? 'Taken off the owner statement for the billing month, or paid by the owner directly.' : undefined}
                  onSet={day => void markCollected(day)} />
              ) : <span className="text-meta text-muted-ink">{PAYER[i.chargeTo]} pays: nothing to collect.</span>}
              <div className="flex flex-col gap-1.5">
                <span className="font-medium">Owed to {i.vendorName ?? 'the technician or contractor'}</span>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0"><MoneyInput prefix className={INPUT} valueSen={owedSen} onChangeSen={setOwedSen} aria-label="Amount owed to the technician or contractor in RM" /></div>
                  <Button size="sm" variant="secondary" className="h-10" disabled={owedSen === i.contractorAmount} disabledReason="Change the amount first."
                    loading={busy === 'owed'} onClick={() => void act('owed', () => api.patch(`/maintenance/issues/${i.id}`, { contractorAmount: owedSen }), 'Amount owed saved.')}>Save</Button>
                </div>
                <span className="text-meta text-muted-ink">What their claim says. Attach the claim below so accounts can pay it.</span>
              </div>
              {!!i.staffPurchasesSen && (
                <span className="text-meta">Bought by staff for this job: <strong>{rm(i.staffPurchasesSen)}</strong>, handed in as receipts and paid back to them. Part of the job's cost; the owner pays the quote only.</span>
              )}
              <DateMark label="Paid to the technician or contractor" amount={i.contractorAmount} at={i.contractorPaidAt} busy={busy === 'paid'} markLabel="Mark paid"
                note={i.contractorAmount == null ? 'Enter the amount owed first.' : undefined}
                onSet={day => void act('paid', () => api.patch(`/maintenance/issues/${i.id}`, { contractorPaidAt: day }), day ? 'Marked paid.' : 'Marked not paid.')} />
            </div>
          )}

          <span className="text-meta text-muted-ink pt-2.5 [border-top:1px_solid_var(--color-line-soft)]">
            {done
              ? (i.expensed ? `On the unit's costs: ${rm(i.expensed)}${i.expensedOn ? `, ${monthLabel(i.expensedOn)} (dated ${date(i.expensedOn)})` : ''}.` : "Nothing was put on the unit's costs.")
              : `When the job is marked done, the final amount goes on the unit's costs${billing && i.billingDate ? ` for ${monthLabel(i.billingDate)}` : ' on the billing date'}.`}
          </span>
        </section>
      ) : (
        <p className="m-0 text-muted-ink">Paid by {PAYER[i.chargeTo].toLowerCase()}.</p>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-copy font-semibold flex-1">Repair windows</h3>
          {!done && <Button size="sm" variant="secondary" icon={<Icon name="CalendarClock" size="sm" />} onClick={() => setWindowOpen(true)}>Add window</Button>}
        </div>
        {i.windows.length === 0 ? <span className="text-muted-ink">{done ? "No window was recorded." : "No time agreed yet. Add when the technician may enter: between guests, or a slot the guest agreed."}</span>
          : i.windows.map(w => (
            <div key={w.id} className={cx('rounded-control p-2.5 flex flex-col gap-1', w.overlaps.length ? 'bg-critical-bg' : 'bg-muted')}>
              <div className="flex items-center gap-2">
                <b className="flex-1 [font-variant-numeric:tabular-nums]">{stamp(w.startsAt)} – {w.startsAt.slice(0, 10) === w.endsAt.slice(0, 10) ? hm(w.endsAt) : stamp(w.endsAt)}</b>
                {!done && <button type="button" aria-label="Remove window" className="text-muted-ink cursor-pointer hover:text-danger" onClick={() => void act(`w-${w.id}`, () => api.del(`/maintenance/issues/${i.id}/windows/${w.id}`), 'Window removed.')}><Icon name="Trash2" size="sm" /></button>}
              </div>
              {w.note && <span className="text-muted-ink">{w.note}</span>}
              {w.overlaps.map(o => <span key={o.reservationId} className="text-meta text-danger">Overlaps the reservation of {o.guestName} ({dateShort(o.checkIn)} {o.checkInTime} to {dateShort(o.checkOut)} {o.checkOutTime}). Make sure the guest agreed.</span>)}
            </div>
          ))}
      </section>

      <section className="flex flex-col gap-2.5">
        <AttachmentLabel title="Photos and videos" count={media.length} />
        <Segmented label="Problem or fixed" value={stage} onChange={setStage} options={[
          { value: 'before', label: <>The problem <span className="text-muted-ink tabular-nums">{counts.before}</span></> },
          { value: 'after', label: <>Fixed <span className="text-muted-ink tabular-nums">{counts.after}</span></> },
        ]} />
        <span className="text-meta text-muted-ink">{stage === 'before' ? 'What was wrong, as reported.' : 'Proof the job is settled. Needed before the job can be marked done.'}</span>
        {files.loading && !files.data ? <Skeleton height={96} /> : (
          <MediaGallery key={stage} items={shownMedia} upload={done ? undefined : uploadTo(`/maintenance/issues/${i.id}/photos`, { kind: stage })} onDone={refresh}
            addLabel={stage === 'before' ? 'Add photo of the problem' : 'Add proof it is fixed'} emptyText={stage === 'before' ? 'No photo of the problem yet.' : 'No proof yet. Add one when the job is settled.'} />
        )}
      </section>

      {money && (
        <section className="flex flex-col gap-2">
          <AttachmentLabel title="Claims, invoices and receipts" count={docs.length} hint="The technician's or contractor's claim, the bill to the payer, payment receipts. Accounts pay from these." />
          <FileList files={docs.map(d => ({ id: d.id, name: d.fileName, href: d.url, size: d.byteSize ?? null, label: `${DOC_KIND[d.kind] ?? 'File'} · ${dateShort(d.uploadedAt)}` }))} />
          <div className="flex gap-2 items-start flex-wrap">
            <Select label="Kind of file" value={docKind} onChange={setDocKind} size="md" className="w-[230px] max-sm:w-full"
              options={['claim', 'invoice', 'receipt', 'pod'].map(k => ({ value: k, label: DOC_KIND[k] }))} />
            <div className="flex-1 min-w-[200px]">
              <FileDropRow label="Add files" hint="Photos or PDFs, several at once" accept="image/*,application/pdf" multiple busy={busy === 'docs'} onPick={fl => void uploadDocs(fl)} />
            </div>
          </div>
        </section>
      )}

      {done ? (
        <section className="flex flex-col gap-3 pt-4 [border-top:1px_solid_var(--color-line-soft)]">
          {money && i.finalAmount != null && <p className="m-0">Final cost {rm(i.finalAmount)}, {PAYER[i.chargeTo].toLowerCase()}{i.expensed ? '. Recorded as an expense on the unit.' : '.'}</p>}
          {money && <Button variant="secondary" loading={busy === 'reopen'} onClick={() => void act('reopen', () => api.patch(`/maintenance/issues/${i.id}`, { state: 'reopened' }), 'Job reopened.')}>Reopen</Button>}
        </section>
      ) : (
        <>
          {(!i.blocksUnit || skus.some(s => s.trackStock && s.active && s.stockOnHand > 0)) && (
            <section className="flex flex-col rounded-card border border-solid border-line overflow-hidden">
              {!i.blocksUnit && (
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <span className="w-8 h-8 flex-none grid place-items-center rounded-full bg-muted text-muted-ink"><Icon name="Ban" size="sm" /></span>
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="font-medium text-ink">Unit can still be booked</span>
                    <span className="text-meta text-muted-ink">Block it if guests cannot stay until this is fixed.</span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setBlockOpen(true)}>Block unit</Button>
                </div>
              )}
              {skus.some(s => s.trackStock && s.active && s.stockOnHand > 0) && (
                <div className={cx('flex items-center gap-3 px-3.5 py-3', !i.blocksUnit && '[border-top:1px_solid_var(--color-line-soft)]')}>
                  <span className="w-8 h-8 flex-none grid place-items-center rounded-full bg-muted text-muted-ink"><Icon name="PackageMinus" size="sm" /></span>
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="font-medium text-ink">Parts from stock</span>
                    <span className="text-meta text-muted-ink">Record a spare used on this job.</span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setExchange(true)}>Draw a part</Button>
                </div>
              )}
            </section>
          )}
          {/* Phones have no hover, so the reason a button is off is written out. The bar sticks to the bottom of a long sheet on phones. */}
          {(!started(i) || money) && <section className="flex flex-col gap-2 pt-4 [border-top:1px_solid_var(--color-line-soft)] max-sm:order-last max-sm:sticky max-sm:bottom-0 max-sm:z-[2] max-sm:-mx-5 max-sm:-mb-5 max-sm:px-5! max-sm:pb-4! max-sm:rounded-none! max-sm:border-x-0! max-sm:border-b-0! max-sm:bg-card max-sm:shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.25)]">
            <div className="grid grid-flow-col auto-cols-fr gap-3">
              {/* One black button, the next step: Start repair until it is under way, then Mark done. */}
              {!started(i) && <Button variant="primary" icon={<Icon name="Play" size="sm" />} loading={busy === 'start'} disabled={awaitingOwner(i)} disabledReason="Waiting for the owner's approval."
                onClick={() => void act('start', () => api.post(`/maintenance/issues/${i.id}/start`, {}), 'Repair started.')}>Start repair</Button>}
              {money && <Button variant={started(i) ? 'primary' : 'outline'} icon={<Icon name="Check" size="sm" />} disabled={!!doneWhy} disabledReason={doneWhy ?? undefined}
                onClick={() => setCompleteOpen(true)}>Mark done</Button>}
            </div>
            {doneWhy && (money || awaitingOwner(i)) && <span className="text-meta text-muted-ink">{doneWhy}</span>}
          </section>}
        </>
      )}

      <PhoneHistory phone={<div className="rounded-card border border-solid border-line overflow-hidden bg-card"><RecordHistory entity="maintenance_issues" id={i.id} refreshKey={i} bare pageSize={10} /></div>}>
        <HistoryDisclosure entity="maintenance_issues" id={i.id} refreshKey={i} />
      </PhoneHistory>

      {windowOpen && <WindowModal issue={i} onClose={() => setWindowOpen(false)} onDone={(n) => { setWindowOpen(false); toast({ tone: n ? 'warning' : 'success', title: 'Repair window added.', body: n ? `It overlaps ${n} ${n === 1 ? 'reservation' : 'reservations'}. Make sure the guest agreed.` : 'No guest is in the unit then.' }); refresh(); }} />}
      {blockOpen && <BlockModal issue={i} onClose={() => setBlockOpen(false)} onDone={() => { setBlockOpen(false); toast({ tone: 'success', title: 'Unit blocked.', body: 'The nights are blocked on the calendar until the repair is done.' }); refresh(); }} />}
      {completeOpen && <CompleteModal issue={i} billing={billing} onClose={() => setCompleteOpen(false)} onDone={() => { setCompleteOpen(false); toast({ tone: 'success', title: 'Job done.', body: 'The cost is on the unit as an expense.' }); refresh(); }} />}
      {exchange && <ExchangeModal jobLabel={`${i.propertyName} ${i.unitNumber} · ${i.title}`} skus={skus.filter(s => s.active)} onClose={() => setExchange(false)}
        onExchange={(s, qty) => { setExchange(false); void act('exchange', () => api.post(`/maintenance/issues/${i.id}/exchange`, { skuId: s.id, qty }), 'Drawn from stock.', `${qty} x ${s.name}.`); }} />}
    </div>
  );
}

/** A yes/no money step with its day: "Collected from the owner: not yet [Mark collected]" / "Paid 12 Oct 2026 [Undo]". */
function DateMark({ label, amount, at, busy, markLabel, note, onSet }: {
  label: string; amount: number | null; at: string | null; busy: boolean; markLabel: string; note?: string; onSet: (day: string | null) => void;
}) {
  const [day, setDay] = useState(mytDay(0));
  return (
    // One compact line: label + amount, then a status chip. The date picker only appears once there is an amount to mark.
    <div className="flex items-center flex-wrap gap-2 py-2 [&+&]:[border-top:1px_solid_var(--color-line-soft)]">
      <span className="flex-1 min-w-[160px] flex flex-col leading-tight">
        <span className="text-meta font-medium truncate">{label}</span>
        <span className="text-[12px] text-muted-ink tabular-nums">{amount != null ? rm(amount) : note ?? '—'}</span>
      </span>
      {at
        ? <><span className="text-[12px] font-medium text-success whitespace-nowrap">{date(at)}</span><Button size="sm" variant="tertiary" loading={busy} onClick={() => onSet(null)}>Undo</Button></>
        : amount == null
          ? <span className="text-[12px] text-muted-ink whitespace-nowrap">Not yet</span>
          : <span className="flex gap-1.5 items-center flex-none">
              <DateField aria-label={`${markLabel}: day`} className={cx(INPUT, 'h-8 w-[128px] text-meta')} value={day} max={mytDay(0)} onChange={v => v && setDay(v)} />
              <Button size="sm" variant="secondary" loading={busy} onClick={() => onSet(day)}>{markLabel}</Button>
            </span>}
    </div>
  );
}

/* ---------- dialogs ---------- */

function footer(onClose: () => void, busy: boolean, label: string, onSave: () => void) {
  return <><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={onSave}>{label}</Button></>;
}
const errText = (e: unknown) => errorMessage(e, 'Not saved. Try again.');

/** Same form as "Report damage" from a clean (components/ops/OpsUi MaintenanceJobForm), with a unit picker. */
function NewJobModal({ units, onClose, onDone }: { units: RosterUnit[]; onClose: () => void; onDone: (id: string) => void }) {
  return <MaintenanceJobForm units={units} onClose={onClose} onDone={onDone} />;
}

function WindowModal({ issue, onClose, onDone }: { issue: Issue; onClose: () => void; onDone: (overlaps: number) => void }) {
  const day = mytDay(0);
  const [start, setStart] = useState(`${day}T11:30`);
  const [end, setEnd] = useState(`${day}T14:30`);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!start || !end) { setError('Pick when the window starts and ends.'); return; }
    if (end <= start) { setError('The end must be after the start.'); return; }
    setBusy(true); setError(null);
    try { const r = await api.post<{ overlaps: unknown[] }>(`/maintenance/issues/${issue.id}/windows`, { startsAt: start, endsAt: end, note: note.trim() || undefined }); onDone(r.overlaps.length); }
    catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="Add repair window" sub={`When the technician may enter ${issue.propertyName} ${issue.unitNumber}. Malaysia time.`} onClose={onClose} busy={busy} footer={footer(onClose, busy, 'Add window', () => void save())}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormRow label="From" error={error}><DateTimeField aria-label="From" className={INPUT} value={start} onChange={setStart} required /></FormRow>
        <FormRow label="To"><DateTimeField aria-label="To" className={INPUT} value={end} min={start || undefined} onChange={setEnd} required /></FormRow>
      </div>
      <FormRow label="Note (optional)" hint="e.g. Between guests, or: guest agreed, will be out 14:00 to 16:00"><input className={INPUT} value={note} onChange={e => setNote(e.target.value)} maxLength={300} /></FormRow>
    </OpsModal>
  );
}

function BlockModal({ issue, onClose, onDone }: { issue: Issue; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(mytDay(0));
  const [to, setTo] = useState(mytDay(1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try { await api.post('/blocks', { unitId: issue.unitId, from, to, reason: `Maintenance: ${issue.title}`.slice(0, 200), issueId: issue.id }); onDone(); }
    catch (e) { setError(e instanceof ApiFailure && e.status === 409 ? 'A reservation already holds some of those nights. Pick dates when the unit is free.' : errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="Block unit until fixed" sub={`${issue.propertyName} ${issue.unitNumber} is blocked for these nights, and shows as under maintenance.`} onClose={onClose} busy={busy} footer={footer(onClose, busy, 'Block unit', () => void save())}>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="First night" error={error}><DateField aria-label="First night" className={INPUT} value={from} onChange={v => v && setFrom(v)} /></FormRow>
        <FormRow label="Available again"><DateField aria-label="Available again" className={INPUT} value={to} min={from || undefined} onChange={v => v && setTo(v)} /></FormRow>
      </div>
    </OpsModal>
  );
}

function CompleteModal({ issue, billing, onClose, onDone }: { issue: Issue; billing: boolean; onClose: () => void; onDone: () => void }) {
  const [amountSen, setAmountSen] = useState<number | null>(issue.quotedAmount);
  const [payer, setPayer] = useState<ChargeTo>(issue.chargeTo);
  const [billingDate, setBillingDate] = useState(issue.billingDate ?? mytDay(0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    // Every job closes with its amount (staff comment sheet, 16 Oct 2026): RM 0 has to be typed, never assumed.
    if (amountSen == null || amountSen < 0) { setError('Enter the final cost. Type 0 if the job cost nothing.'); return; }
    const sen = amountSen;
    setBusy(true); setError(null);
    try { await api.post(`/maintenance/issues/${issue.id}/complete`, { finalAmount: sen, chargeTo: payer, ...(billing && billingDate ? { billingDate } : {}) }); onDone(); }
    catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="Mark job done" sub={`${issue.propertyName} ${issue.unitNumber} · ${issue.title}`} onClose={onClose} busy={busy} footer={footer(onClose, busy, 'Mark done', () => void save())}>
      <FormRow label="Final cost, RM (required)" error={error} hint="Recorded as a maintenance expense on the unit. RM 0 records nothing.">
        <MoneyInput className={INPUT} valueSen={amountSen} onChangeSen={setAmountSen} aria-label="Final cost in RM" />
      </FormRow>
      {billing && <FormRow label="Billing date" hint={billingDate ? `The cost goes on the unit's costs for ${monthLabel(billingDate)}.` : undefined}>
        <DateField aria-label="Billing date" className={INPUT} value={billingDate} onChange={setBillingDate} />
      </FormRow>}
      <FormRow label="Who pays">
        <select className={INPUT} value={payer} onChange={e => setPayer(e.target.value as ChargeTo)}>{(['owner', 'the_conts', 'guest_deposit', 'warranty'] as ChargeTo[]).map(p => <option key={p} value={p}>{PAYER[p]}</option>)}</select>
      </FormRow>
      {issue.blocksUnit && <span className="text-meta text-muted-ink">The unit goes back to ready, and the nights blocked for this repair become available again.</span>}
    </OpsModal>
  );
}

/** The job's plan, saved as it is picked: its type, how serious it is (management's approval rules can look at it), the
 *  due date Normal jobs are worked in, and the parts it waits for. */
function JobPlan({ i, busy, act }: { i: Issue; busy: string | null; act: (key: string, fn: () => Promise<unknown>, ok: string, body?: string) => Promise<boolean> }) {
  const patch = (key: string, body: Record<string, unknown>, ok: string, note?: string) => void act(key, () => api.patch(`/maintenance/issues/${i.id}`, body), ok, note);
  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-solid border-line p-3.5">
      <h3 className="m-0 text-copy font-semibold">Job</h3>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Type">
          <select className={INPUT} value={typeOf(i)} disabled={busy === 'type'} onChange={e => patch('type', { jobType: e.target.value }, 'Job type saved.')}>
            {(Object.keys(JOB_TYPE) as JobType[]).map(t => <option key={t} value={t}>{JOB_TYPE[t]}</option>)}
          </select>
        </FormRow>
        <FormRow label="Severity">
          <select className={INPUT} value={i.severity ?? 'minor'} disabled={busy === 'severity'} onChange={e => patch('severity', { severity: e.target.value }, 'Severity saved.')}>
            <option value="minor">Minor</option><option value="major">Major</option>
          </select>
        </FormRow>
        <FormRow label="Due" hint={typeOf(i) === 'normal' ? 'Normal jobs are worked one by one in this order.' : undefined}>
          <DateField aria-label="Due date" className={INPUT} value={i.dueOn ?? ''} onChange={v => patch('due', { dueOn: v || null }, v ? 'Due date saved.' : 'Due date cleared.')} />
        </FormRow>
        <FormRow label="Owner approval">
          <span className="h-10 flex items-center"><StatusBadge tone={APPROVAL[i.approvalStatus ?? 'not_needed'].tone}>{APPROVAL[i.approvalStatus ?? 'not_needed'].label}</StatusBadge></span>
        </FormRow>
      </div>
      <div className="flex flex-col gap-1.5 pt-2 [border-top:1px_solid_var(--color-line-soft)]">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-black" checked={!!i.needsParts} disabled={busy === 'parts'}
            onChange={e => patch('parts', { needsParts: e.target.checked }, e.target.checked ? 'Marked as waiting for parts.' : 'No parts needed.')} />
          Needs parts or stock
        </label>
        {i.needsParts && (
          <label className="flex items-center gap-2 cursor-pointer pl-6">
            <input type="checkbox" className="w-4 h-4 accent-black" checked={!!i.partsArrivedAt} disabled={busy === 'arrived'}
              onChange={e => patch('arrived', { partsArrived: e.target.checked }, e.target.checked ? 'Parts arrived.' : 'Parts not arrived.',
                e.target.checked && i.approvalStatus === 'approved' ? 'The technicians can see the job now.' : undefined)} />
            Parts arrived{i.partsArrivedAt ? <span className="text-muted-ink"> · {stamp(i.partsArrivedAt)}</span> : null}
          </label>
        )}
        {i.approvalStatus === 'needed' && <span className="text-meta text-muted-ink">The technicians do not see this job until the owner approves{i.needsParts ? ' and the parts arrive' : ''}.</span>}
      </div>
    </section>
  );
}

type RuleMode = 'never' | 'always' | 'major' | 'over';
const RULE_LABEL: Record<RuleMode, string> = { never: 'Not needed', always: 'Always', major: 'Major jobs only', over: 'When the quote is over' };

/** Maintenance > Approval rules: for each kind of problem, when the owner must approve before work starts. Management sets
 *  them; a job they hold stays away from the technicians until the owner approves (and its parts arrive). */
function ApprovalRulesPanel() {
  const toast = useToast();
  const { data, error, reload } = useApi<{ rules: Record<string, { mode: RuleMode; amount?: number }>; mayEdit: boolean }>('/maintenance/approval-rules');
  const [draft, setDraft] = useState<Record<string, { mode: RuleMode; amount?: number }> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setDraft(data.rules); }, [data]);
  const changed = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.rules);
  async function save() {
    if (!draft) return;
    setBusy(true);
    try { await api.put('/maintenance/approval-rules', { rules: draft }); toast({ tone: 'success', title: 'Approval rules saved.', body: 'They apply to jobs added or changed from now on.' }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); }
    finally { setBusy(false); }
  }
  return (
    <section className="bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-3 max-w-[720px]">
      <div>
        <h2 className="m-0 text-heading font-semibold">When the owner must approve</h2>
        <p className="m-0 text-meta text-muted-ink">A job that needs approval is kept from the technicians until the owner approves it, and until its parts arrive when it needs parts. Jobs that do not need it go straight to the technician. Only jobs the owner pays for are held.</p>
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {!draft ? <Skeleton height={200} /> : (
        <div className="flex flex-col">
          {Object.entries(CATEGORY).map(([cat, label]) => {
            const r = draft[cat] ?? { mode: 'never' as RuleMode };
            return (
              <div key={cat} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-2 items-center py-2 [border-top:1px_solid_var(--color-line-soft)]">
                <b>{label}</b>
                <select className={INPUT} value={r.mode} disabled={!data?.mayEdit} aria-label={`${label} approval rule`}
                  onChange={e => setDraft(d => ({ ...d!, [cat]: e.target.value === 'over' ? { mode: 'over', amount: r.amount ?? 50000 } : { mode: e.target.value as RuleMode } }))}>
                  {(Object.keys(RULE_LABEL) as RuleMode[]).map(m => <option key={m} value={m}>{RULE_LABEL[m]}</option>)}
                </select>
                {r.mode === 'over'
                  ? <MoneyInput prefix className={INPUT} valueSen={r.amount ?? null} disabled={!data?.mayEdit} onChangeSen={v => setDraft(d => ({ ...d!, [cat]: { mode: 'over', amount: v ?? 0 } }))} aria-label={`${label} amount`} />
                  : <span className="text-meta text-muted-ink max-sm:hidden">{r.mode === 'major' ? 'Set Major on the job.' : ''}</span>}
              </div>
            );
          })}
        </div>
      )}
      {data?.mayEdit ? (
        <div className="flex justify-end gap-2">
          {changed && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDraft(data.rules)}>Discard</Button>}
          <Button size="sm" variant="primary" loading={busy} disabled={!changed} disabledReason="Change a rule first." onClick={() => void save()}>Save rules</Button>
        </div>
      ) : <span className="text-meta text-muted-ink">Only management changes these rules.</span>}
    </section>
  );
}

/** Item catalog: the maintenance part of Service prices (0127); before that update, the old catalog. */
function MaintenanceItems({ fallback, onChanged }: { fallback: ReactNode; onChanged: () => void }) {
  const service = useApi<{ ready: boolean }>('/operations/service-prices?domain=maintenance');
  if (!service.data) return <Skeleton height={240} />;
  if (!service.data.ready) return <>{fallback}</>;
  return <ServicePrices domain="maintenance" onChanged={onChanged}
    above={<p className="m-0 text-meta text-muted-ink">Picking an item on a job fills its owner price (the quote) and its internal cost; both stay editable on the job. The whole list, cleaning too, is under Settings, Service prices.</p>} />;
}
