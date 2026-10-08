import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TONE, cx } from '../lib/design-tokens';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useCrew } from '../lib/useCrew';
import { api, notifyFailure } from '../lib/api';
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
  /** YYYY-MM-DD the work falls on; carriedOver when that is before the day shown. */
  day?: string | null;
  carriedOver?: boolean;
}
interface Payload { rows: Row[]; date: string; generatedAt: string; checkoutsWithoutClean?: number }

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


const FILTERS = [
  { key: 'all', label: 'All work' },
  { key: 'checkin_risk', label: 'Check-in risk' },
  { key: 'housekeeping', label: 'Housekeeping' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'earlier', label: 'From earlier days' },
] as const;
type FilterKey = typeof FILTERS[number]['key'];

/* Seven-column track. Kept as an arbitrary grid-template so header and rows stay
 * locked to identical columns; the minmax() ramp is off any Tailwind scale. */
const COLS = 'grid-cols-[minmax(190px,1.5fr)_minmax(170px,1.5fr)_minmax(104px,0.9fr)_minmax(78px,0.6fr)_minmax(128px,1fr)_minmax(128px,1fr)_minmax(214px,1.5fr)]';

/* The SLA tone drives the 3px accent on a row's left edge, using the design's
 * -line (non-text) shade. TONE carries no line utility, so it is applied as an
 * arbitrary border-left-color per tone (see design-tokens.ts note). */
const LINE: Record<Tone, string> = {
  success:  '[border-left-color:var(--color-success-line)]',
  warning:  '[border-left-color:var(--color-warning-line)]',
  critical: '[border-left-color:var(--color-critical-line)]',
  info:     '[border-left-color:var(--color-info-line)]',
  neutral:  '[border-left-color:var(--color-neutral-line)]',
};

const isCheckinRisk = (r: Row) =>
  !!r.nextGuestAt && (r.sla.state === 'overdue' || r.sla.state === 'escalated' || r.sla.state === 'due');

const matchesFilter = (r: Row, f: FilterKey) =>
  f === 'all' ? true
  : f === 'checkin_risk' ? isCheckinRisk(r)
  : f === 'housekeeping' ? isHousekeeping(r.kind)
  : f === 'maintenance' ? r.kind === 'maintenance' || r.readiness === 'maintenance'
  : f === 'earlier' ? !!r.carriedOver
  : /* unassigned */ !r.assigneeId;

const shortDay = (d: string) => new Date(`${d}T12:00:00+08:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });

export default function OperationsTodayPage() {
  const CREW = useCrew('housekeeping');
  // The chosen filter lives in the URL so a refresh or a shared link keeps it.
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('filter');
  const filter: FilterKey = FILTERS.some(f => f.key === rawFilter) ? (rawFilter as FilterKey) : 'all';
  const setFilter = (k: FilterKey) => { const next = new URLSearchParams(params); if (k === 'all') next.delete('filter'); else next.set('filter', k); setParams(next, { replace: true }); };
  const { data, loading, error, reload } = useApi<Payload>('/operations/today', FALLBACK);

  // Overlay for changes already confirmed or in flight (assignments, answered guest requests).
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

  function openTask(r: Row) {
    window.location.hash = r.kind === 'maintenance' ? '#/operations/maintenance' : `#/operations/tasks?state=all&id=${encodeURIComponent(r.id)}`;
  }

  // Each action waits for the server before confirming; an assignment shows at once but is
  // rolled back if the server refuses it.
  function doAssign() {
    if (!assign) return;
    const cleaner = CREW.find(c => c.id === assign.cleanerId);
    if (!cleaner) return;
    const row = assign.row;
    const prev = edits[row.id];
    setEdits(e => ({ ...e, [row.id]: { ...e[row.id], assigneeId: cleaner.id, assigneeName: cleaner.name } }));
    setAssign(null);
    api.post(`/housekeeping/tasks/${row.id}/assign`, { assigneeId: cleaner.id })
      .then(() => { toast({ tone: 'success', title: 'Cleaner assigned.', body: `${cleaner.name} has been notified.` }); reload(); })
      .catch(err => { setEdits(e => ({ ...e, [row.id]: prev ?? {} })); notifyFailure(err); });
  }

  async function doMessage() {
    if (!message) return;
    const row = message.row;
    const guest = row.guest;
    if (!guest) return;
    try {
      await api.post('/messages', { taskId: row.id, channel: guest.channel, body: message.body });
      setEdits(e => ({ ...e, [row.id]: { ...e[row.id], guest: null } }));
      setMessage(null);
      toast({ tone: 'success', title: 'Message sent.', body: `Sent to ${guest.name} on ${CHANNEL[guest.channel].label}.` });
    } catch (e) { notifyFailure(e); }
  }

  async function doInspect() {
    if (!inspect) return;
    const row = inspect;
    try {
      await api.post<{ id: string }>('/inspections', { taskId: row.id, unitNumber: row.unitNumber });
      setInspect(null);
      toast({ tone: 'success', title: 'Inspection started.', body: `Checklist opened for ${unitRef(row.propertyName, row.unitNumber)}.` });
      window.location.hash = '#/operations/inspections';
    } catch (e) { notifyFailure(e); }
  }

  async function doOwnerNotice() {
    if (!ownerNotice) return;
    const row = ownerNotice;
    const owner = row.owner;
    if (!owner) return;
    try {
      await api.post(`/owners/${owner.id}/notify`, { unitNumber: row.unitNumber, reason: row.work });
      setOwnerNotice(null);
      toast({ tone: 'success', title: 'Owner notified.', body: `${owner.name} was sent the blocked-unit notice.` });
    } catch (e) { notifyFailure(e); }
  }

  interface RowAction { key: string; label: string; primary?: boolean; run: () => void }
  function actionsFor(r: Row): RowAction[] {
    const list: RowAction[] = [];
    if (isHousekeeping(r.kind)) {
      list.push({ key: 'assign', label: r.assigneeId ? 'Reassign cleaner' : 'Assign cleaner', primary: !r.assigneeId, run: () => setAssign({ row: r, cleanerId: r.assigneeId ?? CREW[0]?.id ?? '' }) });
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
    list.push({ key: 'open', label: 'Open task', run: () => openTask(r) });
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
            onClick={() => firstUnassigned && setAssign({ row: firstUnassigned, cleanerId: CREW[0]?.id ?? '' })}
          >
            Assign cleaner
          </Button>
        }
      />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      {(data?.checkoutsWithoutClean ?? 0) > 0 && (
        <div role="status" className={cx('flex items-center gap-3 flex-wrap py-[11px] px-3.5 rounded-control [border-left:2px_solid_var(--color-critical-line)]', TONE.critical.bg)}>
          <span className={cx('text-[13px] flex-1 min-w-[200px]', TONE.critical.text)}>
            {data!.checkoutsWithoutClean} check-out{data!.checkoutsWithoutClean === 1 ? '' : 's'} today {data!.checkoutsWithoutClean === 1 ? 'has' : 'have'} no cleaning task yet. Those units will not be turned over unless one is created.
          </span>
          <Button size="sm" variant="secondary" onClick={() => { window.location.hash = '#/operations/housekeeping'; }}>Plan cleaning</Button>
        </div>
      )}

      <div className="flex gap-[7px] flex-wrap">
        {FILTERS.filter(fl => fl.key !== 'earlier' || allRows.some(r => r.carriedOver)).map(fl => {
          const on = fl.key === filter;
          const n = allRows.filter(r => matchesFilter(r, fl.key)).length;
          return (
            <button
              key={fl.key}
              onClick={() => setFilter(fl.key)}
              aria-pressed={on}
              className={cx(
                'h-8 flex items-center px-[13px] py-0 rounded-full cursor-pointer whitespace-nowrap font-sans text-[13px] box-border border border-solid',
                on ? 'bg-black text-white border-black' : 'bg-white text-muted-ink border-line',
              )}
            >
              {fl.label}
              <span className={cx('ml-1.5 tabular-nums text-[11.5px]', on ? 'text-white/70' : 'text-faint')}>{n}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader title="All work, highest risk first" />
        <div className="pt-0 px-5 pb-3 -mt-2 text-[12px] text-muted-ink">
          Sorted by risk, then time{lastUpdated ? ` · last updated ${lastUpdated}` : ''}
        </div>

        <div className="overflow-x-auto hidden md:block">
          <div className="min-w-[1040px]">
            <div className={cx('grid', COLS, 'gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
              <div>Unit</div><div>Work</div><div>Readiness</div><div>Next guest</div><div>SLA</div><div>Assignee</div><div>Actions</div>
            </div>

            {loading && base.length === 0 ? (
              <TableSkeleton rows={5} cols={7} />
            ) : rows.length === 0 ? (
              <div className="py-[30px] px-[22px] flex flex-col gap-2.5 items-start">
                <span className="text-[13px] text-[#4A4844]">{allRows.length === 0 ? 'Nothing open needs action today.' : 'No work matches this filter.'}</span>
                {allRows.length > 0 && <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>Show all work</Button>}
              </div>
            ) : rows.map(r => {
              const actions = actionsFor(r);
              return (
                <div key={r.id} className={cx('grid', COLS, 'box-border gap-[14px] items-center min-h-[56px] py-[11px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] border-l-[3px]', LINE[r.sla.tone])}>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px] font-medium">{r.unitNumber}</span>
                    <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{r.propertyName}</span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13px]">{r.work}</span>
                    {r.note && <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{r.note}</span>}
                  </div>
                  <div><Badge tone={READINESS[r.readiness].tone} label={READINESS[r.readiness].label} /></div>
                  <div className="text-[13px]">{r.nextGuestAt ?? '—'}</div>
                  <div className="flex flex-col gap-1 items-start">
                    <Badge tone={r.sla.tone} label={r.sla.label} />
                    {r.carriedOver && r.day && <span className={cx('text-[11.5px]', TONE.critical.text)}>From {shortDay(r.day)}</span>}
                  </div>
                  <div className={cx('text-[13px] min-w-0 whitespace-nowrap overflow-hidden text-ellipsis', r.assigneeName ? 'text-ink' : 'text-muted-ink')}>
                    {r.assigneeName ?? 'Unassigned'}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map(a => (
                      <button
                        key={a.key}
                        onClick={a.run}
                        className={cx(
                          'h-7 inline-flex items-center px-[11px] py-0 rounded-control cursor-pointer whitespace-nowrap font-sans text-[12.5px] box-border border border-solid',
                          a.primary ? 'bg-black text-white border-black' : 'bg-white text-[#4A4844] border-line',
                        )}
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

        {/* Phones: one card per job, the same order and actions. */}
        <div className="md:hidden [border-top:1px_solid_var(--color-line)]">
          {loading && base.length === 0 ? <TableSkeleton rows={4} cols={2} />
            : rows.length === 0 ? (
              <div className="py-6 px-4 text-[13px] text-muted-ink">{allRows.length === 0 ? 'Nothing open needs action today.' : 'No work matches this filter.'}</div>
            ) : rows.map(r => (
              <div key={r.id} className={cx('py-3 px-4 flex flex-col gap-2 [border-bottom:1px_solid_var(--color-line-soft)] border-l-[3px] border-solid border-y-0 border-r-0', LINE[r.sla.tone])}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px] font-semibold truncate">{unitRef(r.propertyName, r.unitNumber)}</span>
                    <span className="text-[12px] text-muted-ink truncate">{r.work}</span>
                  </div>
                  <Badge tone={r.sla.tone} label={r.sla.label} size="sm" />
                </div>
                <div className="flex gap-x-4 gap-y-1 flex-wrap text-[12px]">
                  <span className={r.assigneeName ? 'text-ink' : 'text-muted-ink'}>{r.assigneeName ?? 'Unassigned'}</span>
                  <span className="text-muted-ink">{READINESS[r.readiness].label}</span>
                  {r.nextGuestAt && <span className="text-muted-ink">Guest {r.nextGuestAt}</span>}
                  {r.carriedOver && r.day && <span className={TONE.critical.text}>From {shortDay(r.day)}</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {actionsFor(r).map(a => (
                    <button key={a.key} onClick={a.run}
                      className={cx('h-8 inline-flex items-center px-[11px] py-0 rounded-control cursor-pointer whitespace-nowrap font-sans text-[12.5px] box-border border border-solid',
                        a.primary ? 'bg-black text-white border-black' : 'bg-white text-[#4A4844] border-line')}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
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
          <label className="flex flex-col gap-[7px]">
            <span className="text-[12px] font-medium text-muted-ink">Cleaner</span>
            <select className="field-input" value={assign.cleanerId}
              onChange={e => setAssign(a => a && { ...a, cleanerId: e.target.value })}>
              {CREW.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {assign.row.nextGuestAt && (
            <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-[12px]">
              Next guest arrives {assign.row.nextGuestAt} {'·'} {assign.row.sla.label}
            </div>
          )}
          {assignOverlap(assign, allRows) && (
            <div role="status" className={cx('py-[9px] px-[11px] rounded-control text-[12px]', TONE.warning.bg, TONE.warning.text)}>
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
          <label className="flex flex-col gap-[7px]">
            <span className="text-[12px] font-medium text-muted-ink">Message</span>
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
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[460px] bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[9px]">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold [text-wrap:pretty]">{title}</h2>
          {sub && <p className="m-0 text-[13px] leading-[1.55] text-muted-ink [text-wrap:pretty]">{sub}</p>}
        </div>
        <div className="pt-[14px] px-[22px] pb-[18px] flex flex-col gap-3">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-border-default)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          {footer}
        </div>
      </div>
    </div>
  );
}
