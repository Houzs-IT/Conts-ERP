import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { DateField, MoneyInput, TimeField } from '../components/inputs';
import Icon from '../components/Icon';
import { Select, SearchSelect, type SelectOption } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { AttachmentLabel, MediaGallery } from '../components/Attachments';
import { DataTable, type Column } from '../components/DataTable';
import { BulkAssignCleaner } from '../components/BulkAssignCleaner';
import { CleanerChecklist, CleanerChips } from '../components/CleanerPicks';
import { sizeLine } from '../lib/unitSize';
import SplitPane from '../components/SplitPane';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { refreshNavCounts } from '../lib/navBadges';
import { api, errorMessage } from '../lib/api';
import { useCleaners } from '../lib/useCleaners';
import { useUnitRoster } from '../lib/useUnitRoster';
import { useNow } from '../lib/useMedia';
import { useSession } from '../lib/session';
import { runEach, skippedNote } from '../lib/bulk';
import { fetchAllPages } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { rm, plural, count } from '../lib/format';
import type { Tone } from '../lib/types';
import { RecordHistory } from '../components/RecordHistory';
import { PricesView, PayView } from './CleaningSetup';
import {
  KIND_LABEL, TimeLeft, Segmented, OpsModal, FormRow, INPUT, TEXTAREA, CloseButton, uploadTo, ReportDamageModal, dayLabel, hm, stamp, minutesLabel, mytDay, type CleanStatus, type MediaItem,
} from '../components/ops/OpsUi';
import { statusOf } from '../lib/status';
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
  access: { id: string; kind: string; label: string; instruction: string; masked: string; hasCode: boolean }[]; mayReveal: boolean;
  cost: { amount: number; source: 'unit' | 'history' | 'default' | 'job' | 'table'; charged: boolean; cleanerPay?: number | null; priceSet?: boolean } | null;
  external?: { address: string; clientName: string | null; clientPhone: string | null } | null;
  damage: { id: string; title: string; state: string; reportedAt: string }[];
  day?: string | null;
  cleaners?: TaskCleaner[]; unit?: UnitSize;
}

type Tab = 'board' | 'history' | 'prices' | 'pay';
type DayPick = 'today' | 'tomorrow' | 'pick';

const KIND_NAME: Record<string, string> = { turnover: 'Standard clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };
const COST_SOURCE: Record<string, string> = { unit: "the unit's own price", history: 'last charged on this unit', default: 'standard rate', job: 'set on this job', table: 'price table' };
/** Board order (staff comment sheet): units ready to check in at the top, then being cleaned, then guest out, then the rest. */
const BOARD_ORDER: Record<string, number> = { done: 0, cleaning: 1, ready: 2, waiting: 3, guest_in: 4, unassigned: 5 };

export default function CleaningPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab: Tab = asked === 'history' || asked === 'prices' || asked === 'pay' ? asked : 'board';
  const setTab = (t: Tab) => setParams(p => {
    const n = new URLSearchParams(p);
    if (t !== 'board') n.set('tab', t); else n.delete('tab');
    if (t !== 'history') HISTORY_PARAMS.forEach(k => n.delete(k));
    return n;
  }, { replace: true });

  if (tab === 'prices') return <PricesView tabs={<TabSwitch tab={tab} onTab={setTab} />} />;
  if (tab === 'pay') return <PayView tabs={<TabSwitch tab={tab} onTab={setTab} />} />;
  return tab === 'history' ? <HistoryView onTab={setTab} /> : <BoardView onTab={setTab} />;
}

function TabSwitch({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return <Segmented label="View" value={tab} onChange={onTab} options={[{ value: 'board', label: 'Board' }, { value: 'history', label: 'History' }, { value: 'prices', label: 'Prices' }, { value: 'pay', label: 'Pay' }]} />;
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
  // Status switch: All (the default, ready units on top), To do (not started, incl. checkouts with no job), In progress, Done.
  const [phase, setPhase] = useState<'all' | 'todo' | 'doing' | 'done'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<{ buildingId: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  // One card per building, in name order; each lists its cleans, then guests leaving with no clean yet.
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }>();
    const get = (id: string, name: string) => m.get(id) ?? (m.set(id, { id, name, rows: [], departures: [], repairs: [] }), m.get(id)!);
    for (const r of visible) get(r.buildingId, r.propertyName).rows.push(r);
    for (const d of visibleDepartures) get(d.buildingId, d.propertyName).departures.push(d);
    for (const w of repairs) if (m.has(w.buildingId)) m.get(w.buildingId)!.repairs.push(w);
    for (const g of m.values()) g.rows.sort((a, b) => BOARD_ORDER[a.status] - BOARD_ORDER[b.status] || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
    return [...m.values()].sort((a, b) => (a.id === 'external' ? 1 : 0) - (b.id === 'external' ? 1 : 0) || a.name.localeCompare(b.name));
  }, [visible, visibleDepartures, repairs]);

  const total = rows.length, done = rows.filter(r => r.status === 'done').length;
  const unassigned = rows.filter(r => r.status !== 'done' && !r.cleanerId && !r.assigneeId && !r.assigneeName).length;
  const ready = rows.filter(r => r.status === 'ready').length;
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
  const setCheckIn = (reservationId: string, time: string, unit: string) =>
    act(`in-${reservationId}`, () => api.patch(`/reservations/${reservationId}/details`, { checkInTime: time }), { title: `${unit}: next check-in ${time}.` });

  const subtitle = data
    // vocab-ok: departures is the API field name; the words on screen say checkouts
    ? `${dayLabel(date)} · ${total} ${total === 1 ? 'cleaning job' : 'cleaning jobs'} · ${done} done · ${ready} ready to clean${unassigned ? ` · ${unassigned} unassigned` : ''}${departures.length ? ` · ${departures.length} checkouts with no cleaning job` : ''}`
    : dayLabel(date);

  const list = (
    <>
      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex flex-col gap-3.5">{[0, 1].map(i => <div key={i} className="bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-3"><Skeleton width="40%" height={16} /><Skeleton height={44} /><Skeleton height={44} /></div>)}</div>
      ) : groups.length === 0 ? (
        <EmptyState icon="Sparkles" kind={building || cleaner ? 'filtered' : 'empty'}
          title={building || cleaner ? 'No cleaning jobs match these filters.' : `No cleaning jobs on ${dayLabel(date)}.`}
          body={building || cleaner ? undefined : 'Cleaning jobs appear when guests check out. Add one by hand for a deep clean or a refresh.'}
          action={building || cleaner ? { label: 'Clear filters', onClick: () => { setBuilding(''); setCleaner(''); } } : { label: 'Add cleaning job', onClick: () => setCreating(true) }} />
      ) : groups.map(g => (
        <BuildingCard key={g.id} group={g} now={now} future={date > mytDay(0)} selected={selected} busy={busy}
          onSelect={id => setSelected(id)} onGuestLeft={guestLeft} onUndoLeft={undoLeft} onCheckIn={setCheckIn} onPlan={plan}
          onAssign={() => setAssignFor({ buildingId: g.id, name: g.name })} />
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <PageHeader title="Cleaning" sub={subtitle}
        actions={<>
          <TabSwitch tab="board" onTab={onTab} />
          {/* Phones: Cleaners sits behind one "..." so the header is View + Add (owner, Oct 2026). No auto-assign: cleans are
              given by building or one by one (staff comment sheet, 16 Oct 2026). */}
          <span className="contents max-md:hidden">
            <Button size="sm" variant="secondary" icon={<Icon name="Users" size="sm" />} onClick={() => navigate('/operations/cleaners')}>Cleaners</Button>
          </span>
          <CleaningMore onCleaners={() => navigate('/operations/cleaners')} />
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
        {pick === 'pick' && <DateField aria-label="Day" value={picked} onChange={v => v && setPicked(v)} className={cx(INPUT, 'h-9 w-auto')} />}
        <Select label="Cleaner" value={cleaner} onChange={setCleaner} options={cleanerOptions} placeholder="All cleaners" className="flex-1 min-w-[140px] md:flex-none md:w-[160px]" />
        <Select label="Building" value={building} onChange={setBuilding} options={buildingOptions} placeholder="All buildings" className="flex-1 min-w-[140px] md:flex-none md:w-[180px]" />
        {visibleDepartures.length > 0 && (
          <Button size="sm" variant="brand" loading={busy === 'plan-all'} onClick={() => void planAll()} className="ml-auto max-md:ml-0 max-md:w-full">
            Plan cleaning for {visibleDepartures.length} {visibleDepartures.length === 1 ? 'checkout' : 'checkouts'}
          </Button>
        )}
      </div>

      <SplitPane list={list} open={!!sel} onClose={() => setSelected(null)}
        empty={<div className="text-center text-copy text-muted-ink p-6 max-w-[260px]"><Icon name="MousePointerClick" size="lg" /><p className="mt-2">Pick a unit to see its cleaner, door code and proof photos.</p></div>}
        detail={sel ? <CleanDetail key={sel.id} row={sel} now={now} onClose={() => setSelected(null)} onChanged={reload} onGuestLeft={() => void guestLeft({ taskId: sel.id }, sel.unitNumber)} /> : null} />

      {creating && <NewCleanModal date={date} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {assignFor && (
        <AssignBuildingModal building={assignFor} date={date} onClose={() => setAssignFor(null)}
          onDone={(n, who) => { setAssignFor(null); toast({ tone: 'success', title: `${n} ${n === 1 ? 'cleaning job' : 'cleaning jobs'} in ${assignFor.name} given to ${who}.` }); reload(); }} />
      )}
    </div>
  );
}

/* ---------- one building ---------- */

// Columns follow the card's own width, not the window's: with the detail panel open the list is narrow on a laptop.
const COLS = '@2xl:grid @2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,0.55fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,0.95fr)] @2xl:items-center @2xl:gap-2.5';

function BuildingCard({ group, now, future, selected, busy, onSelect, onGuestLeft, onUndoLeft, onCheckIn, onPlan, onAssign }: {
  group: { id: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }; now: number; future: boolean; selected: string | null; busy: string | null;
  onSelect: (id: string) => void; onGuestLeft: (b: { taskId?: string; reservationId?: string }, unit: string) => void; onUndoLeft: (taskId: string, unit: string) => void;
  onCheckIn: (reservationId: string, time: string, unit: string) => void; onPlan: (d: Departure) => void; onAssign: () => void;
}) {
  const external = group.id === 'external';
  const count = group.rows.length + group.departures.length;
  const doneN = group.rows.filter(r => r.status === 'done').length;
  const open = group.rows.filter(r => r.status !== 'done');
  const unassigned = open.filter(r => !r.cleanerId && !r.assigneeId && !r.assigneeName).length;
  const names = [...new Set(group.rows.flatMap(r => (r.cleaners.length ? r.cleaners.map(c => c.name) : [r.assigneeName])).filter(Boolean))];
  // Each building folds shut; it starts open only when something in it still needs a person.
  const [shut, setShut] = useState(() => open.length === 0 && group.departures.length === 0);
  return (
    <section className="@container bg-card rounded-card border border-solid border-line overflow-hidden flex-none">
      <header className="flex items-center justify-between gap-3 flex-wrap px-4 @2xl:px-5 py-3">
        <button type="button" onClick={() => setShut(v => !v)} aria-expanded={!shut}
          className="min-w-0 flex items-center gap-2 flex-wrap bg-transparent border-none p-0 cursor-pointer text-left text-ink [font-family:inherit]">
          <Icon name={shut ? 'ChevronRight' : 'ChevronDown'} size="sm" color="var(--color-muted-ink)" />
          <span className="text-[15px] font-semibold tracking-[-0.005em]">{group.name}</span>
          <span className="text-meta text-muted-ink tabular-nums">{count} {count === 1 ? 'unit' : 'units'} · {doneN} done</span>
          {group.departures.length > 0 && <StatusBadge tone="critical">{group.departures.length} to plan</StatusBadge>}
        </button>
        <div className="flex items-center gap-2 text-copy flex-wrap">
          {unassigned > 0 ? <span className="text-danger font-medium">{unassigned} unassigned</span>
            : names.length ? <span className="text-muted-ink" title={names.length > 1 ? names.join(', ') : undefined}>{names.length === 1 ? 'Cleaner' : 'Cleaners'} <b className="text-ink">{names.length === 1 ? names[0] : `${names.length} people`}</b></span> : null}
          {/* The main way to give out cleans (staff comment sheet, 16 Oct 2026); one job at a time stays in its panel. */}
          {open.length > 0 && <Button size="sm" variant="primary" icon={<Icon name="Users" size="sm" />} onClick={onAssign}>{external ? 'Assign external jobs' : 'Assign whole building'}</Button>}
        </div>
      </header>
      {!shut && <>
      <div className={cx('hidden text-meta font-semibold text-muted-ink px-5 py-2 [border-top:1px_solid_var(--color-line-soft)]', COLS)}>
        <div>{external ? 'Address' : 'Unit'}</div><div>{external ? 'Client' : 'Checkout (leaving)'}</div><div>{external ? '' : 'Check-in (arriving)'}</div><div>Time left</div><div>Type</div><div>Layout</div><div>Amount</div><div>Cleaner</div><div>Status</div>
      </div>
      {group.rows.map(r => <CleanRow key={r.id} r={r} now={now} active={r.id === selected} busy={busy === `left-${r.id}`} savingIn={!!r.next?.reservationId && busy === `in-${r.next.reservationId}`}
        onSelect={() => onSelect(r.id)} onGuestLeft={() => onGuestLeft({ taskId: r.id }, r.unitNumber)} onUndoLeft={() => onUndoLeft(r.id, r.unitNumber)}
        onCheckIn={t => r.next?.reservationId && onCheckIn(r.next.reservationId, t, r.unitNumber)} />)}
      {group.departures.map(d => (
        <div key={d.reservationId} className={cx('px-4 @2xl:px-5 py-3 [border-top:1px_solid_var(--color-line-soft)] text-copy flex flex-wrap items-baseline gap-x-4 gap-y-1', COLS)}>
          <div className="basis-full @2xl:basis-auto flex items-center gap-x-2 flex-wrap min-w-0"><span className="min-w-0"><b>{d.unitNumber}</b>{d.unit?.size && <span className="ml-1.5 @2xl:ml-0 @2xl:block text-meta text-muted-ink truncate">{d.unit.size}</span>}</span><span className="@2xl:hidden"><StatusBadge tone="critical">No cleaning job planned</StatusBadge></span></div>
          <div><b className="[font-variant-numeric:tabular-nums]">{d.checkOutTime}</b> · {d.guestName}{d.lateCheckOut && <StatusBadge tone="warning" className="ml-1">Late checkout</StatusBadge>}{d.state === 'checked_out' && <StatusBadge tone="gold" className="ml-1">Out</StatusBadge>}</div>
          <div>{d.next ? <><CheckInTime time={d.next.checkInTime} saving={!!d.next.reservationId && busy === `in-${d.next.reservationId}`} onSave={d.next.reservationId ? t => onCheckIn(d.next!.reservationId!, t, d.unitNumber) : undefined} /> · {d.next.guestName}</> : <span className="text-muted-ink">No check-in</span>}</div>
          <div><span className="@2xl:hidden text-muted-ink">Time left </span><TimeLeft at={d.next?.checkInAt} now={now} /></div>
          <div className="hidden @2xl:block text-muted-ink">—</div>
          <div className="hidden @2xl:block truncate">{d.unit?.layout ?? <span className="text-muted-ink">—</span>}</div>
          <div className="hidden @2xl:block text-muted-ink">—</div>
          <div className="hidden @2xl:block text-muted-ink">—</div>
          <div className="basis-full @2xl:basis-auto flex items-center gap-2 flex-wrap justify-end @2xl:justify-start pt-1 @2xl:pt-0">
            <span className="hidden @2xl:inline"><StatusBadge tone="critical">No cleaning job</StatusBadge></span>
            <Button size="sm" variant="primary" loading={busy === `plan-${d.reservationId}`} onClick={() => onPlan(d)}>Plan cleaning</Button>
            {d.state !== 'checked_out' && !future && <Button size="sm" variant="secondary" loading={busy === `left-${d.reservationId}`} onClick={() => onGuestLeft({ reservationId: d.reservationId }, d.unitNumber)}>Guest left</Button>}
          </div>
        </div>
      ))}
      {group.repairs.length > 0 && (
        <div className="px-4 @2xl:px-5 py-2.5 [border-top:1px_solid_var(--color-line-soft)] bg-page flex flex-col gap-1">
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

function CleanRow({ r, now, active, busy, savingIn, onSelect, onGuestLeft, onUndoLeft, onCheckIn }: {
  r: Row; now: number; active: boolean; busy: boolean; savingIn: boolean; onSelect: () => void; onGuestLeft: () => void; onUndoLeft: () => void; onCheckIn: (time: string) => void;
}) {
  const st = statusOf('cleaning', r.status);
  const files = r.photoCount + r.videoCount;
  // One tap on the row marks the guest out (or takes the mark back while nobody has started); the tick is the button.
  const mayTick = !!r.previous && r.status !== 'done' && r.status !== 'cleaning' && r.day <= mytDay(0);
  const label = r.status === 'done' ? `Ready to check in${r.completedAt ? ` · ${hm(r.completedAt)}` : ''}` : st.label;
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onSelect} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
      className={cx('px-4 @2xl:px-5 py-3 [border-top:1px_solid_var(--color-line-soft)] text-copy cursor-pointer flex flex-wrap items-baseline gap-x-4 gap-y-1 outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-gold)]', COLS,
        active ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : 'hover:bg-page')}>
      <div className="basis-full @2xl:basis-auto flex items-center gap-x-2 min-w-0">
        <span className="min-w-0">
          <b className="text-ink">{r.unitNumber}</b>
          {r.unit?.size && <span className="ml-1.5 @2xl:ml-0 @2xl:block text-meta text-muted-ink truncate">{r.unit.size}</span>}
        </span>
        {r.carriedOver && <span className="flex-none"><StatusBadge tone="warning" title={`Carried over from ${dayLabel(r.day)}`}>{dayLabel(r.day).replace(/^\w+\s/, '')}</StatusBadge></span>}
        <span className="@2xl:hidden ml-auto flex-none"><StatusBadge tone={st.tone}>{label}</StatusBadge></span>
      </div>
      <div className="min-w-0 flex items-start gap-2">
        {mayTick && <GuestOutTick out={r.guestOut} busy={busy} onTick={r.guestOut ? onUndoLeft : onGuestLeft} />}
        <div className="min-w-0">
          {r.external ? <>{r.external.clientName ?? <span className="text-muted-ink">No client name</span>}{r.external.clientPhone && <div className="text-meta text-muted-ink">{r.external.clientPhone}</div>}</>
            : <><span className="@2xl:hidden text-muted-ink">Out </span>
              {r.previous ? <><b className="[font-variant-numeric:tabular-nums]">{r.previous.checkOutTime}</b> · {r.previous.guestName}</> : <span className="text-muted-ink">No departing guest</span>}
              {r.previous?.lateCheckOut && <StatusBadge tone="warning" className="ml-1">Late checkout</StatusBadge>}
              {r.guestOut && r.guestLeftAt && <div className="text-meta text-gold-ink">{r.guestLeftAuto ? `Out at checkout ${hm(r.guestLeftAt)} (automatic)` : `Left at ${hm(r.guestLeftAt)}`}</div>}</>}
        </div>
      </div>
      <div className={cx('min-w-0', r.external && 'hidden @2xl:block')}>
        {!r.external && <><span className="@2xl:hidden text-muted-ink">In </span>
          {r.next ? <><CheckInTime time={r.next.checkInTime} saving={savingIn} onSave={r.next.reservationId && r.status !== 'done' ? onCheckIn : undefined} /> · {r.next.guestName}</> : <span className="text-muted-ink">No check-in</span>}
          {r.next?.earlyCheckIn && <StatusBadge tone="warning" className="ml-1">Early check-in</StatusBadge>}</>}
      </div>
      <div className={cx(!r.next && 'hidden @2xl:block')}><span className="@2xl:hidden text-muted-ink">Time left </span><TimeLeft at={r.next?.checkInAt} now={now} done={r.status === 'done'} /></div>
      <div><span className="@2xl:hidden text-muted-ink">Type </span>{KIND_LABEL[r.kind] ?? r.kind}</div>
      <div className={cx('truncate', !r.unit?.layout && '@max-2xl:hidden')}><span className="@2xl:hidden text-muted-ink">Layout </span>{r.unit?.layout ?? <span className="text-muted-ink">—</span>}</div>
      <div className="whitespace-nowrap"><span className="@2xl:hidden text-muted-ink">Amount </span>{r.amount != null ? <span className="tabular-nums">{rm(r.amount, { cents: false })}</span> : <span className="text-warning" title="Set it in Cleaning > Prices">Price not set</span>}</div>
      <CleanerCell r={r} />
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="hidden @2xl:inline"><StatusBadge tone={st.tone} className="whitespace-nowrap">{label}</StatusBadge></span>
        {r.status === 'done' && files > 0 && <span className="hidden @2xl:inline text-meta text-muted-ink whitespace-nowrap">{files} {files === 1 ? 'photo' : 'photos'}</span>}
      </div>
    </div>
  );
}

/** The "guest has checked out" tick: one tap marks them out, a second tap takes it back (until the clean starts). */
function GuestOutTick({ out, busy, onTick }: { out: boolean; busy: boolean; onTick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={out} aria-label={out ? 'Guest is out. Tap to undo.' : 'Mark the guest as checked out'} disabled={busy}
      title={out ? 'Guest is out. Tap to undo.' : 'Guest has checked out'}
      onClick={e => { e.stopPropagation(); onTick(); }} onKeyDown={e => e.stopPropagation()}
      className={cx('flex-none w-7 h-7 -my-1 grid place-items-center rounded-control border border-solid cursor-pointer disabled:opacity-50',
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

/** The job's cleaners: one name, or the first name and "+N" with everyone in the tooltip. */
function CleanerCell({ r }: { r: Row }) {
  const names = r.cleaners.length ? r.cleaners.map(c => c.name) : r.assigneeName ? [r.assigneeName] : [];
  return (
    <div className={cx('min-w-0 flex items-baseline gap-1', !names.length && 'text-danger')} title={names.length > 1 ? names.join(', ') : undefined}>
      <span className="@2xl:hidden text-muted-ink flex-none">{names.length > 1 ? 'Cleaners' : 'Cleaner'} </span>
      {/* Phones have the room to list everyone; the desk column shows the first and how many more. */}
      <span className="truncate @2xl:hidden">{names.length ? names.join(', ') : 'Unassigned'}</span>
      <span className="truncate hidden @2xl:inline">{names[0] ?? 'Unassigned'}</span>
      {names.length > 1 && <span className="hidden @2xl:inline flex-none text-meta font-semibold text-muted-ink">+{names.length - 1}</span>}
    </div>
  );
}

/* ---------- the detail panel ---------- */

function CleanDetail({ row, now, onClose, onChanged, onGuestLeft }: { row: Row; now: number; onClose: () => void; onChanged: () => void; onGuestLeft: () => void }) {
  const toast = useToast();
  const { data, reload, error } = useApi<Detail>(`/housekeeping/tasks/${row.id}`);
  const { cleaners } = useCleaners(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [damage, setDamage] = useState(false);
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

  const done = row.state === 'resolved';
  const st = statusOf('cleaning', row.status);
  const files = data?.media.length ?? row.photoCount + row.videoCount;
  const used = row.startedAt ? (Date.parse(row.completedAt ?? new Date(now).toISOString()) - Date.parse(row.startedAt)) / 60000 : null;
  const unitLabel = `${row.propertyName} ${row.unitNumber}`;
  const kind = picked.kind ?? row.kind;
  const kindName = KIND_NAME[kind] ?? 'Standard clean';
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
        <span className="[&_button]:text-white [&_button]:border-charcoal [&_button]:bg-transparent"><CloseButton onClick={onClose} /></span>
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
            <select className={INPUT} value={kind} disabled={busy === 'kind'} onChange={e => { const v = e.target.value; setPicked(p => ({ ...p, kind: v })); void act('kind', () => api.patch(`/housekeeping/tasks/${row.id}`, { kind: v, title: v === 'deep_clean' ? 'Deep clean' : row.title }), 'Cleaning type changed.').then(ok => { if (!ok) setPicked(p => ({ ...p, kind: undefined })); }); }}>
              <option value="turnover">Standard</option><option value="deep_clean">Deep</option><option value="light_clean">Light</option>
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
          {row.next ? <><span><b>{row.next.checkInTime}</b> {row.next.guestName}{row.next.guests ? ` · ${row.next.guests} ${row.next.guests === 1 ? 'guest' : 'guests'}` : ''}</span>
            {row.next.earlyCheckIn && <span className="text-meta text-warning">Early check-in</span>}
            <span className="text-meta">Time left <TimeLeft at={row.next.checkInAt} now={now} done={done} /></span></>
            : <span className="text-muted-ink">No check-in</span>}
        </div>
      </div>
      )}

      <section className="flex flex-col gap-2">
        <AttachmentLabel title="Proof of work" count={files} hint={!done && files === 0 ? 'At least 1 photo or video to complete' : undefined} />
        {data ? <MediaGallery items={data.media} upload={done ? undefined : uploadTo(`/tasks/${row.id}/photos`)} onDone={refresh} addLabel="Add photos or videos" emptyText="No photos were added." />
          : <Skeleton height={84} />}
        {done && row.completedAt && (
          <span className="text-meta text-muted-ink">Marked complete {stamp(row.completedAt)}{data?.completedBy ? ` by ${data.completedBy}` : ''}.</span>
        )}
      </section>

      {!done && (
        <div className="flex gap-2">
          {row.state !== 'in_progress' && (
            <Button variant="secondary" className="flex-1" loading={busy === 'start'} onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${row.id}/start`, {}), 'Cleaning job started.')}>Start</Button>
          )}
          <Button variant="primary" className="flex-1" loading={busy === 'complete'} disabled={files === 0} disabledReason="Add at least one photo or video first."
            onClick={() => void act('complete', async () => {
              const r = await api.post<{ cost: { amount: number; created: boolean; reason: string | null } | null }>(`/tasks/${row.id}/complete`, { photoIds: [] });
              if (r.cost && !r.cost.created && r.cost.reason && r.cost.reason !== 'already charged') toast({ tone: 'info', title: 'Cost not added.', body: `Not charged to the unit: ${r.cost.reason}.` });
            }, 'Cleaning job complete.', `${unitLabel} is ready.`)}>
            Mark complete
          </Button>
        </div>
      )}
      {data?.cost && <CleanAmount taskId={row.id} cost={data.cost} external={!!row.external} done={done} kindName={kindName} onSaved={refresh} />}

      {!row.external && <section className="flex flex-col gap-2">
        <h3 className="m-0 text-copy font-semibold">Door access</h3>
        {!data ? <Skeleton height={36} /> : data.access.length === 0 ? <span className="text-muted-ink">No access details on this unit. Add them on the unit's Access tab.</span>
          : data.access.map(a => (
            <div key={a.id} className="rounded-control bg-muted p-2.5 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium">{a.label}</span>
                {a.hasCode && (revealed[a.id]
                  ? <span className="font-mono text-heading">{revealed[a.id]}</span>
                  : <>{a.masked && <span className="font-mono text-muted-ink">{a.masked}</span>}
                    {data.mayReveal && <button type="button" onClick={() => void reveal(a.id)} className="text-gold-ink font-medium cursor-pointer underline-offset-2 hover:underline">Show</button>}</>)}
              </div>
              <span className="text-meta text-muted-ink">{a.instruction}</span>
            </div>
          ))}
        {data && !data.mayReveal && data.access.some(a => a.hasCode) && <span className="text-meta text-muted-ink">Codes are shown to operations managers and management only.</span>}
      </section>}

      {data && data.damage.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-copy font-semibold">Damage reported</h3>
          {data.damage.map(d => <a key={d.id} href={`#/operations/maintenance?id=${d.id}`} className="text-gold-ink">{d.title} · {stamp(d.reportedAt)}</a>)}
        </section>
      )}
      {!row.external && <Button variant="secondary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>Report damage</Button>}

      <section className="rounded-card border border-solid border-line overflow-hidden">
        <div className="py-2.5 px-4 [border-bottom:1px_solid_var(--color-line-soft)] flex items-center gap-2 text-copy font-semibold"><Icon name="History" size="sm" />History</div>
        <RecordHistory entity="tasks" id={row.id} also={data?.reservationId ? [['reservations', data.reservationId]] : undefined} alsoActions={['reservation.status']}
          bare pageSize={10} refreshKey={data} origin={origin} />
      </section>

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
        {!done && !cost.charged && !editing && <button type="button" onClick={() => { setSen(notSet ? null : cost.amount); setEditing(true); }} className="text-gold-ink font-medium cursor-pointer bg-transparent border-0 p-0 [font-family:inherit]">Change</button>}
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
        {cost.cleanerPay != null ? ` Cleaner's pay ${rm(cost.cleanerPay)}.` : ''}
      </span>
    </section>
  );
}

/* ---------- dialogs ---------- */

function NewCleanModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const units = useUnitRoster();
  const { cleaners } = useCleaners(true);
  const [unitId, setUnitId] = useState('');
  const [day, setDay] = useState(date);
  const [kind, setKind] = useState('turnover');
  const [cleanerIds, setCleanerIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [touchedAmount, setTouchedAmount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ unit?: string; address?: string; amount?: string; form?: string }>({});
  const external = unitId === EXTERNAL;
  // On one of our units the amount starts at the price table's figure for this unit and type; it can be typed over.
  const prices = useApi<{ ready: boolean; rows: { unitId: string; prices: Record<string, { externalCharge: number | null }> }[] }>('/housekeeping/unit-prices');
  const suggested = !external && unitId ? prices.data?.rows.find(r => r.unitId === unitId)?.prices[kind]?.externalCharge ?? null : null;
  useEffect(() => { if (!touchedAmount) setAmount(external ? null : suggested); }, [unitId, kind, suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  const unitOptions = [{ value: EXTERNAL, label: 'External (not one of our units)', group: 'Outside job' }, ...units.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName }))];
  async function save() {
    const bad = { unit: unitId ? undefined : 'Pick a unit, or External.', address: external && !address.trim() ? 'Enter the address.' : undefined, amount: external && amount == null ? 'Enter the amount.' : undefined };
    if (bad.unit || bad.address || bad.amount) { setError(bad); return; }
    setBusy(true); setError({});
    try {
      const title = kind === 'deep_clean' ? 'Deep clean' : kind === 'light_clean' ? 'Light clean' : 'Standard clean';
      await api.post('/housekeeping/tasks', {
        ...(external ? { external: { address: address.trim(), clientName: client.trim() || undefined, clientPhone: phone.trim() || undefined } } : { unitId }),
        date: day, kind, cleanerIds, instructions: notes.trim() || undefined, title,
        ...(amount != null && (external || touchedAmount) ? { amount } : {}),
      });
      onDone();
    } catch (e) { setError({ form: errorMessage(e, 'Not saved. Try again.') }); setBusy(false); }
  }
  return (
    <OpsModal title="Add cleaning job" sub="For a deep clean, a refresh, a cleaning job no reservation created, or a job at an outside address." onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Add cleaning job</Button></>}>
      <FormRow label="Unit" error={error.unit} hint="One of our units, or External for a job at another address.">
        <SearchSelect label="Unit" value={unitId} onChange={v => { setUnitId(v); setError(x => ({ ...x, unit: undefined })); }} options={unitOptions} placeholder="Search units, or pick External" size="md" />
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
        <FormRow label="Type">
          <select className={INPUT} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="turnover">Standard</option><option value="deep_clean">Deep</option><option value="light_clean">Light</option>
          </select>
        </FormRow>
      </div>
      <FormRow label={external ? 'Amount, RM' : 'Amount, RM (optional)'} error={error.amount}
        hint={external ? 'What the job is charged. It counts in the cleaner\'s pay, never in a unit\'s costs.' : unitId ? (suggested != null ? 'From the price table; type over it for this job.' : 'Price not set for this unit and type: leave empty to use the old cleaning rate, or type one.') : undefined}>
        <MoneyInput className={INPUT} valueSen={amount} onChangeSen={v => { setAmount(v); setTouchedAmount(true); setError(x => ({ ...x, amount: undefined })); }} aria-label="Amount in RM" />
      </FormRow>
      <FormRow label="Cleaners (optional)" hint={cleanerIds.length ? undefined : 'Leave empty to assign later. Tick more than one for a team.'}>
        <CleanerChips cleaners={cleaners} value={cleanerIds} names={{}} onChange={setCleanerIds} />
      </FormRow>
      <FormRow label="Notes for the cleaner (optional)"><textarea className={TEXTAREA} value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} /></FormRow>
      {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
    </OpsModal>
  );
}

const EXTERNAL = '__external__';

function AssignBuildingModal({ building, date, onClose, onDone }: { building: { buildingId: string; name: string }; date: string; onClose: () => void; onDone: (n: number, who: string) => void }) {
  const { cleaners } = useCleaners(true);
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
      <CleanerChecklist cleaners={cleaners} value={cleanerIds} onChange={ids => { setCleanerIds(ids); setError(null); }} error={error} />
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
