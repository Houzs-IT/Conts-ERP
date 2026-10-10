import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Select, SearchSelect, type SelectOption } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import SplitPane from '../components/SplitPane';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { useSession } from '../lib/session';
import { useUnitRoster } from '../lib/useUnitRoster';
import { useMedia } from '../lib/useMedia';
import { cx } from '../lib/design-tokens';
import { rm } from '../lib/format';
import {
  Chip, PillTabs, OpsModal, FormRow, INPUT, TEXTAREA, CloseButton, MediaGrid, MediaDrop, uploadTo, CATEGORY, stamp, hm, mytDay,
  type ChipTone, type MediaItem,
} from '../components/ops/OpsUi';
import { CatalogPanel, ExchangeModal, type Sku, type SkuPayload, type CatalogInput } from './MaintenanceCatalog';
import { HistoryDisclosure } from '../components/RecordHistory';

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
  quotedAmount: number | null; finalAmount: number | null; expensed: number | null; skuName: string | null;
}
interface Payload { threshold: number; data: Issue[] }
interface FileItem extends MediaItem { stage: 'before' | 'after' | null; uploadedAt: string }

type Tab = 'open' | 'approval' | 'done' | 'history' | 'catalog';
const PAYER: Record<ChargeTo, string> = { owner: 'Owner (on the statement)', the_conts: 'Company', guest_deposit: 'Guest (from the deposit)', warranty: 'Warranty' };
const PAYER_SHORT: Record<ChargeTo, string> = { owner: 'owner pays', the_conts: 'company pays', guest_deposit: 'guest pays', warranty: 'warranty' };
const SOURCE: Record<string, string> = { guest: 'Guest', cleaner: 'Cleaner', inspection: 'Inspection', staff: 'Office' };
const MONEY_ROLES = ['management', 'finance_admin', 'operations_manager'];

const awaitingOwner = (i: Issue) => i.state !== 'resolved' && i.ownerApprovalRequired && !i.ownerApprovedAt && i.chargeTo === 'owner';
function statusOf(i: Issue): { label: string; tone: ChipTone } {
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

  const { data, loading, error, reload } = useApi<Payload>('/maintenance/issues');
  const issues = data?.data ?? [];
  const sku = useApi<SkuPayload>(tab === 'catalog' || selected ? '/maintenance/skus' : null);

  // A link from a clean (?id=) opens the right tab.
  useEffect(() => {
    const it = issues.find(i => i.id === selected);
    if (it && tab !== 'history' && tab !== 'catalog') setTab(it.state === 'resolved' ? 'done' : awaitingOwner(it) ? 'approval' : 'open');
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
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: e instanceof ApiFailure ? e.message : 'Try again.' }); }
  }
  async function createSku(input: CatalogInput) {
    try { await api.post('/maintenance/skus', input); toast({ tone: 'success', title: 'Item added.' }); sku.reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: e instanceof ApiFailure ? e.message : 'Try again.' }); }
  }
  function updateSku(id: string, delta: Partial<Sku>) {
    api.patch(`/maintenance/skus/${id}`, delta).then(() => { toast({ tone: 'success', title: 'Catalog updated.' }); sku.reload(); })
      .catch(e => toast({ tone: 'critical', title: 'Not saved.', body: e instanceof ApiFailure ? e.message : 'Try again.' }));
  }

  const list = (
    <>
      {error && <StaleBanner message={`Showing the last jobs we have. ${error}`} onRetry={reload} />}
      {tab === 'history' && rows.length > 0 && money && (
        <div className="text-copy text-muted-ink flex-none">{rows.length} {rows.length === 1 ? 'job' : 'jobs'} · {rm(historySpend)} spent{q ? ` matching "${q}"` : ''}</div>
      )}
      <IssueTable rows={rows} loading={loading && !data} selected={selected} onSelect={setSelected} money={money}
        empty={<EmptyState bare icon="Wrench" kind={category || building || q ? 'filtered' : 'empty'}
          title={category || building || q ? 'No jobs match these filters.' : tab === 'approval' ? 'Nothing is waiting for an owner.' : tab === 'done' ? 'No job finished in the last 30 days.' : 'No open repairs.'}
          action={category || building || q ? { label: 'Clear filters', onClick: () => { setCategory(''); setBuilding(''); setQ(''); } } : tab === 'open' ? { label: 'New job', onClick: () => setCreating(true) } : undefined} />} />
    </>
  );

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <PageHeader title="Maintenance" sub={sub}
        actions={<>
          {data && <Button size="sm" variant="secondary" onClick={() => user!.role === 'management' ? setThreshold(true) : toast({ tone: 'info', title: `Owner approval is needed above ${rm(data.threshold)}.`, body: 'Management can change this.' })}>
            Owner approval above {rm(data.threshold, { cents: false })}
          </Button>}
          <Button size="sm" variant={tab === 'catalog' ? 'primary' : 'secondary'} icon={<Icon name="Package" size="sm" />} onClick={() => setTab(tab === 'catalog' ? 'open' : 'catalog')}>Parts catalog</Button>
        </>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>New job</Button>} />

      {tab === 'catalog' ? (
        <CatalogPanel skus={sku.data?.data ?? []} loading={sku.loading} canWrite={['management', 'operations_manager', 'operations_staff'].includes(user!.role)} onCreate={c => void createSku(c)} onUpdate={updateSku} />
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

const COLS = 'md:grid md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] md:gap-2.5 md:items-center';

function IssueTable({ rows, loading, selected, onSelect, money, empty }: { rows: Issue[]; loading: boolean; selected: string | null; onSelect: (id: string) => void; money: boolean; empty: ReactNode }) {
  return (
    <section className="bg-card rounded-card border border-solid border-line overflow-hidden flex-none">
      <div className={cx('hidden text-meta text-muted-ink px-[18px] py-2.5 bg-[#F4F1EB]', COLS)}>
        <div>Unit</div><div>Issue</div><div>Category</div><div>Urgency</div><div>Assigned to</div><div className="text-right">Cost</div><div>Status</div>
      </div>
      {loading ? <div className="p-4 flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} height={44} />)}</div>
        : rows.length === 0 ? empty
        : rows.map(i => {
          const st = statusOf(i);
          const cost = i.finalAmount ?? i.quotedAmount;
          return (
            <div key={i.id} role="button" tabIndex={0} aria-pressed={i.id === selected} onClick={() => onSelect(i.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i.id); } }}
              className={cx('px-4 md:px-[18px] py-3 [border-top:1px_solid_var(--color-line-soft)] first:border-t-0 text-copy cursor-pointer flex flex-col gap-1 outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-gold)]', COLS,
                i.id === selected ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : 'hover:bg-page', i.state === 'resolved' && 'text-muted-ink')}>
              <div className="flex items-baseline gap-2 md:block"><b className="text-ink">{i.unitNumber}</b><div className="text-meta text-muted-ink">{i.propertyName}</div></div>
              <div className="min-w-0">
                <div className="text-ink">{i.title}</div>
                <div className="text-meta text-muted-ink">From {SOURCE[i.source] ?? i.source}{i.reporter ? ` (${i.reporter})` : ''} · {stamp(i.reportedAt)}
                  {i.windows.length > 0 && ` · window ${stamp(i.windows[0].startsAt)}`}{i.blocksUnit && ' · unit blocked'}</div>
              </div>
              <div className="hidden md:block">{CATEGORY[i.category] ?? i.category}</div>
              <div className="flex gap-1.5 flex-wrap md:block">
                {i.urgency === 'urgent' ? <Chip tone="critical">Urgent</Chip> : <span className="hidden md:inline">Normal</span>}
                <span className="md:hidden"><Chip tone="neutral">{CATEGORY[i.category] ?? i.category}</Chip></span>
                <span className="md:hidden"><Chip tone={st.tone}>{st.label}</Chip></span>
              </div>
              <div className={cx('truncate', !i.vendorName && 'text-[var(--color-critical-fg)]')}>{i.vendorName ? <>{i.vendorName}<span className="text-muted-ink"> {i.assigneeKind === 'in_house' ? '(in-house)' : '(contractor)'}</span></> : 'Unassigned'}</div>
              <div className="md:text-right [font-variant-numeric:tabular-nums]">{money && cost != null ? <>{rm(cost, { cents: false })}{i.finalAmount == null && <span className="text-muted-ink text-meta"> quote</span>}</> : <span className="text-faint">—</span>}</div>
              <div className="hidden md:block"><Chip tone={st.tone} className="whitespace-normal">{st.label}</Chip></div>
            </div>
          );
        })}
    </section>
  );
}

/* ---------- the detail panel ---------- */

function IssueDetail({ issue: i, threshold, money, skus, onClose, onChanged }: { issue: Issue; threshold: number; money: boolean; skus: Sku[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const files = useApi<{ data: FileItem[] }>(`/maintenance/issues/${i.id}/documents`);
  const [busy, setBusy] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(i.vendorName ?? '');
  const [assigneeKind, setAssigneeKind] = useState<'in_house' | 'contractor'>(i.assigneeKind ?? 'contractor');
  const [quote, setQuote] = useState(i.quotedAmount != null ? (i.quotedAmount / 100).toFixed(2) : '');
  const [windowOpen, setWindowOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [exchange, setExchange] = useState(false);
  const done = i.state === 'resolved';
  const media = (files.data?.data ?? []).filter(f => f.kind === 'photo' || f.kind === 'video');
  const docs = (files.data?.data ?? []).filter(f => f.kind !== 'photo' && f.kind !== 'video');

  const refresh = useCallback(() => { files.reload(); onChanged(); }, [files, onChanged]);
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); return true; }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' }); return false; }
    finally { setBusy(null); }
  }

  const quoteSen = quote.trim() === '' ? null : Math.round(Number(quote) * 100);
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
        {i.urgency === 'urgent' && <Chip tone="critical">Urgent</Chip>}
        <Chip tone="neutral">{CATEGORY[i.category] ?? i.category}</Chip>
        <Chip tone={statusOf(i).tone}>{statusOf(i).label}</Chip>
        {i.blocksUnit && <Chip tone="critical">Unit blocked</Chip>}
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
        <div className="rounded-control bg-warning-bg text-[var(--color-warning-fg)] p-3 flex flex-col gap-2">
          <span>The quote{money && i.quotedAmount != null ? ` of ${rm(i.quotedAmount)}` : ''} is above {rm(threshold, { cents: false })}, so the owner approves it first. Work cannot start until then.</span>
          {money && <Button size="sm" variant="secondary" className="self-start" loading={busy === 'approve'}
            onClick={() => void act('approve', () => api.post(`/maintenance/issues/${i.id}/approve`, { approved: true, quotedAmount: i.quotedAmount }), 'Approval recorded.', 'The job can go ahead.')}>Record owner's approval</Button>}
        </div>
      )}

      {!done && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">Assigned to</h3>
          <div className="flex gap-2 flex-wrap">
            <input className={cx(INPUT, 'flex-1 min-w-[140px]')} value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Technician or contractor name" aria-label="Assigned to" maxLength={80} />
            <select className={cx(INPUT, 'w-[130px]')} value={assigneeKind} onChange={e => setAssigneeKind(e.target.value as 'in_house' | 'contractor')} aria-label="In-house or contractor">
              <option value="in_house">In-house</option><option value="contractor">Contractor</option>
            </select>
            <Button size="sm" variant="secondary" className="h-10" disabled={!assignee.trim() || (assignee.trim() === (i.vendorName ?? '') && assigneeKind === (i.assigneeKind ?? 'contractor'))} disabledReason="Enter a different name."
              loading={busy === 'assign'} onClick={() => void act('assign', () => api.patch(`/maintenance/issues/${i.id}`, { assigneeName: assignee.trim(), assigneeKind }), 'Job assigned.')}>Save</Button>
          </div>
        </section>
      )}

      {money && !done && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">Quote</h3>
          <div className="flex gap-2">
            <div className="relative flex-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink">RM</span>
              <input className={cx(INPUT, 'pl-10 text-right [font-variant-numeric:tabular-nums]')} inputMode="decimal" value={quote} onChange={e => setQuote(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" aria-label="Quote in RM" /></div>
            <Button size="sm" variant="secondary" className="h-10" disabled={quoteSen === i.quotedAmount || (quoteSen != null && !Number.isFinite(quoteSen))} disabledReason="Change the amount first."
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
              <input type="radio" name={`payer-${i.id}`} checked={i.chargeTo === p} disabled={done || busy === 'payer'} className="w-4 h-4 accent-[#151515]"
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
            <div key={w.id} className={cx('rounded-control p-2.5 flex flex-col gap-1', w.overlaps.length ? 'bg-critical-bg' : 'bg-[#F4F1EB]')}>
              <div className="flex items-center gap-2">
                <b className="flex-1 [font-variant-numeric:tabular-nums]">{stamp(w.startsAt)} – {w.startsAt.slice(0, 10) === w.endsAt.slice(0, 10) ? hm(w.endsAt) : stamp(w.endsAt)}</b>
                {!done && <button type="button" aria-label="Remove window" className="text-muted-ink cursor-pointer hover:text-[var(--color-critical-fg)]" onClick={() => void act(`w-${w.id}`, () => api.del(`/maintenance/issues/${i.id}/windows/${w.id}`), 'Window removed.')}><Icon name="Trash2" size="sm" /></button>}
              </div>
              {w.note && <span className="text-muted-ink">{w.note}</span>}
              {w.overlaps.map(o => <span key={o.reservationId} className="text-meta text-[var(--color-critical-fg)]">Overlaps the stay of {o.guestName} ({o.checkIn} {o.checkInTime} to {o.checkOut} {o.checkOutTime}). Make sure the guest agreed.</span>)}
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
const errText = (e: unknown) => e instanceof ApiFailure ? e.message : 'Not saved. Try again.';

function NewJobModal({ onClose, onDone, money, threshold }: { onClose: () => void; onDone: (id: string) => void; money: boolean; threshold: number }) {
  const units = useUnitRoster();
  const [f, setF] = useState({ unitId: '', title: '', category: 'other', urgency: 'normal', reportSource: 'staff', detail: '', assigneeName: '', assigneeKind: 'contractor', quote: '', chargeTo: 'owner' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const quoteSen = f.quote.trim() ? Math.round(Number(f.quote) * 100) : null;
  async function save() {
    if (!f.unitId) { setError('Pick the unit.'); return; }
    if (!f.title.trim()) { setError('Say what is wrong.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ id: string }>('/maintenance/issues', {
        unitId: f.unitId, title: f.title.trim(), detail: f.detail.trim() || undefined, category: f.category, urgency: f.urgency, reportSource: f.reportSource,
        assigneeName: f.assigneeName.trim() || undefined, assigneeKind: f.assigneeName.trim() ? f.assigneeKind : undefined,
        quotedAmount: money && quoteSen != null && Number.isFinite(quoteSen) ? quoteSen : undefined, chargeTo: f.chargeTo,
      });
      onDone(r.id);
    } catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="New job" sub="A repair on one unit." onClose={onClose} busy={busy} width={540} footer={footer(onClose, busy, 'Open job', () => void save())}>
      <FormRow label="Unit"><SearchSelect label="Unit" value={f.unitId} onChange={v => setF(x => ({ ...x, unitId: v }))} options={units.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName }))} placeholder="Search units" size="md" /></FormRow>
      <FormRow label="What is wrong" error={error}><input className={INPUT} value={f.title} onChange={set('title')} placeholder="e.g. Aircon not cooling, guest complained" maxLength={160} /></FormRow>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <FormRow label="Category"><select className={INPUT} value={f.category} onChange={set('category')}>{Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormRow>
        <FormRow label="Urgency"><select className={INPUT} value={f.urgency} onChange={set('urgency')}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></FormRow>
        <FormRow label="Reported by"><select className={INPUT} value={f.reportSource} onChange={set('reportSource')}>{Object.entries(SOURCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormRow>
      </div>
      <FormRow label="Details (optional)"><textarea className={TEXTAREA} value={f.detail} onChange={set('detail')} maxLength={2000} /></FormRow>
      <div className="grid grid-cols-[1fr_130px] gap-3">
        <FormRow label="Assign to (optional)"><input className={INPUT} value={f.assigneeName} onChange={set('assigneeName')} placeholder="Technician or contractor" maxLength={80} /></FormRow>
        <FormRow label="Kind"><select className={INPUT} value={f.assigneeKind} onChange={set('assigneeKind')}><option value="in_house">In-house</option><option value="contractor">Contractor</option></select></FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {money && <FormRow label="Quote, RM (optional)" hint={quoteSen != null && quoteSen > threshold && f.chargeTo === 'owner' ? 'Above the threshold: the owner approves first.' : undefined}>
          <input className={cx(INPUT, 'text-right')} inputMode="decimal" value={f.quote} onChange={e => setF(x => ({ ...x, quote: e.target.value.replace(/[^\d.]/g, '') }))} placeholder="0.00" /></FormRow>}
        <FormRow label="Who pays"><select className={INPUT} value={f.chargeTo} onChange={set('chargeTo')}>{(['owner', 'the_conts', 'guest_deposit'] as ChargeTo[]).map(p => <option key={p} value={p}>{PAYER[p]}</option>)}</select></FormRow>
      </div>
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
    setBusy(true); setError(null);
    try { const r = await api.post<{ overlaps: unknown[] }>(`/maintenance/issues/${issue.id}/windows`, { startsAt: start, endsAt: end, note: note.trim() || undefined }); onDone(r.overlaps.length); }
    catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="Add repair window" sub={`When the technician may enter ${issue.propertyName} ${issue.unitNumber}. Malaysia time.`} onClose={onClose} busy={busy} footer={footer(onClose, busy, 'Add window', () => void save())}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormRow label="From" error={error}><input type="datetime-local" className={INPUT} value={start} onChange={e => setStart(e.target.value)} /></FormRow>
        <FormRow label="To"><input type="datetime-local" className={INPUT} value={end} onChange={e => setEnd(e.target.value)} /></FormRow>
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
        <FormRow label="First night" error={error}><input type="date" className={INPUT} value={from} onChange={e => e.target.value && setFrom(e.target.value)} /></FormRow>
        <FormRow label="Back on sale"><input type="date" className={INPUT} value={to} onChange={e => e.target.value && setTo(e.target.value)} /></FormRow>
      </div>
    </OpsModal>
  );
}

function CompleteModal({ issue, onClose, onDone }: { issue: Issue; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(issue.quotedAmount != null ? (issue.quotedAmount / 100).toFixed(2) : '');
  const [payer, setPayer] = useState<ChargeTo>(issue.chargeTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const sen = Math.round(Number(amount || '0') * 100);
    if (!Number.isFinite(sen) || sen < 0) { setError('Enter the final cost.'); return; }
    setBusy(true); setError(null);
    try { await api.post(`/maintenance/issues/${issue.id}/complete`, { finalAmount: sen, chargeTo: payer }); onDone(); }
    catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <OpsModal title="Mark job done" sub={`${issue.propertyName} ${issue.unitNumber} · ${issue.title}`} onClose={onClose} busy={busy} footer={footer(onClose, busy, 'Mark done', () => void save())}>
      <FormRow label="Final cost, RM" error={error} hint="Recorded as a maintenance expense on the unit. RM 0 records nothing.">
        <input className={cx(INPUT, 'text-right')} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
      </FormRow>
      <FormRow label="Who pays">
        <select className={INPUT} value={payer} onChange={e => setPayer(e.target.value as ChargeTo)}>{(['owner', 'the_conts', 'guest_deposit', 'warranty'] as ChargeTo[]).map(p => <option key={p} value={p}>{PAYER[p]}</option>)}</select>
      </FormRow>
      {issue.blocksUnit && <span className="text-meta text-muted-ink">The unit goes back to ready. Remove any calendar block that is no longer needed on the Calendar.</span>}
    </OpsModal>
  );
}

function ThresholdModal({ value, onClose, onSave }: { value: number; onClose: () => void; onSave: (sen: number) => void }) {
  const [rmValue, setRm] = useState((value / 100).toFixed(0));
  const phone = !useMedia('(min-width: 640px)');
  return (
    <OpsModal title="Owner approval threshold" sub="A repair the owner pays, quoted above this, waits for the owner's approval before work starts." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" onClick={() => onSave(Math.round(Number(rmValue || '0') * 100))}>Save</Button></>}>
      <FormRow label="Threshold, RM"><input className={cx(INPUT, 'text-right', phone && 'text-heading')} inputMode="decimal" value={rmValue} onChange={e => setRm(e.target.value.replace(/[^\d.]/g, ''))} /></FormRow>
    </OpsModal>
  );
}
