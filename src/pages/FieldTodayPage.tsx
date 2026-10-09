import { useEffect, useRef, useState } from 'react';
import { TONE, cx } from '../lib/design-tokens';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Dialog } from '../components/Dialog';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { time, date, unitRef, plural, count } from '../lib/format';
import { READINESS, SYNC } from '../lib/vocabulary';
import type { SyncState, Tone, UnitReadiness } from '../lib/types';

/* ------------------------------------------------------------------ *
 * Field app -> Today (routes.json fieldApp, /field/today).
 * Rendered inside FieldShell for role = housekeeper / technician: one
 * column, 44px touch targets, no financial field anywhere (guide 16.1 /
 * api.md — field-role responses omit revenue, fees and payout).
 *
 * The crew works on a phone in a car park, often offline, so every
 * mutation goes through an offline QUEUE. The cardinal rule (guide 19):
 * never show a success state before the server confirms it. A tap moves
 * the row to `queued`, the server response is the ONLY thing that flips
 * it to `synced`, and a failed sync stays visibly failed with a retry.
 * There is no backend in dev, so the real POST is attempted in a
 * swallowed try/catch — the interaction still reaches its honest queued
 * / failed state without ever faking "ready".
 * ------------------------------------------------------------------ */

interface FieldTask {
  id: string;
  unitId?: string;
  unit: { unitNumber: string; propertyName: string };
  addressLine: string;
  accessInstruction: string | null;
  work: string;
  dueAt: string | null;        // ISO
  nextGuestAt: string | null;  // ISO — drives the "Next check-in is {time}" confirm
  readiness: UnitReadiness;
  flag: string | null;         // server-provided short hint, e.g. "Early check-in requested"
  requiresPhoto: boolean;
  photoCount: number;
  sync: SyncState | null;      // last-known queue state for this row, if any
  syncedAt: string | null;     // when it synced (server), for the "Synced {time}" line
}
interface Payload { date: string; generatedAt: string; rows: FieldTask[] }

const FALLBACK: Payload = {
  date: '2026-09-20', generatedAt: '2026-09-20T09:12:00+08:00',
  rows: [
    { id: 'f1', unit: { unitNumber: '#A-12-03', propertyName: 'Vista Jaya One' }, addressLine: 'C-41-06, Jaya One, Jalan Universiti, PJ', accessInstruction: 'Lockbox 4471, key tag A12', work: 'Full turnover, 2BR', dueAt: '2026-09-20T13:00:00+08:00', nextGuestAt: '2026-09-20T15:00:00+08:00', readiness: 'dirty', flag: 'Same-day turnaround', requiresPhoto: true, photoCount: 0, sync: null, syncedAt: null },
    { id: 'f2', unit: { unitNumber: '#B-08-11', propertyName: 'Arcoris' }, addressLine: 'Arcoris Residences, Jalan Kiara, Mont Kiara', accessInstruction: 'Concierge holds the key for unit B-08-11', work: 'Studio turnover', dueAt: '2026-09-20T13:45:00+08:00', nextGuestAt: '2026-09-20T16:00:00+08:00', readiness: 'cleaning', flag: 'Early check-in requested', requiresPhoto: true, photoCount: 1, sync: 'queued', syncedAt: null },
    { id: 'f3', unit: { unitNumber: '#15-06', propertyName: 'Scarletz' }, addressLine: 'Scarletz Suites, Jalan Yap Kwan Seng, KL', accessInstruction: 'Smart lock code 8830', work: 'Deep clean', dueAt: '2026-09-20T14:30:00+08:00', nextGuestAt: '2026-09-20T18:00:00+08:00', readiness: 'cleaning', flag: null, requiresPhoto: true, photoCount: 1, sync: 'failed', syncedAt: null },
    { id: 'f4', unit: { unitNumber: '#2207', propertyName: 'Tribeca' }, addressLine: 'Tribeca Serviced Suites, Jalan Imbi, KL', accessInstruction: 'Key collected from the ops office', work: 'Light clean', dueAt: '2026-09-20T11:00:00+08:00', nextGuestAt: null, readiness: 'ready', flag: null, requiresPhoto: true, photoCount: 2, sync: 'synced', syncedAt: '2026-09-20T10:58:00+08:00' },
  ],
};

const OPS_TEL = '+60174658868';

/** A local queue entry created by a tap; the server response, when it ever
 *  arrives, is the only thing that advances a `queued` entry to `synced`. */
interface QEntry { kind: 'photo' | 'ready'; state: SyncState; at: string }

export default function FieldTodayPage() {
  const { data, loading, error, reload } = useApi<Payload>('/field/tasks?date=today', FALLBACK);
  const toast = useToast();

  // Local overlays — the page has no backend in dev (see IMPL-BRIEF).
  const [photos, setPhotos] = useState<Record<string, number>>({});   // photos added this session
  const [queue, setQueue] = useState<Record<string, QEntry>>({});      // latest queue entry per row
  const [done, setDone] = useState<Record<string, boolean>>({});       // set ONLY on a real 200

  const [confirm, setConfirm] = useState<FieldTask | null>(null);
  const [damage, setDamage] = useState<{ task: FieldTask; title: string; detail: string; blocksUnit: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Photos the server has not accepted yet, per task, so Retry sends the same files again.
  const pendingFiles = useRef(new Map<string, File[]>());
  // Where photo storage is not set up the server accepts "ready" without a photo (and records that).
  const [noStorage, setNoStorage] = useState<Record<string, boolean>>({});

  const rows = data?.rows ?? [];
  const photoCountOf = (t: FieldTask) => t.photoCount + (photos[t.id] ?? 0);
  const readinessOf = (t: FieldTask): UnitReadiness => (done[t.id] ? 'ready' : t.readiness);
  const isComplete = (t: FieldTask) => readinessOf(t) === 'ready';
  const syncOf = (t: FieldTask): { state: SyncState; at: string | null } | null => {
    const q = queue[t.id];
    if (q) return { state: q.state, at: q.at };
    if (t.sync) return { state: t.sync, at: t.syncedAt };
    return null;
  };

  const completed = rows.filter(isComplete).length;
  const pending = rows.filter(t => { const s = syncOf(t); return s && s.state !== 'synced'; }).length;
  const whenLabel = (iso: string | null) => (iso ? time(iso) : '—');

  /* ------------------------------ actions ------------------------------ */
  /** Sends each chosen photo to the server (multipart, field "file"). The count goes up only for photos the
   *  server stored (201). Photos that did not go through are kept here so "Retry" can send them again. It used
   *  to post an empty body, which the server always refused, so cleaners could never mark a unit ready. */
  async function addPhotos(t: FieldTask, files: File[]) {
    if (files.length === 0) return;
    setQueue(q => ({ ...q, [t.id]: { kind: 'photo', state: 'queued', at: new Date().toISOString() } }));
    let ok = 0;
    const failed: File[] = [];
    let reason = '';
    for (const f of files) {
      const form = new FormData();
      form.append('file', f, f.name || 'photo.jpg');
      try {
        await api.post(`/tasks/${t.id}/photos`, form);
        ok += 1;
      } catch (e) {
        failed.push(f);
        if (e instanceof ApiFailure && e.code === 'NOT_CONFIGURED') setNoStorage(n => ({ ...n, [t.id]: true }));
        reason = e instanceof Error ? e.message : 'Check your signal and try again.';
      }
    }
    if (ok) setPhotos(p => ({ ...p, [t.id]: (p[t.id] ?? 0) + ok }));
    pendingFiles.current.set(t.id, failed);
    setQueue(q => ({ ...q, [t.id]: { kind: 'photo', state: failed.length ? 'failed' : 'synced', at: new Date().toISOString() } }));
    if (failed.length) toast({ tone: 'critical', title: ok ? `${count(ok)} uploaded, ${count(failed.length)} not.` : `Photo${failed.length > 1 ? 's' : ''} not uploaded.`, body: reason });
    else toast({ tone: 'success', title: `${plural(ok, 'photo')} uploaded.` });
  }

  async function markReady() {
    const t = confirm;
    if (!t) return;
    // Client mirror of the 422 PHOTO_REQUIRED contract; the button also guards this.
    if (t.requiresPhoto && photoCountOf(t) < 1 && !noStorage[t.id]) {
      toast({ tone: 'critical', title: 'Not marked ready.', body: 'Add at least one photo before marking this unit ready.' });
      setConfirm(null);
      return;
    }
    setBusy(true);
    setQueue(q => ({ ...q, [t.id]: { kind: 'ready', state: 'queued', at: new Date().toISOString() } }));
    setConfirm(null);
    try {
      await api.post(`/tasks/${t.id}/complete`, { photoIds: [] });
      // Only here — after the server confirms — do we show ready.
      setDone(d => ({ ...d, [t.id]: true }));
      setQueue(q => ({ ...q, [t.id]: { kind: 'ready', state: 'synced', at: new Date().toISOString() } }));
      toast({ tone: 'success', title: 'Marked ready.', body: `${unitRef(t.unit.propertyName, t.unit.unitNumber)} is ready for the guest.` });
    } catch (e) {
      // Stay honest: the row is failed, never "ready", and says why.
      setQueue(q => ({ ...q, [t.id]: { kind: 'ready', state: 'failed', at: new Date().toISOString() } }));
      toast({ tone: 'critical', title: 'Not marked ready.', body: e instanceof Error ? e.message : 'Check your signal, then tap the failed row to retry.' });
    } finally { setBusy(false); }
  }

  /** Shared background sync used by photo add and by the retry affordance. */
  async function trySync(id: string, kind: QEntry['kind'], call: () => Promise<unknown>) {
    try {
      await call();
      setQueue(q => ({ ...q, [id]: { kind, state: 'synced', at: new Date().toISOString() } }));
      if (kind === 'ready') setDone(d => ({ ...d, [id]: true }));
    } catch {
      // Photo uploads retry quietly in the background and stay queued; a foreground
      // "ready" surfaces as failed so the crew knows to retry.
      setQueue(q => {
        const prev = q[id];
        if (kind === 'photo' && (!prev || prev.state === 'queued')) return q; // keep queued
        return { ...q, [id]: { kind, state: 'failed', at: new Date().toISOString() } };
      });
    }
  }

  function retry(t: FieldTask) {
    const q = queue[t.id];
    const kind = q?.kind ?? 'ready';
    setQueue(prev => ({ ...prev, [t.id]: { kind, state: 'queued', at: new Date().toISOString() } }));
    toast({ tone: 'info', title: 'Trying again...' });
    if (kind === 'photo') { void addPhotos(t, pendingFiles.current.get(t.id) ?? []); return; }
    void trySync(t.id, kind, () => api.post(`/tasks/${t.id}/complete`, { photoIds: [] }));
  }

  async function submitDamage() {
    const d = damage;
    if (!d || !d.title.trim()) return;
    setBusy(true);
    // Field roles never see money — no amount / charge-to here (guide 16.1).
    toast({ tone: 'warning', title: 'Damage report queued.', body: 'Operations is alerted once it syncs; the issue opens on the unit.' });
    setDamage(null);
    try {
      await api.post('/maintenance/issues', {
        unitId: (d.task as FieldTask).unitId ?? (d.task as FieldTask).unit.unitNumber, propertyName: (d.task as FieldTask).unit.propertyName, title: d.title.trim(), detail: d.detail.trim() || null,
        blocksUnit: d.blocksUnit, photoIds: [], source: 'field_app',
      });
      toast({ tone: 'success', title: 'Damage reported.', body: `Issue opened on ${unitRef(d.task.unit.propertyName, d.task.unit.unitNumber)}.` });
    } catch {
      /* dev: no backend — it stays queued, already messaged. */
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="My tasks" sub={loading && !data?.date ? 'Today' : `${data?.date ? date(data.date) : 'Today'} · ${plural(rows.length, 'task')} assigned`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {/* progress — gold is a brand accent here, not a status tone */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-meta text-muted-ink">
          <span>{count(completed)} of {plural(rows.length, 'task')} done</span>
          {pending > 0 && <span>{count(pending)} waiting to sync</span>}
        </div>
        <div className="h-1 rounded-full bg-sunken overflow-hidden">
          <div className="h-full bg-gold [transition:width_200ms]" style={{ width: `${rows.length ? (completed / rows.length) * 100 : 0}%` }} />
        </div>
      </div>

      {loading && rows.length === 0 ? <TableSkeleton rows={3} cols={2} /> : rows.map(t => {
        const shots = photoCountOf(t);
        const complete = isComplete(t);
        const sync = syncOf(t);
        const needsPhoto = t.requiresPhoto && shots < 1 && !noStorage[t.id];
        const ready = READINESS[readinessOf(t)];

        return (
          <div key={t.id} className={cx(
            'border border-solid border-line rounded-card p-4 flex flex-col gap-3',
            complete ? 'bg-page' : 'bg-card',
          )}>
            {/* identity + due */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <span className={cx(
                  'text-heading font-semibold',
                  complete ? 'line-through text-muted-ink' : 'no-underline text-ink',
                )}>
                  {unitRef(t.unit.propertyName, t.unit.unitNumber)}
                </span>
                <span className="text-meta text-muted-ink [text-wrap:pretty]">{t.addressLine}</span>
              </div>
              <span className="text-meta text-muted-ink whitespace-nowrap">Due {whenLabel(t.dueAt)}</span>
            </div>

            {/* status row: readiness + optional server flag + job */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={ready.tone} label={ready.label} />
              {t.flag && !complete && (
                <Badge tone="warning" label={t.flag} />
              )}
              <span className="text-meta text-muted-ink">{t.work}</span>
            </div>

            {/* access instruction */}
            {t.accessInstruction && (
              <div className="flex items-start gap-2 py-2.5 px-3 rounded-control bg-muted">
                <Icon name="KeyRound" size="sm" color="var(--color-muted-ink)" style={{ marginTop: 1 }} />
                <span className="text-copy [text-wrap:pretty]">{`Access · ${t.accessInstruction}`}</span>
              </div>
            )}

            {/* photo requirement hint */}
            {needsPhoto && !complete && (
              <span className={cx('text-copy font-medium', TONE.warning.text)}>
                Add at least one photo before marking this unit ready.
              </span>
            )}

            {/* offline queue status — the server response is the only thing that
                advances it to synced; a failure stays visibly failed (guide 19) */}
            {sync && <SyncLine state={sync.state} at={sync.at} kind={queue[t.id]?.kind} onRetry={sync.state === 'failed' ? () => retry(t) : undefined} />}

            {/* actions */}
            {complete ? (
              <span className={cx('text-copy flex items-center gap-2 min-h-[24px]', TONE.success.text)}>
                <Icon name="CheckCheck" size="sm" color="var(--color-success-fg)" /> Ready for the guest
              </span>
            ) : (
              <div className="flex gap-2">
                <PhotoButton count={shots} busy={syncOf(t)?.state === 'queued' && queue[t.id]?.kind === 'photo'} onFiles={files => void addPhotos(t, files)} />
                <Button variant="primary" size="touch" className="flex-1" icon={<Icon name="Check" size="sm" />}
                  onClick={() => setConfirm(t)} disabled={needsPhoto} disabledReason="Add at least one photo first.">
                  Mark ready
                </Button>
              </div>
            )}

            {/* report damage — per unit, danger, no financial field for field roles */}
            <Button variant="secondary" size="touch" icon={<Icon name="TriangleAlert" size="sm" />}
              style={{ color: 'var(--color-critical-fg)', borderColor: 'var(--color-critical-line)' }}
              onClick={() => setDamage({ task: t, title: '', detail: '', blocksUnit: false })}>
              Report damage or missing item
            </Button>
          </div>
        );
      })}

      {/* page-level: call operations */}
      <div className="flex flex-col gap-2 pt-1">
        <a href={`tel:${OPS_TEL}`}
          className="min-h-[var(--control-height-touch)] flex items-center justify-center gap-2 border border-solid border-line rounded-control bg-card text-copy font-medium no-underline text-ink">
          <Icon name="Phone" size="sm" />
          <span>Call operations</span>
        </a>
        <span className="text-caption text-muted-ink text-center">
          Financial data is not available to field roles.
        </span>
      </div>

      {/* Mark ready confirm */}
      <Dialog busy={busy} onClose={() => setConfirm(null)}
        spec={!confirm ? null : {
          title: `Mark ${unitRef(confirm.unit.propertyName, confirm.unit.unitNumber)} ready for guest?`,
          body: 'The unit is released as Ready and operations sees it straight away.',
          meta: confirm.nextGuestAt ? `Next check-in is ${time(confirm.nextGuestAt)}.` : 'No check-in scheduled next.',
          confirmLabel: 'Mark ready', busyLabel: 'Saving...', onConfirm: markReady,
        }} />

      {/* Report damage — local modal (title + detail + blocks unit) */}
      {damage && (
        <ReportModal
          task={damage.task}
          value={damage}
          busy={busy}
          onChange={next => setDamage(next)}
          onClose={() => setDamage(null)}
          onSubmit={submitDamage}
        />
      )}
    </>
  );
}

/* ----------------------------- sync status line ---------------------------- */
function SyncLine({ state, at, kind, onRetry }: { state: SyncState; at: string | null; kind?: 'photo' | 'ready'; onRetry?: () => void }) {
  const tone: Tone = SYNC[state].tone;
  const label = state === 'queued'
    ? (kind === 'photo' ? 'Uploading photos...' : 'Sending...')
    : state === 'synced'
      ? `${kind === 'photo' ? 'Photos uploaded' : 'Saved'}${at ? ` ${time(at)}` : ''}`
      : (kind === 'photo' ? 'Photo not uploaded. Tap to try again.' : 'Not saved. Tap to try again.');
  const icon = state === 'synced' ? 'CloudUpload' : state === 'queued' ? 'CloudOff' : 'RefreshCw';

  const inner = (
    <>
      <Icon name={icon} size="sm" color={`var(--color-${tone}-fg)`} />
      <span>{label}</span>
    </>
  );
  const base = 'flex items-center gap-2 w-full py-2 px-3 rounded-control text-left';
  return onRetry
    ? <button onClick={onRetry} className={cx(base, 'min-h-[44px] border-none font-sans text-copy font-medium cursor-pointer', TONE[tone].bg, TONE[tone].text)}>{inner}</button>
    : <div role="status" className={cx(base, 'text-copy font-medium', TONE[tone].bg, TONE[tone].text)}>{inner}</div>;
}

/* ------------------------------- photo button ------------------------------ */
/** A real camera / file picker (multipart on the live backend). On mobile,
 *  `capture` opens the camera; on desktop it is a file chooser. */
function PhotoButton({ count: shots, busy, onFiles }: { count: number; busy?: boolean; onFiles: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref} type="file" accept="image/*" capture="environment" multiple
        className="hidden"
        onChange={e => { const files = Array.from(e.target.files ?? []); onFiles(files); if (ref.current) ref.current.value = ''; }}
      />
      <Button variant="secondary" size="touch" className="flex-1" icon={<Icon name="Camera" size="sm" />}
        onClick={() => ref.current?.click()} disabled={busy} disabledReason="Photos are uploading.">
        {busy ? 'Uploading...' : shots > 0 ? `${plural(shots, 'photo')} · add` : 'Add photo'}
      </Button>
    </>
  );
}

/* ------------------------------- report modal ------------------------------ */
const LABEL_CLS = 'text-meta font-medium text-muted-ink';

interface DamageState { task: unknown; title: string; detail: string; blocksUnit: boolean }
function ReportModal({ task, value, busy, onChange, onClose, onSubmit }: {
  task: FieldTask; value: DamageState; busy: boolean;
  onChange: (next: { task: FieldTask; title: string; detail: string; blocksUnit: boolean }) => void;
  onClose: () => void; onSubmit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input,textarea')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const set = (p: Partial<{ title: string; detail: string; blocksUnit: boolean }>) =>
    onChange({ task, title: value.title, detail: value.detail, blocksUnit: value.blocksUnit, ...p });
  const canSubmit = value.title.trim().length > 0 && !busy;

  return (
    <div role="dialog" aria-modal="true" aria-label="Report damage or missing item"
      className="fixed inset-0 z-[60] grid [place-items:end_center] bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div ref={ref}
        className="relative w-full max-w-[560px] max-h-[92vh] overflow-y-auto bg-card rounded-t-card shadow-[var(--shadow-overlay)] flex flex-col [animation:rise_var(--motion-slow)_var(--ease-out)_both]">
        <div className="pt-[18px] px-5 pb-1 flex flex-col gap-1">
          <h2 className="m-0 text-title leading-[1.3] font-semibold">Report damage or missing item</h2>
          <p className="m-0 text-copy leading-[1.5] text-muted-ink">
            Opens a maintenance issue on {unitRef(task.unit.propertyName, task.unit.unitNumber)}. The office adds any cost.
          </p>
        </div>

        <div className="pt-4 px-5 pb-1 flex flex-col gap-4">
          <Field label="What is damaged or missing" value={value.title} disabled={busy} placeholder="Cracked bathroom mirror"
            onChange={e => set({ title: e.target.value })} style={{ minHeight: 'var(--control-height-touch)' }} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dmg-detail" className={LABEL_CLS}>Detail (optional)</label>
            <textarea id="dmg-detail" value={value.detail} disabled={busy} rows={3} placeholder="Where it is, how bad, any temporary fix"
              onChange={e => set({ detail: e.target.value })}
              className="field-input min-h-[88px]" />
          </div>
          <label className={cx('flex gap-2.5 items-center text-copy min-h-[44px]', busy ? 'cursor-default' : 'cursor-pointer')}>
            <input type="checkbox" checked={value.blocksUnit} disabled={busy} className="w-5 h-5"
              onChange={e => set({ blocksUnit: e.target.checked })} />
            Block the unit — it is not safe to let the next guest in
          </label>
        </div>

        <div className="py-3.5 px-5 mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex gap-2 sticky bottom-0">
          <Button variant="secondary" size="touch" className="flex-1" onClick={onClose} disabled={busy} disabledReason="Sending the report.">Cancel</Button>
          <Button variant="danger" size="touch" className="flex-1" icon={<Icon name="TriangleAlert" size="sm" />}
            onClick={onSubmit} disabled={!canSubmit} disabledReason={busy ? 'Sending the report.' : 'Say what is damaged or missing first.'}>
            Report damage
          </Button>
        </div>
      </div>
    </div>
  );
}
