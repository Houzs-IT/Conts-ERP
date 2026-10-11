import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { DateField } from '../components/inputs';
import Icon from '../components/Icon';
import { Select, SearchSelect, type SelectOption } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { DataTable, type Column } from '../components/DataTable';
import SplitPane from '../components/SplitPane';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { useCleaners } from '../lib/useCleaners';
import { useUnitRoster } from '../lib/useUnitRoster';
import { useNow } from '../lib/useMedia';
import { useSession } from '../lib/session';
import { runEach, skippedNote } from '../lib/bulk';
import { fetchAllPages } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { rm, plural, count } from '../lib/format';
import type { Tone } from '../lib/types';
import { HistoryDisclosure } from '../components/RecordHistory';
import {
  KIND_LABEL, TimeLeft, PillTabs, OpsModal, FormRow, INPUT, TEXTAREA, CloseButton, MediaGrid, MediaDrop, uploadTo, dayLabel, hm, stamp, minutesLabel, mytDay, type CleanStatus, type MediaItem,
} from '../components/ops/OpsUi';
import { CleanerChecklist, CrewCell, EtaEditor, QuickDamageModal, type CrewMember } from '../components/ops/CleaningParts';
import { DayPicker, isDay } from '../components/calendar/DatePicker';
import { usePhone } from './finance/listKit';
import { statusOf } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';

/* ---------- what the board endpoint answers (functions/api/housekeeping/board.ts) ---------- */

interface Guest { reservationId: string; guestName: string; channel: string }
interface Damage { id: string; title: string; state: string }
interface Row {
  id: string; kind: string; state: string; status: Exclude<CleanStatus, 'unplanned'>; title: string; instructions: string | null;
  day: string; carriedOver: boolean; unitId: string; unitNumber: string; readiness: string; buildingId: string; propertyName: string;
  layout?: string | null; cleaners?: CrewMember[]; damage?: Damage[];
  assigneeId: string | null; cleanerId: string | null; assigneeName: string | null;
  previous: (Guest & { state: string; checkOutTime: string; lateCheckOut: boolean }) | null;
  next: (Guest & { guests: number; checkInTime: string; earlyCheckIn: boolean; checkInAt: string; expectedArrival?: string | null }) | null;
  guestOut: boolean; guestLeftAt: string | null; startedAt: string | null; completedAt: string | null;
  photoCount: number; videoCount: number;
}
interface Departure {
  reservationId: string; state: string; channel: string; guestName: string; checkOutTime: string; lateCheckOut: boolean;
  unitId: string; unitNumber: string; buildingId: string; propertyName: string; layout?: string | null;
  next: { reservationId?: string; guestName: string; checkInTime: string; checkInAt: string; earlyCheckIn: boolean; expectedArrival?: string | null } | null;
}
export interface RepairOnDay {
  id: string; issueId: string; startsAt: string; endsAt: string; note: string | null; title: string; state: string; urgency: string; category: string;
  assigneeName: string | null; unitId: string; unitNumber: string; buildingId: string; propertyName: string; overlaps: { guestName: string }[];
}
interface Board { date: string; today: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[]; defaults: { checkIn: string; checkOut: string } }

interface Detail {
  id: string; kind: string; state: string; unitId: string; unitNumber: string; propertyName: string; instructions: string | null;
  startedAt: string | null; completedAt: string | null; guestLeftAt: string | null;
  media: MediaItem[];
  access: { id: string; kind: string; label: string; instruction: string; masked: string; hasCode: boolean }[]; mayReveal: boolean;
  cost: { amount: number; source: 'unit' | 'history' | 'default'; charged: boolean } | null;
  damage: { id: string; title: string; state: string; reportedAt: string }[];
  day?: string | null;
}

type Tab = 'board' | 'history';
/** What needs doing first: guest out and ready to clean, then cleaning, then still waiting, then no job yet, then done. */
type Stage = 'ready' | 'cleaning' | 'todo' | 'unplanned' | 'done';
const STAGE_OF: Record<Row['status'], Stage> = { ready: 'ready', cleaning: 'cleaning', guest_in: 'todo', waiting: 'todo', unassigned: 'todo', done: 'done' };
const STAGE_RANK: Record<Stage, number> = { ready: 0, cleaning: 1, todo: 2, unplanned: 3, done: 4 };
const STAGES: { value: Stage | 'all'; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'ready', label: 'Ready to clean' }, { value: 'cleaning', label: 'Cleaning' },
  { value: 'todo', label: 'Guest still in / to do' }, { value: 'unplanned', label: 'No cleaning job' }, { value: 'done', label: 'Done' },
];

const KIND_NAME: Record<string, string> = { turnover: 'Standard clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };
const COST_SOURCE: Record<string, string> = { unit: 'unit rate', history: 'last charged on this unit', default: 'standard rate' };
const isUnassigned = (r: Row) => !r.cleaners?.length && !r.cleanerId && !r.assigneeId && !r.assigneeName;

export default function CleaningPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'history' ? 'history' : 'board';
  const setTab = (t: Tab) => setParams(p => {
    const n = new URLSearchParams(p);
    if (t === 'history') { n.set('tab', 'history'); BOARD_PARAMS.forEach(k => n.delete(k)); } else { n.delete('tab'); HISTORY_PARAMS.forEach(k => n.delete(k)); }
    return n;
  }, { replace: true });
  return tab === 'history' ? <HistoryView onTab={setTab} /> : <BoardView onTab={setTab} />;
}

/** Board and History as page tabs, the same pills as the Reservations views. */
function TabSwitch({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return <PillTabs value={tab} onChange={onTab} tabs={[{ value: 'board', label: 'Board' }, { value: 'history', label: 'History' }]} />;
}

/** Folded buildings on the board, remembered per person in this browser. */
function useFoldedBuildings(userId: string | undefined) {
  const key = `tc.cleaning.folded.${userId ?? 'anon'}`;
  const [folded, setFolded] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { return {}; } });
  useEffect(() => {
    try { const on = Object.fromEntries(Object.entries(folded).filter(([, v]) => v)); if (Object.keys(on).length) localStorage.setItem(key, JSON.stringify(on)); else localStorage.removeItem(key); } catch { /* not remembered */ }
  }, [key, folded]);
  return [folded, setFolded] as const;
}

/* ============================== board ============================== */

const BOARD_PARAMS = ['day', 'stage', 'cleaner', 'building'];

function BoardView({ onTab }: { onTab: (t: Tab) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const phone = usePhone();
  const now = useNow(30000);
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const setParam = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const today = mytDay(0);
  const date = isDay(params.get('day')) ? params.get('day')! : today;
  const stage = (STAGES.some(s => s.value === params.get('stage')) ? params.get('stage') : 'all') as Stage | 'all';
  const cleaner = params.get('cleaner') ?? '';
  const building = params.get('building') ?? '';
  const [selected, setSelected] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<{ buildingId: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [folded, setFolded] = useFoldedBuildings(user?.id);

  const { data, loading, error, reload: reloadData } = useApi<Board>(`/housekeeping/board?date=${date}`);
  // The side menu's counts (open jobs, today's work) follow what was just done here.
  const reload = useCallback(() => { reloadData(); void refreshNavCounts(); }, [reloadData]);
  const { cleaners } = useCleaners(true);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const departures = useMemo(() => data?.departures ?? [], [data]);
  const repairs = data?.repairs ?? [];
  useEffect(() => { setTicked(new Set()); }, [date]);

  const buildingOptions: SelectOption[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.buildingId, r.propertyName);
    for (const d of departures) m.set(d.buildingId, d.propertyName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [rows, departures]);
  const cleanerOptions: SelectOption[] = [{ value: 'none', label: 'Unassigned' }, ...cleaners.map(c => ({ value: c.id, label: c.name }))];

  const byFilters = (r: Row) => (!building || r.buildingId === building)
    && (!cleaner || (cleaner === 'none' ? isUnassigned(r) : (r.cleaners?.some(c => c.id === cleaner) || r.cleanerId === cleaner)));
  const base = rows.filter(byFilters);
  const baseDepartures = departures.filter(d => (!building || d.buildingId === building) && (!cleaner || cleaner === 'none'));
  const counts: Record<Stage | 'all', number> = { all: base.length + baseDepartures.length, ready: 0, cleaning: 0, todo: 0, unplanned: baseDepartures.length, done: 0 };
  for (const r of base) counts[STAGE_OF[r.status]]++;
  const visible = base.filter(r => stage === 'all' || STAGE_OF[r.status] === stage);
  const visibleDepartures = stage === 'all' || stage === 'unplanned' ? baseDepartures : [];

  // One group per building, in name order; inside, what needs doing first, then by clean-by time.
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }>();
    const get = (id: string, name: string) => m.get(id) ?? (m.set(id, { id, name, rows: [], departures: [], repairs: [] }), m.get(id)!);
    for (const r of visible) get(r.buildingId, r.propertyName).rows.push(r);
    for (const d of visibleDepartures) get(d.buildingId, d.propertyName).departures.push(d);
    for (const w of repairs) if (m.has(w.buildingId)) m.get(w.buildingId)!.repairs.push(w);
    const by = (r: Row) => `${STAGE_RANK[STAGE_OF[r.status]]}|${r.next?.checkInAt ?? '9'}|${r.unitNumber}`;
    for (const g of m.values()) g.rows.sort((a, b) => by(a).localeCompare(by(b)));
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [visible, visibleDepartures, repairs]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows.length, done = rows.filter(r => r.status === 'done').length;
  const unassigned = rows.filter(r => r.status !== 'done' && isUnassigned(r)).length;
  const sel = rows.find(r => r.id === selected) ?? null;
  useEffect(() => { if (selected && data && !rows.some(r => r.id === selected)) setSelected(null); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const allFolded = groups.length > 1 && groups.every(g => folded[g.id]);

  // ?task=<id> (from a notification): open that job on its own day.
  const linkedTask = params.get('task');
  useEffect(() => {
    if (!linkedTask) return;
    let live = true;
    api.get<{ day: string | null }>(`/housekeeping/tasks/${encodeURIComponent(linkedTask)}`).then(t => {
      if (!live) return;
      setParams(p => { const n = new URLSearchParams(p); n.delete('task'); if (t.day && t.day !== today) n.set('day', t.day); else n.delete('day'); return n; }, { replace: true });
      setSelected(linkedTask);
    }).catch(() => { if (live) setParams(p => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true }); });
    return () => { live = false; };
  }, [linkedTask]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string, fn: () => Promise<unknown>, ok: { title: string; body?: string }) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', ...ok }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); }
    finally { setBusy(null); }
  }
  const guestLeft = (body: { taskId?: string; reservationId?: string }, unit: string) =>
    act(`left-${body.taskId ?? body.reservationId}`, () => api.post('/housekeeping/guest-left', body), { title: `${unit}: guest out.`, body: 'Ready to clean.' });
  const plan = (d: Departure) =>
    act(`plan-${d.reservationId}`, () => api.post('/housekeeping/plan', { reservationIds: [d.reservationId] }), { title: `Cleaning job planned for ${d.unitNumber}.` });
  const planAll = () =>
    act('plan-all', () => api.post('/housekeeping/plan', { reservationIds: baseDepartures.map(d => d.reservationId) }), { title: `${plural(baseDepartures.length, 'cleaning job')} planned.` });
  const autoAssign = () =>
    act('auto', async () => { const r = await api.post<{ assigned: number }>('/housekeeping/auto-assign', {}); if (!r.assigned) throw new ApiFailure(409, 'NONE', 'Every cleaning job from today on already has a cleaner.'); }, { title: 'Cleaning jobs assigned.', body: 'Unassigned jobs from today on now have a cleaner.' });

  async function bulkAssign(ids: string[], mode: 'add' | 'replace') {
    setBulkBusy(true);
    try {
      const r = await api.post<{ assigned: number; skipped: { id: string; reason: string }[]; cleaner: string }>('/tasks/bulk-assign', { taskIds: [...ticked], cleanerIds: ids, mode });
      toast({
        tone: r.skipped.length ? 'warning' : 'success',
        title: r.assigned ? `${plural(r.assigned, 'cleaning job')}: ${mode === 'add' ? 'added' : 'now'} ${r.cleaner}.` : 'Nothing assigned.',
        body: r.skipped.length ? `${plural(r.skipped.length, 'job')} left alone: ${[...new Set(r.skipped.map(s => s.reason))].slice(0, 2).join('; ')}` : undefined,
      });
      setBulkOpen(false); setTicked(new Set()); reload();
    } catch (e) { toast({ tone: 'critical', title: 'Not assigned.', body: errorMessage(e, 'Try again in a moment.') }); }
    setBulkBusy(false);
  }

  const subtitle = data
    ? `${dayLabel(date)} · ${plural(total, 'cleaning job')} · ${done} done${unassigned ? ` · ${unassigned} unassigned` : ''}${departures.length ? ` · ${plural(departures.length, 'departure')} with no job` : ''}`
    : dayLabel(date);
  const filtered = !!(building || cleaner || stage !== 'all');
  const clear = () => setParams(p => { const n = new URLSearchParams(p); ['stage', 'cleaner', 'building'].forEach(k => n.delete(k)); return n; }, { replace: true });
  const toggleTick = (id: string, on?: boolean) => setTicked(t => { const n = new Set(t); if (on ?? !n.has(id)) n.add(id); else n.delete(id); return n; });

  const list = (
    <>
      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex flex-col gap-3">{[0, 1].map(i => <div key={i} className="bg-card rounded-card border border-solid border-line p-3 flex flex-col gap-2"><Skeleton width="40%" height={14} /><Skeleton height={32} /><Skeleton height={32} /></div>)}</div>
      ) : groups.length === 0 ? (
        <EmptyState icon="Sparkles" kind={filtered ? 'filtered' : 'empty'}
          title={filtered ? 'No cleaning jobs match these filters.' : `No cleaning jobs on ${dayLabel(date)}.`}
          body={filtered ? undefined : 'Cleaning jobs appear when guests check out. Add one by hand for a deep clean or a refresh.'}
          action={filtered ? { label: 'Clear filters', onClick: clear } : { label: 'New cleaning job', onClick: () => setCreating(true) }} />
      ) : groups.map(g => (
        <BuildingCard key={g.id} group={g} now={now} future={date > today} selected={selected} busy={busy} phone={phone} cleaners={cleaners}
          folded={!!folded[g.id]} onFold={() => setFolded(f => ({ ...f, [g.id]: !f[g.id] }))}
          ticked={ticked} onTick={toggleTick}
          onSelect={id => setSelected(id)} onGuestLeft={guestLeft} onPlan={plan} onChanged={reload}
          onAssign={() => setAssignFor({ buildingId: g.id, name: g.name })} />
      ))}
      {ticked.size > 0 && (
        <div className="sticky bottom-0 z-[5] mt-auto flex items-center gap-2 flex-wrap bg-black text-white rounded-card px-3 py-2 shadow-[var(--shadow-overlay)]">
          <span className="text-copy font-medium flex-1 min-w-0">{plural(ticked.size, 'cleaning job')} ticked</span>
          <span className="relative">
            <Button size="sm" variant="brand" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setBulkOpen(v => !v)}>Assign cleaners</Button>
            {bulkOpen && (
              <div className={phone ? 'fixed inset-x-0 bottom-0 z-[61] bg-card text-ink rounded-t-[14px] p-4 shadow-[var(--shadow-overlay)]' : 'absolute bottom-[calc(100%+8px)] right-0 z-[61] bg-card text-ink rounded-card border border-solid border-line p-3 shadow-[var(--shadow-overlay)]'}>
                <CleanerChecklist cleaners={cleaners} initial={[]} modes busy={bulkBusy} saveLabel="Assign" onCancel={() => setBulkOpen(false)} onSave={(ids, mode) => void bulkAssign(ids, mode)} />
              </div>
            )}
          </span>
          <button type="button" onClick={() => { setTicked(new Set()); setBulkOpen(false); }} className="h-8 px-2 border-none bg-transparent text-white cursor-pointer font-sans text-meta underline underline-offset-2">Clear</button>
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <PageHeader title="Cleaning" sub={subtitle}
        actions={<>
          <Button size="sm" variant="secondary" icon={<Icon name="Users" size="sm" />} onClick={() => navigate('/operations/cleaners')}>Cleaners</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Shuffle" size="sm" />} loading={busy === 'auto'} onClick={() => void autoAssign()}>Auto-assign</Button>
        </>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>New cleaning job</Button>} />
      <TabSwitch tab="board" onTab={onTab} />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <DayPicker value={date} today={today} phone={phone} onChange={d => setParam('day', d === today ? null : d)} />
          <Select label="Cleaner" value={cleaner} onChange={v => setParam('cleaner', v)} options={cleanerOptions} placeholder="All cleaners" className="flex-1 min-w-[130px] md:flex-none md:w-[150px]" />
          <Select label="Building" value={building} onChange={v => setParam('building', v)} options={buildingOptions} placeholder="All buildings" className="flex-1 min-w-[130px] md:flex-none md:w-[170px]" />
          {groups.length > 1 && (
            <Button size="sm" variant="tertiary" icon={<Icon name={allFolded ? 'UnfoldVertical' : 'FoldVertical'} size="sm" />}
              onClick={() => setFolded(allFolded ? {} : Object.fromEntries(groups.map(g => [g.id, true])))}>{allFolded ? 'Expand all' : 'Collapse all'}</Button>
          )}
          {baseDepartures.length > 0 && (
            <Button size="sm" variant="brand" loading={busy === 'plan-all'} onClick={() => void planAll()} className="md:ml-auto">
              Plan jobs for {plural(baseDepartures.length, 'departure')}
            </Button>
          )}
        </div>
        <div role="tablist" aria-label="What needs doing" className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 md:mx-0 md:px-0">
          {STAGES.map(s => {
            const on = stage === s.value;
            const n = counts[s.value];
            return (
              <button key={s.value} type="button" role="tab" aria-selected={on} onClick={() => setParam('stage', s.value === 'all' ? null : s.value)}
                className={cx('flex-none h-8 inline-flex items-center gap-1.5 px-3 rounded-pill cursor-pointer font-sans text-meta border border-solid whitespace-nowrap',
                  on ? 'font-semibold border-transparent bg-black text-white' : 'font-medium border-line bg-card text-muted-ink hover:bg-muted', !on && !n && s.value !== 'all' && 'opacity-60')}>
                {s.label}<span className={cx('[font-variant-numeric:tabular-nums]', on ? 'text-gold' : 'text-ink')}>{data ? n : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SplitPane list={list} open={!!sel} onClose={() => setSelected(null)} width={380}
        empty={<div className="text-center text-copy text-muted-ink p-6 max-w-[240px]"><Icon name="MousePointerClick" size="lg" /><p className="mt-2">Pick a unit to see its door code, photos and who is on the job.</p></div>}
        detail={sel ? <CleanDetail key={sel.id} row={sel} now={now} phone={phone} cleaners={cleaners} onClose={() => setSelected(null)} onChanged={reload} onGuestLeft={() => void guestLeft({ taskId: sel.id }, sel.unitNumber)} /> : null} />

      {creating && <NewCleanModal date={date} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {assignFor && (
        <AssignBuildingModal building={assignFor} date={date} onClose={() => setAssignFor(null)}
          onDone={(n, who) => { setAssignFor(null); toast({ tone: 'success', title: `${plural(n, 'cleaning job')} in ${assignFor.name} given to ${who}.` }); reload(); }} />
      )}
    </div>
  );
}

/* ---------- one building ---------- */

// Columns follow the card's own width, not the window's: with the detail panel open the list is narrow on a laptop.
const COLS = '@3xl:grid @3xl:grid-cols-[22px_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,0.75fr)_minmax(0,0.55fr)_minmax(0,0.95fr)_minmax(0,1.2fr)] @3xl:items-center @3xl:gap-2';
const TIME = 'font-semibold [font-variant-numeric:tabular-nums]';

function BuildingCard({ group, now, future, selected, busy, phone, cleaners, folded, onFold, ticked, onTick, onSelect, onGuestLeft, onPlan, onAssign, onChanged }: {
  group: { id: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }; now: number; future: boolean; selected: string | null; busy: string | null;
  phone: boolean; cleaners: ReturnType<typeof useCleaners>['cleaners']; folded: boolean; onFold: () => void;
  ticked: Set<string>; onTick: (id: string, on?: boolean) => void;
  onSelect: (id: string) => void; onGuestLeft: (b: { taskId?: string; reservationId?: string }, unit: string) => void; onPlan: (d: Departure) => void; onAssign: () => void; onChanged: () => void;
}) {
  const jobs = group.rows.length + group.departures.length;
  const doneN = group.rows.filter(r => r.status === 'done').length;
  const readyN = group.rows.filter(r => r.status === 'ready').length;
  const open = group.rows.filter(r => r.status !== 'done');
  const unassigned = open.filter(isUnassigned).length;
  const names = [...new Set(group.rows.flatMap(r => (r.cleaners?.length ? r.cleaners.map(c => c.name) : r.assigneeName ? [r.assigneeName] : [])))];
  const openIds = open.map(r => r.id);
  const allTicked = openIds.length > 0 && openIds.every(id => ticked.has(id));
  return (
    <section className="@container bg-card rounded-card border border-solid border-line flex-none">
      <header className={cx('flex items-center gap-2 px-3 py-1.5 bg-muted rounded-t-card', folded && 'rounded-b-card')}>
        {openIds.length > 0 && !phone && (
          <input type="checkbox" checked={allTicked} onChange={e => openIds.forEach(id => onTick(id, e.target.checked))} aria-label={`Tick every open job in ${group.name}`} className="w-4 h-4 accent-black flex-none cursor-pointer" />
        )}
        <button type="button" onClick={onFold} aria-expanded={!folded} className="flex-1 min-w-0 flex items-center gap-1.5 h-8 p-0 border-none bg-transparent cursor-pointer font-sans text-left text-ink">
          <Icon name={folded ? 'ChevronRight' : 'ChevronDown'} size="sm" color="var(--color-text-muted)" />
          <b className="text-copy font-semibold truncate">{group.name}</b>
          <span className="text-meta text-muted-ink whitespace-nowrap">{plural(jobs, 'job')}{readyN ? ` · ${readyN} ready` : ''} · {doneN} done</span>
        </button>
        <span className="hidden @xl:inline text-meta text-muted-ink truncate max-w-[40%]">
          {unassigned > 0 ? <span className="text-danger font-medium">{unassigned} unassigned</span> : names.length ? <>Cleaners <b className="text-ink font-medium">{names.length <= 2 ? names.join(', ') : `${names.length} people`}</b></> : null}
        </span>
        {open.length > 0 && <Button size="sm" variant="tertiary" onClick={onAssign}>Assign building</Button>}
      </header>
      {!folded && (
        <>
          <div className={cx('hidden text-caption font-medium text-muted-ink px-3 py-1 [border-bottom:1px_solid_var(--color-line-soft)]', COLS)}>
            <div /><div>Unit · layout</div><div>Leaving</div><div>Arriving · clean by</div><div>Time left</div><div>Type</div><div>Cleaners</div><div>Status</div>
          </div>
          {group.rows.map(r => (
            <CleanRow key={r.id} r={r} now={now} phone={phone} cleaners={cleaners} active={r.id === selected} busy={busy === `left-${r.id}`}
              ticked={ticked.has(r.id)} onTick={() => onTick(r.id)} onChanged={onChanged}
              onSelect={() => onSelect(r.id)} onGuestLeft={() => onGuestLeft({ taskId: r.id }, r.unitNumber)} />
          ))}
          {group.departures.map(d => (
            <div key={d.reservationId} className={cx('px-3 py-2 @3xl:py-1.5 [border-top:1px_solid_var(--color-line-soft)] text-copy flex flex-col gap-1', COLS)}>
              <div className="hidden @3xl:block" />
              <UnitCell unit={d.unitNumber} layout={d.layout} extra={<span className="@3xl:hidden"><StatusBadge tone="critical" size="sm">No cleaning job</StatusBadge></span>} />
              <div className="min-w-0 truncate"><span className="@3xl:hidden text-muted-ink">Out </span><span className={TIME}>{d.checkOutTime}</span> <span className="text-ink-2">{d.guestName}</span>
                {d.lateCheckOut && <StatusBadge tone="warning" size="sm" className="ml-1">Late</StatusBadge>}{d.state === 'checked_out' && <StatusBadge tone="gold" size="sm" className="ml-1">Out</StatusBadge>}</div>
              <ArrivingCell next={d.next} phone={phone} onChanged={onChanged} />
              <div><span className="@3xl:hidden text-muted-ink">Time left </span><TimeLeft at={d.next?.checkInAt} now={now} /></div>
              <div className="hidden @3xl:block text-muted-ink">—</div>
              <div className="hidden @3xl:block text-muted-ink">—</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="hidden @3xl:inline"><StatusBadge tone="critical" size="sm">No job</StatusBadge></span>
                <Button size="sm" variant="primary" loading={busy === `plan-${d.reservationId}`} onClick={() => onPlan(d)}>Plan</Button>
                {d.state !== 'checked_out' && !future && <Button size="sm" variant="secondary" loading={busy === `left-${d.reservationId}`} onClick={() => onGuestLeft({ reservationId: d.reservationId }, d.unitNumber)}>Guest left</Button>}
              </div>
            </div>
          ))}
          {group.repairs.length > 0 && (
            <div className="px-3 py-1.5 [border-top:1px_solid_var(--color-line-soft)] bg-page rounded-b-card flex flex-col gap-0.5">
              {group.repairs.map(w => (
                <div key={w.id} className="flex items-center gap-2 text-meta flex-wrap">
                  <Icon name="Wrench" size="sm" color="var(--color-gold-ink)" />
                  <span><b>{w.unitNumber}</b> repair {hm(w.startsAt)}–{hm(w.endsAt)}: {w.title}{w.assigneeName ? ` (${w.assigneeName})` : ''}</span>
                  {w.overlaps.length > 0 && <StatusBadge tone="critical" size="sm">Overlaps a stay</StatusBadge>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function UnitCell({ unit, layout, extra }: { unit: string; layout?: string | null; extra?: ReactNode }) {
  return (
    <div className="min-w-0 flex items-baseline gap-x-2 gap-y-0 flex-wrap @3xl:flex-col @3xl:gap-0">
      <b className="text-ink whitespace-nowrap">{unit}</b>
      {layout && <span className="text-meta text-muted-ink whitespace-nowrap">{layout}</span>}
      {extra}
    </div>
  );
}

/** Arriving guest: clean-by time big (their expected arrival when recorded, else check-in), name, and the ETA editor. */
function ArrivingCell({ next, phone, onChanged }: { next: Row['next'] | Departure['next']; phone: boolean; onChanged: () => void }) {
  if (!next) return <div className="text-muted-ink"><span className="@3xl:hidden">In </span>No arrival</div>;
  const eta = next.expectedArrival ?? null;
  return (
    <div className="min-w-0 flex items-center gap-1.5">
      <span className="@3xl:hidden text-muted-ink">In </span>
      <span className={TIME} title={eta ? `Expected ${eta}; check-in ${next.checkInTime}` : `Check-in ${next.checkInTime}`}>{eta ?? next.checkInTime}</span>
      <span className="min-w-0 truncate text-ink-2">{next.guestName}</span>
      {'earlyCheckIn' in next && next.earlyCheckIn && <StatusBadge tone="warning" size="sm">Early</StatusBadge>}
      {next.reservationId && <EtaEditor reservationId={next.reservationId} eta={eta} checkInTime={next.checkInTime} phone={phone} onSaved={onChanged} compact />}
    </div>
  );
}

function CleanRow({ r, now, phone, cleaners, active, busy, ticked, onTick, onSelect, onGuestLeft, onChanged }: {
  r: Row; now: number; phone: boolean; cleaners: ReturnType<typeof useCleaners>['cleaners']; active: boolean; busy: boolean; ticked: boolean;
  onTick: () => void; onSelect: () => void; onGuestLeft: () => void; onChanged: () => void;
}) {
  const st = statusOf('cleaning', r.status);
  const files = r.photoCount + r.videoCount;
  const doneJob = r.status === 'done';
  const canMarkLeft = r.previous && !r.guestOut && !doneJob && r.status !== 'cleaning' && r.day <= mytDay(0);
  const damage = r.damage ?? [];
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={cx('px-3 py-2 @3xl:py-1.5 [border-top:1px_solid_var(--color-line-soft)] text-copy cursor-pointer flex flex-col gap-1 outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-gold)]', COLS,
        active ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : 'hover:bg-page', doneJob && 'text-muted-ink')}>
      <div className="hidden @3xl:flex items-center" onClick={e => e.stopPropagation()}>
        {!doneJob && <input type="checkbox" checked={ticked} onChange={onTick} aria-label={`Tick ${r.unitNumber}`} className="w-4 h-4 accent-black cursor-pointer" />}
      </div>
      <UnitCell unit={r.unitNumber} layout={r.layout}
        extra={<>
          {r.carriedOver && <StatusBadge tone="warning" size="sm">From {dayLabel(r.day)}</StatusBadge>}
          <span className="@3xl:hidden ml-auto"><StatusBadge tone={st.tone} size="sm">{st.label}</StatusBadge></span>
        </>} />
      <div className="min-w-0 flex items-center gap-1.5">
        <span className="@3xl:hidden text-muted-ink">Out </span>
        {r.previous ? <><span className={TIME}>{r.previous.checkOutTime}</span><span className="min-w-0 truncate text-ink-2">{r.previous.guestName}</span></> : <span className="text-muted-ink">No departing guest</span>}
        {r.previous?.lateCheckOut && <StatusBadge tone="warning" size="sm">Late</StatusBadge>}
        {r.guestOut && r.guestLeftAt && <span className="text-meta text-gold-ink whitespace-nowrap font-medium">Left {hm(r.guestLeftAt)}</span>}
      </div>
      <ArrivingCell next={r.next} phone={phone} onChanged={onChanged} />
      <div><span className="@3xl:hidden text-muted-ink">Time left </span><TimeLeft at={r.next?.checkInAt} now={now} done={doneJob} /></div>
      <div className="text-meta"><span className="@3xl:hidden text-muted-ink">Type </span>{KIND_LABEL[r.kind] ?? r.kind}</div>
      <div className="min-w-0"><span className="@3xl:hidden text-muted-ink">Cleaners </span>
        <CrewCell taskId={r.id} crew={r.cleaners ?? []} fallback={r.assigneeName} cleaners={cleaners} phone={phone} onSaved={onChanged} disabled={doneJob} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <span className="hidden @3xl:inline"><StatusBadge tone={st.tone} size="sm" className="whitespace-normal">{doneJob && files ? `Done · ${plural(files, 'file')}` : st.label}</StatusBadge></span>
        {damage.length > 0 && <StatusBadge tone="warning" size="sm" title={damage.map(d => `${d.title} · ${statusOf('maintenance', d.state).label}`).join('\n')}>{damage.length === 1 ? 'Damage reported' : `${damage.length} damage reports`}</StatusBadge>}
        {canMarkLeft && <Button size="sm" variant="secondary" loading={busy} onClick={e => { e.stopPropagation(); onGuestLeft(); }}>Guest left</Button>}
      </div>
    </div>
  );
}

/* ---------- the detail panel ---------- */

function CleanDetail({ row, now, phone, cleaners, onClose, onChanged, onGuestLeft }: {
  row: Row; now: number; phone: boolean; cleaners: ReturnType<typeof useCleaners>['cleaners']; onClose: () => void; onChanged: () => void; onGuestLeft: () => void;
}) {
  const toast = useToast();
  const { data, reload, error } = useApi<Detail>(`/housekeeping/tasks/${row.id}`);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [damage, setDamage] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [kindPicked, setKindPicked] = useState<string | undefined>(undefined);
  useEffect(() => { setKindPicked(undefined); }, [row.kind]);

  const refresh = useCallback(() => { reload(); onChanged(); }, [reload, onChanged]);
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); return true; }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); return false; }
    finally { setBusy(null); }
  }
  async function reveal(id: string) {
    try { const r = await api.get<{ secret: string }>(`/access-credentials/${id}?reveal=true`); setRevealed(x => ({ ...x, [id]: r.secret || '(no code set)' })); }
    catch (e) { toast({ tone: 'critical', title: 'Code not shown.', body: errorMessage(e, 'Try again.') }); }
  }

  const done = row.state === 'resolved';
  const files = data?.media.length ?? row.photoCount + row.videoCount;
  const used = row.startedAt ? (Date.parse(row.completedAt ?? new Date(now).toISOString()) - Date.parse(row.startedAt)) / 60000 : null;
  const unitLabel = `${row.propertyName} ${row.unitNumber}`;
  const kind = kindPicked ?? row.kind;
  const kindName = KIND_NAME[kind] ?? 'Standard clean';
  const st = statusOf('cleaning', row.status);
  const reports = data?.damage ?? (row.damage ?? []).map(d => ({ ...d, reportedAt: '' }));
  const sectionTitle = 'm-0 text-meta font-semibold uppercase tracking-[0.05em] text-muted-ink';
  const fileRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-3 p-4 text-copy">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-meta text-muted-ink truncate">{row.propertyName}</div>
          <div className="text-title font-semibold leading-tight">{row.unitNumber}</div>
          <div className="text-meta text-muted-ink">{[row.layout, kindName].filter(Boolean).join(' · ')}</div>
        </div>
        <StatusBadge tone={st.tone} size="sm">{st.label}</StatusBadge>
        <CloseButton onClick={onClose} />
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-control bg-muted p-2 flex flex-col gap-0.5 min-w-0">
          <span className="text-caption text-muted-ink">Leaving</span>
          {row.previous ? <><span className="min-w-0"><b className={TIME}>{row.previous.checkOutTime}</b> <span className="[overflow-wrap:anywhere]">{row.previous.guestName}</span></span>
            {row.previous.lateCheckOut && <span className="text-meta text-warning">Late check-out</span>}
            {row.guestOut ? <span className="text-meta text-gold-ink font-medium">Guest out{row.guestLeftAt ? ` at ${hm(row.guestLeftAt)}` : ''}</span>
              : !done && row.day <= mytDay(0) && <Button size="sm" variant="secondary" className="mt-1 self-start" onClick={onGuestLeft}>Guest left</Button>}</>
            : <span className="text-muted-ink">No departing guest</span>}
        </div>
        <div className="rounded-control bg-gold-tint p-2 flex flex-col gap-0.5 min-w-0">
          <span className="text-caption text-muted-ink">Arriving · clean by</span>
          {row.next ? <><span className="min-w-0"><b className={TIME}>{row.next.expectedArrival ?? row.next.checkInTime}</b> <span className="[overflow-wrap:anywhere]">{row.next.guestName}</span>{row.next.guests ? ` · ${plural(row.next.guests, 'guest')}` : ''}</span>
            <span className="text-meta">Time left <TimeLeft at={row.next.checkInAt} now={now} done={done} /></span>
            <span className="text-meta text-muted-ink">Check-in {row.next.checkInTime}{row.next.earlyCheckIn ? ' (early)' : ''}</span>
            <span className="mt-0.5"><EtaEditor reservationId={row.next.reservationId} eta={row.next.expectedArrival ?? null} checkInTime={row.next.checkInTime} phone={phone} onSaved={onChanged}>
              {row.next.expectedArrival ? `Expected ${row.next.expectedArrival} · change` : <><Icon name="Clock" size="sm" />Record expected arrival</>}
            </EtaEditor></span></>
            : <span className="text-muted-ink">No arrival</span>}
        </div>
      </div>

      <section className="flex flex-col gap-1">
        <h3 className={sectionTitle}>Cleaners</h3>
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0">
            <CrewCell taskId={row.id} crew={row.cleaners ?? []} fallback={row.assigneeName} cleaners={cleaners} phone={phone} onSaved={onChanged} disabled={done} />
          </span>
          <span className="text-meta text-muted-ink whitespace-nowrap">{row.startedAt ? `Started ${hm(row.startedAt)}` : ''}{used != null ? ` · ${done ? 'took' : 'for'} ${minutesLabel(used)}` : ''}</span>
        </div>
        {(row.cleaners?.length ?? 0) > 1 && <span className="text-meta text-muted-ink">{row.cleaners!.map(c => c.name).join(', ')}</span>}
      </section>

      <section className="flex flex-col gap-1.5" ref={fileRef}>
        <h3 className={sectionTitle}>Proof of work <span className="normal-case tracking-normal font-normal">{plural(files, 'photo or video', 'photos and videos')}{!done && files === 0 ? ', at least 1 to finish' : ''}</span></h3>
        {data && <MediaGrid items={data.media} cols={phone ? 3 : 4} />}
        {!done && (phone
          ? <div className="grid grid-cols-2 gap-2">
              <MediaDrop compact capture label="Take photo" upload={uploadTo(`/tasks/${row.id}/photos`)} onDone={refresh} />
              <MediaDrop compact label="From gallery" upload={uploadTo(`/tasks/${row.id}/photos`)} onDone={refresh} />
            </div>
          : <MediaDrop compact upload={uploadTo(`/tasks/${row.id}/photos`)} onDone={refresh} label="Add photos or videos" />)}
      </section>

      {!done && (
        <div className="flex gap-2">
          {row.state !== 'in_progress' && (
            <Button variant="secondary" className="flex-1" loading={busy === 'start'} onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${row.id}/start`, {}), 'Cleaning started.')}>Start</Button>
          )}
          <Button variant="primary" className="flex-1" loading={busy === 'complete'} disabled={files === 0} disabledReason="Add at least one photo or video first."
            onClick={() => void act('complete', async () => {
              const r = await api.post<{ cost: { amount: number; created: boolean; reason: string | null } | null }>(`/tasks/${row.id}/complete`, { photoIds: [] });
              if (r.cost && !r.cost.created && r.cost.reason && r.cost.reason !== 'already charged') toast({ tone: 'info', title: 'Cost not added.', body: `Not charged to the unit: ${r.cost.reason}.` });
            }, 'Cleaning job done.', `${unitLabel} is ready.`)}>
            Mark done
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className={sectionTitle}>Damage</h3>
          <Button size="sm" variant="tertiary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>Report damage</Button>
        </div>
        {reports.length === 0 ? <span className="text-meta text-muted-ink">None reported. A report opens a Maintenance job on this unit.</span>
          : reports.map(d => {
            const s = statusOf('maintenance', d.state);
            return (
              <a key={d.id} href={`#/operations/maintenance?id=${d.id}`} className="flex items-center gap-2 text-copy no-underline text-ink hover:underline min-w-0">
                <span className="min-w-0 truncate">Reported: {d.title}</span>
                <StatusBadge tone={s.tone} size="sm">{s.label}</StatusBadge>
              </a>
            );
          })}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className={sectionTitle}>Door access</h3>
        {!data ? <Skeleton height={32} /> : data.access.length === 0 ? <span className="text-meta text-muted-ink">No access details on this unit. Add them on the unit's Access tab.</span>
          : data.access.map(a => (
            <div key={a.id} className="rounded-control bg-muted px-2.5 py-1.5 flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium">{a.label}</span>
                {a.hasCode && (revealed[a.id]
                  ? <span className="font-mono text-heading">{revealed[a.id]}</span>
                  : <>{a.masked && <span className="font-mono text-muted-ink">{a.masked}</span>}
                    {data.mayReveal && <button type="button" onClick={() => void reveal(a.id)} className="p-0 border-none bg-transparent font-sans text-gold-ink font-medium cursor-pointer underline-offset-2 hover:underline">Show</button>}</>)}
              </div>
              {a.instruction && <span className="text-meta text-muted-ink">{a.instruction}</span>}
            </div>
          ))}
        {data && !data.mayReveal && data.access.some(a => a.hasCode) && <span className="text-meta text-muted-ink">Codes are shown to operations managers and management only.</span>}
      </section>

      {!done && (
        <FormRow label="Type">
          <select className={cx(INPUT, 'h-9')} value={kind} disabled={busy === 'kind'} onChange={e => { const v = e.target.value; setKindPicked(v); void act('kind', () => api.patch(`/housekeeping/tasks/${row.id}`, { kind: v, title: v === 'deep_clean' ? 'Deep clean' : row.title }), 'Type changed.').then(ok => { if (!ok) setKindPicked(undefined); }); }}>
            <option value="turnover">Standard</option><option value="deep_clean">Deep</option><option value="light_clean">Light</option>
          </select>
        </FormRow>
      )}
      {data?.cost && (
        <p className="m-0 text-meta text-muted-ink">
          {data.cost.charged ? `Charged to the unit: ${kindName} ${rm(data.cost.amount)}.` : `Charged to the unit when done: ${kindName} ${rm(data.cost.amount)} (${COST_SOURCE[data.cost.source]}).`}
        </p>
      )}
      {done && row.completedAt && <p className="m-0 text-meta text-muted-ink">Done {stamp(row.completedAt)}.</p>}

      <HistoryDisclosure entity="tasks" id={row.id} refreshKey={data} />

      {damage && (
        <QuickDamageModal unitId={row.unitId} unitLabel={unitLabel} taskId={row.id} onClose={() => setDamage(false)}
          onDone={() => { setDamage(false); toast({ tone: 'success', title: 'Damage reported.', body: 'A Maintenance job is open on this unit.' }); refresh(); }} />
      )}
    </div>
  );
}

/* ---------- dialogs ---------- */

function NewCleanModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const units = useUnitRoster();
  const { cleaners } = useCleaners(true);
  const [unitId, setUnitId] = useState('');
  const [day, setDay] = useState(date);
  const [kind, setKind] = useState('turnover');
  const [cleanerId, setCleanerId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unitOptions = units.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName }));
  async function save() {
    if (!unitId) { setError('Pick a unit.'); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/housekeeping/tasks', { unitId, date: day, kind, cleanerId: cleanerId || undefined, instructions: notes.trim() || undefined, title: kind === 'deep_clean' ? 'Deep clean' : kind === 'light_clean' ? 'Light clean' : 'Turnover clean' });
      onDone();
    } catch (e) { setError(errorMessage(e, 'Not saved. Try again.')); setBusy(false); }
  }
  return (
    <OpsModal title="New cleaning job" sub="For a deep clean, a refresh, or a turnover the reservations did not create." onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Add cleaning job</Button></>}>
      <FormRow label="Unit" error={error}>
        <SearchSelect label="Unit" value={unitId} onChange={setUnitId} options={unitOptions} placeholder="Search units" size="md" />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Day"><DateField aria-label="Day" className={INPUT} value={day} onChange={v => v && setDay(v)} /></FormRow>
        <FormRow label="Type">
          <select className={INPUT} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="turnover">Standard</option><option value="deep_clean">Deep</option><option value="light_clean">Light</option>
          </select>
        </FormRow>
      </div>
      <FormRow label="Cleaner (optional, add more on the board)">
        <select className={INPUT} value={cleanerId} onChange={e => setCleanerId(e.target.value)}>
          <option value="">Assign later</option>
          {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </FormRow>
      <FormRow label="Notes for the cleaner (optional)"><textarea className={TEXTAREA} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} /></FormRow>
    </OpsModal>
  );
}

function AssignBuildingModal({ building, date, onClose, onDone }: { building: { buildingId: string; name: string }; date: string; onClose: () => void; onDone: (n: number, who: string) => void }) {
  const { cleaners } = useCleaners(true);
  const [cleanerId, setCleanerId] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!cleanerId) { setError('Pick a cleaner.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ assigned: number; assigneeName: string }>('/housekeeping/assign-building', { buildingId: building.buildingId, date, cleanerId, onlyUnassigned });
      onDone(r.assigned, r.assigneeName);
    } catch (e) { setError(errorMessage(e, 'Not saved. Try again.')); setBusy(false); }
  }
  return (
    <OpsModal title={`Assign ${building.name}`} sub={`Every unfinished cleaning job in this building on ${dayLabel(date)} goes to one cleaner. Add more cleaners per job on the board.`} onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Assign</Button></>}>
      <FormRow label="Cleaner" error={error}>
        <select className={INPUT} value={cleanerId} onChange={e => setCleanerId(e.target.value)}>
          <option value="">Pick a cleaner</option>
          {cleaners.map(c => <option key={c.id} value={c.id}>{c.name} · {c.busy} today</option>)}
        </select>
      </FormRow>
      <label className="flex items-center gap-2 text-copy cursor-pointer">
        <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} className="w-4 h-4 accent-black" />
        Only jobs with no cleaner yet
      </label>
    </OpsModal>
  );
}

/* ============================== history ============================== */

interface HistoryRow {
  id: string; unitNumber: string; propertyName: string; propertyId: string; kind: string; state: string; date: string;
  assigneeName: string | null; sheetCleaner: string | null; completedAt: string | null; photoCount: number;
}
interface HistoryPayload { total: number; page: number; pageSize: number; data: HistoryRow[] }

/** URL parameters the History list owns; dropped when going back to the board. */
const HISTORY_PARAMS = ['q', 'cleaner', 'from', 'to', 'state', 'sort', 'page', 'size'];
const SHOW: { value: string; label: string }[] = [
  { value: '', label: 'Finished' }, { value: 'active', label: 'Not finished' }, { value: 'all', label: 'All' },
];
const TASK_STATE: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'neutral' }, assigned: { label: 'Assigned', tone: 'info' }, in_progress: { label: 'Cleaning', tone: 'info' },
  waiting: { label: 'Waiting', tone: 'warning' }, overdue: { label: 'Overdue', tone: 'critical' }, reopened: { label: 'Reopened', tone: 'warning' },
  resolved: { label: 'Done', tone: 'success' },
};
const FIELD_ROLES = ['housekeeper', 'technician'];
const historyLabel = (r: HistoryRow) => `${r.propertyName} ${r.unitNumber}`;

function HistoryView({ onTab }: { onTab: (t: Tab) => void }) {
  const toast = useToast();
  const { user } = useSession();
  const canBulk = !!user && !FIELD_ROLES.includes(user.role);
  const [params, setParams] = useSearchParams();
  const update = (mut: (p: URLSearchParams) => void) => setParams(prev => { const n = new URLSearchParams(prev); mut(n); n.delete('page'); return n; }, { replace: true });
  const setParam = (k: string, v: string) => update(p => { if (v) p.set(k, v); else p.delete(k); });

  const cleaner = params.get('cleaner') ?? '';
  const from = params.get('from') || mytDay(-30);
  const to = params.get('to') || mytDay(0);
  const show = SHOW.some(o => o.value === params.get('state')) ? params.get('state')! : '';
  const urlQ = params.get('q') ?? '';
  const [draft, setDraft] = useState(urlQ);
  useEffect(() => {
    const t = setTimeout(() => { if (draft.trim() !== urlQ) setParam('q', draft.trim()); }, 300);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const { cleaners } = useCleaners(false);

  const sort = params.get('sort') ?? '';
  const query = useMemo(() => {
    const q: Record<string, string> = { state: show || 'resolved', kind: 'cleaning', from, to };
    if (urlQ) q.q = urlQ;
    if (cleaner) q.assignee = `c:${cleaner}`;
    if (sort) q.sort = sort;
    return q;
  }, [show, from, to, cleaner, urlQ, sort]);
  const qs = new URLSearchParams({ ...query, page: params.get('page') ?? '1', size: params.get('size') ?? '50' });
  const { data, loading, error, reload } = useApi<HistoryPayload>(`/tasks?${qs}`);

  const [bulkAssign, setBulkAssign] = useState<{ ids: string[]; clear: () => void } | null>(null);
  const [bulkAssignBusy, setBulkAssignBusy] = useState(false);
  const [confirmDone, setConfirmDone] = useState<{ rows: HistoryRow[]; clear: () => void } | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const { cleaners: active } = useCleaners(true);

  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const r = await fetchAllPages<HistoryRow>(async (page, size) => {
      const p = await api.get<HistoryPayload>('/tasks', { ...query, export: '1', page, size });
      return { rows: p.data, total: p.total };
    }, { onProgress });
    return r.rows;
  }

  /** Starts or finishes the ticked jobs one by one; finished (or already started) ones are left alone and named. */
  async function bulkMove(rows: HistoryRow[], move: 'start' | 'done', clear: () => void) {
    // A job needs a photo or video to be marked done: say so up front rather than send requests bound to be refused.
    const skip = (r: HistoryRow) => (r.state === 'resolved' ? 'Already finished' : move === 'start' && r.state === 'in_progress' ? 'Already started'
      : move === 'done' && !r.photoCount ? 'No photo or video yet' : null);
    const todo = rows.filter(r => !skip(r));
    const left = rows.filter(r => skip(r)).map(r => ({ label: historyLabel(r), reason: skip(r)! }));
    setBulkBusy(move);
    const res = await runEach(todo, r => (move === 'start'
      ? api.post(`/housekeeping/tasks/${r.id}/start`, {})
      : api.post(`/tasks/${r.id}/complete`, { photoIds: [] })), historyLabel);
    setBulkBusy(null);
    const failed = [...res.failed, ...left];
    toast({
      tone: res.ok === 0 ? 'critical' : failed.length ? 'warning' : 'success',
      title: res.ok ? `${plural(res.ok, 'cleaning job')} ${move === 'start' ? 'started' : 'marked done'}.` : move === 'start' ? 'No cleaning jobs started.' : 'No cleaning jobs marked done.',
      body: skippedNote(failed) || undefined,
    });
    clear(); setConfirmDone(null); reload();
  }

  async function assignMany(ids: string[], mode: 'add' | 'replace') {
    if (!bulkAssign) return;
    setBulkAssignBusy(true);
    try {
      const r = await api.post<{ assigned: number; skipped: { id: string; reason: string }[]; cleaner: string }>('/tasks/bulk-assign', { taskIds: bulkAssign.ids, cleanerIds: ids, mode });
      toast({ tone: r.skipped.length ? 'warning' : 'success', title: r.assigned ? `${plural(r.assigned, 'cleaning job')}: ${r.cleaner}.` : 'Nothing assigned.', body: r.skipped.length ? `${plural(r.skipped.length, 'job')} left alone (finished).` : undefined });
      bulkAssign.clear(); setBulkAssign(null); reload();
    } catch (e) { toast({ tone: 'critical', title: 'Not assigned.', body: errorMessage(e, 'Try again in a moment.') }); }
    setBulkAssignBusy(false);
  }

  const columns = useMemo<Column<HistoryRow>[]>(() => [
    { key: 'day', label: 'Day', type: 'date', value: r => r.date, sortKey: 'day', width: 110, render: r => <span className="tabular-nums whitespace-nowrap">{dayLabel(r.date)}</span> },
    { key: 'building', label: 'Building', value: r => r.propertyName, sortKey: 'building', width: 160 },
    { key: 'unit', label: 'Unit', value: r => r.unitNumber, sortKey: 'unit', width: 100, hideable: false, render: r => <span className="font-medium">{r.unitNumber}</span> },
    { key: 'kind', label: 'Type', value: r => r.kind, text: r => KIND_LABEL[r.kind] ?? r.kind, sortKey: 'kind', width: 90 },
    { key: 'cleaner', label: 'Cleaners', type: 'person', value: r => r.assigneeName ?? r.sheetCleaner, sortKey: 'cleaner', width: 170 },
    { key: 'state', label: 'Status', type: 'status', value: r => r.state, status: r => TASK_STATE[r.state] ?? { label: r.state, tone: 'neutral' }, sortKey: 'state', width: 110, hidden: !show },
    { key: 'finished', label: 'Finished', type: 'datetime', value: r => r.completedAt, sortKey: 'finished', width: 140,
      render: r => (r.completedAt ? <span className="text-muted-ink whitespace-nowrap">{stamp(r.completedAt)}</span> : <span className="text-muted-ink">—</span>) },
    { key: 'proof', label: 'Proof', type: 'number', value: r => r.photoCount, width: 70, title: 'Photos and videos on the job.' },
  ], [show]);

  const filtered = !!(urlQ || cleaner || params.get('from') || params.get('to'));
  const clearAll = () => { setDraft(''); update(p => ['q', 'cleaner', 'from', 'to'].forEach(k => p.delete(k))); };
  const showLabel = show === 'active' ? 'unfinished cleaning job' : show === 'all' ? 'cleaning job' : 'finished cleaning job';

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Cleaning" sub={data ? `${plural(data.total, showLabel)} from ${dayLabel(from)} to ${dayLabel(to)}` : 'Finished cleaning jobs'} />
      <TabSwitch tab="history" onTab={onTab} />
      <DataTable<HistoryRow>
        id="cleaning.history" columns={columns} rows={data ? data.data : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload}
        server={{ total: data?.total ?? 0, page: data?.page ?? 1, pageSize: data?.pageSize ?? 50, sizes: [25, 50, 100], defaultPageSize: 50, fetchAll }}
        viewParams={['state', 'cleaner', 'q']} filtered={filtered} onClearFilters={clearAll}
        noun={['cleaning job', 'cleaning jobs']} exportName="cleaning-history" selectionKey={`${show}|${from}|${to}`}
        empty={{ title: show === 'active' ? 'No unfinished cleaning jobs in these dates.' : 'No cleaning jobs in these dates.', icon: 'Sparkles' }}
        selectable={canBulk}
        bulkActions={(picked, clear) => <>
          <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setBulkAssign({ ids: picked.map(r => r.id), clear })}>Assign cleaners</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Play" size="sm" />} loading={bulkBusy === 'start'} onClick={() => void bulkMove(picked, 'start', clear)}>Start</Button>
          <Button size="sm" variant="primary" icon={<Icon name="CheckCircle2" size="sm" />} onClick={() => setConfirmDone({ rows: picked, clear })}>Mark done</Button>
        </>}
        header={
          <div className="flex items-center gap-2 flex-wrap py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
            <div role="tablist" aria-label="Which cleaning jobs" className="flex gap-2 overflow-x-auto [scrollbar-width:none] max-md:w-full">
              {SHOW.map(o => {
                const on = show === o.value;
                return (
                  <button key={o.value || 'finished'} type="button" role="tab" aria-selected={on} onClick={() => setParam('state', o.value)}
                    className={cx('flex-none h-8 inline-flex items-center gap-[6px] px-[13px] py-0 rounded-pill cursor-pointer [font-family:inherit] text-copy border border-solid whitespace-nowrap',
                      on ? 'font-semibold border-transparent bg-black text-white' : 'font-medium border-line bg-page text-muted-ink')}>
                    {o.label}
                    {on && data && <span className="[font-variant-numeric:tabular-nums] opacity-80">{count(data.total)}</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 flex-wrap ml-auto max-md:ml-0 max-md:w-full">
              <Select label="Cleaner" value={cleaner} onChange={v => setParam('cleaner', v)} options={[{ value: '', label: 'All cleaners' }, ...cleaners.map(c => ({ value: c.id, label: c.name }))]} className="w-[160px] max-md:flex-1" />
              <label className="flex items-center gap-1.5 text-meta text-muted-ink">From <DateField aria-label="From" value={from} max={to || undefined} onChange={v => { if (v) setParam('from', v); }} className={cx(INPUT, 'h-9 w-auto')} /></label>
              <label className="flex items-center gap-1.5 text-meta text-muted-ink">To <DateField aria-label="To" value={to} min={from || undefined} onChange={v => { if (v) setParam('to', v); }} className={cx(INPUT, 'h-9 w-auto')} /></label>
            </div>
          </div>
        }
        toolbar={<>
          <label className="relative flex-[1_1_260px] min-w-[200px] max-w-[420px]">
            <span className="absolute left-[11px] top-1/2 -translate-y-1/2 text-muted-ink grid pointer-events-none"><Icon name="Search" size="sm" /></span>
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Unit or building" aria-label="Search cleaning jobs"
              className="h-9 w-full box-border rounded-control border border-solid border-line bg-card text-ink font-sans text-copy pl-[33px] pr-3 py-0 outline-none" />
          </label>
          {filtered && <Button variant="tertiary" size="sm" icon={<Icon name="X" size="sm" />} onClick={clearAll}>Clear filters</Button>}
        </>}
        renderCard={r => (
          <span className="flex flex-col gap-0.5 text-copy min-w-0">
            <span className="flex justify-between gap-2"><b>{r.propertyName} {r.unitNumber}</b><span className="text-muted-ink whitespace-nowrap">{dayLabel(r.date)}</span></span>
            <span className="text-muted-ink">{KIND_LABEL[r.kind] ?? r.kind} · {r.assigneeName ?? r.sheetCleaner ?? 'No cleaner recorded'} · {plural(r.photoCount, 'file')}{show ? ` · ${TASK_STATE[r.state]?.label ?? r.state}` : ''}</span>
          </span>
        )}
      />
      {bulkAssign && (
        <OpsModal title="Assign cleaners" sub={`${plural(bulkAssign.ids.length, 'cleaning job')} ticked.`} onClose={() => { if (!bulkAssignBusy) setBulkAssign(null); }} busy={bulkAssignBusy} footer={null}>
          <CleanerChecklist cleaners={active} initial={[]} modes busy={bulkAssignBusy} saveLabel="Assign" onCancel={() => setBulkAssign(null)} onSave={(ids, mode) => void assignMany(ids, mode)} />
        </OpsModal>
      )}
      {confirmDone && (
        <OpsModal title={`Mark ${plural(confirmDone.rows.length, 'cleaning job')} done?`} onClose={() => setConfirmDone(null)} busy={bulkBusy === 'done'}
          sub="Each unit turns Ready and its cleaning is charged to the unit. A job with no photo or video is refused and named afterwards."
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setConfirmDone(null)} disabled={bulkBusy === 'done'}>Cancel</Button>
            <Button size="sm" variant="primary" loading={bulkBusy === 'done'} onClick={() => void bulkMove(confirmDone.rows, 'done', confirmDone.clear)}>Mark done</Button>
          </>}>
          <p className="m-0 text-copy text-muted-ink">{confirmDone.rows.slice(0, 6).map(historyLabel).join(', ')}{confirmDone.rows.length > 6 ? ' …' : ''}</p>
        </OpsModal>
      )}
    </div>
  );
}
