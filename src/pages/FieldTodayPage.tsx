import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { AttachmentLabel } from '../components/Attachments';
import { Drawer } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { useNow } from '../lib/useMedia';
import { api, errorMessage } from '../lib/api';
import { runEach, skippedNote } from '../lib/bulk';
import { cx } from '../lib/design-tokens';
import { FormRow, INPUT, ReportDamageModal, Segmented, hm, mytDay, type MediaItem } from '../components/ops/OpsUi';
import { PhoneJobCard, PhoneJobList, PhoneStayTime } from '../components/ops/PhoneJobCard';
import { CleanProof, stageCounts } from '../components/ops/CleanProof';
import { StatusBadge } from '../components/StatusBadge';
import { sizeLine } from '../lib/unitSize';
import { sortForCleaner, sortBuildings, type CleanOrderInput } from '../lib/cleanOrder';
import { isCleanOverdue, daysPast } from '../lib/cleanOverdue';
import { cleanRowTone } from '../lib/cleanRowTone';
import { usePortalText, usePortalDates, wordFor, type PortalStrings } from '../lib/portalI18n';
import { useFieldRefresh, useFreshIds } from '../lib/fieldLive';

/** Days a job is past its day, 0 when it is today's or later. */
const daysLate = (day: string) => daysPast(day, Date.now());
/** Google Maps search for an address, for the drive there. */
const mapsLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/* GET /api/field/tasks (functions/api/field/tasks.ts) */
interface Job {
  id: string; unitId: string; kind: string; state: string; unit: { unitNumber: string; propertyName: string; size?: string | null; layout?: string | null }; team?: string[]; buildingId: string;
  addressLine: string; accessInstruction: string | null; work: string; instructions: string | null; day: string; startedAt: string | null; completedAt: string | null; readiness: string; done: boolean;
  photoCount: number; afterCount?: number; checklist: { done: number; total: number }; guestOut: boolean; guestLeftAt?: string | null; guestLeftAuto?: boolean;
  external?: { address: string; clientName: string | null; clientPhone: string | null } | null;
  previous: { guestName: string; checkOutTime: string; lateCheckOut?: boolean; state: string } | null;
  next: { guestName: string; checkInTime: string; checkInAt: string } | null;
  /** Nobody arrives on the job's day: the unit's next arrival on a later day. */
  nextLater?: { day: string; checkInTime: string } | null;
}
interface Detail { media: MediaItem[]; access: { id: string; label: string; instruction: string }[]; parking?: string | null }
interface ListPayload { rows: Job[]; open?: Job[]; team?: Job[]; mayPick?: boolean; date?: string }
interface CleanerGroup { name: string; jobs: Job[] }
type ListTab = 'ongoing' | 'all' | 'done' | 'team';

const CLEAN_TYPES = ['turnover', 'deep_clean', 'light_clean'] as const;
const unitKeyOf = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

function byCleaner(jobs: Job[]): CleanerGroup[] {
  const groups = new Map<string, CleanerGroup>();
  for (const job of jobs) {
    for (const name of job.team ?? []) {
      const group = groups.get(name.toLowerCase()) ?? { name, jobs: [] };
      group.jobs.push(job);
      groups.set(name.toLowerCase(), group);
    }
  }
  return [...groups.values()].sort((first, second) => first.name.localeCompare(second.name));
}

/** The cleaner's order (lib/cleanOrder), the same as the office's board: the arrival on the job's day, else the next one. */
const jobOrder = (j: Job): CleanOrderInput => ({
  checkIn: j.next?.checkInTime ?? j.nextLater?.checkInTime ?? null, checkInDay: j.next ? j.day : j.nextLater?.day ?? null, day: j.day,
  guestIn: !!j.previous && !j.guestOut && !j.done && j.state !== 'in_progress', checkOut: j.previous?.checkOutTime ?? null,
  done: j.done, building: j.unit.propertyName, unit: j.unit.unitNumber,
});
/** Overdue by the one rule (lib/cleanOverdue): not done at the next guest's check-in, or by the end of its day. */
const jobOverdue = (j: Job, now: number) => isCleanOverdue({ day: j.day, checkIn: j.next?.checkInTime ?? null, done: j.done }, now);
interface Group { id: string; name: string; jobs: Job[] }
/** One group per building, always A to Z (external jobs last) so the cleaner learns where each building is, each in the
 *  cleaner's order (owner, 2 Nov 2026). Recomputed from every answer, so a changed time re-sorts on the next refresh. */
function byBuilding(jobs: Job[]): Group[] {
  const m = new Map<string, Group>();
  for (const j of jobs) { const g = m.get(j.buildingId) ?? { id: j.buildingId, name: j.unit.propertyName, jobs: [] }; g.jobs.push(j); m.set(j.buildingId, g); }
  for (const g of m.values()) g.jobs = sortForCleaner(g.jobs, jobOrder);
  return sortBuildings([...m.values()], g => g.name, g => g.id === 'external');
}

/** The cleaner's phone: the same list as the Cleaning page on a phone (components/ops/PhoneJobCard). Tabs as on the
 *  repairs page: On-going, All (their jobs plus the day's cleans nobody has, to take), Done, Team (read-only). Their jobs
 *  in the cleaner's order (lib/cleanOrder), jobs left over from earlier days in an Overdue section above them. Tapping a job opens TaskDetail: access, the office's notes, guest left,
 *  start, Before and After photos, complete. One column, 44px targets. */
export default function FieldTodayPage({ linkTask, onLinked }: { linkTask?: string | null; onLinked?: () => void }) {
  const now = useNow(30000);
  const toast = useToast();
  const t = usePortalText();
  const { weekday } = usePortalDates();
  const [pick, setPick] = useState<'today' | 'tomorrow'>('today');
  const date = pick === 'today' ? mytDay(0) : mytDay(1);
  const { data, loading, error, reload } = useApi<ListPayload>(`/field/tasks?date=${date}`);
  // A new notice, or the phone coming back to the app, reloads the list now; a job that just arrived carries a New mark.
  useFieldRefresh(reload);
  // The office ticks the guest out or changes a time on its board: the list catches up every 30 seconds, as the board does,
  // and when the phone comes back to the app.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    const t = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<ListTab>('all');
  const [building, setBuilding] = useState('');
  const [cleanType, setCleanType] = useState('');
  const [unitSearch, setUnitSearch] = useState('');
  const [takingBuilding, setTakingBuilding] = useState<string | null>(null);
  const jobs = data?.rows ?? [];
  const fresh = useFreshIds([...jobs, ...(data?.open ?? [])].map(j => j.id), date, !!data && data.date === date);
  const openJob = [...jobs, ...(data?.open ?? [])].find(j => j.id === open) ?? null;
  const isOpenJobOffered = !!openJob && !jobs.some(j => j.id === openJob.id);
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
  const unitKey = unitKeyOf(unitSearch);
  const isShown = (j: Job): boolean => (!building || j.buildingId === building) && (!cleanType || j.kind === cleanType)
    && (!unitKey || unitKeyOf(j.unit.unitNumber ?? '').includes(unitKey));
  const mine = jobs.filter(isShown);
  const ongoing = mine.filter(j => !j.done);
  const finished = mine.filter(j => j.done);
  const pool = (data?.open ?? []).filter(isShown);
  const team = (data?.team ?? []).filter(isShown);
  const mineInTab = tab === 'ongoing' ? ongoing : tab === 'done' ? finished : tab === 'all' ? mine : [];
  const poolInTab = tab === 'all' ? pool : [];
  const overdue = byBuilding(mineInTab.filter(j => jobOverdue(j, now)));
  const day = byBuilding(mineInTab.filter(j => !jobOverdue(j, now)));
  const poolGroups = byBuilding(poolInTab);
  const overdueCount = overdue.reduce((n, g) => n + g.jobs.length, 0);
  const left = jobs.filter(j => !j.done).length;
  const buildingOptions = useMemo(() => {
    const byId = new Map([...(data?.rows ?? []), ...(data?.open ?? []), ...(data?.team ?? [])].map(j => [j.buildingId, j.unit.propertyName]));
    return [...byId].map(([id, name]) => ({ id, name })).sort((first, second) => first.name.localeCompare(second.name));
  }, [data]);
  const tabLabel = (name: string, count: number): ReactNode => (
    <span className="flex flex-col items-center">{name}<span className="text-meta text-muted-ink tabular-nums">{count}</span></span>
  );
  async function takeAll(group: Group) {
    setTakingBuilding(group.id);
    const result = await runEach(group.jobs, job => api.post(`/field/tasks/${job.id}/pick`, {}), job => job.unit.unitNumber);
    setTakingBuilding(null);
    toast({ tone: result.ok === 0 ? 'critical' : result.failed.length ? 'warning' : 'success', title: result.ok ? t.jobs.takenAll(result.ok) : t.jobs.noneTaken, body: skippedNote(result.failed) || undefined });
    reload();
    if (result.ok) setTab('ongoing');
  }
  const card = (j: Job) => <TaskCard key={j.id} job={j} now={now} fresh={fresh.has(j.id)} active={j.id === open} onOpen={() => setOpen(j.id)} />;
  const offerCard = (j: Job) => <TaskCard key={j.id} job={j} now={now} fresh={fresh.has(j.id)} active={j.id === open} offer onOpen={() => setOpen(j.id)} />;
  const groupHeading = (name: string, jobsInGroup: Job[]) => (
    <h2 className="m-0 px-1 text-[16px] font-semibold tracking-[-0.01em] flex items-baseline gap-2">{name}<span className="text-meta text-muted-ink font-normal tabular-nums">{t.jobs.groupDone(jobsInGroup.filter(j => j.done).length, jobsInGroup.length)}</span></h2>
  );
  const buildings = (gs: Group[]) => gs.map(g => (
    <section key={g.id} className="flex flex-col gap-2">
      {groupHeading(g.name, g.jobs)}
      <PhoneJobList label={g.name}>{g.jobs.map(card)}</PhoneJobList>
    </section>
  ));
  const offeredBuildings = (gs: Group[]) => gs.map(g => (
    <section key={g.id} className="flex flex-col gap-2">
      <h2 className="m-0 px-1 text-[16px] font-semibold tracking-[-0.01em] flex items-center gap-2">{g.name}<StatusBadge tone="gold" size="sm">{t.repairs.jobs(g.jobs.length)}</StatusBadge></h2>
      <PhoneJobList label={g.name}>{g.jobs.map(offerCard)}</PhoneJobList>
      <Button size="touch" variant="secondary" className="w-full" icon={<Icon name="Hand" size="sm" />} loading={takingBuilding === g.id}
        disabled={takingBuilding !== null && takingBuilding !== g.id} onClick={() => void takeAll(g)}>{t.jobs.takeAll(g.jobs.length)}</Button>
    </section>
  ));
  const isListEmpty = tab === 'team' ? team.length === 0 : mineInTab.length === 0 && poolInTab.length === 0;
  const emptyState = unitKey
    ? <EmptyState icon="Search" title={t.repairs.noUnitMatch(unitSearch.trim())} body={t.repairs.noUnitMatchBody} />
    : tab === 'team' ? <EmptyState icon="Users" title={t.jobs.noTeam} body={t.jobs.noTeamBody} />
    : tab === 'done' ? <EmptyState icon="Sparkles" title={t.jobs.noDone} />
    : <EmptyState icon="Sparkles" title={t.jobs.none(weekday(date))} body={tab === 'ongoing' && pool.length > 0 ? t.jobs.noneBodyPick : t.jobs.noneBody} />;

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-title font-semibold">{t.jobs.title}</h1>
          <div className="text-copy text-muted-ink">{weekday(date)} · {data ? t.jobs.summary(left, jobs.length - left) : t.common.loading}</div>
        </div>
        <Segmented label={t.jobs.day} className="[&>button]:h-11" value={pick} onChange={setPick} options={[{ value: 'today', label: t.jobs.today }, { value: 'tomorrow', label: t.jobs.tomorrow }]} />
        {data && (
          <Segmented label={t.jobs.which} value={tab} onChange={setTab}
            className="w-full grid grid-flow-col auto-cols-fr [&>button]:h-auto [&>button]:self-stretch [&>button]:min-h-11 [&>button]:px-1 [&>button]:py-1 [&>button]:whitespace-normal [&>button]:leading-tight"
            options={[
              { value: 'ongoing', label: tabLabel(t.jobs.ongoing, ongoing.length) },
              { value: 'all', label: tabLabel(t.jobs.all, mine.length + pool.length) },
              { value: 'done', label: tabLabel(t.jobs.done, finished.length) },
              ...(data.mayPick ? [{ value: 'team' as const, label: tabLabel(t.jobs.team, team.length) }] : []),
            ]} />
        )}
      </div>
      {data && (
        <FormRow label={t.repairs.unitSearch}>
          <input type="search" enterKeyHint="search" autoComplete="off" className={cx(INPUT, 'h-11 text-[16px]')} value={unitSearch}
            onChange={e => setUnitSearch(e.target.value)} placeholder={t.repairs.unitSearchPh} maxLength={40} />
        </FormRow>
      )}
      {buildingOptions.length > 1 && (
        <FormRow label={t.repairs.building}>
          <select className={cx(INPUT, 'h-11 text-[16px]')} value={building} onChange={e => setBuilding(e.target.value)}>
            <option value="">{t.repairs.allBuildings}</option>
            {buildingOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FormRow>
      )}
      {data && (
        <FormRow label={t.jobs.cleaningType}>
          <select className={cx(INPUT, 'h-11 text-[16px]')} value={cleanType} onChange={e => setCleanType(e.target.value)}>
            <option value="">{t.jobs.allTypes}</option>
            {CLEAN_TYPES.map(value => <option key={value} value={value}>{wordFor(t.jobs.clean, value)}</option>)}
          </select>
        </FormRow>
      )}
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={84} /><Skeleton height={84} /></>
        : isListEmpty ? emptyState
        : tab === 'team' ? byCleaner(team).map(cleaner => <CleanerCard key={cleaner.name.toLowerCase()} cleaner={cleaner} now={now} />)
        : <>
          {overdueCount > 0 && (
            <section aria-label={t.jobs.overdueTitle} className="flex-none rounded-card border border-solid border-danger-line bg-danger-bg flex flex-col">
              <header className="flex items-center gap-2 flex-wrap px-4 py-3">
                <h2 className="m-0 text-heading font-semibold text-critical">{t.jobs.overdueTitle}</h2>
                <StatusBadge tone="critical">{overdueCount}</StatusBadge>
                <span className="text-meta text-muted-ink">{t.jobs.overdueSub(overdueCount)}</span>
              </header>
              <div className="px-3 pb-3 flex flex-col gap-3">{buildings(overdue)}</div>
            </section>
          )}
          {day.length > 0 && (
            <>
              {overdueCount > 0 && <h2 className="m-0 px-1 mt-1 text-heading font-semibold">{pick === 'today' ? t.jobs.today : t.jobs.tomorrow}</h2>}
              {buildings(day)}
            </>
          )}
          {poolGroups.length > 0 && (
            <>
              <h2 className="m-0 px-1 mt-1 text-heading font-semibold flex items-center gap-2">{t.jobs.openToPick}<StatusBadge tone="gold">{poolInTab.length}</StatusBadge></h2>
              {offeredBuildings(poolGroups)}
            </>
          )}
        </>}
      {/* The list stays mounted under the sheet, so closing it lands back at the same scroll position. */}
      <Drawer open={!!openJob} onClose={() => setOpen(null)} labelledBy={openJob ? `task-title-${openJob.id}` : undefined}>
        {openJob && <TaskDetail key={openJob.id} job={openJob} now={now} offered={isOpenJobOffered} onClose={() => setOpen(null)} onChanged={reload} onTaken={() => setTab('ongoing')} />}
      </Drawer>
    </>
  );
}

const cleanName = (t: PortalStrings, j: Job) => (j.kind in t.jobs.clean ? wordFor(t.jobs.clean, j.kind) : j.work);

/** Time left until the next guest: red under two hours, "guest due now" once past (OpsUi's TimeLeft in the portal's words). */
function CleanerCard({ cleaner, now }: { cleaner: CleanerGroup; now: number }) {
  const t = usePortalText();
  const overdueCount = cleaner.jobs.filter(j => jobOverdue(j, now)).length;
  return (
    <details className={cx('group bg-card rounded-card border border-solid overflow-hidden flex-none', overdueCount ? 'border-danger-line' : 'border-line')}>
      <summary className="list-none [&::-webkit-details-marker]:hidden flex items-center gap-3 px-4 py-3 min-h-[56px] cursor-pointer hover:bg-muted">
        <span className="flex-1 min-w-0 flex flex-col gap-1.5">
          <b className="text-heading truncate flex items-center gap-2"><Icon name="UserRound" size="sm" />{cleaner.name}</b>
          <span className="flex gap-1.5 flex-wrap">
            <StatusBadge tone="neutral">{t.repairs.jobs(cleaner.jobs.length)}</StatusBadge>
            {overdueCount > 0 && <StatusBadge tone="critical">{t.jobs.overdueTitle} · {overdueCount}</StatusBadge>}
          </span>
        </span>
        <span className="text-muted-ink transition-transform duration-200 motion-reduce:transition-none group-open:rotate-180"><Icon name="ChevronDown" size="nav" /></span>
      </summary>
      <PhoneJobList label={cleaner.name} className="rounded-none border-x-0 border-b-0">
        {sortForCleaner(cleaner.jobs, jobOrder).map(j => <TaskCard key={j.id} job={j} now={now} fresh={false} active={false} showBuilding />)}
      </PhoneJobList>
    </details>
  );
}

function TimeLeft({ at, now }: { at: string; now: number }) {
  const t = usePortalText();
  const min = Math.round((Date.parse(at) - now) / 60000);
  if (min <= 0) return <span className="text-danger font-semibold">{t.jobs.guestDueNow}</span>;
  return <span className={cx('tabular-nums', min < 120 ? 'text-danger font-semibold' : 'text-ink')}>{t.jobs.left(min < 60 ? t.common.mins(min) : t.common.hm(min))}</span>;
}

function JobStatus({ job: j }: { job: Job }) {
  const s = usePortalText().jobs.status;
  return j.done ? <StatusBadge tone="success" size="sm">{s.done}</StatusBadge> : j.state === 'in_progress' ? <StatusBadge tone="info" size="sm">{s.inProgress}</StatusBadge>
    : j.guestOut ? <StatusBadge tone="gold" size="sm">{s.guestOutReady}</StatusBadge> : j.previous ? <StatusBadge tone="neutral" size="sm">{s.guestIn}</StatusBadge> : <StatusBadge tone="warning" size="sm">{s.toDo}</StatusBadge>;
}

function MapLink({ address, className }: { address: string; className?: string }) {
  return (
    <a href={mapsLink(address)} target="_blank" rel="noopener noreferrer"
      className={cx('relative z-[1] min-h-11 inline-flex items-center gap-1.5 text-ink', className)}>
      <Icon name="MapPin" size="sm" /><span className="min-w-0 underline underline-offset-2 [overflow-wrap:anywhere]">{address}</span>
    </a>
  );
}

/** When the departing guest really left (the tick's time), else the planned checkout. */
const outTime = (j: Job) => (j.guestOut && j.guestLeftAt ? hm(j.guestLeftAt) : j.previous?.checkOutTime);
/** What the board says when the system marked the guest out: "Auto at 11:00", "Auto at 13:00 (late checkout)". */
const autoAt = (t: PortalStrings, j: Job) => t.jobs.autoAt(outTime(j) ?? '', !!j.previous?.lateCheckOut);

/** The list card: the Cleaning page's phone card in the portal's words. Start job lives in TaskDetail, not here, so a
 *  tap while scrolling the list can never start a job by mistake. */
function TaskCard({ job: j, now, fresh, active, offer, showBuilding, onOpen }: { job: Job; now: number; fresh: boolean; active: boolean; offer?: boolean; showBuilding?: boolean; onOpen?: () => void }) {
  const t = usePortalText();
  const { short } = usePortalDates();
  const lateBy = j.done ? 0 : daysLate(j.day);
  const tone = offer ? null : cleanRowTone({ day: j.day, status: j.done ? 'done' : j.state === 'in_progress' ? 'cleaning' : 'waiting', guestOut: j.guestOut, checkOutTime: j.previous?.checkOutTime ?? null }, now);
  return (
    <PhoneJobCard title={j.unit.unitNumber} active={active} tone={tone} onSelect={onOpen}
      building={j.external ? [j.external.clientName, j.external.clientPhone].filter(Boolean).join(' · ') || undefined : showBuilding ? j.unit.propertyName : undefined}
      badges={<>{fresh && <StatusBadge tone="info" size="sm" label={t.jobs.newJob} />}{lateBy > 0 && <StatusBadge tone="critical" size="sm">{t.jobs.overdue(t.common.days(lateBy))}</StatusBadge>}</>}
      status={offer ? <StatusBadge tone="gold" size="sm">{t.jobs.openToPick}</StatusBadge> : <JobStatus job={j} />}
      out={j.external ? undefined : j.previous
        ? <PhoneStayTime label={t.jobs.out} time={outTime(j)} actual={j.guestOut} actualLabel={j.guestLeftAuto ? autoAt(t, j) : t.jobs.guestHasLeft} />
        : <PhoneStayTime label={t.jobs.noGuestLeaving} />}
      arrive={j.external ? undefined : j.next
        ? <PhoneStayTime label={t.jobs.in} time={j.next.checkInTime} aside={!j.done && <span className="text-meta whitespace-nowrap"><TimeLeft at={j.next.checkInAt} now={now} /></span>} />
        : j.nextLater ? <PhoneStayTime label={t.jobs.in} time={`${short(j.nextLater.day)} ${j.nextLater.checkInTime}`} />
        : <PhoneStayTime label={t.jobs.noCheckIn} />}
      note={j.instructions && (
        <div className="flex items-start gap-2 rounded-control bg-warning-bg text-ink px-2.5 py-1.5 text-meta">
          <Icon name="TriangleAlert" size="sm" color="var(--color-warning-fg)" style={{ marginTop: 1, flex: 'none' }} /><span className="min-w-0 line-clamp-2">{j.instructions}</span>
        </div>
      )} />
  );
}

/** One job in full, in a sheet over the list, laid out like the Cleaning page's job sheet: a black header, the type, the
 *  guests, the Before and After photos, door access and the office's notes, with the next step pinned at the bottom. */
function TaskDetail({ job: j, now, offered, onClose, onChanged, onTaken }: { job: Job; now: number; offered: boolean; onClose: () => void; onChanged: () => void; onTaken: () => void }) {
  const toast = useToast();
  const t = usePortalText();
  const { weekday } = usePortalDates();
  const [busy, setBusy] = useState<string | null>(null);
  const [damage, setDamage] = useState(false);
  // The server shows a clean's photos and access only to the cleaners on it (housekeeping/tasks/[id].ts), so a preview skips it.
  const detail = useApi<Detail>(offered ? null : `/housekeeping/tasks/${j.id}`);
  const [confirm, ask] = useConfirm();
  // Only After files are proof of work; a Before photo never unlocks Mark complete (owner, 2 Nov 2026).
  const files = detail.data ? stageCounts(detail.data.media).after : j.afterCount ?? j.photoCount;
  // Not started, started without proof, started with proof, finished. The server's state and photo count decide it.
  const phase = j.done ? 'done' : j.state !== 'in_progress' ? 'todo' : files > 0 ? 'proof' : 'started';
  // The server refuses a start while the departing guest is in (housekeeping/tasks/[id]/start.ts): Guest left comes first.
  const guestIn = !j.done && !!j.previous && !j.guestOut;
  const canChangeKind = !offered && !j.done && !j.external && (j.kind === 'turnover' || j.kind === 'deep_clean');

  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string): Promise<boolean> {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); onChanged(); detail.reload(); return true; }
    catch (e) { toast({ tone: 'critical', title: t.jobs.notSaved, body: errorMessage(e, t.jobs.checkSignal) }); return false; }
    finally { setBusy(null); }
  }
  async function take() {
    if (await act('take', () => api.post(`/field/tasks/${j.id}/pick`, {}), t.jobs.taken(j.unit.unitNumber), t.jobs.takenBody)) onTaken();
    else onChanged();
  }
  async function remove(m: MediaItem) {
    const ok = await ask({ title: m.kind === 'video' ? t.jobs.removeVideo : t.jobs.removePhoto, body: t.jobs.removeBody, confirmLabel: t.jobs.remove, cancelLabel: t.jobs.keep, danger: true });
    if (ok === null) return;
    void act('remove', () => api.del(`/tasks/${j.id}/photos/${m.id}`), m.kind === 'video' ? t.jobs.videoRemoved : t.jobs.photoRemoved);
  }
  // Door codes stay with the office (housekeeping/tasks/[id].ts never sends them to field staff): only the instructions show.
  const access = detail.data?.access.length ? detail.data.access : j.accessInstruction ? [{ id: 'a', label: t.jobs.access, instruction: j.accessInstruction }] : [];
  const address = j.external?.address ?? j.addressLine;
  const size = sizeLine(j.unit.size, j.unit.layout);
  const h3 = 'm-0 text-copy font-semibold';

  return (
    <>
      {/* Header and action bar sit outside the scrolling middle, so nothing scrolled into view can hide under them. */}
      <div className="flex-none bg-black text-white pl-2 pr-4 py-3 flex items-start gap-2">
        <button type="button" onClick={onClose} aria-label={t.jobs.back}
          className="w-11 h-11 flex-none grid place-items-center rounded-control bg-transparent border-none text-white cursor-pointer"><Icon name="ArrowLeft" size="nav" /></button>
        <div className="flex-1 min-w-0 flex flex-col gap-1 pt-0.5">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gold">{j.unit.propertyName}</div>
          <div id={`task-title-${j.id}`} className="text-[19px] leading-tight font-semibold [overflow-wrap:anywhere]">{j.unit.unitNumber} · {cleanName(t, j)}</div>
          {size && <div className="text-meta text-on-dark">{size}</div>}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {offered ? <StatusBadge tone="gold" size="sm">{t.jobs.openToPick}</StatusBadge> : <JobStatus job={j} />}
            {jobOverdue(j, now) && <StatusBadge tone="critical" size="sm">{daysLate(j.day) > 0 ? t.jobs.overdue(t.common.days(daysLate(j.day))) : t.jobs.overdueTitle}</StatusBadge>}
            {j.startedAt && phase !== 'done' && <span className="text-meta text-on-dark">{t.jobs.startedLine(hm(j.startedAt))}</span>}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 flex flex-col gap-4 text-copy">
        {(j.team?.length || canChangeKind || j.external) && (
          <section className="flex flex-col gap-1">
            {j.team && j.team.length > 0 && <span>{t.jobs.with(j.team.join(', '))}</span>}
            {/* Basic clean unless the cleaner sees it needs a deep one (26 Oct 2026). */}
            {canChangeKind && (
              <Segmented label={t.jobs.cleaningType} className="self-start [&>button]:h-11" value={j.kind}
                onChange={v => { if (busy !== 'kind' && v !== j.kind) void act('kind', () => api.patch(`/field/tasks/${j.id}/kind`, { kind: v }), t.jobs.changedTo(wordFor(t.jobs.clean, v))); }}
                options={[{ value: 'turnover', label: t.jobs.basicShort }, { value: 'deep_clean', label: t.jobs.deepShort }]} />
            )}
            {j.external?.clientName && <span>{j.external.clientName}{j.external.clientPhone ? ` · ${j.external.clientPhone}` : ''}</span>}
          </section>
        )}

        {!j.external && (
          <section className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-control bg-muted p-2.5 flex flex-col gap-0.5">
                <span className="text-meta text-muted-ink">{t.jobs.leaving}</span>
                {j.previous ? <><span><b className="tabular-nums">{outTime(j)}</b> {j.previous.guestName}</span>
                  {j.guestOut && <span className="text-meta text-gold-ink font-medium">{j.guestLeftAuto ? autoAt(t, j) : t.jobs.guestOut}</span>}</>
                  : <span className="text-muted-ink">{t.jobs.noGuest}</span>}
              </div>
              <div className="rounded-control bg-gold-tint p-2.5 flex flex-col gap-0.5">
                <span className="text-meta text-muted-ink">{t.jobs.arriving}</span>
                {j.next ? <><span><b className="tabular-nums">{j.next.checkInTime}</b> {j.next.guestName}</span>
                  {!j.done && <span className="text-meta"><TimeLeft at={j.next.checkInAt} now={now} /></span>}</>
                  : <span className="text-muted-ink">{t.jobs.noCheckIn}</span>}
              </div>
            </div>
            {!j.done && (j.next
              ? <span>{t.jobs.finishBy} <b className="tabular-nums">{j.next.checkInTime}</b></span>
              : <span className="text-muted-ink">{t.jobs.noArrival}</span>)}
            {!j.done && daysLate(j.day) > 0 && <span className="text-danger">{t.jobs.overdueFrom(t.common.days(daysLate(j.day)), weekday(j.day))}</span>}
            {!offered && guestIn && phase !== 'todo' && (
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

        {/* Photos only once the job is started: photos taken before the start would not prove the finished work. Uploading
            never completes the job; Mark complete in the bar below is its own tap (owner, 2 Nov 2026). */}
        {!offered && phase !== 'todo' && (detail.data
          ? <CleanProof taskId={j.id} unitLabel={`${j.unit.propertyName} ${j.unit.unitNumber}`} media={detail.data.media} done={j.done} onUploaded={() => { detail.reload(); onChanged(); }}
              onRemove={m => void remove(m)}
              hint={phase === 'started' ? <StatusBadge tone="warning">{t.jobs.proofRequired}</StatusBadge>
                : phase === 'proof' ? <StatusBadge tone="success"><span className="inline-flex items-center gap-1">{t.jobs.proofAttached}<Icon name="Check" size="sm" style={{ width: 13, height: 13 }} /></span></StatusBadge>
                : undefined}
              words={{ title: t.jobs.proof, beforeOrAfter: t.jobs.beforeOrAfter, before: t.jobs.before, after: t.jobs.after,
                addBefore: t.jobs.addBefore, addAfter: t.jobs.addAfter, noBefore: t.jobs.noBefore, noAfter: t.jobs.noAfter }} />
          : <section className="flex flex-col gap-2"><AttachmentLabel title={t.jobs.proof} count={files} /><Skeleton height={84} /></section>)}

        {j.instructions && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>{t.jobs.fromOffice}</h3>
            <div className="rounded-control bg-warning-bg text-ink p-3 whitespace-pre-line">{j.instructions}</div>
          </section>
        )}

        {!j.external && (
          <section className="flex flex-col gap-2">
            <h3 className={h3}>{t.jobs.access}</h3>
            {offered ? <span className="text-muted-ink">{t.jobs.accessOnTake}</span>
              : !detail.data && !access.length ? <Skeleton height={44} />
              : access.length === 0 ? <span className="text-muted-ink">{t.jobs.noAccess}</span>
              : access.map(a => <div key={a.id} className="rounded-control bg-muted p-2.5 flex flex-col gap-0.5"><b className="font-medium">{a.label}</b><span className="text-meta text-muted-ink">{a.instruction}</span></div>)}
            {detail.data?.parking && <span className="text-meta"><span className="text-muted-ink">{t.jobs.carPark}:</span> {detail.data.parking}</span>}
          </section>
        )}
        {address && <MapLink address={address} className="self-start" />}
      </div>

      {/* Pinned above the phone's home bar. data-action-bar lifts the staging View as switch above it (ViewAs.tsx). */}
      {(phase !== 'done' || !j.external) && (
        <div data-action-bar className="flex-none bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] flex flex-col gap-2">
          {offered ? (
            <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Hand" size="sm" />} loading={busy === 'take'} onClick={() => void take()}>
              {t.jobs.take}
            </Button>
          ) : phase === 'todo' && guestIn ? (
            <>
              <span className="text-meta text-muted-ink">{t.jobs.startAfterGuestLeft}</span>
              <Button size="touch" variant="primary" className="w-full" loading={busy === 'left'}
                onClick={() => void act('left', () => api.post('/housekeeping/guest-left', { taskId: j.id }), t.jobs.guestLeftOk)}>
                {t.jobs.guestLeft}
              </Button>
            </>
          ) : phase === 'todo' ? (
            <Button size="touch" variant="primary" className="w-full" loading={busy === 'start'}
              onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${j.id}/start`, {}), t.jobs.startedAt(hm(new Date().toISOString())))}>
              {t.jobs.start}
            </Button>
          ) : phase !== 'done' && (
            <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Check" size="sm" />} loading={busy === 'done'} disabled={phase === 'started' || busy === 'remove'}
              onClick={() => void act('done', () => api.post(`/tasks/${j.id}/complete`, { photoIds: detail.data?.media.map(m => m.id) ?? [] }), t.jobs.doneThanks(j.unit.unitNumber))}>
              {phase === 'started' ? t.jobs.uploadToComplete : t.jobs.markComplete}
            </Button>
          )}
          {!offered && !j.external && <Button size="touch" variant="danger" className="w-full" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>{t.jobs.reportDamage}</Button>}
        </div>
      )}
      {confirm}
      {damage && <ReportDamageModal unitId={j.unitId} unitLabel={`${j.unit.propertyName} ${j.unit.unitNumber}`} taskId={j.id} onClose={() => setDamage(false)}
        onDone={() => { setDamage(false); toast({ tone: 'success', title: t.jobs.damageReported, body: t.jobs.officeHasIt }); }} />}
    </>
  );
}
