import { useEffect, useRef, useState, type ReactNode } from 'react';
import { color, radius, text, tone as T } from '../theme';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { READINESS, CHANNEL } from '../lib/vocabulary';
import { rm, date as fmtDate, time, unitRef } from '../lib/format';
import type { Tone, UnitReadiness, BookingChannel } from '../lib/types';

/** Kinds the operations day is made of. Housekeeping kinds share the cleaner flow. */
type Kind = 'turnover' | 'deep_clean' | 'light_clean' | 'inspection' | 'maintenance';
const HOUSEKEEPING: Kind[] = ['turnover', 'deep_clean', 'light_clean'];
const isHousekeeping = (k: Kind) => HOUSEKEEPING.includes(k);

interface Row {
  id: string;
  kind: Kind;
  unitNumber: string;
  propertyName: string;
  work: string;
  note: string | null;
  readiness: UnitReadiness;
  /** Display HH:MM in MYT — the next arrival this work races. */
  nextGuestAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Server-computed. The client never recomputes SLA from its own clock. */
  sla: { state: 'on_track' | 'due' | 'overdue' | 'escalated' | 'none'; label: string; tone: Tone };
  riskRank: number;
  /** Present when a guest is waiting on an answer — drives Confirm with guest. */
  guest: { name: string; channel: BookingChannel; request: string } | null;
  /** Present on blocked or maintenance work — drives Update owner. */
  owner: { id: string; name: string; revenueAtRisk: number } | null;
}
interface Payload { rows: Row[]; date: string; generatedAt: string }

const FALLBACK: Payload = {
  date: '2026-09-16', generatedAt: '',
  rows: [
    {
      id: 't1', kind: 'turnover', unitNumber: '#A-21-02', propertyName: 'The Establishment',
      work: 'Full turnover, 2BR', note: 'Linen set A. No cleaner assigned.', readiness: 'dirty',
      nextGuestAt: '15:00', assigneeId: null, assigneeName: null,
      sla: { state: 'overdue', label: 'Overdue 12 min', tone: 'critical' }, riskRank: 1,
      guest: { name: 'Aaron Lee', channel: 'direct', request: 'Asked to check in early at 14:00.' },
      owner: null,
    },
    {
      id: 't2', kind: 'maintenance', unitNumber: '#C-31-14', propertyName: 'Sentral Suites',
      work: 'Plumbing works', note: 'Vendor on site. Unit off sale.', readiness: 'maintenance',
      nextGuestAt: null, assigneeId: 'v1', assigneeName: 'AquaFix',
      sla: { state: 'escalated', label: 'Escalated', tone: 'critical' }, riskRank: 2,
      guest: null,
      owner: { id: 'o2', name: 'Tan Boon Huat', revenueAtRisk: 498000 },
    },
    {
      id: 't3', kind: 'turnover', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara',
      work: 'Turnover, studio', note: 'Early check-in requested.', readiness: 'cleaning',
      nextGuestAt: '16:00', assigneeId: 'u5', assigneeName: 'Nurul Huda',
      sla: { state: 'due', label: 'Due in 1 h 20 m', tone: 'warning' }, riskRank: 3,
      guest: { name: 'Priya Sundaram', channel: 'booking_com', request: 'Asked whether early check-in at 14:30 is possible.' },
      owner: null,
    },
    {
      id: 't4', kind: 'inspection', unitNumber: '#15-06', propertyName: 'Scarletz KLCC',
      work: 'Move-out inspection', note: 'Vacant 4 nights. Checklist due.', readiness: 'inspection',
      nextGuestAt: null, assigneeId: 'u12', assigneeName: 'Azman Yusof',
      sla: { state: 'on_track', label: 'On track', tone: 'success' }, riskRank: 4,
      guest: null, owner: null,
    },
    {
      id: 't5', kind: 'deep_clean', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One',
      work: 'Deep clean', note: 'Late check-out to 13:00.', readiness: 'dirty',
      nextGuestAt: '18:00', assigneeId: 'u6', assigneeName: 'Faridah Ismail',
      sla: { state: 'due', label: 'Due in 3 h', tone: 'warning' }, riskRank: 5,
      guest: null, owner: null,
    },
    {
      id: 't6', kind: 'light_clean', unitNumber: '#2207', propertyName: 'Tribeca',
      work: 'Turnover, 2BR', note: 'Standard reset.', readiness: 'cleaning',
      nextGuestAt: '20:00', assigneeId: 'u9', assigneeName: 'Siti Rahmah',
      sla: { state: 'on_track', label: 'On track', tone: 'success' }, riskRank: 6,
      guest: null, owner: null,
    },
  ],
};

const CREW = [
  { id: 'u5', name: 'Nurul Huda' },
  { id: 'u6', name: 'Faridah Ismail' },
  { id: 'u9', name: 'Siti Rahmah' },
  { id: 'u12', name: 'Azman Yusof' },
];

const FILTERS = [
  { key: 'all', label: 'All work' },
  { key: 'checkin_risk', label: 'Check-in risk' },
  { key: 'housekeeping', label: 'Housekeeping' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'unassigned', label: 'Unassigned' },
] as const;
type FilterKey = typeof FILTERS[number]['key'];

const COLS = 'minmax(190px,1.5fr) minmax(170px,1.5fr) minmax(104px,0.9fr) minmax(78px,0.6fr) minmax(128px,1fr) minmax(128px,1fr) minmax(214px,1.5fr)';

const isCheckinRisk = (r: Row) =>
  !!r.nextGuestAt && (r.sla.state === 'overdue' || r.sla.state === 'escalated' || r.sla.state === 'due');

const matchesFilter = (r: Row, f: FilterKey) =>
  f === 'all' ? true
  : f === 'checkin_risk' ? isCheckinRisk(r)
  : f === 'housekeeping' ? isHousekeeping(r.kind)
  : f === 'maintenance' ? r.kind === 'maintenance' || r.readiness === 'maintenance'
  : /* unassigned */ !r.assigneeId;

export default function OperationsTodayPage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const { data, loading, error, reload } = useApi<Payload>('/operations/today', FALLBACK);

  // Optimistic overlay: assignments, resolved guest requests, etc. survive the
  // absent dev backend so every action visibly lands.
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});

  const [assign, setAssign] = useState<{ row: Row; cleanerId: string } | null>(null);
  const [message, setMessage] = useState<{ row: Row; body: string } | null>(null);
  const [inspect, setInspect] = useState<Row | null>(null);
  const [ownerNotice, setOwnerNotice] = useState<Row | null>(null);
  const toast = useToast();

  const base = data?.rows ?? [];
  const allRows = [...base.map(r => ({ ...r, ...edits[r.id] }))].sort((a, b) => a.riskRank - b.riskRank);
  const rows = allRows.filter(r => matchesFilter(r, filter));

  const firstUnassigned = allRows.find(r => isHousekeeping(r.kind) && !r.assigneeId) ?? null;
  const lastUpdated = data?.generatedAt ? time(data.generatedAt) : null;

  // --- Actions ---------------------------------------------------------------

  function openTask(id: string) {
    window.location.hash = `#/operations/tasks/${id}`;
  }

  function doAssign() {
    if (!assign) return;
    const cleaner = CREW.find(c => c.id === assign.cleanerId);
    if (!cleaner) return;
    setEdits(e => ({ ...e, [assign.row.id]: { ...e[assign.row.id], assigneeId: cleaner.id, assigneeName: cleaner.name } }));
    toast({ tone: 'success', title: 'Cleaner assigned.', body: `${cleaner.name} has been notified.` });
    const row = assign.row;
    setAssign(null);
    // Dev has no backend; keep the optimistic assignment either way.
    api.post(`/housekeeping/tasks/${row.id}/assign`, { assigneeId: cleaner.id }).then(reload).catch(() => {});
  }

  function doMessage() {
    if (!message) return;
    const row = message.row;
    const guest = row.guest;
    if (!guest) return;
    const body = message.body;
    setEdits(e => ({ ...e, [row.id]: { ...e[row.id], guest: null } }));
    toast({ tone: 'success', title: 'Message sent.', body: `Sent to ${guest.name} on ${CHANNEL[guest.channel].label}.` });
    setMessage(null);
    api.post('/messages', { taskId: row.id, channel: guest.channel, body }).catch(() => {});
  }

  function doInspect() {
    if (!inspect) return;
    const row = inspect;
    const id = crypto.randomUUID();
    toast({ tone: 'success', title: 'Inspection started.', body: `Checklist opened for ${unitRef(row.propertyName, row.unitNumber)}.` });
    setInspect(null);
    api.post<{ id: string }>('/inspections', { taskId: row.id, unitNumber: row.unitNumber }).catch(() => {});
    window.location.hash = `#/operations/inspections/${id}`;
  }

  function doOwnerNotice() {
    if (!ownerNotice) return;
    const row = ownerNotice;
    const owner = row.owner;
    if (!owner) return;
    toast({ tone: 'success', title: 'Owner notified.', body: `${owner.name} was sent the blocked-unit notice.` });
    setOwnerNotice(null);
    api.post(`/owners/${owner.id}/notify`, { unitNumber: row.unitNumber, reason: row.work }).catch(() => {});
  }

  interface RowAction { key: string; label: string; primary?: boolean; run: () => void }
  function actionsFor(r: Row): RowAction[] {
    const list: RowAction[] = [];
    if (isHousekeeping(r.kind)) {
      list.push({ key: 'assign', label: r.assigneeId ? 'Reassign cleaner' : 'Assign cleaner', primary: !r.assigneeId, run: () => setAssign({ row: r, cleanerId: r.assigneeId ?? CREW[0].id }) });
    }
    if (r.kind === 'inspection') {
      list.push({ key: 'inspect', label: 'Start inspection', primary: true, run: () => setInspect(r) });
    }
    if (r.owner && (r.kind === 'maintenance' || r.readiness === 'maintenance' || r.readiness === 'blocked')) {
      list.push({ key: 'owner', label: 'Update owner', primary: r.kind === 'maintenance', run: () => setOwnerNotice(r) });
    }
    if (r.guest) {
      list.push({ key: 'guest', label: 'Confirm with guest', run: () => setMessage({ row: r, body: guestPrefill(r) }) });
    }
    list.push({ key: 'open', label: 'Open task', run: () => openTask(r.id) });
    return list;
  }

  // --- Render ----------------------------------------------------------------

  return (
    <>
      <PageHeader
        title="Today"
        sub={`${fmtDate(data?.date ?? FALLBACK.date)} · ${allRows.length} items need action before the next check-in`}
        right={
          <Button
            variant="primary"
            size="sm"
            disabled={!firstUnassigned}
            disabledReason="Every housekeeping task already has a cleaner."
            onClick={() => firstUnassigned && setAssign({ row: firstUnassigned, cleanerId: CREW[0].id })}
          >
            Assign cleaner
          </Button>
        }
      />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map(fl => {
          const on = fl.key === filter;
          return (
            <button
              key={fl.key}
              onClick={() => setFilter(fl.key)}
              aria-pressed={on}
              style={{
                height: 32, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.pill,
                fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF',
                color: on ? '#FFFFFF' : color.textMuted,
              }}
            >
              {fl.label}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader title="All work, highest risk first" />
        <div style={{ padding: '0 20px 12px', marginTop: -8, fontSize: text.small, color: color.textMuted }}>
          Sorted by risk, then time{lastUpdated ? ` · last updated ${lastUpdated}` : ''}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1040 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Unit</div><div>Work</div><div>Readiness</div><div>Next guest</div><div>SLA</div><div>Assignee</div><div>Actions</div>
            </div>

            {loading && base.length === 0 ? (
              <TableSkeleton rows={5} cols={7} />
            ) : rows.length === 0 ? (
              <div style={{ padding: '30px 22px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, color: color.inkSecondary }}>No work matches these filters.</span>
                <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>Clear filters</Button>
              </div>
            ) : rows.map(r => {
              const actions = actionsFor(r);
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 56, padding: '11px 22px', borderBottom: `1px solid ${color.borderMuted}`, borderLeft: `3px solid ${T[r.sla.tone].line}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.unitNumber}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.propertyName}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{r.work}</span>
                    {r.note && <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.note}</span>}
                  </div>
                  <div><Badge tone={READINESS[r.readiness].tone} label={READINESS[r.readiness].label} /></div>
                  <div style={{ fontSize: 13 }}>{r.nextGuestAt ?? '—'}</div>
                  <div><Badge tone={r.sla.tone} label={r.sla.label} /></div>
                  <div style={{ fontSize: 13, color: r.assigneeName ? color.ink : color.textMuted, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.assigneeName ?? 'Unassigned'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {actions.map(a => (
                      <button
                        key={a.key}
                        onClick={a.run}
                        style={{
                          height: 28, display: 'inline-flex', alignItems: 'center', padding: '0 11px', borderRadius: radius.control,
                          fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                          border: `1px solid ${a.primary ? color.black : color.border}`,
                          background: a.primary ? color.black : '#FFFFFF',
                          color: a.primary ? '#FFFFFF' : color.inkSecondary,
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Assign cleaner — needs a chooser, so it is a local form modal. */}
      {assign && (
        <Modal title={`Assign a cleaner to ${unitRef(assign.row.propertyName, assign.row.unitNumber)}?`}
          sub="They are notified immediately. The unit stays in its current state until they mark it ready with a photo."
          onClose={() => setAssign(null)}
          footer={<>
            <Button variant="secondary" size="sm" onClick={() => setAssign(null)}>Cancel</Button>
            <Button variant={assignOverlap(assign, allRows) ? 'danger' : 'primary'} size="sm" onClick={doAssign}>
              {assignOverlap(assign, allRows) ? 'Assign anyway' : 'Assign cleaner'}
            </Button>
          </>}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: text.small, fontWeight: 500, color: color.textMuted }}>Cleaner</span>
            <select className="field-input" value={assign.cleanerId}
              onChange={e => setAssign(a => a && { ...a, cleanerId: e.target.value })}>
              {CREW.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {assign.row.nextGuestAt && (
            <div style={{ padding: '9px 11px', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}`, fontSize: 12 }}>
              Next guest arrives {assign.row.nextGuestAt} {'·'} {assign.row.sla.label}
            </div>
          )}
          {assignOverlap(assign, allRows) && (
            <div role="status" style={{ padding: '9px 11px', borderRadius: radius.control, background: T.warning.bg, color: T.warning.fg, fontSize: 12 }}>
              {CREW.find(c => c.id === assign.cleanerId)?.name} already has {assignOverlap(assign, allRows)} task{assignOverlap(assign, allRows) === 1 ? '' : 's'} today. Assign anyway?
            </div>
          )}
        </Modal>
      )}

      {/* Confirm with guest — a prefilled message on the booking's own channel. */}
      {message && message.row.guest && (
        <Modal title={`Confirm with ${message.row.guest.name}`}
          sub={`Replying on ${CHANNEL[message.row.guest.channel].label} to: “${message.row.guest.request}”`}
          onClose={() => setMessage(null)}
          footer={<>
            <Button variant="secondary" size="sm" onClick={() => setMessage(null)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!message.body.trim()} disabledReason="Write a message first." onClick={doMessage}>Send message</Button>
          </>}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: text.small, fontWeight: 500, color: color.textMuted }}>Message</span>
            <textarea className="field-input" rows={5} value={message.body}
              onChange={e => setMessage(m => m && { ...m, body: e.target.value })} />
          </label>
        </Modal>
      )}

      {/* Start inspection — a plain confirmation, so the shared Dialog fits. */}
      <Dialog
        busy={false}
        onClose={() => setInspect(null)}
        spec={!inspect ? null : {
          title: `Start inspection for ${unitRef(inspect.propertyName, inspect.unitNumber)}?`,
          body: 'Opens the inspection checklist. Anything you record is raised against this unit, and its owner is kept informed.',
          meta: inspect.nextGuestAt ? `Next guest arrives ${inspect.nextGuestAt}` : undefined,
          confirmLabel: 'Start inspection',
          onConfirm: doInspect,
        }}
      />

      {/* Update owner — blocked-unit notice. */}
      <Dialog
        busy={false}
        onClose={() => setOwnerNotice(null)}
        spec={!ownerNotice || !ownerNotice.owner ? null : {
          title: `Send a blocked-unit notice to ${ownerNotice.owner.name}?`,
          body: 'The owner receives the dates blocked, the reason, the revenue at risk and the expected return date. Nothing is charged and no work is approved by this notice.',
          meta: `${unitRef(ownerNotice.propertyName, ownerNotice.unitNumber)} · ${rm(ownerNotice.owner.revenueAtRisk)} at risk`,
          confirmLabel: 'Send notice',
          onConfirm: doOwnerNotice,
        }}
      />
    </>
  );
}

/** How many other tasks today the chosen cleaner already holds — the override signal. */
function assignOverlap(assign: { row: Row; cleanerId: string }, rows: Row[]) {
  return rows.filter(r => r.id !== assign.row.id && r.assigneeId === assign.cleanerId).length;
}

function guestPrefill(r: Row): string {
  const first = r.guest ? r.guest.name.split(' ')[0] : 'there';
  const ready = r.nextGuestAt ? `by ${r.nextGuestAt}` : 'shortly';
  return `Hi ${first}, thanks for your patience. ${unitRef(r.propertyName, r.unitNumber)} is being prepared now and will be ready ${ready}. We will confirm the moment it is ready for you.`;
}

/** Local modal shell for the two dialogs that carry form fields. Mirrors the
 *  shared Dialog chrome (scrim, card, footer) and its focus/escape behaviour. */
function Modal({ title, sub, onClose, children, footer }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select, textarea, input, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 460, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden', animation: 'dialog-in var(--motion-slow) var(--ease-out) both' }}>
        <div style={{ padding: '22px 22px 4px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 600, textWrap: 'pretty' }}>{title}</h2>
          {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-muted)', textWrap: 'pretty' }}>{sub}</p>}
        </div>
        <div style={{ padding: '14px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-default)', background: 'var(--color-surface-page)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}
