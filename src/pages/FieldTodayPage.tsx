import { useEffect, useRef, useState } from 'react';
import { TONE, cx } from '../lib/design-tokens';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { time, date, unitRef } from '../lib/format';
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
  function addPhotos(t: FieldTask, count: number) {
    if (count <= 0) return;
    setPhotos(p => ({ ...p, [t.id]: (p[t.id] ?? 0) + count }));
    setQueue(q => ({ ...q, [t.id]: { kind: 'photo', state: 'queued', at: new Date().toISOString() } }));
    // Not "uploaded" — queued. The upload flips to synced only on the server's 201.
    toast({ tone: 'info', title: `${count} photo${count > 1 ? 's' : ''} added.`, body: 'Queued · will upload when you are back online.' });
    void trySync(t.id, 'photo', () => api.post(`/tasks/${t.id}/photos`, {}));
  }

  async function markReady() {
    const t = confirm;
    if (!t) return;
    // Client mirror of the 422 PHOTO_REQUIRED contract; the button also guards this.
    if (t.requiresPhoto && photoCountOf(t) < 1) {
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
    } catch {
      // Dev: no backend. Stay honest — the row is queued/failed, never "ready".
      setQueue(q => ({ ...q, [t.id]: { kind: 'ready', state: 'failed', at: new Date().toISOString() } }));
      toast({ tone: 'critical', title: 'Not synced yet.', body: 'Mark ready is queued. Tap the failed row to retry when you have signal.' });
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
    toast({ tone: 'info', title: 'Retrying…', body: 'Sending the queued update again.' });
    const call = kind === 'photo'
      ? () => api.post(`/tasks/${t.id}/photos`, {})
      : () => api.post(`/tasks/${t.id}/complete`, { photoIds: [] });
    void trySync(t.id, kind, call);
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
        unitId: d.task.id, title: d.title.trim(), detail: d.detail.trim() || null,
        blocksUnit: d.blocksUnit, photoIds: [], source: 'field_app',
      });
      toast({ tone: 'success', title: 'Damage reported.', body: `Issue opened on ${unitRef(d.task.unit.propertyName, d.task.unit.unitNumber)}.` });
    } catch {
      /* dev: no backend — it stays queued, already messaged. */
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="My tasks" sub={`${date(data?.date ?? FALLBACK.date)} · ${rows.length} tasks assigned · offline queue supported`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {/* progress — gold is a brand accent here, not a status tone */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[12px] text-muted-ink">
          <span>{completed} of {rows.length} tasks done</span>
          {pending > 0 && <span>{pending} waiting to sync</span>}
        </div>
        <div className="h-1 rounded-[999px] bg-sunken overflow-hidden">
          <div className="h-full bg-gold [transition:width_200ms]" style={{ width: `${rows.length ? (completed / rows.length) * 100 : 0}%` }} />
        </div>
      </div>

      {loading && rows.length === 0 ? <TableSkeleton rows={3} cols={2} /> : rows.map(t => {
        const shots = photoCountOf(t);
        const complete = isComplete(t);
        const sync = syncOf(t);
        const needsPhoto = t.requiresPhoto && shots < 1;
        const ready = READINESS[readinessOf(t)];

        return (
          <div key={t.id} className={cx(
            'border border-solid border-line rounded-card p-4 flex flex-col gap-3',
            complete ? 'bg-page' : 'bg-card',
          )}>
            {/* identity + due */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-[3px] min-w-0 flex-1">
                <span className={cx(
                  'text-[15px] font-semibold',
                  complete ? 'line-through text-muted-ink' : 'no-underline text-ink',
                )}>
                  {unitRef(t.unit.propertyName, t.unit.unitNumber)}
                </span>
                <span className="text-[12px] text-muted-ink [text-wrap:pretty]">{t.addressLine}</span>
              </div>
              <span className="text-[12px] text-muted-ink whitespace-nowrap">Due {whenLabel(t.dueAt)}</span>
            </div>

            {/* status row: readiness + optional server flag + job */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={ready.tone} label={ready.label} />
              {t.flag && !complete && (
                <span className={cx('text-[11px] font-semibold py-[3px] px-[9px] rounded-[999px]', TONE.warning.text, TONE.warning.bg)}>
                  {t.flag}
                </span>
              )}
              <span className="text-[12px] text-muted-ink">{t.work}</span>
            </div>

            {/* access instruction */}
            {t.accessInstruction && (
              <div className="flex items-start gap-[9px] py-[11px] px-3 rounded-control bg-muted">
                <Icon name="KeyRound" size="sm" color="var(--color-muted-ink)" style={{ marginTop: 1 }} />
                <span className="text-[12.5px] [text-wrap:pretty]">{`Access · ${t.accessInstruction}`}</span>
              </div>
            )}

            {/* photo requirement hint */}
            {needsPhoto && !complete && (
              <span className={cx('text-[12.5px] font-medium', TONE.warning.text)}>
                Add at least one photo before marking this unit ready.
              </span>
            )}

            {/* offline queue status — the server response is the only thing that
                advances it to synced; a failure stays visibly failed (guide 19) */}
            {sync && <SyncLine state={sync.state} at={sync.at} onRetry={sync.state === 'failed' ? () => retry(t) : undefined} />}

            {/* actions */}
            {complete ? (
              <span className={cx('text-[12.5px] flex items-center gap-[7px] min-h-[24px]', TONE.success.text)}>
                <Icon name="CheckCheck" size="sm" color="var(--color-success-fg)" /> Ready for the guest
              </span>
            ) : (
              <div className="flex gap-[9px]">
                <PhotoButton count={shots} onFiles={n => addPhotos(t, n)} />
                <button
                  onClick={() => setConfirm(t)}
                  disabled={needsPhoto}
                  title={needsPhoto ? 'Add at least one photo first.' : undefined}
                  className={cx(
                    'flex-1 min-h-[44px] flex items-center justify-center gap-[7px] rounded-control border-none font-sans text-[13px] font-medium',
                    needsPhoto ? 'bg-sunken text-faint cursor-not-allowed' : 'bg-black text-white cursor-pointer',
                  )}>
                  <Icon name="Check" size="sm" />
                  <span>Mark ready</span>
                </button>
              </div>
            )}

            {/* report damage — per unit, danger, no financial field for field roles */}
            <button
              onClick={() => setDamage({ task: t, title: '', detail: '', blocksUnit: false })}
              className={cx(
                'min-h-[44px] flex items-center justify-center gap-[7px] border border-solid rounded-control bg-card cursor-pointer [font:inherit]',
                TONE.critical.border, TONE.critical.text,
              )}>
              <Icon name="TriangleAlert" size="sm" />
              <span>Report damage or missing item</span>
            </button>
          </div>
        );
      })}

      {/* page-level: call operations */}
      <div className="flex flex-col gap-[9px] pt-1">
        <a href={`tel:${OPS_TEL}`}
          className="min-h-[44px] flex items-center justify-center gap-[7px] border border-solid border-line rounded-control bg-card text-[13px] font-medium no-underline text-ink">
          <Icon name="Phone" size="sm" />
          <span>Call operations</span>
        </a>
        <span className="text-[11px] text-muted-ink text-center">
          Financial data is not available to field roles.
        </span>
      </div>

      {/* Mark ready confirm */}
      <Dialog busy={busy} onClose={() => setConfirm(null)}
        spec={!confirm ? null : {
          title: `Mark ${unitRef(confirm.unit.propertyName, confirm.unit.unitNumber)} ready for guest?`,
          body: 'The unit is released as Ready and operations sees it without a message. It stays queued until the server confirms.',
          meta: confirm.nextGuestAt ? `Next check-in is ${time(confirm.nextGuestAt)}.` : 'No check-in scheduled next.',
          confirmLabel: 'Mark ready', busyLabel: 'Queueing…', onConfirm: markReady,
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
function SyncLine({ state, at, onRetry }: { state: SyncState; at: string | null; onRetry?: () => void }) {
  const tone: Tone = SYNC[state].tone;
  const label = state === 'queued'
    ? 'Queued · will sync when you are back online'
    : state === 'synced'
      ? `Synced${at ? ` ${time(at)}` : ''}`
      : 'Failed to sync. Tap to retry.';
  const icon = state === 'synced' ? 'CloudUpload' : state === 'queued' ? 'CloudOff' : 'RefreshCw';

  const inner = (
    <>
      <Icon name={icon} size="sm" color={`var(--color-${tone}-fg)`} />
      <span>{label}</span>
    </>
  );
  // Shared visual chrome; font size/weight only apply to the div — the button's
  // `font: inherit` (last shorthand key in the original) resets it to 16px/400.
  const base = 'flex items-center gap-[7px] w-full py-[9px] px-[11px] rounded-control text-left';
  return onRetry
    ? <button onClick={onRetry} className={cx(base, 'min-h-[40px] border-none [font:inherit] cursor-pointer', TONE[tone].bg, TONE[tone].text)}>{inner}</button>
    : <div role="status" className={cx(base, 'text-[12.5px] font-medium', TONE[tone].bg, TONE[tone].text)}>{inner}</div>;
}

/* ------------------------------- photo button ------------------------------ */
/** A real camera / file picker (multipart on the live backend). On mobile,
 *  `capture` opens the camera; on desktop it is a file chooser. */
function PhotoButton({ count, onFiles }: { count: number; onFiles: (n: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref} type="file" accept="image/*" capture="environment" multiple
        className="hidden"
        onChange={e => { const n = e.target.files?.length ?? 0; onFiles(n); if (ref.current) ref.current.value = ''; }}
      />
      <button
        onClick={() => ref.current?.click()}
        className="flex-1 min-h-[44px] flex items-center justify-center gap-[7px] border border-solid border-line rounded-control bg-card cursor-pointer [font:inherit] text-ink">
        <Icon name="Camera" size="sm" />
        <span>{count > 0 ? `${count} photo${count > 1 ? 's' : ''} · add` : 'Add photo'}</span>
      </button>
    </>
  );
}

/* ------------------------------- report modal ------------------------------ */
const INPUT_BASE = 'block w-full box-border text-ink bg-card border border-solid border-line rounded-control outline-none [font:inherit]';
const LABEL_CLS = 'text-[12px] font-medium text-muted-ink';

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
        <div className="pt-[18px] px-[18px] pb-1 flex flex-col gap-[5px]">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold">Report damage or missing item</h2>
          <p className="m-0 text-[13px] leading-[1.5] text-muted-ink">
            Opens a maintenance issue on {unitRef(task.unit.propertyName, task.unit.unitNumber)}. The office adds any cost.
          </p>
        </div>

        <div className="pt-[14px] px-[18px] pb-1 flex flex-col gap-[14px]">
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="dmg-title" className={LABEL_CLS}>What is damaged or missing</label>
            <input id="dmg-title" value={value.title} disabled={busy} placeholder="Cracked bathroom mirror"
              onChange={e => set({ title: e.target.value })} className={cx(INPUT_BASE, 'min-h-[44px] py-0 px-3')} />
          </div>
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="dmg-detail" className={LABEL_CLS}>Detail (optional)</label>
            <textarea id="dmg-detail" value={value.detail} disabled={busy} rows={3} placeholder="Where it is, how bad, any temporary fix"
              onChange={e => set({ detail: e.target.value })}
              className={cx(INPUT_BASE, 'min-h-[88px] py-[10px] px-3 resize-y')} />
          </div>
          <label className={cx('flex gap-2.5 items-center text-[13px] min-h-[44px]', busy ? 'cursor-default' : 'cursor-pointer')}>
            <input type="checkbox" checked={value.blocksUnit} disabled={busy} className="w-5 h-5"
              onChange={e => set({ blocksUnit: e.target.checked })} />
            Block the unit — it is not safe to let the next guest in
          </label>
        </div>

        <div className="py-[14px] px-[18px] mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex gap-[9px] sticky bottom-0">
          <button onClick={onClose} disabled={busy}
            className={cx('flex-1 min-h-[44px] rounded-control border border-solid border-line bg-card [font:inherit] text-ink', busy ? 'cursor-default' : 'cursor-pointer')}>Cancel</button>
          <button onClick={onSubmit} disabled={!canSubmit}
            className={cx(
              'flex-1 min-h-[44px] flex items-center justify-center gap-[7px] rounded-control border-none font-sans text-[13px] font-medium',
              canSubmit ? 'bg-[var(--color-critical-line)] text-white cursor-pointer' : 'bg-sunken text-faint cursor-not-allowed',
            )}>
            <Icon name="TriangleAlert" size="sm" />
            <span>Report damage</span>
          </button>
        </div>
      </div>
    </div>
  );
}
