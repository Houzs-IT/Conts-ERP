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
  uploadTo, ReportDamageModal, Segmented, hm, mytDay, type MediaItem,
} from '../components/ops/OpsUi';
import { StatusBadge } from '../components/StatusBadge';
import { sizeLine } from '../lib/unitSize';
import { usePortalText, usePortalDates, wordFor, type PortalStrings } from '../lib/portalI18n';

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
export default function FieldTodayPage({ linkTask, onLinked }: { linkTask?: string | null; onLinked?: () => void }) {
  const now = useNow(30000);
  const toast = useToast();
  const t = usePortalText();
  const { weekday } = usePortalDates();
  const [pick, setPick] = useState<'today' | 'tomorrow'>('today');
  const date = pick === 'today' ? mytDay(0) : mytDay(1);
  const { data, loading, error, reload } = useApi<{ rows: Job[] }>(`/field/tasks?date=${date}`);
  // The office ticks the guest out on its board: the list catches up every minute and when the phone comes back to the app.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    const t = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null);
  const jobs = data?.rows ?? [];
  const openJob = jobs.find(j => j.id === open) ?? null;
  useEffect(() => { if (open && data && !openJob) setOpen(null); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // A notice tapped in the bell: open that job on its own day.
  useEffect(() => {
    if (!linkTask) return;
    let live = true;
    api.get<{ day?: string | null }>(`/housekeeping/tasks/${encodeURIComponent(linkTask)}`)
      .then(t => { if (!live) return; setPick(t.day === mytDay(1) ? 'tomorrow' : 'today'); setOpen(linkTask); })
      .catch(() => { if (live) toast({ tone: 'info', title: t.jobs.notOnList }); })
      .finally(() => { if (live) onLinked?.(); });
    return () => { live = false; };
  }, [linkTask]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; jobs: Job[] }>();
    for (const j of jobs) { const g = m.get(j.buildingId) ?? { name: j.unit.propertyName, jobs: [] }; g.jobs.push(j); m.set(j.buildingId, g); }
    // In each building: unfinished first, then by block, floor and unit (B-08-11, B-10-02, B-12-05) as the walk through
    // the building goes. Late jobs keep their Overdue badge and red border instead of jumping the queue.
    for (const g of m.values()) g.jobs.sort((a, b) => Number(a.done) - Number(b.done) || a.unit.unitNumber.localeCompare(b.unit.unitNumber, undefined, { numeric: true }));
    return [...m.entries()].sort((a, b) => (a[0] === 'external' ? 1 : 0) - (b[0] === 'external' ? 1 : 0) || a[1].name.localeCompare(b[1].name));
  }, [jobs]);
  const left = jobs.filter(j => !j.done).length;

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-title font-semibold">{t.jobs.title}</h1>
          <div className="text-copy text-muted-ink">{weekday(date)} · {data ? t.jobs.summary(left, jobs.length - left) : t.common.loading}</div>
        </div>
        <Segmented label={t.jobs.day} className="[&>button]:h-11" value={pick} onChange={setPick} options={[{ value: 'today', label: t.jobs.today }, { value: 'tomorrow', label: t.jobs.tomorrow }]} />
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={140} /><Skeleton height={140} /></>
        : jobs.length === 0 ? <EmptyState icon="Sparkles" title={t.jobs.none(weekday(date))} body={t.jobs.noneBody} />
        : groups.map(([id, g]) => (
          <section key={id} className="flex flex-col gap-2">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-baseline gap-2">{g.name}<span className="text-meta text-muted-ink font-normal tabular-nums">{t.jobs.groupDone(g.jobs.filter(j => j.done).length, g.jobs.length)}</span></h2>
            {g.jobs.map(j => <TaskCard key={j.id} job={j} onOpen={() => setOpen(j.id)} />)}
          </section>
        ))}
      {/* The list stays mounted under the sheet, so closing it lands back at the same scroll position. */}
      <Drawer open={!!openJob} onClose={() => setOpen(null)} labelledBy={openJob ? `task-title-${openJob.id}` : undefined}>
        {openJob && <TaskDetail key={openJob.id} job={openJob} now={now} onClose={() => setOpen(null)} onChanged={reload} />}
      </Drawer>
    </>
  );
}

const cleanName = (t: PortalStrings, j: Job) => (j.kind in t.jobs.clean ? wordFor(t.jobs.clean, j.kind) : j.work);
const subtitle = (t: PortalStrings, j: Job) => [cleanName(t, j), sizeLine(j.unit.size, j.unit.layout)].filter(Boolean).join(' · ');

/** Time left until the next guest: red under two hours, "guest due now" once past (OpsUi's TimeLeft in the portal's words). */
function TimeLeft({ at, now }: { at: string; now: number }) {
  const t = usePortalText();
  const min = Math.round((Date.parse(at) - now) / 60000);
  if (min <= 0) return <span className="text-danger font-semibold">{t.jobs.guestDueNow}</span>;
  return <span className={cx('tabular-nums', min < 120 ? 'text-danger font-semibold' : 'text-ink')}>{t.jobs.left(min < 60 ? t.common.mins(min) : t.common.hm(min))}</span>;
}

function JobStatus({ job: j }: { job: Job }) {
  const t = usePortalText();
  const s = t.jobs.status;
  return <>
    {!j.done && daysLate(j.day) > 0 && <StatusBadge tone="critical">{t.jobs.overdue(t.common.days(daysLate(j.day)))}</StatusBadge>}
    {j.done ? <StatusBadge tone="success">{s.done}</StatusBadge> : j.state === 'in_progress' ? <StatusBadge tone="info">{s.inProgress}</StatusBadge>
      : j.guestOut ? <StatusBadge tone="gold">{s.guestOutReady}</StatusBadge> : j.previous ? <StatusBadge tone="neutral">{s.guestIn}</StatusBadge> : <StatusBadge tone="warning">{s.toDo}</StatusBadge>}
  </>;
}

function MapLink({ address, className }: { address: string; className?: string }) {
  return (
    <a href={mapsLink(address)} target="_blank" rel="noopener noreferrer"
      className={cx('relative z-[1] min-h-11 inline-flex items-center gap-1.5 text-ink', className)}>
      <Icon name="MapPin" size="sm" /><span className="min-w-0 underline underline-offset-2 [overflow-wrap:anywhere]">{address}</span>
    </a>
  );
}

/** The list card: what a cleaner needs at the door (unit, size, access, the office's note, guests) and the next step.
 *  The building and its address are on the section header and in TaskDetail, not repeated on every card.
 *  The unit's button stretches over the whole card and only opens TaskDetail. Start job lives there, not here,
 *  so a tap while scrolling the list can never start a job by mistake. */
function TaskCard({ job: j, onOpen }: { job: Job; onOpen: () => void }) {
  const t = usePortalText();
  const late = !j.done && daysLate(j.day) > 0;
  const row = 'flex items-start gap-2 text-copy';
  return (
    <article className={cx('relative bg-card rounded-card border border-solid px-4 py-3.5 flex flex-col gap-2 has-[button:active]:bg-page', late ? 'border-danger-line' : 'border-line', j.done && 'text-muted-ink')}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left cursor-pointer after:absolute after:inset-0 after:rounded-card">
          <span className="block text-[20px] leading-tight font-bold tracking-[-0.01em] text-ink [overflow-wrap:anywhere]">{j.unit.unitNumber}</span>
          <span className="block text-copy text-muted-ink">{subtitle(t, j)}</span>
        </button>
        <Icon name="ChevronRight" size="sm" color="var(--color-muted-ink)" style={{ marginTop: 3, flex: 'none' }} />
      </div>
      {/* Badges get their own row: beside the title they took most of a phone's width and broke the unit number. */}
      <span className="flex items-center gap-1.5 flex-wrap"><JobStatus job={j} /></span>
      {!j.external && j.accessInstruction && (
        <div className={row}><Icon name="KeyRound" size="sm" color="var(--color-muted-ink)" style={{ marginTop: 3 }} /><span className="min-w-0 line-clamp-2">{j.accessInstruction}</span></div>
      )}
      {j.instructions && (
        <div className={cx(row, 'rounded-control bg-warning-bg text-ink px-2.5 py-2')}><Icon name="TriangleAlert" size="sm" color="var(--color-warning-fg)" style={{ marginTop: 3 }} /><span className="min-w-0 line-clamp-2">{j.instructions}</span></div>
      )}
      {!j.external && (
        <div className={cx(row, 'text-muted-ink')}>
          <Icon name="DoorOpen" size="sm" style={{ marginTop: 3 }} />
          <span className="min-w-0">{t.jobs.out}: <b className="text-ink font-medium">{j.previous ? `${j.previous.checkOutTime} ${j.previous.guestName}` : t.jobs.noneShort}</b>
            <span className="mx-1.5">|</span>{t.jobs.in}: <b className="text-ink font-medium">{j.next ? `${j.next.checkInTime} ${j.next.guestName}` : t.jobs.noneShort}</b></span>
        </div>
      )}
    </article>
  );
}

/** One job in full, in a sheet over the list: unit, access, the office's notes, guests, proof, and the actions pinned at the bottom. */
function TaskDetail({ job: j, now, onClose, onChanged }: { job: Job; now: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const t = usePortalText();
  const { weekday } = usePortalDates();
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
    catch (e) { toast({ tone: 'critical', title: t.jobs.notSaved, body: errorMessage(e, t.jobs.checkSignal) }); }
    finally { setBusy(null); }
  }
  async function remove(m: MediaItem) {
    const ok = await ask({ title: m.kind === 'video' ? t.jobs.removeVideo : t.jobs.removePhoto, body: t.jobs.removeBody, confirmLabel: t.jobs.remove, cancelLabel: t.jobs.keep, danger: true });
    if (ok === null) return;
    void act('remove', () => api.del(`/tasks/${j.id}/photos/${m.id}`), m.kind === 'video' ? t.jobs.videoRemoved : t.jobs.photoRemoved);
  }
  // Door codes stay with the office (housekeeping/tasks/[id].ts never sends them to field staff): only the instructions show.
  const access = detail.data?.access.length ? detail.data.access : j.accessInstruction ? [{ id: 'a', label: t.jobs.access, instruction: j.accessInstruction }] : [];
  const address = j.external?.address ?? j.addressLine;
  const h3 = 'm-0 text-meta font-semibold uppercase tracking-[0.08em] text-muted-ink';

  return (
    <>
      {/* Header and action bar sit outside the scrolling middle, so nothing scrolled into view can hide under them. */}
      <div className="flex-none bg-black text-white px-2 py-2 flex items-start gap-2">
        <button type="button" onClick={onClose} aria-label={t.jobs.back}
          className="w-11 h-11 flex-none grid place-items-center rounded-control bg-transparent border-none text-white cursor-pointer"><Icon name="ArrowLeft" size="nav" /></button>
        <div className="flex-1 min-w-0 py-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 pr-2">
          <div className="min-w-0 mr-auto">
            <div id={`task-title-${j.id}`} className="text-[17px] font-semibold leading-tight [overflow-wrap:anywhere]">{j.unit.unitNumber}</div>
            <div className="text-meta text-on-dark">{j.unit.propertyName}</div>
          </div>
          <span className="flex items-center gap-1.5 flex-wrap"><JobStatus job={j} /></span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 flex flex-col gap-5 text-copy">
        <section className="flex flex-col gap-1">
          <h3 className={h3}>{t.jobs.unit}</h3>
          <b className="text-heading">{j.unit.unitNumber} · {j.unit.propertyName}</b>
          <span>{subtitle(t, j)}</span>
          {j.team && j.team.length > 0 && <span>{t.jobs.with(j.team.join(', '))}</span>}
          {/* Basic clean unless the cleaner sees it needs a deep one (26 Oct 2026). */}
          {!j.done && !j.external && (j.kind === 'turnover' || j.kind === 'deep_clean') && (
            <Segmented label={t.jobs.cleaningType} className="mt-1 self-start [&>button]:h-11" value={j.kind}
              onChange={v => { if (busy !== 'kind' && v !== j.kind) void act('kind', () => api.patch(`/field/tasks/${j.id}/kind`, { kind: v }), t.jobs.changedTo(wordFor(t.jobs.clean, v))); }}
              options={[{ value: 'turnover', label: t.jobs.basicShort }, { value: 'deep_clean', label: t.jobs.deepShort }]} />
          )}
          {j.external?.clientName && <span>{j.external.clientName}{j.external.clientPhone ? ` · ${j.external.clientPhone}` : ''}</span>}
          {address && <MapLink address={address} className="self-start" />}
        </section>

        {!j.external && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>{t.jobs.access}</h3>
            {!detail.data && !access.length ? <Skeleton height={44} />
              : access.length === 0 ? <span className="text-muted-ink">{t.jobs.noAccess}</span>
              : access.map(a => <div key={a.id} className="rounded-control bg-muted p-3"><b>{a.label}</b><div className="text-muted-ink">{a.instruction}</div></div>)}
            {detail.data?.parking && <div className="rounded-control bg-muted p-3"><b>{t.jobs.carPark}</b><div className="text-muted-ink">{detail.data.parking}</div></div>}
          </section>
        )}

        {j.instructions && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>{t.jobs.fromOffice}</h3>
            <div className="rounded-control bg-warning-bg text-ink p-3 whitespace-pre-line">{j.instructions}</div>
          </section>
        )}

        {!j.external && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>{t.jobs.guests}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-control bg-muted px-2.5 py-2"><span className="block text-meta text-muted-ink">{t.jobs.leaving}</span>{j.previous ? <><b>{j.previous.checkOutTime}</b> {j.previous.guestName}</> : <span className="text-muted-ink">{t.jobs.noGuest}</span>}
                {j.guestOut && <span className="block text-meta text-gold-ink">{j.guestLeftAuto ? t.jobs.outAtCheckout : t.jobs.guestOut}</span>}</div>
              <div className="rounded-control bg-gold-tint px-2.5 py-2"><span className="block text-meta text-muted-ink">{t.jobs.arriving}</span>{j.next ? <><b>{j.next.checkInTime}</b> {j.next.guestName}</> : <span className="text-muted-ink">{t.jobs.noCheckIn}</span>}</div>
            </div>
            {!j.done && (j.next
              ? <span>{t.jobs.finishBy} <b className="tabular-nums">{j.next.checkInTime}</b> · <TimeLeft at={j.next.checkInAt} now={now} /></span>
              : <span className="text-muted-ink">{t.jobs.noArrival}</span>)}
            {!j.done && daysLate(j.day) > 0 && <span className="text-danger">{t.jobs.overdueFrom(t.common.days(daysLate(j.day)), weekday(j.day))}</span>}
            {!j.done && j.previous && !j.guestOut && (
              <Button size="touch" variant="secondary" loading={busy === 'left'} onClick={() => void act('left', () => api.post('/housekeeping/guest-left', { taskId: j.id }), t.jobs.guestLeftOk)}>{t.jobs.guestLeft}</Button>
            )}
          </section>
        )}

        {phase === 'done' && (
          <div role="status" className="rounded-control bg-success-bg p-3 flex items-start gap-2.5">
            <Icon name="CircleCheck" size="base" color="var(--color-success-line)" />
            <span><b>{t.jobs.complete(j.completedAt ? hm(j.completedAt) : null)}</b>{j.startedAt ? ` ${t.jobs.startedSentence(hm(j.startedAt))}` : ''}
              <span className="block text-meta text-muted-ink">{t.jobs.locked}</span></span>
          </div>
        )}

        {/* Proof only once the job is started: photos taken before the start would not prove the finished work. */}
        {phase !== 'todo' && (
          <section className="flex flex-col gap-2">
            {j.startedAt && phase !== 'done' && <span className="text-meta text-muted-ink">{t.jobs.startedLine(hm(j.startedAt))}</span>}
            <AttachmentLabel title={t.jobs.proof} count={files} hint={
              phase === 'started' ? <StatusBadge tone="warning">{t.jobs.proofRequired}</StatusBadge>
                : phase === 'proof' ? <StatusBadge tone="success"><span className="inline-flex items-center gap-1">{t.jobs.proofAttached}<Icon name="Check" size="sm" style={{ width: 13, height: 13 }} /></span></StatusBadge>
                : undefined} />
            {detail.data ? <MediaGallery items={detail.data.media} upload={j.done ? undefined : uploadTo(`/tasks/${j.id}/photos`)} onDone={() => { detail.reload(); onChanged(); }}
              onRemove={j.done ? undefined : m => void remove(m)} addLabel={t.jobs.addPhoto} emptyText={t.jobs.noPhotos} />
              : <Skeleton height={84} />}
          </section>
        )}
      </div>

      {/* Pinned above the phone's home bar. data-action-bar lifts the staging View as switch above it (ViewAs.tsx). */}
      {(phase !== 'done' || !j.external) && (
        <div data-action-bar className="flex-none bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] flex flex-col gap-2">
          {phase === 'todo' ? (
            <Button size="touch" variant="primary" className="w-full" loading={busy === 'start'}
              onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${j.id}/start`, {}), t.jobs.startedAt(hm(new Date().toISOString())))}>
              {t.jobs.start}
            </Button>
          ) : phase !== 'done' && (
            <Button size="touch" variant="primary" className="w-full" loading={busy === 'done'} disabled={phase === 'started' || busy === 'remove'}
              onClick={() => void act('done', () => api.post(`/tasks/${j.id}/complete`, { photoIds: detail.data?.media.map(m => m.id) ?? [] }), t.jobs.doneThanks(j.unit.unitNumber))}>
              {phase === 'started' ? t.jobs.uploadToComplete : t.jobs.markComplete}
            </Button>
          )}
          {!j.external && <Button size="touch" variant="danger" className="w-full" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>{t.jobs.reportDamage}</Button>}
        </div>
      )}
      {confirm}
      {damage && <ReportDamageModal unitId={j.unitId} unitLabel={`${j.unit.propertyName} ${j.unit.unitNumber}`} taskId={j.id} onClose={() => setDamage(false)}
        onDone={() => { setDamage(false); toast({ tone: 'success', title: t.jobs.damageReported, body: t.jobs.officeHasIt }); }} />}
    </>
  );
}
