import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { AttachmentLabel, MediaGallery } from '../components/Attachments';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { useNow } from '../lib/useMedia';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import {
  TimeLeft, KIND_LABEL, uploadTo, ReportDamageModal, Segmented, hm, dayLabel, mytDay, type MediaItem,
} from '../components/ops/OpsUi';
import { StatusBadge } from '../components/StatusBadge';
import { sizeLine } from '../lib/unitSize';

/* GET /api/field/tasks (functions/api/field/tasks.ts) */
interface Job {
  id: string; unitId: string; kind: string; state: string; unit: { unitNumber: string; propertyName: string; size?: string | null; layout?: string | null }; team?: string[]; buildingId: string;
  addressLine: string; accessInstruction: string | null; work: string; instructions: string | null; day: string; startedAt: string | null; completedAt: string | null; readiness: string; done: boolean;
  photoCount: number; checklist: { done: number; total: number }; guestOut: boolean; guestLeftAuto?: boolean;
  external?: { address: string; clientName: string | null; clientPhone: string | null } | null;
  previous: { guestName: string; checkOutTime: string; state: string } | null;
  next: { guestName: string; checkInTime: string; checkInAt: string } | null;
}
interface Detail { media: MediaItem[]; access: { id: string; label: string; instruction: string }[]; parking?: string | null }

/** The cleaner's phone: today's jobs grouped by building, each with the guest leaving and arriving, the time left,
 *  and the steps: guest left, start, photos and videos, complete. One column, 44px targets. */
export default function FieldTodayPage() {
  const now = useNow(30000);
  const [pick, setPick] = useState<'today' | 'tomorrow'>('today');
  const date = pick === 'today' ? mytDay(0) : mytDay(1);
  const { data, loading, error, reload } = useApi<{ rows: Job[] }>(`/field/tasks?date=${date}`);
  const [open, setOpen] = useState<string | null>(null);
  const jobs = data?.rows ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; jobs: Job[] }>();
    for (const j of jobs) { const g = m.get(j.buildingId) ?? { name: j.unit.propertyName, jobs: [] }; g.jobs.push(j); m.set(j.buildingId, g); }
    // In each building: what is still to do first, the one the next guest reaches soonest at the top.
    const by = (j: Job) => `${j.done ? 1 : 0}${j.next?.checkInAt ?? '9'}${j.unit.unitNumber}`;
    for (const g of m.values()) g.jobs.sort((a, b) => by(a).localeCompare(by(b)));
    return [...m.entries()].sort((a, b) => (a[0] === 'external' ? 1 : 0) - (b[0] === 'external' ? 1 : 0) || a[1].name.localeCompare(b[1].name));
  }, [jobs]);
  const left = jobs.filter(j => !j.done).length;

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-title font-semibold">My jobs</h1>
          <div className="text-copy text-muted-ink">{dayLabel(date)} · {data ? `${left} to do, ${jobs.length - left} done` : 'Loading'}</div>
        </div>
        <Segmented label="Day" value={pick} onChange={setPick} options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }]} />
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={140} /><Skeleton height={140} /></>
        : jobs.length === 0 ? <EmptyState icon="Sparkles" title={`No jobs for you on ${dayLabel(date)}.`} body="New jobs appear here as soon as the office gives them to you." />
        : groups.map(([id, g]) => (
          <section key={id} className="flex flex-col gap-2">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-baseline gap-2">{g.name}<span className="text-meta text-muted-ink font-normal tabular-nums">{g.jobs.filter(j => j.done).length} of {g.jobs.length} done</span></h2>
            {g.jobs.map(j => <JobCard key={j.id} job={j} now={now} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} onChanged={reload} />)}
          </section>
        ))}
      {/* Room under the last card for the pinned job button. */}
      {jobs.some(j => j.id === open && !j.done) && <div aria-hidden className="h-24 flex-none" />}
    </>
  );
}

function JobCard({ job: j, now, open, onToggle, onChanged }: { job: Job; now: number; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [damage, setDamage] = useState(false);
  const detail = useApi<Detail>(open ? `/housekeeping/tasks/${j.id}` : null);
  const [confirm, ask] = useConfirm();
  const files = detail.data?.media.length ?? j.photoCount;
  const isClean = ['turnover', 'deep_clean', 'light_clean'].includes(j.kind);
  // Not started, started without proof, started with proof, finished. The server's state and photo count decide it.
  const phase = j.done ? 'done' : j.state !== 'in_progress' ? 'todo' : files > 0 ? 'proof' : 'started';

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok }); onChanged(); detail.reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Check your signal and try again.') }); }
    finally { setBusy(null); }
  }
  async function remove(m: MediaItem) {
    const ok = await ask({ title: `Remove this ${m.kind === 'video' ? 'video' : 'photo'}?`, body: 'It is deleted from the job. You can take another one.', confirmLabel: 'Remove', danger: true });
    if (ok === null) return;
    void act('remove', () => api.del(`/tasks/${j.id}/photos/${m.id}`), m.kind === 'video' ? 'Video removed.' : 'Photo removed.');
  }
  const status = j.done ? <StatusBadge tone="success">Done</StatusBadge> : j.state === 'in_progress' ? <StatusBadge tone="info">In progress</StatusBadge>
    : j.guestOut ? <StatusBadge tone="gold">Guest out, ready to clean</StatusBadge> : j.previous ? <StatusBadge tone="neutral">Guest still in</StatusBadge> : <StatusBadge tone="warning">To do</StatusBadge>;

  return (
    <article className={cx('bg-card rounded-card border border-solid overflow-hidden', open ? 'border-gold' : 'border-line')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left p-4 flex flex-col gap-2 cursor-pointer">
        <div className="flex items-center gap-2">
          <b className="text-heading flex-1">{j.unit.unitNumber}<span className="text-copy text-muted-ink font-normal"> · {isClean ? `${KIND_LABEL[j.kind] ?? j.kind} clean` : j.work}</span></b>
          {status}
        </div>
        {(j.unit.size || j.unit.layout || (j.team && j.team.length > 0)) && (
          <div className="text-meta text-muted-ink flex flex-wrap gap-x-2">
            {(j.unit.size || j.unit.layout) && <span>{sizeLine(j.unit.size, j.unit.layout)}</span>}
            {j.team && j.team.length > 0 && <span className="text-ink">With {j.team.join(', ')}</span>}
          </div>
        )}
        {j.external ? (
          <div className="rounded-control bg-muted px-2.5 py-2 text-copy"><span className="block text-meta text-muted-ink">External job</span><b>{j.external.address}</b>{j.external.clientName ? ` · ${j.external.clientName}` : ''}</div>
        ) : (
        <div className="grid grid-cols-2 gap-2 text-copy">
          <div className="rounded-control bg-muted px-2.5 py-2"><span className="block text-meta text-muted-ink">Leaving</span>{j.previous ? <><b>{j.previous.checkOutTime}</b> {j.previous.guestName}</> : <span className="text-muted-ink">No departing guest</span>}
            {j.guestOut && j.guestLeftAuto && <span className="block text-meta text-gold-ink">Out at checkout time</span>}</div>
          <div className="rounded-control bg-gold-tint px-2.5 py-2"><span className="block text-meta text-muted-ink">Arriving</span>{j.next ? <><b>{j.next.checkInTime}</b> {j.next.guestName}</> : <span className="text-muted-ink">No check-in</span>}</div>
        </div>
        )}
        {!j.done && (
          <div className="flex items-center gap-2 flex-wrap text-copy">
            {j.next ? <><span>Finish by <b className="tabular-nums">{j.next.checkInTime}</b></span><span className="text-muted-ink">·</span><span><TimeLeft at={j.next.checkInAt} now={now} />{Date.parse(j.next.checkInAt) > now ? ' left' : ''}</span></>
              : <span className="text-muted-ink">No guest arriving after this clean.</span>}
            {j.day < mytDay(0) && <StatusBadge tone="warning">From {dayLabel(j.day)}</StatusBadge>}
          </div>
        )}
        {j.instructions && <div className="text-copy rounded-control bg-warning-bg text-ink px-2.5 py-2"><span className="block text-meta text-muted-ink">From the office</span>{j.instructions}</div>}
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4 [border-top:1px_solid_var(--color-line-soft)] pt-3">
          {(detail.data?.access.length ? detail.data.access : j.accessInstruction ? [{ id: 'a', label: 'Access', instruction: j.accessInstruction }] : []).map(a => (
            <div key={a.id} className="rounded-control bg-muted p-2.5 text-copy"><b>{a.label}</b><div className="text-muted-ink">{a.instruction}</div></div>
          ))}
          {detail.data?.parking && <div className="rounded-control bg-muted p-2.5 text-copy"><b>Car park</b><div className="text-muted-ink">{detail.data.parking}</div></div>}
          {j.addressLine && <div className="text-meta text-muted-ink">{j.addressLine}</div>}

          {!j.done && j.previous && !j.guestOut && (
            <Button size="touch" variant="secondary" loading={busy === 'left'} onClick={() => void act('left', () => api.post('/housekeeping/guest-left', { taskId: j.id }), 'Guest out. Ready to clean.')}>Guest left</Button>
          )}

          {phase === 'done' && (
            <div role="status" className="rounded-control bg-success-bg p-3 flex items-start gap-2.5 text-copy">
              <Icon name="CircleCheck" size="base" color="var(--color-success-line)" />
              <span><b>Job complete{j.completedAt ? ` at ${hm(j.completedAt)}` : ''}.</b>{j.startedAt ? ` Started ${hm(j.startedAt)}.` : ''}
                <span className="block text-meta text-muted-ink">Proof of work is locked. Ask the office if something needs changing.</span></span>
            </div>
          )}

          {/* Proof only once the job is started: photos taken before the start would not prove the finished work. */}
          {phase !== 'todo' && (
            <section className="flex flex-col gap-2">
              {j.startedAt && phase !== 'done' && <span className="text-meta text-muted-ink">Started {hm(j.startedAt)}</span>}
              <AttachmentLabel title="Proof of work" count={files} hint={
                phase === 'started' ? <StatusBadge tone="warning">1 photo or video required</StatusBadge>
                  : phase === 'proof' ? <StatusBadge tone="success"><span className="inline-flex items-center gap-1">Proof attached<Icon name="Check" size="sm" style={{ width: 13, height: 13 }} /></span></StatusBadge>
                  : undefined} />
              {detail.data ? <MediaGallery items={detail.data.media} upload={j.done ? undefined : uploadTo(`/tasks/${j.id}/photos`)} onDone={() => { detail.reload(); onChanged(); }}
                onRemove={j.done ? undefined : m => void remove(m)} addLabel="Take or add photo" emptyText="No photos were added." />
                : <Skeleton height={84} />}
            </section>
          )}

          {!j.external && <Button size="touch" variant="secondary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>Report damage</Button>}
        </div>
      )}

      {/* One action at a time, pinned above the phone's home bar. data-action-bar lifts the staging View as switch above it (ViewAs.tsx). */}
      {open && phase !== 'done' && (
        <div data-action-bar className="fixed inset-x-0 bottom-0 z-50 bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="max-w-[528px] mx-auto flex flex-col gap-1.5">
            {phase === 'todo' ? (
              <Button size="touch" variant="primary" loading={busy === 'start'}
                onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${j.id}/start`, {}), `Started at ${hm(new Date().toISOString())}.`)}>
                Start job
              </Button>
            ) : (
              <Button size="touch" variant="primary" loading={busy === 'done'} disabled={phase === 'started' || busy === 'remove'}
                onClick={() => void act('done', () => api.post(`/tasks/${j.id}/complete`, { photoIds: detail.data?.media.map(m => m.id) ?? [] }), `${j.unit.unitNumber} done. Thank you.`)}>
                {phase === 'started' ? 'Upload photo to complete' : 'Mark complete'}
              </Button>
            )}
            <span className="text-meta text-muted-ink text-center" aria-live="polite">
              <b className="text-ink">{j.unit.unitNumber}</b> · {phase === 'todo' ? 'Not started yet' : phase === 'started' ? 'Upload proof of work to complete' : 'Proof attached, ready to finish'}
            </span>
          </div>
        </div>
      )}
      {confirm}
      {damage && <ReportDamageModal unitId={j.unitId} unitLabel={`${j.unit.propertyName} ${j.unit.unitNumber}`} taskId={j.id} onClose={() => setDamage(false)}
        onDone={() => { setDamage(false); toast({ tone: 'success', title: 'Damage reported.', body: 'The office has it as a maintenance job.' }); }} />}
    </article>
  );
}
