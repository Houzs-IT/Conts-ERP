import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../Icon';
import ChannelMark from '../ChannelMark';
import { StaleBanner } from '../DataState';
import { EmptyState } from '../States';
import { BookingDrawer } from '../booking/BookingDrawer';
import { useApi } from '../../lib/useApi';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { channelNote, type ChannelSync } from '../../lib/bookingStatus';
import { todayMyt, monthLabel, plural, rmShort, dateRange, count } from '../../lib/format';
import { CHANNEL } from '../../lib/vocabulary';
import { BlockWizard } from './CalendarModals';
import { SelectionPopover, type NightSelection } from './SelectionPopover';
import { displayName, holdName, phaseOf } from './ReservationBar';
import type { CalendarBlock as Block, CalendarUnit as Unit } from './types';

/**
 * Phone calendar (owner, Oct 2026 — design "Redesign Mobile", Calendar screen).
 * Step 1: pick a unit from a searchable list. Step 2: that unit's month, Airbnb-style: a 7-day grid, each booking a
 * coloured bar from mid check-in day to mid check-out day, the nightly price on free nights, and the month's
 * occupancy, revenue, ADR and nights booked in a bar at the bottom.
 * Same API as the desktop board (GET /reservations/calendar), the same booking drawer, block wizard and night picker.
 * State lives in the address: ?unit=<id>&month=YYYY-MM (&b=<building> for the list).
 */

interface Payload {
  from: string; to: string; units: Unit[]; blocks: Block[];
  baseRate: Record<string, number>; weekendRate?: Record<string, number | null>; rates?: Record<string, number>;
  canSetRates?: boolean; generatedAt: string;
}

const DAY = 864e5;
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => isoOf(parse(iso) + n * DAY);
const nightsBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY);
const isHold = (b: Block) => b.channel === 'maintenance_block' || b.channel === 'owner_stay';
const counts = (b: Block) => b.state !== 'inquiry' && b.state !== 'cancelled' && b.state !== 'no_show';
/** Monday-first weeks, as Malaysian calendars print them. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function monthBounds(ym: string) {
  const first = `${ym}-01`;
  const d = new Date(parse(first));
  const next = isoOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { first, next, last: addDays(next, -1), nights: nightsBetween(first, next) };
}
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Nights of a stay inside [first, next) and its value pro-rated to them. */
function inMonth(b: Block, first: string, next: string) {
  const a = b.checkIn > first ? b.checkIn : first;
  const z = b.checkOut < next ? b.checkOut : next;
  const n = Math.max(0, nightsBetween(a, z));
  const total = Math.max(1, nightsBetween(b.checkIn, b.checkOut));
  return { nights: n, value: Math.round((b.grossBookingValue * n) / total) };
}

function monthStats(unitId: string, blocks: Block[], first: string, next: string, nights: number) {
  let booked = 0, held = 0, revenue = 0;
  for (const b of blocks) {
    if (b.unitId !== unitId || !counts(b)) continue;
    const r = inMonth(b, first, next);
    if (isHold(b)) held += r.nights; else { booked += r.nights; revenue += r.value; }
  }
  // Occupancy = occupied available nights / available nights. Holds come out of the available nights.
  const available = Math.max(0, nights - held);
  return { booked, held, available, revenue, occupancy: available ? booked / available : 0, adr: booked ? Math.round(revenue / booked) : 0 };
}

export default function UnitMonthCalendar() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) => setParams(p => {
    const q = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') q.delete(k); else q.set(k, v); }
    return q;
  }, { replace: true });
  const today = todayMyt();
  const ym = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : today.slice(0, 7);
  const unitId = params.get('unit');
  const building = params.get('b') || 'all';
  const { first, next, last, nights } = monthBounds(ym);
  const { data, loading, error, reload } = useApi<Payload>(
    `/reservations/calendar?from=${first}&to=${last}${building !== 'all' ? `&property=${encodeURIComponent(building)}` : ''}`);

  const units = data?.units ?? [];
  const unit = unitId ? units.find(u => u.id === unitId) ?? null : null;

  if (!unitId || (!unit && !loading)) {
    return <UnitPicker units={units} blocks={data?.blocks ?? []} loading={loading} error={error} reload={reload}
      ym={ym} first={first} next={next} nights={nights} today={today} building={building}
      onBuilding={b => set({ b: b === 'all' ? null : b })} onMonth={n => set({ month: shiftMonth(ym, n) })}
      onPick={id => set({ unit: id })} />;
  }
  if (!unit) return <div className="py-16 text-center text-meta text-muted-ink">Loading the month…</div>;
  return <MonthView unit={unit} data={data!} ym={ym} first={first} next={next} nights={nights} today={today}
    error={error} reload={reload} onBack={() => set({ unit: null })} onMonth={n => set({ month: shiftMonth(ym, n) })}
    onToday={() => set({ month: null })} />;
}

/* ---------------------------------------------------------------- step 1: units */

function UnitPicker({ units, blocks, loading, error, reload, ym, first, next, nights, today, building, onBuilding, onMonth, onPick }: {
  units: Unit[]; blocks: Block[]; loading: boolean; error: string | null; reload: () => void;
  ym: string; first: string; next: string; nights: number; today: string; building: string;
  onBuilding: (b: string) => void; onMonth: (n: number) => void; onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const buildings = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.propertyId ?? u.propertyName, u.propertyName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [units]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return units
      .filter(u => !needle || `${u.unitNumber} ${u.propertyName}`.toLowerCase().includes(needle))
      .map(u => {
        const s = monthStats(u.id, blocks, first, next, nights);
        const now = blocks.find(b => b.unitId === u.id && counts(b) && b.checkIn <= today && b.checkOut > today);
        return { u, s, now };
      })
      .sort((a, b) => a.u.propertyName.localeCompare(b.u.propertyName) || a.u.unitNumber.localeCompare(b.u.unitNumber, undefined, { numeric: true }));
  }, [units, blocks, q, first, next, nights, today]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.01em]">Calendar</h1>
        <MonthStep ym={ym} onMonth={onMonth} />
      </div>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}
      <div className="flex gap-2">
        <label className="flex-1 min-w-0 h-11 flex items-center gap-2 px-3.5 rounded-control border border-solid border-line bg-card text-muted-ink">
          <Icon name="Search" size="sm" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a unit" aria-label="Find a unit"
            className="flex-1 min-w-0 border-0 outline-none bg-transparent text-copy text-ink font-sans" />
        </label>
        {buildings.length > 1 && (
          <select value={building} onChange={e => onBuilding(e.target.value)} aria-label="Building"
            className="h-11 max-w-[44%] px-3 rounded-control border border-solid border-line bg-card text-copy text-ink font-sans">
            <option value="all">All buildings</option>
            {buildings.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>
      <span className="text-meta text-muted-ink">{loading ? 'Loading units…' : `${plural(rows.length, 'unit')} · occupancy for ${monthLabel(first, { long: true })}`}</span>
      {!loading && rows.length === 0 && <EmptyState bare kind={q ? 'filtered' : 'empty'} title={q ? `No unit matches “${q}”.` : 'No units yet.'} />}
      <div className="flex flex-col rounded-card border border-solid border-line bg-card overflow-hidden">
        {rows.map(({ u, s, now }) => {
          const pct = Math.round(s.occupancy * 100);
          const tone = pct >= 90 ? 'var(--color-gold)' : pct < 70 ? 'var(--color-warning-line)' : 'var(--color-ink)';
          return (
            <button key={u.id} type="button" onClick={() => onPick(u.id)}
              className="min-h-[64px] flex items-center gap-3 px-4 py-2.5 border-0 [border-bottom:1px_solid_var(--color-line-soft)] bg-transparent text-left cursor-pointer text-ink font-sans">
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{u.unitNumber}</span>
                <span className="text-meta text-muted-ink truncate">{u.propertyName}{now ? ` · ${isHold(now) ? holdName(now) : 'Hosting now'}` : ' · Free tonight'}</span>
              </span>
              <span className="flex flex-col items-end gap-1 flex-none w-[74px]">
                <span className="text-copy font-semibold tabular-nums">{pct}%</span>
                <span className="w-full h-1 rounded-full bg-muted overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: tone }} /></span>
              </span>
              <Icon name="ChevronRight" size="sm" color="var(--color-text-faint)" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- step 2: one unit, one month */

function MonthView({ unit, data, ym, first, next, nights, today, error, reload, onBack, onMonth, onToday }: {
  unit: Unit; data: Payload; ym: string; first: string; next: string; nights: number; today: string;
  error: string | null; reload: () => void; onBack: () => void; onMonth: (n: number) => void; onToday: () => void;
}) {
  const toast = useToast();
  const [openBlock, setOpenBlock] = useState<Block | null>(null);
  const [tapStart, setTapStart] = useState<string | null>(null);
  const [popover, setPopover] = useState<NightSelection | null>(null);
  const [block, setBlock] = useState<null | { from?: string; to?: string }>(null);
  const canSetRates = data.canSetRates !== false;

  const blocks = useMemo(() => data.blocks.filter(b => b.unitId === unit.id && b.state !== 'cancelled' && b.state !== 'no_show')
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn)), [data.blocks, unit.id]);
  const stats = monthStats(unit.id, data.blocks, first, next, nights);

  const priceOn = (iso: string) => {
    const saved = data.rates?.[`${unit.id}:web:${iso}`];
    if (saved != null) return saved;
    const base = data.baseRate[unit.id] ?? 0;
    const dow = new Date(parse(iso)).getUTCDay();
    return dow === 5 || dow === 6 ? data.weekendRate?.[unit.id] ?? base : base;
  };
  const holderOn = (iso: string) => blocks.find(b => counts(b) && b.checkIn <= iso && b.checkOut > iso) ?? null;

  // Weeks, Monday first, padded with the neighbouring months' days.
  const lead = (new Date(parse(first)).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -lead);
  const weeks = Math.ceil((lead + nights) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  function tapNight(iso: string) {
    if (iso < today) return;
    if (!tapStart) { setTapStart(iso); return; }
    const [a, z] = tapStart <= iso ? [tapStart, iso] : [iso, tapStart];
    const span = nightsBetween(a, z) + 1;
    const taken = Array.from({ length: span }, (_, i) => holderOn(addDays(a, i))).filter(Boolean) as Block[];
    setTapStart(null);
    setPopover({
      unitId: unit.id, unitNumber: unit.unitNumber, first: a, last: z, nights: span,
      taken: taken.length, takenBy: taken[0] ? (taken[0].guestName || CHANNEL[taken[0].channel].label) : null,
      priceNow: priceOn(a), x: 0, y: 0,
    });
  }

  return (
    <div className="flex flex-col gap-3 pb-[96px]">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="All units"
          className="h-10 pl-1.5 pr-3 inline-flex items-center gap-1 rounded-control border-0 bg-transparent text-copy font-medium text-muted-ink cursor-pointer font-sans">
          <Icon name="ChevronLeft" size="sm" />Units
        </button>
        <span className="flex-1" />
        {ym !== today.slice(0, 7) && <button type="button" onClick={onToday} className="h-9 px-3 rounded-control border border-solid border-line bg-card text-meta font-semibold text-ink cursor-pointer font-sans">Today</button>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{unit.unitNumber}</span>
          <span className="text-meta text-muted-ink truncate">{unit.propertyName}</span>
        </span>
        <MonthStep ym={ym} onMonth={onMonth} />
      </div>
      {error && <StaleBanner message={`Showing the last month we have. ${error}`} onRetry={reload} />}

      <div className="rounded-card border border-solid border-line bg-card overflow-hidden">
        <div className="grid grid-cols-7 [border-bottom:1px_solid_var(--color-line)]">
          {WEEKDAYS.map((d, i) => <span key={i} className={`py-2 text-center text-meta font-semibold ${i >= 5 ? 'text-ink' : 'text-muted-ink'}`}>{d}</span>)}
        </div>
        {Array.from({ length: weeks }, (_, w) => {
          const wk = days.slice(w * 7, w * 7 + 7);
          const wStart = wk[0], wNext = addDays(wStart, 7);
          // Bars run from the middle of check-in day to the middle of check-out day, clipped to this week.
          const bars = blocks.filter(b => b.checkIn < wNext && b.checkOut > wStart).map(b => {
            const s = b.checkIn < wStart ? 0 : nightsBetween(wStart, b.checkIn) + 0.5;
            const e = b.checkOut > addDays(wStart, 6) ? 7 : nightsBetween(wStart, b.checkOut) + 0.5;
            return { b, s, e, clipL: b.checkIn < wStart, clipR: b.checkOut > addDays(wStart, 6) };
          });
          return (
            <div key={w} className="relative grid grid-cols-7 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
              {wk.map(iso => {
                const out = iso < first || iso >= next;
                const free = !holderOn(iso);
                const past = iso < today;
                const picked = tapStart === iso;
                return (
                  <button key={iso} type="button" onClick={() => free && !out && tapNight(iso)} disabled={!free || out || past}
                    aria-label={`${iso}${free ? `, free, ${rmShort(priceOn(iso))}` : ''}`}
                    className={`h-[68px] flex flex-col items-start justify-between p-1.5 border-0 [border-right:1px_solid_var(--color-line-soft)] last:border-r-0 bg-transparent text-left font-sans
                      ${out ? 'opacity-35' : ''} ${free && !out && !past ? 'cursor-pointer' : 'cursor-default'} ${picked ? 'bg-gold-tint!' : ''}`}>
                    <span className={`text-meta tabular-nums ${iso === today ? 'w-6 h-6 -m-0.5 grid place-items-center rounded-full bg-black text-white font-semibold' : past ? 'text-faint' : 'text-ink font-medium'}`}>{Number(iso.slice(8))}</span>
                    {free && !out && !past && priceOn(iso) > 0 && <span className="text-[11px] text-muted-ink tabular-nums leading-none">{rmShort(priceOn(iso)).replace('RM ', '')}</span>}
                  </button>
                );
              })}
              {bars.map(({ b, s, e, clipL, clipR }) => {
                const ch = CHANNEL[b.channel];
                const hold = isHold(b), phase = phaseOf(b, today), dim = phase === 'past' || phase === 'inquiry';
                const left = (s / 7) * 100, width = ((e - s) / 7) * 100;
                const r = (on: boolean) => (on ? '0' : '999px');
                return (
                  <button key={b.id} type="button" onClick={() => setOpenBlock(b)}
                    aria-label={`${hold ? holdName(b) : displayName(b)} · ${hold ? '' : ch.label + ' · '}${dateRange(b.checkIn, b.checkOut)}`}
                    className="absolute top-[26px] h-[26px] flex items-center gap-1 px-1.5 border-0 cursor-pointer font-sans overflow-hidden"
                    style={{
                      left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)`,
                      borderRadius: `${r(clipL)} ${r(clipR)} ${r(clipR)} ${r(clipL)}`,
                      background: hold
                        ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${ch.color} 28%, var(--color-surface-card)) 0 2px, var(--color-surface-card) 2px 7px)`
                        : phase === 'inquiry' ? 'transparent' : dim ? ch.tint : ch.color,
                      border: phase === 'inquiry' ? '1px dashed var(--color-line-strong)' : hold ? `1px ${ch.border} color-mix(in srgb, ${ch.color} 50%, transparent)` : 'none',
                      color: hold || dim ? ch.ink : b.channel === 'direct' || b.channel === 'airbnb' ? 'var(--color-black)' : 'white',
                    }}>
                    {!clipL && !hold && <span className="flex-none"><ChannelMark ch={b.channel} size={16} muted={dim} /></span>}
                    <span className="text-[12px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{hold ? holdName(b) : (b.guestName.split(/\s+/)[0] || ch.label)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-meta text-muted-ink">
        {(['airbnb', 'booking_com', 'agoda', 'direct'] as const).filter(c => blocks.some(b => b.channel === c)).map(c => (
          <span key={c} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: CHANNEL[c].color }} />{CHANNEL[c].label}</span>
        ))}
        {blocks.some(isHold) && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, var(--color-line-strong) 0 1px, transparent 1px 3px)' }} />Blocked</span>}
        <span>Tap two free nights to book, block or price them.</span>
      </div>

      {/* The month at a glance, fixed above the tab bar. */}
      <div className="fixed left-0 right-0 z-30 bottom-[calc(64px+env(safe-area-inset-bottom))] bg-card [border-top:1px_solid_var(--color-line)] px-4 py-2.5 grid grid-cols-4 gap-2">
        <Stat label="Occupancy" value={`${Math.round(stats.occupancy * 100)}%`} gold={stats.occupancy >= 0.9} />
        <Stat label="Earnings" value={rmShort(stats.revenue)} />
        <Stat label="Avg nightly price" value={stats.adr ? rmShort(stats.adr) : '—'} />
        <Stat label="Nights" value={`${count(stats.booked)}/${count(stats.available)}`} />
      </div>

      {tapStart && !popover && (
        <div role="status" className="fixed left-3 right-3 z-[55] bottom-[calc(132px+env(safe-area-inset-bottom))] bg-black text-white rounded-card shadow-[var(--shadow-overlay)] px-4 py-3 flex items-center gap-3">
          <span className="flex-1 text-copy">Now tap the last night.</span>
          <button type="button" onClick={() => setTapStart(null)} className="h-9 px-3 rounded-control border-0 bg-transparent text-white/85 text-meta font-semibold cursor-pointer font-sans">Cancel</button>
        </div>
      )}
      {popover && (
        <SelectionPopover sel={popover} phone canSetRates={canSetRates} onClose={() => setPopover(null)}
          onBook={() => { const s = popover; setPopover(null); window.location.hash = `#/reservations/bookings?create=1&forUnit=${encodeURIComponent(unit.id)}&checkIn=${s.first}&checkOut=${addDays(s.last, 1)}`; }}
          onBlock={() => { const s = popover; setPopover(null); setBlock({ from: s.first, to: addDays(s.last, 1) }); }}
          onPrice={() => { const s = popover; setPopover(null); window.location.hash = `#/reservations/calendar?unit=${encodeURIComponent(unit.id)}&rates=1&from=${s.first}&to=${s.last}`; }} />
      )}
      {block && <BlockWizard units={[unit]} initial={{ unitId: unit.id, ...block }} onClose={() => setBlock(null)}
        onSave={v => {
          api.post<{ effects?: { channel: ChannelSync } }>('/blocks', { unitId: v.unitId, from: v.from, to: v.to, kind: v.kind, reason: v.reason })
            .then(res => { setBlock(null); toast({ tone: 'success', title: v.kind === 'owner_stay' ? 'Owner stay added.' : 'Nights blocked.', body: `${dateRange(v.from, v.to)}. ${channelNote(res?.effects?.channel, 'held')}`.trim() }); reload(); })
            .catch(e => toast({ tone: 'critical', title: 'Nights not blocked.', body: errorMessage(e, 'Try again in a moment.') }));
        }} />}
      <BookingDrawer id={openBlock?.id ?? null} onClose={() => setOpenBlock(null)} onChanged={() => reload()}
        summary={openBlock ? {
          id: openBlock.id, externalRef: openBlock.ref, guestName: openBlock.guestName, guestsCount: 0, unitNumber: unit.unitNumber,
          propertyName: unit.propertyName, channel: openBlock.channel, state: openBlock.state, checkIn: openBlock.checkIn, checkOut: openBlock.checkOut,
          grossBookingValue: openBlock.grossBookingValue,
        } : null} />
    </div>
  );
}

function MonthStep({ ym, onMonth }: { ym: string; onMonth: (n: number) => void }) {
  const btn = 'w-9 h-9 grid place-items-center rounded-control border border-solid border-line bg-card text-ink cursor-pointer';
  return (
    <span className="flex items-center gap-1.5 flex-none">
      <button type="button" className={btn} onClick={() => onMonth(-1)} aria-label="Previous month"><Icon name="ChevronLeft" size="sm" /></button>
      <span className="min-w-[78px] text-center text-copy font-semibold">{monthLabel(`${ym}-01`)}</span>
      <button type="button" className={btn} onClick={() => onMonth(1)} aria-label="Next month"><Icon name="ChevronRight" size="sm" /></button>
    </span>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] text-muted-ink">{label}</span>
      <span className={`text-[15px] font-semibold tabular-nums truncate ${gold ? 'text-gold-ink' : 'text-ink'}`}>{value}</span>
    </span>
  );
}
