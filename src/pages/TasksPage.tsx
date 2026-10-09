import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { useCrew } from '../lib/useCrew';
import { api, notifyFailure } from '../lib/api';
import { unitRef, dateShort, weekdayDay, time, count, plural } from '../lib/format';
import { Select } from '../components/Select';
import { EmptyState } from '../components/States';
import { Chip, Pager } from './finance/listKit';
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
 * The list is paged on the server; every filter lives in the URL.
 * ------------------------------------------------------------------ */

type Kind = Task['kind'];
const KIND_LABEL: Record<Kind, string> = {
  turnover: 'Turnover', deep_clean: 'Deep clean', light_clean: 'Light clean',
  inspection: 'Inspection', maintenance: 'Maintenance', delivery: 'Delivery', other: 'Other',
};

const firstName = (name: string) => name.split(' ')[0];

/** A task as the paged list returns it: the shared Task plus its day and the cleaner the import sheet named. */
type Row = Task & { date?: string; propertyId?: string; cleanerId?: string | null; sheetCleaner?: string | null; completedAt?: string | null; startedAt?: string | null };
interface Payload { data: Row[]; total: number; page?: number; pageSize?: number; counts?: Record<string, number> }
interface Facets { buildings: { id: string; name: string }[]; assignees: { key: string; name: string; count: number }[] }
const dateTimeShort = (iso: string) => `${dateShort(iso)} ${time(iso)}`;

/** Dev fallback so the screen renders before the endpoint is live. Times are
 *  HH:MM; the live backend returns ISO and owns the SLA object outright. */
const FALLBACK: Payload = {
  total: 9, counts: { overdue: 1, in_progress: 2, assigned: 4, open: 1, resolved: 1 },
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
const labelCls = 'text-meta font-medium text-muted-ink';

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
            <h2 className="m-0 text-title leading-[1.3] font-semibold">{title}</h2>
            {sub && <p className="m-0 text-copy leading-[1.5] text-muted-ink">{sub}</p>}
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
type StateFilter = 'active' | 'all' | 'open' | 'assigned' | 'in_progress' | 'overdue' | 'resolved';
const STATE_FILTERS: [StateFilter, string][] = [
  ['active', 'Not done'], ['open', 'Open'], ['assigned', 'Assigned'], ['in_progress', 'In progress'],
  ['overdue', 'Overdue'], ['resolved', 'Done'], ['all', 'Everything'],
];
const KIND_FILTERS: [string, string][] = [['all', 'All kinds'], ['cleaning', 'All cleaning'], ...(Object.keys(KIND_LABEL) as Kind[]).map(k => [k, KIND_LABEL[k]] as [string, string])];
const PAGE_SIZE = 50;

/* Eight-column track shared by the sticky header and every row. */
const COLS = 'grid-cols-[92px_minmax(150px,1.2fr)_minmax(170px,1.6fr)_minmax(110px,1fr)_118px_minmax(118px,0.9fr)_64px_172px]';
const dayLabel = (d: string | null | undefined) => (d ? `${weekdayDay(d).split(' ')[0]} ${dateShort(d)}` : '—');
const noteOf = (t: Row) => (t.instructions ?? '').replace(/^Cleaner: [^·]+(· )?/, '').trim();
const whoOf = (t: Row) => t.assigneeName ?? (t.sheetCleaner ? `${t.sheetCleaner} (sheet)` : null);

/* ------------------------------- the page -------------------------------- */
export default function TasksPage() {
  const CREW = useCrew('all');
  const toast = useToast();

  // The URL is the state: filters and page survive a refresh and can be shared.
  const [params, setParams] = useSearchParams();
  const setParam = (patchP: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patchP)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    if (!('page' in patchP)) next.delete('page');
    setParams(next, { replace: true });
  };
  const rawState = params.get('state');
  const stateFilter: StateFilter = STATE_FILTERS.some(([k]) => k === rawState) ? (rawState as StateFilter) : 'active';
  const kindFilter = params.get('kind') ?? 'all';
  const building = params.get('building') ?? '';
  const assignee = params.get('assignee') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const q = params.get('q') ?? '';
  const idFilter = params.get('id') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  // Typing updates the box at once and the URL (and the fetch) a moment later.
  const [qDraft, setQDraft] = useState(q);
  useEffect(() => { setQDraft(q); }, [q]);
  useEffect(() => {
    if (qDraft === q) return;
    const t = setTimeout(() => setParam({ q: qDraft.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [qDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = new URLSearchParams({ state: stateFilter, page: String(page), pageSize: String(PAGE_SIZE) });
  if (kindFilter !== 'all') query.set('kind', kindFilter);
  for (const [k, v] of [['building', building], ['assignee', assignee], ['from', from], ['to', to], ['q', q], ['id', idFilter]] as const) if (v) query.set(k, v);
  const { data, loading, error, reload } = useApi<Payload>(`/tasks?${query}`, FALLBACK);
  const { data: facets } = useApi<Facets>('/tasks/facets');

  // Optimistic overlay: patches merged onto each task by id until the next reload.
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const patch = (id: string, p: Partial<Row>) => setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));
  useEffect(() => { setEdits({}); }, [data]);

  // Dialog / modal state.
  const [assign, setAssign] = useState<{ task: Row; assigneeId: string; force: boolean; warning?: string } | null>(null);
  const [reschedule, setReschedule] = useState<{ task: Row; start: string; end: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'start' | 'complete'; task: Row }>(null);
  const [busy, setBusy] = useState(false);

  const rows: Row[] = (data?.data ?? []).map(t => ({ ...t, ...edits[t.id] }));
  const all = rows;
  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const countOf = (k: StateFilter) =>
    k === 'all' ? Object.values(counts).reduce((s, n) => s + n, 0)
    : k === 'active' ? Object.entries(counts).filter(([s]) => s !== 'resolved').reduce((s, [, n]) => s + n, 0)
    : counts[k] ?? 0;
  const filtersActive = kindFilter !== 'all' || !!building || !!assignee || !!from || !!to || !!q || !!idFilter;
  const clearFilters = () => { setQDraft(''); setParam({ kind: null, building: null, assignee: null, from: null, to: null, q: null, id: null }); };
  const goPage = (n: number) => { setParam({ page: n > 1 ? String(n) : null }); document.querySelector('main')?.scrollTo({ top: 0 }); };
  const [moreFilters, setMoreFilters] = useState(false);
  const extraCount = [kindFilter !== 'all', building, assignee, from || to].filter(Boolean).length;
  const doneElsewhere = stateFilter === 'active' && total === 0 && (counts.resolved ?? 0) > 0;

  /* -------------------------------- actions ------------------------------- */
  function openAssign(task: Row) {
    setAssign({ task, assigneeId: task.assigneeId ?? CREW[0]?.id ?? '', force: false });
  }

  async function doAssign() {
    if (!assign) return;
    const { task, assigneeId, force } = assign;
    const who = CREW.find(c => c.id === assigneeId);
    if (!who) return;

    // Mirrors the 409 ASSIGNEE_BUSY overlap check the backend runs.
    if (!force) {
      const clash = all.filter(t =>
        t.id !== task.id && t.assigneeId === assigneeId && t.state !== 'resolved' && t.date === task.date &&
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
    setAssign(null);
    try {
      await api.post(`/housekeeping/tasks/${task.id}/assign`, { assigneeId: who.id, force });
      toast({ tone: 'success', title: 'Assigned.', body: `${firstName(who.name)} has been notified.` });
    } catch (e) { notifyFailure(e); }
    setBusy(false);
    reload();
  }

  async function doReschedule() {
    if (!reschedule) return;
    const { task, start, end } = reschedule;
    setBusy(true);
    patch(task.id, { scheduledFor: start, dueAt: end });
    setReschedule(null);
    try {
      await api.patch(`/housekeeping/tasks/${task.id}`, { scheduledFor: start, dueAt: end });
      toast({ tone: 'success', title: 'Task rescheduled.', body: `${unitRef(task.propertyName, task.unitNumber)} · ${start} to ${end}.` });
    } catch (e) { notifyFailure(e); }
    setBusy(false);
    reload();
  }

  async function doStart() {
    const task = confirm?.task;
    if (!task) return;
    setBusy(true);
    patch(task.id, { state: 'in_progress' });
    setConfirm(null);
    try {
      await api.post(`/housekeeping/tasks/${task.id}/start`, {});
      toast({ tone: 'info', title: 'Task started.', body: `${unitRef(task.propertyName, task.unitNumber)} is now in progress.` });
    } catch (e) { notifyFailure(e); }
    setBusy(false);
    reload();
  }

  // One hidden file input drives photo upload for whichever row asked for it.
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<Row | null>(null);
  function addPhoto(task: Row) { uploadFor.current = task; fileRef.current?.click(); }
  async function onPhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const task = uploadFor.current;
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!task || !files.length) return;
    patch(task.id, { photoCount: task.photoCount + files.length });
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      try { await api.post(`/tasks/${task.id}/photos`, fd); } catch (err) { notifyFailure(err); }
    }
    toast({ tone: 'success', title: files.length === 1 ? 'Photo added.' : `${files.length} photos added.`, body: `On ${unitRef(task.propertyName, task.unitNumber)}.` });
    reload();
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
    setConfirm(null);
    try {
      await api.post(`/tasks/${task.id}/complete`, { photoIds: [] });
      toast({ tone: 'success', title: 'Task complete.', body: `${unitRef(task.propertyName, task.unitNumber)} · marked done.` });
    } catch (e) { notifyFailure(e); }
    setBusy(false);
    reload();
  }

  /** The one or two buttons a row needs right now; the rest wait in the task's state. */
  function rowActions(t: Row) {
    const done = t.state === 'resolved';
    const noPhoto = t.requiresPhoto && t.photoCount < 1;
    const sz = 'sm';
    // Imported history carries a made-up finish time (the due time), so only a clean started in the app shows one.
    if (done) return <span className="text-meta text-muted-ink">{t.completedAt && t.startedAt ? `Done ${dateTimeShort(t.completedAt)}` : 'Done'}</span>;
    return (
      <div className="flex gap-1.5 flex-wrap items-center">
        {t.state === 'in_progress' ? (
          noPhoto
            ? <Button size={sz} variant="primary" icon={<Icon name="Camera" size="sm" />} onClick={() => addPhoto(t)}>Add photo</Button>
            : <Button size={sz} variant="primary" icon={<Icon name="Check" size="sm" />} onClick={() => setConfirm({ kind: 'complete', task: t })}>Complete</Button>
        ) : t.state === 'assigned' || (t.state === 'overdue' && t.assigneeId) ? (
          <Button size={sz} variant="primary" icon={<Icon name="Play" size="sm" />} onClick={() => setConfirm({ kind: 'start', task: t })}>Start</Button>
        ) : (
          <Button size={sz} variant={t.assigneeId ? 'secondary' : 'primary'} icon={<Icon name="UserPlus" size="sm" />} onClick={() => openAssign(t)}>Assign</Button>
        )}
        <button type="button" title="Reschedule" aria-label={`Reschedule ${unitRef(t.propertyName, t.unitNumber)}`}
          onClick={() => setReschedule({ task: t, start: t.scheduledFor ?? '08:00', end: t.dueAt ?? '12:00' })}
          className="w-9 h-9 grid place-items-center rounded-control text-muted-ink bg-transparent border border-solid border-line cursor-pointer hover:bg-muted">
          <Icon name="CalendarClock" size="sm" />
        </button>
        {(t.assigneeId || t.state === 'in_progress') && (
          <button type="button" title="Reassign" aria-label={`Reassign ${unitRef(t.propertyName, t.unitNumber)}`} onClick={() => openAssign(t)}
            className="w-9 h-9 grid place-items-center rounded-control text-muted-ink bg-transparent border border-solid border-line cursor-pointer hover:bg-muted">
            <Icon name="UserPlus" size="sm" />
          </button>
        )}
      </div>
    );
  }

  const dateCls = 'h-9 box-border py-0 px-2 font-sans text-copy text-ink bg-card border border-solid border-line rounded-control outline-none';

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPhotoPicked} />
      <PageHeader
        title="Tasks"
        sub={`${count(countOf('active'))} not done · ${count(counts.resolved ?? 0)} done${filtersActive ? ' (filtered)' : ''}`}
      />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card style={{ overflow: 'visible' }}>
        <div className="flex gap-2 flex-wrap items-center py-3 px-4 md:px-5 [border-bottom:1px_solid_var(--color-line-soft)] bg-page">
          <div className="relative flex-[1_1_200px] min-w-[200px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-ink flex"><Icon name="Search" size="sm" /></span>
            <input value={qDraft} onChange={e => setQDraft(e.target.value)} placeholder="Unit, building or work" aria-label="Search tasks"
              className="h-9 w-full box-border pl-8 pr-2.5 py-0 font-sans text-copy text-ink bg-card border border-solid border-line rounded-control outline-none" />
          </div>
          {/* Phones show search plus a toggle; the other filters fold away. */}
          <button type="button" onClick={() => setMoreFilters(v => !v)} aria-expanded={moreFilters}
            className="md:hidden h-9 box-border inline-flex items-center gap-1.5 px-3 py-0 rounded-control border border-solid border-line bg-card text-ink font-sans text-copy cursor-pointer">
            <Icon name="SlidersHorizontal" size="sm" /> Filters{extraCount ? ` · ${extraCount}` : ''}
          </button>
          <div className={cx(moreFilters ? 'flex' : 'hidden', 'md:contents w-full flex-col gap-2')}>
          <Select label="Kind" value={kindFilter} onChange={v => setParam({ kind: v === 'all' ? null : v })} className="md:w-[150px]"
            options={KIND_FILTERS.map(([k, l]) => ({ value: k, label: l }))} />
          <Select label="Building" value={building} onChange={v => setParam({ building: v || null })} className="md:w-[180px]"
            placeholder="All buildings" options={(facets?.buildings ?? []).map(b => ({ value: b.id, label: b.name }))} />
          <Select label="Assignee" value={assignee} onChange={v => setParam({ assignee: v || null })} className="md:w-[180px]"
            placeholder="Anyone" options={[{ value: 'none', label: 'Unassigned' }, ...(facets?.assignees ?? []).map(a => ({ value: a.key, label: `${a.name} · ${count(a.count)}` }))]} />
          <span className="flex items-center gap-1.5">
            <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={e => setParam({ from: e.target.value || null })} className={dateCls} />
            <span className="text-meta text-muted-ink">to</span>
            <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={e => setParam({ to: e.target.value || null })} className={dateCls} />
          </span>
          </div>
          {filtersActive && (
            <Button size="sm" variant="tertiary" icon={<Icon name="FilterX" size="sm" />} onClick={clearFilters}>Clear filters</Button>
          )}
        </div>

        {/* State pills with their counts, after search and the dropdowns. */}
        <div className="flex gap-2 flex-nowrap md:flex-wrap overflow-x-auto py-3 px-4 md:px-5 [border-bottom:1px_solid_var(--color-line)] [scrollbar-width:none]">
          {STATE_FILTERS.map(([k, label]) => (
            <Chip key={k} on={k === stateFilter} onClick={() => setParam({ state: k === 'active' ? null : k })} count={countOf(k)}>{label}</Chip>
          ))}
        </div>

        {/* Thin bar while a new page loads; the previous rows stay put underneath. */}
        <div className="h-0.5 relative overflow-hidden" aria-hidden>
          {loading && data && <div className="absolute inset-0 bg-gold [animation:pulse-soft_1s_ease-in-out_infinite]" />}
        </div>

        {loading && !data ? (
          <TableSkeleton rows={8} cols={6} />
        ) : rows.length === 0 ? (
          doneElsewhere ? (
            <EmptyState bare icon="CheckCircle" title="Nothing left to do here." body="Every task under these filters is done."
              action={{ label: `Show ${count(counts.resolved ?? 0)} done`, onClick: () => setParam({ state: 'resolved' }) }}
              secondary={filtersActive ? { label: 'Clear filters', onClick: clearFilters } : undefined} />
          ) : filtersActive ? (
            <EmptyState bare kind="filtered" title="No tasks match these filters." action={{ label: 'Clear filters', onClick: clearFilters }} />
          ) : (
            <EmptyState bare title="No tasks yet." body="Check-outs and the Housekeeping planner create them." />
          )
        ) : (
          <div className={cx('transition-opacity duration-150', loading && 'opacity-60')}>
            {/* Wide screens: a table with a header that stays on top while scrolling. */}
            <div className="hidden xl:block">
              <div role="row" className={cx('grid', COLS, 'gap-3 py-[9px] px-5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-meta font-semibold text-muted-ink sticky top-[-24px] z-10')}>
                <div>Date</div><div>Unit</div><div>Work</div><div>Assignee</div><div>Status</div><div>Due</div><div className="text-right">Photos</div><div>Next step</div>
              </div>
              {rows.map(t => {
                const done = t.state === 'resolved';
                const ev = evidenceOf(t);
                const lineTone: Tone = done ? 'success' : t.sla.tone;
                const who = whoOf(t);
                return (
                  <div key={t.id} className={cx('grid', COLS, 'box-border gap-3 items-center min-h-[52px] py-2 px-5 [border-bottom:1px_solid_var(--color-line-soft)] border-l-[3px] border-solid border-y-0 border-r-0', LINE[lineTone])}>
                    <div className="text-copy tabular-nums whitespace-nowrap">{dayLabel(t.date)}</div>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-copy font-medium truncate" title={t.unitNumber}>{t.unitNumber}</span>
                      <span className="text-meta text-muted-ink truncate" title={t.propertyName}>{t.propertyName}</span>
                    </div>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-copy truncate" title={t.title}>{t.title}</span>
                      <span className="text-meta text-muted-ink truncate" title={noteOf(t) || undefined}>{KIND_LABEL[t.kind]}{noteOf(t) ? ` · ${noteOf(t)}` : ''}</span>
                    </div>
                    <div className={cx('text-copy truncate', who ? 'text-ink' : 'text-muted-ink')} title={who ?? 'Unassigned'}>{who ?? 'Unassigned'}</div>
                    <div><Badge tone={TASK[t.state].tone} label={done ? 'Done' : TASK[t.state].label} size="sm" /></div>
                    <div className="flex flex-col gap-px min-w-0">
                      {done ? null : <span className={cx('text-meta font-medium truncate', TONE_FG[t.sla.tone])} title={t.sla.label}>{t.sla.label}</span>}
                      {!done && (t.dueAt || t.nextGuestAt) && <span className="text-meta text-muted-ink tabular-nums truncate">{t.dueAt ? `by ${t.dueAt}` : ''}{t.nextGuestAt ? `${t.dueAt ? ' · ' : ''}guest ${t.nextGuestAt}` : ''}</span>}
                    </div>
                    <div className={cx('text-right text-copy tabular-nums', ev.warn ? TONE_FG.warning : 'text-muted-ink')} title={ev.label}>
                      {t.photoCount || t.requiresPhoto ? `${t.photoCount}${t.requiresPhoto ? ' / 1' : ''}` : '—'}
                    </div>
                    <div>{rowActions(t)}</div>
                  </div>
                );
              })}
            </div>

            {/* Narrow screens: one compact card per task. */}
            <div className="xl:hidden">
              {rows.map(t => {
                const done = t.state === 'resolved';
                const lineTone: Tone = done ? 'success' : t.sla.tone;
                const who = whoOf(t);
                return (
                  <div key={t.id} className={cx('box-border py-3 px-4 flex flex-col gap-2 [border-bottom:1px_solid_var(--color-line-soft)] border-l-[3px] border-solid border-y-0 border-r-0', LINE[lineTone])}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-px min-w-0">
                        <span className="text-copy font-semibold truncate">{unitRef(t.propertyName, t.unitNumber)}</span>
                        <span className="text-meta text-muted-ink truncate">{dayLabel(t.date)} · {t.title}</span>
                      </div>
                      <Badge tone={TASK[t.state].tone} label={done ? 'Done' : TASK[t.state].label} size="sm" />
                    </div>
                    <div className="flex gap-x-4 gap-y-1 flex-wrap text-meta">
                      <span className={who ? 'text-ink' : 'text-muted-ink'}>{who ?? 'Unassigned'}</span>
                      {!done && <span className={TONE_FG[t.sla.tone]}>{t.sla.label}</span>}
                      {t.nextGuestAt && <span className="text-muted-ink">Guest {t.nextGuestAt}</span>}
                      {(t.requiresPhoto || t.photoCount > 0) && <span className="text-muted-ink">{plural(t.photoCount, 'photo')}</span>}
                    </div>
                    {!done && <div>{rowActions(t)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={goPage} unit="tasks" />
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
            <Select label="Cleaner" showLabel size="md" value={assign.assigneeId} disabled={busy}
              onChange={v => setAssign(a => a && { ...a, assigneeId: v, force: false, warning: undefined })}
              options={CREW.map(c => ({ value: c.id, label: c.name }))} />
          </div>
          {assign.task.nextGuestAt && (
            <div className="text-meta text-muted-ink">Next guest arrives {assign.task.nextGuestAt}.</div>
          )}
          {assign.warning && (
            <div className={`py-2.5 px-3 rounded-control ${TONE.critical.bg} text-[var(--color-critical-fg)] text-meta flex gap-2 items-start`}>
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
            <div className="text-meta text-muted-ink">
              Next guest arrives {reschedule.task.nextGuestAt ?? 'not scheduled'}.
            </div>
            {endsAfter && (
              <div className={`py-2.5 px-3 rounded-control ${TONE.warning.bg} text-[var(--color-warning-fg)] text-meta flex gap-2 items-start`}>
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
            body: `${plural(confirm.task.photoCount, 'photo')} attached. The task is marked resolved.`,
            meta: confirm.task.nextGuestAt ? `Next check-in is ${confirm.task.nextGuestAt}.` : undefined,
            confirmLabel: 'Mark complete', busyLabel: 'Completing…', onConfirm: doComplete,
          }}
      />
    </>
  );
}
