import { maySee, mayRun } from '../lib/areaAccess';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { DateField, MoneyInput, TimeField } from '../components/inputs';
import Icon from '../components/Icon';
import { Select, type SelectOption } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { AttachmentLabel, MediaGallery } from '../components/Attachments';
import { DataTable, type Column } from '../components/DataTable';
import { BulkAssignCleaner } from '../components/BulkAssignCleaner';
import { CleanerChecklist, CleanerChips, cleanerHint } from '../components/CleanerPicks';
import { Floating } from '../components/DataTableParts';
import { LateCheckoutBlock } from '../components/booking/BookingDrawer';
import { sizeLine } from '../lib/unitSize';
import SplitPane from '../components/SplitPane';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { api, errorMessage } from '../lib/api';
import { useCleaners, type Cleaner } from '../lib/useCleaners';
import { useUnitRoster } from '../lib/useUnitRoster';
import { UnitPicker } from '../components/UnitPicker';
import { useMedia, useNow } from '../lib/useMedia';
import { useSession } from '../lib/session';
import { runEach, skippedNote } from '../lib/bulk';
import { fetchAllPages } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { rm, plural, count } from '../lib/format';
import type { Tone } from '../lib/types';
import { PhoneHistory, RecordHistory } from '../components/RecordHistory';
import { PricesView, PayView } from './CleaningSetup';
import { JobMoneyPanel, JobProfitView } from '../components/ops/JobMoney';
import {
  KIND_LABEL, TimeLeft, Segmented, OpsModal, FormRow, INPUT, TEXTAREA, CloseButton, uploadTo, ReportDamageModal, dayLabel, hm, stamp, minutesLabel, mytDay, type CleanStatus, type MediaItem,
} from '../components/ops/OpsUi';
import { statusOf } from '../lib/status';
import { cleanRowTone, type CleanRowTone } from '../lib/cleanRowTone';
import { StatusBadge } from '../components/StatusBadge';

/* ---------- what the board endpoint answers (functions/api/housekeeping/board.ts) ---------- */

interface Guest { reservationId: string; guestName: string; channel: string }
interface TaskCleaner { cleanerId: string | null; userId: string | null; name: string; outsourced: boolean }
/** The unit's size and layout type (functions/_lib/unitLayout.ts). */
interface UnitSize { bedrooms: number | null; bathrooms: number | null; size: string | null; layout: string | null }
interface Row {
  id: string; kind: string; state: string; status: Exclude<CleanStatus, 'unplanned'>; title: string; instructions: string | null;
  day: string; carriedOver: boolean; unitId: string; unitNumber: string; readiness: string; buildingId: string; propertyName: string;
  assigneeId: string | null; cleanerId: string | null; assigneeName: string | null; cleaners: TaskCleaner[]; unit: UnitSize;
  previous: (Guest & { state: string; checkOutTime: string; lateCheckOut: boolean }) | null;
  next: (Guest & { guests: number; checkInTime: string; earlyCheckIn: boolean; checkInAt: string }) | null;
  guestOut: boolean; guestLeftAt: string | null; guestLeftAuto?: boolean; startedAt: string | null; completedAt: string | null;
  photoCount: number; videoCount: number; checklist: { done: number; total: number };
  /** What the clean is charged and what the cleaner is paid, in sen; null = price not set. */
  amount?: number | null; cleanerPay?: number | null; priceSource?: 'job' | 'unit' | 'table' | null;
  external?: { address: string; clientName: string | null; clientPhone: string | null } | null;
}
interface Departure {
  reservationId: string; state: string; channel: string; guestName: string; checkOutTime: string; lateCheckOut: boolean;
  unitId: string; unitNumber: string; buildingId: string; propertyName: string; unit?: UnitSize;
  next: { reservationId?: string; guestName: string; checkInTime: string; checkInAt: string; earlyCheckIn: boolean } | null;
}
export interface RepairOnDay {
  id: string; issueId: string; startsAt: string; endsAt: string; note: string | null; title: string; state: string; urgency: string; category: string;
  assigneeName: string | null; unitId: string; unitNumber: string; buildingId: string; propertyName: string; overlaps: { guestName: string }[];
}
interface Board { date: string; today: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[]; defaults: { checkIn: string; checkOut: string }; external?: Row[]; externalEnabled?: boolean }

interface Detail {
  id: string; kind: string; state: string; unitId: string; unitNumber: string; propertyName: string; instructions: string | null;
  startedAt: string | null; completedAt: string | null; guestLeftAt: string | null;
  completedBy: string | null; createdAt: string | null; reservationId: string | null;
  media: MediaItem[];
  access: { id: string; kind: string; label: string; instruction: string; masked: string; hasCode: boolean }[]; mayReveal: boolean; parking?: string | null;
  cost: { amount: number; source: 'unit' | 'history' | 'default' | 'job' | 'table'; charged: boolean; cleanerPay?: number | null; priceSet?: boolean } | null;
  external?: { address: string; clientName: string | null; clientPhone: string | null } | null;
  damage: { id: string; title: string; state: string; reportedAt: string }[];
  day?: string | null;
  cleaners?: TaskCleaner[]; unit?: UnitSize;
}

type Tab = 'board' | 'history' | 'prices' | 'pay' | 'profit';
type DayPick = 'today' | 'tomorrow' | 'pick';

const KIND_NAME: Record<string, string> = { turnover: 'Basic clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };
/** A job still titled by its type follows the type; a title someone typed stays. */
const cleanTitle = (kind: string, title: string) => (Object.values(KIND_NAME).includes(title) ? KIND_NAME[kind] ?? title : title);

/** Basic (BC) is the default and Deep (DC) the other choice (26 Oct 2026). Light only shows on an old Light job. */
function CleanTypeOptions({ current }: { current?: string }) {
  return <>
    <option value="turnover">Basic clean (BC)</option><option value="deep_clean">Deep clean (DC)</option>
    {current === 'light_clean' && <option value="light_clean">Light clean</option>}
  </>;
}
const COST_SOURCE: Record<string, string> = { unit: "the unit's own price", history: 'last charged on this unit', default: 'standard rate', job: 'set on this job', table: 'price table' };
/** Board order (staff comment sheet): units ready to check in at the top, then being cleaned, then guest out, then the rest. */
const BOARD_ORDER: Record<string, number> = { done: 0, cleaning: 1, ready: 2, waiting: 3, guest_in: 4, unassigned: 5 };

export default function CleaningPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab: Tab = asked === 'history' || asked === 'prices' || asked === 'pay' || asked === 'profit' ? asked : 'board';
  const setTab = (t: Tab) => setParams(p => {
    const n = new URLSearchParams(p);
    if (t !== 'board') n.set('tab', t); else n.delete('tab');
    if (t !== 'history') HISTORY_PARAMS.forEach(k => n.delete(k));
    return n;
  }, { replace: true });

  if (tab === 'prices') return <PricesView tabs={<TabSwitch tab={tab} onTab={setTab} />} />;
  if (tab === 'pay') return <PayView tabs={<TabSwitch tab={tab} onTab={setTab} />} />;
  if (tab === 'profit') return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
      <PageHeader title="Cleaning" sub="Profit by job: what each clean billed against what it cost" actions={<TabSwitch tab={tab} onTab={setTab} />} />
      <JobProfitView kind="cleaning" />
    </div>
  );
  return tab === 'history' ? <HistoryView onTab={setTab} /> : <BoardView onTab={setTab} />;
}

function TabSwitch({ tab, onTab, className }: { tab: Tab; onTab: (t: Tab) => void; className?: string }) {
  const { user } = useSession();
  const profit = maySee(user, 'finance');
  return <Segmented label="View" value={tab} onChange={onTab} className={className} options={[{ value: 'board', label: 'Board' }, { value: 'history', label: 'History' }, { value: 'prices', label: 'Prices' }, { value: 'pay', label: 'Pay' },
    ...(profit ? [{ value: 'profit' as const, label: 'Profit' }] : [])]} />;
}

/* ============================== board ============================== */

function BoardView({ onTab }: { onTab: (t: Tab) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(30000);
  const [pick, setPick] = useState<DayPick>('today');
  const [picked, setPicked] = useState(mytDay(2));
  const date = pick === 'today' ? mytDay(0) : pick === 'tomorrow' ? mytDay(1) : picked;
  const [cleaner, setCleaner] = useState('');
  const [building, setBuilding] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Status switch: All (the default, ready units on top), To do (not started, incl. checkouts with no job), In progress, Done.
  const [phase, setPhase] = useState<'all' | 'todo' | 'doing' | 'done'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<{ buildingId: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useSession();
  // Closing overdue jobs in bulk is management's (functions/api/housekeeping/overdue.ts); cleaners never see it.
  const mayBulk = mayRun(user, 'operations');
  const [overdueOpen, setOverdueOpen] = useState(() => { try { return localStorage.getItem('cleaning.overdueOpen') === '1'; } catch { return false; } });
  const toggleOverdue = () => setOverdueOpen(v => { try { localStorage.setItem('cleaning.overdueOpen', v ? '0' : '1'); } catch { /* private window */ } return !v; });
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'done' | 'cancel' | null>(null);

  const { data, loading, error, reload: reloadData } = useApi<Board>(`/housekeeping/board?date=${date}`);
  // The side menu's counts (open jobs, today's work) follow what was just done here.
  const reload = () => { reloadData(); void refreshNavCounts(); };
  // A cleaner finishing on the phone shows here without anyone pressing refresh.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') reloadData(); };
    const t = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const { cleaners } = useCleaners(true);
  // External cleans (an address, not a unit) sit in their own group, after the buildings.
  const rows = useMemo(() => [...(data?.rows ?? []), ...(data?.external ?? [])], [data]);
  const departures = data?.departures ?? [];
  const repairs = data?.repairs ?? [];

  const buildingOptions: SelectOption[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.buildingId, r.propertyName);
    for (const d of departures) m.set(d.buildingId, d.propertyName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [rows, departures]);
  const cleanerOptions: SelectOption[] = [{ value: 'none', label: 'Unassigned' }, ...cleaners.map(c => ({ value: c.id, label: c.name }))];

  const phaseOf = (r: Row) => (r.status === 'done' ? 'done' : r.status === 'cleaning' ? 'doing' : 'todo');
  const filteredRows = rows.filter(r => (!building || r.buildingId === building)
    && (!cleaner || (cleaner === 'none' ? !r.cleanerId && !r.assigneeId && !r.assigneeName : r.cleanerId === cleaner || r.cleaners.some(c => c.cleanerId === cleaner))));
  const phaseCount = { todo: filteredRows.filter(r => phaseOf(r) === 'todo').length, doing: filteredRows.filter(r => phaseOf(r) === 'doing').length, done: filteredRows.filter(r => phaseOf(r) === 'done').length };
  const visible = filteredRows.filter(r => phase === 'all' || phaseOf(r) === phase);
  const visibleDepartures = phase !== 'todo' && phase !== 'all' ? [] : departures.filter(d => (!building || d.buildingId === building) && (!cleaner || cleaner === 'none'));

  // Open jobs from an earlier day sit in their own Overdue group above the day's work, so the day reads as the day.
  const isOverdue = (r: Row) => r.carriedOver && r.status !== 'done';
  const overdueRows = visible.filter(isOverdue);
  const oldestOverdue = overdueRows.reduce<string | null>((o, r) => (!o || r.day < o ? r.day : o), null);
  // One card per building, in name order; each lists its cleans, then guests leaving with no clean yet.
  const toGroups = (rs: Row[], deps: Departure[], reps: RepairOnDay[], tag: string) => {
    const m = new Map<string, { id: string; key: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }>();
    const get = (id: string, name: string) => m.get(id) ?? (m.set(id, { id, key: `${tag}${id}`, name, rows: [], departures: [], repairs: [] }), m.get(id)!);
    for (const r of rs) get(r.buildingId, r.propertyName).rows.push(r);
    for (const d of deps) get(d.buildingId, d.propertyName).departures.push(d);
    for (const w of reps) if (m.has(w.buildingId)) m.get(w.buildingId)!.repairs.push(w);
    for (const g of m.values()) g.rows.sort((a, b) => (tag ? a.day.localeCompare(b.day) : 0) || BOARD_ORDER[a.status] - BOARD_ORDER[b.status] || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
    return [...m.values()].sort((a, b) => (a.id === 'external' ? 1 : 0) - (b.id === 'external' ? 1 : 0) || a.name.localeCompare(b.name));
  };
  const groups = useMemo(() => toGroups(visible.filter(r => !isOverdue(r)), visibleDepartures, repairs, ''), [visible, visibleDepartures, repairs]); // eslint-disable-line react-hooks/exhaustive-deps
  const overdueGroups = useMemo(() => toGroups(overdueRows, [], [], 'overdue-'), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // The header speaks of the day; overdue jobs are counted on their own, so day + overdue = the All tab.
  const dayRows = rows.filter(r => !isOverdue(r));
  const total = dayRows.length, done = dayRows.filter(r => r.status === 'done').length;
  const overdueAll = rows.length - dayRows.length;
  const unassigned = dayRows.filter(r => r.status !== 'done' && !r.cleanerId && !r.assigneeId && !r.assigneeName).length;
  const ready = dayRows.filter(r => r.status === 'ready').length;
  // A pick only lives while its job is still overdue and on screen.
  const overdueIds = overdueRows.map(r => r.id).join(',');
  useEffect(() => { setPicks(p => { const keep = new Set(overdueRows.map(r => r.id)); const n = new Set([...p].filter(id => keep.has(id))); return n.size === p.size ? p : n; }); }, [overdueIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePicks = (ids: string[], on: boolean) => setPicks(p => { const n = new Set(p); ids.forEach(id => (on ? n.add(id) : n.delete(id))); return n; });
  const allPicked = overdueRows.length > 0 && overdueRows.every(r => picks.has(r.id));
  const sel = rows.find(r => r.id === selected) ?? null;
  useEffect(() => { if (selected && data && !rows.some(r => r.id === selected)) setSelected(null); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?task=<id> (from a notification): open that clean on its own day.
  const [params, setParams] = useSearchParams();
  const linkedTask = params.get('task');
  useEffect(() => {
    if (!linkedTask) return;
    let live = true;
    api.get<{ day: string | null }>(`/housekeeping/tasks/${encodeURIComponent(linkedTask)}`).then(t => {
      if (!live) return;
      if (t.day) {
        if (t.day === mytDay(0)) setPick('today'); else if (t.day === mytDay(1)) setPick('tomorrow'); else { setPick('pick'); setPicked(t.day); }
      }
      setSelected(linkedTask);
    }).catch(() => {}).finally(() => {
      if (live) setParams(p => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true });
    });
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
    act('plan-all', () => api.post('/housekeeping/plan', { reservationIds: visibleDepartures.map(d => d.reservationId) }), { title: `${visibleDepartures.length} cleaning jobs planned.` });
  const undoLeft = (taskId: string, unit: string) =>
    act(`left-${taskId}`, () => api.post('/housekeeping/guest-left', { taskId, undo: true }), { title: `${unit}: guest no longer marked out.` });
  const assignOne = (taskId: string, unit: string, cleanerIds: string[], label: string) =>
    act(`assign-${taskId}`, () => api.post(`/housekeeping/tasks/${taskId}/assign`, { cleanerIds, force: true }), { title: cleanerIds.length ? `${unit}: given to ${label}.` : `${unit}: cleaners taken off.` });
  const setCheckIn = (reservationId: string, time: string, unit: string) =>
    act(`in-${reservationId}`, () => api.patch(`/reservations/${reservationId}/details`, { checkInTime: time }), { title: `${unit}: next check-in ${time}.` });

  const subtitle = data
    // vocab-ok: departures is the API field name; the words on screen say checkouts
    ? `${dayLabel(date)} · ${total} ${total === 1 ? 'cleaning job' : 'cleaning jobs'} · ${done} done · ${ready} ready to clean${unassigned ? ` · ${unassigned} unassigned` : ''}${departures.length ? ` · ${departures.length} checkouts with no cleaning job` : ''}${overdueAll ? ` · ${overdueAll} overdue from earlier days` : ''}`
    : dayLabel(date);

  const list = (
    <>
      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex flex-col gap-3.5">{[0, 1].map(i => <div key={i} className="bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-3"><Skeleton width="40%" height={16} /><Skeleton height={44} /><Skeleton height={44} /></div>)}</div>
      ) : groups.length === 0 && overdueGroups.length === 0 ? (
        <EmptyState icon="Sparkles" kind={building || cleaner ? 'filtered' : 'empty'}
          title={building || cleaner ? 'No cleaning jobs match these filters.' : `No cleaning jobs on ${dayLabel(date)}.`}
          body={building || cleaner ? undefined : 'Cleaning jobs appear when guests check out. Add one by hand for a deep clean or a refresh.'}
          action={building || cleaner ? { label: 'Clear filters', onClick: () => { setBuilding(''); setCleaner(''); } } : { label: 'Add cleaning job', onClick: () => setCreating(true) }} />
      ) : <>
        {overdueGroups.length > 0 && (
          <section aria-label="Overdue cleaning jobs" className="flex-none rounded-card border border-solid border-danger-line bg-danger-bg flex flex-col">
            <header className="flex items-center gap-x-3 gap-y-2 flex-wrap px-4 py-3">
              <button type="button" onClick={toggleOverdue} aria-expanded={overdueOpen}
                className="min-w-0 flex items-center gap-2 flex-wrap bg-transparent border-none p-0 cursor-pointer text-left text-ink [font-family:inherit]">
                <Icon name={overdueOpen ? 'ChevronDown' : 'ChevronRight'} size="sm" color="var(--color-muted-ink)" />
                <h2 className="m-0 text-heading font-semibold text-critical">Overdue</h2>
                <StatusBadge tone="critical">{overdueRows.length}</StatusBadge>
                <span className="text-meta text-muted-ink">
                  open {overdueRows.length === 1 ? 'cleaning job' : 'cleaning jobs'} from earlier days{oldestOverdue ? ` · oldest ${dayLabel(oldestOverdue)}` : ''}
                </span>
              </button>
              {mayBulk && overdueOpen && (
                <label className="ml-auto flex items-center gap-2 text-copy cursor-pointer">
                  <input type="checkbox" checked={allPicked} ref={el => { if (el) el.indeterminate = picks.size > 0 && !allPicked; }}
                    onChange={e => setPicks(e.target.checked ? new Set(overdueRows.map(r => r.id)) : new Set())}
                    className="w-4 h-4 m-0 accent-[var(--color-brand-black)] cursor-pointer" />
                  Select all
                </label>
              )}
            </header>
            {mayBulk && overdueOpen && picks.size > 0 && (
              <div role="toolbar" aria-label="Close the selected overdue jobs" className="sticky top-0 z-[1] mx-3 mb-3 px-3 py-2 rounded-control bg-card border border-solid border-line flex items-center gap-2 flex-wrap shadow-[var(--shadow-overlay)] max-md:fixed max-md:top-auto max-md:inset-x-3 max-md:bottom-[calc(88px+env(safe-area-inset-bottom))] max-md:z-30 max-md:m-0">
                <span className="text-copy font-medium">{picks.size} selected</span>
                <Button size="sm" variant="tertiary" onClick={() => setPicks(new Set())} className="mr-auto">Clear</Button>
                <span className="flex gap-2 max-md:w-full">
                  <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} onClick={() => setBulk('done')} className="max-md:flex-1">Mark done</Button>
                  <Button size="sm" variant="secondary" onClick={() => setBulk('cancel')} className="max-md:flex-1">Cancel job</Button>
                </span>
              </div>
            )}
            {overdueOpen && (
              <div className="px-3 pb-3 flex flex-col gap-3">
                {overdueGroups.map(g => (
                  <BuildingCard key={g.key} group={g} now={now} future={false} selected={selected} busy={busy}
                    onSelect={id => setSelected(id)} onGuestLeft={guestLeft} onUndoLeft={undoLeft} onCheckIn={setCheckIn} onPlan={plan} cleaners={cleaners} onAssignOne={assignOne}
                    picks={mayBulk ? { has: id => picks.has(id), toggle: togglePicks } : undefined} />
                ))}
              </div>
            )}
          </section>
        )}
        {overdueGroups.length > 0 && (
          <div className="flex items-baseline gap-2 flex-wrap px-1 mt-1">
            <h2 className="m-0 text-heading font-semibold">{pick === 'today' ? 'Today' : dayLabel(date)}</h2>
            <span className="text-meta text-muted-ink">{groups.length === 0 ? 'Nothing else on this day.' : `${total} ${total === 1 ? 'cleaning job' : 'cleaning jobs'}`}</span>
          </div>
        )}
        {groups.map(g => (
          <BuildingCard key={g.key} group={g} now={now} future={date > mytDay(0)} selected={selected} busy={busy}
            onSelect={id => setSelected(id)} onGuestLeft={guestLeft} onUndoLeft={undoLeft} onCheckIn={setCheckIn} onPlan={plan} cleaners={cleaners} onAssignOne={assignOne}
            onAssign={() => setAssignFor({ buildingId: g.id, name: g.name })} />
        ))}
        {/* Room under the last job for the bar pinned to the bottom of a phone. */}
        {mayBulk && overdueOpen && picks.size > 0 && <div aria-hidden className="md:hidden h-20 flex-none" />}
      </>}
    </>
  );

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <PageHeader title="Cleaning" sub={subtitle}
        actions={<>
          {/* Phones: Cleaners sits behind one "..." so the header is View + Add (owner, Oct 2026), and the "..." shares the
              tabs' row instead of wrapping to one of its own; the tabs scroll sideways if they run out of room. No auto-assign:
              cleans are given by building or one by one (staff comment sheet, 16 Oct 2026). */}
          <span className="flex items-center gap-2 min-w-0 max-md:w-full">
            <TabSwitch tab="board" onTab={onTab} className="max-md:flex-initial max-md:min-w-0" />
            <CleaningMore onCleaners={() => navigate('/hr/employees?tab=employee-master')} />
          </span>
          <span className="contents max-md:hidden">
            <Button size="sm" variant="secondary" icon={<Icon name="Users" size="sm" />} onClick={() => navigate('/hr/employees?tab=employee-master')}>Cleaners</Button>
          </span>
        </>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>Add cleaning job</Button>} />

      <Segmented label="Status" value={phase} onChange={setPhase} options={[
        { value: 'all', label: `All · ${filteredRows.length + (departures.length && !cleaner ? departures.filter(d => !building || d.buildingId === building).length : 0)}` },
        // vocab-ok: departures is the API field's name; the label itself says To do
        { value: 'todo', label: `To do · ${phaseCount.todo + (departures.length && !cleaner ? departures.filter(d => !building || d.buildingId === building).length : 0)}` },
        { value: 'doing', label: `In progress · ${phaseCount.doing}` },
        { value: 'done', label: `Done · ${phaseCount.done}` },
      ]} />
      <div className="flex items-end gap-2 flex-wrap">
        <Segmented label="Day" value={pick} onChange={setPick}
          options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }, { value: 'pick', label: 'Pick date' }]} />
        {/* Phones: the two dropdowns fold behind one button so the first jobs show on the first screen. */}
        <span className="md:hidden">
          <Button size="sm" variant="secondary" icon={<Icon name="ListFilter" size="sm" />} onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen}>
            Filter{cleaner || building ? ` · ${[cleaner, building].filter(Boolean).length}` : ''}
          </Button>
        </span>
        {pick === 'pick' && <DateField aria-label="Day" value={picked} onChange={v => v && setPicked(v)} className={cx(INPUT, 'h-9 w-auto')} />}
        <Select label="Cleaner" value={cleaner} onChange={setCleaner} options={cleanerOptions} placeholder="All cleaners" className={cx('flex-1 min-w-[140px] md:flex-none md:w-[160px]', !filtersOpen && 'max-md:hidden')} />
        <Select label="Building" value={building} onChange={setBuilding} options={buildingOptions} placeholder="All buildings" className={cx('flex-1 min-w-[140px] md:flex-none md:w-[180px]', !filtersOpen && 'max-md:hidden')} />
        {visibleDepartures.length > 0 && (
          <Button size="sm" variant="brand" loading={busy === 'plan-all'} onClick={() => void planAll()} className="ml-auto max-md:ml-0 max-md:w-full">
            Plan cleaning for {visibleDepartures.length} {visibleDepartures.length === 1 ? 'checkout' : 'checkouts'}
          </Button>
        )}
      </div>

      <SplitPane list={list} open={!!sel} onClose={() => setSelected(null)} width={580}
        detail={sel ? <CleanDetail key={sel.id} row={sel} now={now} onClose={() => setSelected(null)} onChanged={reload} onGuestLeft={() => void guestLeft({ taskId: sel.id }, sel.unitNumber)}
          onCheckIn={t => sel.next?.reservationId && void setCheckIn(sel.next.reservationId, t, sel.unitNumber)} savingIn={!!sel.next?.reservationId && busy === `in-${sel.next.reservationId}`} /> : null} />

      {bulk && (
        <BulkCloseModal action={bulk} jobs={overdueRows.filter(r => picks.has(r.id))} onClose={() => setBulk(null)}
          onDone={(title, body) => { setBulk(null); setPicks(new Set()); toast({ tone: 'success', title, body }); reload(); }} />
      )}
      {creating && <NewCleanModal date={date} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {assignFor && (
        <AssignBuildingModal building={assignFor} date={date} onClose={() => setAssignFor(null)}
          onDone={(n, who) => { setAssignFor(null); toast({ tone: 'success', title: `${n} ${n === 1 ? 'cleaning job' : 'cleaning jobs'} in ${assignFor.name} given to ${who}.` }); reload(); }} />
      )}
    </div>
  );
}

/* ---------- closing overdue jobs in bulk (management) ---------- */

interface BulkResult { closed: number; skipped: { id: string; unitNumber: string | null; reason: string }[]; charged: number; chargedAmount: number; notCharged?: { unitNumber: string | null; reason: string }[] }

/** Mark done (no photo, note "closed in bulk", charged like a finished clean) or Cancel job (a reason, nothing charged)
 *  for the overdue jobs ticked on the board: functions/api/housekeeping/overdue.ts. */
function BulkCloseModal({ action, jobs, onClose, onDone }: { action: 'done' | 'cancel'; jobs: Row[]; onClose: () => void; onDone: (title: string, body?: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = jobs.length;
  const priced = jobs.filter(j => j.unitId && j.amount != null);
  const estimate = priced.reduce((s, j) => s + Number(j.amount), 0);
  async function save() {
    if (action === 'cancel' && !reason.trim()) { setError('Say why these jobs are cancelled.'); return; }
    setBusy(true);
    try {
      // In parts of 50: each finished clean is charged one by one on the server, so a part stays a short request.
      const r: BulkResult = { closed: 0, skipped: [], charged: 0, chargedAmount: 0 };
      for (let i = 0; i < jobs.length; i += 50) {
        const part = await api.post<BulkResult>('/housekeeping/overdue', { action, taskIds: jobs.slice(i, i + 50).map(j => j.id), ...(action === 'cancel' ? { reason: reason.trim() } : {}) });
        r.closed += part.closed; r.skipped.push(...part.skipped); r.charged += part.charged; r.chargedAmount += part.chargedAmount;
      }
      const left = skippedNote(r.skipped.map(x => ({ label: x.unitNumber ?? 'A job', reason: x.reason })));
      const money = action === 'done' ? (r.charged ? `${plural(r.charged, 'charge')} to units, ${rm(r.chargedAmount, { cents: false })}.` : 'Nothing new charged to units.') : 'Nothing charged.';
      onDone(action === 'done' ? `${plural(r.closed, 'cleaning job')} marked done.` : `${plural(r.closed, 'cleaning job')} cancelled.`, [money, left].filter(Boolean).join(' '));
    } catch (e) { setError(errorMessage(e, 'Not saved. Try again in a moment.')); setBusy(false); }
  }
  const list = (
    <ul className="m-0 p-0 list-none max-h-[180px] overflow-y-auto rounded-control border border-solid border-line divide-y divide-[var(--color-line-soft)]">
      {jobs.map(j => (
        <li key={j.id} className="px-3 py-1.5 text-copy flex items-baseline gap-2">
          <b>{j.unitNumber}</b><span className="text-muted-ink truncate">{j.propertyName}</span>
          <span className="ml-auto text-meta text-muted-ink whitespace-nowrap">{dayLabel(j.day)}</span>
        </li>
      ))}
    </ul>
  );
  return action === 'done' ? (
    <OpsModal title={`Mark ${plural(n, 'overdue cleaning job')} done?`} onClose={onClose} busy={busy}
      sub="Recorded as done by you, now, with the note 'closed in bulk'. No photo is asked for. Each one is charged to its unit like a finished clean, on the job's own day."
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Mark {plural(n, 'job')} done</Button></>}>
      {list}
      {estimate > 0 && <p className="m-0 text-copy text-muted-ink">About {rm(estimate, { cents: false })} to units ({plural(priced.length, 'priced job')}). A unit already charged for a clean that day is not charged twice.</p>}
      {error && <p role="alert" className="m-0 text-copy text-danger">{error}</p>}
    </OpsModal>
  ) : (
    <OpsModal title={`Cancel ${plural(n, 'overdue cleaning job')}?`} onClose={onClose} busy={busy}
      sub="The jobs are removed and nothing is charged. The reason is kept in the history. A job a cleaner started, or one with photos, is kept: mark it done instead."
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Back</Button><Button size="sm" variant="danger" loading={busy} onClick={() => void save()}>Cancel {plural(n, 'job')}</Button></>}>
      {list}
      <FormRow label="Reason" error={error}>
        <textarea className={TEXTAREA} value={reason} maxLength={500} onChange={e => { setReason(e.target.value); setError(null); }} placeholder="e.g. Imported job, the stay ended days ago and the unit was cleaned" />
      </FormRow>
    </OpsModal>
  );
}

/* ---------- one building ---------- */

/** Ticks for the overdue bulk close: only passed in the Overdue section, and only for management. */
interface Picks { has: (id: string) => boolean; toggle: (ids: string[], on: boolean) => void }

function BuildingCard({ group, now, future, selected, busy, onSelect, onGuestLeft, onUndoLeft, onCheckIn, onPlan, onAssign, onAssignOne, cleaners, picks }: {
  group: { id: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }; now: number; future: boolean; selected: string | null; busy: string | null;
  onSelect: (id: string) => void; onGuestLeft: (b: { taskId?: string; reservationId?: string }, unit: string) => void; onUndoLeft: (taskId: string, unit: string) => void;
  onCheckIn: (reservationId: string, time: string, unit: string) => void; onPlan: (d: Departure) => void; onAssign?: () => void; picks?: Picks;
  cleaners: Cleaner[]; onAssignOne: (taskId: string, unit: string, cleanerIds: string[], label: string) => void;
}) {
  const external = group.id === 'external';
  const doneN = group.rows.filter(r => r.status === 'done').length;
  const open = group.rows.filter(r => r.status !== 'done');
  const unassigned = open.filter(r => !r.cleanerId && !r.assigneeId && !r.assigneeName).length;
  const names = [...new Set(group.rows.flatMap(r => (r.cleaners.length ? r.cleaners.map(c => c.name) : [r.assigneeName])).filter(Boolean))];
  // Each building folds shut; it starts open only when something in it still needs a person.
  const [shut, setShut] = useState(() => open.length === 0 && group.departures.length === 0);
  const ids = group.rows.map(r => r.id);
  const allPicked = !!picks && ids.length > 0 && ids.every(id => picks.has(id));
  const somePicked = !!picks && ids.some(id => picks.has(id));
  // Phones get one compact card per job so four or five fit a screen (owner, 20 Oct 2026); tablet and up keep the table.
  const phone = useMedia('(max-width: 767.98px)');
  if (phone) {
    return (
      <section className="bg-card rounded-card border border-solid border-line overflow-hidden flex-none">
        <header className="flex items-center gap-2 pl-3 pr-2 py-1.5 min-h-11">
          {picks && (
            <input type="checkbox" checked={allPicked} ref={el => { if (el) el.indeterminate = somePicked && !allPicked; }} onChange={e => picks.toggle(ids, e.target.checked)}
              aria-label={`Select every overdue job in ${group.name}`} className="flex-none w-4 h-4 m-0 accent-[var(--color-brand-black)] cursor-pointer" />
          )}
          <button type="button" onClick={() => setShut(v => !v)} aria-expanded={!shut}
            className="min-w-0 flex-1 flex items-center gap-1.5 bg-transparent border-none p-0 min-h-9 cursor-pointer text-left text-ink [font-family:inherit]">
            <Icon name={shut ? 'ChevronRight' : 'ChevronDown'} size="sm" color="var(--color-muted-ink)" />
            <span className="min-w-0 truncate text-copy font-semibold">{group.name}</span>
            <span className="flex-none text-meta text-muted-ink tabular-nums">{group.rows.length} · {doneN} done</span>
          </button>
          {group.departures.length > 0 && <span className="flex-none"><StatusBadge tone="critical" size="sm">{group.departures.length} to plan</StatusBadge></span>}
          {unassigned > 0 && <span className="flex-none text-meta text-danger font-medium tabular-nums">{unassigned} unassigned</span>}
          {open.length > 0 && onAssign && (
            <button type="button" onClick={onAssign} aria-label={external ? 'Assign external jobs' : 'Assign whole building'} title={external ? 'Assign external jobs' : 'Assign whole building'}
              className="flex-none h-9 min-w-9 px-2 sm:px-3 inline-flex items-center justify-center gap-1.5 rounded-control border-0 bg-black text-white cursor-pointer text-meta font-medium [font-family:inherit]">
              <Icon name="Users" size="sm" /><span className="max-sm:hidden">{external ? 'Assign external jobs' : 'Assign whole building'}</span>
            </button>
          )}
        </header>
        {!shut && <>
          {group.rows.map(r => <PhoneCleanCard key={r.id} r={r} now={now} active={r.id === selected} busy={busy === `left-${r.id}`}
            picked={picks ? picks.has(r.id) : undefined} onPick={picks ? on => picks.toggle([r.id], on) : undefined}
            onSelect={() => onSelect(r.id)} onGuestLeft={() => onGuestLeft({ taskId: r.id }, r.unitNumber)} onUndoLeft={() => onUndoLeft(r.id, r.unitNumber)} />)}
          {group.departures.map(d => (
            <div key={d.reservationId} className="px-3 py-2.5 [border-top:1px_solid_var(--color-line-soft)] text-copy flex flex-col gap-1">
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
                <b className="flex-none whitespace-nowrap text-ink">{d.unitNumber}</b>
                <span className="ml-auto min-w-0 flex justify-end"><StatusBadge tone="critical" size="sm">No cleaning job</StatusBadge></span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 min-w-0">
                <PhoneStay label="Out" time={d.checkOutTime} name={d.guestName} aside={d.state === 'checked_out' && <StatusBadge tone="gold" size="sm">Out</StatusBadge>} />
                {d.next ? <PhoneStay label="In" time={d.next.checkInTime} name={d.next.guestName} aside={<span className="ml-auto pl-1 text-meta whitespace-nowrap"><TimeLeft at={d.next.checkInAt} now={now} /></span>} />
                  : <PhoneStay label="No check-in" />}
              </div>
              <div className="flex items-center justify-end gap-2 pt-0.5">
                {d.state !== 'checked_out' && !future && <Button size="sm" variant="secondary" loading={busy === `left-${d.reservationId}`} onClick={() => onGuestLeft({ reservationId: d.reservationId }, d.unitNumber)}>Guest left</Button>}
                <Button size="sm" variant="primary" loading={busy === `plan-${d.reservationId}`} onClick={() => onPlan(d)}>Plan cleaning</Button>
              </div>
            </div>
          ))}
          {group.repairs.length > 0 && (
            <div className="px-3 py-2 [border-top:1px_solid_var(--color-line-soft)] bg-page flex flex-col gap-1">
              {group.repairs.map(w => (
                <div key={w.id} className="flex items-center gap-2 text-meta min-w-0">
                  <Icon name="Wrench" size="sm" color="var(--color-gold-ink)" />
                  <span className="min-w-0 truncate"><b>{w.unitNumber}</b> repair {hm(w.startsAt)}–{hm(w.endsAt)}: {w.title}</span>
                  {w.overlaps.length > 0 && <span className="flex-none"><StatusBadge tone="critical" size="sm">Overlaps</StatusBadge></span>}
                </div>
              ))}
            </div>
          )}
        </>}
      </section>
    );
  }
  return (
    <section className="@container bg-card rounded-card border border-solid border-line overflow-hidden flex-none">
      <header className="flex items-center justify-between gap-3 flex-wrap px-4 @4xl:px-5 py-3">
        {picks && (
          <input type="checkbox" checked={allPicked} ref={el => { if (el) el.indeterminate = somePicked && !allPicked; }} onChange={e => picks.toggle(ids, e.target.checked)}
            aria-label={`Select every overdue job in ${group.name}`} className="flex-none w-4 h-4 m-0 -mr-1 accent-[var(--color-brand-black)] cursor-pointer" />
        )}
        <button type="button" onClick={() => setShut(v => !v)} aria-expanded={!shut}
          className="min-w-0 mr-auto flex items-center gap-2 flex-wrap bg-transparent border-none p-0 cursor-pointer text-left text-ink [font-family:inherit]">
          <Icon name={shut ? 'ChevronRight' : 'ChevronDown'} size="sm" color="var(--color-muted-ink)" />
          <span className="text-[15px] font-semibold tracking-[-0.005em]">{group.name}</span>
          <span className="text-meta text-muted-ink tabular-nums">{plural(group.rows.length, 'job')} · {doneN} done</span>
          {group.departures.length > 0 && <StatusBadge tone="critical">{group.departures.length} to plan</StatusBadge>}
        </button>
        <div className={cx('flex items-center gap-2 text-copy flex-wrap', picks && 'ml-auto')}>
          {unassigned > 0 ? <span className="text-danger font-medium">{unassigned} unassigned</span>
            : names.length ? <span className="text-muted-ink" title={names.length > 1 ? names.join(', ') : undefined}>{names.length === 1 ? 'Cleaner' : 'Cleaners'} <b className="text-ink">{names.length === 1 ? names[0] : `${names.length} people`}</b></span> : null}
          {/* The main way to give out cleans (staff comment sheet, 16 Oct 2026); one job at a time stays in its panel. */}
          {open.length > 0 && onAssign && <Button size="sm" variant="primary" icon={<Icon name="Users" size="sm" />} onClick={onAssign}>{external ? 'Assign external jobs' : 'Assign whole building'}</Button>}
        </div>
      </header>
      {!shut && <>
      {/* One card per job, as many across as fit (a card is at least 320px wide). */}
      <div className="grid gap-3 p-3 @4xl:p-4 [border-top:1px_solid_var(--color-line-soft)] [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {group.rows.map(r => <CleanCard key={r.id} r={r} now={now} active={r.id === selected} busy={busy === `left-${r.id}`} assigning={busy === `assign-${r.id}`}
          savingIn={!!r.next?.reservationId && busy === `in-${r.next.reservationId}`} cleaners={cleaners} onAssign={(ids, label) => onAssignOne(r.id, r.unitNumber, ids, label)}
          picked={picks ? picks.has(r.id) : undefined} onPick={picks ? on => picks.toggle([r.id], on) : undefined}
          onSelect={() => onSelect(r.id)} onGuestLeft={() => onGuestLeft({ taskId: r.id }, r.unitNumber)} onUndoLeft={() => onUndoLeft(r.id, r.unitNumber)}
          onCheckIn={time => r.next?.reservationId && onCheckIn(r.next.reservationId, time, r.unitNumber)} />)}
        {group.departures.map(d => <DepartureCard key={d.reservationId} d={d} now={now} future={future} savingIn={!!d.next?.reservationId && busy === `in-${d.next.reservationId}`}
          busy={{ left: busy === `left-${d.reservationId}`, plan: busy === `plan-${d.reservationId}` }}
          onGuestLeft={() => onGuestLeft({ reservationId: d.reservationId }, d.unitNumber)} onPlan={() => onPlan(d)}
          onCheckIn={time => d.next?.reservationId && onCheckIn(d.next.reservationId, time, d.unitNumber)} />)}
      </div>
      {group.repairs.length > 0 && (
        <div className="px-4 @4xl:px-5 py-2.5 [border-top:1px_solid_var(--color-line-soft)] bg-page flex flex-col gap-1">
          {group.repairs.map(w => (
            <div key={w.id} className="flex items-center gap-2 text-meta flex-wrap">
              <Icon name="Wrench" size="sm" color="var(--color-gold-ink)" />
              <span><b>{w.unitNumber}</b> repair window {hm(w.startsAt)}–{hm(w.endsAt)}: {w.title}{w.assigneeName ? ` (${w.assigneeName})` : ''}</span>
              {w.overlaps.length > 0 && <StatusBadge tone="critical">Overlaps a reservation</StatusBadge>}
            </div>
          ))}
        </div>
      )}
          </>}
    </section>
  );
}

/** A line of a card with its small icon in front, as on the reference board. */
function CardLine({ icon, className, children }: { icon: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx('flex items-start gap-2 min-w-0 text-copy', className)}>
      <span className="flex-none h-[22px] grid place-items-center"><Icon name={icon} size="sm" /></span>
      <div className="min-w-0 flex-1 flex items-baseline flex-wrap gap-x-3 gap-y-0.5 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** The chip under the lines: "Assign cleaner" opens a small list where you tick one or more cleaners (the first ticked is the
 *  main one), then press Apply. A started or finished job only shows its names: change those in the job's panel. */
function CleanerChip({ r, cleaners, assigning, onAssign }: { r: Row; cleaners: Cleaner[]; assigning: boolean; onAssign: (cleanerIds: string[], label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = useMemo(() => [...new Set([r.cleanerId, ...r.cleaners.map(c => c.cleanerId)].filter((id): id is string => !!id))], [r.cleanerId, r.cleaners]);
  const [picked, setPicked] = useState<string[]>(current);
  const anchor = useRef<HTMLButtonElement>(null);
  const names = r.cleaners.length ? r.cleaners.map(c => c.name) : r.assigneeName ? [r.assigneeName] : [];
  const text = names.length ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}` : 'Assign cleaner';
  const editable = r.status !== 'cleaning' && r.status !== 'done';
  const close = useCallback(() => { setOpen(false); setQ(''); }, []);
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(v => v !== id) : [...p, id]));
  // The least busy first, so the person to pick is at the top.
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return cleaners.filter(c => !n || c.name.toLowerCase().includes(n)).sort((a, b) => a.busy - b.busy || a.name.localeCompare(b.name));
  }, [cleaners, q]);
  const changed = picked.length !== current.length || picked.some((id, i) => id !== current[i]);
  const apply = () => {
    close();
    if (changed) onAssign(picked, picked.map(id => cleaners.find(c => c.id === id)?.name ?? 'cleaner').join(', '));
  };
  const chip = cx('inline-flex items-center gap-1.5 h-8 px-2.5 max-w-full min-w-0 rounded-control border border-solid border-line bg-card text-meta font-medium', names.length ? 'text-ink' : 'text-muted-ink');
  if (!editable) return <span title={names.join(', ') || undefined} className={chip}><Icon name="UserPlus" size="sm" /><span className="truncate">{text}</span></span>;
  return (
    <>
      <button ref={anchor} type="button" disabled={assigning} aria-haspopup="dialog" aria-expanded={open} aria-label={`Cleaners for ${r.unitNumber}: ${text}`}
        onClick={e => { e.stopPropagation(); if (!open) setPicked(current); setOpen(o => !o); }} onKeyDown={e => e.stopPropagation()} title={names.join(', ') || undefined}
        className={cx(chip, 'cursor-pointer [font-family:inherit] hover:border-ink disabled:opacity-60 disabled:cursor-default', open && 'border-ink bg-page')}>
        <Icon name="UserPlus" size="sm" /><span className="truncate">{assigning ? 'Saving...' : text}</span>
        <span className={cx('grid transition-transform duration-150', open && 'rotate-180')}><Icon name="ChevronDown" size="sm" /></span>
      </button>
      <Floating anchor={anchor} open={open} onClose={close} width={296} maxHeight={420} label={`Pick cleaners for ${r.unitNumber}`}>
        {/* The panel is portalled, but React still sends its clicks up to the card: stop them here. */}
        <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} className="flex flex-col">
          <div className="px-3 pt-2.5 pb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-meta font-semibold text-muted-ink">Assign {r.unitNumber}</span>
            <span className="text-meta text-muted-ink tabular-nums">{picked.length ? `${picked.length} picked` : 'Tick one or more'}</span>
          </div>
          {cleaners.length > 6 && (
            <div className="px-2 pb-1.5">
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search cleaners" aria-label="Search cleaners" className={cx(INPUT, 'h-9')} />
            </div>
          )}
          <div role="group" aria-label="Cleaners" className="px-1 pb-1 max-h-[200px] overflow-y-auto overscroll-contain">
            {list.length === 0 && <div className="px-3 py-3 text-copy text-muted-ink">{cleaners.length ? 'No cleaner with that name.' : 'No cleaners on the roster yet.'}</div>}
            {list.map(c => {
              const on = picked.includes(c.id);
              return (
                <label key={c.id} className={cx('min-h-11 flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] cursor-pointer text-copy', on ? 'bg-gold-tint' : 'hover:bg-muted')}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
                    className="w-4 h-4 m-0 flex-none accent-[var(--color-brand-black)]" />
                  <span aria-hidden className="flex-none w-8 h-8 rounded-full grid place-items-center bg-muted text-ink text-[11px] font-semibold">{initials(c.name)}</span>
                  <span className="min-w-0 flex-1 flex flex-col">
                    <span className="truncate font-medium text-ink">{c.name}</span>
                    <span className="truncate text-meta text-muted-ink">{cleanerHint(c)}</span>
                  </span>
                  {on && picked.length > 1 && picked[0] === c.id && <span className="flex-none text-caption text-gold-ink">Main</span>}
                </label>
              );
            })}
          </div>
          <div className="sticky bottom-0 bg-card flex items-center justify-end gap-2 p-2 [border-top:1px_solid_var(--color-line-soft)]">
            <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
            <Button type="button" variant={picked.length || !current.length ? 'primary' : 'danger'} size="sm" disabled={!changed} disabledReason="Change who is ticked first" onClick={apply}>
              {!picked.length && current.length ? 'Take everyone off' : picked.length > 1 ? `Apply ${picked.length}` : 'Apply'}
            </Button>
          </div>
        </div>
      </Floating>
    </>
  );
}

/** One job on tablet and up, laid out like the reference board: unit and status pill, who leaves, who arrives, the
 *  cleaner dropdown, and one button for what is next. Only the border carries the colour (red: checkout time passed
 *  and nobody ticked; yellow: guest out, clean not finished). */
function CleanCard({ r, now, active, busy, assigning, savingIn, cleaners, onSelect, onGuestLeft, onUndoLeft, onCheckIn, onAssign, picked, onPick }: {
  r: Row; now: number; active: boolean; busy: boolean; assigning: boolean; savingIn: boolean; cleaners: Cleaner[]; onSelect: () => void; onGuestLeft: () => void; onUndoLeft: () => void;
  onCheckIn: (time: string) => void; onAssign: (cleanerIds: string[], label: string) => void; picked?: boolean; onPick?: (on: boolean) => void;
}) {
  const st = statusOf('cleaning', r.status);
  const files = r.photoCount + r.videoCount;
  const mayTick = !!r.previous && r.status !== 'done' && r.status !== 'cleaning' && r.day <= mytDay(0);
  const pending = !!r.previous && !r.guestOut && r.status !== 'done' && r.status !== 'cleaning';
  const tone = rowTone(r, now);
  const meta = [r.unit?.size ?? r.unit?.layout, KIND_LABEL[r.kind] ?? r.kind].filter(Boolean).join(' · ');
  const arrives = r.day === mytDay(0) ? 'today' : dayLabel(r.day);
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); fn(); };
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onSelect} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
      className={cx('rounded-card border-2 border-solid p-4 text-copy cursor-pointer flex flex-col gap-3 min-w-0 outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-gold)]',
        active ? 'bg-gold-tint border-[var(--color-gold)]' : tone === 'overdue' ? 'bg-card border-danger-line' : tone === 'out' ? 'bg-card border-warning-line' : 'bg-card border-line hover:bg-page')}>
      <div className="flex items-start gap-3 min-w-0">
        {onPick && (
          <input type="checkbox" checked={!!picked} onChange={e => onPick(e.target.checked)} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
            aria-label={`Select ${r.unitNumber}, ${dayLabel(r.day)}`} className="flex-none w-4 h-4 mt-1.5 m-0 accent-[var(--color-brand-black)] cursor-pointer" />
        )}
        <div className="min-w-0 flex-1 flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
          <b className="text-[20px] leading-tight font-bold text-ink [overflow-wrap:anywhere]">{r.external ? r.external.address : r.unitNumber}</b>
          {r.carriedOver && <span className="text-meta font-medium text-muted-ink whitespace-nowrap" title={`Carried over from ${dayLabel(r.day)}`}>{dayLabel(r.day).replace(/^\w+\s/, '')}</span>}
        </div>
        <span className="flex-none">
          {pending
            ? <StatusBadge tone={tone === 'overdue' ? 'critical' : 'warning'} outline size="sm"><Icon name="LogOut" size="sm" />Pending checkout</StatusBadge>
            : <StatusBadge tone={st.tone} size="sm">{PHONE_STATUS[r.status] ?? st.label}</StatusBadge>}
        </span>
      </div>

      {r.external ? (
        <CardLine icon="Users" className="text-muted-ink"><span className="text-ink">{r.external.clientName ?? 'No client name'}</span>{r.external.clientPhone && <span>{r.external.clientPhone}</span>}</CardLine>
      ) : (
        <>
          {r.previous && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <CardLine icon="Users" className="text-muted-ink">
                <span className="text-ink">{r.previous.guestName}</span>
                {tone === 'overdue' ? <b className="text-gold-ink font-semibold">Past checkout time ({r.previous.checkOutTime})</b> : <span>Checkout by <b className="[font-variant-numeric:tabular-nums]">{r.previous.checkOutTime}</b></span>}
                {r.previous.lateCheckOut && <StatusBadge tone="warning" size="sm">Late checkout</StatusBadge>}
              </CardLine>
              {r.guestOut && r.guestLeftAt && (
                <div className="pl-6 text-meta text-muted-ink">
                  {r.guestLeftAuto ? `Out at checkout ${hm(r.guestLeftAt)} (automatic)` : `Left at ${hm(r.guestLeftAt)}`}
                  {mayTick && <> · <button type="button" disabled={busy} onClick={stop(onUndoLeft)} onKeyDown={e => e.stopPropagation()}
                    className="p-0 bg-transparent border-0 underline cursor-pointer text-muted-ink [font-family:inherit] [font-size:inherit] disabled:opacity-50">Undo</button></>}
                </div>
              )}
            </div>
          )}
          {r.next && (
            <CardLine icon="LogIn" className={cx('font-medium', r.status === 'done' ? 'text-muted-ink' : 'text-danger')}>
              <span>Next guest arrives {arrives} <CheckInTime time={r.next.checkInTime} saving={savingIn} onSave={r.next.reservationId && r.status !== 'done' ? onCheckIn : undefined} />
                {r.next.earlyCheckIn && <span className="ml-1.5"><StatusBadge tone="warning" size="sm">Early check-in</StatusBadge></span>}</span>
              <span className="text-meta whitespace-nowrap"><TimeLeft at={r.next.checkInAt} now={now} done={r.status === 'done'} /></span>
            </CardLine>
          )}
        </>
      )}

      {r.status === 'done' && <div className="text-meta text-muted-ink">{r.completedAt ? `Done ${hm(r.completedAt)}` : 'Done'}{files > 0 ? ` · ${files} ${files === 1 ? 'photo' : 'photos'}` : ''}</div>}

      <div className="flex items-center gap-2 min-w-0">
        <CleanerChip r={r} cleaners={cleaners} assigning={assigning} onAssign={onAssign} />
        {meta && <span className="ml-auto min-w-0 truncate text-meta text-muted-ink">{meta}</span>}
      </div>

      {mayTick && !r.guestOut && (
        <Button size="sm" variant={tone === 'overdue' ? 'danger' : 'primary'} className="w-full mt-auto" loading={busy} onClick={stop(onGuestLeft)}>Guest has left</Button>
      )}
    </div>
  );
}

/** A checkout with no cleaning job yet, drawn like a job card. */
function DepartureCard({ d, now, future, busy, savingIn, onGuestLeft, onCheckIn, onPlan }: {
  d: Departure; now: number; future: boolean; busy: { left: boolean; plan: boolean }; savingIn: boolean;
  onGuestLeft: () => void; onCheckIn: (time: string) => void; onPlan: () => void;
}) {
  return (
    <div className="rounded-card border-2 border-solid border-danger-line bg-card p-4 text-copy flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-3 min-w-0">
        <b className="min-w-0 flex-1 text-[20px] leading-tight font-bold text-ink [overflow-wrap:anywhere]">{d.unitNumber}</b>
        <span className="flex-none"><StatusBadge tone="critical" outline size="sm">No cleaning job</StatusBadge></span>
      </div>
      <CardLine icon="Users" className="text-muted-ink">
        <span className="text-ink">{d.guestName}</span>
        <span>Checkout by <b className="[font-variant-numeric:tabular-nums]">{d.checkOutTime}</b></span>
        {d.lateCheckOut && <StatusBadge tone="warning" size="sm">Late checkout</StatusBadge>}
        {d.state === 'checked_out' && <StatusBadge tone="gold" size="sm">Out</StatusBadge>}
      </CardLine>
      {d.next && (
        <CardLine icon="LogIn" className="font-medium text-danger">
          <span>Next guest arrives today <CheckInTime time={d.next.checkInTime} saving={savingIn} onSave={d.next.reservationId ? onCheckIn : undefined} /></span>
          <span className="text-meta whitespace-nowrap"><TimeLeft at={d.next.checkInAt} now={now} /></span>
        </CardLine>
      )}
      <div className="mt-auto flex flex-col gap-2">
        <Button size="sm" variant="primary" className="w-full" loading={busy.plan} onClick={onPlan}>Plan cleaning</Button>
        {d.state !== 'checked_out' && !future && <Button size="sm" variant="secondary" className="w-full" loading={busy.left} onClick={onGuestLeft}>Guest has left</Button>}
      </div>
    </div>
  );
}

/** Red: the checkout time has passed and nobody ticked the guest out. Yellow: the guest is out, the clean not finished. */
const rowTone = (r: Row, now: number): CleanRowTone =>
  cleanRowTone({ day: r.day, status: r.status, guestOut: r.guestOut, checkOutTime: r.previous?.checkOutTime ?? null }, now);
const TONE_BG: Record<NonNullable<CleanRowTone> | 'none', string> = { overdue: 'bg-danger-bg', out: 'bg-warning-bg', none: 'hover:bg-page' };
const OVERDUE_NOTE = 'Checkout time passed. Tick when the guest has left.';

/** Phone status words: the tick on the card already says the guest is out. */
const PHONE_STATUS: Record<string, string> = { ready: 'Ready to clean', done: 'Done' };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

/** One job on a phone: unit and status; who leaves and who arrives, each with the full name; layout, type, cleaner. */
function PhoneCleanCard({ r, now, active, busy, onSelect, onGuestLeft, onUndoLeft, picked, onPick }: {
  r: Row; now: number; active: boolean; busy: boolean; onSelect: () => void; onGuestLeft: () => void; onUndoLeft: () => void;
  picked?: boolean; onPick?: (on: boolean) => void;
}) {
  const st = statusOf('cleaning', r.status);
  const mayTick = !!r.previous && r.status !== 'done' && r.status !== 'cleaning' && r.day <= mytDay(0);
  const names = r.cleaners.length ? r.cleaners.map(c => c.name) : r.assigneeName ? [r.assigneeName] : [];
  const meta = [r.unit?.size ?? r.unit?.layout, KIND_LABEL[r.kind] ?? r.kind].filter(Boolean).join(' · ');
  const tone = rowTone(r, now);
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onSelect} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
      className={cx('px-3 py-2.5 [border-top:1px_solid_var(--color-line-soft)] text-copy cursor-pointer flex flex-col gap-1 outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-gold)]',
        active ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : tone ? TONE_BG[tone] : 'active:bg-page')}>
      {/* Wraps rather than cutting the unit code short (it read "C." on a phone). */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
        {onPick && (
          <input type="checkbox" checked={!!picked} onChange={e => onPick(e.target.checked)} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
            aria-label={`Select ${r.unitNumber}, ${dayLabel(r.day)}`} className="flex-none w-4 h-4 m-0 accent-[var(--color-brand-black)] cursor-pointer" />
        )}
        {r.external ? <b className="min-w-0 truncate text-ink">{r.external.address}</b> : <b className="flex-none whitespace-nowrap text-ink">{r.unitNumber}</b>}
        {r.carriedOver && <span className="min-w-0 flex"><StatusBadge tone="warning" size="sm" title={`Carried over from ${dayLabel(r.day)}`}>{dayLabel(r.day).replace(/^\w+\s/, '')}</StatusBadge></span>}
        <span className="ml-auto min-w-0 flex items-center justify-end gap-1.5"><StatusBadge tone={st.tone} size="sm">{PHONE_STATUS[r.status] ?? st.label}</StatusBadge>
          {mayTick && <GuestOutTick out={r.guestOut} busy={busy} onTick={r.guestOut ? onUndoLeft : onGuestLeft} small />}</span>
      </div>
      {r.external ? (
        <div className="min-w-0 truncate">{r.external.clientName ?? <span className="text-muted-ink">No client name</span>}{r.external.clientPhone && <span className="text-muted-ink"> · {r.external.clientPhone}</span>}</div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 min-w-0">
          {r.previous ? (
            <PhoneStay label="Out" time={r.previous.checkOutTime} name={r.previous.guestName}
              aside={!mayTick && r.guestOut && <span className="flex-none text-gold-ink" title="Guest is out"><Icon name="Check" size="sm" /></span>}
              note={tone === 'overdue' ? OVERDUE_NOTE : r.guestOut && r.guestLeftAt ? (r.guestLeftAuto ? `Out at checkout ${hm(r.guestLeftAt)} (automatic)` : `Left at ${hm(r.guestLeftAt)}`) : undefined} />
          ) : <PhoneStay label="No guest leaving" />}
          {r.next ? <PhoneStay label="In" time={r.next.checkInTime} name={r.next.guestName}
              aside={r.status !== 'done' && <span className="ml-auto pl-1 text-meta whitespace-nowrap"><TimeLeft at={r.next.checkInAt} now={now} /></span>} />
            : <PhoneStay label="No check-in" />}
        </div>
      )}
      <div className="flex items-center gap-2 min-w-0 text-meta text-muted-ink">
        <span className="min-w-0 truncate">
          {meta}
        </span>
        <span className="flex-none ml-auto flex items-center" title={names.join(', ') || undefined}>
          {names.length ? <>
            {names.slice(0, 2).map((n, i) => (
              <span key={i} aria-hidden className={cx('w-6 h-6 rounded-full grid place-items-center bg-muted text-ink text-[10px] font-semibold border-2 border-solid border-card', i > 0 && '-ml-1.5')}>{initials(n)}</span>
            ))}
            {names.length > 2 && <span aria-hidden className="ml-1 font-semibold">+{names.length - 2}</span>}
            {names.length === 1 && <span aria-hidden className="ml-1.5 max-w-[96px] truncate text-ink">{names[0]!.split(/\s+/)[0]}</span>}
            <span className="sr-only">{names.join(', ')}</span>
          </> : <span className="text-danger font-medium">Unassigned</span>}
        </span>
      </div>
    </div>
  );
}

/**
 * One side of a phone card, top to bottom: label and time, the full guest name (wraps, never cut short), then a note.
 * A side with a guest takes an equal share of the row and wraps under the other below 140px; an empty side ("No
 * check-in") only takes its own width, so the other grows into the rest.
 */
function PhoneStay({ label, time, name, aside, note }: { label: string; time?: string; name?: string; aside?: ReactNode; note?: string }) {
  return (
    <div className={cx('min-w-0 flex flex-col', name ? 'flex-[1_1_140px]' : 'flex-none')}>
      <span className="flex items-center gap-1.5 min-h-6"><span className="text-muted-ink">{label}</span>{time && <b className="tabular-nums">{time}</b>}{aside}</span>
      {name && <span className="text-ink [overflow-wrap:anywhere]">{name}</span>}
      {note && <span className="text-meta text-muted-ink">{note}</span>}
    </div>
  );
}

/** The "guest has checked out" tick: one tap marks them out, a second tap takes it back (until the clean starts). */
function GuestOutTick({ out, busy, onTick, small }: { out: boolean; busy: boolean; onTick: () => void; small?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={out} aria-label={out ? 'Guest is out. Tap to undo.' : 'Mark the guest as checked out'} disabled={busy}
      title={out ? 'Guest is out. Tap to undo.' : 'Guest has checked out'}
      onClick={e => { e.stopPropagation(); onTick(); }} onKeyDown={e => e.stopPropagation()}
      className={cx('flex-none grid place-items-center', small ? 'w-6 h-6 -my-0.5 ml-0.5' : 'w-7 h-7 -my-1', 'rounded-control border border-solid cursor-pointer disabled:opacity-50',
        out ? 'bg-black border-black text-white' : 'bg-card border-line text-transparent hover:border-ink hover:text-muted-ink')}>
      <Icon name="Check" size="sm" />
    </button>
  );
}

/** The next guest's check-in time: tap it to change it right on the row (a time picker), which moves Time left. */
function CheckInTime({ time, saving, onSave }: { time: string; saving: boolean; onSave?: (time: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(time);
  useEffect(() => { setV(time); }, [time]);
  if (!onSave) return <b className="[font-variant-numeric:tabular-nums]">{time}</b>;
  if (!editing) {
    return (
      <button type="button" onClick={e => { e.stopPropagation(); setEditing(true); }} onKeyDown={e => e.stopPropagation()} disabled={saving} title="Change the check-in time"
        className="p-0 bg-transparent border-0 [border-bottom:1px_dashed_var(--color-muted-ink)] cursor-pointer font-bold text-ink [font-family:inherit] text-[length:inherit] [font-variant-numeric:tabular-nums]">
        {saving ? '...' : time}
      </button>
    );
  }
  const save = () => { setEditing(false); if (v && v !== time) onSave(v); };
  return (
    <span onClick={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') { setV(time); setEditing(false); } }} className="inline-flex items-center gap-1 align-middle">
      <TimeField aria-label="Next check-in time" autoFocus value={v} onChange={setV} className={cx(INPUT, 'h-8 w-[110px] px-2')} />
      <button type="button" onClick={save} aria-label="Save the check-in time" className="h-8 w-8 grid place-items-center rounded-control border border-solid border-black bg-black text-white cursor-pointer"><Icon name="Check" size="sm" /></button>
    </span>
  );
}

/* ---------- the detail panel ---------- */

function CleanDetail({ row, now, onClose, onChanged, onGuestLeft, onCheckIn, savingIn }: {
  row: Row; now: number; onClose: () => void; onChanged: () => void; onGuestLeft: () => void; onCheckIn: (time: string) => void; savingIn: boolean;
}) {
  const toast = useToast();
  const { data, reload, error } = useApi<Detail>(`/housekeeping/tasks/${row.id}`);
  const { cleaners } = useCleaners(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [damage, setDamage] = useState(false);
  const openAdd = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => { reload(); onChanged(); }, [reload, onChanged]);
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); return true; }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); return false; }
    finally { setBusy(null); }
  }
  // What was just picked shows at once; the board can take a while to come back on a busy day.
  const [picked, setPicked] = useState<{ kind?: string }>({});
  useEffect(() => { setPicked({}); }, [row.kind]);
  // The cleaners on the job, in order: what was just saved shows at once, the board's answer replaces it.
  const rowTeam = row.cleaners.map(c => c.cleanerId).filter((x): x is string => !!x);
  const [team, setTeam] = useState<string[] | null>(null);
  useEffect(() => { setTeam(null); }, [rowTeam.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownTeam = team ?? rowTeam;
  const teamNames: Record<string, string> = Object.fromEntries(row.cleaners.filter(c => c.cleanerId).map(c => [c.cleanerId!, c.name]));
  function saveTeam(ids: string[]) {
    setTeam(ids);
    void act('assign', () => api.post(`/housekeeping/tasks/${row.id}/assign`, { cleanerIds: ids, force: true }),
      ids.length > 1 ? `${ids.length} cleaners on this job.` : ids.length ? 'Cleaner assigned.' : 'Cleaner taken off.')
      .then(ok => { if (!ok) setTeam(null); });
  }
  async function reveal(id: string) {
    try { const r = await api.get<{ secret: string }>(`/access-credentials/${id}?reveal=true`); setRevealed(x => ({ ...x, [id]: r.secret || '(no code set)' })); }
    catch (e) { toast({ tone: 'critical', title: 'Code not shown.', body: errorMessage(e, 'Try again.') }); }
  }
  // Show again fetches again, so every look at the code stays in the audit log.
  const hide = (id: string) => setRevealed(({ [id]: _, ...rest }) => rest);

  const done = row.state === 'resolved';
  const st = statusOf('cleaning', row.status);
  const files = data?.media.length ?? row.photoCount + row.videoCount;
  const used = row.startedAt ? (Date.parse(row.completedAt ?? new Date(now).toISOString()) - Date.parse(row.startedAt)) / 60000 : null;
  const unitLabel = `${row.propertyName} ${row.unitNumber}`;
  const kind = picked.kind ?? row.kind;
  const kindName = KIND_NAME[kind] ?? 'Basic clean';
  const cleanerName = shownTeam.length ? shownTeam.map(id => teamNames[id] ?? cleaners.find(c => c.id === id)?.name ?? 'Cleaner').join(', ') : row.assigneeName;
  const size = sizeLine(data?.unit?.size ?? row.unit?.size, data?.unit?.layout ?? row.unit?.layout);
  const origin = data?.createdAt ? {
    at: data.createdAt,
    label: row.previous ? `Cleaning job created for ${row.previous.guestName}'s checkout` : 'Cleaning job created',
  } : undefined;

  return (
    <div className="ops-detail flex flex-col gap-4 p-5 text-copy">
      <div className="sticky top-0 z-[2] -mx-5 -mt-5 px-5 pt-4 pb-4 bg-black text-white flex items-start gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gold">{row.propertyName}</div>
          <div className="text-[19px] leading-tight font-semibold">{row.unitNumber} · {kindName}</div>
          {size && <div className="text-meta text-on-dark">{size}</div>}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <StatusBadge tone={st.tone}>{done && row.completedAt ? `Done ${hm(row.completedAt)}` : st.label}</StatusBadge>
            {row.startedAt && <span className="text-meta text-on-dark">Started {hm(row.startedAt)}{used != null ? ` · ${done ? 'took' : 'so far'} ${minutesLabel(used)}` : ''}</span>}
          </div>
        </div>
        <span className="[&_button]:text-white [&_button]:border-charcoal [&_button]:bg-transparent"><CloseButton onClick={onClose} className="max-md:w-11 max-md:h-11" /></span>
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}

      {done ? (
        <div className="rounded-control border border-solid border-line p-3 grid grid-cols-2 gap-x-3 gap-y-1">
          <span className="text-meta text-muted-ink">{shownTeam.length > 1 ? 'Cleaners' : 'Cleaner'}</span><span className="text-meta text-muted-ink">Type</span>
          <b>{cleanerName ?? 'Not recorded'}</b><b>{kindName}</b>
        </div>
      ) : (
        <section className="flex flex-col gap-2.5">
          <FormRow label={shownTeam.length > 1 ? 'Cleaners' : 'Cleaner'} hint={!shownTeam.length && row.assigneeName ? `Now with ${row.assigneeName}, who is not on the cleaner roster.` : undefined}>
            <CleanerChips cleaners={cleaners} value={shownTeam} names={teamNames} onChange={saveTeam} disabled={busy === 'assign'} required />
          </FormRow>
          <div className="grid grid-cols-2 gap-2.5">
          <FormRow label="Type">
            <select className={INPUT} value={kind} disabled={busy === 'kind'} onChange={e => { const v = e.target.value; setPicked(p => ({ ...p, kind: v })); void act('kind', () => api.patch(`/housekeeping/tasks/${row.id}`, { kind: v, title: cleanTitle(v, row.title) }), 'Cleaning type changed.').then(ok => { if (!ok) setPicked(p => ({ ...p, kind: undefined })); }); }}>
              <CleanTypeOptions current={row.kind} />
            </select>
          </FormRow>
          </div>
        </section>
      )}

      {row.external ? (
        <div className="rounded-control bg-muted p-2.5 flex flex-col gap-0.5">
          <span className="text-meta text-muted-ink">External job</span>
          <b>{row.external.address}</b>
          {(row.external.clientName || row.external.clientPhone) && <span>{[row.external.clientName, row.external.clientPhone].filter(Boolean).join(' · ')}</span>}
          <span className="text-meta text-muted-ink">Not one of our units: it counts in the cleaner's pay and never reaches a unit's costs or an owner statement.</span>
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-control bg-muted p-2.5 flex flex-col gap-0.5">
          <span className="text-meta text-muted-ink">Leaving</span>
          {row.previous ? <><span><b>{row.previous.checkOutTime}</b> {row.previous.guestName}</span>
            {row.previous.lateCheckOut && <span className="text-meta text-warning">Late checkout</span>}
            {row.guestOut ? <span className="text-meta text-gold-ink font-medium">Guest out{row.guestLeftAt ? ` at ${hm(row.guestLeftAt)}` : ''}{row.guestLeftAuto ? ' (automatic, at the checkout time)' : ''}</span>
              : !done && row.day <= mytDay(0) && <Button size="sm" variant="secondary" className="mt-1 self-start" onClick={onGuestLeft}>Guest left</Button>}</>
            : <span className="text-muted-ink">No departing guest</span>}
        </div>
        <div className="rounded-control bg-gold-tint p-2.5 flex flex-col gap-0.5">
          <span className="text-meta text-muted-ink">Arriving</span>
          {row.next ? <><span><CheckInTime time={row.next.checkInTime} saving={savingIn} onSave={row.next.reservationId && !done ? onCheckIn : undefined} /> {row.next.guestName}{row.next.guests ? ` · ${row.next.guests} ${row.next.guests === 1 ? 'guest' : 'guests'}` : ''}</span>
            {row.next.earlyCheckIn && <span className="text-meta text-warning">Early check-in</span>}
            <span className="text-meta">Time left <TimeLeft at={row.next.checkInAt} now={now} done={done} /></span></>
            : <span className="text-muted-ink">No check-in</span>}
        </div>
      </div>
      )}
      {/* The departing guest asks to stay later: the request, its price and remark, then Guest paid moves the checkout. */}
      {!row.external && row.previous && !done && <LateCheckoutBlock reservationId={row.previous.reservationId} onChanged={onChanged} />}

      <section className="flex flex-col gap-2">
        <AttachmentLabel title="Proof of work" count={files} hint={!done && files === 0 ? 'At least 1 photo or video to complete' : undefined} />
        {data ? <MediaGallery items={data.media} upload={done ? undefined : uploadTo(`/tasks/${row.id}/photos`)} onDone={refresh} addLabel="Add photos or videos" emptyText="No photos were added." openAddRef={openAdd} />
          : <Skeleton height={84} />}
        {done && row.completedAt && (
          <span className="text-meta text-muted-ink">Marked complete {stamp(row.completedAt)}{data?.completedBy ? ` by ${data.completedBy}` : ''}.</span>
        )}
      </section>

      {/* Phones: the main action is pinned to the bottom of the sheet (the last item, stuck there), since the sheet
          runs well past one screen. */}
      {!done && (
        <div className="grid grid-flow-col auto-cols-fr gap-3 max-md:order-last max-md:sticky max-md:bottom-0 max-md:z-[2] max-md:-mx-5 max-md:-mb-5 max-md:px-5 max-md:pt-3 max-md:pb-[calc(12px+env(safe-area-inset-bottom))] max-md:bg-card max-md:[border-top:1px_solid_var(--color-line)]">
          {row.state !== 'in_progress' && (
            // One black button, the next step: Start until the clean is under way, then a photo, then Mark complete.
            <Button variant="primary" icon={<Icon name="Play" size="sm" />} loading={busy === 'start'} onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${row.id}/start`, {}), 'Cleaning job started.')}>Start</Button>
          )}
          {row.state === 'in_progress' && files === 0 && (
            <Button variant="primary" icon={<Icon name="ImagePlus" size="sm" />} onClick={() => openAdd.current?.()}>Add photos or videos</Button>
          )}
          <Button variant={row.state === 'in_progress' && files > 0 ? 'primary' : 'outline'} icon={<Icon name="Check" size="sm" />} loading={busy === 'complete'} disabled={files === 0} disabledReason="Add at least one photo or video first."
            onClick={() => void act('complete', async () => {
              const r = await api.post<{ cost: { amount: number; created: boolean; reason: string | null } | null }>(`/tasks/${row.id}/complete`, { photoIds: [] });
              if (r.cost && !r.cost.created && r.cost.reason && r.cost.reason !== 'already charged') toast({ tone: 'info', title: 'Cost not added.', body: `Not charged to the unit: ${r.cost.reason}.` });
            }, 'Cleaning job complete.', `${unitLabel} is ready.`)}>
            Mark complete
          </Button>
        </div>
      )}
      {data?.cost && <CleanAmount taskId={row.id} cost={data.cost} external={!!row.external} done={done} kindName={kindName} onSaved={refresh} />}
      {data?.cost && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">Cost and profit</h3>
          <JobMoneyPanel kind="cleaning" jobId={row.id} unitId={row.unitId ?? null} onChanged={refresh} />
        </section>
      )}

      {!row.external && <section className="flex flex-col gap-2">
        <h3 className="m-0 text-copy font-semibold">Door access</h3>
        {!data ? <Skeleton height={36} /> : data.access.length === 0 ? <span className="text-muted-ink">No access details on this unit. Add them on the unit's Access tab.</span>
          : data.access.map(a => (
            <div key={a.id} className="rounded-control bg-muted p-2.5 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium">{a.label}</span>
                {a.hasCode && (revealed[a.id] ? <span className="font-mono text-heading">{revealed[a.id]}</span> : a.masked && <span className="font-mono text-muted-ink">{a.masked}</span>)}
                {a.hasCode && data.mayReveal && <button type="button" onClick={() => revealed[a.id] ? hide(a.id) : void reveal(a.id)} className="text-gold-ink font-medium cursor-pointer underline-offset-2 hover:underline bg-transparent border-0 p-0 max-md:min-h-11 max-md:min-w-11 max-md:-my-2.5 [font-family:inherit]">{revealed[a.id] ? 'Hide' : 'Show'}</button>}
              </div>
              {/* The note is free text and often repeats the code, so it stays behind Show with it. Without the right to
                  reveal it shows as before: the server sends it to every role, cleaners included, as their way in. */}
              {(!a.hasCode || !data.mayReveal || revealed[a.id]) && <span className="text-meta text-muted-ink">{a.instruction}</span>}
            </div>
          ))}
        {data && !data.mayReveal && data.access.some(a => a.hasCode) && <span className="text-meta text-muted-ink">Codes are shown to operations managers and management only.</span>}
        {data?.parking && <span className="text-meta"><span className="text-muted-ink">Car park:</span> {data.parking}</span>}
      </section>}

      {data && data.damage.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-copy font-semibold">Damage reported</h3>
          {data.damage.map(d => <Link key={d.id} to={`/operations/maintenance?id=${d.id}`} className="text-gold-ink">{d.title} · {stamp(d.reportedAt)}</Link>)}
        </section>
      )}
      {!row.external && <Button variant="danger" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>Report damage</Button>}

      <PhoneHistory>
        <section className="rounded-card border border-solid border-line overflow-hidden">
          <div className="py-2.5 px-4 [border-bottom:1px_solid_var(--color-line-soft)] flex items-center gap-2 text-copy font-semibold"><Icon name="History" size="sm" />History</div>
          <RecordHistory entity="tasks" id={row.id} also={data?.reservationId ? [['reservations', data.reservationId]] : undefined} alsoActions={['reservation.status']}
            bare pageSize={10} refreshKey={data} origin={origin} />
        </section>
      </PhoneHistory>

      {damage && row.unitId && (
        <ReportDamageModal unitId={row.unitId} unitLabel={unitLabel} taskId={row.id} onClose={() => setDamage(false)}
          onDone={() => { setDamage(false); toast({ tone: 'success', title: 'Damage reported.', body: 'A Maintenance job is open on this unit.' }); refresh(); }} />
      )}
    </div>
  );
}

/** The clean's amount: what it is charged (the cleaning fee on the unit's costs, or the external job's price) and what the
 *  cleaner is paid. The office may type its own figure until the clean is charged. */
function CleanAmount({ taskId, cost, external, done, kindName, onSaved }: {
  taskId: string; cost: NonNullable<Detail['cost']>; external: boolean; done: boolean; kindName: string; onSaved: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [sen, setSen] = useState<number | null>(cost.amount);
  const [busy, setBusy] = useState(false);
  const notSet = cost.priceSet === false;
  async function save() {
    if (external && sen == null) { toast({ tone: 'critical', title: 'An external job needs its amount.' }); return; }
    setBusy(true);
    try { await api.patch(`/housekeeping/tasks/${taskId}`, { amount: sen }); toast({ tone: 'success', title: 'Amount saved.' }); setEditing(false); onSaved(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); }
    finally { setBusy(false); }
  }
  return (
    <section className="rounded-control border border-solid border-line p-3 flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 font-semibold">Amount</span>
        {!done && !cost.charged && !editing && <button type="button" onClick={() => { setSen(notSet ? null : cost.amount); setEditing(true); }} className="text-gold-ink font-medium cursor-pointer bg-transparent border-0 p-0 max-md:min-h-11 max-md:min-w-11 max-md:-my-2.5 [font-family:inherit]">Change</button>}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <MoneyInput className={cx(INPUT, 'flex-1')} valueSen={sen} onChangeSen={setSen} aria-label="Amount in RM" />
          <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      ) : notSet ? (
        <span className="text-warning">Price not set. {external ? '' : 'Set it in Cleaning > Prices, or type one here; until then the old cleaning rate is used.'}</span>
      ) : (
        <span className="text-heading tabular-nums">{rm(cost.amount)}</span>
      )}
      <span className="text-meta text-muted-ink">
        {external ? 'The price of this external job.'
          : cost.charged ? `Charged to the unit: ${kindName}.` : `Charged to the unit when complete: ${kindName} (${COST_SOURCE[cost.source] ?? cost.source}).`}
        {cost.cleanerPay != null ? ` Internal cost ${rm(cost.cleanerPay)}.` : ''}
      </span>
    </section>
  );
}

/* ---------- dialogs ---------- */

function NewCleanModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const units = useUnitRoster();
  const { user } = useSession();
  // CS (operations staff) asks for the clean; Basic or Deep is the cleaning team's call (26 Oct 2026).
  const picksType = user?.role !== 'operations_staff';
  const [unitId, setUnitId] = useState('');
  const [day, setDay] = useState(date);
  const { cleaners } = useCleaners(true, day);
  const [kind, setKind] = useState('turnover');
  const [cleanerIds, setCleanerIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [touchedAmount, setTouchedAmount] = useState(false);
  const [pay, setPay] = useState<number | null>(null);
  const [touchedPay, setTouchedPay] = useState(false);
  const [itemId, setItemId] = useState('');
  const [layout, setLayout] = useState('studio');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ unit?: string; address?: string; amount?: string; form?: string }>({});
  const external = unitId === EXTERNAL;
  // The job is priced from Service prices: the item for the clean type (or another one picked, or Other with typed
  // amounts), at the unit's layout, its own figures first. Both amounts can be typed over.
  const service = useApi<{ ready: boolean; layouts: string[]; items: { id: string; code: string; name: string; active: boolean; cleanKind: string | null; byLayout: boolean; current: Record<string, { ownerPrice: number | null; internalCost: number | null }> }[] }>('/operations/service-prices?domain=cleaning');
  const items = (service.data?.items ?? []).filter(i => i.active);
  const ready = !!service.data?.ready;
  const prices = useApi<{ ready: boolean; rows: { unitId: string; layout: string; prices: Record<string, { externalCharge: number | null; internalCost: number | null }> }[] }>('/housekeeping/unit-prices');
  const unitRow = !external && unitId ? prices.data?.rows.find(r => r.unitId === unitId) : undefined;
  const forKind = items.find(i => i.cleanKind === kind);
  const item = itemId === 'other' ? null : items.find(i => i.id === itemId) ?? forKind ?? null;
  useEffect(() => { setItemId(''); }, [kind]);
  const at = item ? item.current[item.byLayout ? (external ? layout : unitRow?.layout ?? 'other') : 'all'] : undefined;
  const fromUnit = !external && item && item.id === forKind?.id ? unitRow?.prices[kind] : undefined;
  const suggested = itemId === 'other' ? null : fromUnit?.externalCharge ?? at?.ownerPrice ?? (ready ? null : unitRow?.prices[kind]?.externalCharge ?? null);
  const suggestedPay = itemId === 'other' ? null : fromUnit?.internalCost ?? at?.internalCost ?? null;
  useEffect(() => { if (!touchedAmount) setAmount(suggested); }, [unitId, kind, itemId, layout, suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!touchedPay) setPay(suggestedPay); }, [unitId, kind, itemId, layout, suggestedPay]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    const bad = { unit: unitId ? undefined : 'Pick a unit, or External.', address: external && !address.trim() ? 'Enter the address.' : undefined, amount: external && amount == null ? 'Enter the amount.' : undefined };
    if (bad.unit || bad.address || bad.amount) { setError(bad); return; }
    setBusy(true); setError({});
    try {
      const title = item && itemId ? item.name : KIND_NAME[kind] ?? 'Basic clean';
      await api.post('/housekeeping/tasks', {
        ...(external ? { external: { address: address.trim(), clientName: client.trim() || undefined, clientPhone: phone.trim() || undefined }, layout } : { unitId }),
        date: day, kind, cleanerIds, instructions: notes.trim() || undefined, title,
        ...(ready && itemId ? { serviceItemId: itemId } : {}),
        ...(amount != null && (external || touchedAmount || itemId === 'other') ? { amount } : {}),
        ...(pay != null && (touchedPay || itemId === 'other') ? { cleanerPay: pay } : {}),
      });
      onDone();
    } catch (e) { setError({ form: errorMessage(e, 'Not saved. Try again.') }); setBusy(false); }
  }
  return (
    <OpsModal title="Add cleaning job" sub="For a deep clean, a refresh, a cleaning job no reservation created, or a job at an outside address." onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Add cleaning job</Button></>}>
      <FormRow label="Unit" error={error.unit} hint="One of our units, or External for a job at another address.">
        <UnitPicker units={units} value={unitId} onChange={v => { setUnitId(v); setError(x => ({ ...x, unit: undefined })); }} pinned={EXTERNAL_CHOICE} placeholder="Search building or unit, or External" />
      </FormRow>
      {external && (
        <>
          <FormRow label="Address" error={error.address}>
            <input className={INPUT} value={address} onChange={e => { setAddress(e.target.value); setError(x => ({ ...x, address: undefined })); }} maxLength={300} placeholder="e.g. 12 Jalan Ampang, Kuala Lumpur" />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Client name (optional)"><input className={INPUT} value={client} onChange={e => setClient(e.target.value)} maxLength={120} /></FormRow>
            <FormRow label="Client phone (optional)"><input className={INPUT} value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} inputMode="tel" /></FormRow>
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Day"><DateField aria-label="Day" className={INPUT} value={day} onChange={v => v && setDay(v)} /></FormRow>
        {picksType ? (
          <FormRow label="Type">
            <select className={INPUT} value={kind} onChange={e => setKind(e.target.value)}><CleanTypeOptions /></select>
          </FormRow>
        ) : (
          <FormRow label="Type" hint="The cleaning team switches it to Deep clean when needed."><span className="text-copy">Basic clean (BC)</span></FormRow>
        )}
      </div>
      {/* A job on one of our units is priced from Cleaning > Prices, so it shows no pricing (staff sheet CLEANING,
          23 Oct 2026); an external job still needs its item and amounts. */}
      {ready && external && (
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Item" hint={itemId === 'other' ? 'Type both amounts below.' : 'From Service prices.'}>
            <select className={INPUT} value={itemId || forKind?.id || ''} onChange={e => setItemId(e.target.value)} aria-label="Item">
              {!forKind && <option value="">No item for this type</option>}
              {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              <option value="other">Other (type the amounts)</option>
            </select>
          </FormRow>
          {item?.byLayout && (
            <FormRow label="Layout" hint="Priced as this layout.">
              <select className={INPUT} value={layout} onChange={e => setLayout(e.target.value)} aria-label="Layout">
                {(service.data?.layouts ?? []).map(l => <option key={l} value={l}>{LAYOUT_NAME[l] ?? l}</option>)}
              </select>
            </FormRow>
          )}
        </div>
      )}
      {external && (
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Charge, RM" error={error.amount} hint="What the client is charged.">
            <MoneyInput className={INPUT} valueSen={amount} onChangeSen={v => { setAmount(v); setTouchedAmount(true); setError(x => ({ ...x, amount: undefined })); }} aria-label="Charge in RM" />
          </FormRow>
          <FormRow label="Internal cost, RM" hint="What the cleaner is paid for this job.">
            <MoneyInput className={INPUT} valueSen={pay} onChangeSen={v => { setPay(v); setTouchedPay(true); }} aria-label="Internal cost in RM" placeholder="Not set" />
          </FormRow>
        </div>
      )}
      <div className="flex flex-col gap-1.5 min-w-0">
        <CleanerChecklist cleaners={cleaners} value={cleanerIds} onChange={setCleanerIds} label="Cleaners (optional)" day={day} />
        {!cleanerIds.length && <span className="text-meta text-muted-ink">Leave empty to assign later. Tick more than one for a team.</span>}
      </div>
      <FormRow label="Notes for the cleaner (optional)"><textarea className={TEXTAREA} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} /></FormRow>
      {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
    </OpsModal>
  );
}

const EXTERNAL = '__external__';
const LAYOUT_NAME: Record<string, string> = { studio: 'Studio', '1_bedroom': '1 bedroom', '2_bedroom': '2 bedroom', '3_bedroom': '3 bedroom', '4_plus_bedroom': '4+ bedroom', duplex: 'Duplex', dual_key: 'Dual key', penthouse: 'Penthouse', other: 'Other' };
const EXTERNAL_CHOICE = { id: EXTERNAL, label: 'External (not one of our units)' };

function AssignBuildingModal({ building, date, onClose, onDone }: { building: { buildingId: string; name: string }; date: string; onClose: () => void; onDone: (n: number, who: string) => void }) {
  const { cleaners } = useCleaners(true, date);
  const [cleanerIds, setCleanerIds] = useState<string[]>([]);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!cleanerIds.length) { setError('Pick at least one cleaner.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ assigned: number; assigneeName: string }>('/housekeeping/assign-building', { buildingId: building.buildingId, date, cleanerIds, onlyUnassigned });
      onDone(r.assigned, r.assigneeName);
    } catch (e) { setError(errorMessage(e, 'Not saved. Try again.')); setBusy(false); }
  }
  return (
    <OpsModal title={`Assign ${building.name}`} sub={`Every unfinished cleaning job in this building on ${dayLabel(date)} goes to the cleaners you tick. Tick two or more to send a team to every unit.`} onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Assign</Button></>}>
      <CleanerChecklist cleaners={cleaners} value={cleanerIds} onChange={ids => { setCleanerIds(ids); setError(null); }} error={error} day={date} />
      <label className="flex items-center gap-2 text-copy cursor-pointer">
        <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} className="w-4 h-4 accent-black" />
        Only cleaning jobs with no cleaner yet
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
  { value: '', label: 'Finished' }, { value: 'active', label: 'Not finished' }, { value: 'all', label: 'All cleaning jobs' },
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
  const [confirmDone, setConfirmDone] = useState<{ rows: HistoryRow[]; clear: () => void } | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const r = await fetchAllPages<HistoryRow>(async (page, size) => {
      const p = await api.get<HistoryPayload>('/tasks', { ...query, export: '1', page, size });
      return { rows: p.data, total: p.total };
    }, { onProgress });
    return r.rows;
  }

  /** Starts or finishes the ticked cleans one by one; finished (or already started) ones are left alone and named. */
  async function bulkMove(rows: HistoryRow[], move: 'start' | 'done', clear: () => void) {
    // A clean needs a photo or video to be marked done: say so up front rather than send requests bound to be refused.
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

  const columns = useMemo<Column<HistoryRow>[]>(() => [
    { key: 'day', label: 'Day', type: 'date', value: r => r.date, sortKey: 'day', width: 120, render: r => <span className="tabular-nums whitespace-nowrap">{dayLabel(r.date)}</span> },
    { key: 'building', label: 'Building', value: r => r.propertyName, sortKey: 'building', width: 170 },
    { key: 'unit', label: 'Unit', value: r => r.unitNumber, sortKey: 'unit', width: 100, hideable: false, render: r => <span className="font-medium">{r.unitNumber}</span> },
    { key: 'kind', label: 'Type', value: r => r.kind, text: r => KIND_LABEL[r.kind] ?? r.kind, sortKey: 'kind', width: 100 },
    { key: 'cleaner', label: 'Cleaner', type: 'person', value: r => r.assigneeName ?? r.sheetCleaner, sortKey: 'cleaner', width: 160 },
    { key: 'state', label: 'Status', type: 'status', value: r => r.state, status: r => TASK_STATE[r.state] ?? { label: r.state, tone: 'neutral' }, sortKey: 'state', width: 120, hidden: !show },
    { key: 'finished', label: 'Finished', type: 'datetime', value: r => r.completedAt, sortKey: 'finished', width: 150,
      render: r => (r.completedAt ? <span className="text-muted-ink whitespace-nowrap">{stamp(r.completedAt)}</span> : <span className="text-muted-ink">—</span>) },
    { key: 'proof', label: 'Proof', type: 'number', value: r => r.photoCount, width: 80, title: 'Photos and videos on the cleaning job.' },
  ], [show]);

  const filtered = !!(urlQ || cleaner || params.get('from') || params.get('to'));
  const clearAll = () => { setDraft(''); update(p => ['q', 'cleaner', 'from', 'to'].forEach(k => p.delete(k))); };
  const showLabel = show === 'active' ? 'unfinished cleaning jobs' : show === 'all' ? 'cleaning jobs' : 'finished cleaning jobs';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cleaning" sub={data ? `${count(data.total)} ${data.total === 1 ? showLabel.replace(/s$/, '') : showLabel} from ${dayLabel(from)} to ${dayLabel(to)}` : 'Finished cleaning jobs'}
        actions={<TabSwitch tab="history" onTab={onTab} />} />
      <DataTable<HistoryRow>
        id="cleaning.history" columns={columns} rows={data ? data.data : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload}
        server={{ total: data?.total ?? 0, page: data?.page ?? 1, pageSize: data?.pageSize ?? 50, sizes: [25, 50, 100], defaultPageSize: 50, fetchAll }}
        viewParams={['state', 'cleaner', 'q']} filtered={filtered} onClearFilters={clearAll}
        noun={['cleaning job', 'cleaning jobs']} exportName="cleaning-history" selectionKey={`${show}|${from}|${to}`}
        empty={{ title: show === 'active' ? 'No unfinished cleaning jobs in these dates.' : 'No cleaning jobs in these dates.', icon: 'Sparkles' }}
        selectable={canBulk}
        bulkActions={(picked, clear) => <>
          <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setBulkAssign({ ids: picked.map(r => r.id), clear })}>Assign cleaner</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Play" size="sm" />} loading={bulkBusy === 'start'} onClick={() => void bulkMove(picked, 'start', clear)}>Start</Button>
          <Button size="sm" variant="primary" icon={<Icon name="CheckCircle2" size="sm" />} onClick={() => setConfirmDone({ rows: picked, clear })}>Mark done</Button>
        </>}
        toolbar={<>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Search unit or building" aria-label="Search" className={cx(INPUT, 'h-9 w-[220px] max-md:w-full')} />
          <Select label="Show" value={show} onChange={v => setParam('state', v)} options={SHOW} className="w-[150px] max-md:flex-1 max-md:min-w-[130px]" />
          <Select label="Cleaner" value={cleaner} onChange={v => setParam('cleaner', v)} options={cleaners.map(c => ({ value: c.id, label: c.name }))} placeholder="All cleaners" className="w-[160px] max-md:flex-1 max-md:min-w-[130px]" />
          <label className="flex items-center gap-1.5 text-meta text-muted-ink max-md:w-full">From <DateField aria-label="From" value={from} max={to || undefined} onChange={v => { if (v) setParam('from', v); }} className={cx(INPUT, 'h-9 w-auto max-md:flex-1 max-md:min-w-0 max-md:px-2')} /></label>
          <label className="flex items-center gap-1.5 text-meta text-muted-ink max-md:w-full">To <DateField aria-label="To" value={to} min={from || undefined} onChange={v => { if (v) setParam('to', v); }} className={cx(INPUT, 'h-9 w-auto max-md:flex-1 max-md:min-w-0 max-md:px-2')} /></label>
        </>}
        renderCard={r => (
          <span className="flex flex-col gap-0.5 text-copy min-w-0">
            <span className="flex justify-between gap-2"><b>{r.propertyName} {r.unitNumber}</b><span className="text-muted-ink whitespace-nowrap">{dayLabel(r.date)}</span></span>
            <span className="text-muted-ink">{KIND_LABEL[r.kind] ?? r.kind} · {r.assigneeName ?? r.sheetCleaner ?? 'No cleaner recorded'} · {r.photoCount} proof{show ? ` · ${TASK_STATE[r.state]?.label ?? r.state}` : ''}</span>
          </span>
        )}
      />
      {bulkAssign && <BulkAssignCleaner taskIds={bulkAssign.ids} onClose={() => setBulkAssign(null)}
        onDone={() => { bulkAssign.clear(); setBulkAssign(null); reload(); }} />}
      {confirmDone && (
        <OpsModal title={`Mark ${plural(confirmDone.rows.length, 'cleaning job')} done?`} onClose={() => setConfirmDone(null)} busy={bulkBusy === 'done'}
          sub="Each unit turns Ready and its cleaning job is charged to the unit. A cleaning job with no photo or video is refused and named afterwards."
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

/** Phones only: the less-used Cleaning header actions in a bottom sheet. */
function CleaningMore({ onCleaners }: { onCleaners: () => void }) {
  const [open, setOpen] = useState(false);
  const row = 'min-h-12 flex items-center gap-3 px-1 border-0 [border-bottom:1px_solid_var(--color-line-soft)] bg-transparent cursor-pointer text-left text-copy text-ink';
  return (
    <span className="md:hidden">
      <button type="button" onClick={() => setOpen(true)} aria-label="More cleaning actions" aria-haspopup="menu"
        className="h-9 w-9 grid place-items-center rounded-control border border-solid border-line bg-card text-ink cursor-pointer">
        <Icon name="Ellipsis" size="sm" />
      </button>
      {open && (
        <div role="dialog" aria-modal aria-label="Cleaning actions" className="fixed inset-0 z-[70] flex flex-col justify-end">
          <div onClick={() => setOpen(false)} className="absolute inset-0 bg-[var(--color-surface-scrim)]" />
          <div role="menu" className="relative bg-card rounded-t-[20px] pt-2.5 pb-[calc(16px+env(safe-area-inset-bottom))] px-4 flex flex-col">
            <span aria-hidden className="w-[38px] h-1 rounded-full bg-line self-center mb-3" />
            <button type="button" role="menuitem" className={row} onClick={() => { setOpen(false); onCleaners(); }}><Icon name="Users" size="sm" /><span className="flex-1">Cleaners</span></button>
          </div>
        </div>
      )}
    </span>
  );
}
