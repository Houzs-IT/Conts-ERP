import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { color, radius, text, tone as T } from '../theme';
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
import { rm, unitRef } from '../lib/format';
import { READINESS, TASK } from '../lib/vocabulary';
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

interface Cleaner { id: string; name: string }
const CREW: Cleaner[] = [
  { id: 'u5', name: 'Nurul Huda' },
  { id: 'u6', name: 'Faridah Ismail' },
  { id: 'u9', name: 'Siti Rahmah' },
];
const firstName = (name: string) => name.split(' ')[0];

interface Task {
  id: string;
  unitNumber: string;
  propertyName: string;
  sourceRef: string;           // source reservation
  title: string;               // kind of clean, human title
  linenSet: string;
  instructions: string | null;
  scheduledFor: string | null; // HH:MM (window start)
  dueAt: string | null;        // HH:MM (window end)
  nextGuestAt: string | null;  // HH:MM
  assigneeId: string | null;
  assigneeName: string | null;
  sequence: number;
  state: TaskState;
  readiness: UnitReadiness;
  requiresPhoto: boolean;
  photoCount: number;
}
interface Payload { rows: Task[]; date: string; generatedAt: string }

const FALLBACK: Payload = {
  date: '2026-09-16', generatedAt: '',
  rows: [
    { id: 'h1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', sourceRef: 'RES-40821', title: 'Turnover, 2BR', linenSet: 'Set A', instructions: 'Late check-out to 13:00. Restock coffee pods.', scheduledFor: '08:00', dueAt: '14:00', nextGuestAt: '15:00', assigneeId: 'u5', assigneeName: 'Nurul Huda', sequence: 1, state: 'in_progress', readiness: 'cleaning', requiresPhoto: true, photoCount: 0 },
    { id: 'h2', unitNumber: '#B-08-11', propertyName: 'Arcoris', sourceRef: 'RES-40833', title: 'Turnover, studio', linenSet: 'Set B', instructions: 'Early check-in requested by next guest.', scheduledFor: '12:00', dueAt: '15:30', nextGuestAt: '16:00', assigneeId: 'u5', assigneeName: 'Nurul Huda', sequence: 2, state: 'assigned', readiness: 'dirty', requiresPhoto: true, photoCount: 0 },
    { id: 'h3', unitNumber: '#15-06', propertyName: 'Scarletz', sourceRef: 'RES-40790', title: 'Deep clean', linenSet: 'Set A', instructions: 'Vacant 4 nights. Descale kettle and shower.', scheduledFor: '10:00', dueAt: '16:30', nextGuestAt: '18:00', assigneeId: 'u6', assigneeName: 'Faridah Ismail', sequence: 3, state: 'assigned', readiness: 'dirty', requiresPhoto: true, photoCount: 1 },
    { id: 'h4', unitNumber: '#2207', propertyName: 'Tribeca', sourceRef: 'RES-40765', title: 'Light clean', linenSet: 'Set B', instructions: 'Owner stay ended. Standard refresh.', scheduledFor: '08:00', dueAt: '11:00', nextGuestAt: null, assigneeId: 'u9', assigneeName: 'Siti Rahmah', sequence: 4, state: 'resolved', readiness: 'ready', requiresPhoto: true, photoCount: 2 },
    { id: 'h5', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', sourceRef: 'RES-40711', title: 'Post-works clean', linenSet: 'Set A', instructions: 'Plumbing repair completed. Clear dust sheets.', scheduledFor: '16:00', dueAt: '18:00', nextGuestAt: null, assigneeId: 'u9', assigneeName: 'Siti Rahmah', sequence: 5, state: 'assigned', readiness: 'maintenance', requiresPhoto: true, photoCount: 0 },
    { id: 'h6', unitNumber: '#A-21-02', propertyName: 'The Establishment', sourceRef: 'RES-40852', title: 'Turnover, 2BR', linenSet: 'Set A', instructions: 'No cleaner assigned yet.', scheduledFor: '14:00', dueAt: '14:54', nextGuestAt: '15:00', assigneeId: null, assigneeName: null, sequence: 6, state: 'open', readiness: 'dirty', requiresPhoto: true, photoCount: 0 },
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

/* ------------------------------ local modal ------------------------------ */
const inputStyle: CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px',
  fontSize: text.body, color: color.ink, background: '#FFFFFF',
  border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit',
};
const labelStyle: CSSProperties = { fontSize: text.small, fontWeight: 500, color: color.textMuted };

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
    <div role="dialog" aria-modal="true" aria-label={title} style={{
      position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24,
      background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both',
    }}>
      <div onClick={busy ? undefined : onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{
        position: 'relative', width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto',
        background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-overlay)', animation: 'dialog-in var(--motion-slow) var(--ease-out) both',
      }}>
        <div style={{ padding: '20px 22px 4px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 600 }}>{title}</h2>
            {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: color.textMuted }}>{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" disabled={busy}
            style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: color.textMuted, display: 'flex' }}>
            <Icon name="X" size="sm" />
          </button>
        </div>
        <div style={{ padding: '14px 22px 4px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
        <div style={{
          padding: '14px 22px', marginTop: 8, borderTop: `1px solid ${color.border}`,
          background: 'var(--color-surface-page)', display: 'flex', alignItems: 'center',
          justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap', position: 'sticky', bottom: 0,
        }}>{footer}</div>
      </div>
    </div>
  );
}

/* ------------------------------- the page -------------------------------- */
type Tab = 'today' | 'tomorrow' | 'week';
const TABS: [Tab, string][] = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week']];
const TAB_DATE: Record<Tab, string> = { today: '2026-09-16', tomorrow: '2026-09-17', week: '2026-09-16..2026-09-22' };

export default function HousekeepingPage() {
  const [tab, setTab] = useState<Tab>('today');
  const { data, loading, error, reload } = useApi<Payload>(`/housekeeping/tasks?date=${TAB_DATE[tab]}`, FALLBACK);
  const toast = useToast();

  // Optimistic overlay: patches merged onto each task by id.
  const [edits, setEdits] = useState<Record<string, Partial<Task>>>({});
  const patch = (id: string, p: Partial<Task>) => setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));

  const [rule, setRule] = useState<OrderingRule>('earliest_checkin');

  // Live clock for the SLA countdown.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  // Dialog / modal state.
  const [assign, setAssign] = useState<{ task: Task; cleanerId: string; force: boolean; warning?: string } | null>(null);
  const [reschedule, setReschedule] = useState<{ task: Task; start: string; end: string } | null>(null);
  const [damage, setDamage] = useState<{ task: Task; title: string; detail: string; chargeTo: 'owner' | 'company'; amount: string; blocksUnit: boolean } | null>(null);
  const [editRule, setEditRule] = useState<OrderingRule | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'start' | 'complete' | 'autoassign'; task?: Task }>(null);
  const [busy, setBusy] = useState(false);

  const merged = (data?.rows ?? []).map(t => ({ ...t, ...edits[t.id] }));
  const unassigned = merged.filter(t => !t.assigneeId);

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
    setAssign({ task, cleanerId: task.assigneeId ?? CREW[0].id, force: false });
  }

  async function doAssign() {
    if (!assign) return;
    const { task, cleanerId, force } = assign;
    const cleaner = CREW.find(c => c.id === cleanerId)!;

    // Simulate the 409 ASSIGNEE_BUSY overlap check the backend would run.
    if (!force) {
      const clash = merged.filter(t =>
        t.id !== task.id && t.assigneeId === cleanerId &&
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
    patch(task.id, { assigneeId: cleaner.id, assigneeName: cleaner.name, state: task.state === 'open' ? 'assigned' : task.state });
    toast({ tone: 'success', title: 'Cleaner assigned.', body: `${firstName(cleaner.name)} has been notified.` });
    setAssign(null);
    try { await api.post(`/housekeeping/tasks/${task.id}/assign`, { assigneeId: cleaner.id, force }); }
    catch { /* dev: no backend, keep optimistic */ }
    setBusy(false);
  }

  async function doAutoAssign() {
    const targets = unassigned;
    // Apply the preset ordering rule, then spread across the crew evenly.
    const byRule = [...targets].sort((a, b) => (toMin(a.nextGuestAt) ?? 1e9) - (toMin(b.nextGuestAt) ?? 1e9));
    setBusy(true);
    byRule.forEach((t, i) => {
      const c = CREW[i % CREW.length];
      patch(t.id, { assigneeId: c.id, assigneeName: c.name, state: 'assigned', sequence: t.sequence });
    });
    toast({ tone: 'success', title: `${targets.length} task${targets.length === 1 ? '' : 's'} auto-assigned.`, body: `Ordered by ${RULE_LABEL[rule].toLowerCase()}. Cleaners notified.` });
    setConfirm(null);
    try { await api.post('/housekeeping/auto-assign', { rule }); } catch { /* dev */ }
    setBusy(false);
  }

  async function doSaveRule() {
    if (!editRule) return;
    setBusy(true);
    setRule(editRule);
    toast({ tone: 'success', title: 'Ordering rule updated.', body: `Sequencing by ${RULE_LABEL[editRule].toLowerCase()}.` });
    setEditRule(null);
    try { await api.put('/housekeeping/rules', { rule: editRule }); } catch { /* dev */ }
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

  async function addPhoto(task: Task) {
    patch(task.id, { photoCount: task.photoCount + 1 });
    toast({ tone: 'success', title: 'Photo added.', body: `${task.photoCount + 1} on ${unitRef(task.propertyName, task.unitNumber)}.` });
    try { await api.post(`/tasks/${task.id}/photos`, {}); } catch { /* dev */ }
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

  return (
    <>
      <PageHeader
        title="Housekeeping"
        sub={`${merged.length} cleaning tasks · ${unassigned.length} unassigned · sequenced by ${RULE_LABEL[rule].toLowerCase()}`}
        right={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <Button variant="secondary" icon={<Icon name="ListOrdered" size="sm" />} onClick={() => setEditRule(rule)}>
              Edit ordering rule
            </Button>
            <Button
              variant="primary"
              icon={<Icon name="Wand2" size="sm" />}
              disabled={unassigned.length === 0}
              disabledReason="Every task already has a cleaner."
              onClick={() => setConfirm({ kind: 'autoassign' })}
            >
              Auto-assign by rule
            </Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      {/* Date tabs — Today / Tomorrow / This week */}
      <div style={{ display: 'inline-flex', border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden', width: 'fit-content' }}>
        {TABS.map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            style={{ padding: '8px 15px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: 'none', font: 'inherit',
              background: v === tab ? color.black : '#FFFFFF', color: v === tab ? '#FFFFFF' : color.textMuted }}>
            {label}
          </button>
        ))}
      </div>

      <Card>
        <div style={{ padding: '13px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderBottom: `1px solid ${color.border}` }}>
          <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Cleaning tasks</span>
          <span style={{ fontSize: text.small, color: color.textMuted }}>SLA counts down to the next guest arrival</span>
        </div>

        {loading && rows.length === 0 ? (
          <TableSkeleton rows={4} cols={4} />
        ) : ordered.length === 0 ? (
          <div style={{ padding: '30px 22px', fontSize: 13, color: color.textMuted }}>
            No cleaning tasks for {TABS.find(t => t[0] === tab)![1].toLowerCase()}. New checkouts create tasks automatically.
          </div>
        ) : (
          ordered.map((t, idx) => {
            const sla = slaOf(t, now);
            const canStart = t.state === 'assigned';
            const inProgress = t.state === 'in_progress';
            const done = t.state === 'resolved';
            const noPhoto = t.requiresPhoto && t.photoCount < 1;
            const windowLabel = t.scheduledFor && t.dueAt ? `${t.scheduledFor} → ${t.dueAt}` : '—';

            return (
              <div key={t.id} style={{
                display: 'flex', gap: 18, padding: '15px 20px', flexWrap: 'wrap',
                borderBottom: `1px solid ${color.borderMuted}`, borderLeft: `3px solid ${T[sla.tone].line}`,
                opacity: done ? 0.72 : 1,
              }}>
                {/* left: identity + fields */}
                <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <span style={{
                      width: 26, height: 26, flex: 'none', borderRadius: radius.sm, background: color.muted,
                      color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600,
                    }} title={`Sequence position (${RULE_LABEL[rule]})`}>{idx + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{unitRef(t.propertyName, t.unitNumber)}</span>
                    <Badge tone={TASK[t.state].tone} label={TASK[t.state].label} size="sm" />
                    <Badge tone={sla.tone} label={sla.label} size="sm" />
                  </div>

                  <div style={{ fontSize: 13, color: color.ink }}>{t.title} · {t.linenSet}</div>

                  <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <Field2 label="Window" value={windowLabel} />
                    <Field2 label="Next guest" value={t.nextGuestAt ?? 'No arrival'} tone={sla.tone === 'critical' ? 'critical' : undefined} />
                    <Field2 label="Assignee" value={t.assigneeName ?? 'Unassigned'} muted={!t.assigneeName} />
                    <Field2 label="Source" value={t.sourceRef} />
                    <Field2 label="Unit" value={READINESS[t.readiness].label} />
                    <Field2 label="Photos" value={`${t.photoCount}${t.requiresPhoto ? ' / 1 required' : ''}`} tone={noPhoto ? 'warning' : undefined} />
                  </div>

                  {t.instructions && (
                    <div style={{ fontSize: 12.5, color: color.textMuted, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                      <Icon name="Info" size="sm" color={color.faint} style={{ marginTop: 1 }} />
                      <span>{t.instructions}</span>
                    </div>
                  )}

                  {inProgress && noPhoto && (
                    <div style={{ fontSize: 12, color: T.warning.fg, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Icon name="Camera" size="sm" color={T.warning.fg} />
                      Add at least one photo before marking this unit ready.
                    </div>
                  )}
                </div>

                {/* right: state-driven actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'stretch', minWidth: 168 }}>
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
                  {!done && t.assigneeId && (
                    <Button size="sm" variant="tertiary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage({ task: t, title: '', detail: '', chargeTo: 'owner', amount: '', blocksUnit: false })}>
                      Report damage
                    </Button>
                  )}
                  {done && (
                    <span style={{ fontSize: 12.5, color: T.success.fg, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', height: 36 }}>
                      <Icon name="CheckCheck" size="sm" color={T.success.fg} /> Ready for guest
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="assign-cleaner" style={labelStyle}>Cleaner</label>
            <select id="assign-cleaner" value={assign.cleanerId} disabled={busy}
              onChange={e => setAssign(a => a && { ...a, cleanerId: e.target.value, force: false, warning: undefined })}
              style={inputStyle}>
              {CREW.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {assign.task.nextGuestAt && (
            <div style={{ fontSize: 12.5, color: color.textMuted }}>Next guest arrives {assign.task.nextGuestAt}.</div>
          )}
          {assign.warning && (
            <div style={{ padding: '10px 12px', borderRadius: radius.control, background: T.critical.bg, color: T.critical.fg, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="TriangleAlert" size="sm" color={T.critical.fg} style={{ marginTop: 1 }} />
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
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label htmlFor="rs-start" style={labelStyle}>Window start (scheduled for)</label>
                <input id="rs-start" type="time" value={reschedule.start} disabled={busy}
                  onChange={e => setReschedule(r => r && { ...r, start: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label htmlFor="rs-end" style={labelStyle}>Window end (due at)</label>
                <input id="rs-end" type="time" value={reschedule.end} disabled={busy}
                  onChange={e => setReschedule(r => r && { ...r, end: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: color.textMuted }}>
              Next guest arrives {reschedule.task.nextGuestAt ?? 'not scheduled'}.
            </div>
            {endsAfter && (
              <div style={{ padding: '10px 12px', borderRadius: radius.control, background: T.warning.bg, color: T.warning.fg, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Icon name="TriangleAlert" size="sm" color={T.warning.fg} style={{ marginTop: 1 }} />
                <span>The window ends at {reschedule.end}, after the next guest arrives at {reschedule.task.nextGuestAt}. The unit may not be ready in time.</span>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* ------------------------- Edit ordering rule ------------------------- */}
      {editRule && (
        <Modal
          title="Edit ordering rule"
          sub="Auto-assign and the sequence numbers follow this rule."
          onClose={() => setEditRule(null)}
          busy={busy}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setEditRule(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={doSaveRule}>Save rule</Button>
          </>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(Object.keys(RULE_LABEL) as OrderingRule[]).map(r => {
              const on = editRule === r;
              const desc = r === 'earliest_checkin' ? 'Clean the units whose next guest arrives soonest first.'
                : r === 'building' ? 'Group a cleaner’s jobs by property to cut travel time.'
                : 'Keep the order you set by hand.';
              return (
                <button key={r} type="button" onClick={() => setEditRule(r)}
                  style={{
                    textAlign: 'left', padding: '12px 13px', borderRadius: radius.control, cursor: 'pointer', font: 'inherit',
                    display: 'flex', gap: 11, alignItems: 'flex-start',
                    border: `1px solid ${on ? color.gold : color.border}`, background: on ? color.goldTint : '#FFFFFF',
                  }}>
                  <span style={{
                    width: 16, height: 16, flex: 'none', marginTop: 1, borderRadius: 999,
                    border: `2px solid ${on ? color.gold : color.borderStrong}`, background: on ? color.gold : 'transparent',
                  }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{RULE_LABEL[r]}</span>
                    <span style={{ fontSize: 12, color: color.textMuted }}>{desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="dmg-title" style={labelStyle}>What is damaged or missing</label>
            <input id="dmg-title" value={damage.title} disabled={busy} placeholder="Cracked bathroom mirror"
              onChange={e => setDamage(d => d && { ...d, title: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="dmg-detail" style={labelStyle}>Detail</label>
            <textarea id="dmg-detail" value={damage.detail} disabled={busy} rows={2} placeholder="Where it is, how bad, any temporary fix"
              onChange={e => setDamage(d => d && { ...d, detail: e.target.value })}
              style={{ ...inputStyle, height: 'auto', padding: '9px 12px', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label htmlFor="dmg-charge" style={labelStyle}>Charge to</label>
              <select id="dmg-charge" value={damage.chargeTo} disabled={busy}
                onChange={e => setDamage(d => d && { ...d, chargeTo: e.target.value as 'owner' | 'company' })} style={inputStyle}>
                <option value="owner">Owner</option>
                <option value="company">The Conts</option>
              </select>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label htmlFor="dmg-amount" style={labelStyle}>Quoted amount (RM)</label>
              <input id="dmg-amount" inputMode="decimal" value={damage.amount} disabled={busy} placeholder="0.00"
                onChange={e => setDamage(d => d && { ...d, amount: e.target.value })}
                style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
            </div>
          </div>
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', cursor: busy ? 'default' : 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={damage.blocksUnit} disabled={busy}
              onChange={e => setDamage(d => d && { ...d, blocksUnit: e.target.checked })} />
            Block the unit — it is not safe to let the next guest in
          </label>
        </Modal>
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

/** A compact label/value pair used across a task's field row. */
function Field2({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: Tone }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: text.micro, color: color.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: tone ? T[tone].fg : muted ? color.textMuted : color.ink, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}
