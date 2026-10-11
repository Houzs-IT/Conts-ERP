import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { DateField, DateTimeField, MoneyInput } from '../components/inputs';
import Icon from '../components/Icon';
import { Select, SearchSelect, type SelectOption } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { Skeleton } from '../components/States';
import { DataTable, type Column } from '../components/DataTable';
import SplitPane from '../components/SplitPane';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';
import { useUnitRoster } from '../lib/useUnitRoster';
import { useMedia } from '../lib/useMedia';
import { cx } from '../lib/design-tokens';
import { rm, plural, dateShort } from '../lib/format';
import { runEach, skippedNote } from '../lib/bulk';
import {
  PillTabs, OpsModal, FormRow, INPUT, TEXTAREA, CloseButton, MediaGrid, MediaDrop, uploadTo, CATEGORY, stamp, hm, mytDay, Checklist, type MediaItem, type ChecklistItem,
} from '../components/ops/OpsUi';
import { TemplatePicker, AssigneeFields, assigneeOf, assigneeBody, useTemplates, useTechnicians, type Assignee } from '../components/ops/RepairTemplates';
import { TemplatesPanel } from './MaintenanceTemplates';
import type { AnyTone } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';
import { CatalogPanel, ExchangeModal, type Sku, type SkuPayload, type CatalogInput } from './MaintenanceCatalog';
import { HistoryDisclosure } from '../components/RecordHistory';

/* ---------- the API's shape (functions/api/maintenance/issues.ts) ---------- */

interface Overlap { reservationId: string; guestName: string; checkIn: string; checkOut: string; checkInTime: string; checkOutTime: string }
interface RepairWin { id: string; startsAt: string; endsAt: string; note: string | null; overlaps: Overlap[] }
type ChargeTo = 'owner' | 'the_conts' | 'guest_deposit' | 'warranty';
interface Issue {
  id: string; unitId: string; unitNumber: string; propertyName: string; buildingId: string; title: string; detail: string | null; state: string;
  category: string; urgency: 'normal' | 'urgent'; source: string; sourceTaskId: string | null;
  vendorName: string | null; assigneeKind: 'in_house' | 'contractor' | null; assigneeId: string | null; reportedAt: string; resolvedAt: string | null;
  templateId: string | null; templateName: string | null; doneNote: string | null; checklist: { done: number; total: number };
  blocksUnit: boolean; ownerApprovalRequired: boolean; ownerApprovedAt: string | null; chargeTo: ChargeTo; reporter: string | null;
  startedAt: string | null; endedAt: string | null; photoCount: number; documentCount: number; windows: RepairWin[];
  quotedAmount: number | null; finalAmount: number | null; expensed: number | null; skuName: string | null;
}
interface Payload { threshold: number; data: Issue[] }
interface FileItem extends MediaItem { stage: 'before' | 'after' | null; uploadedAt: string }

type Tab = 'open' | 'approval' | 'done' | 'history' | 'catalog' | 'templates';
const PAYER: Record<ChargeTo, string> = { owner: 'Owner (on the statement)', the_conts: 'Company', guest_deposit: 'Guest (from the deposit)', warranty: 'Warranty' };
const PAYER_SHORT: Record<ChargeTo, string> = { owner: 'owner pays', the_conts: 'company pays', guest_deposit: 'guest pays', warranty: 'warranty' };
const SOURCE: Record<string, string> = { guest: 'Guest', cleaner: 'Cleaner', inspection: 'Inspection', staff: 'Office' };
const MONEY_ROLES = ['management', 'finance_admin', 'operations_manager'];
const FIELD_ROLES = ['housekeeper', 'technician'];

const awaitingOwner = (i: Issue) => i.state !== 'resolved' && i.ownerApprovalRequired && !i.ownerApprovedAt && i.chargeTo === 'owner';
function statusOf(i: Issue): { label: string; tone: AnyTone } {
  if (i.state === 'resolved') return { label: i.finalAmount ? `Done · ${PAYER_SHORT[i.chargeTo]}` : 'Done', tone: 'success' };
  if (awaitingOwner(i)) return { label: 'Awaiting owner approval', tone: 'warning' };
  if (i.state === 'in_progress' || i.startedAt) return { label: i.endedAt ? 'Repair finished' : 'In progress', tone: 'info' };
  if (i.vendorName) return { label: 'Assigned', tone: 'neutral' };
  return { label: 'New', tone: 'neutral' };
}

export default function MaintenancePage() {
  const toast = useToast();
  const { user } = useSession();
  const money = MONEY_ROLES.includes(user!.role);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('open');
  const [category, setCategory] = useState('');
  const [building, setBuilding] = useState('');
  const [q, setQ] = useState('');
  const selected = params.get('id');
  const setSelected = (id: string | null) => setParams(p => { const n = new URLSearchParams(p); if (id) n.set('id', id); else n.delete('id'); return n; }, { replace: true });
  const [creating, setCreating] = useState(false);
  const [threshold, setThreshold] = useState(false);

  const { data, loading, error, reload: reloadData } = useApi<Payload>('/maintenance/issues');
  // The side menu's counts (open jobs, today's work) follow what was just done here.
  const reload = () => { reloadData(); void refreshNavCounts(); };
  const issues = data?.data ?? [];
  const sku = useApi<SkuPayload>(tab === 'catalog' || tab === 'templates' || selected ? '/maintenance/skus' : null);

  // A link from a clean (?id=) opens the right tab.
  useEffect(() => {
    const it = issues.find(i => i.id === selected);
    if (it && tab !== 'history' && tab !== 'catalog' && tab !== 'templates') setTab(it.state === 'resolved' ? 'done' : awaitingOwner(it) ? 'approval' : 'open');
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthStart = mytDay(0).slice(0, 7);
  const open = issues.filter(i => i.state !== 'resolved');
  const approval = open.filter(awaitingOwner);
  const recentDone = issues.filter(i => i.state === 'resolved' && i.resolvedAt && Date.parse(i.resolvedAt) > Date.now() - 30 * 864e5);
  const urgent = open.filter(i => i.urgency === 'urgent').length;
  const monthCost = issues.filter(i => i.state === 'resolved' && (i.resolvedAt ?? '').slice(0, 7) === monthStart).reduce((s, i) => s + (i.finalAmount ?? 0), 0);

  const base = tab === 'open' ? open.filter(i => !awaitingOwner(i)) : tab === 'approval' ? approval : tab === 'done' ? recentDone : issues;
  const ql = q.trim().toLowerCase();
  const rows = base.filter(i => (!category || i.category === category) && (!building || i.buildingId === building)
    && (!ql || `${i.unitNumber} ${i.propertyName} ${i.title} ${i.vendorName ?? ''}`.toLowerCase().includes(ql)))
    .sort((a, b) => tab === 'open' ? (a.urgency === b.urgency ? b.reportedAt.localeCompare(a.reportedAt) : a.urgency === 'urgent' ? -1 : 1) : b.reportedAt.localeCompare(a.reportedAt));
  const buildingOptions: SelectOption[] = useMemo(() => {
    const m = new Map(issues.map(i => [i.buildingId, i.propertyName]));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [issues]);
  const sel = issues.find(i => i.id === selected) ?? null;
  const historySpend = tab === 'history' ? rows.reduce((s, i) => s + (i.finalAmount ?? 0), 0) : 0;

  const sub = data
    ? `${open.length} open · ${urgent} urgent · ${approval.length} awaiting owner approval${money ? ` · this month ${rm(monthCost, { cents: false })}` : ''}`
    : 'Repairs on every unit';

  async function saveThreshold(sen: number) {
    try { await api.put('/settings', { operations: { maintenanceApprovalThreshold: sen } }); toast({ tone: 'success', title: `Owner approval needed above ${rm(sen)}.` }); setThreshold(false); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again.') }); }
  }
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
        empty={{ title: tab === 'approval' ? 'Nothing is waiting for an owner.' : tab === 'done' ? 'No job finished in the last 30 days.' : tab === 'history' ? 'No jobs yet.' : 'No open repairs.',
          action: tab === 'open' ? { label: 'New job', onClick: () => setCreating(true) } : undefined }} />
    </>
  );

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <PageHeader title="Maintenance" sub={sub}
        actions={<>
          {data && <Button size="sm" variant="secondary" onClick={() => user!.role === 'management' ? setThreshold(true) : toast({ tone: 'info', title: `Owner approval is needed above ${rm(data.threshold)}.`, body: 'Management can change this.' })}>
            Owner approval above {rm(data.threshold, { cents: false })}
          </Button>}
          <Button size="sm" variant={tab === 'templates' ? 'primary' : 'secondary'} icon={<Icon name="ClipboardList" size="sm" />} onClick={() => setTab(tab === 'templates' ? 'open' : 'templates')}>Templates</Button>
          <Button size="sm" variant={tab === 'catalog' ? 'primary' : 'secondary'} icon={<Icon name="Package" size="sm" />} onClick={() => setTab(tab === 'catalog' ? 'open' : 'catalog')}>Parts catalog</Button>
        </>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>New job</Button>} />

      {tab === 'templates' ? (
        <TemplatesPanel money={money} skus={sku.data?.data ?? []} />
      ) : tab === 'catalog' ? (
        <CatalogPanel skus={sku.data?.data ?? []} loading={sku.loading} canWrite={['management', 'operations_manager', 'operations_staff'].includes(user!.role)} onCreate={createSku} onUpdate={updateSku} />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <PillTabs value={tab} onChange={t => { setTab(t); setSelected(null); }} tabs={[
              { value: 'open', label: 'Open', count: open.length - approval.length },
              { value: 'approval', label: 'Awaiting owner approval', count: approval.length },
              { value: 'done', label: 'Done' },
              { value: 'history', label: 'History' },
            ]} />
            <div className="flex gap-2 flex-wrap md:ml-auto">
              {tab === 'history' && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit or issue" aria-label="Search" className={cx(INPUT, 'h-9 w-[200px]')} />}
              <Select label="Category" value={category} onChange={setCategory} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} placeholder="All categories" className="w-[150px]" />
              <Select label="Building" value={building} onChange={setBuilding} options={buildingOptions} placeholder="All buildings" className="w-[170px]" />
            </div>
          </div>
          <SplitPane list={list} open={!!sel} onClose={() => setSelected(null)} width={440}
            empty={<div className="text-center text-copy text-muted-ink p-6 max-w-[260px]"><Icon name="MousePointerClick" size="lg" /><p className="mt-2">Pick a job to see its timeline, repair windows, photos and cost.</p></div>}
            detail={sel ? <IssueDetail key={sel.id} issue={sel} threshold={data!.threshold} money={money} skus={sku.data?.data ?? []} onClose={() => setSelected(null)} onChanged={reload} /> : null} />
        </>
      )}

      {creating && <NewJobModal onClose={() => setCreating(false)} money={money} threshold={data?.threshold ?? 30000} onDone={id => { setCreating(false); reload(); setTab('open'); setSelected(id); }} />}
      {threshold && data && <ThresholdModal value={data.threshold} onClose={() => setThreshold(false)} onSave={sen => void saveThreshold(sen)} />}
    </div>
  );
}

/* ---------- the list ---------- */

const jobLabel = (i: Issue) => `${i.propertyName} ${i.unitNumber}`;
type Move = 'start' | 'end' | 'reopen';
/** Why a ticked job is left alone by a move, or null when the move applies. */
function moveSkip(i: Issue, move: Move): string | null {
  if (move === 'reopen') return i.state === 'resolved' ? null : 'Not finished';
  if (i.state === 'resolved') return 'Already finished';
  if (move === 'start') return i.startedAt ? 'Already started' : awaitingOwner(i) ? "Waiting for the owner's approval" : null;
  return !i.startedAt ? 'Not started' : i.endedAt ? 'Repair already finished' : null;
}
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
    { key: 'issue', label: 'Issue', value: i => i.title, width: 280,
      sub: i => <>From {SOURCE[i.source] ?? i.source}{i.reporter ? ` (${i.reporter})` : ''} · {stamp(i.reportedAt)}{i.windows.length > 0 && ` · window ${stamp(i.windows[0].startsAt)}`}{i.blocksUnit && ' · unit blocked'}</>,
      render: i => <span className="block whitespace-normal text-ink">{i.title}</span> },
    { key: 'category', label: 'Category', value: i => i.category, text: i => CATEGORY[i.category] ?? i.category, width: 120, filter: false },
    { key: 'urgency', label: 'Urgency', type: 'status', value: i => i.urgency,
      status: i => (i.urgency === 'urgent' ? { label: 'Urgent', tone: 'critical' } : { label: 'Normal', tone: 'neutral' }), width: 110, phone: 'meta' },
    { key: 'assignee', label: 'Assigned to', value: i => i.vendorName, text: i => (i.vendorName ? `${i.vendorName} ${i.assigneeKind === 'in_house' ? '(in-house)' : '(contractor)'}` : 'Unassigned'), width: 180,
      render: i => (i.vendorName
        ? <span className="block truncate">{i.vendorName}<span className="text-muted-ink"> {i.assigneeKind === 'in_house' ? '(in-house)' : '(contractor)'}</span></span>
        : <span className="text-danger">Unassigned</span>) },
    ...(money ? [{ key: 'cost', label: 'Cost', type: 'money' as const, value: (i: Issue) => i.finalAmount ?? i.quotedAmount, width: 120, title: 'The final cost, or the quote while the job is open.',
      render: (i: Issue) => { const c = i.finalAmount ?? i.quotedAmount; return c == null ? <span className="text-faint">—</span> : <span className="tabular-nums whitespace-nowrap">{rm(c, { cents: false })}{i.finalAmount == null && <span className="text-muted-ink text-meta"> quote</span>}</span>; } }] : []),
    { key: 'status', label: 'Status', type: 'status', value: i => statusOf(i).label, status: i => { const s = statusOf(i); return { label: s.label, tone: s.tone === 'gold' ? 'neutral' : s.tone }; }, width: 170 },
    { key: 'reported', label: 'Reported', type: 'datetime', value: i => i.reportedAt, hidden: true, width: 150 },
    { key: 'resolved', label: 'Finished', type: 'datetime', value: i => i.resolvedAt, hidden: true, width: 150 },
  ], [money]);

  return (
    <>
      <DataTable<Issue>
        id="maintenance.jobs" columns={columns} rows={rows} rowKey={i => i.id} loading={loading} error={error} onRetry={onRetry}
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

/** One technician or contractor for every ticked job (PATCH each job, as the detail panel does). */
function BulkAssignModal({ rows, onClose, onDone }: { rows: Issue[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const techs = useTechnicians();
  const [who, setWho] = useState<Assignee>({ kind: 'in_house', technicianId: '', contractor: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const { body, error: bad } = assigneeBody(who);
    if (bad) { setError(bad); return; }
    const name = who.kind === 'in_house' ? techs.data?.data.find(t => t.id === who.technicianId)?.name ?? 'the technician' : who.contractor.trim();
    setBusy(true); setError(null);
    const todo = rows.filter(i => i.state !== 'resolved');
    const left = rows.filter(i => i.state === 'resolved').map(i => ({ label: jobLabel(i), reason: 'Finished, reopen it first' }));
    const res = await runEach(todo, i => api.patch(`/maintenance/issues/${i.id}`, body), jobLabel);
    const failed = [...res.failed, ...left];
    toast({
      tone: res.ok === 0 ? 'critical' : failed.length ? 'warning' : 'success',
      title: res.ok ? `${plural(res.ok, 'job')} assigned to ${name}.` : 'No job assigned.',
      body: skippedNote(failed) || undefined,
    });
    onDone();
  }
  return (
    <OpsModal title="Assign jobs" sub={`${plural(rows.length, 'job')} ticked. Each goes to the same technician or contractor.`} onClose={onClose} busy={busy}
      footer={footer(onClose, busy, 'Assign', () => void save())}>
      <AssigneeFields value={who} onChange={v => { setWho(v); setError(null); }} technicians={techs.data} allowNone={false} error={error} />
    </OpsModal>
  );
}

/* ---------- the detail panel ---------- */

function IssueDetail({ issue: i, threshold, money, skus, onClose, onChanged }: { issue: Issue; threshold: number; money: boolean; skus: Sku[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const files = useApi<{ data: FileItem[] }>(`/maintenance/issues/${i.id}/documents`);
  const [busy, setBusy] = useState<string | null>(null);
  const techs = useTechnicians(i.state !== 'resolved');
  const startWho: Assignee = i.assigneeId ? { kind: 'in_house', technicianId: i.assigneeId, contractor: '' }
    : i.vendorName ? { kind: 'contractor', technicianId: '', contractor: i.vendorName } : { kind: 'in_house', technicianId: '', contractor: '' };
  const [who, setWho] = useState<Assignee>(startWho);
  const whoChanged = who.kind !== startWho.kind || who.technicianId !== startWho.technicianId || who.contractor.trim() !== startWho.contractor;
  const checklist = useApi<{ data: ChecklistItem[] }>(`/maintenance/issues/${i.id}/checklist`);
  const [ticks, setTicks] = useState<ChecklistItem[] | null>(null);
  const stepItems = ticks ?? checklist.data?.data ?? null;
  const parts = useApi<{ data: { skuId: string; name: string; code: string; unitLabel: string; plannedQty: number; usedQty: number }[] }>(`/maintenance/issues/${i.id}/parts`);
  const [quoteSen, setQuoteSen] = useState<number | null>(i.quotedAmount);
  const [windowOpen, setWindowOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [exchange, setExchange] = useState(false);
  const done = i.state === 'resolved';
  const media = (files.data?.data ?? []).filter(f => f.kind === 'photo' || f.kind === 'video');
  const docs = (files.data?.data ?? []).filter(f => f.kind !== 'photo' && f.kind !== 'video');

  const refresh = useCallback(() => { files.reload(); parts.reload(); onChanged(); }, [files, parts, onChanged]);
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); return true; }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); return false; }
    finally { setBusy(null); }
  }

  const steps: { label: string; at: string | null; on: boolean; note?: string }[] = [
    { label: 'Reported', at: i.reportedAt, on: true, note: `${SOURCE[i.source] ?? i.source}${i.reporter ? `, ${i.reporter}` : ''}` },
    { label: 'Assigned', at: null, on: !!i.vendorName, note: i.vendorName ?? undefined },
    { label: 'Quote', at: null, on: i.quotedAmount != null, note: money && i.quotedAmount != null ? `${rm(i.quotedAmount)}${i.quotedAmount > threshold && i.chargeTo === 'owner' ? `, above ${rm(threshold, { cents: false })}` : ''}` : undefined },
    { label: i.ownerApprovalRequired ? 'Owner approved' : 'Approval', at: i.ownerApprovedAt, on: !!i.ownerApprovedAt || (i.quotedAmount != null && !awaitingOwner(i)), note: awaitingOwner(i) ? 'Waiting for the owner' : !i.ownerApprovalRequired && i.quotedAmount != null ? 'Not needed' : undefined },
    { label: 'In progress', at: i.startedAt, on: !!i.startedAt },
    { label: 'Done', at: i.resolvedAt, on: done, note: done && money && i.finalAmount != null ? `${rm(i.finalAmount)}, ${PAYER_SHORT[i.chargeTo]}` : undefined },
  ];
  const current = steps.findIndex(s => !s.on);

  return (
    <div className="flex flex-col gap-4 p-5 text-copy">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-meta text-muted-ink">{i.propertyName} · {i.unitNumber}</div>
          <div className="text-title font-semibold">{i.title}</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {i.urgency === 'urgent' && <StatusBadge tone="critical">Urgent</StatusBadge>}
        <StatusBadge tone="neutral">{CATEGORY[i.category] ?? i.category}</StatusBadge>
        <StatusBadge tone={statusOf(i).tone}>{statusOf(i).label}</StatusBadge>
        {i.blocksUnit && <StatusBadge tone="critical">Unit blocked</StatusBadge>}
      </div>
      {i.detail && <p className="m-0 text-ink whitespace-pre-wrap">{i.detail}</p>}
      {i.templateName && <span className="text-meta text-muted-ink">From the template {i.templateName}</span>}
      {i.doneNote && <div className="rounded-control bg-muted p-2.5"><span className="block text-meta text-muted-ink">Technician's note{i.endedAt ? `, ${stamp(i.endedAt)}` : ''}</span>{i.doneNote}</div>}

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
          <span>The quote{money && i.quotedAmount != null ? ` of ${rm(i.quotedAmount)}` : ''} is above {rm(threshold, { cents: false })}, so the owner approves it first. Work cannot start until then.</span>
          {money && <Button size="sm" variant="secondary" className="self-start" loading={busy === 'approve'}
            onClick={() => void act('approve', () => api.post(`/maintenance/issues/${i.id}/approve`, { approved: true, quotedAmount: i.quotedAmount }), 'Approval recorded.', 'The job can go ahead.')}>Record owner's approval</Button>}
        </div>
      )}

      {!done && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">Assigned to {i.vendorName && <span className="text-muted-ink font-normal">· now {i.vendorName}{i.assigneeId ? ' (on their phone)' : i.assigneeKind === 'in_house' ? ' (no account: not on any phone)' : ''}</span>}</h3>
          <AssigneeFields label="Who" value={who} onChange={setWho} technicians={techs.data} allowNone={false} />
          <Button size="sm" variant="secondary" className="self-start" disabled={!whoChanged || !!assigneeBody(who).error} disabledReason={assigneeBody(who).error ?? 'Pick someone else first.'}
            loading={busy === 'assign'} onClick={() => void act('assign', () => api.patch(`/maintenance/issues/${i.id}`, assigneeBody(who).body), 'Job assigned.')}>Save</Button>
        </section>
      )}

      {(stepItems?.length || !done) && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-copy font-semibold">Checklist {stepItems && stepItems.length > 0 && <span className="text-muted-ink font-normal">{stepItems.filter(c => c.done).length} of {stepItems.length}</span>}</h3>
          {stepItems ? <Checklist taskId={i.id} endpoint={`/maintenance/issues/${i.id}/checklist`} items={stepItems} readOnly={done} onChange={setTicks} /> : <Skeleton height={60} />}
        </section>
      )}

      {(parts.data?.data.length ?? 0) > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-copy font-semibold">Parts</h3>
          {parts.data!.data.map(p => (
            <div key={p.skuId} className="flex items-center gap-2 min-h-8">
              <span className="flex-1 min-w-0 truncate">{p.name} <span className="text-muted-ink">{p.code}</span></span>
              <span className="tabular-nums text-muted-ink whitespace-nowrap">{p.plannedQty > 0 && `planned ${p.plannedQty} · `}used <b className="text-ink">{p.usedQty}</b></span>
            </div>
          ))}
        </section>
      )}

      {money && !done && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">Quote</h3>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0"><MoneyInput prefix className={INPUT} valueSen={quoteSen} onChangeSen={setQuoteSen} aria-label="Quote in RM" /></div>
            <Button size="sm" variant="secondary" className="h-10" disabled={quoteSen === i.quotedAmount} disabledReason="Change the amount first."
              loading={busy === 'quote'} onClick={() => void act('quote', () => api.patch(`/maintenance/issues/${i.id}`, { quotedAmount: quoteSen }), 'Quote saved.',
                quoteSen != null && quoteSen > threshold && i.chargeTo === 'owner' && !i.ownerApprovedAt ? 'Above the threshold: the job now waits for the owner.' : undefined)}>Save quote</Button>
          </div>
          <span className="text-meta text-muted-ink">Above {rm(threshold, { cents: false })}, a repair the owner pays waits for the owner's approval.</span>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-copy font-semibold">Who pays</h3>
        <div className="grid grid-cols-1 gap-1">
          {(['owner', 'the_conts', 'guest_deposit'] as ChargeTo[]).concat(i.chargeTo === 'warranty' ? ['warranty'] : []).map(p => (
            <label key={p} className={cx('flex items-center gap-2 min-h-8', done ? 'cursor-default' : 'cursor-pointer')}>
              <input type="radio" name={`payer-${i.id}`} checked={i.chargeTo === p} disabled={done || busy === 'payer'} className="w-4 h-4 accent-black"
                onChange={() => void act('payer', () => api.patch(`/maintenance/issues/${i.id}`, { chargeTo: p }), 'Payer changed.')} />
              {PAYER[p]}
            </label>
          ))}
        </div>
      </section>

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
              {w.overlaps.map(o => <span key={o.reservationId} className="text-meta text-danger">Overlaps the stay of {o.guestName} ({dateShort(o.checkIn)} {o.checkInTime} to {dateShort(o.checkOut)} {o.checkOutTime}). Make sure the guest agreed.</span>)}
            </div>
          ))}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-copy font-semibold">Before and after <span className="text-muted-ink font-normal">{media.length} {media.length === 1 ? 'file' : 'files'}</span></h3>
        {files.loading && !files.data ? <Skeleton height={80} /> : <MediaGrid items={media} cols={3} />}
        {!done && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <MediaDrop compact label="Add before" upload={uploadTo(`/maintenance/issues/${i.id}/photos`, { kind: 'before' })} onDone={refresh} />
            <MediaDrop compact label="Add after" upload={uploadTo(`/maintenance/issues/${i.id}/photos`, { kind: 'after' })} onDone={refresh} />
          </div>
        )}
      </section>

      {money && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">Invoice and receipts</h3>
          {docs.map(d => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="text-gold-ink truncate">{d.kind === 'invoice' ? 'Invoice' : d.kind === 'pod' ? 'Proof of work' : 'File'}: {d.fileName}</a>)}
          <label className="self-start">
            <span className="inline-flex items-center gap-2 h-8 px-3 rounded-control border border-solid border-line bg-card cursor-pointer text-copy hover:bg-muted"><Icon name="Upload" size="sm" />Upload invoice</span>
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (f) void act('invoice', () => uploadTo(`/maintenance/issues/${i.id}/documents`, { kind: 'invoice' })(f), 'Invoice attached.');
            }} />
          </label>
        </section>
      )}

      {done ? (
        <div className="flex flex-col gap-2">
          {money && i.finalAmount != null && <p className="m-0">Final cost {rm(i.finalAmount)}, {PAYER[i.chargeTo].toLowerCase()}{i.expensed ? '. Recorded as an expense on the unit.' : '.'}</p>}
          {money && <Button variant="secondary" loading={busy === 'reopen'} onClick={() => void act('reopen', () => api.patch(`/maintenance/issues/${i.id}`, { state: 'reopened' }), 'Job reopened.')}>Reopen</Button>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            {!i.blocksUnit && <Button variant="secondary" className="flex-1" icon={<Icon name="Ban" size="sm" />} onClick={() => setBlockOpen(true)}>Block unit until fixed</Button>}
            {skus.some(s => s.trackStock && s.active && s.stockOnHand > 0) && <Button variant="secondary" className="flex-1" icon={<Icon name="PackageMinus" size="sm" />} onClick={() => setExchange(true)}>Draw a part</Button>}
          </div>
          <div className="flex gap-2">
            {!i.startedAt && <Button variant="secondary" className="flex-1" loading={busy === 'start'} disabled={awaitingOwner(i)} disabledReason="Waiting for the owner's approval."
              onClick={() => void act('start', () => api.post(`/maintenance/issues/${i.id}/start`, {}), 'Repair started.')}>Start repair</Button>}
            {money && <Button variant="primary" className="flex-1" disabled={awaitingOwner(i)} disabledReason="Waiting for the owner's approval." onClick={() => setCompleteOpen(true)}>Mark done</Button>}
          </div>
        </div>
      )}

      <HistoryDisclosure entity="maintenance_issues" id={i.id} refreshKey={i} />

      {windowOpen && <WindowModal issue={i} onClose={() => setWindowOpen(false)} onDone={(n) => { setWindowOpen(false); toast({ tone: n ? 'warning' : 'success', title: 'Repair window added.', body: n ? `It overlaps ${n} ${n === 1 ? 'stay' : 'stays'}. Make sure the guest agreed.` : 'No guest is in the unit then.' }); refresh(); }} />}
      {blockOpen && <BlockModal issue={i} onClose={() => setBlockOpen(false)} onDone={() => { setBlockOpen(false); toast({ tone: 'success', title: 'Unit blocked.', body: 'The dates are off sale on the calendar until the repair is done.' }); refresh(); }} />}
      {completeOpen && <CompleteModal issue={i} onClose={() => setCompleteOpen(false)} onDone={() => { setCompleteOpen(false); toast({ tone: 'success', title: 'Job done.', body: 'The cost is on the unit as an expense.' }); refresh(); }} />}
      {exchange && <ExchangeModal jobLabel={`${i.propertyName} ${i.unitNumber} · ${i.title}`} skus={skus.filter(s => s.active)} onClose={() => setExchange(false)}
        onExchange={(s, qty) => { setExchange(false); void act('exchange', () => api.post(`/maintenance/issues/${i.id}/exchange`, { skuId: s.id, qty }), 'Drawn from stock.', `${qty} x ${s.name}.`); }} />}
    </div>
  );
}

/* ---------- dialogs ---------- */

function footer(onClose: () => void, busy: boolean, label: string, onSave: () => void) {
  return <><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={onSave}>{label}</Button></>;
}
const errText = (e: unknown) => errorMessage(e, 'Not saved. Try again.');

function NewJobModal({ onClose, onDone, money, threshold }: { onClose: () => void; onDone: (id: string) => void; money: boolean; threshold: number }) {
  const units = useUnitRoster();
  const templates = useTemplates();
  const techs = useTechnicians();
  const [f, setF] = useState({ unitId: '', title: '', category: 'other', urgency: 'normal', reportSource: 'staff', detail: '', chargeTo: 'owner' });
  const [who, setWho] = useState<Assignee>({ kind: '', technicianId: '', contractor: '' });
  const [templateId, setTemplateId] = useState('');
  const [blocksUnit, setBlocksUnit] = useState(false);
  const [quoteSen, setQuoteSen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ unitId?: string; title?: string; assignee?: string; form?: string }>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const tpl = templates.data?.data.find(t => t.id === templateId) ?? null;
  function pickTemplate(t: typeof tpl) {
    setTemplateId(t?.id ?? '');
    if (!t) return;
    setF(x => ({ ...x, title: t.name, category: t.category, urgency: t.urgency }));
    setWho(assigneeOf(t));
    setBlocksUnit(t.blocksUnit);
    if (money) setQuoteSen(t.estimatedCost);
    setError({});
  }
  async function save() {
    const who_ = assigneeBody(who);
    const bad = { unitId: f.unitId ? undefined : 'Pick the unit.', title: f.title.trim() ? undefined : 'Say what is wrong.', assignee: who_.error ?? undefined };
    if (bad.unitId || bad.title || bad.assignee) { setError(bad); return; }
    setBusy(true); setError({});
    try {
      const r = await api.post<{ id: string }>('/maintenance/issues', {
        unitId: f.unitId, title: f.title.trim(), detail: f.detail.trim() || undefined, category: f.category, urgency: f.urgency, reportSource: f.reportSource,
        ...who_.body, templateId: templateId || undefined, blocksUnit,
        quotedAmount: money && quoteSen != null ? quoteSen : undefined, chargeTo: f.chargeTo,
      });
      onDone(r.id);
    } catch (e) {
      const fields = e instanceof ApiFailure ? e.fields ?? {} : {};
      const assignee = fields.assigneeUserId ?? fields.assigneeName;
      setError({ unitId: fields.unitId, title: fields.title, assignee, form: fields.unitId || fields.title || assignee ? undefined : errText(e) }); setBusy(false);
    }
  }
  return (
    <OpsModal title="New job" sub="A repair on one unit." onClose={onClose} busy={busy} width={560} footer={footer(onClose, busy, 'Open job', () => void save())}>
      <TemplatePicker templates={templates.data?.data ?? null} value={templateId} onPick={pickTemplate} />
      {tpl && (
        <div className="rounded-control bg-muted p-2.5 text-meta text-muted-ink flex flex-col gap-0.5">
          <span>{tpl.steps.length ? `Checklist of ${plural(tpl.steps.length, 'step')}` : 'No checklist'}{tpl.parts.length ? ` · parts: ${tpl.parts.map(p => `${p.qty} x ${p.name}`).join(', ')}` : ''}</span>
          {tpl.instructions && <span className="text-ink">{tpl.instructions}</span>}
        </div>
      )}
      <FormRow label="Unit" error={error.unitId}><SearchSelect label="Unit" value={f.unitId} onChange={v => { setF(x => ({ ...x, unitId: v })); setError(x => ({ ...x, unitId: undefined })); }} options={units.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName }))} placeholder="Search units" size="md" /></FormRow>
      <FormRow label="What is wrong" error={error.title}><input className={INPUT} value={f.title} onChange={e => { set('title')(e); setError(x => ({ ...x, title: undefined })); }} placeholder="e.g. Aircon not cooling, guest complained" maxLength={160} /></FormRow>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <FormRow label="Category"><select className={INPUT} value={f.category} onChange={set('category')}>{Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormRow>
        <FormRow label="Urgency"><select className={INPUT} value={f.urgency} onChange={set('urgency')}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></FormRow>
        <FormRow label="Reported by"><select className={INPUT} value={f.reportSource} onChange={set('reportSource')}>{Object.entries(SOURCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormRow>
      </div>
      <FormRow label="Details (optional)"><textarea className={TEXTAREA} value={f.detail} onChange={set('detail')} maxLength={2000} /></FormRow>
      <AssigneeFields label="Assign to (optional)" value={who} onChange={v => { setWho(v); setError(x => ({ ...x, assignee: undefined })); }} technicians={techs.data} error={error.assignee} />
      <label className="flex items-center gap-2 text-copy min-h-8 cursor-pointer">
        <input type="checkbox" className="w-4 h-4 accent-black" checked={blocksUnit} onChange={e => setBlocksUnit(e.target.checked)} />
        Take the unit out of service until fixed
      </label>
      <div className="grid grid-cols-2 gap-3">
        {money && <FormRow label="Quote, RM (optional)" hint={quoteSen != null && quoteSen > threshold && f.chargeTo === 'owner' ? 'Above the threshold: the owner approves first.' : undefined}>
          <MoneyInput className={INPUT} valueSen={quoteSen} onChangeSen={setQuoteSen} aria-label="Quote in RM" /></FormRow>}
        <FormRow label="Who pays"><select className={INPUT} value={f.chargeTo} onChange={set('chargeTo')}>{(['owner', 'the_conts', 'guest_deposit'] as ChargeTo[]).map(p => <option key={p} value={p}>{PAYER[p]}</option>)}</select></FormRow>
      </div>
      {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
    </OpsModal>
  );
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
    catch (e) { setError(e instanceof ApiFailure && e.status === 409 ? 'A booking already holds some of those nights. Pick dates when the unit is free.' : errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="Block unit until fixed" sub={`${issue.propertyName} ${issue.unitNumber} comes off sale for these nights, and shows as under maintenance.`} onClose={onClose} busy={busy} footer={footer(onClose, busy, 'Block unit', () => void save())}>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="First night" error={error}><DateField aria-label="First night" className={INPUT} value={from} onChange={v => v && setFrom(v)} /></FormRow>
        <FormRow label="Back on sale"><DateField aria-label="Back on sale" className={INPUT} value={to} min={from || undefined} onChange={v => v && setTo(v)} /></FormRow>
      </div>
    </OpsModal>
  );
}

function CompleteModal({ issue, onClose, onDone }: { issue: Issue; onClose: () => void; onDone: () => void }) {
  const [amountSen, setAmountSen] = useState<number | null>(issue.quotedAmount);
  const [payer, setPayer] = useState<ChargeTo>(issue.chargeTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const sen = amountSen ?? 0;
    if (sen < 0) { setError('Enter the final cost.'); return; }
    setBusy(true); setError(null);
    try { await api.post(`/maintenance/issues/${issue.id}/complete`, { finalAmount: sen, chargeTo: payer }); onDone(); }
    catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="Mark job done" sub={`${issue.propertyName} ${issue.unitNumber} · ${issue.title}`} onClose={onClose} busy={busy} footer={footer(onClose, busy, 'Mark done', () => void save())}>
      <FormRow label="Final cost, RM" error={error} hint="Recorded as a maintenance expense on the unit. RM 0 records nothing.">
        <MoneyInput className={INPUT} valueSen={amountSen} onChangeSen={setAmountSen} aria-label="Final cost in RM" />
      </FormRow>
      <FormRow label="Who pays">
        <select className={INPUT} value={payer} onChange={e => setPayer(e.target.value as ChargeTo)}>{(['owner', 'the_conts', 'guest_deposit', 'warranty'] as ChargeTo[]).map(p => <option key={p} value={p}>{PAYER[p]}</option>)}</select>
      </FormRow>
      {issue.blocksUnit && <span className="text-meta text-muted-ink">The unit goes back to ready, and the nights blocked for this repair go back on sale.</span>}
    </OpsModal>
  );
}

function ThresholdModal({ value, onClose, onSave }: { value: number; onClose: () => void; onSave: (sen: number) => void }) {
  const [sen, setSen] = useState<number | null>(value);
  const [error, setError] = useState<string | null>(null);
  const phone = !useMedia('(min-width: 640px)');
  return (
    <OpsModal title="Owner approval threshold" sub="A repair the owner pays, quoted above this, waits for the owner's approval before work starts." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" onClick={() => { if (sen == null) { setError('Enter the threshold.'); return; } onSave(sen); }}>Save</Button></>}>
      <FormRow label="Threshold, RM" error={error}><MoneyInput className={cx(INPUT, phone && 'text-heading')} valueSen={sen} onChangeSen={v => { setSen(v); setError(null); }} aria-label="Threshold in RM" /></FormRow>
    </OpsModal>
  );
}
