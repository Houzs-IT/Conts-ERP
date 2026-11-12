import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { AttachmentLabel, MediaGallery, FileList, type MediaItem } from '../components/Attachments';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { runEach, skippedNote } from '../lib/bulk';
import { CATEGORY, FormRow, INPUT, TEXTAREA, ProblemPhotos, Segmented, hm, uploadTo, usePickedMedia } from '../components/ops/OpsUi';
import { statusOf } from '../lib/status';
import { usePortalText, usePortalDates, wordFor } from '../lib/portalI18n';
import { useFieldRefresh, useFreshIds } from '../lib/fieldLive';
import { MoneyInput } from '../components/inputs';
import { readReceipt } from '../lib/claims';
import { todayMyt, buildingName } from '../lib/format';
import { passKeyStatus, passKeyDay, type PassKeyDay } from '../lib/passKeyStatus';

/* GET /api/field/repairs and /api/field/repairs/:id (functions/api/field/repairs*.ts). No amounts: the server never sends any. */
interface Repair {
  id: string; unitId: string | null; unitNumber: string | null; propertyName: string; buildingId: string; addressLine: string;
  title: string; detail: string | null; category: string; urgency: string; jobType?: string; dueOn?: string | null; state: string; source: string;
  reportedAt: string; reporter: string | null; assigneeName: string | null;
  startedAt: string | null; endedAt: string | null; resolvedAt: string | null; blocksUnit: boolean; waitingForOwner: boolean;
  supportRequestedAt?: string | null; supportNote?: string | null;
  beforeCount: number; afterCount: number; documentCount: number;
  windows: { id: string; startsAt: string; endsAt: string; note: string | null; guestStaying: boolean }[];
}
interface PoolBuilding { id: string; name: string; open: number }
interface ListPayload { mine: Repair[]; open: Repair[]; team?: Repair[]; mayPick: boolean; buildings?: PoolBuilding[]; maxLimit?: number }
interface UnitGroup { groupKey: string; unitNumber: string | null; propertyName: string; jobs: Repair[] }
interface TechnicianGroup { name: string; jobs: Repair[] }
type ListTab = 'pass_key' | 'ongoing' | 'all' | 'done' | 'team';
type GroupedBy = 'unit' | 'technician';

const POOL_PAGE = 200;
const UNIT_SEARCH_DELAY_MS = 300;

const unitKeyOf = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const placeName = ({ unitNumber, propertyName }: Pick<Repair, 'unitNumber' | 'propertyName'>): string => unitNumber ? `${propertyName} ${unitNumber}` : propertyName;
const placeTitle = ({ unitNumber, propertyName }: Pick<Repair, 'unitNumber' | 'propertyName'>, noUnit: string): { title: string; sub: string } =>
  unitNumber ? { title: unitNumber, sub: propertyName } : { title: propertyName, sub: noUnit };

function groupByUnit(repairs: Repair[]): UnitGroup[] {
  const groups = new Map<string, UnitGroup>();
  for (const repair of repairs) {
    const groupKey = repair.unitId ?? `building:${repair.buildingId}`;
    const group = groups.get(groupKey) ?? { groupKey, unitNumber: repair.unitNumber, propertyName: repair.propertyName, jobs: [] };
    group.jobs.push(repair);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

function groupByTechnician(repairs: Repair[]): TechnicianGroup[] {
  const groups = new Map<string, TechnicianGroup>();
  for (const repair of repairs) {
    const name = repair.assigneeName?.trim() ?? '';
    const group = groups.get(name.toLowerCase()) ?? { name, jobs: [] };
    group.jobs.push(repair);
    groups.set(name.toLowerCase(), group);
  }
  return [...groups.values()].sort((first, second) => first.name.localeCompare(second.name));
}
interface FileDoc { id: string; kind: string; url: string; fileName: string; byteSize: number; uploadedAt: string; uploader: string | null }
interface Detail {
  job: Repair; mine: boolean; mayPick: boolean; mayDrop?: boolean; media: (MediaItem & { stage: 'before' | 'after' })[]; files: FileDoc[];
  access: { id: string; label: string; instruction: string }[]; parking?: string | null; notes: { note: string; by: string; at: string; done: boolean }[];
}

/** The repair's step in the words of the Maintenance screen (status vocabulary "maintenance"). */
function progress(r: Repair): string {
  if (r.jobType === 'pass_key') return passKeyStatus({ state: r.state, assigneeName: r.assigneeName, dueOn: r.dueOn ?? null, supportRequestedAt: r.supportRequestedAt ?? null }, todayMyt());
  if (r.state === 'resolved') return 'done';
  if (r.waitingForOwner) return 'awaiting_owner';
  if (r.endedAt) return 'repair_finished';
  if (r.startedAt) return 'in_progress';
  return r.assigneeName ? 'assigned' : 'new';
}

/** A technician's phone: the repair jobs that are theirs, the open ones nobody has (pick one up), and a way to report a
 *  new problem. One column, 44px targets; a job opens full screen with its action pinned at the bottom. */
export default function FieldRepairsPage({ above, linkRepair, onLinked }: { above?: ReactNode; linkRepair?: string | null; onLinked?: () => void }) {
  const [building, setBuilding] = useState('');
  const [category, setCategory] = useState('');
  const [unitSearch, setUnitSearch] = useState('');
  const [unitKey, setUnitKey] = useState('');
  const [limit, setLimit] = useState(POOL_PAGE);
  useEffect(() => {
    const nextKey = unitKeyOf(unitSearch);
    if (nextKey === unitKey) return;
    const timer = window.setTimeout(() => { setUnitKey(nextKey); setLimit(POOL_PAGE); }, UNIT_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [unitSearch, unitKey]);
  const query = new URLSearchParams({ ...(building ? { building } : {}), ...(category ? { category } : {}), ...(unitKey ? { unit: unitKey } : {}), ...(limit > POOL_PAGE ? { limit: String(limit) } : {}) }).toString();
  const { data, loading, error, reload } = useApi<ListPayload>(`/field/repairs${query ? `?${query}` : ''}`);
  // A new notice, the phone coming back to the app, or a minute passing reloads the list; a repair that just arrived carries a New mark.
  useFieldRefresh(reload);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60_000);
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<ListTab>('all');
  const [passKeyDayShown, setPassKeyDayShown] = useState<PassKeyDay>('today');
  const [open, setOpen] = useState<string | null>(null);
  // A notice tapped in the bell: open that repair (the sheet loads it by id and says so if it is not theirs).
  useEffect(() => { if (linkRepair) { setTab('all'); setOpen(linkRepair); onLinked?.(); } }, [linkRepair]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reporting, setReporting] = useState(false);
  const [pickingUnit, setPickingUnit] = useState<string | null>(null);
  const toast = useToast();
  const t = usePortalText();
  const tr = t.repairs;
  const isShown = (repair: Repair): boolean => (!building || repair.buildingId === building) && (!category || repair.category === category)
    && (!unitKey || unitKeyOf(repair.unitNumber ?? '').includes(unitKey));
  const mine = (data?.mine ?? []).filter(isShown);
  const todo = mine.filter(r => r.state !== 'resolved' && !r.endedAt);
  const finished = mine.filter(r => r.state === 'resolved' || r.endedAt);
  const pool = (data?.open ?? []).filter(isShown);
  const team = (data?.team ?? []).filter(isShown);
  const passKeyTodo = todo.filter(r => r.jobType === 'pass_key');
  const passKeyPool = pool.filter(r => r.jobType === 'pass_key');
  const isOnDay = (day: PassKeyDay) => (repair: Repair): boolean => passKeyDay(repair.dueOn ?? null, todayMyt(1)) === day;
  const passKeyCountOn = (day: PassKeyDay): number => passKeyTodo.filter(isOnDay(day)).length + passKeyPool.filter(isOnDay(day)).length;
  const myJobsShown = tab === 'pass_key' ? passKeyTodo.filter(isOnDay(passKeyDayShown)) : tab === 'ongoing' || tab === 'all' ? todo : [];
  const poolShown = tab === 'pass_key' ? passKeyPool.filter(isOnDay(passKeyDayShown)) : tab === 'all' ? pool : [];
  const groups = [
    ...groupByUnit(myJobsShown).map(group => ({ group, offer: false })),
    ...groupByUnit(poolShown).map(group => ({ group, offer: true })),
  ];
  const finishedShown = tab === 'all' || tab === 'done' ? finished : [];
  const emptyTitle = tab === 'pass_key' ? (passKeyDayShown === 'today' ? tr.noPassKeyToday : tr.noPassKeyTomorrow) : tab === 'done' ? tr.noDone : tr.noMine;
  const tabLabel = (name: string, count: number): ReactNode => (
    <span className="flex flex-col items-center">{name}<span className="text-meta text-muted-ink tabular-nums">{count}</span></span>
  );
  const fresh = useFreshIds([...(data?.mine ?? []), ...(data?.open ?? [])].map(r => r.id), 'repairs', !!data);
  const buildingOptions = useMemo(() => {
    const byId = new Map((data?.buildings ?? []).map(b => [b.id, b]));
    for (const r of data?.mine ?? []) if (!byId.has(r.buildingId)) byId.set(r.buildingId, { id: r.buildingId, name: buildingName(r.propertyName), open: 0 });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const allBuildingsOpen = (data?.buildings ?? []).reduce((sum, b) => sum + b.open, 0);
  const openTotal = building ? data?.buildings?.find(b => b.id === building)?.open ?? 0 : allBuildingsOpen;

  function chooseBuilding(id: string) { setBuilding(id); setLimit(POOL_PAGE); }
  function chooseCategory(value: string) { setCategory(value); setLimit(POOL_PAGE); }
  async function pickAll(group: UnitGroup) {
    setPickingUnit(group.groupKey);
    const result = await runEach(group.jobs, job => api.post(`/field/repairs/${job.id}/pick`, {}), job => job.title);
    setPickingUnit(null);
    toast({ tone: result.ok === 0 ? 'critical' : result.failed.length ? 'warning' : 'success', title: result.ok ? tr.pickedAll(result.ok) : tr.nonePicked, body: skippedNote(result.failed) || undefined });
    reload();
    if (result.ok) setTab('ongoing');
  }

  return (
    <>
      {above}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-title font-semibold">{tr.title}</h1>
          <div className="text-copy text-muted-ink">{data ? tr.summary(tr.jobs(todo.length), data.mayPick ? openTotal : null) : t.common.loading}</div>
        </div>
        {data && (
          <Segmented label={tr.which} value={tab} onChange={setTab}
            className="w-full grid grid-flow-col auto-cols-fr [&>button]:h-auto [&>button]:self-stretch [&>button]:min-h-11 [&>button]:px-1 [&>button]:py-1 [&>button]:whitespace-normal [&>button]:leading-tight"
            options={[
              { value: 'pass_key', label: tabLabel(tr.passKey, passKeyTodo.length + passKeyPool.length) },
              { value: 'ongoing', label: tabLabel(tr.ongoing, todo.length) },
              { value: 'all', label: tabLabel(tr.all, todo.length + openTotal) },
              { value: 'done', label: tabLabel(tr.done, finished.length) },
              ...(data.mayPick ? [{ value: 'team' as const, label: tabLabel(tr.team, team.length) }] : []),
            ]} />
        )}
      </div>
      {data && tab === 'pass_key' && (
        <Segmented label={t.jobs.day} value={passKeyDayShown} onChange={setPassKeyDayShown}
          className="w-full grid grid-flow-col auto-cols-fr [&>button]:min-h-11"
          options={[
            { value: 'today', label: `${t.jobs.today} · ${passKeyCountOn('today')}` },
            { value: 'tomorrow', label: `${t.jobs.tomorrow} · ${passKeyCountOn('tomorrow')}` },
          ]} />
      )}
      {data && (
        <FormRow label={tr.unitSearch}>
          <input type="search" enterKeyHint="search" autoComplete="off" className={cx(INPUT, 'h-11 text-[16px]')} value={unitSearch}
            onChange={e => setUnitSearch(e.target.value)} placeholder={tr.unitSearchPh} maxLength={40} />
        </FormRow>
      )}
      {buildingOptions.length > 1 && (
        <FormRow label={tr.building}>
          <select className={cx(INPUT, 'h-11')} value={building} onChange={e => chooseBuilding(e.target.value)}>
            <option value="">{data?.mayPick ? tr.allBuildingsOpen(allBuildingsOpen) : tr.allBuildings}</option>
            {buildingOptions.map(b => <option key={b.id} value={b.id}>{data?.mayPick ? tr.buildingOpen(b.name, b.open) : b.name}</option>)}
          </select>
        </FormRow>
      )}
      {data && (
        <FormRow label={tr.problemType}>
          <select className={cx(INPUT, 'h-11')} value={category} onChange={e => chooseCategory(e.target.value)}>
            <option value="">{tr.allProblemTypes}</option>
            {Object.keys(CATEGORY).map(value => <option key={value} value={value}>{wordFor(t.category, value)}</option>)}
          </select>
        </FormRow>
      )}
      <Button size="touch" variant="secondary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setReporting(true)}>{tr.reportProblem}</Button>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={120} /><Skeleton height={120} /></>
        : tab === 'team' ? <TeamList jobs={team} />
        : groups.length === 0 && finishedShown.length === 0
          ? unitKey
            ? <EmptyState icon="Search" title={tr.noUnitMatch(unitSearch.trim())} body={tr.noUnitMatchBody} />
            : <EmptyState icon="Wrench" title={emptyTitle} body={tab === 'done' ? undefined : data?.mayPick ? tr.noMineBodyPick : tr.noMineBody} />
          : (
            <div className="flex flex-col gap-2.5">
              {groups.map(({ group, offer }) => (
                <UnitGroupCard key={`${offer ? 'open' : 'mine'}-${group.groupKey}`} group={group} offer={offer} fresh={fresh} picking={pickingUnit === group.groupKey}
                  onPickAll={() => void pickAll(group)} onOpen={setOpen} />
              ))}
              {tab === 'all' && data?.mayPick && openTotal > pool.length && (
                <div className="flex flex-col items-center gap-1.5 py-1 text-center">
                  <span className="text-meta text-muted-ink">{tr.shown(pool.length, openTotal)}</span>
                  {limit < (data.maxLimit ?? POOL_PAGE)
                    ? <Button size="touch" variant="secondary" loading={loading} onClick={() => setLimit(current => current + POOL_PAGE)}>{tr.showMore}</Button>
                    : <span className="text-meta text-muted-ink">{tr.pickBuildingForRest}</span>}
                </div>
              )}
              {tab === 'all' && finishedShown.length > 0 && <h2 className="m-0 mt-2 text-[16px] font-semibold">{tr.finished}</h2>}
              {finishedShown.map(r => <RepairCard key={r.id} r={r} onOpen={() => setOpen(r.id)} />)}
            </div>
          )}
      {open && <RepairSheet id={open} onClose={() => setOpen(null)} onChanged={reload} onPicked={() => setTab('ongoing')} onDropped={() => { setOpen(null); setTab('all'); }} />}
      {reporting && <ReportSheet onClose={() => setReporting(false)}
        onDone={() => { setReporting(false); reload(); toast({ tone: 'success', title: tr.problemReported, body: t.jobs.officeHasIt }); }} />}
    </>
  );
}

function UnitGroupCard({ group, offer, fresh, picking, onPickAll, onOpen }: {
  group: UnitGroup; offer: boolean; fresh: ReadonlySet<string>; picking: boolean; onPickAll: () => void; onOpen: (id: string) => void;
}) {
  const t = usePortalText();
  const tr = t.repairs;
  const isUrgent = group.jobs.some(r => r.urgency === 'urgent' && r.state !== 'resolved');
  const hasFresh = group.jobs.some(r => fresh.has(r.id));
  const place = placeTitle(group, tr.noUnit);
  return (
    <ExpandableCard label={`${place.title} ${place.sub}`} borderClass={isUrgent ? 'border-danger-line' : hasFresh ? 'border-info-line' : 'border-line'} header={(
      <>
        <b className="text-heading truncate">{place.title}<span className="text-copy text-muted-ink font-normal"> · {place.sub}</span></b>
        <span className="flex gap-1.5 flex-wrap">
          <StatusBadge tone="neutral">{tr.jobs(group.jobs.length)}</StatusBadge>
          {isUrgent && <StatusBadge tone="critical">{tr.urgent}</StatusBadge>}
          {hasFresh && <StatusBadge tone="info" label={t.jobs.newJob} />}
          {offer && <StatusBadge tone="gold">{tr.openToPick}</StatusBadge>}
        </span>
      </>
    )}>
      {group.jobs.map(r => <RepairCard key={r.id} r={r} offer={offer} fresh={fresh.has(r.id)} onOpen={() => onOpen(r.id)} groupedBy="unit" />)}
      {offer && (
        <div className="px-4 pb-4 pt-3 [border-top:1px_solid_var(--color-line)]">
          <Button size="touch" variant="secondary" className="w-full" icon={<Icon name="Hand" size="sm" />} loading={picking} onClick={onPickAll}>{tr.pickAll(group.jobs.length)}</Button>
        </div>
      )}
    </ExpandableCard>
  );
}

function ExpandableCard({ label, borderClass, header, children }: { label: string; borderClass: string; header: ReactNode; children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const jobListId = useId();
  return (
    <section aria-label={label} className={cx('bg-card rounded-card border border-solid flex flex-col overflow-hidden', borderClass)}>
      <button type="button" aria-expanded={isExpanded} aria-controls={jobListId} onClick={() => setIsExpanded(current => !current)}
        className="w-full text-left bg-card flex items-center gap-3 px-4 py-3 min-h-[56px] cursor-pointer hover:bg-muted">
        <span className="flex-1 min-w-0 flex flex-col gap-1.5">{header}</span>
        <span className={cx('text-muted-ink transition-transform duration-200 motion-reduce:transition-none', isExpanded && 'rotate-180')}><Icon name="ChevronDown" size="nav" /></span>
      </button>
      {isExpanded && <div id={jobListId} className="flex flex-col">{children}</div>}
    </section>
  );
}

function TeamList({ jobs }: { jobs: Repair[] }) {
  const tr = usePortalText().repairs;
  if (jobs.length === 0) return <EmptyState icon="Users" title={tr.noTeam} body={tr.noTeamBody} />;
  return (
    <div className="flex flex-col gap-2.5">
      {groupByTechnician(jobs).map(technician => <TechnicianGroupCard key={technician.name.toLowerCase()} technician={technician} />)}
    </div>
  );
}

function TechnicianGroupCard({ technician }: { technician: TechnicianGroup }) {
  const tr = usePortalText().repairs;
  const isUrgent = technician.jobs.some(r => r.urgency === 'urgent');
  return (
    <ExpandableCard label={technician.name} borderClass={isUrgent ? 'border-danger-line' : 'border-line'} header={(
      <>
        <b className="text-heading truncate flex items-center gap-2"><Icon name="UserRound" size="sm" />{technician.name}</b>
        <span className="flex gap-1.5 flex-wrap">
          <StatusBadge tone="neutral">{tr.jobs(technician.jobs.length)}</StatusBadge>
          {isUrgent && <StatusBadge tone="critical">{tr.urgent}</StatusBadge>}
        </span>
      </>
    )}>
      {technician.jobs.map(r => <RepairCard key={r.id} r={r} groupedBy="technician" />)}
    </ExpandableCard>
  );
}

function RepairCard({ r, offer, fresh, groupedBy, onOpen }: { r: Repair; offer?: boolean; fresh?: boolean; groupedBy?: GroupedBy; onOpen?: () => void }) {
  const t = usePortalText();
  const tr = t.repairs;
  const { short, stamp } = usePortalDates();
  const next = r.windows.find(w => Date.parse(w.endsAt) > Date.now());
  const isUrgent = r.urgency === 'urgent' && r.state !== 'resolved';
  const badges = (
    <>
      {fresh && <StatusBadge tone="info" label={t.jobs.newJob} />}
      {isUrgent && <StatusBadge tone="critical">{tr.urgent}</StatusBadge>}
      {r.jobType === 'pass_key' && r.state !== 'resolved' && <StatusBadge tone="info">{tr.passKey}</StatusBadge>}
    </>
  );
  const className = cx('w-full box-border text-left bg-card flex flex-col gap-1.5 min-h-[44px]', groupedBy
    ? 'px-4 py-3 [border-top:1px_solid_var(--color-line)]'
    : cx('rounded-card border border-solid p-4', isUrgent ? 'border-danger-line' : fresh ? 'border-info-line' : 'border-line'));
  const content = (
    <>
      {groupedBy === 'unit' ? (
        <span className="flex items-start gap-2">
          <span className="flex-1 min-w-0 text-copy text-ink [overflow-wrap:anywhere]">{r.title}</span>
          {badges}
        </span>
      ) : (
        <>
          <span className="flex items-center gap-2">
            <b className="text-heading flex-1 min-w-0 truncate">{placeTitle(r, tr.noUnit).title}<span className="text-copy text-muted-ink font-normal"> · {placeTitle(r, tr.noUnit).sub}</span></b>
            {badges}
          </span>
          <span className="text-copy text-ink [overflow-wrap:anywhere]">{r.title}</span>
        </>
      )}
      <span className="text-meta text-muted-ink">{wordFor(t.category, r.category)} · {tr.reported(stamp(r.reportedAt))}{r.beforeCount ? ` · ${tr.photos(r.beforeCount)}` : ''}</span>
      {r.dueOn && r.state !== 'resolved' && r.jobType !== 'urgent' && <span className="text-meta text-ink">{tr.due(short(r.dueOn))}</span>}
      {next && <span className="text-meta text-ink flex items-center gap-1.5"><Icon name="CalendarClock" size="sm" />{tr.goIn(stamp(next.startsAt), hm(next.endsAt))}</span>}
      <span className="flex gap-1.5 flex-wrap pt-0.5">
        {offer ? <StatusBadge tone="gold">{tr.openToPick}</StatusBadge> : <StatusBadge tone={statusOf('maintenance', progress(r)).tone} label={wordFor(t.repairStatus, progress(r))} dot />}
      </span>
    </>
  );
  return onOpen
    ? <button type="button" onClick={onOpen} className={cx(className, 'cursor-pointer', groupedBy && 'hover:bg-muted')}>{content}</button>
    : <div className={className}>{content}</div>;
}

/* ---------- one job, full screen ---------- */

function RepairSheet({ id, onClose, onChanged, onPicked, onDropped }: { id: string; onClose: () => void; onChanged: () => void; onPicked: () => void; onDropped: () => void }) {
  const toast = useToast();
  const t = usePortalText();
  const tr = t.repairs;
  const { short, stamp } = usePortalDates();
  const d = useApi<Detail>(`/field/repairs/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<'before' | 'after'>('before');
  const [fileKind, setFileKind] = useState('claim');
  /* A purchase of their own for the job (finance, 29 Oct 2026): one photo, its amount read and confirmed, handed in as a
     receipt to be paid back from the department's petty cash or by finance. */
  const [purchase, setPurchase] = useState<{ id: string; file: File; amountSen: number | null; spendDate: string | null } | null>(null);
  const [note, setNote] = useState('');
  const [doneNote, setDoneNote] = useState('');
  const [isAskingSupport, setIsAskingSupport] = useState(false);
  const [supportNote, setSupportNote] = useState('');
  const [confirm, ask] = useConfirm();
  const j = d.data?.job;
  const mine = !!d.data?.mine;
  const closed = j?.state === 'resolved';
  const working = mine && !closed;

  // Once the repair has started, the photos being taken are of the finished work.
  const started = !!j?.startedAt;
  useEffect(() => { if (started) setStage('after'); }, [started]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const refresh = () => { d.reload(); onChanged(); };
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); return true; }
    catch (e) { toast({ tone: 'critical', title: t.jobs.notSaved, body: errorMessage(e, t.jobs.checkSignal) }); refresh(); return false; }
    finally { setBusy(null); }
  }
  async function removePhoto(m: MediaItem) {
    const ok = await ask({ title: m.kind === 'video' ? t.jobs.removeVideo : t.jobs.removePhoto, body: t.jobs.removeBody, confirmLabel: t.jobs.remove, cancelLabel: t.jobs.keep, danger: true });
    if (ok === null) return;
    void act('remove', () => api.del(`/maintenance/issues/${id}/photos/${m.id}`), m.kind === 'video' ? t.jobs.videoRemoved : t.jobs.photoRemoved);
  }
  async function removeFile(f: FileDoc) {
    const ok = await ask({ title: tr.removeFile, body: tr.removeFileBody, confirmLabel: t.jobs.remove, cancelLabel: t.jobs.keep, danger: true });
    if (ok === null) return;
    void act('remove', () => api.del(`/maintenance/issues/${id}/documents/${f.id}`), tr.fileRemoved);
  }
  async function dropJob() {
    const ok = await ask({ title: tr.dropAsk, body: tr.dropBody, confirmLabel: tr.dropConfirm, cancelLabel: tr.keepJob, danger: true });
    if (ok === null) return;
    if (await act('drop', () => api.post(`/field/repairs/${id}/drop`, {}), tr.dropped, tr.droppedBody)) onDropped();
  }
  async function pickPurchase(list: FileList) {
    const file = list[0];
    if (!file) return;
    setBusy('reading');
    const read = await readReceipt([file]);
    setBusy(null);
    // A date read the wrong way round can land in the future; then the day it is handed in is used.
    setPurchase({ id: crypto.randomUUID(), file, amountSen: read.amountSen, spendDate: read.date && read.date <= todayMyt() ? read.date : null });
  }
  async function handInPurchase() {
    if (!purchase?.amountSen) return;
    setBusy('purchase');
    try {
      const res = await uploadTo(`/maintenance/issues/${id}/documents`, { kind: 'purchase', receiptId: purchase.id, amountSen: String(purchase.amountSen), ...(purchase.spendDate ? { spendDate: purchase.spendDate } : {}) })(purchase.file) as { receipt?: unknown; message?: string | null };
      if (res.receipt === 'failed') { toast({ tone: 'warning', title: tr.notHandedIn, body: res.message ?? undefined }); return; }
      else toast({ tone: 'success', title: tr.handedIn });
      setPurchase(null);
    } catch (e) { toast({ tone: 'critical', title: t.jobs.notSaved, body: errorMessage(e, t.jobs.checkSignal) }); }
    finally { setBusy(null); refresh(); }
  }

  async function uploadFiles(list: FileList) {
    setBusy('files');
    const res = await runEach(Array.from(list), f => uploadTo(`/maintenance/issues/${id}/documents`, { kind: fileKind })(f), f => f.name);
    setBusy(null);
    toast({ tone: res.ok === 0 ? 'critical' : res.failed.length ? 'warning' : 'success', title: res.ok ? tr.filesAdded(res.ok) : tr.nothingAdded, body: skippedNote(res.failed) || undefined });
    refresh();
  }

  const media = d.data?.media ?? [];
  const counts = { before: media.filter(m => m.stage === 'before').length, after: media.filter(m => m.stage === 'after').length };
  const windows = j?.windows ?? [];

  const supportForm = (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-copy font-semibold">{tr.supportTitle}</span>
        <span className="text-meta text-muted-ink">{tr.supportHint}</span>
        <textarea className={cx(TEXTAREA, 'text-[16px]')} value={supportNote} onChange={e => setSupportNote(e.target.value)} placeholder={tr.supportPh} maxLength={1000} autoFocus />
      </label>
      <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Send" size="sm" />} loading={busy === 'support'}
        disabled={!supportNote.trim()} disabledReason={tr.supportNeedNote}
        onClick={() => void act('support', () => api.post(`/maintenance/issues/${id}/support`, { note: supportNote.trim() }), tr.supportSent, tr.supportSentBody).then(ok => { if (ok) { setIsAskingSupport(false); setSupportNote(''); } })}>{tr.supportSend}</Button>
      <Button size="touch" variant="ghost" className="w-full" onClick={() => setIsAskingSupport(false)}>{tr.form.cancel}</Button>
    </div>
  );
  const supportAskedNote = j?.supportRequestedAt ? (
    <div className="rounded-control bg-warning-bg text-warning p-3 flex flex-col gap-1">
      <span>{tr.supportAsked(stamp(j.supportRequestedAt))}</span>
      {j.supportNote && <span className="text-meta whitespace-pre-wrap [overflow-wrap:anywhere]">{j.supportNote}</span>}
    </div>
  ) : null;
  const hasPhoto = media.length > 0;

  let footer: ReactNode = null;
  if (j && d.data?.mayPick) {
    footer = <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Hand" size="sm" />} loading={busy === 'pick'}
      onClick={() => void act('pick', () => api.post(`/field/repairs/${id}/pick`, {}), tr.picked, tr.pickedBody).then(ok => { if (ok) onPicked(); })}>{tr.pickUp}</Button>;
  } else if (j && working && j.waitingForOwner) {
    footer = <p className="m-0 text-copy text-warning text-center">{tr.waitingOwner}</p>;
  } else if (j && working && j.jobType === 'pass_key' && isAskingSupport) {
    footer = supportForm;
  } else if (j && working && j.jobType === 'pass_key') {
    footer = (
      <div className="flex flex-col gap-2">
        {supportAskedNote}
        <Button size="touch" variant="primary" className="w-full" icon={<Icon name="KeyRound" size="sm" />} loading={busy === 'passKeyDone'}
          disabled={!hasPhoto} disabledReason={tr.passKeyNeedPhoto}
          onClick={() => void act('passKeyDone', () => api.post(`/maintenance/issues/${id}/pass-key-done`, {}), tr.passKeyMarked, tr.passKeyMarkedBody)}>{tr.passKeyDone}</Button>
        {!hasPhoto && <span className="text-meta text-muted-ink text-center">{tr.passKeyNeedPhoto}</span>}
        {!j.supportRequestedAt && (
          <Button size="touch" variant="secondary" className="w-full" icon={<Icon name="LifeBuoy" size="sm" />} onClick={() => setIsAskingSupport(true)}>{tr.cantDoIt}</Button>
        )}
      </div>
    );
  } else if (j && working && !j.startedAt) {
    footer = (
      <div className="flex flex-col gap-2">
        <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Play" size="sm" />} loading={busy === 'start'}
          onClick={() => void act('start', () => api.post(`/maintenance/issues/${id}/start`, {}), tr.started, tr.startedBody)}>{tr.start}</Button>
        {d.data?.mayDrop && (
          <Button size="touch" variant="ghost" className="w-full" icon={<Icon name="Undo2" size="sm" />} loading={busy === 'drop'}
            onClick={() => void dropJob()}>{tr.drop}</Button>
        )}
      </div>
    );
  } else if (j && working && !j.endedAt && isAskingSupport) {
    footer = supportForm;
  } else if (j && working && !j.endedAt) {
    footer = (
      <div className="flex flex-col gap-2">
        {supportAskedNote}
        <input className={cx(INPUT, 'h-11')} value={doneNote} onChange={e => setDoneNote(e.target.value)} placeholder={tr.whatYouDid} aria-label={tr.whatYouDidLabel} maxLength={1000} />
        <Button size="touch" variant="primary" className="w-full" icon={<Icon name="CircleCheck" size="sm" />} loading={busy === 'end'}
          disabled={counts.after === 0} disabledReason={tr.needAfter}
          onClick={() => void act('end', () => api.post(`/maintenance/issues/${id}/end`, { note: doneNote.trim() || undefined }), tr.markedDone, tr.markedDoneBody)}>{tr.markDone}</Button>
        {counts.after === 0 && <span className="text-meta text-muted-ink text-center">{tr.needAfterHint}</span>}
        {!j.supportRequestedAt && (
          <Button size="touch" variant="secondary" className="w-full" icon={<Icon name="LifeBuoy" size="sm" />} onClick={() => setIsAskingSupport(true)}>{tr.needSupport}</Button>
        )}
      </div>
    );
  } else if (j && working && j.endedAt) {
    footer = <p className="m-0 text-copy text-success text-center">{tr.doneAt(hm(j.endedAt), short(j.endedAt.slice(0, 10)))}</p>;
  } else if (j && closed) {
    footer = <p className="m-0 text-copy text-muted-ink text-center">{j.jobType === 'pass_key' ? tr.passKeyMarked : tr.closed(j.resolvedAt ? short(j.resolvedAt.slice(0, 10)) : null)}</p>;
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={j ? `${j.unitNumber ?? j.propertyName} ${j.title}` : tr.job} data-repair-sheet
      className="fixed inset-0 z-[55] bg-page flex flex-col">
      <header className="flex-none bg-card [border-bottom:1px_solid_var(--color-line)]">
        <div className="max-w-[560px] mx-auto flex items-center gap-2 px-2 py-2">
        <button type="button" onClick={onClose} aria-label={tr.back} className="w-11 h-11 grid place-items-center rounded-control cursor-pointer text-ink hover:bg-muted">
          <Icon name="ChevronLeft" size="nav" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-heading font-semibold truncate">{j ? `${placeTitle(j, tr.noUnit).title} · ${placeTitle(j, tr.noUnit).sub}` : tr.job}</div>
          {j && <div className="text-meta text-muted-ink truncate">{j.title}</div>}
        </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] mx-auto px-4 py-4 flex flex-col gap-4 text-copy">
          {d.error && <StaleBanner message={d.error} onRetry={d.reload} />}
          {!j ? <><Skeleton height={120} /><Skeleton height={160} /></> : (
            <>
              <div className="flex gap-1.5 flex-wrap">
                {j.urgency === 'urgent' && !closed && <StatusBadge tone="critical">{tr.urgent}</StatusBadge>}
                {j.jobType === 'pass_key' && !closed && <StatusBadge tone="info">{tr.passKey}</StatusBadge>}
                {j.dueOn && !closed && j.jobType !== 'urgent' && <StatusBadge tone="neutral">{tr.due(short(j.dueOn))}</StatusBadge>}
                <StatusBadge tone="neutral">{wordFor(t.category, j.category)}</StatusBadge>
                {d.data!.mayPick ? <StatusBadge tone="gold">{tr.openToPick}</StatusBadge> : <StatusBadge tone={statusOf('maintenance', progress(j)).tone} label={wordFor(t.repairStatus, progress(j))} dot />}
                {j.blocksUnit && <StatusBadge tone="critical">{tr.unitBlocked}</StatusBadge>}
              </div>

              <section className="flex flex-col gap-1">
                <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{j.title}</h2>
                {j.detail && <p className="m-0 text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{j.detail}</p>}
                <span className="text-meta text-muted-ink">{tr.reportedBy(`${j.reporter ?? wordFor(tr.source, j.source)}${j.reporter && j.source !== 'staff' ? ` (${wordFor(tr.source, j.source)})` : ''}`, stamp(j.reportedAt))}</span>
              </section>

              <InfoRow icon="MapPin" label={tr.where}>
                <b>{placeName(j)}</b>
                {j.addressLine && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.addressLine)}`} target="_blank" rel="noopener noreferrer"
                  className="min-h-11 flex items-center gap-2 text-ink"><span className="flex-1 min-w-0 underline underline-offset-2">{j.addressLine}</span><span className="text-meta text-muted-ink">{tr.openMap}</span></a>}
              </InfoRow>
              {mine ? (
                d.data!.access.length ? d.data!.access.map(a => (
                  <InfoRow key={a.id} icon="KeyRound" label={a.label}><span className="whitespace-pre-wrap">{a.instruction}</span></InfoRow>
                )) : <InfoRow icon="KeyRound" label={tr.gettingIn}><span className="text-muted-ink">{tr.noAccess}</span></InfoRow>
              ) : d.data!.mayPick && <InfoRow icon="KeyRound" label={tr.gettingIn}><span className="text-muted-ink">{tr.shownOnPick}</span></InfoRow>}
              {mine && d.data!.parking && <InfoRow icon="Car" label={t.jobs.carPark}>{d.data!.parking}</InfoRow>}
              <InfoRow icon="CalendarClock" label={tr.whenGoIn}>
                {windows.length ? windows.map(w => (
                  <span key={w.id} className={cx('block', Date.parse(w.endsAt) < Date.now() && 'text-muted-ink')}>
                    <b className="tabular-nums">{tr.span(stamp(w.startsAt), w.startsAt.slice(0, 10) === w.endsAt.slice(0, 10) ? hm(w.endsAt) : stamp(w.endsAt))}</b>
                    {w.note && <span className="text-muted-ink"> · {w.note}</span>}
                    {Date.parse(w.endsAt) < Date.now() && <span className="text-muted-ink"> {tr.over}</span>}
                    {w.guestStaying && <span className="block text-meta text-warning">{tr.guestStaying}</span>}
                  </span>
                )) : <span className="text-muted-ink">{tr.noTime}</span>}
              </InfoRow>

              <section className="flex flex-col gap-2.5">
                {j.jobType === 'pass_key' ? (
                  <>
                    <AttachmentLabel title={tr.media} count={media.length} hint={working && !hasPhoto ? tr.passKeyNeedPhoto : undefined} />
                    <MediaGallery items={media} upload={working ? uploadTo(`/maintenance/issues/${id}/photos`, { kind: 'after' }, placeName(j)) : undefined}
                      onDone={refresh} onRemove={working ? m => void removePhoto(m) : undefined} addLabel={t.jobs.addPhoto} emptyText={t.jobs.noPhotos} />
                  </>
                ) : (
                  <>
                    <AttachmentLabel title={tr.media} count={media.length} hint={working && j.startedAt && counts.after === 0 ? tr.atLeastAfter : undefined} />
                    <Segmented label={tr.beforeOrAfter} className="[&>button]:h-11" value={stage} onChange={setStage} options={[
                      { value: 'before', label: <>{tr.before} <span className="text-muted-ink tabular-nums">{counts.before}</span></> },
                      { value: 'after', label: <>{tr.after} <span className="text-muted-ink tabular-nums">{counts.after}</span></> },
                    ]} />
                    <MediaGallery key={stage} items={media.filter(m => m.stage === stage)} upload={working ? uploadTo(`/maintenance/issues/${id}/photos`, { kind: stage }, placeName(j)) : undefined}
                      onDone={refresh} onRemove={working ? m => void removePhoto(m) : undefined} addLabel={stage === 'before' ? tr.addBefore : tr.addAfter}
                      emptyText={stage === 'before' ? tr.noBefore : tr.noAfter} />
                  </>
                )}
              </section>

              {(working || d.data!.files.length > 0) && (
                <section className="flex flex-col gap-2">
                  <AttachmentLabel title={tr.claims} count={d.data!.files.length} />
                  {working && <span className="text-meta text-muted-ink">{tr.claimsHint}</span>}
                  {working && (
                    <FormRow label={tr.fileKindLabel}>
                      <select className={cx(INPUT, 'h-11')} value={fileKind} onChange={e => setFileKind(e.target.value)}>
                        {['purchase', 'claim', 'receipt', 'invoice', 'pod'].map(k => <option key={k} value={k}>{wordFor(tr.fileKind, k)}</option>)}
                      </select>
                    </FormRow>
                  )}
                  {working && purchase && (
                    <div className="flex flex-col gap-2 rounded-control bg-muted px-3 py-3">
                      <span className="text-meta text-muted-ink">{purchase.file.name}</span>
                      <MoneyInput label={tr.purchaseAmount} valueSen={purchase.amountSen} onChangeSen={v => setPurchase({ ...purchase, amountSen: v })} />
                      <span className="flex gap-2">
                        <Button size="touch" variant="primary" disabled={!purchase.amountSen || busy === 'purchase'} onClick={() => void handInPurchase()}>{tr.handIn}</Button>
                        <Button size="touch" variant="secondary" disabled={busy === 'purchase'} onClick={() => setPurchase(null)}>{t.common.back}</Button>
                      </span>
                    </div>
                  )}
                  <FileList files={d.data!.files.map(f => ({ id: f.id, name: f.fileName, href: f.url, size: f.byteSize, label: `${f.kind in tr.fileKind ? wordFor(tr.fileKind, f.kind) : tr.fileKind.other} · ${short(f.uploadedAt.slice(0, 10))}`,
                    // A purchase was also handed in to finance as a receipt: it is cancelled there, not here.
                    onRemove: working && f.kind !== 'purchase' ? () => void removeFile(f) : undefined, removeLabel: `${t.jobs.remove} ${f.fileName}` }))}
                    add={working && !purchase ? (fileKind === 'purchase'
                      ? { label: busy === 'reading' ? tr.reading : tr.addFile, hint: tr.purchaseHint, accept: 'image/*,application/pdf', multiple: false, busy: busy === 'reading', onPick: fl => void pickPurchase(fl) }
                      : { label: tr.addFile, hint: tr.addFileHint, accept: 'image/*,application/pdf', multiple: true, busy: busy === 'files', onPick: fl => void uploadFiles(fl) }) : undefined} />
                </section>
              )}

              {(mine || d.data!.notes.length > 0) && (
                <section className="flex flex-col gap-2">
                  <AttachmentLabel title={tr.notes} count={d.data!.notes.length} />
                  {d.data!.notes.map((n, k) => (
                    <div key={k} className="rounded-control bg-muted px-3 py-2">
                      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{n.note}</span>
                      <span className="block text-meta text-muted-ink">{n.by} · {stamp(n.at)}{n.done ? ` · ${tr.whenFinishing}` : ''}</span>
                    </div>
                  ))}
                  {working && (
                    <div className="flex flex-col gap-2">
                      <textarea className={TEXTAREA} value={note} onChange={e => setNote(e.target.value)} placeholder={tr.notePh} aria-label={tr.newNote} maxLength={1000} />
                      <Button size="touch" variant="secondary" disabled={!note.trim()} disabledReason={tr.writeFirst} loading={busy === 'note'}
                        onClick={() => void act('note', () => api.post(`/field/repairs/${id}/note`, { note: note.trim() }), tr.noteAdded).then(ok => { if (ok) setNote(''); })}>{tr.addNote}</Button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {footer && (
        <footer className="flex-none bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="max-w-[560px] mx-auto">{footer}</div>
        </footer>
      )}
      {confirm}
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-control bg-card border border-solid border-line px-3 py-2.5">
      <span className="text-muted-ink pt-0.5"><Icon name={icon} size="sm" /></span>
      <div className="flex-1 min-w-0 [overflow-wrap:anywhere]"><span className="block text-meta text-muted-ink">{label}</span>{children}</div>
    </div>
  );
}

/* ---------- report a new problem ---------- */

interface UnitName { id: string; unitNumber: string; propertyId: string; propertyName: string }
const OTHERS_UNIT = 'others';

/** The office's "Add maintenance job" form on the phone: building, unit, the problem, its category and urgency, and
 *  photos of it. It lands on the Maintenance screen as an open job. */
function ReportSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const units = useApi<{ data: UnitName[] }>('/field/units');
  const toast = useToast();
  const t = usePortalText();
  const tf = t.repairs.form;
  const picked = usePickedMedia();
  const [f, setF] = useState({ building: '', unitId: '', title: '', category: '', urgency: 'normal', detail: '' });
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ unitId?: string; title?: string; category?: string; detail?: string; form?: string }>({});
  const inBuildingJob = f.unitId === OTHERS_UNIT;
  const all = units.data?.data ?? [];
  const buildings = useMemo(() => [...new Map(all.map(u => [u.propertyId, buildingName(u.propertyName)])).entries()].map(([id, name]) => ({ id, name })), [all]);
  const inBuilding = all.filter(u => u.propertyId === f.building);
  useEffect(() => { if (buildings.length === 1 && !f.building) setF(x => ({ ...x, building: buildings[0].id })); }, [buildings, f.building]);

  async function save() {
    const bad = { unitId: f.unitId ? undefined : tf.errUnit, title: f.title.trim() ? undefined : tf.errTitle, category: f.category ? undefined : tf.errKind,
      detail: inBuildingJob && !f.detail.trim() ? tf.errWhere : undefined };
    if (Object.values(bad).some(Boolean)) { setError(bad); return; }
    setBusy(true); setError({});
    let id: string;
    try {
      id = (await api.post<{ id: string }>('/maintenance/issues', { ...(f.unitId === OTHERS_UNIT ? { propertyId: f.building } : { unitId: f.unitId }), title: f.title.trim(), detail: f.detail.trim() || undefined, category: f.category, urgency: f.urgency })).id;
    } catch (e) {
      const fields = e instanceof ApiFailure ? e.fields ?? {} : {};
      setError({ unitId: fields.unitId ?? fields.unitNumber ?? fields.propertyId, title: fields.title, category: fields.category, detail: fields.detail && tf.errWhere,
        form: fields.title || fields.category || fields.detail ? undefined : errorMessage(e, tf.notSent) });
      setBusy(false); return;
    }
    if (picked.files.length) {
      setSending(true);
      const failed = await picked.send(f.unitId === OTHERS_UNIT ? buildings.find(b => b.id === f.building)?.name ?? '' : inBuilding.filter(u => u.id === f.unitId).map(u => `${buildingName(u.propertyName)} ${u.unitNumber}`)[0] ?? '', id);
      if (failed.length) toast({ tone: 'warning', title: tf.someNotAdded, body: tf.notAdded(failed.join(', ')) });
    }
    onDone();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={tf.title} className="fixed inset-0 z-[55] bg-page flex flex-col">
      <header className="flex-none bg-card [border-bottom:1px_solid_var(--color-line)]">
        <div className="max-w-[560px] mx-auto flex items-center gap-2 px-2 py-2">
        <button type="button" onClick={onClose} disabled={busy} aria-label={tf.cancel} className="w-11 h-11 grid place-items-center rounded-control cursor-pointer text-ink hover:bg-muted">
          <Icon name="X" size="nav" />
        </button>
        <div className="flex-1 min-w-0 text-heading font-semibold">{tf.title}</div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] mx-auto px-4 py-4 flex flex-col gap-3.5">
          {units.error && <StaleBanner message={units.error} onRetry={units.reload} />}
          <FormRow label={tf.building}>
            <select className={cx(INPUT, 'h-11')} value={f.building} onChange={e => setF(x => ({ ...x, building: e.target.value, unitId: '' }))}>
              <option value="" disabled>{units.loading ? t.common.loading : tf.pickBuilding}</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </FormRow>
          <FormRow label={tf.unit} error={error.unitId}>
            <select className={cx(INPUT, 'h-11')} value={f.unitId} disabled={!f.building} onChange={e => { setF(x => ({ ...x, unitId: e.target.value })); setError(x => ({ ...x, unitId: undefined })); }}>
              <option value="" disabled>{f.building ? tf.pickUnit : tf.pickBuildingFirst}</option>
              {inBuilding.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
              <option value={OTHERS_UNIT}>{tf.othersUnit}</option>
            </select>
          </FormRow>
          <FormRow label={tf.what} error={error.title}>
            <input className={cx(INPUT, 'h-11')} value={f.title} onChange={e => { setF(x => ({ ...x, title: e.target.value })); setError(x => ({ ...x, title: undefined })); }} placeholder={tf.whatPh} maxLength={160} />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label={tf.kind} error={error.category}>
              <select className={cx(INPUT, 'h-11')} value={f.category} onChange={e => { setF(x => ({ ...x, category: e.target.value })); setError(x => ({ ...x, category: undefined })); }}>
                <option value="" disabled>{tf.pickOne}</option>
                {Object.keys(CATEGORY).map(v => <option key={v} value={v}>{wordFor(t.category, v)}</option>)}
              </select>
            </FormRow>
            <FormRow label={tf.urgency}>
              <select className={cx(INPUT, 'h-11')} value={f.urgency} onChange={e => setF(x => ({ ...x, urgency: e.target.value }))}>
                <option value="normal">{tf.normal}</option><option value="urgent">{tf.urgent}</option>
              </select>
            </FormRow>
          </div>
          <FormRow label={inBuildingJob ? tf.where : tf.details} error={error.detail}>
            <textarea className={TEXTAREA} value={f.detail} onChange={e => { setF(x => ({ ...x, detail: e.target.value })); setError(x => ({ ...x, detail: undefined })); }}
              placeholder={inBuildingJob ? tf.wherePh : tf.detailsPh} maxLength={2000} />
          </FormRow>
          <ProblemPhotos picked={picked} sending={sending} />
          {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
        </div>
      </div>
      <footer className="flex-none bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="max-w-[560px] mx-auto"><Button size="touch" variant="primary" className="w-full" loading={busy} onClick={() => void save()}>{tf.send}</Button></div>
      </footer>
    </div>
  );
}
