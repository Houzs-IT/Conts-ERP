import { useEffect, useRef, useState, type ReactNode } from 'react';
import { color } from '../theme';
import { TONE, cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { unitRef } from '../lib/format';
import { TASK } from '../lib/vocabulary';
import type { Task, TaskState, Tone } from '../lib/types';

/* ------------------------------------------------------------------ *
 * Operations -> Tasks (/operations/tasks). The full work list across every
 * task kind — turnover, deep/light clean, inspection, maintenance, delivery,
 * other — not just cleaning. Each row carries its photo requirement, assignee,
 * the server-computed SLA pill (tone from data, never recomputed from the
 * client clock) and its state badge. Row actions follow the cleaning-task
 * contract in BUTTONS.md section 7: assign, start, add photo, mark complete
 * (blocked without a photo when required), reschedule.
 *
 * There is no backend in dev, so mutations write to a local overlay keyed by
 * id and attempt the real call in a swallowed try/catch (see IMPL-BRIEF).
 * ------------------------------------------------------------------ */

type Kind = Task['kind'];
const KIND_LABEL: Record<Kind, string> = {
  turnover: 'Turnover', deep_clean: 'Deep clean', light_clean: 'Light clean',
  inspection: 'Inspection', maintenance: 'Maintenance', delivery: 'Delivery', other: 'Other',
};

interface Assignee { id: string; name: string }
const CREW: Assignee[] = [
  { id: 'u5', name: 'Nurul Huda' },
  { id: 'u6', name: 'Faridah Ismail' },
  { id: 'u7', name: 'Chan Wei Wen' },
  { id: 'u9', name: 'Siti Rahmah' },
];
const firstName = (name: string) => name.split(' ')[0];

interface Payload { data: Task[]; total: number }

/** Dev fallback so the screen renders before the endpoint is live. Times are
 *  HH:MM; the live backend returns ISO and owns the SLA object outright. */
const FALLBACK: Payload = {
  total: 9,
  data: [
    { id: 'TSK-1042', unitId: 'un-a2102', unitNumber: '#A-21-02', propertyName: 'The Establishment', kind: 'turnover', state: 'overdue', title: 'Full turnover, 2BR', instructions: 'No cleaner assigned. Linen set A.', assigneeId: null, assigneeName: null, scheduledFor: '14:00', dueAt: '14:54', nextGuestAt: '15:00', requiresPhoto: true, photoCount: 0, sequence: 1, sync: 'synced', sla: { state: 'overdue', minutes: -12, label: 'Overdue 12 min', tone: 'critical' }, riskRank: 1 },
    { id: 'TSK-1038', unitId: 'un-a1203', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', kind: 'turnover', state: 'in_progress', title: 'Full turnover, 2BR', instructions: 'Late check-out to 13:00. Restock coffee pods.', assigneeId: 'u5', assigneeName: 'Nurul Huda', scheduledFor: '13:00', dueAt: '15:00', nextGuestAt: '15:00', requiresPhoto: true, photoCount: 2, sequence: 2, sync: 'synced', sla: { state: 'escalated', minutes: -3, label: 'Escalated', tone: 'critical' }, riskRank: 2 },
    { id: 'TSK-1040', unitId: 'un-b0811', unitNumber: '#B-08-11', propertyName: 'Arcoris', kind: 'turnover', state: 'in_progress', title: 'Full turnover, studio', instructions: 'Early check-in requested by next guest.', assigneeId: 'u5', assigneeName: 'Nurul Huda', scheduledFor: '12:00', dueAt: '15:30', nextGuestAt: '16:00', requiresPhoto: true, photoCount: 1, sequence: 3, sync: 'synced', sla: { state: 'due', minutes: 45, label: 'Due in 45 min', tone: 'warning' }, riskRank: 4 },
    { id: 'TSK-1041', unitId: 'un-1506', unitNumber: '#15-06', propertyName: 'Scarletz', kind: 'deep_clean', state: 'assigned', title: 'Deep clean, 1BR', instructions: 'Vacant 4 nights. Descale kettle and shower.', assigneeId: 'u6', assigneeName: 'Faridah Ismail', scheduledFor: '10:00', dueAt: '16:30', nextGuestAt: '18:00', requiresPhoto: true, photoCount: 0, sequence: 4, sync: 'synced', sla: { state: 'due', minutes: 78, label: 'Due in 1 h 18 m', tone: 'warning' }, riskRank: 6 },
    { id: 'TSK-1039', unitId: 'un-2207', unitNumber: '#2207', propertyName: 'Tribeca', kind: 'inspection', state: 'assigned', title: 'Quality inspection', instructions: 'Post-turnover spot check before release.', assigneeId: 'u7', assigneeName: 'Chan Wei Wen', scheduledFor: '16:00', dueAt: '17:30', nextGuestAt: null, requiresPhoto: true, photoCount: 0, sequence: 5, sync: 'synced', sla: { state: 'on_track', minutes: 210, label: 'On track', tone: 'success' }, riskRank: 9 },
    { id: 'TSK-1037', unitId: 'un-c3114', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', kind: 'maintenance', state: 'assigned', title: 'Clear dust sheets after plumbing repair', instructions: 'Plumbing repair completed. Photo the finished bathroom.', assigneeId: 'u9', assigneeName: 'Siti Rahmah', scheduledFor: '16:00', dueAt: '18:00', nextGuestAt: null, requiresPhoto: true, photoCount: 0, sequence: 6, sync: 'queued', sla: { state: 'none', minutes: 0, label: 'No deadline', tone: 'neutral' }, riskRank: 12 },
    { id: 'TSK-1036', unitId: 'un-a0501', unitNumber: '#A-05-01', propertyName: 'Trion', kind: 'delivery', state: 'open', title: 'Deliver welcome pack and linens', instructions: 'Leave with concierge if the unit is occupied.', assigneeId: null, assigneeName: null, scheduledFor: '09:00', dueAt: '11:00', nextGuestAt: null, requiresPhoto: false, photoCount: 0, sequence: 7, sync: 'synced', sla: { state: 'none', minutes: 0, label: 'No deadline', tone: 'neutral' }, riskRank: 14 },
    { id: 'TSK-1034', unitId: 'un-1204', unitNumber: '#12-04', propertyName: 'Arte', kind: 'light_clean', state: 'assigned', title: 'Light refresh, owner stay ended', instructions: 'Standard refresh. Linen set B.', assigneeId: 'u6', assigneeName: 'Faridah Ismail', scheduledFor: '08:00', dueAt: '10:00', nextGuestAt: null, requiresPhoto: true, photoCount: 0, sequence: 8, sync: 'synced', sla: { state: 'on_track', minutes: 300, label: 'On track', tone: 'success' }, riskRank: 16 },
    { id: 'TSK-1035', unitId: 'un-a0907', unitNumber: '#A-09-07', propertyName: 'Vista Jaya One', kind: 'other', state: 'resolved', title: 'Owner report photos', instructions: 'Quarterly condition set for the owner statement.', assigneeId: 'u7', assigneeName: 'Chan Wei Wen', scheduledFor: '15:00', dueAt: '16:30', nextGuestAt: null, requiresPhoto: false, photoCount: 6, sequence: 9, sync: 'synced', sla: { state: 'none', minutes: 0, label: 'No deadline', tone: 'neutral' }, riskRank: 20 },
  ],
};

/* ------------------------------- helpers -------------------------------- */
const toMin = (hhmm: string | null): number | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};
/** Two HH:MM windows overlap? Used to surface the 409 ASSIGNEE_BUSY clash. */
function windowsOverlap(aS: string | null, aE: string | null, bS: string | null, bE: string | null): boolean {
  const as = toMin(aS), ae = toMin(aE), bs = toMin(bS), be = toMin(bE);
  if (as === null || ae === null || bs === null || be === null) return false;
  return as < be && bs < ae;
}
/** A task that needs evidence and has none is the thing worth flagging. */
function evidenceOf(t: Task): { label: string; warn: boolean } {
  if (t.requiresPhoto && t.photoCount < 1) return { label: '0 of 1 required', warn: true };
  if (t.photoCount > 0) return { label: `${t.photoCount} attached`, warn: false };
  return { label: 'None needed', warn: false };
}

/* The SLA/state tone drives the 3px accent on a row's left edge. It uses the
 * design's -line (non-text) shade, which lives only as a CSS var — TONE has no
 * line utility — so it is applied as an arbitrary border-color per tone. */
const LINE: Record<Tone, string> = {
  success:  '[border-left-color:var(--color-success-line)]',
  warning:  '[border-left-color:var(--color-warning-line)]',
  critical: '[border-left-color:var(--color-critical-line)]',
  info:     '[border-left-color:var(--color-info-line)]',
  neutral:  '[border-left-color:var(--color-neutral-line)]',
};

/* Tone TEXT (fg). The generic `text-<tone>` utility resolves to the tint here
 * (root tokens.css, unlayered, overrides the @theme value), so the accessible
 * foreground shade is taken from its dedicated -fg var to stay 1:1. */
const TONE_FG: Record<Tone, string> = {
  success:  'text-[var(--color-success-fg)]',
  warning:  'text-[var(--color-warning-fg)]',
  critical: 'text-[var(--color-critical-fg)]',
  info:     'text-[var(--color-info-fg)]',
  neutral:  'text-[var(--color-neutral-fg)]',
};

/* ------------------------------ local modal ------------------------------ */
const inputCls = 'block w-full box-border h-10 py-0 px-3 text-ink bg-white border border-line rounded-control outline-none [font:inherit]';
const labelCls = 'text-[12px] font-medium text-muted-ink';

function Modal({ title, sub, onClose, children, footer, busy }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode; busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div ref={ref}
        className="relative w-full max-w-[460px] max-h-[88vh] overflow-y-auto bg-card rounded-card shadow-[var(--shadow-overlay)] [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="pt-5 px-[22px] pb-1 flex items-start justify-between gap-3">
          <div className="flex flex-col gap-[5px]">
            <h2 className="m-0 text-[18px] leading-[1.3] font-semibold">{title}</h2>
            {sub && <p className="m-0 text-[13px] leading-[1.5] text-muted-ink">{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" disabled={busy}
            className="bg-transparent border-none p-1 cursor-pointer text-muted-ink flex">
            <Icon name="X" size="sm" />
          </button>
        </div>
        <div className="pt-[14px] px-[22px] pb-1 flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] mt-2 border-t border-line bg-page flex items-center justify-end gap-[9px] flex-wrap sticky bottom-0">{footer}</div>
      </div>
    </div>
  );
}

/* ------------------------------- filters -------------------------------- */
const STATE_FILTERS: (TaskState | 'all')[] = ['all', 'open', 'assigned', 'in_progress', 'overdue', 'resolved'];
const stateFilterLabel = (s: TaskState | 'all') => (s === 'all' ? 'All tasks' : TASK[s].label);

/* ------------------------------- the page -------------------------------- */
export default function TasksPage() {
  const [stateFilter, setStateFilter] = useState<TaskState | 'all'>('all');
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const { data, loading, error, reload } = useApi<Payload>('/tasks', FALLBACK);
  const toast = useToast();

  // Optimistic overlay: patches merged onto each task by id.
  const [edits, setEdits] = useState<Record<string, Partial<Task>>>({});
  const patch = (id: string, p: Partial<Task>) => setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));

  // Dialog / modal state.
  const [assign, setAssign] = useState<{ task: Task; assigneeId: string; force: boolean; warning?: string } | null>(null);
  const [reschedule, setReschedule] = useState<{ task: Task; start: string; end: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'start' | 'complete'; task: Task }>(null);
  const [busy, setBusy] = useState(false);

  const all: Task[] = (data?.data ?? []).map(t => ({ ...t, ...edits[t.id] }));
  const rows = all.filter(t =>
    (stateFilter === 'all' || t.state === stateFilter) &&
    (kindFilter === 'all' || t.kind === kindFilter));
  const openCount = all.filter(t => t.state !== 'resolved').length;
  const filtersActive = stateFilter !== 'all' || kindFilter !== 'all';
  const clearFilters = () => { setStateFilter('all'); setKindFilter('all'); };

  /* -------------------------------- actions ------------------------------- */
  function openAssign(task: Task) {
    setAssign({ task, assigneeId: task.assigneeId ?? CREW[0].id, force: false });
  }

  async function doAssign() {
    if (!assign) return;
    const { task, assigneeId, force } = assign;
    const who = CREW.find(c => c.id === assigneeId)!;

    // Simulate the 409 ASSIGNEE_BUSY overlap check the backend would run.
    if (!force) {
      const clash = all.filter(t =>
        t.id !== task.id && t.assigneeId === assigneeId && t.state !== 'resolved' &&
        windowsOverlap(task.scheduledFor, task.dueAt, t.scheduledFor, t.dueAt));
      if (clash.length) {
        const at = clash[0].scheduledFor ?? clash[0].dueAt ?? '';
        setAssign(a => a && {
          ...a, force: true,
          warning: `${firstName(who.name)} has ${clash.length} overlapping task${clash.length > 1 ? 's' : ''} at ${at}. Assign anyway?`,
        });
        return;
      }
    }

    setBusy(true);
    // Assigning an unresolved task that is not already underway moves it to assigned.
    const nextState: TaskState = task.state === 'in_progress' || task.state === 'resolved' ? task.state : 'assigned';
    patch(task.id, { assigneeId: who.id, assigneeName: who.name, state: nextState });
    toast({ tone: 'success', title: 'Cleaner assigned.', body: `${firstName(who.name)} has been notified.` });
    setAssign(null);
    try { await api.post(`/housekeeping/tasks/${task.id}/assign`, { assigneeId: who.id, force }); }
    catch { /* dev: no backend, keep optimistic */ }
    setBusy(false);
  }

  async function doReschedule() {
    if (!reschedule) return;
    const { task, start, end } = reschedule;
    setBusy(true);
    patch(task.id, { scheduledFor: start, dueAt: end });
    toast({ tone: 'success', title: 'Task rescheduled.', body: `${unitRef(task.propertyName, task.unitNumber)} · ${start} to ${end}.` });
    setReschedule(null);
    try { await api.patch(`/housekeeping/tasks/${task.id}`, { scheduledFor: start, dueAt: end }); } catch { /* dev */ }
    setBusy(false);
  }

  async function doStart() {
    const task = confirm?.task;
    if (!task) return;
    setBusy(true);
    patch(task.id, { state: 'in_progress' });
    toast({ tone: 'info', title: 'Task started.', body: `${unitRef(task.propertyName, task.unitNumber)} is now in progress.` });
    setConfirm(null);
    try { await api.post(`/housekeeping/tasks/${task.id}/start`, {}); } catch { /* dev */ }
    setBusy(false);
  }

  async function addPhoto(task: Task) {
    patch(task.id, { photoCount: task.photoCount + 1 });
    toast({ tone: 'success', title: 'Photo added.', body: `${task.photoCount + 1} on ${unitRef(task.propertyName, task.unitNumber)}.` });
    try { await api.post(`/tasks/${task.id}/photos`, {}); } catch { /* dev */ }
  }

  async function doComplete() {
    const task = confirm?.task;
    if (!task) return;
    // Guard mirrors the 422 PHOTO_REQUIRED contract on POST /api/tasks/:id/complete.
    if (task.requiresPhoto && task.photoCount < 1) {
      toast({ tone: 'critical', title: 'Cannot mark complete.', body: 'Add at least one photo before marking this unit ready.' });
      setConfirm(null);
      return;
    }
    setBusy(true);
    patch(task.id, { state: 'resolved' });
    toast({ tone: 'success', title: 'Task complete.', body: `${unitRef(task.propertyName, task.unitNumber)} · marked resolved.` });
    setConfirm(null);
    try { await api.post(`/tasks/${task.id}/complete`, { photoIds: [] }); } catch { /* dev */ }
    setBusy(false);
  }

  const baseRows = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Tasks"
        sub={`${openCount} open · every task carries its photo requirement`}
      />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {/* Filters — state chips + kind select */}
      <div className="flex gap-3 flex-wrap items-center justify-between">
        <div className="flex gap-[7px] flex-wrap">
          {STATE_FILTERS.map(fl => {
            const on = fl === stateFilter;
            return (
              <button key={fl} onClick={() => setStateFilter(fl)}
                className={`h-8 flex items-center px-[13px] py-0 rounded-full cursor-pointer whitespace-nowrap [font:inherit] border ${on ? 'bg-black text-white border-black' : 'bg-white text-muted-ink border-line'}`}>
                {stateFilterLabel(fl)}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 items-center">
          <label htmlFor="kind-filter" className={`${labelCls} whitespace-nowrap`}>Kind</label>
          <select id="kind-filter" value={kindFilter}
            onChange={e => setKindFilter(e.target.value as Kind | 'all')}
            className="block w-auto box-border h-8 py-0 pr-[30px] pl-3 text-ink bg-white border border-line rounded-control outline-none cursor-pointer [font:inherit]">
            <option value="all">All kinds</option>
            {(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
      </div>

      <Card>
        <div className="py-[13px] px-5 flex items-center justify-between gap-3 flex-wrap border-b border-b-line">
          <span className="text-[16px] font-semibold">All tasks</span>
          <span className="text-[12px] text-muted-ink">
            {rows.length} of {all.length} · SLA and risk are computed server-side
          </span>
        </div>

        {loading && baseRows.length === 0 ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rows.length === 0 ? (
          <div className="py-[30px] px-[22px] flex flex-col gap-3 items-start">
            <span className="text-[13px] text-muted-ink">No tasks match these filters.</span>
            {filtersActive && (
              <Button size="sm" variant="secondary" icon={<Icon name="FilterX" size="sm" />} onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          rows.map(t => {
            const done = t.state === 'resolved';
            const inProgress = t.state === 'in_progress';
            const canStart = t.state === 'assigned';
            const noPhoto = t.requiresPhoto && t.photoCount < 1;
            const ev = evidenceOf(t);
            const windowLabel = t.scheduledFor && t.dueAt ? `${t.scheduledFor} → ${t.dueAt}` : '—';
            const lineTone: Tone = done ? 'success' : t.sla.tone;

            return (
              <div key={t.id}
                className={cx('flex gap-[18px] py-[15px] px-5 flex-wrap border-b border-b-line-soft border-l-[3px]', LINE[lineTone], done && 'opacity-[0.72]')}>
                {/* left: identity + fields */}
                <div className="flex-1 min-w-[260px] flex flex-col gap-[9px]">
                  <div className="flex items-center gap-[9px] flex-wrap">
                    <span className="text-[14px] font-semibold">{unitRef(t.propertyName, t.unitNumber)}</span>
                    <Badge tone="neutral" label={KIND_LABEL[t.kind]} size="sm" />
                    <Badge tone={TASK[t.state].tone} label={TASK[t.state].label} size="sm" />
                    {!done && <Badge tone={t.sla.tone} label={t.sla.label} size="sm" />}
                  </div>

                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[13px] text-ink">{t.title}</span>
                    <span className="font-mono text-[11px] text-muted-ink">{t.id}</span>
                  </div>

                  <div className="flex gap-[22px] flex-wrap text-[12.5px]">
                    <FieldPair label="Assignee" value={t.assigneeName ?? 'Unassigned'} muted={!t.assigneeName} />
                    <FieldPair label="Window" value={windowLabel} />
                    <FieldPair label="Next guest" value={t.nextGuestAt ?? 'No arrival'} tone={t.sla.tone === 'critical' ? 'critical' : undefined} />
                    <FieldPair label="Evidence" value={ev.label} tone={ev.warn ? 'warning' : undefined} />
                  </div>

                  {t.instructions && (
                    <div className="text-[12.5px] text-muted-ink flex gap-[7px] items-start">
                      <Icon name="Info" size="sm" color={color.faint} style={{ marginTop: 1 }} />
                      <span>{t.instructions}</span>
                    </div>
                  )}

                  {inProgress && noPhoto && (
                    <div className="text-[12px] text-[var(--color-warning-fg)] flex gap-1.5 items-center">
                      <Icon name="Camera" size="sm" color={TONE.warning.hex} />
                      Add at least one photo before marking this unit ready.
                    </div>
                  )}
                </div>

                {/* right: state-driven actions */}
                <div className="flex flex-col gap-[7px] items-stretch min-w-[168px]">
                  {!done && (
                    <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => openAssign(t)}>
                      {t.assigneeId ? 'Reassign cleaner' : 'Assign cleaner'}
                    </Button>
                  )}
                  {!done && (
                    <Button size="sm" variant="tertiary" icon={<Icon name="CalendarClock" size="sm" />} onClick={() => setReschedule({ task: t, start: t.scheduledFor ?? '08:00', end: t.dueAt ?? '12:00' })}>
                      Reschedule
                    </Button>
                  )}
                  {canStart && (
                    <Button size="sm" variant="primary" icon={<Icon name="Play" size="sm" />} onClick={() => setConfirm({ kind: 'start', task: t })}>
                      Start
                    </Button>
                  )}
                  {inProgress && (
                    <>
                      <Button size="sm" variant="secondary" icon={<Icon name="Camera" size="sm" />} onClick={() => addPhoto(t)}>
                        Add photo
                      </Button>
                      <Button
                        size="sm" variant="primary" icon={<Icon name="Check" size="sm" />}
                        disabled={noPhoto}
                        disabledReason="Add at least one photo before marking this unit ready."
                        onClick={() => setConfirm({ kind: 'complete', task: t })}
                      >
                        Mark complete
                      </Button>
                    </>
                  )}
                  {done && (
                    <span className="text-[12.5px] text-[var(--color-success-fg)] flex items-center gap-1.5 justify-center h-9">
                      <Icon name="CheckCheck" size="sm" color={TONE.success.hex} /> Resolved
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Card>

      {/* ---------------- Assign cleaner (with 409 override) ---------------- */}
      {assign && (
        <Modal
          title={`Assign a cleaner to ${unitRef(assign.task.propertyName, assign.task.unitNumber)}?`}
          sub="They are notified immediately. The task stays in its current state until they start it and add a photo."
          onClose={() => setAssign(null)}
          busy={busy}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setAssign(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant={assign.force ? 'danger' : 'primary'} loading={busy} onClick={doAssign}>
              {assign.force ? 'Assign anyway' : 'Assign cleaner'}
            </Button>
          </>}
        >
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="assign-who" className={labelCls}>Cleaner</label>
            <select id="assign-who" value={assign.assigneeId} disabled={busy}
              onChange={e => setAssign(a => a && { ...a, assigneeId: e.target.value, force: false, warning: undefined })}
              className={inputCls}>
              {CREW.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {assign.task.nextGuestAt && (
            <div className="text-[12.5px] text-muted-ink">Next guest arrives {assign.task.nextGuestAt}.</div>
          )}
          {assign.warning && (
            <div className={`py-2.5 px-3 rounded-control ${TONE.critical.bg} text-[var(--color-critical-fg)] text-[12.5px] flex gap-2 items-start`}>
              <Icon name="TriangleAlert" size="sm" color={TONE.critical.hex} style={{ marginTop: 1 }} />
              <span>{assign.warning}</span>
            </div>
          )}
        </Modal>
      )}

      {/* ------------------------- Reschedule ------------------------- */}
      {reschedule && (() => {
        const endsAfter = !!reschedule.task.nextGuestAt && toMin(reschedule.end)! > toMin(reschedule.task.nextGuestAt)!;
        return (
          <Modal
            title={`Reschedule ${unitRef(reschedule.task.propertyName, reschedule.task.unitNumber)}`}
            sub="Set a new window for this task. It should close before the next guest arrives."
            onClose={() => setReschedule(null)}
            busy={busy}
            footer={<>
              <Button size="sm" variant="secondary" onClick={() => setReschedule(null)} disabled={busy}>Cancel</Button>
              <Button size="sm" variant={endsAfter ? 'danger' : 'primary'} loading={busy} onClick={doReschedule}>
                {endsAfter ? 'Reschedule anyway' : 'Reschedule'}
              </Button>
            </>}
          >
            <div className="flex gap-[14px]">
              <div className="flex-1 flex flex-col gap-[7px]">
                <label htmlFor="rs-start" className={labelCls}>Window start (scheduled for)</label>
                <input id="rs-start" type="time" value={reschedule.start} disabled={busy}
                  onChange={e => setReschedule(r => r && { ...r, start: e.target.value })} className={inputCls} />
              </div>
              <div className="flex-1 flex flex-col gap-[7px]">
                <label htmlFor="rs-end" className={labelCls}>Window end (due at)</label>
                <input id="rs-end" type="time" value={reschedule.end} disabled={busy}
                  onChange={e => setReschedule(r => r && { ...r, end: e.target.value })} className={inputCls} />
              </div>
            </div>
            <div className="text-[12.5px] text-muted-ink">
              Next guest arrives {reschedule.task.nextGuestAt ?? 'not scheduled'}.
            </div>
            {endsAfter && (
              <div className={`py-2.5 px-3 rounded-control ${TONE.warning.bg} text-[var(--color-warning-fg)] text-[12.5px] flex gap-2 items-start`}>
                <Icon name="TriangleAlert" size="sm" color={TONE.warning.hex} style={{ marginTop: 1 }} />
                <span>The window ends at {reschedule.end}, after the next guest arrives at {reschedule.task.nextGuestAt}. The unit may not be ready in time.</span>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* --------------------------- confirms --------------------------- */}
      <Dialog
        busy={busy}
        onClose={() => setConfirm(null)}
        spec={!confirm ? null
          : confirm.kind === 'start' ? {
            title: `Start ${unitRef(confirm.task.propertyName, confirm.task.unitNumber)}?`,
            body: 'The task moves to in progress. A photo is required before it can be marked complete.',
            meta: confirm.task.nextGuestAt ? `Next guest arrives ${confirm.task.nextGuestAt}.` : undefined,
            confirmLabel: 'Start', busyLabel: 'Starting…', onConfirm: doStart,
          }
          : {
            title: `Mark ${unitRef(confirm.task.propertyName, confirm.task.unitNumber)} complete?`,
            body: `${confirm.task.photoCount} photo${confirm.task.photoCount === 1 ? '' : 's'} attached. The task is marked resolved.`,
            meta: confirm.task.nextGuestAt ? `Next check-in is ${confirm.task.nextGuestAt}.` : undefined,
            confirmLabel: 'Mark complete', busyLabel: 'Completing…', onConfirm: doComplete,
          }}
      />
    </>
  );
}

/** A compact label/value pair used across a task's field row. */
function FieldPair({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-faint font-semibold uppercase tracking-[0.03em]">{label}</span>
      <span className={cx('text-[12.5px] font-medium whitespace-nowrap', tone ? TONE_FG[tone] : muted ? 'text-muted-ink' : 'text-ink')}>{value}</span>
    </div>
  );
}
