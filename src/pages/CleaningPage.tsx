import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Select, SearchSelect, type SelectOption } from '../components/Select';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { DataTable, type Column } from '../components/DataTable';
import { BulkAssignCleaner } from '../components/BulkAssignCleaner';
import SplitPane from '../components/SplitPane';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { useCleaners } from '../lib/useCleaners';
import { useUnitRoster } from '../lib/useUnitRoster';
import { useNow } from '../lib/useMedia';
import { useSession } from '../lib/session';
import { runEach, skippedNote } from '../lib/bulk';
import { fetchAllPages } from '../lib/export';
import { cx } from '../lib/design-tokens';
import { rm, plural } from '../lib/format';
import type { Tone } from '../lib/types';
import { HistoryDisclosure } from '../components/RecordHistory';
import {
  Chip, CLEAN_STATUS, KIND_LABEL, TimeLeft, Segmented, OpsModal, FormRow, INPUT, TEXTAREA, CloseButton,
  MediaGrid, MediaDrop, uploadTo, Checklist, ReportDamageModal, dayLabel, hm, stamp, minutesLabel, mytDay,
  type CleanStatus, type ChecklistItem, type MediaItem,
} from '../components/ops/OpsUi';

/* ---------- what the board endpoint answers (functions/api/housekeeping/board.ts) ---------- */

interface Guest { reservationId: string; guestName: string; channel: string }
interface Row {
  id: string; kind: string; state: string; status: Exclude<CleanStatus, 'unplanned'>; title: string; instructions: string | null;
  day: string; carriedOver: boolean; unitId: string; unitNumber: string; readiness: string; buildingId: string; propertyName: string;
  assigneeId: string | null; cleanerId: string | null; assigneeName: string | null;
  previous: (Guest & { state: string; checkOutTime: string; lateCheckOut: boolean }) | null;
  next: (Guest & { guests: number; checkInTime: string; earlyCheckIn: boolean; checkInAt: string }) | null;
  guestOut: boolean; guestLeftAt: string | null; startedAt: string | null; completedAt: string | null;
  photoCount: number; videoCount: number; checklist: { done: number; total: number };
}
interface Departure {
  reservationId: string; state: string; channel: string; guestName: string; checkOutTime: string; lateCheckOut: boolean;
  unitId: string; unitNumber: string; buildingId: string; propertyName: string;
  next: { guestName: string; checkInTime: string; checkInAt: string; earlyCheckIn: boolean } | null;
}
export interface RepairOnDay {
  id: string; issueId: string; startsAt: string; endsAt: string; note: string | null; title: string; state: string; urgency: string; category: string;
  assigneeName: string | null; unitId: string; unitNumber: string; buildingId: string; propertyName: string; overlaps: { guestName: string }[];
}
interface Board { date: string; today: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[]; defaults: { checkIn: string; checkOut: string } }

interface Detail {
  id: string; kind: string; state: string; unitId: string; unitNumber: string; propertyName: string; instructions: string | null;
  startedAt: string | null; completedAt: string | null; guestLeftAt: string | null;
  checklist: ChecklistItem[]; media: MediaItem[];
  access: { id: string; kind: string; label: string; instruction: string; masked: string; hasCode: boolean }[]; mayReveal: boolean;
  cost: { amount: number; source: 'unit' | 'history' | 'default'; charged: boolean } | null;
  damage: { id: string; title: string; state: string; reportedAt: string }[];
  day?: string | null;
}

type Tab = 'board' | 'history';
type DayPick = 'today' | 'tomorrow' | 'pick';

const COST_SOURCE: Record<string, string> = { unit: 'unit rate', history: 'last charged on this unit', default: 'standard rate' };

export default function CleaningPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'history' ? 'history' : 'board';
  const setTab = (t: Tab) => setParams(p => {
    const n = new URLSearchParams(p);
    if (t === 'history') n.set('tab', 'history'); else { n.delete('tab'); HISTORY_PARAMS.forEach(k => n.delete(k)); }
    return n;
  }, { replace: true });

  return tab === 'history' ? <HistoryView onTab={setTab} /> : <BoardView onTab={setTab} />;
}

function TabSwitch({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return <Segmented label="View" value={tab} onChange={onTab} options={[{ value: 'board', label: 'Board' }, { value: 'history', label: 'History' }]} />;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<{ buildingId: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<Board>(`/housekeeping/board?date=${date}`);
  const { cleaners } = useCleaners(true);
  const rows = data?.rows ?? [];
  const departures = data?.departures ?? [];
  const repairs = data?.repairs ?? [];

  const buildingOptions: SelectOption[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.buildingId, r.propertyName);
    for (const d of departures) m.set(d.buildingId, d.propertyName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [rows, departures]);
  const cleanerOptions: SelectOption[] = [{ value: 'none', label: 'Unassigned' }, ...cleaners.map(c => ({ value: c.id, label: c.name }))];

  const visible = rows.filter(r => (!building || r.buildingId === building)
    && (!cleaner || (cleaner === 'none' ? !r.cleanerId && !r.assigneeId && !r.assigneeName : r.cleanerId === cleaner)));
  const visibleDepartures = departures.filter(d => (!building || d.buildingId === building) && (!cleaner || cleaner === 'none'));

  // One card per building, in name order; each lists its cleans, then guests leaving with no clean yet.
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }>();
    const get = (id: string, name: string) => m.get(id) ?? (m.set(id, { id, name, rows: [], departures: [], repairs: [] }), m.get(id)!);
    for (const r of visible) get(r.buildingId, r.propertyName).rows.push(r);
    for (const d of visibleDepartures) get(d.buildingId, d.propertyName).departures.push(d);
    for (const w of repairs) if (m.has(w.buildingId)) m.get(w.buildingId)!.repairs.push(w);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
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
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' }); }
    finally { setBusy(null); }
  }
  const guestLeft = (body: { taskId?: string; reservationId?: string }, unit: string) =>
    act(`left-${body.taskId ?? body.reservationId}`, () => api.post('/housekeeping/guest-left', body), { title: `${unit}: guest out.`, body: 'Ready to clean.' });
  const plan = (d: Departure) =>
    act(`plan-${d.reservationId}`, () => api.post('/housekeeping/plan', { reservationIds: [d.reservationId] }), { title: `Clean planned for ${d.unitNumber}.` });
  const planAll = () =>
    act('plan-all', () => api.post('/housekeeping/plan', { reservationIds: visibleDepartures.map(d => d.reservationId) }), { title: `${visibleDepartures.length} cleans planned.` });
  const autoAssign = () =>
    act('auto', async () => { const r = await api.post<{ assigned: number }>('/housekeeping/auto-assign', {}); if (!r.assigned) throw new ApiFailure(409, 'NONE', 'Every clean from today on already has a cleaner.'); }, { title: 'Cleans assigned.', body: 'Unassigned cleans from today on now have a cleaner.' });

  const subtitle = data
    ? `${dayLabel(date)} · ${total} ${total === 1 ? 'clean' : 'cleans'} · ${done} done · ${ready} ready to clean${unassigned ? ` · ${unassigned} unassigned` : ''}${departures.length ? ` · ${departures.length} departures with no clean` : ''}`
    : dayLabel(date);

  const list = (
    <>
      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex flex-col gap-3.5">{[0, 1].map(i => <div key={i} className="bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-3"><Skeleton width="40%" height={16} /><Skeleton height={44} /><Skeleton height={44} /></div>)}</div>
      ) : groups.length === 0 ? (
        <EmptyState icon="Sparkles" kind={building || cleaner ? 'filtered' : 'empty'}
          title={building || cleaner ? 'No cleans match these filters.' : `No cleans on ${dayLabel(date)}.`}
          body={building || cleaner ? undefined : 'Cleans appear when guests check out. Add one by hand for a deep clean or a refresh.'}
          action={building || cleaner ? { label: 'Clear filters', onClick: () => { setBuilding(''); setCleaner(''); } } : { label: 'New clean', onClick: () => setCreating(true) }} />
      ) : groups.map(g => (
        <BuildingCard key={g.id} group={g} now={now} selected={selected} busy={busy}
          onSelect={id => setSelected(id)} onGuestLeft={guestLeft} onPlan={plan}
          onAssign={() => setAssignFor({ buildingId: g.id, name: g.name })} />
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <PageHeader title="Cleaning" sub={subtitle}
        actions={<>
          <TabSwitch tab="board" onTab={onTab} />
          <Button size="sm" variant="secondary" icon={<Icon name="Users" size="sm" />} onClick={() => navigate('/operations/cleaners')}>Cleaners</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Shuffle" size="sm" />} loading={busy === 'auto'} onClick={() => void autoAssign()}>Auto-assign</Button>
        </>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>New clean</Button>} />

      <div className="flex items-end gap-2 flex-wrap">
        <Segmented label="Day" value={pick} onChange={setPick}
          options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }, { value: 'pick', label: 'Pick date' }]} />
        {pick === 'pick' && <input type="date" aria-label="Day" value={picked} onChange={e => e.target.value && setPicked(e.target.value)} className={cx(INPUT, 'h-9 w-auto')} />}
        <Select label="Cleaner" value={cleaner} onChange={setCleaner} options={cleanerOptions} placeholder="All cleaners" className="flex-1 min-w-[140px] md:flex-none md:w-[160px]" />
        <Select label="Building" value={building} onChange={setBuilding} options={buildingOptions} placeholder="All buildings" className="flex-1 min-w-[140px] md:flex-none md:w-[180px]" />
        {visibleDepartures.length > 0 && (
          <Button size="sm" variant="brand" loading={busy === 'plan-all'} onClick={() => void planAll()} className="ml-auto">
            Plan cleans for {visibleDepartures.length} {visibleDepartures.length === 1 ? 'departure' : 'departures'}
          </Button>
        )}
      </div>

      <SplitPane list={list} open={!!sel} onClose={() => setSelected(null)}
        empty={<div className="text-center text-copy text-muted-ink p-6 max-w-[260px]"><Icon name="MousePointerClick" size="lg" /><p className="mt-2">Pick a unit to see its door code, checklist and proof photos.</p></div>}
        detail={sel ? <CleanDetail key={sel.id} row={sel} now={now} onClose={() => setSelected(null)} onChanged={reload} onGuestLeft={() => void guestLeft({ taskId: sel.id }, sel.unitNumber)} /> : null} />

      {creating && <NewCleanModal date={date} onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {assignFor && (
        <AssignBuildingModal building={assignFor} date={date} onClose={() => setAssignFor(null)}
          onDone={(n, who) => { setAssignFor(null); toast({ tone: 'success', title: `${n} ${n === 1 ? 'clean' : 'cleans'} in ${assignFor.name} given to ${who}.` }); reload(); }} />
      )}
    </div>
  );
}

/* ---------- one building ---------- */

const COLS = 'md:grid md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] md:items-center md:gap-2.5';

function BuildingCard({ group, now, selected, busy, onSelect, onGuestLeft, onPlan, onAssign }: {
  group: { id: string; name: string; rows: Row[]; departures: Departure[]; repairs: RepairOnDay[] }; now: number; selected: string | null; busy: string | null;
  onSelect: (id: string) => void; onGuestLeft: (b: { taskId?: string; reservationId?: string }, unit: string) => void; onPlan: (d: Departure) => void; onAssign: () => void;
}) {
  const count = group.rows.length + group.departures.length;
  const doneN = group.rows.filter(r => r.status === 'done').length;
  const open = group.rows.filter(r => r.status !== 'done');
  const unassigned = open.filter(r => !r.cleanerId && !r.assigneeId && !r.assigneeName).length;
  const names = [...new Set(group.rows.map(r => r.assigneeName).filter(Boolean))];
  return (
    <section className="bg-card rounded-card border border-solid border-line overflow-hidden flex-none">
      <header className="flex items-center justify-between gap-3 flex-wrap px-4 md:px-[18px] py-3 bg-[#F4F1EB]">
        <div className="min-w-0">
          <b className="text-heading">{group.name}</b>
          <span className="text-copy text-muted-ink"> · {count} {count === 1 ? 'unit' : 'units'} · {doneN} done</span>
        </div>
        <div className="flex items-center gap-2 text-copy flex-wrap">
          {unassigned > 0 ? <span className="text-[var(--color-critical-fg)] font-medium">{unassigned} unassigned</span>
            : names.length ? <span className="text-muted-ink">Cleaner <b className="text-ink">{names.length === 1 ? names[0] : `${names.length} people`}</b></span> : null}
          {open.length > 0 && <Button size="sm" variant="secondary" onClick={onAssign}>Assign whole building</Button>}
        </div>
      </header>
      <div className={cx('hidden text-meta text-muted-ink px-[18px] py-2 [border-bottom:1px_solid_var(--color-line-soft)]', COLS)}>
        <div>Unit</div><div>Check-out (leaving)</div><div>Check-in (arriving)</div><div>Time left</div><div>Type</div><div>Cleaner</div><div>Status</div>
      </div>
      {group.rows.map(r => <CleanRow key={r.id} r={r} now={now} active={r.id === selected} busy={busy === `left-${r.id}`} onSelect={() => onSelect(r.id)} onGuestLeft={() => onGuestLeft({ taskId: r.id }, r.unitNumber)} />)}
      {group.departures.map(d => (
        <div key={d.reservationId} className={cx('px-4 md:px-[18px] py-3 [border-top:1px_solid_var(--color-line-soft)] text-copy flex flex-col gap-1.5', COLS)}>
          <div className="flex items-center gap-2"><b>{d.unitNumber}</b><span className="md:hidden"><Chip tone="critical">No clean planned</Chip></span></div>
          <div><b className="[font-variant-numeric:tabular-nums]">{d.checkOutTime}</b> · {d.guestName}{d.lateCheckOut && <Chip tone="warning" className="ml-1">Late check-out</Chip>}{d.state === 'checked_out' && <Chip tone="gold" className="ml-1">Out</Chip>}</div>
          <div>{d.next ? <><b className="[font-variant-numeric:tabular-nums]">{d.next.checkInTime}</b> · {d.next.guestName}</> : <span className="text-muted-ink">No arrival</span>}</div>
          <div><span className="md:hidden text-muted-ink">Time left </span><TimeLeft at={d.next?.checkInAt} now={now} /></div>
          <div className="hidden md:block text-muted-ink">—</div>
          <div className="hidden md:block text-muted-ink">—</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="hidden md:inline"><Chip tone="critical">No clean</Chip></span>
            <Button size="sm" variant="primary" loading={busy === `plan-${d.reservationId}`} onClick={() => onPlan(d)}>Plan clean</Button>
            {d.state !== 'checked_out' && <Button size="sm" variant="secondary" loading={busy === `left-${d.reservationId}`} onClick={() => onGuestLeft({ reservationId: d.reservationId }, d.unitNumber)}>Guest left</Button>}
          </div>
        </div>
      ))}
      {group.repairs.length > 0 && (
        <div className="px-4 md:px-[18px] py-2.5 [border-top:1px_solid_var(--color-line-soft)] bg-page flex flex-col gap-1">
          {group.repairs.map(w => (
            <div key={w.id} className="flex items-center gap-2 text-meta flex-wrap">
              <Icon name="Wrench" size="sm" color="var(--color-gold-ink)" />
              <span><b>{w.unitNumber}</b> repair window {hm(w.startsAt)}–{hm(w.endsAt)}: {w.title}{w.assigneeName ? ` (${w.assigneeName})` : ''}</span>
              {w.overlaps.length > 0 && <Chip tone="critical">Overlaps a stay</Chip>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CleanRow({ r, now, active, busy, onSelect, onGuestLeft }: { r: Row; now: number; active: boolean; busy: boolean; onSelect: () => void; onGuestLeft: () => void }) {
  const st = CLEAN_STATUS[r.status];
  const files = r.photoCount + r.videoCount;
  const canMarkLeft = r.previous && !r.guestOut && r.status !== 'done' && r.status !== 'cleaning';
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={cx('px-4 md:px-[18px] py-3 [border-top:1px_solid_var(--color-line-soft)] text-copy cursor-pointer flex flex-col gap-1.5 outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-gold)]', COLS,
        active ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : 'hover:bg-page', r.status === 'done' && 'text-muted-ink')}>
      <div className="flex items-center gap-2 flex-wrap">
        <b className="text-ink">{r.unitNumber}</b>
        {r.carriedOver && <Chip tone="warning">From {dayLabel(r.day)}</Chip>}
        <span className="md:hidden ml-auto"><Chip tone={st.tone}>{st.label}</Chip></span>
      </div>
      <div className="min-w-0">
        <span className="md:hidden text-muted-ink">Out </span>
        {r.previous ? <><b className="[font-variant-numeric:tabular-nums]">{r.previous.checkOutTime}</b> · {r.previous.guestName}</> : <span className="text-muted-ink">No departing guest</span>}
        {r.previous?.lateCheckOut && <Chip tone="warning" className="ml-1">Late check-out</Chip>}
        {r.guestOut && r.guestLeftAt && <div className="text-meta text-gold-ink">Left at {hm(r.guestLeftAt)}</div>}
      </div>
      <div className="min-w-0">
        <span className="md:hidden text-muted-ink">In </span>
        {r.next ? <><b className="[font-variant-numeric:tabular-nums]">{r.next.checkInTime}</b> · {r.next.guestName}</> : <span className="text-muted-ink">No arrival</span>}
        {r.next?.earlyCheckIn && <Chip tone="warning" className="ml-1">Early check-in</Chip>}
      </div>
      <div><span className="md:hidden text-muted-ink">Time left </span><TimeLeft at={r.next?.checkInAt} now={now} done={r.status === 'done'} /></div>
      <div><span className="md:hidden text-muted-ink">Type </span>{KIND_LABEL[r.kind] ?? r.kind}</div>
      <div className={cx('truncate', !r.assigneeName && 'text-[var(--color-critical-fg)]')}><span className="md:hidden text-muted-ink">Cleaner </span>{r.assigneeName ?? 'Unassigned'}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="hidden md:inline"><Chip tone={st.tone} className="whitespace-normal">{r.status === 'done' && files ? `Done · ${files} ${files === 1 ? 'file' : 'files'}` : st.label}</Chip></span>
        {canMarkLeft && (
          <Button size="sm" variant="secondary" loading={busy} onClick={e => { e.stopPropagation(); onGuestLeft(); }}>Guest left</Button>
        )}
      </div>
    </div>
  );
}

/* ---------- the detail panel ---------- */

function CleanDetail({ row, now, onClose, onChanged, onGuestLeft }: { row: Row; now: number; onClose: () => void; onChanged: () => void; onGuestLeft: () => void }) {
  const toast = useToast();
  const { data, reload, error } = useApi<Detail>(`/housekeeping/tasks/${row.id}`);
  const { cleaners } = useCleaners(true);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [damage, setDamage] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (data) setChecklist(data.checklist); }, [data]);

  const refresh = useCallback(() => { reload(); onChanged(); }, [reload, onChanged]);
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' }); }
    finally { setBusy(null); }
  }
  async function reveal(id: string) {
    try { const r = await api.get<{ secret: string }>(`/access-credentials/${id}?reveal=true`); setRevealed(x => ({ ...x, [id]: r.secret || '(no code set)' })); }
    catch (e) { toast({ tone: 'critical', title: 'Code not shown.', body: e instanceof ApiFailure ? e.message : 'Try again.' }); }
  }

  const done = row.state === 'resolved';
  const files = data?.media.length ?? row.photoCount + row.videoCount;
  const used = row.startedAt ? (Date.parse(row.completedAt ?? new Date(now).toISOString()) - Date.parse(row.startedAt)) / 60000 : null;
  const unitLabel = `${row.propertyName} ${row.unitNumber}`;
  const kindName = row.kind === 'deep_clean' ? 'Deep clean' : row.kind === 'light_clean' ? 'Light clean' : 'Standard clean';

  return (
    <div className="flex flex-col gap-4 p-5 text-copy">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-meta text-muted-ink">{row.propertyName}</div>
          <div className="text-title font-semibold">{row.unitNumber} · {kindName}</div>
          <div className="text-muted-ink mt-1">
            {row.assigneeName ? `Cleaner ${row.assigneeName}` : 'No cleaner yet'}
            {row.startedAt && ` · started ${hm(row.startedAt)}`}
            {used != null && ` · ${done ? 'took' : 'used'} ${minutesLabel(used)}`}
          </div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-control bg-[#F4F1EB] p-2.5 flex flex-col gap-0.5">
          <span className="text-meta text-muted-ink">Leaving</span>
          {row.previous ? <><span><b>{row.previous.checkOutTime}</b> {row.previous.guestName}</span>
            {row.previous.lateCheckOut && <span className="text-meta text-[var(--color-warning-fg)]">Late check-out</span>}
            {row.guestOut ? <span className="text-meta text-gold-ink font-medium">Guest out{row.guestLeftAt ? ` at ${hm(row.guestLeftAt)}` : ''}</span>
              : !done && <Button size="sm" variant="secondary" className="mt-1 self-start" onClick={onGuestLeft}>Guest left</Button>}</>
            : <span className="text-muted-ink">No departing guest</span>}
        </div>
        <div className="rounded-control bg-gold-tint p-2.5 flex flex-col gap-0.5">
          <span className="text-meta text-muted-ink">Arriving</span>
          {row.next ? <><span><b>{row.next.checkInTime}</b> {row.next.guestName}{row.next.guests ? ` · ${row.next.guests} ${row.next.guests === 1 ? 'guest' : 'guests'}` : ''}</span>
            {row.next.earlyCheckIn && <span className="text-meta text-[var(--color-warning-fg)]">Early check-in</span>}
            <span className="text-meta">Time left <TimeLeft at={row.next.checkInAt} now={now} done={done} /></span></>
            : <span className="text-muted-ink">No arrival</span>}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-copy font-semibold">Door access</h3>
        {!data ? <Skeleton height={36} /> : data.access.length === 0 ? <span className="text-muted-ink">No access details on this unit. Add them on the unit's Access tab.</span>
          : data.access.map(a => (
            <div key={a.id} className="rounded-control bg-[#F4F1EB] p-2.5 flex flex-col gap-1">
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
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="m-0 text-copy font-semibold">Checklist {checklist && <span className="text-muted-ink font-normal">{checklist.filter(c => c.done).length} of {checklist.length}</span>}</h3>
        {checklist ? <Checklist taskId={row.id} items={checklist} readOnly={done} onChange={setChecklist} /> : <Skeleton height={120} />}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-copy font-semibold">Proof of work <span className="text-muted-ink font-normal">{files} {files === 1 ? 'file' : 'files'}{!done && ', at least 1 to complete'}</span></h3>
        {data && <MediaGrid items={data.media} />}
        {!done && <MediaDrop upload={uploadTo(`/tasks/${row.id}/photos`)} onDone={refresh} />}
      </section>

      {data && data.damage.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-copy font-semibold">Damage reported</h3>
          {data.damage.map(d => <a key={d.id} href={`#/operations/maintenance?id=${d.id}`} className="text-gold-ink">{d.title} · {stamp(d.reportedAt)}</a>)}
        </section>
      )}

      {!done && (
        <section className="grid grid-cols-2 gap-2.5">
          <FormRow label="Cleaner">
            <select className={INPUT} value={row.cleanerId ?? ''} onChange={e => e.target.value && void act('assign', () => api.post(`/housekeeping/tasks/${row.id}/assign`, { cleanerId: e.target.value, force: true }), 'Cleaner assigned.')}>
              <option value="">{row.assigneeName && !row.cleanerId ? row.assigneeName : 'Pick a cleaner'}</option>
              {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}{c.employmentType === 'outsourced' ? ' (outsourced)' : ''}</option>)}
            </select>
          </FormRow>
          <FormRow label="Type">
            <select className={INPUT} value={row.kind} onChange={e => void act('kind', () => api.patch(`/housekeeping/tasks/${row.id}`, { kind: e.target.value, title: e.target.value === 'deep_clean' ? 'Deep clean' : row.title }), 'Clean type changed.')}>
              <option value="turnover">Standard</option><option value="deep_clean">Deep</option><option value="light_clean">Light</option>
            </select>
          </FormRow>
        </section>
      )}

      <Button variant="secondary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>Report damage (opens a Maintenance job)</Button>

      {!done && (
        <div className="flex gap-2">
          {row.state !== 'in_progress' && (
            <Button variant="secondary" className="flex-1" loading={busy === 'start'} onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${row.id}/start`, {}), 'Clean started.')}>Start</Button>
          )}
          <Button variant="primary" className="flex-1" loading={busy === 'complete'} disabled={files === 0} disabledReason="Add at least one photo or video first."
            onClick={() => void act('complete', async () => {
              const r = await api.post<{ cost: { amount: number; created: boolean; reason: string | null } | null }>(`/tasks/${row.id}/complete`, { photoIds: [] });
              if (r.cost && !r.cost.created && r.cost.reason && r.cost.reason !== 'already charged') toast({ tone: 'info', title: 'Cost not added.', body: `Not charged to the unit: ${r.cost.reason}.` });
            }, 'Clean complete.', `${unitLabel} is ready.`)}>
            Mark complete
          </Button>
        </div>
      )}
      {data?.cost && (
        <p className="m-0 text-meta text-muted-ink">
          {data.cost.charged ? `Charged to the unit: ${kindName} ${rm(data.cost.amount)}.` : `Cost charged to unit on completion: ${kindName} ${rm(data.cost.amount)} (${COST_SOURCE[data.cost.source]}).`}
        </p>
      )}
      {done && row.completedAt && <p className="m-0 text-meta text-muted-ink">Completed {stamp(row.completedAt)}.</p>}

      <HistoryDisclosure entity="tasks" id={row.id} refreshKey={data} />

      {damage && (
        <ReportDamageModal unitId={row.unitId} unitLabel={unitLabel} taskId={row.id} onClose={() => setDamage(false)}
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
    } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Not saved. Try again.'); setBusy(false); }
  }
  return (
    <OpsModal title="New clean" sub="For a deep clean, a refresh, or a turnover the bookings did not create." onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Add clean</Button></>}>
      <FormRow label="Unit" error={error}>
        <SearchSelect label="Unit" value={unitId} onChange={setUnitId} options={unitOptions} placeholder="Search units" size="md" />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Day"><input type="date" className={INPUT} value={day} onChange={e => e.target.value && setDay(e.target.value)} /></FormRow>
        <FormRow label="Type">
          <select className={INPUT} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="turnover">Standard</option><option value="deep_clean">Deep</option><option value="light_clean">Light</option>
          </select>
        </FormRow>
      </div>
      <FormRow label="Cleaner (optional)">
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
    } catch (e) { setError(e instanceof ApiFailure ? e.message : 'Not saved. Try again.'); setBusy(false); }
  }
  return (
    <OpsModal title={`Assign ${building.name}`} sub={`Every unfinished clean in this building on ${dayLabel(date)} goes to one cleaner.`} onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Assign</Button></>}>
      <FormRow label="Cleaner" error={error}>
        <select className={INPUT} value={cleanerId} onChange={e => setCleanerId(e.target.value)}>
          <option value="">Pick a cleaner</option>
          {cleaners.map(c => <option key={c.id} value={c.id}>{c.name} · {c.busy} today</option>)}
        </select>
      </FormRow>
      <label className="flex items-center gap-2 text-copy cursor-pointer">
        <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} className="w-4 h-4 accent-[#151515]" />
        Only cleans with no cleaner yet
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
  { value: '', label: 'Finished' }, { value: 'active', label: 'Not finished' }, { value: 'all', label: 'All cleans' },
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
    const skip = (r: HistoryRow) => (r.state === 'resolved' ? 'Already finished' : move === 'start' && r.state === 'in_progress' ? 'Already started' : null);
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
      title: res.ok ? `${plural(res.ok, 'clean')} ${move === 'start' ? 'started' : 'marked done'}.` : move === 'start' ? 'No cleans started.' : 'No cleans marked done.',
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
    { key: 'proof', label: 'Proof', type: 'number', value: r => r.photoCount, width: 80, title: 'Photos and videos on the clean.' },
  ], [show]);

  const filtered = !!(urlQ || cleaner || params.get('from') || params.get('to'));
  const clearAll = () => { setDraft(''); update(p => ['q', 'cleaner', 'from', 'to'].forEach(k => p.delete(k))); };
  const showLabel = show === 'active' ? 'unfinished cleans' : show === 'all' ? 'cleans' : 'finished cleans';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cleaning" sub={data ? `${data.total.toLocaleString('en-MY')} ${showLabel} from ${dayLabel(from)} to ${dayLabel(to)}` : 'Finished cleans'}
        actions={<TabSwitch tab="history" onTab={onTab} />} />
      <DataTable<HistoryRow>
        id="cleaning.history" columns={columns} rows={data ? data.data : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload}
        server={{ total: data?.total ?? 0, page: data?.page ?? 1, pageSize: data?.pageSize ?? 50, sizes: [25, 50, 100], defaultPageSize: 50, fetchAll }}
        viewParams={['state', 'cleaner', 'q']} filtered={filtered} onClearFilters={clearAll}
        noun={['clean', 'cleans']} exportName="cleaning-history" selectionKey={`${show}|${from}|${to}`}
        empty={{ title: show === 'active' ? 'No unfinished cleans in these dates.' : 'No cleans in these dates.', icon: 'Sparkles' }}
        selectable={canBulk}
        bulkActions={(picked, clear) => <>
          <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setBulkAssign({ ids: picked.map(r => r.id), clear })}>Assign cleaner</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Play" size="sm" />} loading={bulkBusy === 'start'} onClick={() => void bulkMove(picked, 'start', clear)}>Start</Button>
          <Button size="sm" variant="primary" icon={<Icon name="CheckCircle2" size="sm" />} onClick={() => setConfirmDone({ rows: picked, clear })}>Mark done</Button>
        </>}
        toolbar={<>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Search unit or building" aria-label="Search" className={cx(INPUT, 'h-9 w-[220px] max-md:w-full')} />
          <Select label="Show" value={show} onChange={v => setParam('state', v)} options={SHOW} className="w-[150px] max-md:flex-1" />
          <Select label="Cleaner" value={cleaner} onChange={v => setParam('cleaner', v)} options={cleaners.map(c => ({ value: c.id, label: c.name }))} placeholder="All cleaners" className="w-[160px] max-md:flex-1" />
          <label className="flex items-center gap-1.5 text-meta text-muted-ink">From <input type="date" value={from} onChange={e => e.target.value && setParam('from', e.target.value)} className={cx(INPUT, 'h-9 w-auto')} /></label>
          <label className="flex items-center gap-1.5 text-meta text-muted-ink">To <input type="date" value={to} onChange={e => e.target.value && setParam('to', e.target.value)} className={cx(INPUT, 'h-9 w-auto')} /></label>
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
        <OpsModal title={`Mark ${plural(confirmDone.rows.length, 'clean')} done?`} onClose={() => setConfirmDone(null)} busy={bulkBusy === 'done'}
          sub="Each unit turns Ready and its clean is charged to the unit. A clean with no photo or video is refused and named afterwards."
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
