import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { AttachmentLabel, MediaGallery } from '../components/Attachments';
import { Drawer } from '../components/Dialog';
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
import { plural } from '../lib/format';

/** Days a job is past its day, 0 when it is today's or later. */
const daysLate = (day: string) => Math.max(0, Math.round((Date.parse(mytDay(0)) - Date.parse(day)) / 864e5));
/** Google Maps search for an address, for the drive there. */
const mapsLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

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

/** The cleaner's phone: today's jobs grouped by building as short cards to scan. Tapping one opens TaskDetail with the
 *  access, the office's notes and the steps: guest left, start, photos and videos, complete. One column, 44px targets. */
export default function FieldTodayPage() {
  const now = useNow(30000);
  const [pick, setPick] = useState<'today' | 'tomorrow'>('today');
  const date = pick === 'today' ? mytDay(0) : mytDay(1);
  const { data, loading, error, reload } = useApi<{ rows: Job[] }>(`/field/tasks?date=${date}`);
  const [open, setOpen] = useState<string | null>(null);
  const jobs = data?.rows ?? [];
  const openJob = jobs.find(j => j.id === open) ?? null;
  useEffect(() => { if (open && data && !openJob) setOpen(null); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; jobs: Job[] }>();
    for (const j of jobs) { const g = m.get(j.buildingId) ?? { name: j.unit.propertyName, jobs: [] }; g.jobs.push(j); m.set(j.buildingId, g); }
    // In each building: what is still to do first, late jobs at the top, then the one the next guest reaches soonest.
    const by = (j: Job) => `${j.done ? 1 : 0}${daysLate(j.day) ? 0 : 1}${j.next?.checkInAt ?? '9'}${j.unit.unitNumber}`;
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
        <Segmented label="Day" className="[&>button]:h-11" value={pick} onChange={setPick} options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }]} />
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={140} /><Skeleton height={140} /></>
        : jobs.length === 0 ? <EmptyState icon="Sparkles" title={`No jobs for you on ${dayLabel(date)}.`} body="New jobs appear here as soon as the office gives them to you." />
        : groups.map(([id, g]) => (
          <section key={id} className="flex flex-col gap-2">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-baseline gap-2">{g.name}<span className="text-meta text-muted-ink font-normal tabular-nums">{g.jobs.filter(j => j.done).length} of {g.jobs.length} done</span></h2>
            {g.jobs.map(j => <TaskCard key={j.id} job={j} onOpen={() => setOpen(j.id)} />)}
          </section>
        ))}
      {/* The list stays mounted under the sheet, so closing it lands back at the same scroll position. */}
      <Drawer open={!!openJob} onClose={() => setOpen(null)}>
        {openJob && <TaskDetail key={openJob.id} job={openJob} now={now} onClose={() => setOpen(null)} onChanged={reload} />}
      </Drawer>
    </>
  );
}

const cleanName = (j: Job) => (['turnover', 'deep_clean', 'light_clean'].includes(j.kind) ? `${KIND_LABEL[j.kind] ?? j.kind} clean` : j.work);
const subtitle = (j: Job) => [cleanName(j), sizeLine(j.unit.size, j.unit.layout)].filter(Boolean).join(' · ');

function JobStatus({ job: j }: { job: Job }) {
  return <>
    {!j.done && daysLate(j.day) > 0 && <StatusBadge tone="critical" title={`${plural(daysLate(j.day), 'day')} late`}>Overdue</StatusBadge>}
    {j.done ? <StatusBadge tone="success">Done</StatusBadge> : j.state === 'in_progress' ? <StatusBadge tone="info">In progress</StatusBadge>
      : j.guestOut ? <StatusBadge tone="gold">Guest out, ready to clean</StatusBadge> : j.previous ? <StatusBadge tone="neutral">Guest still in</StatusBadge> : <StatusBadge tone="warning">To do</StatusBadge>}
  </>;
}

function MapLink({ address, className }: { address: string; className?: string }) {
  return (
    <a href={mapsLink(address)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      className={cx('min-h-11 inline-flex items-center gap-1.5 text-ink', className)}>
      <Icon name="MapPin" size="sm" /><span className="min-w-0 underline underline-offset-2 [overflow-wrap:anywhere]">{address}</span>
    </a>
  );
}

/** The list card: just enough to pick the next unit. Access, notes and every action are one tap away in TaskDetail. */
function TaskCard({ job: j, onOpen }: { job: Job; onOpen: () => void }) {
  const address = j.external?.address ?? j.addressLine;
  return (
    <article role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      className={cx('bg-card rounded-card border border-solid border-line px-4 pt-3.5 pb-1 flex flex-col gap-1 cursor-pointer outline-none focus-visible:border-gold active:bg-page', j.done && 'text-muted-ink')}>
      <div className="flex items-start gap-2">
        <b className="text-heading flex-1 min-w-0">{j.unit.unitNumber}<span className="text-copy text-muted-ink font-normal"> · {j.unit.propertyName}</span></b>
        <span className="flex items-center gap-1.5 flex-wrap justify-end"><JobStatus job={j} /></span>
      </div>
      <div className="text-copy">{subtitle(j)}</div>
      {!j.external && (
        <div className="text-copy text-muted-ink">
          Leaving: <span className="text-ink">{j.previous ? `${j.previous.checkOutTime} ${j.previous.guestName}` : 'No guest'}</span>
          <span className="mx-1.5">|</span>
          Arriving: <span className="text-ink">{j.next ? `${j.next.checkInTime} ${j.next.guestName}` : 'No check-in'}</span>
        </div>
      )}
      <div className="flex items-center gap-2 text-meta">
        {address ? <MapLink address={address} className="flex-1 min-w-0" /> : <span className="flex-1 min-h-11" />}
        <Icon name="ChevronRight" size="sm" color="var(--color-muted-ink)" />
      </div>
    </article>
  );
}

/** One job in full, in a sheet over the list: unit, access, the office's notes, guests, proof, and the actions pinned at the bottom. */
function TaskDetail({ job: j, now, onClose, onChanged }: { job: Job; now: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [damage, setDamage] = useState(false);
  const detail = useApi<Detail>(`/housekeeping/tasks/${j.id}`);
  const [confirm, ask] = useConfirm();
  const files = detail.data?.media.length ?? j.photoCount;
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
  // Door codes stay with the office (housekeeping/tasks/[id].ts never sends them to field staff): only the instructions show.
  const access = detail.data?.access.length ? detail.data.access : j.accessInstruction ? [{ id: 'a', label: 'Access', instruction: j.accessInstruction }] : [];
  const address = j.external?.address ?? j.addressLine;
  const h3 = 'm-0 text-meta font-semibold uppercase tracking-[0.08em] text-muted-ink';

  return (
    <>
      <div className="sticky top-0 z-[2] bg-black text-white px-2 py-2 flex items-center gap-2">
        <button type="button" onClick={onClose} aria-label="Back to my jobs"
          className="w-11 h-11 flex-none grid place-items-center rounded-control bg-transparent border-none text-white cursor-pointer"><Icon name="ArrowLeft" size="nav" /></button>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-semibold leading-tight truncate">{j.unit.unitNumber}</div>
          <div className="text-meta text-on-dark truncate">{j.unit.propertyName}</div>
        </div>
        <span className="flex items-center gap-1.5 flex-wrap justify-end pr-2"><JobStatus job={j} /></span>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-5 text-copy">
        <section className="flex flex-col gap-1">
          <h3 className={h3}>Unit</h3>
          <b className="text-heading">{j.unit.unitNumber} · {j.unit.propertyName}</b>
          <span>{subtitle(j)}</span>
          {j.team && j.team.length > 0 && <span>With {j.team.join(', ')}</span>}
          {j.external?.clientName && <span>{j.external.clientName}{j.external.clientPhone ? ` · ${j.external.clientPhone}` : ''}</span>}
          {address && <MapLink address={address} className="self-start" />}
        </section>

        {!j.external && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>Access</h3>
            {!detail.data && !access.length ? <Skeleton height={44} />
              : access.length === 0 ? <span className="text-muted-ink">No access details on this unit. Ask the office.</span>
              : access.map(a => <div key={a.id} className="rounded-control bg-muted p-3"><b>{a.label}</b><div className="text-muted-ink">{a.instruction}</div></div>)}
            {detail.data?.parking && <div className="rounded-control bg-muted p-3"><b>Car park</b><div className="text-muted-ink">{detail.data.parking}</div></div>}
          </section>
        )}

        {j.instructions && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>From the office</h3>
            <div className="rounded-control bg-warning-bg text-ink p-3 whitespace-pre-line">{j.instructions}</div>
          </section>
        )}

        {!j.external && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>Guests</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-control bg-muted px-2.5 py-2"><span className="block text-meta text-muted-ink">Leaving</span>{j.previous ? <><b>{j.previous.checkOutTime}</b> {j.previous.guestName}</> : <span className="text-muted-ink">No departing guest</span>}
                {j.guestOut && <span className="block text-meta text-gold-ink">{j.guestLeftAuto ? 'Out at checkout time' : 'Guest out'}</span>}</div>
              <div className="rounded-control bg-gold-tint px-2.5 py-2"><span className="block text-meta text-muted-ink">Arriving</span>{j.next ? <><b>{j.next.checkInTime}</b> {j.next.guestName}</> : <span className="text-muted-ink">No check-in</span>}</div>
            </div>
            {!j.done && (j.next
              ? <span>Finish by <b className="tabular-nums">{j.next.checkInTime}</b> · <TimeLeft at={j.next.checkInAt} now={now} />{Date.parse(j.next.checkInAt) > now ? ' left' : ''}</span>
              : <span className="text-muted-ink">No guest arriving after this clean.</span>)}
            {!j.done && daysLate(j.day) > 0 && <span className="text-danger">Overdue · {plural(daysLate(j.day), 'day')} late (from {dayLabel(j.day)}).</span>}
            {!j.done && j.previous && !j.guestOut && (
              <Button size="touch" variant="secondary" loading={busy === 'left'} onClick={() => void act('left', () => api.post('/housekeeping/guest-left', { taskId: j.id }), 'Guest out. Ready to clean.')}>Guest left</Button>
            )}
          </section>
        )}

        {phase === 'done' && (
          <div role="status" className="rounded-control bg-success-bg p-3 flex items-start gap-2.5">
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
      </div>

      {/* Pinned above the phone's home bar. data-action-bar lifts the staging View as switch above it (ViewAs.tsx). */}
      {(phase !== 'done' || !j.external) && (
        <div data-action-bar className="sticky bottom-0 z-[2] bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] flex flex-col gap-2">
          {phase === 'todo' ? (
            <Button size="touch" variant="primary" className="w-full" loading={busy === 'start'}
              onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${j.id}/start`, {}), `Started at ${hm(new Date().toISOString())}.`)}>
              Start job
            </Button>
          ) : phase !== 'done' && (
            <Button size="touch" variant="primary" className="w-full" loading={busy === 'done'} disabled={phase === 'started' || busy === 'remove'}
              onClick={() => void act('done', () => api.post(`/tasks/${j.id}/complete`, { photoIds: detail.data?.media.map(m => m.id) ?? [] }), `${j.unit.unitNumber} done. Thank you.`)}>
              {phase === 'started' ? 'Upload photo to complete' : 'Mark complete'}
            </Button>
          )}
          {!j.external && <Button size="touch" variant="secondary" className="w-full" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>Report damage</Button>}
        </div>
      )}
      {confirm}
      {damage && <ReportDamageModal unitId={j.unitId} unitLabel={`${j.unit.propertyName} ${j.unit.unitNumber}`} taskId={j.id} onClose={() => setDamage(false)}
        onDone={() => { setDamage(false); toast({ tone: 'success', title: 'Damage reported.', body: 'The office has it as a maintenance job.' }); }} />}
    </>
  );
}
