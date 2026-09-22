import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { TONE, cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { rm, dateShort, time, todayMyt } from '../lib/format';
import { TASK } from '../lib/vocabulary';
import type { TaskState } from '../lib/types';
import { useSession } from '../lib/session';
import {
  CatalogPanel, ExchangeModal, SKU_FALLBACK, durationLabel,
  type Sku, type SkuPayload, type CatalogInput,
} from './MaintenanceCatalog';

const SKU_WRITE_ROLES = ['management', 'operations_manager', 'operations_staff'];

// Charge-to is a closed set — the owner statement, a guest's deposit, our own
// pocket, or a warranty claim. Never invent a fifth.
type ChargeTo = 'owner' | 'guest_deposit' | 'the_conts' | 'warranty';
const CHARGE_LABEL: Record<ChargeTo, string> = {
  owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty',
};
const CHARGE_OPTIONS: ChargeTo[] = ['owner', 'guest_deposit', 'the_conts', 'warranty'];

// Technicians and in-house crew that a job can be assigned to. Mirrors the
// technician accounts in Users and the standing vendor list.
const TECHS = ['Hafiz Omar', 'In-house crew', 'AquaFix', 'CoolCare', 'Kiara Interiors'];

interface Issue {
  id: string; unitId?: string; unitNumber: string; propertyName: string; title: string; detail: string | null;
  state: TaskState; vendorName: string | null; quotedAmount: number | null; finalAmount: number | null;
  ownerApprovalRequired: boolean; blocksUnit: boolean; reportedAt: string; chargeTo: ChargeTo;
  assigneeName?: string | null; photoCount?: number; documentCount?: number; ownerApprovedAt?: string | null;
  skuId?: string | null; skuCode?: string | null; skuName?: string | null;
  startedAt?: string | null; endedAt?: string | null;
}
interface Payload { data: Issue[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'MNT-0914', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', title: 'Plumbing works', detail: 'Riser replacement. Unit offline until 22 Sep.', state: 'in_progress', vendorName: 'AquaFix', quotedAmount: 320000, finalAmount: null, ownerApprovalRequired: false, blocksUnit: true, reportedAt: '2026-09-14', chargeTo: 'owner', assigneeName: 'AquaFix', photoCount: 1, documentCount: 0, startedAt: '2026-09-14T09:20:00+08:00', endedAt: null },
    { id: 'MNT-0912', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Curtain replacement quoted', detail: 'Blackout curtains, 3 windows. Awaiting owner approval.', state: 'waiting', vendorName: 'Kiara Interiors', quotedAmount: 89000, finalAmount: null, ownerApprovalRequired: true, blocksUnit: false, reportedAt: '2026-09-12', chargeTo: 'owner', assigneeName: 'Kiara Interiors', photoCount: 0, documentCount: 0 },
    { id: 'MNT-0916', unitNumber: '#B-08-11', propertyName: 'Arcoris', title: 'Broken blind, living room', detail: 'Guest reported on arrival. Inspect before next stay.', state: 'open', vendorName: null, quotedAmount: null, finalAmount: null, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '2026-09-16', chargeTo: 'owner', assigneeName: null, photoCount: 0, documentCount: 0 },
    { id: 'MNT-0910', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Aircon service', detail: 'Quarterly service. Gas top-up not required.', state: 'resolved', vendorName: 'CoolCare', quotedAmount: null, finalAmount: 18000, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '2026-09-10', chargeTo: 'owner', assigneeName: 'CoolCare', photoCount: 2, documentCount: 1 },
    { id: 'MNT-0828', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Water heater replaced', detail: 'Guest reported no hot water. Same-day replacement.', state: 'resolved', vendorName: 'In-house crew', quotedAmount: null, finalAmount: 64000, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '2026-08-28', chargeTo: 'warranty', assigneeName: 'In-house crew', photoCount: 2, documentCount: 1 },
  ],
};

const FILTERS = ['All', 'Needs approval', 'Blocking a unit', 'Open', 'Resolved'];

// Attention-first order. Overdue and reopened sit above quiet work; resolved
// sinks to the bottom. Every state renders its own section when it has rows.
const GROUP_ORDER: TaskState[] = ['overdue', 'reopened', 'waiting', 'in_progress', 'assigned', 'open', 'resolved'];

const INPUT_CX = 'block w-full box-border h-10 px-3 py-0 text-ink bg-white border border-solid border-line rounded-control outline-none font-sans text-[16px] font-normal';
const LABEL_CX = 'text-[12px] font-medium text-muted-ink';

const toSen = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export default function MaintenancePage() {
  const [tab, setTab] = useState<'jobs' | 'catalog'>('jobs');
  const [filter, setFilter] = useState('All');
  const { data, loading, error, reload } = useApi<Payload>('/maintenance/issues', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWriteSku = SKU_WRITE_ROLES.includes(user?.role ?? '');

  // ---- SKU catalog (master data) with the same optimistic overlay as jobs ----
  const skuQuery = useApi<SkuPayload>('/maintenance/skus', SKU_FALLBACK);
  const [skuAdded, setSkuAdded] = useState<Sku[]>([]);
  const [skuEdits, setSkuEdits] = useState<Record<string, Partial<Sku>>>({});
  const skus = useMemo(
    () => [...skuAdded, ...(skuQuery.data?.data ?? [])].map(s => ({ ...s, ...skuEdits[s.id] })),
    [skuAdded, skuQuery.data, skuEdits],
  );
  const activeSkus = useMemo(() => skus.filter(s => s.active), [skus]);

  // Optimistic overlay: created jobs live in `added`, every edit lands in
  // `edits` keyed by id. There is no backend in dev, so the real call is
  // attempted and its failure swallowed — the interaction still lands.
  const [added, setAdded] = useState<Issue[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Issue>>>({});

  const merged = useMemo(
    () => [...added, ...(data?.data ?? [])].map(i => ({ ...i, ...edits[i.id] })),
    [added, data, edits],
  );

  const patch = (id: string, delta: Partial<Issue>) =>
    setEdits(e => ({ ...e, [id]: { ...e[id], ...delta } }));
  const bumpCount = (issue: Issue, field: 'photoCount' | 'documentCount') =>
    setEdits(e => {
      const cur = (e[issue.id]?.[field] ?? issue[field] ?? 0) as number;
      return { ...e, [issue.id]: { ...e[issue.id], [field]: cur + 1 } };
    });
  const fire = (p: Promise<unknown>) => { void p.catch(notifyFailure); };

  // Modal state
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<Issue | null>(null);
  const [completeFor, setCompleteFor] = useState<Issue | null>(null);
  const [photoFor, setPhotoFor] = useState<Issue | null>(null);
  const [docFor, setDocFor] = useState<Issue | null>(null);
  const [exchangeFor, setExchangeFor] = useState<Issue | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'approval' | 'block' | 'reopen'; issue: Issue } | null>(null);
  const canExchange = activeSkus.some(s => s.trackStock && s.stockOnHand > 0);

  const rows = merged.filter(i =>
    filter === 'All' ? true
    : filter === 'Needs approval' ? i.ownerApprovalRequired && !i.ownerApprovedAt
    : filter === 'Blocking a unit' ? i.blocksUnit
    : filter === 'Resolved' ? i.state === 'resolved'
    : i.state !== 'resolved');

  const groups = GROUP_ORDER
    .map(state => ({ state, items: rows.filter(i => i.state === state) }))
    .filter(g => g.items.length > 0);

  // ---- Actions -------------------------------------------------------------

  function createJob(input: Omit<Issue, 'id' | 'state' | 'finalAmount' | 'ownerApprovalRequired' | 'reportedAt' | 'photoCount' | 'documentCount'>) {
    const optimistic: Issue = {
      ...input, id: `MNT-${Math.floor(1000 + Math.random() * 9000)}`, state: 'open',
      finalAmount: null, ownerApprovalRequired: false, reportedAt: todayMyt(),
      photoCount: 0, documentCount: 0, ownerApprovedAt: null,
    };
    setAdded(a => [optimistic, ...a]);
    setCreating(false);
    toast({
      tone: 'success', title: 'Job created.',
      body: `${optimistic.propertyName} ${optimistic.unitNumber} now has an open maintenance issue${optimistic.blocksUnit ? ' and is off sale' : ''}.`,
    });
    fire(api.post('/maintenance/issues', {
      unitId: optimistic.unitNumber, propertyName: optimistic.propertyName, title: optimistic.title, detail: optimistic.detail,
      photoIds: [], blocksUnit: optimistic.blocksUnit, quotedAmount: optimistic.quotedAmount, chargeTo: optimistic.chargeTo,
      skuId: optimistic.skuId ?? null,
    }));
  }

  function assignTechnician(issue: Issue, tech: string) {
    patch(issue.id, { assigneeName: tech, state: issue.state === 'open' ? 'assigned' : issue.state });
    setAssignFor(null);
    toast({ tone: 'success', title: `${tech} assigned.`, body: 'They have been notified by push.' });
    fire(api.patch(`/maintenance/issues/${issue.id}`, { assigneeId: tech }));
  }

  function requestApproval(issue: Issue) {
    patch(issue.id, { ownerApprovalRequired: true, state: 'waiting' });
    setConfirm(null);
    toast({ tone: 'success', title: 'Sent for approval.', body: 'The owner sees the quote in their portal. Work is not scheduled until they approve.' });
    fire(api.post(`/maintenance/issues/${issue.id}/request-approval`, {}));
  }

  function blockUnit(issue: Issue) {
    patch(issue.id, { blocksUnit: true });
    setConfirm(null);
    toast({ tone: 'success', title: 'Unit blocked.', body: `${issue.propertyName} ${issue.unitNumber} is off sale and the dates are held.` });
    fire(api.post('/blocks', { unitId: issue.unitId ?? issue.unitNumber, propertyName: issue.propertyName, reason: 'maintenance', issueId: issue.id }));
  }

  function attachPhoto(issue: Issue, kind: 'Before' | 'After') {
    bumpCount(issue, 'photoCount');
    setPhotoFor(null);
    toast({ tone: 'success', title: `${kind} photo added.`, body: 'Kept as evidence on the job.' });
    fire(api.post(`/maintenance/issues/${issue.id}/photos`, { kind: kind.toLowerCase() }));
  }

  function attachDocument(issue: Issue, kind: 'POD' | 'Invoice') {
    bumpCount(issue, 'documentCount');
    setDocFor(null);
    toast({ tone: 'success', title: `${kind} uploaded.`, body: 'Attached to the job for the owner statement.' });
    fire(api.post(`/maintenance/issues/${issue.id}/documents`, { kind: kind.toLowerCase() }));
  }

  function markComplete(issue: Issue, finalAmount: number) {
    patch(issue.id, { state: 'resolved', finalAmount, blocksUnit: false, ownerApprovalRequired: false });
    setCompleteFor(null);
    toast({
      tone: 'success', title: 'Marked complete.',
      body: `The ${rm(finalAmount)} expense was created${issue.blocksUnit ? ` and ${issue.unitNumber} is back on sale` : ''}.`,
    });
    fire(api.post(`/maintenance/issues/${issue.id}/complete`, { finalAmount }));
  }

  function reopen(issue: Issue) {
    patch(issue.id, { state: 'reopened', finalAmount: null });
    setConfirm(null);
    toast({ tone: 'warning', title: 'Reopened.', body: `${issue.title} is active again.` });
    fire(api.patch(`/maintenance/issues/${issue.id}`, { state: 'reopened' }));
  }

  function startWork(issue: Issue) {
    const startedAt = new Date().toISOString();
    patch(issue.id, { state: 'in_progress', startedAt, endedAt: null });
    toast({ tone: 'success', title: 'Work started.', body: `The clock is running on ${issue.title}.` });
    fire(api.post(`/maintenance/issues/${issue.id}/start`, {}));
  }

  function endWork(issue: Issue) {
    const endedAt = new Date().toISOString();
    const started = edits[issue.id]?.startedAt ?? issue.startedAt;
    patch(issue.id, { endedAt });
    const dur = durationLabel(started, endedAt);
    toast({ tone: 'success', title: 'Work ended.', body: dur ? `Took ${dur}. Mark it complete to raise the expense.` : 'Mark it complete to raise the expense.' });
    fire(api.post(`/maintenance/issues/${issue.id}/end`, {}));
  }

  // ---- SKU catalog actions -------------------------------------------------

  function createSku(input: CatalogInput) {
    const optimistic: Sku = {
      id: `SKU-${Math.floor(1000 + Math.random() * 9000)}`, code: input.code, name: input.name,
      category: input.category, unitLabel: input.unitLabel, defaultPrice: input.defaultPrice,
      trackStock: input.trackStock, stockOnHand: input.stockOnHand, active: true, notes: input.notes,
    };
    setSkuAdded(a => [optimistic, ...a]);
    toast({ tone: 'success', title: 'Item added.', body: `${input.name} is in the catalog at ${rm(input.defaultPrice)}.` });
    fire(api.post('/maintenance/skus', input));
  }

  function updateSku(id: string, delta: Partial<Sku>) {
    setSkuEdits(e => ({ ...e, [id]: { ...e[id], ...delta } }));
    toast({ tone: 'success', title: 'Catalog updated.', body: delta.active === false ? 'Item retired.' : delta.active === true ? 'Item restored.' : 'Changes saved.' });
    const body: Record<string, unknown> = {};
    if (delta.name !== undefined) body.name = delta.name;
    if (delta.category !== undefined) body.category = delta.category;
    if (delta.unitLabel !== undefined) body.unitLabel = delta.unitLabel;
    if (delta.defaultPrice !== undefined) body.defaultPrice = delta.defaultPrice;
    if (delta.trackStock !== undefined) body.trackStock = delta.trackStock;
    if (delta.stockOnHand !== undefined) body.stockOnHand = delta.stockOnHand;
    if (delta.notes !== undefined) body.notes = delta.notes;
    if (delta.active !== undefined) body.active = delta.active;
    fire(api.patch(`/maintenance/skus/${id}`, body));
  }

  function requestExchange(issue: Issue, sku: Sku, qty: number) {
    // Optimistically decrement the SKU's stock; the ledger row is the server's job.
    setSkuEdits(e => {
      const cur = (e[sku.id]?.stockOnHand ?? sku.stockOnHand) as number;
      return { ...e, [sku.id]: { ...e[sku.id], stockOnHand: Math.max(0, cur - qty) } };
    });
    setExchangeFor(null);
    toast({ tone: 'success', title: 'Drawn from stock.', body: `${qty} × ${sku.name} taken for ${issue.title}.` });
    fire(api.post(`/maintenance/issues/${issue.id}/exchange`, { skuId: sku.id, qty }));
  }

  // ---- Confirmation dialog spec -------------------------------------------

  const dialogSpec: DialogSpec | null = !confirm ? null
    : confirm.kind === 'approval' ? {
        title: `Send ${rm(confirm.issue.quotedAmount ?? 0)} to the owner for approval?`,
        body: 'They receive the quote and the reason. Work is not scheduled until they approve.',
        meta: `${confirm.issue.propertyName} ${confirm.issue.unitNumber} · ${confirm.issue.vendorName ?? 'no vendor yet'}`,
        confirmLabel: 'Send', onConfirm: () => requestApproval(confirm.issue),
      }
    : confirm.kind === 'block' ? {
        title: `Block ${confirm.issue.propertyName} ${confirm.issue.unitNumber}?`,
        body: 'This holds the dates and takes the unit off sale until the work is done.',
        meta: `${confirm.issue.title} · reported ${dateShort(confirm.issue.reportedAt)}`,
        danger: true, confirmLabel: 'Block unit', onConfirm: () => blockUnit(confirm.issue),
      }
    : {
        title: `Reopen ${confirm.issue.title}?`,
        body: 'This moves the issue back to active work. Its expense and the unit are affected again.',
        meta: `${confirm.issue.propertyName} ${confirm.issue.unitNumber} · was ${TASK[confirm.issue.state].label.toLowerCase()}`,
        danger: true, confirmLabel: 'Reopen', onConfirm: () => reopen(confirm.issue),
      };

  const openCount = merged.filter(i => i.state !== 'resolved').length;
  const approvalCount = merged.filter(i => i.ownerApprovalRequired && !i.ownerApprovedAt).length;
  const blockingCount = merged.filter(i => i.blocksUnit).length;

  return (
    <>
      <PageHeader
        title="Maintenance"
        sub={tab === 'catalog'
          ? 'Repair-item catalog and preset selling prices'
          : `${openCount} open · ${approvalCount} awaiting owner approval · ${blockingCount} blocking a unit`}
        right={tab === 'jobs' ? <Button variant="primary" onClick={() => setCreating(true)}>Create job</Button> : undefined}
      />

      <div className="flex gap-[7px] flex-wrap">
        {(['jobs', 'catalog'] as const).map(t => {
          const on = t === tab;
          return (
            <button key={t} onClick={() => setTab(t)}
              className={cx('h-9 flex items-center px-4 py-0 rounded-full cursor-pointer whitespace-nowrap [font:inherit] border border-solid text-[13px] font-medium',
                on ? 'border-black bg-black text-white' : 'border-line bg-white text-muted-ink')}>
              {t === 'jobs' ? 'Jobs' : 'SKU catalog'}
            </button>
          );
        })}
      </div>

      {tab === 'catalog' ? (
        <>
          {skuQuery.error && <StaleBanner message={`Showing the last catalog we have. ${skuQuery.error}`} onRetry={skuQuery.reload} />}
          <CatalogPanel skus={skus} loading={skuQuery.loading} canWrite={canWriteSku} onCreate={createSku} onUpdate={updateSku} />
        </>
      ) : (
      <>
      {error && <StaleBanner message={`Showing the last issues we have. ${error}`} onRetry={reload} />}

      <div className="flex gap-[7px] flex-wrap">
        {FILTERS.map(fl => {
          const on = fl === filter;
          return (
            <button key={fl} onClick={() => setFilter(fl)}
              className={cx('h-8 flex items-center px-[13px] py-0 rounded-full cursor-pointer whitespace-nowrap [font:inherit] border border-solid',
                on ? 'border-black bg-black text-white' : 'border-line bg-white text-muted-ink')}>
              {fl}
            </button>
          );
        })}
      </div>

      {loading && merged.length === 0 ? (
        <Card><TableSkeleton rows={4} cols={3} /></Card>
      ) : rows.length === 0 ? (
        <Card>
          <div className="px-[22px] py-[28px] flex flex-col gap-2">
            <span className="text-[13px]">No maintenance issues match these filters.</span>
            <button onClick={() => setFilter('All')} className="self-start text-gold-ink bg-transparent border-none cursor-pointer [font:inherit]">Clear filters</button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(g => (
            <div key={g.state} className="flex flex-col gap-2">
              <div className="flex items-center gap-[9px] pl-0.5">
                <Badge tone={TASK[g.state].tone} label={TASK[g.state].label} />
                <span className="text-[12px] text-muted-ink">{g.items.length}</span>
              </div>
              <Card>
                {g.items.map((i, idx) => (
                  <IssueRow
                    key={i.id}
                    issue={i}
                    last={idx === g.items.length - 1}
                    onAssign={() => setAssignFor(i)}
                    onRequestApproval={() => setConfirm({ kind: 'approval', issue: i })}
                    onBlock={() => setConfirm({ kind: 'block', issue: i })}
                    onPhoto={() => setPhotoFor(i)}
                    onDoc={() => setDocFor(i)}
                    onComplete={() => setCompleteFor(i)}
                    onReopen={() => setConfirm({ kind: 'reopen', issue: i })}
                    onStart={() => startWork(i)}
                    onEnd={() => endWork(i)}
                    onExchange={() => setExchangeFor(i)}
                    canExchange={canExchange}
                  />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {/* Confirmations: request approval, block unit, reopen */}
      <Dialog busy={false} onClose={() => setConfirm(null)} spec={dialogSpec} />

      {creating && <CreateJobModal skus={activeSkus} onClose={() => setCreating(false)} onCreate={createJob} />}
      {assignFor && <AssignModal issue={assignFor} onClose={() => setAssignFor(null)} onAssign={assignTechnician} />}
      {photoFor && <PhotoModal issue={photoFor} onClose={() => setPhotoFor(null)} onAttach={attachPhoto} />}
      {docFor && <DocumentModal issue={docFor} onClose={() => setDocFor(null)} onAttach={attachDocument} />}
      {exchangeFor && (
        <ExchangeModal
          jobLabel={`${exchangeFor.propertyName} ${exchangeFor.unitNumber} · ${exchangeFor.title}`}
          skus={activeSkus}
          onClose={() => setExchangeFor(null)}
          onExchange={(sku, qty) => requestExchange(exchangeFor, sku, qty)}
        />
      )}
      {completeFor && (
        <CompleteModal
          issue={{ ...completeFor, photoCount: edits[completeFor.id]?.photoCount ?? completeFor.photoCount ?? 0 }}
          onClose={() => setCompleteFor(null)}
          onComplete={markComplete}
          onNeedsPhoto={() => { setPhotoFor(completeFor); setCompleteFor(null); }}
        />
      )}
    </>
  );
}

// ---- Row -------------------------------------------------------------------

function IssueRow({
  issue: i, last, onAssign, onRequestApproval, onBlock, onPhoto, onDoc, onComplete, onReopen, onStart, onEnd, onExchange, canExchange,
}: {
  issue: Issue; last: boolean;
  onAssign: () => void; onRequestApproval: () => void; onBlock: () => void;
  onPhoto: () => void; onDoc: () => void; onComplete: () => void; onReopen: () => void;
  onStart: () => void; onEnd: () => void; onExchange: () => void; canExchange: boolean;
}) {
  const resolved = i.state === 'resolved';
  const photos = i.photoCount ?? 0;
  const docs = i.documentCount ?? 0;
  const evidence = [
    photos > 0 ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : null,
    docs > 0 ? `${docs} ${docs === 1 ? 'document' : 'documents'}` : null,
  ].filter(Boolean).join(' · ');

  const approvalPending = i.ownerApprovalRequired && !i.ownerApprovedAt && i.chargeTo === 'owner';
  const duration = durationLabel(i.startedAt, i.endedAt);
  const canStart = !resolved && !i.startedAt && !approvalPending;
  const canEnd = !resolved && !!i.startedAt && !i.endedAt;

  return (
    <div className={cx('px-5 py-[15px] flex flex-col gap-2.5', !last && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-[3px] min-w-[220px] flex-1">
          <div className="flex items-center gap-[9px] flex-wrap">
            <span className="font-mono text-[11px] text-muted-ink">{i.id}</span>
            <span className="text-[14px] font-semibold">{i.title}</span>
            {i.blocksUnit && <Badge tone="critical" label="Blocks the unit" />}
          </div>
          <span className="text-[12px] text-muted-ink">
            {i.propertyName} {i.unitNumber} · reported {dateShort(i.reportedAt)}
            {i.skuCode ? ` · ${i.skuCode}` : ''}
            {i.assigneeName ? ` · ${i.assigneeName}` : i.vendorName ? ` · ${i.vendorName}` : ''}
            {evidence ? ` · ${evidence}` : ''}
          </span>
          {(i.startedAt || duration) && (
            <span className="text-[12px] text-muted-ink flex items-center gap-1.5 flex-wrap">
              {i.startedAt && <span>Started {time(i.startedAt)}</span>}
              {i.endedAt && <span>· ended {time(i.endedAt)}</span>}
              {duration && <Badge tone="info" label={`Took ${duration}`} size="sm" />}
              {i.startedAt && !i.endedAt && !resolved && <Badge tone="warning" label="In progress" size="sm" />}
            </span>
          )}
          {i.detail && <span className="text-[13px] text-pretty">{i.detail}</span>}
        </div>
        <div className="flex flex-col items-end gap-1 flex-none">
          <span className="text-[16px] font-semibold">
            {i.finalAmount != null ? rm(i.finalAmount) : i.quotedAmount != null ? rm(i.quotedAmount) : '—'}
          </span>
          <span className="text-[11px] text-muted-ink">
            {i.finalAmount != null ? 'Final' : i.quotedAmount != null ? 'Quoted' : 'Not quoted'} · {CHARGE_LABEL[i.chargeTo]}
          </span>
        </div>
      </div>

      {i.ownerApprovalRequired && !i.ownerApprovedAt && i.quotedAmount != null && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-[10px] rounded-control bg-gold-tint border border-solid border-[var(--color-gold-200)]">
          <span className="text-[12.5px] text-gold-ink flex-1 min-w-[200px]">
            The owner must approve {rm(i.quotedAmount)} before this is scheduled.
          </span>
          <button onClick={onRequestApproval} className="h-[34px] px-[13px] py-0 rounded-control border-none bg-black text-white cursor-pointer [font:inherit]">
            Request owner approval
          </button>
        </div>
      )}

      <div className="flex gap-[7px] flex-wrap">
        {resolved ? (
          <RowAction onClick={onReopen} danger>Reopen</RowAction>
        ) : (
          <>
            <RowAction onClick={onAssign}>{i.assigneeName ? 'Reassign' : 'Assign technician'}</RowAction>
            {i.quotedAmount != null && !i.ownerApprovalRequired && (
              <RowAction onClick={onRequestApproval}>Request owner approval</RowAction>
            )}
            {canStart && <RowAction onClick={onStart} primary>Start work</RowAction>}
            {canEnd && <RowAction onClick={onEnd} primary>End work</RowAction>}
            {canExchange && <RowAction onClick={onExchange}>Request to exchange</RowAction>}
            {!i.blocksUnit && <RowAction onClick={onBlock}>Block the unit</RowAction>}
            <RowAction onClick={onPhoto}>Upload photo</RowAction>
            <RowAction onClick={onDoc}>Upload POD / invoice</RowAction>
            <RowAction onClick={onComplete} primary={!canStart && !canEnd}>Mark complete</RowAction>
          </>
        )}
      </div>
    </div>
  );
}

function RowAction({ children, onClick, primary, danger }: { children: ReactNode; onClick: () => void; primary?: boolean; danger?: boolean }) {
  const skin = primary
    ? 'border-none bg-black text-white'
    : danger
      ? cx('border border-solid border-[#E4B4B1] bg-white', TONE.critical.text)
      : 'border border-solid border-line bg-white text-ink';
  return (
    <button onClick={onClick} className={cx('h-8 px-3 py-0 rounded-control cursor-pointer [font:inherit] whitespace-nowrap', skin)}>
      {children}
    </button>
  );
}

// ---- Local modal shell -----------------------------------------------------

function Modal({ title, sub, onClose, footer, children, width = 480 }: {
  title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div style={{ maxWidth: width }}
        className="relative w-full max-h-[90vh] overflow-y-auto bg-white rounded-card shadow-[var(--shadow-overlay)] animate-dialog">
        <div className="px-[22px] pt-[22px] pb-[18px] flex flex-col gap-1">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold text-pretty">{title}</h2>
          {sub && <p className="m-0 text-[13px] leading-[1.55] text-muted-ink text-pretty">{sub}</p>}
        </div>
        <div className="px-[22px] pt-0 pb-5 flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          {footer}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={LABEL_CX}>{label}</label>
      {children}
    </div>
  );
}

// ---- Create job ------------------------------------------------------------

function CreateJobModal({ skus, onClose, onCreate }: { skus: Sku[]; onClose: () => void; onCreate: (i: Omit<Issue, 'id' | 'state' | 'finalAmount' | 'ownerApprovalRequired' | 'reportedAt' | 'photoCount' | 'documentCount'>) => void }) {
  const [skuId, setSkuId] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [quote, setQuote] = useState('');
  const [chargeTo, setChargeTo] = useState<ChargeTo>('owner');
  const [blocksUnit, setBlocksUnit] = useState(false);

  const valid = propertyName.trim() && unitNumber.trim() && title.trim();

  // Picking a catalog item seeds the title and the quote from its preset price.
  // Both stay editable — this is a starting point, not a lock.
  function pickSku(id: string) {
    setSkuId(id);
    const sku = skus.find(s => s.id === id);
    if (sku) {
      if (!title.trim()) setTitle(sku.name);
      if (sku.defaultPrice != null) setQuote((sku.defaultPrice / 100).toFixed(2));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const sku = skus.find(s => s.id === skuId);
    onCreate({
      propertyName: propertyName.trim(), unitNumber: unitNumber.trim(), title: title.trim(),
      detail: detail.trim() || null, vendorName: vendorName.trim() || null,
      quotedAmount: toSen(quote), chargeTo, blocksUnit, assigneeName: null,
      skuId: skuId || null, skuCode: sku?.code ?? null, skuName: sku?.name ?? null,
    });
  }

  return (
    <Modal title="Create maintenance job" sub="Logs an open issue on the unit. Add a quote now or after a vendor visit." onClose={onClose} width={520}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={submit} disabled={!valid} disabledReason="Add the property, unit and a title first.">Create job</Button>
      </>}>
      <form id="create-job" onSubmit={submit} className="flex flex-col gap-[14px]">
        {skus.length > 0 && (
          <LabeledField label="Maintenance item (optional)">
            <select value={skuId} onChange={e => pickSku(e.target.value)} className={INPUT_CX}>
              <option value="">— Pick a catalog item to fill the price —</option>
              {skus.map(s => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}{s.defaultPrice != null ? ` — ${rm(s.defaultPrice)}` : ''}
                </option>
              ))}
            </select>
          </LabeledField>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <LabeledField label="Property"><input required value={propertyName} onChange={e => setPropertyName(e.target.value)} placeholder="Vista Jaya One" className={INPUT_CX} /></LabeledField>
          <LabeledField label="Unit"><input required value={unitNumber} onChange={e => setUnitNumber(e.target.value)} placeholder="#A-12-03" className={INPUT_CX} /></LabeledField>
        </div>
        <LabeledField label="Title"><input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Broken blind, living room" className={INPUT_CX} /></LabeledField>
        <LabeledField label="Detail">
          <textarea value={detail} onChange={e => setDetail(e.target.value)} placeholder="What happened, and what needs doing." rows={3}
            className="block w-full box-border h-auto px-3 py-[10px] text-ink bg-white border border-solid border-line rounded-control outline-none font-sans text-[16px] font-normal resize-y leading-[1.5]" />
        </LabeledField>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <LabeledField label="Vendor"><input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="AquaFix" className={INPUT_CX} /></LabeledField>
          <LabeledField label="Quote (RM, optional)"><input inputMode="decimal" value={quote} onChange={e => setQuote(e.target.value)} placeholder="320.00" className={cx(INPUT_CX, 'text-right tabular-nums')} /></LabeledField>
        </div>
        <LabeledField label="Charge to">
          <select value={chargeTo} onChange={e => setChargeTo(e.target.value as ChargeTo)} className={INPUT_CX}>
            {CHARGE_OPTIONS.map(c => <option key={c} value={c}>{CHARGE_LABEL[c]}</option>)}
          </select>
        </LabeledField>
        <Toggle checked={blocksUnit} onChange={setBlocksUnit} label="This blocks the unit" hint="Takes the unit off sale and holds the dates while the work is open." />
        <div className="px-3 py-[10px] rounded-control bg-page border border-solid border-line text-[12.5px] text-muted-ink leading-[1.55]">
          <span className="font-medium text-ink">Where this cost goes.</span>{' '}
          {quote.trim()
            ? <>When you mark the job complete, its final amount posts as a <b>maintenance expense</b> on {unitNumber.trim() || 'the unit'} and rolls up to the <b>{CHARGE_LABEL[chargeTo]}</b> statement.</>
            : <>Add a quote now or after the vendor visits. Whatever the final amount is, it posts as a <b>maintenance expense</b> on the unit and rolls up to the <b>{CHARGE_LABEL[chargeTo]}</b> statement when you mark the job complete.</>}
        </div>
      </form>
    </Modal>
  );
}

// ---- Assign technician -----------------------------------------------------

function AssignModal({ issue, onClose, onAssign }: { issue: Issue; onClose: () => void; onAssign: (i: Issue, tech: string) => void }) {
  const [tech, setTech] = useState(issue.assigneeName ?? TECHS[0]);
  return (
    <Modal title="Assign technician" sub={`${issue.propertyName} ${issue.unitNumber} · ${issue.title}`} onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onAssign(issue, tech)}>Assign</Button>
      </>}>
      <LabeledField label="Technician or vendor">
        <select value={tech} onChange={e => setTech(e.target.value)} className={INPUT_CX}>
          {TECHS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </LabeledField>
      <span className="text-[12px] text-muted-ink">They are notified by push and the job moves to assigned.</span>
    </Modal>
  );
}

// ---- Upload photo ----------------------------------------------------------

function PhotoModal({ issue, onClose, onAttach }: { issue: Issue; onClose: () => void; onAttach: (i: Issue, kind: 'Before' | 'After') => void }) {
  const [kind, setKind] = useState<'Before' | 'After'>('Before');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <Modal title="Upload photo" sub="Before-and-after evidence stays on the job and, once complete, on the owner statement." onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onAttach(issue, kind)}>Attach {kind.toLowerCase()} photo</Button>
      </>}>
      <LabeledField label="Type">
        <Segmented options={['Before', 'After']} value={kind} onChange={v => setKind(v as 'Before' | 'After')} />
      </LabeledField>
      <div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => setFileName(e.target.files?.[0]?.name ?? null)} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="flex w-full box-border h-auto min-h-[72px] px-3 py-0 items-center justify-center text-muted-ink bg-white border border-dashed border-line rounded-control outline-none [font:inherit] cursor-pointer">
          {fileName ? fileName : 'Choose a photo'}
        </button>
      </div>
    </Modal>
  );
}

// ---- Upload POD / invoice --------------------------------------------------

function DocumentModal({ issue, onClose, onAttach }: { issue: Issue; onClose: () => void; onAttach: (i: Issue, kind: 'POD' | 'Invoice') => void }) {
  const [kind, setKind] = useState<'POD' | 'Invoice'>('Invoice');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <Modal title="Upload POD / invoice" sub="Proof of delivery and the vendor invoice back the expense on the owner statement." onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onAttach(issue, kind)}>Upload {kind === 'POD' ? 'POD' : 'invoice'}</Button>
      </>}>
      <LabeledField label="Document">
        <Segmented options={['Invoice', 'POD']} value={kind} onChange={v => setKind(v as 'POD' | 'Invoice')} />
      </LabeledField>
      <div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={e => setFileName(e.target.files?.[0]?.name ?? null)} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="flex w-full box-border h-auto min-h-[72px] px-3 py-0 items-center justify-center text-muted-ink bg-white border border-dashed border-line rounded-control outline-none [font:inherit] cursor-pointer">
          {fileName ? fileName : 'Choose a file'}
        </button>
      </div>
    </Modal>
  );
}

// ---- Mark complete ---------------------------------------------------------

function CompleteModal({ issue, onClose, onComplete, onNeedsPhoto }: {
  issue: Issue; onClose: () => void; onComplete: (i: Issue, final: number) => void; onNeedsPhoto: () => void;
}) {
  const [amount, setAmount] = useState(issue.quotedAmount != null ? (issue.quotedAmount / 100).toFixed(2) : '');
  const hasPhoto = (issue.photoCount ?? 0) > 0;
  const finalSen = toSen(amount);
  const amountOk = finalSen != null && finalSen > 0;
  const ready = hasPhoto && amountOk;

  return (
    <Modal title="Mark complete" sub="Completing the job creates the expense and, if the unit was blocked, puts it back on sale." onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => finalSen != null && onComplete(issue, finalSen)} disabled={!ready}
          disabledReason={!hasPhoto ? 'Add a photo before completing.' : 'Enter the final amount.'}>
          Mark complete
        </Button>
      </>}>
      <div className="px-3 py-[10px] rounded-control bg-page border border-solid border-line text-[12.5px] text-muted-ink">
        {issue.propertyName} {issue.unitNumber} · {issue.title} · charged to {CHARGE_LABEL[issue.chargeTo]}
      </div>
      <LabeledField label="Final amount (RM)">
        <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="320.00" autoFocus
          className={cx(INPUT_CX, 'text-right tabular-nums')} />
      </LabeledField>
      <div className={cx('flex items-center gap-2.5 flex-wrap px-3 py-[10px] rounded-control text-[12.5px]',
        hasPhoto ? cx(TONE.success.bg, TONE.success.text) : cx(TONE.warning.bg, TONE.warning.text))}>
        <span className="flex-1 min-w-[180px]">
          {hasPhoto ? `${issue.photoCount} ${issue.photoCount === 1 ? 'photo' : 'photos'} attached — evidence requirement met.` : 'A photo is required before this job can be completed.'}
        </span>
        {!hasPhoto && (
          <button onClick={onNeedsPhoto} className="h-[30px] px-3 py-0 rounded-control border border-solid border-current bg-transparent text-inherit cursor-pointer [font:inherit]">
            Upload a photo
          </button>
        )}
      </div>
    </Modal>
  );
}

// ---- Small controls --------------------------------------------------------

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex border border-solid border-line rounded-control overflow-hidden">
      {options.map(o => {
        const on = o === value;
        return (
          <button key={o} type="button" onClick={() => onChange(o)}
            className={cx('px-4 py-2 cursor-pointer border-none [font:inherit]',
              on ? 'bg-black text-white' : 'bg-white text-muted-ink')}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('w-10 h-6 flex-none rounded-full border-none cursor-pointer p-0.5 mt-px [transition:background_160ms] flex',
          checked ? 'bg-black justify-end' : 'bg-line-strong justify-start')}>
        <span className="w-5 h-5 rounded-full bg-white" />
      </button>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-medium">{label}</span>
        {hint && <span className="text-[12px] text-muted-ink">{hint}</span>}
      </div>
    </div>
  );
}
