import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { rm } from '../lib/format';
import { TASK } from '../lib/vocabulary';
import type { TaskState } from '../lib/types';

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
  id: string; unitNumber: string; propertyName: string; title: string; detail: string | null;
  state: TaskState; vendorName: string | null; quotedAmount: number | null; finalAmount: number | null;
  ownerApprovalRequired: boolean; blocksUnit: boolean; reportedAt: string; chargeTo: ChargeTo;
  assigneeName?: string | null; photoCount?: number; documentCount?: number; ownerApprovedAt?: string | null;
}
interface Payload { data: Issue[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'MNT-0914', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', title: 'Plumbing works', detail: 'Riser replacement. Unit offline until 22 Sep.', state: 'in_progress', vendorName: 'AquaFix', quotedAmount: 320000, finalAmount: null, ownerApprovalRequired: false, blocksUnit: true, reportedAt: '14 Sep', chargeTo: 'owner', assigneeName: 'AquaFix', photoCount: 1, documentCount: 0 },
    { id: 'MNT-0912', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Curtain replacement quoted', detail: 'Blackout curtains, 3 windows. Awaiting owner approval.', state: 'waiting', vendorName: 'Kiara Interiors', quotedAmount: 89000, finalAmount: null, ownerApprovalRequired: true, blocksUnit: false, reportedAt: '12 Sep', chargeTo: 'owner', assigneeName: 'Kiara Interiors', photoCount: 0, documentCount: 0 },
    { id: 'MNT-0916', unitNumber: '#B-08-11', propertyName: 'Arcoris', title: 'Broken blind, living room', detail: 'Guest reported on arrival. Inspect before next stay.', state: 'open', vendorName: null, quotedAmount: null, finalAmount: null, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '16 Sep', chargeTo: 'owner', assigneeName: null, photoCount: 0, documentCount: 0 },
    { id: 'MNT-0910', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Aircon service', detail: 'Quarterly service. Gas top-up not required.', state: 'resolved', vendorName: 'CoolCare', quotedAmount: null, finalAmount: 18000, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '10 Sep', chargeTo: 'owner', assigneeName: 'CoolCare', photoCount: 2, documentCount: 1 },
    { id: 'MNT-0828', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Water heater replaced', detail: 'Guest reported no hot water. Same-day replacement.', state: 'resolved', vendorName: 'In-house crew', quotedAmount: null, finalAmount: 64000, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '28 Aug', chargeTo: 'warranty', assigneeName: 'In-house crew', photoCount: 2, documentCount: 1 },
  ],
};

const FILTERS = ['All', 'Needs approval', 'Blocking a unit', 'Open', 'Resolved'];

// Attention-first order. Overdue and reopened sit above quiet work; resolved
// sinks to the bottom. Every state renders its own section when it has rows.
const GROUP_ORDER: TaskState[] = ['overdue', 'reopened', 'waiting', 'in_progress', 'assigned', 'open', 'resolved'];

const inputStyle: CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px',
  fontSize: text.body, color: color.ink, background: '#FFFFFF',
  border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit',
};
const labelStyle: CSSProperties = { fontSize: text.small, fontWeight: 500, color: color.textMuted };

const todayShort = () => new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });
const toSen = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export default function MaintenancePage() {
  const [filter, setFilter] = useState('All');
  const { data, loading, error, reload } = useApi<Payload>('/maintenance/issues', FALLBACK);
  const toast = useToast();

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
  const fire = (p: Promise<unknown>) => { void p.catch(() => { /* dev: no backend, keep optimistic */ }); };

  // Modal state
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<Issue | null>(null);
  const [completeFor, setCompleteFor] = useState<Issue | null>(null);
  const [photoFor, setPhotoFor] = useState<Issue | null>(null);
  const [docFor, setDocFor] = useState<Issue | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'approval' | 'block' | 'reopen'; issue: Issue } | null>(null);

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
      finalAmount: null, ownerApprovalRequired: false, reportedAt: todayShort(),
      photoCount: 0, documentCount: 0, ownerApprovedAt: null,
    };
    setAdded(a => [optimistic, ...a]);
    setCreating(false);
    toast({
      tone: 'success', title: 'Job created.',
      body: `${optimistic.propertyName} ${optimistic.unitNumber} now has an open maintenance issue${optimistic.blocksUnit ? ' and is off sale' : ''}.`,
    });
    fire(api.post('/maintenance/issues', {
      unitId: optimistic.unitNumber, title: optimistic.title, detail: optimistic.detail,
      photoIds: [], blocksUnit: optimistic.blocksUnit, quotedAmount: optimistic.quotedAmount, chargeTo: optimistic.chargeTo,
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
    fire(api.post('/blocks', { unitId: issue.unitNumber, reason: 'maintenance', issueId: issue.id }));
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
        meta: `${confirm.issue.title} · reported ${confirm.issue.reportedAt}`,
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
        sub={`${openCount} open · ${approvalCount} awaiting owner approval · ${blockingCount} blocking a unit`}
        right={<Button variant="primary" onClick={() => setCreating(true)}>Create job</Button>}
      />

      {error && <StaleBanner message={`Showing the last issues we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map(fl => {
          const on = fl === filter;
          return (
            <button key={fl} onClick={() => setFilter(fl)}
              style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
              {fl}
            </button>
          );
        })}
      </div>

      {loading && merged.length === 0 ? (
        <Card><TableSkeleton rows={4} cols={3} /></Card>
      ) : rows.length === 0 ? (
        <Card>
          <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13 }}>No maintenance issues match these filters.</span>
            <button onClick={() => setFilter('All')} style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear filters</button>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(g => (
            <div key={g.state} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 2 }}>
                <Badge tone={TASK[g.state].tone} label={TASK[g.state].label} />
                <span style={{ fontSize: text.small, color: color.textMuted }}>{g.items.length}</span>
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
                  />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Confirmations: request approval, block unit, reopen */}
      <Dialog busy={false} onClose={() => setConfirm(null)} spec={dialogSpec} />

      {creating && <CreateJobModal onClose={() => setCreating(false)} onCreate={createJob} />}
      {assignFor && <AssignModal issue={assignFor} onClose={() => setAssignFor(null)} onAssign={assignTechnician} />}
      {photoFor && <PhotoModal issue={photoFor} onClose={() => setPhotoFor(null)} onAttach={attachPhoto} />}
      {docFor && <DocumentModal issue={docFor} onClose={() => setDocFor(null)} onAttach={attachDocument} />}
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
  issue: i, last, onAssign, onRequestApproval, onBlock, onPhoto, onDoc, onComplete, onReopen,
}: {
  issue: Issue; last: boolean;
  onAssign: () => void; onRequestApproval: () => void; onBlock: () => void;
  onPhoto: () => void; onDoc: () => void; onComplete: () => void; onReopen: () => void;
}) {
  const resolved = i.state === 'resolved';
  const photos = i.photoCount ?? 0;
  const docs = i.documentCount ?? 0;
  const evidence = [
    photos > 0 ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : null,
    docs > 0 ? `${docs} ${docs === 1 ? 'document' : 'documents'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ padding: '15px 20px', borderBottom: last ? 'none' : `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 220, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{i.id}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{i.title}</span>
            {i.blocksUnit && <Badge tone="critical" label="Blocks the unit" />}
          </div>
          <span style={{ fontSize: text.small, color: color.textMuted }}>
            {i.propertyName} {i.unitNumber} · reported {i.reportedAt}
            {i.assigneeName ? ` · ${i.assigneeName}` : i.vendorName ? ` · ${i.vendorName}` : ''}
            {evidence ? ` · ${evidence}` : ''}
          </span>
          {i.detail && <span style={{ fontSize: 13, textWrap: 'pretty' }}>{i.detail}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {i.finalAmount != null ? rm(i.finalAmount) : i.quotedAmount != null ? rm(i.quotedAmount) : '—'}
          </span>
          <span style={{ fontSize: text.micro, color: color.textMuted }}>
            {i.finalAmount != null ? 'Final' : i.quotedAmount != null ? 'Quoted' : 'Not quoted'} · {CHARGE_LABEL[i.chargeTo]}
          </span>
        </div>
      </div>

      {i.ownerApprovalRequired && !i.ownerApprovedAt && i.quotedAmount != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: radius.control, background: color.goldTint, border: `1px solid ${color.gold200}` }}>
          <span style={{ fontSize: 12.5, color: color.goldInk, flex: 1, minWidth: 200 }}>
            The owner must approve {rm(i.quotedAmount)} before this is scheduled.
          </span>
          <button onClick={onRequestApproval} style={{ height: 34, padding: '0 13px', borderRadius: radius.control, border: 'none', background: color.black, color: '#FFFFFF', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>
            Request owner approval
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {resolved ? (
          <RowAction onClick={onReopen} danger>Reopen</RowAction>
        ) : (
          <>
            <RowAction onClick={onAssign}>{i.assigneeName ? 'Reassign' : 'Assign technician'}</RowAction>
            {i.quotedAmount != null && !i.ownerApprovalRequired && (
              <RowAction onClick={onRequestApproval}>Request owner approval</RowAction>
            )}
            {!i.blocksUnit && <RowAction onClick={onBlock}>Block the unit</RowAction>}
            <RowAction onClick={onPhoto}>Upload photo</RowAction>
            <RowAction onClick={onDoc}>Upload POD / invoice</RowAction>
            <RowAction onClick={onComplete} primary>Mark complete</RowAction>
          </>
        )}
      </div>
    </div>
  );
}

function RowAction({ children, onClick, primary, danger }: { children: ReactNode; onClick: () => void; primary?: boolean; danger?: boolean }) {
  const base: CSSProperties = {
    height: 32, padding: '0 12px', borderRadius: radius.control, fontSize: 12.5, fontWeight: 500,
    cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
  };
  const skin: CSSProperties = primary
    ? { border: 'none', background: color.black, color: '#FFFFFF' }
    : danger
      ? { border: `1px solid ${'#E4B4B1'}`, background: '#FFFFFF', color: '#A8352F' }
      : { border: `1px solid ${color.border}`, background: '#FFFFFF', color: color.ink };
  return <button onClick={onClick} style={{ ...base, ...skin }}>{children}</button>;
}

// ---- Local modal shell -----------------------------------------------------

function Modal({ title, sub, onClose, footer, children, width = 480 }: {
  title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', background: '#FFFFFF', borderRadius: radius.card, boxShadow: 'var(--shadow-overlay)', animation: 'dialog-in var(--motion-slow) var(--ease-out) both' }}>
        <div style={{ padding: '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 600, textWrap: 'pretty' }}>{title}</h2>
          {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: color.textMuted, textWrap: 'pretty' }}>{sub}</p>}
        </div>
        <div style={{ padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${color.border}`, background: color.page, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ---- Create job ------------------------------------------------------------

function CreateJobModal({ onClose, onCreate }: { onClose: () => void; onCreate: (i: Omit<Issue, 'id' | 'state' | 'finalAmount' | 'ownerApprovalRequired' | 'reportedAt' | 'photoCount' | 'documentCount'>) => void }) {
  const [propertyName, setPropertyName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [quote, setQuote] = useState('');
  const [chargeTo, setChargeTo] = useState<ChargeTo>('owner');
  const [blocksUnit, setBlocksUnit] = useState(false);

  const valid = propertyName.trim() && unitNumber.trim() && title.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onCreate({
      propertyName: propertyName.trim(), unitNumber: unitNumber.trim(), title: title.trim(),
      detail: detail.trim() || null, vendorName: vendorName.trim() || null,
      quotedAmount: toSen(quote), chargeTo, blocksUnit, assigneeName: null,
    });
  }

  return (
    <Modal title="Create maintenance job" sub="Logs an open issue on the unit. Add a quote now or after a vendor visit." onClose={onClose} width={520}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={submit} disabled={!valid} disabledReason="Add the property, unit and a title first.">Create job</Button>
      </>}>
      <form id="create-job" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <LabeledField label="Property"><input required value={propertyName} onChange={e => setPropertyName(e.target.value)} placeholder="Vista Jaya One" style={inputStyle} /></LabeledField>
          <LabeledField label="Unit"><input required value={unitNumber} onChange={e => setUnitNumber(e.target.value)} placeholder="#A-12-03" style={inputStyle} /></LabeledField>
        </div>
        <LabeledField label="Title"><input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Broken blind, living room" style={inputStyle} /></LabeledField>
        <LabeledField label="Detail">
          <textarea value={detail} onChange={e => setDetail(e.target.value)} placeholder="What happened, and what needs doing." rows={3}
            style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }} />
        </LabeledField>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <LabeledField label="Vendor"><input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="AquaFix" style={inputStyle} /></LabeledField>
          <LabeledField label="Quote (RM, optional)"><input inputMode="decimal" value={quote} onChange={e => setQuote(e.target.value)} placeholder="320.00" style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} /></LabeledField>
        </div>
        <LabeledField label="Charge to">
          <select value={chargeTo} onChange={e => setChargeTo(e.target.value as ChargeTo)} style={inputStyle}>
            {CHARGE_OPTIONS.map(c => <option key={c} value={c}>{CHARGE_LABEL[c]}</option>)}
          </select>
        </LabeledField>
        <Toggle checked={blocksUnit} onChange={setBlocksUnit} label="This blocks the unit" hint="Takes the unit off sale and holds the dates while the work is open." />
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
        <select value={tech} onChange={e => setTech(e.target.value)} style={inputStyle}>
          {TECHS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </LabeledField>
      <span style={{ fontSize: text.small, color: color.textMuted }}>They are notified by push and the job moves to assigned.</span>
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
          style={{ ...inputStyle, height: 'auto', minHeight: 72, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: color.textMuted, borderStyle: 'dashed' }}>
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
          style={{ ...inputStyle, height: 'auto', minHeight: 72, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: color.textMuted, borderStyle: 'dashed' }}>
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
      <div style={{ padding: '10px 12px', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}`, fontSize: 12.5, color: color.textMuted }}>
        {issue.propertyName} {issue.unitNumber} · {issue.title} · charged to {CHARGE_LABEL[issue.chargeTo]}
      </div>
      <LabeledField label="Final amount (RM)">
        <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="320.00" autoFocus
          style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
      </LabeledField>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: radius.control,
        background: hasPhoto ? 'var(--color-success)' : 'var(--color-warning)', color: hasPhoto ? 'var(--color-success-fg)' : 'var(--color-warning-fg)', fontSize: 12.5 }}>
        <span style={{ flex: 1, minWidth: 180 }}>
          {hasPhoto ? `${issue.photoCount} ${issue.photoCount === 1 ? 'photo' : 'photos'} attached — evidence requirement met.` : 'A photo is required before this job can be completed.'}
        </span>
        {!hasPhoto && (
          <button onClick={onNeedsPhoto} style={{ height: 30, padding: '0 12px', borderRadius: radius.control, border: '1px solid currentColor', background: 'transparent', color: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>
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
    <div style={{ display: 'inline-flex', border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}>
      {options.map(o => {
        const on = o === value;
        return (
          <button key={o} type="button" onClick={() => onChange(o)}
            style={{ padding: '8px 16px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: 'none', font: 'inherit',
              background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        style={{ width: 40, height: 24, flex: 'none', borderRadius: radius.pill, border: 'none', cursor: 'pointer', padding: 2, marginTop: 1,
          background: checked ? color.black : color.borderStrong, transition: 'background 160ms', display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start' }}>
        <span style={{ width: 20, height: 20, borderRadius: radius.pill, background: '#FFFFFF' }} />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</span>
        {hint && <span style={{ fontSize: text.small, color: color.textMuted }}>{hint}</span>}
      </div>
    </div>
  );
}
