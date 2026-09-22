import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { useCleaners, type Cleaner, type Employment } from '../lib/useCleaners';
import { api, notifyFailure } from '../lib/api';
import { todayMyt, rm, unitRef, dateTime } from '../lib/format';
import { READINESS, TASK } from '../lib/vocabulary';
import { TONE } from '../lib/design-tokens';
import type { TaskState, Tone, UnitReadiness } from '../lib/types';

/* ------------------------------------------------------------------ *
 * Operations -> Housekeeping (BUTTONS.md section 7).
 * Every checkout creates a cleaning task; the window is computed from the
 * next arrival. This screen is the full interactive roster: assign, auto-
 * assign by rule, reschedule, start, add photo, complete, report damage.
 * There is no backend in dev, so mutations update a local overlay and
 * attempt the real call in a swallowed try/catch (see IMPL-BRIEF).
 * ------------------------------------------------------------------ */

type OrderingRule = 'earliest_checkin' | 'building' | 'manual';
const RULE_LABEL: Record<OrderingRule, string> = {
  earliest_checkin: 'Earliest next check-in',
  building: 'By building',
  manual: 'Manual',
};

// Auto-assign rules: how the roster is spread, and which employment dimension wins.
type AssignStrategy = 'least_loaded' | 'round_robin';
type AssignPrefer = 'any' | 'internal' | 'outsourced';
const STRATEGY_LABEL: Record<AssignStrategy, string> = { least_loaded: 'Least loaded', round_robin: 'Round robin' };
const PREFER_LABEL: Record<AssignPrefer, string> = { any: 'Any cleaner', internal: 'Internal staff first', outsourced: 'Outsourced first' };
const EMPLOYMENT_LABEL: Record<Employment, string> = { internal: 'Internal staff', outsourced: 'Outsourced' };
const SEQ_PHRASE: Record<OrderingRule, string> = { earliest_checkin: 'by earliest check-in', building: 'by building', manual: 'in manual order' };
interface RulesDraft { rule: OrderingRule; strategy: AssignStrategy; prefer: AssignPrefer }

// The three cleaning kinds a manual task may be. Inspection/maintenance are
// their own screens, so this list never grows past cleaning.
type CleanKind = 'turnover' | 'deep_clean' | 'light_clean';
const KIND_LABEL: Record<CleanKind, string> = {
  turnover: 'Turnover clean', deep_clean: 'Deep clean', light_clean: 'Light clean',
};
const CLEAN_KINDS: CleanKind[] = ['turnover', 'deep_clean', 'light_clean'];

const firstName = (name: string) => name.split(' ')[0];

interface Task {
  id: string;
  unitNumber: string;
  propertyName: string;        // the building
  buildingId?: string | null;  // property id — groups a whole-building clean
  sourceRef: string;           // source reservation
  title: string;               // kind of clean, human title
  linenSet: string;
  instructions: string | null;
  scheduledFor: string | null; // HH:MM (window start)
  dueAt: string | null;        // HH:MM (window end)
  nextGuestAt: string | null;  // HH:MM — incoming guest check-in
  checkoutTime: string | null; // HH:MM — this stay's checkout
  checkoutDate: string | null; // YYYY-MM-DD — this stay's checkout day
  startedAt: string | null;    // ISO — when the cleaner started
  completedAt: string | null;  // ISO — when the clean finished (the "end")
  assigneeId: string | null;
  cleanerId: string | null;          // roster entry the clean is given to
  employmentType: Employment | null; // internal vs outsourced, from the roster
  assigneeName: string | null;
  sequence: number;
  state: TaskState;
  readiness: UnitReadiness;
  requiresPhoto: boolean;
  photoCount: number;
  kind?: CleanKind;            // carried on manual tasks for the edit form
}
interface Payload { rows: Task[]; date: string; generatedAt: string }

/** Dev-only sample timestamps, anchored to load time so duration/elapsed read live. */
const isoAgo = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();
const CO_DATE = todayMyt();

const FALLBACK: Payload = {
  date: '2026-09-16', generatedAt: '',
  rows: [
    { id: 'h1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', buildingId: 'p-vista', sourceRef: 'RES-40821', title: 'Turnover, 2BR', linenSet: 'Set A', instructions: 'Late check-out to 13:00. Restock coffee pods.', scheduledFor: '08:00', dueAt: '14:00', nextGuestAt: '15:00', checkoutTime: '13:00', checkoutDate: CO_DATE, startedAt: isoAgo(38), completedAt: null, assigneeId: 'u5', cleanerId: 'cl-u5', employmentType: 'internal', assigneeName: 'Nurul Huda', sequence: 1, state: 'in_progress', readiness: 'cleaning', requiresPhoto: true, photoCount: 0 },
    { id: 'h2', unitNumber: '#A-19-02', propertyName: 'Vista Jaya One', buildingId: 'p-vista', sourceRef: 'RES-40833', title: 'Turnover, studio', linenSet: 'Set B', instructions: 'Early check-in requested by next guest.', scheduledFor: '12:00', dueAt: '15:30', nextGuestAt: '16:00', checkoutTime: '11:00', checkoutDate: CO_DATE, startedAt: null, completedAt: null, assigneeId: 'u5', cleanerId: 'cl-u5', employmentType: 'internal', assigneeName: 'Nurul Huda', sequence: 2, state: 'assigned', readiness: 'dirty', requiresPhoto: true, photoCount: 0 },
    { id: 'h3', unitNumber: '#15-06', propertyName: 'Scarletz', buildingId: 'p-scar', sourceRef: 'RES-40790', title: 'Deep clean', linenSet: 'Set A', instructions: 'Vacant 4 nights. Descale kettle and shower.', scheduledFor: '10:00', dueAt: '16:30', nextGuestAt: '18:00', checkoutTime: '11:00', checkoutDate: CO_DATE, startedAt: null, completedAt: null, assigneeId: 'u6', cleanerId: 'cl-u6', employmentType: 'internal', assigneeName: 'Faridah Ismail', sequence: 3, state: 'assigned', readiness: 'dirty', requiresPhoto: true, photoCount: 1 },
    { id: 'h4', unitNumber: '#2207', propertyName: 'Tribeca', buildingId: 'p-trib', sourceRef: 'RES-40765', title: 'Light clean', linenSet: 'Set B', instructions: 'Owner stay ended. Standard refresh.', scheduledFor: '08:00', dueAt: '11:00', nextGuestAt: null, checkoutTime: '10:00', checkoutDate: CO_DATE, startedAt: isoAgo(205), completedAt: isoAgo(118), assigneeId: null, cleanerId: 'cl-out1', employmentType: 'outsourced', assigneeName: 'Siti Rahmah', sequence: 4, state: 'resolved', readiness: 'ready', requiresPhoto: true, photoCount: 2 },
    { id: 'h5', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', buildingId: 'p-sent', sourceRef: 'RES-40711', title: 'Post-works clean', linenSet: 'Set A', instructions: 'Plumbing repair completed. Clear dust sheets.', scheduledFor: '16:00', dueAt: '18:00', nextGuestAt: null, checkoutTime: null, checkoutDate: null, startedAt: null, completedAt: null, assigneeId: null, cleanerId: 'cl-out1', employmentType: 'outsourced', assigneeName: 'Siti Rahmah', sequence: 5, state: 'assigned', readiness: 'maintenance', requiresPhoto: true, photoCount: 0 },
    { id: 'h6', unitNumber: '#A-21-02', propertyName: 'Vista Jaya One', buildingId: 'p-vista', sourceRef: 'RES-40852', title: 'Turnover, 2BR', linenSet: 'Set A', instructions: 'No cleaner assigned yet.', scheduledFor: '14:00', dueAt: '14:54', nextGuestAt: '15:00', checkoutTime: '12:00', checkoutDate: CO_DATE, startedAt: null, completedAt: null, assigneeId: null, cleanerId: null, employmentType: null, assigneeName: null, sequence: 6, state: 'open', readiness: 'dirty', requiresPhoto: true, photoCount: 0 },
  ],
};

/* ---- time + SLA helpers (dev clock; the live backend owns real SLA) ---- */
const toMin = (hhmm: string | null): number | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fmtDur = (mins: number): string => {
  const a = Math.abs(mins), h = Math.floor(a / 60), m = a % 60;
  return h ? (m ? `${h} h ${m} m` : `${h} h`) : `${m} m`;
};
/** Minutes between two ISO instants, or from a start to `now` while still running. */
const elapsedMin = (startIso: string | null, endIso: string | null, now: Date): number | null => {
  if (!startIso) return null;
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return null;
  const end = endIso ? Date.parse(endIso) : now.getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 60000));
};
/** Anchor the roster times to the real current date so the pill is genuinely
 *  live in dev — it counts down to next_guest_at and flips critical on breach. */
const minsUntil = (hhmm: string | null, now: Date): number | null => {
  const m = toMin(hhmm);
  if (m === null) return null;
  return m - (now.getHours() * 60 + now.getMinutes());
};
function slaOf(t: Task, now: Date): { label: string; tone: Tone } {
  if (t.state === 'resolved') return { label: 'Complete', tone: 'success' };
  const mins = minsUntil(t.nextGuestAt, now);
  if (mins === null) return { label: 'No deadline', tone: 'neutral' };
  if (mins <= 0) return { label: `Overdue ${fmtDur(mins)}`, tone: 'critical' };
  if (mins <= 90) return { label: `Due in ${fmtDur(mins)}`, tone: 'warning' };
  return { label: 'On track', tone: 'success' };
}
/** Two HH:MM windows overlap? Used to surface the 409 double-booking. */
function windowsOverlap(aS: string | null, aE: string | null, bS: string | null, bE: string | null): boolean {
  const as = toMin(aS), ae = toMin(aE), bs = toMin(bS), be = toMin(bE);
  if (as === null || ae === null || bs === null || be === null) return false;
  return as < be && bs < ae;
}

/** Left accent border per SLA tone. Static strings so Tailwind can scan them;
 *  uses the tone -line shade, per the design-tokens convention. */
const ACCENT: Record<Tone, string> = {
  success:  '[border-left:3px_solid_var(--color-success-line)]',
  warning:  '[border-left:3px_solid_var(--color-warning-line)]',
  critical: '[border-left:3px_solid_var(--color-critical-line)]',
  info:     '[border-left:3px_solid_var(--color-info-line)]',
  neutral:  '[border-left:3px_solid_var(--color-neutral-line)]',
};

/* ------------------------------ local modal ------------------------------ */
/* font:inherit is the last shorthand key on the source input style, so the real
 * render is the inherited 16px/400 — no text-size/weight class is added here. */
const inputCls = 'block w-full box-border h-10 px-3 py-0 text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit]';
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
        className="relative w-full max-w-[460px] max-h-[88vh] overflow-y-auto bg-card rounded-card shadow-[var(--shadow-overlay)] animate-dialog">
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
        <div className="py-[14px] px-[22px] mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap sticky bottom-0">{footer}</div>
      </div>
    </div>
  );
}

/* ------------------------------- the page -------------------------------- */
type Tab = 'today' | 'tomorrow' | 'week';
const TABS: [Tab, string][] = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week']];
const TAB_DATE: Record<Tab, string> = { today: todayMyt(), tomorrow: todayMyt(1), week: `${todayMyt()}..${todayMyt(6)}` };

export default function HousekeepingPage() {
  const { cleaners: CREW } = useCleaners();
  const [tab, setTab] = useState<Tab>('today');
  const { data, loading, error, reload } = useApi<Payload>(`/housekeeping/tasks?date=${TAB_DATE[tab]}`, FALLBACK);
  const toast = useToast();
  const navigate = useNavigate();

  // Optimistic overlay: manually created tasks live in `added`; per-task patches
  // (assign, reschedule, edit, state) land in `edits` keyed by id.
  const [added, setAdded] = useState<Task[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Task>>>({});
  const patch = (id: string, p: Partial<Task>) => setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));

  const [rule, setRule] = useState<OrderingRule>('earliest_checkin');
  const [strategy, setStrategy] = useState<AssignStrategy>('least_loaded');
  const [prefer, setPrefer] = useState<AssignPrefer>('any');

  // Live clock for the SLA countdown.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  // Dialog / modal state.
  const [assign, setAssign] = useState<{ task: Task; cleanerId: string; force: boolean; warning?: string } | null>(null);
  const [reschedule, setReschedule] = useState<{ task: Task; start: string; end: string } | null>(null);
  const [damage, setDamage] = useState<{ task: Task; title: string; detail: string; chargeTo: 'owner' | 'company'; amount: string; blocksUnit: boolean } | null>(null);
  const [editRule, setEditRule] = useState<RulesDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'start' | 'complete' | 'autoassign'; task?: Task }>(null);
  const [gallery, setGallery] = useState<Task | null>(null);
  const [groupByBuilding, setGroupByBuilding] = useState(false);
  const [busy, setBusy] = useState(false);

  // Real POD photo upload: one hidden file input, driven per task. The chosen files
  // are sent as multipart to the existing POST /api/tasks/:id/photos (R2, binding
  // MEDIA); the count updates optimistically so the completion gate can be exercised.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTaskRef = useRef<Task | null>(null);
  function pickPhoto(task: Task) { uploadTaskRef.current = task; fileInputRef.current?.click(); }
  async function onPhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const task = uploadTaskRef.current;
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same file
    if (!task || !files.length) return;
    patch(task.id, { photoCount: task.photoCount + files.length });
    toast({ tone: 'success', title: files.length === 1 ? 'Photo added.' : `${files.length} photos added.`, body: `Attached to ${unitRef(task.propertyName, task.unitNumber)}.` });
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      try { await api.post(`/tasks/${task.id}/photos`, fd); } catch (err) { notifyFailure(err); }
    }
  }

  const merged = [...added, ...(data?.rows ?? [])].map(t => ({ ...t, ...edits[t.id] }));
  const unassigned = merged.filter(t => !t.cleanerId && !t.assigneeId);

  // Ordering rule drives the displayed order; the sequence number shown is the
  // position in that order, so changing the rule visibly re-sequences the list.
  const ordered = [...merged].sort((a, b) => {
    if (rule === 'building') return (a.propertyName + a.unitNumber).localeCompare(b.propertyName + b.unitNumber);
    if (rule === 'manual') return a.sequence - b.sequence;
    const an = toMin(a.nextGuestAt), bn = toMin(b.nextGuestAt);
    if (an === null && bn === null) return a.sequence - b.sequence;
    if (an === null) return 1;
    if (bn === null) return -1;
    return an - bn;
  });

  /* -------------------------------- actions ------------------------------- */
  function openAssign(task: Task) {
    setAssign({ task, cleanerId: task.cleanerId ?? CREW[0]?.id ?? '', force: false });
  }

  async function doCreate(draft: CreateDraft) {
    const cleaner = CREW.find(c => c.id === draft.assigneeId);
    const optimistic: Task = {
      id: `local-${crypto.randomUUID()}`,
      unitNumber: draft.unitNumber.trim(), propertyName: draft.propertyName.trim(),
      sourceRef: 'Manual', title: KIND_LABEL[draft.kind], linenSet: draft.linenSet,
      buildingId: null,
      instructions: draft.instructions.trim() || null,
      scheduledFor: draft.scheduledFor || null, dueAt: draft.dueAt || null,
      nextGuestAt: draft.nextGuestAt || null,
      checkoutTime: null, checkoutDate: null, startedAt: null, completedAt: null,
      assigneeId: cleaner?.userId ?? null, cleanerId: cleaner?.id ?? null, employmentType: cleaner?.employmentType ?? null,
      assigneeName: cleaner?.name ?? null,
      sequence: 999, state: cleaner ? 'assigned' : 'open', readiness: 'dirty',
      requiresPhoto: draft.requiresPhoto, photoCount: 0, kind: draft.kind,
    };
    setBusy(true);
    setAdded(a => [optimistic, ...a]);
    setCreating(false);
    toast({ tone: 'success', title: 'Cleaning task created.', body: `${KIND_LABEL[draft.kind]} on ${unitRef(optimistic.propertyName, optimistic.unitNumber)}${cleaner ? ` · ${firstName(cleaner.name)} notified` : ' · unassigned'}.` });
    try {
      await api.post('/housekeeping/tasks', {
        unitNumber: optimistic.unitNumber, propertyName: optimistic.propertyName, kind: draft.kind,
        title: KIND_LABEL[draft.kind], instructions: optimistic.instructions,
        scheduledFor: draft.scheduledFor || null, dueAt: draft.dueAt || null, nextGuestAt: draft.nextGuestAt || null,
        cleanerId: cleaner?.id ?? null, requiresPhoto: draft.requiresPhoto,
      });
    } catch (e) { notifyFailure(e); }
    setBusy(false);
  }

  async function doEditDetails(task: Task, next: { kind: CleanKind; instructions: string }) {
    setBusy(true);
    patch(task.id, { kind: next.kind, title: KIND_LABEL[next.kind], instructions: next.instructions.trim() || null });
    toast({ tone: 'success', title: 'Cleaning task updated.', body: `${unitRef(task.propertyName, task.unitNumber)} · ${KIND_LABEL[next.kind]}.` });
    setEditTask(null);
    try { await api.patch(`/housekeeping/tasks/${task.id}`, { kind: next.kind, title: KIND_LABEL[next.kind], instructions: next.instructions.trim() }); }
    catch (e) { notifyFailure(e); }
    setBusy(false);
  }

  async function doAssign() {
    if (!assign) return;
    const { task, cleanerId, force } = assign;
    const cleaner = CREW.find(c => c.id === cleanerId);
    if (!cleaner) return;

    // Simulate the 409 ASSIGNEE_BUSY overlap check the backend would run.
    if (!force) {
      const clash = merged.filter(t =>
        t.id !== task.id && t.cleanerId === cleanerId &&
        windowsOverlap(task.scheduledFor, task.dueAt, t.scheduledFor, t.dueAt));
      if (clash.length) {
        const at = clash[0].scheduledFor ?? clash[0].dueAt ?? '';
        setAssign(a => a && {
          ...a, force: true,
          warning: `${firstName(cleaner.name)} has ${clash.length} overlapping task${clash.length > 1 ? 's' : ''} at ${at}. Assign anyway?`,
        });
        return;
      }
    }

    setBusy(true);
    patch(task.id, { cleanerId: cleaner.id, assigneeId: cleaner.userId, employmentType: cleaner.employmentType, assigneeName: cleaner.name, state: task.state === 'open' ? 'assigned' : task.state });
    toast({ tone: 'success', title: 'Cleaner assigned.', body: `${firstName(cleaner.name)}${cleaner.employmentType === 'outsourced' && cleaner.vendorName ? ` (${cleaner.vendorName})` : ''} has been notified.` });
    setAssign(null);
    try { await api.post(`/housekeeping/tasks/${task.id}/assign`, { cleanerId: cleaner.id, force }); }
    catch (e) { notifyFailure(e); }
    setBusy(false);
  }

  async function doAutoAssign() {
    const targets = unassigned;
    // The employment preference narrows the pool the same way the backend does.
    const pool = CREW.filter(c => prefer === 'any' || c.employmentType === prefer);
    if (!pool.length) { toast({ tone: 'critical', title: 'No cleaners to assign to.', body: `No active ${prefer === 'any' ? '' : PREFER_LABEL[prefer].toLowerCase() + ' '}cleaners on the roster. Add one under Cleaners.` }); setConfirm(null); return; }
    // Apply the ordering rule, then spread by the chosen strategy.
    const byRule = [...targets].sort((a, b) => (toMin(a.nextGuestAt) ?? 1e9) - (toMin(b.nextGuestAt) ?? 1e9));
    const load = new Map(pool.map(c => [c.id, c.busy]));
    setBusy(true);
    byRule.forEach((t, i) => {
      const c = strategy === 'round_robin'
        ? pool[i % pool.length]
        : pool.reduce((a, x) => (load.get(x.id)! <= load.get(a.id)! ? x : a));
      load.set(c.id, (load.get(c.id) ?? 0) + 1);
      patch(t.id, { cleanerId: c.id, assigneeId: c.userId, employmentType: c.employmentType, assigneeName: c.name, state: 'assigned', sequence: t.sequence });
    });
    toast({ tone: 'success', title: `${targets.length} task${targets.length === 1 ? '' : 's'} auto-assigned.`, body: `Ordered by ${RULE_LABEL[rule].toLowerCase()}, ${STRATEGY_LABEL[strategy].toLowerCase()}, ${PREFER_LABEL[prefer].toLowerCase()}.` });
    setConfirm(null);
    try { await api.post('/housekeeping/auto-assign', { rule, strategy, prefer }); } catch { /* dev */ }
    setBusy(false);
  }

  async function doSaveRules() {
    if (!editRule) return;
    const next = editRule;
    setBusy(true);
    setRule(next.rule); setStrategy(next.strategy); setPrefer(next.prefer);
    toast({ tone: 'success', title: 'Auto-assign rules saved.', body: `${RULE_LABEL[next.rule]} · ${STRATEGY_LABEL[next.strategy]} · ${PREFER_LABEL[next.prefer]}.` });
    setEditRule(null);
    try { await api.put('/housekeeping/rules', { rule: next.rule, strategy: next.strategy, prefer: next.prefer }); } catch { /* dev */ }
    setBusy(false);
  }

  async function doReschedule() {
    if (!reschedule) return;
    const { task, start, end } = reschedule;
    setBusy(true);
    patch(task.id, { scheduledFor: start, dueAt: end });
    toast({ tone: 'success', title: 'Cleaning rescheduled.', body: `${unitRef(task.propertyName, task.unitNumber)} · ${start} to ${end}.` });
    setReschedule(null);
    try { await api.patch(`/housekeeping/tasks/${task.id}`, { scheduledFor: start, dueAt: end }); } catch { /* dev */ }
    setBusy(false);
  }

  async function doStart() {
    const task = confirm?.task;
    if (!task) return;
    setBusy(true);
    patch(task.id, { state: 'in_progress', readiness: 'cleaning' });
    toast({ tone: 'info', title: 'Cleaning started.', body: `${unitRef(task.propertyName, task.unitNumber)} is now cleaning.` });
    setConfirm(null);
    try { await api.post(`/housekeeping/tasks/${task.id}/start`, {}); } catch { /* dev */ }
    setBusy(false);
  }

  async function doComplete() {
    const task = confirm?.task;
    if (!task) return;
    // Guard mirrors the 422 PHOTO_REQUIRED contract.
    if (task.requiresPhoto && task.photoCount < 1) {
      toast({ tone: 'critical', title: 'Cannot mark complete.', body: 'Add at least one photo before marking this unit ready.' });
      setConfirm(null);
      return;
    }
    setBusy(true);
    patch(task.id, { state: 'resolved', readiness: 'ready' });
    toast({ tone: 'success', title: 'Cleaning complete.', body: `${unitRef(task.propertyName, task.unitNumber)} is ready for the guest.` });
    setConfirm(null);
    try { await api.post(`/tasks/${task.id}/complete`, { photoIds: [] }); } catch { /* dev */ }
    setBusy(false);
  }

  async function doDamage() {
    if (!damage) return;
    const { task, title, chargeTo, amount, blocksUnit } = damage;
    const sen = Math.round((parseFloat(amount) || 0) * 100);
    setBusy(true);
    if (blocksUnit) patch(task.id, { readiness: 'maintenance' });
    toast({
      tone: 'warning', title: 'Damage reported.',
      body: `Maintenance issue raised on ${unitRef(task.propertyName, task.unitNumber)}${sen ? ` · ${rm(sen)} to ${chargeTo}` : ''}.`,
    });
    setDamage(null);
    try {
      await api.post('/maintenance/issues', {
        unitId: task.id, title, detail: damage.detail, blocksUnit, quotedAmount: sen, chargeTo, photoIds: [],
      });
    } catch { /* dev */ }
    setBusy(false);
  }

  const rows = data?.rows ?? [];

  // Group the ordered list by building (property), preserving the ordering-rule
  // sequence so a whole-building clean can be worked and photographed together.
  const groups: { id: string; name: string; tasks: Task[] }[] = [];
  for (const t of ordered) {
    const key = t.buildingId ?? t.propertyName;
    let g = groups.find(x => x.id === key);
    if (!g) { g = { id: key, name: t.propertyName, tasks: [] }; groups.push(g); }
    g.tasks.push(t);
  }

  /** One cleaning task card. `idx` is its position in the current sequence. */
  const renderRow = (t: Task, idx: number) => {
    const sla = slaOf(t, now);
    const canStart = t.state === 'assigned';
    const inProgress = t.state === 'in_progress';
    const done = t.state === 'resolved';
    const noPhoto = t.requiresPhoto && t.photoCount < 1;
    const hasCleaner = !!(t.cleanerId || t.assigneeId);
    const windowLabel = t.scheduledFor && t.dueAt ? `${t.scheduledFor} → ${t.dueAt}` : '—';
    const mins = elapsedMin(t.startedAt, t.completedAt, now);
    const durLabel = mins === null ? null : done ? `Cleaned in ${fmtDur(mins)}` : `Running ${fmtDur(mins)}`;

    return (
      <div key={t.id}
        className={`flex gap-[18px] py-[15px] px-5 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)] ${ACCENT[sla.tone]} ${done ? 'opacity-[0.72]' : ''}`}>
        {/* left: identity + fields */}
        <div className="flex-1 min-w-[260px] flex flex-col gap-[9px]">
          <div className="flex items-center gap-[9px] flex-wrap">
            <span
              className="w-[26px] h-[26px] flex-none rounded-[6px] bg-muted text-muted-ink grid place-items-center text-[11px] font-semibold"
              title={`Sequence position (${RULE_LABEL[rule]})`}>{idx + 1}</span>
            <span className="text-[14px] font-semibold">{unitRef(t.propertyName, t.unitNumber)}</span>
            <Badge tone={TASK[t.state].tone} label={TASK[t.state].label} size="sm" />
            <Badge tone={sla.tone} label={sla.label} size="sm" />
          </div>

          <div className="text-[13px] text-ink">{t.title} · {t.linenSet}</div>

          <div className="flex gap-[22px] flex-wrap text-[12.5px]">
            <Field2 label="Window" value={windowLabel} />
            <Field2 label="Checkout" value={t.checkoutTime ?? '—'} />
            <Field2 label="Next check-in" value={t.nextGuestAt ?? 'No arrival'} tone={sla.tone === 'critical' ? 'critical' : undefined} />
            <Field2 label="Assignee" value={t.assigneeName ?? 'Unassigned'} muted={!t.assigneeName} />
            {durLabel && <Field2 label="Duration" value={durLabel} tone={inProgress ? 'info' : 'success'} />}
            <Field2 label="Source" value={t.sourceRef} />
            <Field2 label="Unit" value={READINESS[t.readiness].label} />
            <Field2 label="Photos" value={`${t.photoCount}${t.requiresPhoto ? ' / 1 required' : ''}`} tone={noPhoto ? 'warning' : undefined} />
          </div>

          {t.nextGuestAt && (
            <div className="text-[12px] text-muted-ink flex gap-[7px] items-center">
              <Icon name="Clock" size="sm" color="var(--color-faint)" />
              <span>Must be clean by {t.nextGuestAt} — next guest check-in.</span>
            </div>
          )}

          {t.instructions && (
            <div className="text-[12.5px] text-muted-ink flex gap-[7px] items-start">
              <Icon name="Info" size="sm" color="var(--color-faint)" style={{ marginTop: 1 }} />
              <span>{t.instructions}</span>
            </div>
          )}

          {inProgress && noPhoto && (
            <div className={`text-[12px] ${TONE.warning.text} flex gap-1.5 items-center`}>
              <Icon name="Camera" size="sm" />
              Add at least one photo before marking this unit ready.
            </div>
          )}
        </div>

        {/* right: state-driven actions */}
        <div className="flex flex-col gap-[7px] items-stretch min-w-[168px]">
          {!done && (
            <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => openAssign(t)}>
              {hasCleaner ? 'Reassign cleaner' : 'Assign cleaner'}
            </Button>
          )}
          {!done && (
            <Button size="sm" variant="tertiary" icon={<Icon name="CalendarClock" size="sm" />} onClick={() => setReschedule({ task: t, start: t.scheduledFor ?? '08:00', end: t.dueAt ?? '12:00' })}>
              Reschedule
            </Button>
          )}
          {!done && (
            <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditTask(t)}>
              Edit details
            </Button>
          )}
          {canStart && (
            <Button size="sm" variant="primary" icon={<Icon name="Play" size="sm" />} onClick={() => setConfirm({ kind: 'start', task: t })}>
              Start
            </Button>
          )}
          {inProgress && (
            <>
              <Button size="sm" variant="secondary" icon={<Icon name="Camera" size="sm" />} onClick={() => pickPhoto(t)}>
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
          {t.photoCount > 0 && (
            <Button size="sm" variant="tertiary" icon={<Icon name="Images" size="sm" />} onClick={() => setGallery(t)}>
              View photos ({t.photoCount})
            </Button>
          )}
          {!done && hasCleaner && (
            <Button size="sm" variant="tertiary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage({ task: t, title: '', detail: '', chargeTo: 'owner', amount: '', blocksUnit: false })}>
              Report damage
            </Button>
          )}
          {done && (
            <span className={`text-[12.5px] ${TONE.success.text} flex items-center gap-1.5 justify-center h-9`}>
              <Icon name="CheckCheck" size="sm" /> Ready for guest
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onPhotoPicked} />
      <PageHeader
        title="Housekeeping"
        sub={`${merged.length} cleaning tasks · ${unassigned.length} unassigned · sequenced ${SEQ_PHRASE[rule]}`}
        right={
          <div className="flex gap-[9px] flex-wrap">
            <Button variant="secondary" icon={<Icon name="Users" size="sm" />} onClick={() => navigate('/operations/cleaners')}>
              Cleaners
            </Button>
            <Button variant="secondary" icon={<Icon name="ListOrdered" size="sm" />} onClick={() => setEditRule({ rule, strategy, prefer })}>
              Assignment rules
            </Button>
            <Button
              variant="secondary"
              icon={<Icon name="Wand2" size="sm" />}
              disabled={unassigned.length === 0}
              disabledReason="Every task already has a cleaner."
              onClick={() => setConfirm({ kind: 'autoassign' })}
            >
              Auto-assign
            </Button>
            <Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>
              New cleaning task
            </Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      {/* Date tabs — Today / Tomorrow / This week.
          flex-none/self-start keep the control at its intrinsic height: without it
          the toggle is a flex item in the page column and gets shrunk to a sliver,
          clipping the pills' padding under overflow-hidden (matches Inspections). */}
      <div className="inline-flex flex-none self-start border border-solid border-line rounded-control overflow-hidden w-fit">
        {TABS.map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-[15px] py-2 cursor-pointer [border:none] [font:inherit] ${v === tab ? 'bg-black text-white' : 'bg-white text-muted-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      <Card>
        <div className="py-[13px] px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line)]">
          <span className="text-[16px] font-semibold">Cleaning tasks</span>
          <div className="flex items-center gap-[14px] flex-wrap">
            <label className="flex gap-[7px] items-center cursor-pointer text-[12.5px] text-muted-ink select-none">
              <input type="checkbox" checked={groupByBuilding} onChange={e => setGroupByBuilding(e.target.checked)} />
              Group by building
            </label>
            <span className="text-[12px] text-muted-ink">SLA counts down to the next guest check-in</span>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <TableSkeleton rows={4} cols={4} />
        ) : ordered.length === 0 ? (
          <div className="py-[30px] px-[22px] text-[13px] text-muted-ink">
            No cleaning tasks for {TABS.find(t => t[0] === tab)![1].toLowerCase()}. New checkouts create tasks automatically.
          </div>
        ) : groupByBuilding ? (
          (() => { let seq = -1; return groups.map(g => (
            <div key={g.id}>
              <div className="py-[9px] px-5 bg-page flex items-center gap-[9px] [border-bottom:1px_solid_var(--color-line-soft)]">
                <Icon name="Building2" size="sm" color="var(--color-faint)" />
                <span className="text-[13px] font-semibold">{g.name}</span>
                <span className="text-[12px] text-muted-ink">{g.tasks.length} clean{g.tasks.length === 1 ? '' : 's'} — do the building together</span>
              </div>
              {g.tasks.map(t => renderRow(t, ++seq))}
            </div>
          )); })()
        ) : (
          ordered.map((t, idx) => renderRow(t, idx))
        )}
      </Card>

      {/* ---------------- Assign cleaner (with 409 override) ---------------- */}
      {assign && (
        <Modal
          title={`Assign a cleaner to ${unitRef(assign.task.propertyName, assign.task.unitNumber)}?`}
          sub="They are notified immediately. The unit stays in its current state until they mark it ready with a photo."
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
            <label htmlFor="assign-cleaner" className={labelCls}>Cleaner</label>
            <select id="assign-cleaner" value={assign.cleanerId} disabled={busy}
              onChange={e => setAssign(a => a && { ...a, cleanerId: e.target.value, force: false, warning: undefined })}
              className={inputCls}>
              {cleanerOptions(CREW)}
            </select>
          </div>
          {assign.task.nextGuestAt && (
            <div className="text-[12.5px] text-muted-ink">Next guest arrives {assign.task.nextGuestAt}.</div>
          )}
          {assign.warning && (
            <div className={`py-2.5 px-3 rounded-control ${TONE.critical.bg} ${TONE.critical.text} text-[12.5px] flex gap-2 items-start`}>
              <Icon name="TriangleAlert" size="sm" style={{ marginTop: 1 }} />
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
            sub="The cleaning window must close before the next guest arrives."
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
              <div className={`py-2.5 px-3 rounded-control ${TONE.warning.bg} ${TONE.warning.text} text-[12.5px] flex gap-2 items-start`}>
                <Icon name="TriangleAlert" size="sm" style={{ marginTop: 1 }} />
                <span>The window ends at {reschedule.end}, after the next guest arrives at {reschedule.task.nextGuestAt}. The unit may not be ready in time.</span>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* ------------------------- Auto-assign rules ------------------------- */}
      {editRule && (
        <Modal
          title="Assignment rules"
          sub="How cleaning is sequenced, and how Auto-assign spreads it across the roster."
          onClose={() => setEditRule(null)}
          busy={busy}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setEditRule(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={doSaveRules}>Save rules</Button>
          </>}
        >
          <RuleChoice<OrderingRule>
            legend="Order the day by"
            value={editRule.rule}
            options={[
              ['earliest_checkin', RULE_LABEL.earliest_checkin, 'Clean the units whose next guest arrives soonest first.'],
              ['building', RULE_LABEL.building, 'Group a cleaner’s jobs by building to cut travel time.'],
              ['manual', RULE_LABEL.manual, 'Keep the order you set by hand.'],
            ]}
            onPick={r => setEditRule(d => d && { ...d, rule: r })}
          />
          <RuleChoice<AssignStrategy>
            legend="Spread work by"
            value={editRule.strategy}
            options={[
              ['least_loaded', STRATEGY_LABEL.least_loaded, 'Give each clean to whoever has the fewest open jobs.'],
              ['round_robin', STRATEGY_LABEL.round_robin, 'Cycle through the roster in turn.'],
            ]}
            onPick={s => setEditRule(d => d && { ...d, strategy: s })}
          />
          <RuleChoice<AssignPrefer>
            legend="Prefer which cleaners"
            value={editRule.prefer}
            options={[
              ['any', PREFER_LABEL.any, 'Use internal staff and outsourced crews together.'],
              ['internal', PREFER_LABEL.internal, 'Only your own staff; outsourced left for you to assign by hand.'],
              ['outsourced', PREFER_LABEL.outsourced, 'Only third-party crews; keep staff free for other work.'],
            ]}
            onPick={p => setEditRule(d => d && { ...d, prefer: p })}
          />
        </Modal>
      )}

      {/* ------------------------- Report damage ------------------------- */}
      {damage && (
        <Modal
          title={`Report damage · ${unitRef(damage.task.propertyName, damage.task.unitNumber)}`}
          sub="Raises a maintenance issue linked to this unit."
          onClose={() => setDamage(null)}
          busy={busy}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setDamage(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!damage.title.trim()}
              disabledReason="Add a short title first." onClick={doDamage}>
              Report damage
            </Button>
          </>}
        >
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="dmg-title" className={labelCls}>What is damaged or missing</label>
            <input id="dmg-title" value={damage.title} disabled={busy} placeholder="Cracked bathroom mirror"
              onChange={e => setDamage(d => d && { ...d, title: e.target.value })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="dmg-detail" className={labelCls}>Detail</label>
            <textarea id="dmg-detail" value={damage.detail} disabled={busy} rows={2} placeholder="Where it is, how bad, any temporary fix"
              onChange={e => setDamage(d => d && { ...d, detail: e.target.value })}
              className="block w-full box-border h-auto py-[9px] px-3 text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit] resize-y" />
          </div>
          <div className="flex gap-[14px]">
            <div className="flex-1 flex flex-col gap-[7px]">
              <label htmlFor="dmg-charge" className={labelCls}>Charge to</label>
              <select id="dmg-charge" value={damage.chargeTo} disabled={busy}
                onChange={e => setDamage(d => d && { ...d, chargeTo: e.target.value as 'owner' | 'company' })} className={inputCls}>
                <option value="owner">Owner</option>
                <option value="company">The Conts</option>
              </select>
            </div>
            <div className="flex-1 flex flex-col gap-[7px]">
              <label htmlFor="dmg-amount" className={labelCls}>Quoted amount (RM)</label>
              <input id="dmg-amount" inputMode="decimal" value={damage.amount} disabled={busy} placeholder="0.00"
                onChange={e => setDamage(d => d && { ...d, amount: e.target.value })}
                className={`${inputCls} text-right tabular-nums`} />
            </div>
          </div>
          <label className={`flex gap-[9px] items-center ${busy ? 'cursor-default' : 'cursor-pointer'} text-[13px]`}>
            <input type="checkbox" checked={damage.blocksUnit} disabled={busy}
              onChange={e => setDamage(d => d && { ...d, blocksUnit: e.target.checked })} />
            Block the unit — it is not safe to let the next guest in
          </label>
        </Modal>
      )}

      {/* ------------------------- POD photo gallery ------------------------- */}
      {gallery && (
        <PhotoGalleryModal task={gallery} onClose={() => setGallery(null)} />
      )}

      {/* ------------------------- New cleaning task ------------------------- */}
      {creating && (
        <CreateCleaningModal
          crew={CREW}
          defaultDate={tab === 'tomorrow' ? todayMyt(1) : todayMyt()}
          busy={busy}
          onClose={() => setCreating(false)}
          onCreate={doCreate}
        />
      )}

      {/* ------------------------- Edit cleaning details ------------------------- */}
      {editTask && (
        <EditDetailsModal
          task={editTask}
          busy={busy}
          onClose={() => setEditTask(null)}
          onSave={doEditDetails}
        />
      )}

      {/* --------------------------- confirms --------------------------- */}
      <Dialog
        busy={busy}
        onClose={() => setConfirm(null)}
        spec={!confirm ? null
          : confirm.kind === 'start' && confirm.task ? {
            title: `Start cleaning ${unitRef(confirm.task.propertyName, confirm.task.unitNumber)}?`,
            body: 'The task moves to in progress and the unit shows as cleaning until a photo confirms it is ready.',
            meta: confirm.task.nextGuestAt ? `Next guest arrives ${confirm.task.nextGuestAt}.` : undefined,
            confirmLabel: 'Start', busyLabel: 'Starting…', onConfirm: doStart,
          }
          : confirm.kind === 'complete' && confirm.task ? {
            title: `Mark ${unitRef(confirm.task.propertyName, confirm.task.unitNumber)} ready for guest?`,
            body: `${confirm.task.photoCount} photo${confirm.task.photoCount === 1 ? '' : 's'} attached. The unit is released as ready.`,
            meta: confirm.task.nextGuestAt ? `Next check-in is ${confirm.task.nextGuestAt}.` : undefined,
            confirmLabel: 'Mark complete', busyLabel: 'Completing…', onConfirm: doComplete,
          }
          : {
            title: `Auto-assign ${unassigned.length} unassigned task${unassigned.length === 1 ? '' : 's'}?`,
            body: `Every unassigned task is given a cleaner and sequenced by ${RULE_LABEL[rule].toLowerCase()}. Cleaners are notified.`,
            confirmLabel: 'Auto-assign', busyLabel: 'Assigning…', onConfirm: doAutoAssign,
          }}
      />
    </>
  );
}

/** A labelled radio group of option cards, used across the auto-assign rules editor. */
function RuleChoice<T extends string>({ legend, value, options, onPick }: {
  legend: string; value: T; options: [T, string, string][]; onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold text-muted-ink">{legend}</span>
      {options.map(([v, label, desc]) => {
        const on = value === v;
        return (
          <button key={v} type="button" onClick={() => onPick(v)}
            className={`text-left py-3 px-[13px] rounded-control cursor-pointer [font:inherit] flex gap-[11px] items-start border border-solid ${on ? 'border-gold bg-gold-tint' : 'border-line bg-white'}`}>
            <span className={`w-4 h-4 flex-none mt-px rounded-full border-2 border-solid ${on ? 'border-gold bg-gold' : 'border-line-strong bg-transparent'}`} />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold">{label}</span>
              <span className="text-[12px] text-muted-ink">{desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** <option>s for a cleaner picker, grouped Internal vs Outsourced, with the vendor
 *  and today's load so the operator can spread work. Used by Assign and Create. */
function cleanerOptions(crew: Cleaner[]) {
  return (['internal', 'outsourced'] as Employment[]).map(emp => {
    const list = crew.filter(c => c.employmentType === emp);
    if (!list.length) return null;
    return (
      <optgroup key={emp} label={EMPLOYMENT_LABEL[emp]}>
        {list.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}{emp === 'outsourced' && c.vendorName ? ` — ${c.vendorName}` : ''}{c.busy ? ` · ${c.busy} today` : ''}
          </option>
        ))}
      </optgroup>
    );
  });
}

/** A compact label/value pair used across a task's field row. */
function Field2({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-faint font-semibold uppercase tracking-[0.03em]">{label}</span>
      <span className={`text-[12.5px] font-medium whitespace-nowrap ${tone ? TONE[tone].text : muted ? 'text-muted-ink' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

/* ------------------------- POD photo gallery ------------------------- */

interface PodPhoto { id: string; url: string; fileName: string; uploader: string | null; capturedAt: string; byteSize: number }

/** Proof-of-delivery: every cleaning photo attached to one task. Photos are read
 *  from GET /api/housekeeping/tasks/:id/photos and served from R2 via
 *  /api/documents/:id/download. In dev there is no backend, so a placeholder tile
 *  is shown per known photo and the real image loads only against the live API. */
function PhotoGalleryModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const fallback: { data: PodPhoto[] } = {
    data: Array.from({ length: task.photoCount }, (_, i) => ({
      id: `local-${i}`, url: '', fileName: `clean-${i + 1}.jpg`, uploader: task.assigneeName, capturedAt: task.completedAt ?? task.startedAt ?? '', byteSize: 0,
    })),
  };
  const { data, loading } = useApi<{ data: PodPhoto[] }>(`/housekeeping/tasks/${task.id}/photos`, fallback);
  const photos = data?.data ?? [];

  return (
    <Modal
      title={`Cleaning photos · ${unitRef(task.propertyName, task.unitNumber)}`}
      sub="Proof of delivery — the photos the cleaner attached for this clean."
      onClose={onClose}
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}
    >
      {loading && photos.length === 0 ? (
        <div className="text-[13px] text-muted-ink">Loading photos…</div>
      ) : photos.length === 0 ? (
        <div className="text-[13px] text-muted-ink">No photos yet. The cleaner adds them from the task before marking it ready.</div>
      ) : (
        <div className="grid grid-cols-2 gap-[11px]">
          {photos.map(p => (
            <a key={p.id} href={p.url || undefined} target="_blank" rel="noreferrer"
              className="flex flex-col gap-[5px] no-underline text-ink">
              <div className="aspect-square rounded-control overflow-hidden bg-muted border border-solid border-line grid place-items-center">
                {p.url ? (
                  <img src={p.url} alt={p.fileName} className="w-full h-full object-cover"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.parentElement!.querySelector('[data-ph]') as HTMLElement).style.display = 'flex'; }} />
                ) : null}
                <span data-ph className="w-full h-full flex-col items-center justify-center gap-1.5 text-muted-ink" style={{ display: p.url ? 'none' : 'flex' }}>
                  <Icon name="Image" size="lg" color="var(--color-faint)" />
                  <span className="text-[11px]">Photo</span>
                </span>
              </div>
              <span className="text-[11.5px] text-muted-ink truncate">
                {p.uploader ? `${p.uploader} · ` : ''}{p.capturedAt ? dateTime(p.capturedAt) : p.fileName}
              </span>
            </a>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------- Manual create + edit ------------------------- */

interface CreateDraft {
  propertyName: string; unitNumber: string; kind: CleanKind; linenSet: string;
  scheduledFor: string; dueAt: string; nextGuestAt: string; assigneeId: string;
  instructions: string; requiresPhoto: boolean;
}

/** New cleaning task by hand — the manual equivalent of the one-clean-per-checkout
 *  auto path. Every field the roster shows can be set here; assigning is optional. */
function CreateCleaningModal({ crew, defaultDate, busy, onClose, onCreate }: {
  crew: Cleaner[]; defaultDate: string; busy?: boolean; onClose: () => void; onCreate: (d: CreateDraft) => void;
}) {
  const [d, setD] = useState<CreateDraft>({
    propertyName: '', unitNumber: '', kind: 'turnover', linenSet: 'Set A',
    scheduledFor: '08:00', dueAt: '14:00', nextGuestAt: '', assigneeId: '',
    instructions: '', requiresPhoto: true,
  });
  const set = (p: Partial<CreateDraft>) => setD(v => ({ ...v, ...p }));
  const valid = d.propertyName.trim() && d.unitNumber.trim() &&
    (!d.scheduledFor || !d.dueAt || d.dueAt > d.scheduledFor);
  const endsAfter = !!d.nextGuestAt && !!d.dueAt && d.dueAt > d.nextGuestAt;

  return (
    <Modal
      title="New cleaning task"
      sub="Creates an ad-hoc clean on a unit. Checkouts create their own turnover automatically — this is for everything else."
      onClose={onClose}
      busy={busy}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!valid}
          disabledReason="Add the property, unit and a valid window first." onClick={() => valid && onCreate(d)}>
          Create task
        </Button>
      </>}
    >
      <div className="flex gap-[14px]">
        <div className="flex-1 flex flex-col gap-[7px]">
          <label htmlFor="ck-prop" className={labelCls}>Property</label>
          <input id="ck-prop" value={d.propertyName} disabled={busy} placeholder="Vista Jaya One"
            onChange={e => set({ propertyName: e.target.value })} className={inputCls} />
        </div>
        <div className="flex-1 flex flex-col gap-[7px]">
          <label htmlFor="ck-unit" className={labelCls}>Unit</label>
          <input id="ck-unit" value={d.unitNumber} disabled={busy} placeholder="#A-12-03"
            onChange={e => set({ unitNumber: e.target.value })} className={inputCls} />
        </div>
      </div>

      <div className="flex gap-[14px]">
        <div className="flex-1 flex flex-col gap-[7px]">
          <label htmlFor="ck-kind" className={labelCls}>Kind of clean</label>
          <select id="ck-kind" value={d.kind} disabled={busy}
            onChange={e => set({ kind: e.target.value as CleanKind })} className={inputCls}>
            {CLEAN_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-[7px]">
          <label htmlFor="ck-linen" className={labelCls}>Linen set</label>
          <select id="ck-linen" value={d.linenSet} disabled={busy}
            onChange={e => set({ linenSet: e.target.value })} className={inputCls}>
            <option value="Set A">Set A</option>
            <option value="Set B">Set B</option>
          </select>
        </div>
      </div>

      <div className="flex gap-[14px]">
        <div className="flex-1 flex flex-col gap-[7px]">
          <label htmlFor="ck-start" className={labelCls}>Window start</label>
          <input id="ck-start" type="time" value={d.scheduledFor} disabled={busy}
            onChange={e => set({ scheduledFor: e.target.value })} className={inputCls} />
        </div>
        <div className="flex-1 flex flex-col gap-[7px]">
          <label htmlFor="ck-end" className={labelCls}>Window end</label>
          <input id="ck-end" type="time" value={d.dueAt} disabled={busy}
            onChange={e => set({ dueAt: e.target.value })} className={inputCls} />
        </div>
        <div className="flex-1 flex flex-col gap-[7px]">
          <label htmlFor="ck-next" className={labelCls}>Next guest (optional)</label>
          <input id="ck-next" type="time" value={d.nextGuestAt} disabled={busy}
            onChange={e => set({ nextGuestAt: e.target.value })} className={inputCls} />
        </div>
      </div>
      {endsAfter && (
        <div className={`py-2.5 px-3 rounded-control ${TONE.warning.bg} ${TONE.warning.text} text-[12.5px] flex gap-2 items-start`}>
          <Icon name="TriangleAlert" size="sm" style={{ marginTop: 1 }} />
          <span>The window ends at {d.dueAt}, after the next guest arrives at {d.nextGuestAt}. The unit may not be ready in time.</span>
        </div>
      )}

      <div className="flex flex-col gap-[7px]">
        <label htmlFor="ck-cleaner" className={labelCls}>Assign a cleaner (optional)</label>
        <select id="ck-cleaner" value={d.assigneeId} disabled={busy}
          onChange={e => set({ assigneeId: e.target.value })} className={inputCls}>
          <option value="">Leave unassigned</option>
          {cleanerOptions(crew)}
        </select>
      </div>

      <div className="flex flex-col gap-[7px]">
        <label htmlFor="ck-notes" className={labelCls}>Instructions (optional)</label>
        <textarea id="ck-notes" value={d.instructions} disabled={busy} rows={2} placeholder="Restock coffee pods, descale the kettle…"
          onChange={e => set({ instructions: e.target.value })}
          className="block w-full box-border h-auto py-[9px] px-3 text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit] resize-y" />
      </div>

      <label className={`flex gap-[9px] items-center ${busy ? 'cursor-default' : 'cursor-pointer'} text-[13px]`}>
        <input type="checkbox" checked={d.requiresPhoto} disabled={busy}
          onChange={e => set({ requiresPhoto: e.target.checked })} />
        Require a photo before the unit can be marked ready
      </label>
      <div className="text-[12px] text-muted-ink">Scheduled for {defaultDate}. New checkouts still create their own turnover automatically.</div>
    </Modal>
  );
}

/** Edit a task's kind and instructions in place. Times are changed through
 *  Reschedule; this covers the descriptive fields the roster shows. */
function EditDetailsModal({ task, busy, onClose, onSave }: {
  task: Task; busy?: boolean; onClose: () => void; onSave: (t: Task, next: { kind: CleanKind; instructions: string }) => void;
}) {
  const [kind, setKind] = useState<CleanKind>(task.kind ?? 'turnover');
  const [instructions, setInstructions] = useState(task.instructions ?? '');
  return (
    <Modal
      title={`Edit ${unitRef(task.propertyName, task.unitNumber)}`}
      sub="Change the kind of clean or its instructions. Use Reschedule to move the window."
      onClose={onClose}
      busy={busy}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => onSave(task, { kind, instructions })}>Save changes</Button>
      </>}
    >
      <div className="flex flex-col gap-[7px]">
        <label htmlFor="ed-kind" className={labelCls}>Kind of clean</label>
        <select id="ed-kind" value={kind} disabled={busy}
          onChange={e => setKind(e.target.value as CleanKind)} className={inputCls}>
          {CLEAN_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-[7px]">
        <label htmlFor="ed-notes" className={labelCls}>Instructions</label>
        <textarea id="ed-notes" value={instructions} disabled={busy} rows={3} placeholder="Anything the cleaner needs to know"
          onChange={e => setInstructions(e.target.value)}
          className="block w-full box-border h-auto py-[9px] px-3 text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit] resize-y" />
      </div>
    </Modal>
  );
}
