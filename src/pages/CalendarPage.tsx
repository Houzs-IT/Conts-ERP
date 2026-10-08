import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { BookingDrawer } from '../components/booking/BookingDrawer';
import { channelNote, type ChannelSync } from '../lib/bookingStatus';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { api, notifyFailure } from '../lib/api';
import { todayMyt, rm, date, dateRange, dateShort, dateTime, time, timeWithZone } from '../lib/format';
import { CHANNEL, TONE } from '../lib/vocabulary';
import type { BookingChannel, Tone } from '../lib/types';
import { CalendarFilters } from '../components/calendar/CalendarFilters';
import { BlockWizard, RateUpdate, SetPriceModal } from '../components/calendar/CalendarModals';
import { type CalendarBlock as Block, type CalendarUnit as Unit } from '../components/calendar/types';

/** Width of one night column, px. The unit column width is the CSS variable --unit-col (narrower on phones). */
const COL = 60;
const SPAN = 30;
/** Above this many units on the board, the rate rows start hidden: 139 units with three or four rate rows
 *  each is some 15,000 extra cells, and the board is read for occupancy first. */
const RATES_AUTO_MAX = 8;

// The rate rows: the web (direct) rate, always, plus each booking site the unit is on. The calendar API
// works that out per unit (a Channex connection, or a booking from that site in the last 180 days) and sends
// it in the same payload, so the first render already has the right rows. Only a payload without `channels`
// (an older backend) falls back to all three. `mark` is the channel whose logo labels the row.
const RATE_ROWS: { key: 'web' | BookingChannel; label: string; short: string; mark: BookingChannel }[] = [
  { key: 'web', label: 'Web', short: 'Web', mark: 'direct' },
  { key: 'airbnb', label: 'Airbnb', short: 'Airbnb', mark: 'airbnb' },
  { key: 'booking_com', label: 'Booking.com', short: 'Booking', mark: 'booking_com' },
  { key: 'agoda', label: 'Agoda', short: 'Agoda', mark: 'agoda' },
];
const RATE_ROW_BY_KEY = Object.fromEntries(RATE_ROWS.map(r => [r.key, r])) as Record<string, typeof RATE_ROWS[number]>;
const OTA_CHANNELS: BookingChannel[] = ['airbnb', 'booking_com', 'agoda'];
/** Channels that are not booking sites: always offered as filters. */
const OWN_CHANNELS: BookingChannel[] = ['direct', 'maintenance_block', 'owner_stay'];
const otaChannelsOf = (u: Unit) => u.channels ?? OTA_CHANNELS;
const rateRowsFor = (u: Unit) => ['web', ...otaChannelsOf(u)].map(k => RATE_ROW_BY_KEY[k]).filter(Boolean);

interface BuildingRow { id: string; name: string; units: number }
interface Payload { from: string; to: string; buildings?: BuildingRow[]; units: Unit[]; blocks: Block[]; baseRate: Record<string, number>; rates?: Record<string, number>; uplifts?: Record<string, number>; weekendMultiplier?: number; restrictions?: Record<string, { minStay: number; stopSell: boolean }>; generatedAt: string }

/** GET /api/integrations — the OTA rows are worked out from the real Channex connections. */
interface IntegrationRow { provider: string; state: string; lastSyncedAt: string | null; unitsLinked: number }
const SYNC_CHIP: Record<string, { label: string; tone: Tone }> = {
  connected: { label: 'Synced', tone: 'success' },
  degraded: { label: 'Errors', tone: 'warning' },
  not_connected: { label: 'Not linked', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'critical' },
  failed: { label: 'Failed', tone: 'critical' },
};

const today = new Date(todayMyt());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
// Dates are parsed as UTC midnight, so weekday / day / month are read in UTC to stay on the calendar date.
const utcLabel = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-MY', { ...o, timeZone: 'UTC' });
/** Fri and Sat nights: the nights the weekend multiplier prices up. */
const isWeekendNight = (d: Date) => d.getUTCDay() === 5 || d.getUTCDay() === 6;
const ringgit = (sen: number) => Math.round(sen / 100).toLocaleString('en-MY');

// Dev-only sample board (useApi drops it in a real build), laid out around today so the today column shows.
const T = (n: number) => todayMyt(n);
const FALLBACK: Payload = {
  from: T(0), to: T(SPAN - 1), generatedAt: '',
  baseRate: { u1: 28800, u2: 23100, u3: 31800, u4: 26500, u5: 24200, u6: 22800 },
  units: [
    { id: 'u1', unitNumber: '#C-13-13A', propertyId: 'p1', propertyName: 'Agile Bukit Bintang, Imbi', channels: ['airbnb', 'booking_com', 'agoda'] },
    { id: 'u2', unitNumber: '#B-08-11', propertyId: 'p2', propertyName: 'Arcoris Mont Kiara', channels: ['airbnb', 'booking_com'] },
    { id: 'u3', unitNumber: '#MK2-09-16', propertyId: 'p3', propertyName: 'Arte Mont Kiara', channels: ['airbnb', 'agoda'] },
    { id: 'u4', unitNumber: '#15-06', propertyId: 'p4', propertyName: 'Scarletz', channels: ['airbnb'] },
    { id: 'u5', unitNumber: '#A-21-02', propertyId: 'p5', propertyName: 'The Establishment', channels: [] },
    { id: 'u6', unitNumber: '#C-31-14', propertyId: 'p6', propertyName: 'Sentral Suites', channels: ['booking_com', 'agoda'] },
  ],
  blocks: [
    { id: 'b1', unitId: 'u1', channel: 'airbnb', state: 'checked_in', guestName: 'Nadia Abdullah', checkIn: T(-1), checkOut: T(1), grossBookingValue: 85200, ref: 'ABNB-7741QK', reason: null },
    { id: 'b2', unitId: 'u1', channel: 'direct', state: 'confirmed', guestName: 'Aaron Lee', checkIn: T(1), checkOut: T(3), grossBookingValue: 113600, ref: 'DIR-2026-0916', reason: null },
    { id: 'b3', unitId: 'u1', channel: 'booking_com', state: 'confirmed', guestName: 'Priya Sundaram', checkIn: T(8), checkOut: T(12), grossBookingValue: 198800, ref: 'BDC-5512088', reason: null },
    { id: 'b4', unitId: 'u3', channel: 'agoda', state: 'confirmed', guestName: 'Marcus Wong', checkIn: T(0), checkOut: T(3), grossBookingValue: 159000, ref: 'AGD-33110', reason: null },
    { id: 'b5', unitId: 'u3', channel: 'booking_com', state: 'confirmed', guestName: 'Siti Rahmah', checkIn: T(8), checkOut: T(11), grossBookingValue: 127200, ref: 'BDC-5512411', reason: null },
    { id: 'b6', unitId: 'u2', channel: 'booking_com', state: 'confirmed', guestName: 'Chen Yu', checkIn: T(2), checkOut: T(7), grossBookingValue: 161700, ref: 'BDC-5512087', reason: null },
    { id: 'b7', unitId: 'u4', channel: 'owner_stay', state: 'confirmed', guestName: 'Chong Wei Han', checkIn: T(7), checkOut: T(9), grossBookingValue: 0, ref: 'OWN-0032', reason: 'Owner staying, agreed 12 Sep' },
    { id: 'b8', unitId: 'u6', channel: 'maintenance_block', state: 'confirmed', guestName: 'AquaFix Sdn Bhd', checkIn: T(0), checkOut: T(6), grossBookingValue: 0, ref: 'MNT-0914', reason: 'Plumbing works' },
  ],
  restrictions: { [`u1:${T(5)}`]: { minStay: 2, stopSell: false }, [`u1:${T(6)}`]: { minStay: 2, stopSell: false }, [`u2:${T(10)}`]: { minStay: 1, stopSell: true } },
};

// Column backgrounds: exactly one bg utility per cell so no two compete. Hover variants always win over these.
const BG_TODAY = 'bg-gold-tint';
const BG_WEEKEND = 'bg-muted/70';
const TODAY_EDGES = 'shadow-[inset_1px_0_0_var(--color-gold),inset_-1px_0_0_var(--color-gold)]';
const CELL_EDGE = '[border-left:1px_solid_var(--color-line-soft)]';
const STICKY_COL = 'w-[var(--unit-col)] flex-none box-border sticky left-0 bg-card [border-right:1px_solid_var(--color-line)]';
const buildingOf = (u: Unit) => u.propertyId ?? u.propertyName;

/** Folded buildings, remembered per person in this browser. Storage can be missing or refuse; the board works without it. */
function useFolded(userId: string | undefined) {
  const key = `tc.calendar.folded.${userId ?? 'anon'}`;
  const [folded, setFolded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { return {}; }
  });
  useEffect(() => {
    try {
      const on = Object.fromEntries(Object.entries(folded).filter(([, v]) => v));
      if (Object.keys(on).length) localStorage.setItem(key, JSON.stringify(on)); else localStorage.removeItem(key);
    } catch { /* storage unavailable: folding just isn't remembered */ }
  }, [key, folded]);
  return [folded, setFolded] as const;
}

export default function CalendarPage() {
  // Fixed 30-day window; scroll the grid sideways, or jump a window with the arrows.
  const span = SPAN;
  // The window and the building live in the address (?w=, ?b=), so a link or a reload shows the same board.
  const [params, setParams] = useSearchParams();
  const setParam = (k: string, v: string | null) => setParams(p => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const weekOffset = Math.trunc(Number(params.get('w'))) || 0;
  const setWeekOffset = (next: number | ((w: number) => number)) => {
    const v = typeof next === 'function' ? next(weekOffset) : next;
    setParam('w', v ? String(v) : null);
  };
  const property = params.get('b') || 'all';
  const setProperty = (b: string) => setParam('b', b === 'all' ? null : b);
  const start = addDays(today, weekOffset * span);
  const from = iso(start), to = iso(addDays(start, span - 1));
  // One building asks the server for just that building: a few KB instead of about 150.
  const { data, loading, error, reload } = useApi<Payload>(`/reservations/calendar?from=${from}&to=${to}${property !== 'all' ? `&property=${encodeURIComponent(property)}` : ''}`, FALLBACK);
  const { user } = useSession();
  const [folded, setFolded] = useFolded(user?.id);
  // No fallback on purpose: without the real connection status the page shows no sync claims at all.
  const { data: integrations, reload: reloadIntegrations } = useApi<{ data: IntegrationRow[] }>('/integrations');
  const toast = useToast();
  const phone = usePhone();

  const [off, setOff] = useState<Partial<Record<BookingChannel, boolean>>>({});
  const [statusOff, setStatusOff] = useState<Record<string, boolean>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ratesPref, setRatesPref] = useState<boolean | null>(null);
  const [unitOpen, setUnitOpen] = useState<Record<string, boolean>>({});
  const [rateEdits, setRateEdits] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [priceModal, setPriceModal] = useState<null | { unit: Unit; channel: string; dayIso: string; current: number }>(null);
  const [blockWizard, setBlockWizard] = useState(false);
  const [blockPrefill, setBlockPrefill] = useState<{ unitId?: string; from?: string; to?: string }>({});
  const [rateUpdate, setRateUpdate] = useState<false | { unitIds?: string[]; from?: string; to?: string }>(false);
  const [openBlock, setOpenBlock] = useState<Block | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Optimistic overlays, rolled back if the API refuses.
  const [dateEdits, setDateEdits] = useState<Record<string, { checkIn: string; checkOut: string }>>({});
  // Which booking is being dragged, and which of its nights the pointer grabbed.
  const dragRef = useRef<{ id: string; grabOffset: number } | null>(null);

  const allUnits = useMemo(() => data?.units ?? [], [data]);
  const properties = useMemo<BuildingRow[]>(() => data?.buildings ?? Array.from(
    allUnits.reduce((m, u) => m.set(buildingOf(u), { id: buildingOf(u), name: u.propertyName, units: (m.get(buildingOf(u))?.units ?? 0) + 1 }), new Map<string, BuildingRow>()).values(),
  ), [data, allUnits]);
  const units = useMemo(() => (property === 'all' ? allUnits : allUnits.filter(u => buildingOf(u) === property)), [allUnits, property]);
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; units: Unit[] }>();
    for (const u of units) {
      const g = m.get(buildingOf(u)) ?? { id: buildingOf(u), name: u.propertyName, units: [] };
      g.units.push(u); m.set(g.id, g);
    }
    return [...m.values()];
  }, [units]);
  const expanded = ratesPref ?? units.length <= RATES_AUTO_MAX;
  const totalUnits = properties.reduce((n, b) => n + b.units, 0) || allUnits.length;
  const liveBlocks = useMemo(
    () => (data?.blocks ?? []).map(b => ({
      ...b, ...dateEdits[b.id],
    })),
    [data, dateEdits],
  );
  const blocks = useMemo(() => liveBlocks.filter(b => {
    if (b.state === 'cancelled' || b.state === 'no_show') return false; // a cancelled or no-show stay releases its dates on the board
    if (off[b.channel]) return false;
    if (b.channel === 'maintenance_block') return !statusOff.blocked;
    return !statusOff[b.state];
  }), [liveBlocks, off, statusOff]);
  const gridStart = new Date(data?.from ?? from);
  const dayIndex = (d: string) => Math.round((new Date(d).getTime() - gridStart.getTime()) / 864e5);
  const dayIso = (i: number) => iso(addDays(gridStart, i));
  const todayIdx = dayIndex(iso(today));
  const days = Array.from({ length: span }, (_, i) => addDays(gridStart, i));
  const months = days.reduce<{ label: string; count: number }[]>((acc, d) => {
    const label = utcLabel(d, { month: 'long', year: 'numeric' });
    if (acc.length && acc[acc.length - 1].label === label) acc[acc.length - 1].count++;
    else acc.push({ label, count: 1 });
    return acc;
  }, []);
  const colBg = (i: number) => (i === todayIdx ? BG_TODAY : isWeekendNight(days[i]) ? BG_WEEKEND : 'bg-card');
  const todayEdge = (i: number) => (i === todayIdx ? TODAY_EDGES : '');

  const buildingCount = properties.length;
  // Per unit: its bars, and which booking holds each night of the window. Worked out once per change,
  // not once per row per render.
  const byUnit = useMemo(() => {
    const m = new Map<string, { bars: Block[]; cells: (Block | null)[] }>();
    for (const u of units) m.set(u.id, { bars: [], cells: Array(span).fill(null) });
    for (const b of blocks) {
      const row = m.get(b.unitId);
      if (!row) continue;
      row.bars.push(b);
      for (let i = Math.max(0, dayIndex(b.checkIn)); i < Math.min(span, dayIndex(b.checkOut)); i++) row.cells[i] = b;
    }
    return m;
  }, [units, blocks, data?.from]); // eslint-disable-line react-hooks/exhaustive-deps
  const allFolded = groups.length > 1 && groups.every(g => folded[g.id]);
  // Booking-site toggles only for sites at least one shown unit is on; direct, block and owner stay always.
  const filterChannels = useMemo(() => {
    const on = new Set(units.flatMap(otaChannelsOf));
    return [...OTA_CHANNELS.filter(c => on.has(c)), ...OWN_CHANNELS];
  }, [units]);
  const offCount = filterChannels.filter(c => off[c]).length;
  const filtersDirty = property !== 'all' || offCount > 0 || Object.values(statusOff).some(Boolean);
  const filterCount = (property !== 'all' ? 1 : 0) + offCount + Object.values(statusOff).filter(Boolean).length;

  // Real connection status, or nothing.
  const otaRows = (integrations?.data ?? []).filter(r => OTA_CHANNELS.includes(r.provider as BookingChannel));
  const syncFor = (key: string) => otaRows.find(r => r.provider === key);
  const lastSync = otaRows.map(r => r.lastSyncedAt).filter((x): x is string => !!x).sort().pop() ?? null;
  const syncTrouble = otaRows.some(r => r.state === 'degraded' || r.state === 'failed' || r.state === 'expired');

  function rateFor(unitId: string, channel: string, i: number) {
    const key = `${unitId}:${channel}:${i}`;
    if (rateEdits[key] != null) return rateEdits[key];
    const saved = data?.rates?.[`${unitId}:${channel}:${dayIso(i)}`];
    if (saved != null) return saved;
    // Same rule as the Pricing page and Channex: (base + the channel's uplift), weekend multiplier on Fri/Sat.
    const standard = (data?.baseRate[unitId] ?? 0) + (data?.uplifts?.[`${unitId}:${channel}`] ?? 0);
    return isWeekendNight(addDays(gridStart, i)) ? Math.round(standard * (data?.weekendMultiplier ?? 1.22)) : standard;
  }
  function setPrice(unitId: string, channel: string, i: number, rmValue: number) {
    const key = `${unitId}:${channel}:${i}`;
    const prev = rateEdits[key];
    setRateEdits(e => ({ ...e, [key]: Math.round(rmValue * 100) }));
    api.put('/rates', { unitId, channel, date: dayIso(i), rate: Math.round(rmValue * 100) })
      .then(() => toast({ tone: 'success', title: 'Rate set.', body: 'Saved for that night and sent to the channel if the unit is linked.' }))
      .catch(err => { setRateEdits(e => { const n = { ...e }; if (prev == null) delete n[key]; else n[key] = prev; return n; }); notifyFailure(err); });
  }

  function emptyNight(unit: Unit, i: number) {
    setDialog({
      title: `${unit.unitNumber} · ${date(dayIso(i))}`,
      body: 'This night is open. Block it, create a reservation, or set a price.',
      confirmLabel: 'Set price',
      extraActions: [
        { label: 'Block dates', onClick: () => { setDialog(null); setBlockPrefill({ unitId: unit.id, from: dayIso(i), to: dayIso(i + 1) }); setBlockWizard(true); } },
        { label: 'Create reservation', onClick: () => { setDialog(null); window.location.hash = `#/reservations/bookings?create=1&forUnit=${encodeURIComponent(unit.id)}&checkIn=${dayIso(i)}&checkOut=${dayIso(i + 1)}`; } },
      ],
      onConfirm: () => { setDialog(null); setPriceModal({ unit, channel: 'web', dayIso: dayIso(i), current: rateFor(unit.id, 'web', i) }); },
    });
  }

  /** An existing booking/block on the same unit that overlaps [ci, co). */
  function conflictFor(unitId: string, ci: string, co: string, excludeId?: string) {
    return liveBlocks.find(o =>
      o.unitId === unitId && o.id !== excludeId
      && dayIndex(o.checkIn) < dayIndex(co) && dayIndex(ci) < dayIndex(o.checkOut),
    ) ?? null;
  }

  /** Move a booking to new dates: pre-check the range, then a 428-style consequence
   *  confirm, then the optimistic patch. Shared by drag-drop and the drawer editor. */
  function requestMove(b: Block, newCheckIn: string, newCheckOut: string) {
    if (newCheckIn === b.checkIn && newCheckOut === b.checkOut) return;
    const clash = conflictFor(b.unitId, newCheckIn, newCheckOut, b.id);
    if (clash) {
      toast({ tone: 'critical', title: 'Dates unavailable.', body: `${clash.guestName} already holds ${dateRange(clash.checkIn, clash.checkOut)} on this unit. Pick another range.` });
      return;
    }
    setDialog({
      title: 'Move this booking?',
      body: "The move is checked against the unit's other bookings. If the unit is linked to Channex the new dates go to the booking sites. The guest is not messaged.",
      meta: `${b.guestName} · ${dateRange(b.checkIn, b.checkOut)} → ${dateRange(newCheckIn, newCheckOut)}`,
      confirmLabel: 'Move booking', busyLabel: 'Moving…',
      onConfirm: async () => {
        setBusy(true);
        setDateEdits(e => ({ ...e, [b.id]: { checkIn: newCheckIn, checkOut: newCheckOut } }));
        try {
          const res = await api.patch<{ effects?: { channel: ChannelSync } }>(`/reservations/${b.id}/dates`, { checkIn: newCheckIn, checkOut: newCheckOut, confirm: true });
          toast({ tone: 'success', title: 'Booking moved.', body: `${b.guestName || 'The booking'} is now ${dateRange(newCheckIn, newCheckOut)}. ${channelNote(res?.effects?.channel, 'moved')}`.trim() });
          reload();
        } catch (e) {
          // Put the bar back where it was: the server kept the old dates.
          setDateEdits(x => { const n = { ...x }; delete n[b.id]; return n; });
          toast({ tone: 'critical', title: 'Booking not moved.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
        }
        setBusy(false); setDialog(null);
      },
    });
  }

  /** A booking bar was dropped on day index `dropIndex` of `unitId`. */
  function dropOnDay(unitId: string, dropIndex: number) {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    const b = liveBlocks.find(x => x.id === d.id);
    if (!b) return;
    if (b.unitId !== unitId) {
      toast({ tone: 'info', title: 'Same unit only.', body: 'Drag a booking within its own row. To move it to another unit, edit the booking.' });
      return;
    }
    const nights = dayIndex(b.checkOut) - dayIndex(b.checkIn);
    const startIdx = dropIndex - d.grabOffset;
    requestMove(b, dayIso(startIdx), dayIso(startIdx + nights));
  }

  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await api.post<{ bookings?: { processed: number } }>('/integrations/sync');
      const n = res?.bookings?.processed ?? 0;
      toast({ tone: 'success', title: 'Channels synced.', body: n ? `${n} booking ${n === 1 ? 'update' : 'updates'} pulled from Channex.` : 'Nothing new from Channex.' });
      reload(); reloadIntegrations();
    } catch (e) {
      toast({ tone: 'critical', title: 'Channels were not synced.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally {
      setSyncing(false);
    }
  }

  const segBtn = 'h-full min-w-10 md:min-w-0 px-2.5 grid place-items-center bg-transparent hover:bg-muted border-none cursor-pointer font-sans text-[13px] text-ink';
  // Phones drop the year: the month header right under it already says it.
  const rangeShort = `${dateShort(iso(start))} – ${dateShort(iso(addDays(start, span - 1)))}`;
  const rangeYear = utcLabel(addDays(start, span - 1), { year: 'numeric' });
  // Icon-only 40px squares on phones; icon and label from md up.
  const toolBtn = 'relative inline-flex items-center justify-center gap-1.5 h-[42px] w-[42px] md:w-auto md:h-9 md:px-3 box-border rounded-control border border-solid border-line bg-card hover:bg-muted cursor-pointer font-sans text-[13px] font-medium text-ink whitespace-nowrap flex-none disabled:cursor-default';

  return (
    <>
      <PageHeader
        title="Calendar"
        sub={`${totalUnits} ${totalUnits === 1 ? 'unit' : 'units'} · ${buildingCount} ${buildingCount === 1 ? 'building' : 'buildings'}${phone ? '' : ' · Asia/Kuala Lumpur'}`}
        right={
          <div className="flex items-center gap-2">
            <button type="button" className={toolBtn} onClick={() => setRateUpdate({})} aria-label="Rate update" title="Rate update">
              <Icon name="Tag" size="sm" /><span className="hidden md:inline">Rate update</span>
            </button>
            <button type="button" className={toolBtn} onClick={() => { setBlockPrefill({}); setBlockWizard(true); }} aria-label="Block wizard" title="Block dates">
              <Icon name="Ban" size="sm" /><span className="hidden md:inline">Block wizard</span>
            </button>
            <button type="button" className={toolBtn} onClick={refresh} disabled={syncing} aria-label="Refresh" title="Pull new bookings from the channels">
              <span className={`inline-grid ${syncing ? 'animate-spin' : ''}`}><Icon name="RefreshCw" size="sm" /></span><span className="hidden md:inline">Refresh</span>
            </button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}

      {/* Not the shared Card: that clips overflow, which would cut off the status menu. */}
      {/* On phones the card runs edge to edge (cancelling main's 16px gutter) so the grid gets the full width. */}
      <div className="flex-none bg-card border border-solid border-line border-x-0 md:border-x rounded-none md:rounded-card -mx-4 md:mx-0 shadow-[var(--shadow-card)] min-w-0">
        {/* Toolbar + filters */}
        <div className="px-3 md:px-4 py-2.5 md:py-3 flex flex-col gap-2.5 md:gap-3 [border-bottom:1px_solid_var(--color-line)]">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 md:flex-none min-w-0 items-stretch h-[42px] md:h-9 box-border rounded-control border border-solid border-line bg-card overflow-hidden">
              <button type="button" onClick={() => setWeekOffset(w => w - 1)} className={segBtn} aria-label="Previous 30 days"><Icon name="ChevronLeft" size="sm" /></button>
              <span className="flex-1 md:flex-none min-w-0 px-1.5 md:px-3 grid place-items-center [border-left:1px_solid_var(--color-line)] [border-right:1px_solid_var(--color-line)] text-[13px] font-medium whitespace-nowrap [font-variant-numeric:tabular-nums] md:min-w-[156px]">
                <span>{rangeShort}<span className="hidden md:inline"> {rangeYear}</span></span>
              </span>
              <button type="button" onClick={() => setWeekOffset(w => w + 1)} className={segBtn} aria-label="Next 30 days"><Icon name="ChevronRight" size="sm" /></button>
              <button type="button" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}
                className={`${segBtn} [border-left:1px_solid_var(--color-line)]! px-3 font-medium disabled:text-faint disabled:cursor-default disabled:hover:bg-transparent`}>Today</button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {lastSync && (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] text-muted-ink whitespace-nowrap" title={`Last update sent to Channex ${dateTime(lastSync)}`}>
                  <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: TONE[syncTrouble ? 'warning' : 'success'].line }} />
                  {syncTrouble
                    ? <a href="#/system/integrations" className="no-underline" style={{ color: TONE.warning.fg }}>Channel errors · see Integrations</a>
                    : <>Channels updated {iso(new Date(lastSync)) === todayMyt() ? timeWithZone(lastSync) : `${dateShort(lastSync)} ${time(lastSync)}`}</>}
                </span>
              )}
              <button type="button" onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen} aria-label={filterCount ? `Filters, ${filterCount} on` : 'Filters'} title="Filters"
                className={`${toolBtn} md:hidden ${filtersOpen ? 'bg-muted!' : ''}`}>
                <Icon name="SlidersHorizontal" size="sm" />
                {filterCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 box-border rounded-full bg-black text-white text-[11px] grid place-items-center">{filterCount}</span>}
              </button>
              {groups.length > 1 && (
                // Phones fold one building at a time from its header; the toolbar there has no room for a third button.
                <button type="button" className={`${toolBtn} hidden! md:inline-flex!`} onClick={() => setFolded(allFolded ? {} : Object.fromEntries(groups.map(g => [g.id, true])))}
                  aria-label={allFolded ? 'Expand all buildings' : 'Collapse all buildings'} title={allFolded ? 'Expand all buildings' : 'Collapse all buildings'}>
                  <Icon name={allFolded ? 'UnfoldVertical' : 'FoldVertical'} size="sm" /><span className="hidden md:inline">{allFolded ? 'Expand all' : 'Collapse all'}</span>
                </button>
              )}
              <button type="button" className={toolBtn} onClick={() => { setRatesPref(!expanded); setUnitOpen({}); }}
                aria-label={expanded ? 'Hide rates' : 'Show rates'} title={expanded ? 'Hide the rate rows' : 'Show the availability and rate rows under every unit'}>
                <Icon name={expanded ? 'ChevronsDownUp' : 'ChevronsUpDown'} size="sm" /><span className="hidden md:inline">{expanded ? 'Hide rates' : 'Show rates'}</span>
              </button>
            </div>
          </div>

          <div className={`${filtersOpen ? 'block' : 'hidden'} md:block`}>
            <CalendarFilters channels={filterChannels} properties={properties} property={property} setProperty={setProperty}
              off={off} setOff={setOff} statusOff={statusOff} setStatusOff={setStatusOff} dirty={filtersDirty}
              onReset={() => { setOff({}); setStatusOff({}); setProperty('all'); }} />
          </div>
        </div>

        {/* Grid: scrolls inside the card both ways; the date header and unit column stay put. */}
        <div className="max-h-[72vh] overflow-auto overscroll-x-contain rounded-none md:rounded-b-card [scrollbar-width:thin] [--unit-col:104px] md:[--unit-col:224px]">
          <div style={{ minWidth: `calc(var(--unit-col) + ${span * COL}px)` }} aria-busy={loading}
            className={`transition-opacity duration-150 ${loading && data ? 'opacity-70' : ''}`}>
            <div className="sticky top-0 z-20 flex bg-muted [border-bottom:1px_solid_var(--color-line)]">
              <div className={`${STICKY_COL} bg-muted! z-30 flex items-end px-2 md:px-3 pb-2.5 text-[12px] font-semibold text-muted-ink whitespace-nowrap`}>
                {units.length.toLocaleString('en-MY')} {units.length === 1 ? 'unit' : 'units'}
              </div>
              <div className="flex flex-col">
                <div className="flex h-7">
                  {months.map((m, k) => (
                    <div key={m.label} className={`flex-none box-border flex items-center ${k ? '[border-left:1px_solid_var(--color-line)]' : ''}`} style={{ width: m.count * COL }}>
                      <span className="sticky left-[calc(var(--unit-col)+10px)] px-2.5 text-[12px] font-semibold text-ink whitespace-nowrap">{m.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex">
                  {days.map((d, i) => {
                    const isToday = i === todayIdx;
                    return (
                      <div key={i} className={`flex-none box-border h-11 flex flex-col items-center justify-center gap-0.5 ${CELL_EDGE} ${i === todayIdx ? BG_TODAY : isWeekendNight(d) ? 'bg-sunken' : 'bg-muted'} ${todayEdge(i)}`} style={{ width: COL }}
                        title={isToday ? 'Today' : undefined}>
                        <span className={`text-[11px] font-medium ${isToday ? 'font-semibold text-[var(--color-text-accent)]' : 'text-muted-ink'}`}>{utcLabel(d, { weekday: 'short' })}</span>
                        <span className={`text-[13px] font-semibold leading-none grid place-items-center ${isToday ? 'w-6 h-6 rounded-full bg-gold text-black' : 'h-6 text-ink'}`}>{d.getUTCDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {units.length === 0 && (
              <div className="px-4 py-10 text-center text-[13px] text-muted-ink">{loading ? 'Loading the board…' : 'No units match these filters.'}</div>
            )}

            <div className="relative">
              {/* Weekend and today shading plus the night dividers, drawn once behind every row rather than in
                  every cell. Rows above it are transparent apart from their sticky unit column. */}
              <div aria-hidden className="absolute top-0 bottom-0 z-0 pointer-events-none" style={{ left: 'var(--unit-col)', width: span * COL }}>
                {days.map((d, i) => (i === todayIdx || isWeekendNight(d)) && (
                  <div key={i} className={`absolute top-0 bottom-0 ${colBg(i)} ${todayEdge(i)}`} style={{ left: i * COL, width: COL }} />
                ))}
                <div className="absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(to right, var(--color-line-soft) 0 1px, transparent 1px ${COL}px)` }} />
              </div>

              {groups.map(g => {
                const isFolded = !!folded[g.id] && groups.length > 1;
                return (
                  <div key={g.id}>
                    <BuildingRowHeader name={g.name} units={g.units} folded={isFolded} showToggle={groups.length > 1}
                      onToggle={() => setFolded(f => ({ ...f, [g.id]: !isFolded }))}
                      days={days} byUnit={byUnit} dayIso={dayIso} />
                    {!isFolded && (
                      <div>
                {g.units.map(u => {
                  const { bars: unitBlocks, cells } = byUnit.get(u.id) ?? { bars: [], cells: Array(span).fill(null) };
                  const rowOpen = unitOpen[u.id] ?? expanded;
                  const now = todayIdx >= 0 && todayIdx < span ? cells[todayIdx] : undefined;
                  const readiness = now === undefined ? null
                    : !now ? { label: 'Available today', dot: TONE.neutral.line }
                    : now.channel === 'maintenance_block' ? { label: 'Blocked today', dot: TONE.critical.line }
                    : now.channel === 'owner_stay' ? { label: 'Owner stay', dot: TONE.neutral.line }
                    : { label: 'Occupied', dot: TONE.success.line };
                  return (
                    <div key={u.id} className="relative z-[1] [border-bottom:1px_solid_var(--color-line)] [content-visibility:auto] [contain-intrinsic-size:auto_64px]">
                      {/* Unit row with booking bars */}
                      <div className="flex">
                        {/* The whole cell toggles the unit's rates, so phones get a full-size touch target. */}
                        <div className={`${STICKY_COL} z-10 flex`}>
                          <button type="button" aria-expanded={rowOpen} onClick={() => setUnitOpen(o => ({ ...o, [u.id]: !rowOpen }))}
                            title={`${u.unitNumber} · ${u.propertyName}${readiness ? ' · ' + readiness.label : ''} · ${rowOpen ? 'hide' : 'show'} rates`}
                            className="flex-1 min-w-0 flex items-center gap-1 pl-2 md:pl-1.5 pr-2 md:pr-3 py-0 m-0 border-none bg-transparent hover:bg-muted/60 cursor-pointer text-left font-sans">
                            <span className="hidden md:grid w-6 h-6 flex-none place-items-center text-muted-ink">
                              <Icon name={rowOpen ? 'ChevronDown' : 'ChevronRight'} size="sm" />
                            </span>
                            <span className="min-w-0 flex flex-col gap-px">
                              <span className="text-[13px] font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.unitNumber}</span>
                              {/* The building is the group header above, so the second line is just today's state. */}
                              {readiness && (
                                <span className="flex items-center gap-[5px] min-w-0 text-[11px] text-muted-ink whitespace-nowrap">
                                  <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: readiness.dot }} />
                                  <span className="overflow-hidden text-ellipsis">{readiness.label}</span>
                                </span>
                              )}
                            </span>
                          </button>
                        </div>
    
                        {/* One track per unit instead of 30 cells: the night under the pointer is worked out from where
                            it is. The column shading comes from the layer behind the rows. */}
                        <div className="group relative flex-none h-16 cursor-pointer" style={{ width: span * COL }}
                          aria-label={`${u.unitNumber} nights`}
                          onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--hx', `${Math.floor((e.clientX - r.left) / COL) * COL}px`); }}
                          onClick={e => {
                            const r = e.currentTarget.getBoundingClientRect(), i = Math.floor((e.clientX - r.left) / COL);
                            if (i < 0 || i >= span) return;
                            const booked = cells[i];
                            if (booked) setOpenBlock(booked); else emptyNight(u, i);
                          }}
                          onDragOver={e => { if (dragRef.current) e.preventDefault(); }}
                          onDrop={e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); dropOnDay(u.id, Math.floor((e.clientX - r.left) / COL)); }}>
                          <div aria-hidden className="absolute top-0 bottom-0 hidden group-hover:block bg-sunken/80 pointer-events-none" style={{ left: 'var(--hx, -100px)', width: COL }} />
                          {unitBlocks.map(b => {
                            const ci = dayIndex(b.checkIn), co = dayIndex(b.checkOut);
                            const s = Math.max(0, ci), e = Math.min(span, co);
                            if (e <= s) return null;
                            const ch = CHANNEL[b.channel]; const hold = ch.border !== 'solid';
                            const clipL = ci < 0, clipR = co > span;
                            const inset = 3;
                            const left = s * COL + (clipL ? 0 : inset), width = (e - s) * COL - (clipL ? 0 : inset) - (clipR ? 0 : inset);
                            const r = (on: boolean) => (on ? 0 : 8);
                            const fullName = b.guestName || (b.channel === 'owner_stay' ? 'Owner stay' : b.channel === 'maintenance_block' ? 'Blocked' : ch.label);
                            const firstName = fullName.split(' ')[0];
                            // A one-night bar is too narrow for logo and name side by side, so they stack.
                            const narrow = width < 100;
                            return (
                              <div key={b.id} draggable onClick={e => { e.stopPropagation(); setOpenBlock(b); }}
                                title={`${fullName} · ${ch.label}${b.ref ? ' · ' + b.ref : ''} · ${dateRange(b.checkIn, b.checkOut)}${b.reason ? ' · ' + b.reason : ''} · drag to move`}
                                onDragStart={ev => {
                                  ev.dataTransfer.effectAllowed = 'move';
                                  const rect = ev.currentTarget.getBoundingClientRect();
                                  dragRef.current = { id: b.id, grabOffset: (s - ci) + Math.max(0, Math.floor((ev.clientX - rect.left) / COL)) };
                                }}
                                onDragEnd={() => { dragRef.current = null; }}
                                className={`absolute top-2.5 bottom-2.5 z-[2] box-border flex overflow-hidden cursor-grab active:cursor-grabbing select-none hover:brightness-[0.98] ${narrow ? 'flex-col justify-center items-start gap-0.5 px-1.5' : 'items-center gap-1.5 px-2'}`}
                                style={{
                                  left, width, color: ch.ink,
                                  // Holds read as a pale, finely hatched band so a long block does not shout over the bookings around it.
                                  background: hold ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${ch.tint} 70%, var(--color-surface-card)) 0 2px, var(--color-surface-card) 2px 9px)` : ch.tint,
                                  border: hold ? `1px ${ch.border} color-mix(in srgb, ${ch.color} 45%, transparent)` : `1px solid color-mix(in srgb, ${ch.color} 28%, transparent)`,
                                  borderLeft: clipL ? undefined : hold ? undefined : `3px solid ${ch.color}`,
                                  borderRadius: `${r(clipL)}px ${r(clipR)}px ${r(clipR)}px ${r(clipL)}px`,
                                }}>
                                {width >= 30 && <ChannelMark ch={b.channel} size={narrow ? 14 : 16} />}
                                {/* The name may wrap onto a second line rather than be cut short; the tooltip has it in full. */}
                                {narrow
                                  ? <span className="max-w-full text-[11px] leading-[13px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{firstName}</span>
                                  : <span className="min-w-0 flex flex-col">
                                      <span className="md:hidden text-[12px] leading-[14px] font-semibold [overflow-wrap:anywhere] line-clamp-2">{fullName}</span>
                                      <span className="hidden md:[display:-webkit-box] text-[12px] leading-[14px] font-semibold [overflow-wrap:anywhere] line-clamp-2">{fullName}</span>
                                      {b.grossBookingValue > 0 && width > 150 && (
                                        <span className="hidden md:block text-[11px] leading-[13px] whitespace-nowrap opacity-75 [font-variant-numeric:tabular-nums]">{rm(b.grossBookingValue, { cents: false })}</span>
                                      )}
                                    </span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
    
                      {rowOpen && (
                        <>
                          {/* Availability, with the night's restriction folded in: a "2n" marker for a minimum stay above
                              one night, "Closed" for stop sell. Only nights that have one show anything extra, so the
                              grid keeps one row here. Clicking a night opens Rate update for it to change either. */}
                          <SubRow label="Availability">
                            {days.map((_, i) => {
                              const left = cells[i] ? 0 : 1;
                              const rs = data?.restrictions?.[`${u.id}:${dayIso(i)}`];
                              const minStay = rs && rs.minStay > 1 ? rs.minStay : 0;
                              const restriction = rs?.stopSell ? 'Closed for sale' : minStay ? `Minimum ${minStay} nights` : 'No minimum stay, open for sale';
                              return (
                                <button key={i} type="button" onClick={() => setRateUpdate({ unitIds: [u.id], from: dayIso(i), to: dayIso(i) })}
                                  title={`${left ? '1 of 1 unit available' : 'Sold'} · ${restriction} · click to change`}
                                  style={{ width: COL }}
                                  className={`flex-none box-border h-10 md:h-8 p-0 pl-1 border-none bg-transparent hover:bg-sunken/80 cursor-pointer font-sans text-[11.5px] whitespace-nowrap flex items-center justify-end gap-0.5 [font-variant-numeric:tabular-nums] ${minStay && !rs?.stopSell ? 'pr-1.5' : 'pr-2'} ${left ? 'text-ink-2' : 'text-faint'}`}>
                                  {rs?.stopSell
                                    ? <span className="px-1 rounded-[4px] text-[10.5px] font-semibold leading-[16px]" style={{ background: TONE.critical.bg, color: TONE.critical.fg }}>Closed</span>
                                    : <>
                                        {minStay > 0 && <span className="mr-auto px-[3px] rounded-[4px] text-[10px] font-semibold leading-[16px] bg-muted text-ink">{minStay}n</span>}
                                        {left ? '1 left' : 'Sold'}
                                      </>}
                                </button>
                              );
                            })}
                          </SubRow>
                          {rateRowsFor(u).map(r => {
                            // A booking site the unit is not connected to gets no price from us, so none is shown.
                            const unlinked = r.key !== 'web' && !!u.linked && !u.linked.includes(r.key as BookingChannel);
                            const sync = r.key === 'web' ? undefined : unlinked ? { state: 'not_connected', lastSyncedAt: null } : syncFor(r.key);
                            const chip = sync ? SYNC_CHIP[sync.state] : undefined;
                            return (
                              <SubRow key={r.key} label={
                                <>
                                  <ChannelMark ch={r.mark} size={16} />
                                  <span className="md:hidden text-ink font-medium whitespace-nowrap overflow-hidden text-ellipsis">{r.short}</span>
                                  <span className="hidden md:inline text-ink font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={r.label}>{chip ? r.short : r.label}</span>
                                  {chip && (
                                    <span className="hidden md:inline-block text-[10.5px] font-semibold px-1.5 rounded-full leading-[17px] whitespace-nowrap"
                                      style={{ background: TONE[chip.tone].bg, color: TONE[chip.tone].fg }}
                                      title={sync?.lastSyncedAt ? `Last update sent ${dateTime(sync.lastSyncedAt)}` : undefined}>{chip.label}</span>
                                  )}
                                  <span className="hidden md:inline ml-auto text-[10.5px] font-medium text-faint">RM</span>
                                </>
                              }>
                                {days.map((_, i) => {
                                  const price = rateFor(u.id, r.key, i);
                                  const custom = rateEdits[`${u.id}:${r.key}:${i}`] != null || data?.rates?.[`${u.id}:${r.key}:${dayIso(i)}`] != null;
                                  // No price to show: the unit has no base rate yet, or the site is not linked and nothing was set by hand.
                                  const none = !custom && (price <= 0 || unlinked);
                                  return (
                                    <button key={i} type="button" onClick={() => setPriceModal({ unit: u, channel: r.key, dayIso: dayIso(i), current: price })}
                                      title={`${r.label} · ${date(dayIso(i))} · ${none ? (unlinked ? `not linked to ${r.label}, so no price is sent` : 'no rate set') : `RM ${ringgit(price)}`}${custom ? ' · set by hand' : ''} · click to set`}
                                      style={{ width: COL }}
                                      className={`flex-none box-border h-10 md:h-8 p-0 pr-2 border-none bg-transparent hover:bg-sunken/80 cursor-pointer font-sans text-[12px] text-right [font-variant-numeric:tabular-nums] ${none ? 'text-faint' : custom ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                                      {none ? '—' : ringgit(price)}
                                    </button>
                                  );
                                })}
                              </SubRow>
                            );
                          })}
                        </>
                      )}
                    </div>
                  );
                })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* One booking drawer for reservations and blocks, the same one the Bookings list uses. */}
      <BookingDrawer id={openBlock?.id ?? null} onClose={() => setOpenBlock(null)} onChanged={() => reload()}
        summary={openBlock ? (() => { const u = allUnits.find(x => x.id === openBlock.unitId); return {
          id: openBlock.id, externalRef: openBlock.ref, guestName: openBlock.guestName, guestsCount: 0, unitNumber: u?.unitNumber ?? '',
          propertyName: u?.propertyName ?? '', channel: openBlock.channel, state: openBlock.state, checkIn: openBlock.checkIn, checkOut: openBlock.checkOut,
          grossBookingValue: openBlock.grossBookingValue,
        }; })() : null} />

      <Dialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
      {priceModal && <SetPriceModal m={priceModal} onClose={() => setPriceModal(null)}
        onSave={rmValue => { const i = dayIndex(priceModal.dayIso); setPrice(priceModal.unit.id, priceModal.channel, i, rmValue); setPriceModal(null); }} />}
      {blockWizard && <BlockWizard units={units} initial={blockPrefill} onClose={() => setBlockWizard(false)}
        onSave={v => {
          const clash = conflictFor(v.unitId, v.from, v.to);
          if (clash) { toast({ tone: 'critical', title: 'Dates unavailable.', body: `${clash.guestName} already holds ${dateRange(clash.checkIn, clash.checkOut)} on this unit.` }); return; }
          api.post<{ effects?: { channel: ChannelSync } }>('/blocks', { unitId: v.unitId, from: v.from, to: v.to, reason: v.reason })
            .then(res => { setBlockWizard(false); toast({ tone: 'success', title: 'Dates blocked.', body: `${dateRange(v.from, v.to)}. ${channelNote(res?.effects?.channel, 'held')}`.trim() }); reload(); })
            .catch(e => toast({ tone: 'critical', title: 'Dates not blocked.', body: e instanceof Error ? e.message : 'Try again in a moment.' }));
        }} />}
      {rateUpdate && <RateUpdate units={units} initial={rateUpdate} onClose={() => setRateUpdate(false)}
        onSave={v => {
          api.post('/rates/bulk', {
            unitIds: v.unitIds, channels: v.channels,
            lines: v.lines.map(l => ({
              from: l.from, to: l.to,
              ...(l.priceSen !== undefined ? { baseRate: l.priceSen } : {}),
              ...(l.minStay !== undefined ? { minStay: l.minStay } : {}),
              ...(l.stopSell !== undefined ? { stopSell: l.stopSell } : {}),
            })),
          })
            .then(() => {
              setRateUpdate(false);
              const ranges = v.lines.length === 1 ? dateRange(v.lines[0].from, v.lines[0].to) : `${v.lines.length} date ranges`;
              toast({ tone: 'success', title: 'Saved.', body: `${v.unitIds.length} ${v.unitIds.length === 1 ? 'unit' : 'units'} · ${ranges}.` });
              reload();
            })
            .catch(notifyFailure);
        }} />}
    </>
  );
}

/** Below the shell's phone breakpoint. Read synchronously on first render so nothing shifts after mount. */
const PHONE_QUERY = '(max-width: 767.98px)';
function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/** A building's row on the board: fold toggle on the left, and for each night how many of its units are
 *  still free, so a folded building still says where there is room. */
function BuildingRowHeader({ name, units, folded, showToggle, onToggle, days, byUnit, dayIso }: {
  name: string; units: Unit[]; folded: boolean; showToggle: boolean; onToggle: () => void;
  days: Date[]; byUnit: Map<string, { cells: (Block | null)[] }>; dayIso: (i: number) => string;
}) {
  const n = units.length;
  const freeOn = (i: number) => units.reduce((k, u) => k + (byUnit.get(u.id)?.cells[i] ? 0 : 1), 0);
  return (
    <div className="relative z-[1] flex bg-page/85 [border-bottom:1px_solid_var(--color-line)]">
      <div className={`${STICKY_COL} bg-page! z-10 flex`}>
        <button type="button" onClick={onToggle} disabled={!showToggle} aria-expanded={!folded}
          title={`${name} · ${n} ${n === 1 ? 'unit' : 'units'}${showToggle ? (folded ? ' · show its units' : ' · fold it away') : ''}`}
          className="flex-1 min-w-0 flex items-center gap-1 pl-1.5 pr-2 md:pr-3 h-9 m-0 border-none bg-transparent enabled:hover:bg-muted/60 enabled:cursor-pointer text-left font-sans text-ink">
          {showToggle && <span className="w-5 h-5 flex-none grid place-items-center text-muted-ink"><Icon name={folded ? 'ChevronRight' : 'ChevronDown'} size="sm" /></span>}
          <span className="min-w-0 flex-1 text-[12px] md:text-[12.5px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{name}</span>
          <span className="flex-none text-[11px] font-medium text-muted-ink [font-variant-numeric:tabular-nums]">{n}</span>
        </button>
      </div>
      {days.map((_, i) => {
        const free = freeOn(i);
        return (
          <div key={i} style={{ width: COL }} title={`${name} · ${date(dayIso(i))} · ${free} of ${n} ${n === 1 ? 'unit' : 'units'} free`}
            className={`flex-none box-border h-9 pr-2 flex items-center justify-end text-[11px] whitespace-nowrap [font-variant-numeric:tabular-nums] ${free === 0 ? 'text-faint' : 'text-muted-ink font-medium'}`}>
            {free === 0 ? 'Full' : `${free} free`}
          </div>
        );
      })}
    </div>
  );
}

/** A secondary row under a unit: sticky label on the left, one cell per night. */
function SubRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex [border-top:1px_solid_var(--color-line-soft)]">
      <div className={`${STICKY_COL} z-10 pl-2 md:pl-[38px] pr-2 md:pr-3 h-10 md:h-8 flex items-center gap-1.5 md:gap-2 text-[12px] text-muted-ink min-w-0`}>{label}</div>
      {children}
    </div>
  );
}
