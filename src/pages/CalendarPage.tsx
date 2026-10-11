import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { EmptyState, SkeletonRows } from '../components/States';
import { usePhone } from './finance/listKit';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { ConfirmDialog, type ConfirmSpec } from '../components/ConfirmDialog';
import { BookingDrawer } from '../components/booking/BookingDrawer';
import { channelNote, type ChannelSync } from '../lib/bookingStatus';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { api, notifyFailure, errorMessage } from '../lib/api';
import { todayMyt, rm, date, dateRange, dateShort, dateTime, time, timeWithZone, monthLabel, weekdayDay, year, plural, rmShort, amount } from '../lib/format';
import { CHANNEL, TONE } from '../lib/vocabulary';
import type { BookingChannel, Tone } from '../lib/types';
import { CalendarFilters } from '../components/calendar/CalendarFilters';
import { BlockWizard, RateUpdate, SetPriceModal, type BlockKind } from '../components/calendar/CalendarModals';
import { SelectionPopover, type NightSelection } from '../components/calendar/SelectionPopover';
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
interface Payload {
  from: string; to: string; buildings?: BuildingRow[]; units: Unit[]; blocks: Block[];
  baseRate: Record<string, number>;
  /** The web price of a Friday or Saturday night; null or missing: the base rate. */
  weekendRate?: Record<string, number | null>;
  rates?: Record<string, number>;
  /** Each booking site's uplift on a weekday night, and on a weekend night (a default uplift is a share of the night's web price). */
  uplifts?: Record<string, number>; weekendUplifts?: Record<string, number>;
  savedUplifts?: Record<string, number>; upliftShares?: Record<string, number>;
  restrictions?: Record<string, { minStay: number; stopSell: boolean }>;
  /** Whether this person may change prices. Missing (an older backend): assume yes and let the server refuse. */
  canSetRates?: boolean;
  generatedAt: string;
}

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
/** Fri and Sat nights: the nights a unit's weekend rate applies to. */
const isWeekendNight = (d: Date) => d.getUTCDay() === 5 || d.getUTCDay() === 6;

// Dev-only sample board (useApi drops it in a real build), laid out around today so the today column shows.
const T = (n: number) => todayMyt(n);
const FALLBACK: Payload = {
  from: T(0), to: T(SPAN - 1), generatedAt: '',
  baseRate: { u1: 28800, u2: 23100, u3: 31800, u4: 26500, u5: 24200, u6: 22800 },
  weekendRate: { u1: 35100, u2: 28200, u3: null, u4: 32300, u5: null, u6: 27800 },
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
    { id: 'b9', unitId: 'u5', channel: 'airbnb', state: 'inquiry', guestName: 'Tan Wei', checkIn: T(3), checkOut: T(5), grossBookingValue: 0, ref: null, reason: null },
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
  // Prices set on the board before the reload brings them back, keyed `${unitId}:${channel}:${date}`: by date, not
  // by column, so they stay on their night when the board pages to another 30 days.
  const [rateEdits, setRateEdits] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<ConfirmSpec | null>(null);
  const [priceModal, setPriceModal] = useState<null | { unit: Unit; channel: string; dayIso: string; current: number }>(null);
  const [blockWizard, setBlockWizard] = useState(false);
  const [blockPrefill, setBlockPrefill] = useState<{ unitId?: string; from?: string; to?: string; kind?: BlockKind }>({});
  const [rateBusy, setRateBusy] = useState(false);
  // Nights being picked on one unit (a to b, column indexes, either order), the popover for a finished pick, and on
  // phones the first tapped night while waiting for the last.
  const [picked, setPicked] = useState<{ unitId: string; a: number; b: number } | null>(null);
  const [popover, setPopover] = useState<NightSelection | null>(null);
  const [tapStart, setTapStart] = useState<{ unitId: string; i: number } | null>(null);
  const dragSel = useRef(false);
  const suppressClick = useRef(false);
  const lastPointer = useRef<string>('mouse');
  // A booking-site bar that was refused a drag: the click that follows the attempt must not open its drawer.
  const refusedDrag = useRef(false);
  const [rateUpdate, setRateUpdate] = useState<false | { unitIds?: string[]; from?: string; to?: string }>(false);
  const [openBlock, setOpenBlock] = useState<Block | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Optimistic overlays, rolled back if the API refuses.
  const [dateEdits, setDateEdits] = useState<Record<string, { checkIn: string; checkOut: string }>>({});
  // Which booking is being dragged, and which of its nights the pointer grabbed.
  const dragRef = useRef<{ id: string; grabOffset: number } | null>(null);

  const allUnits = useMemo(() => data?.units ?? [], [data]);
  // With a building picked the board loads only that building, but Rate update offers every unit: it reads the
  // whole list (one night, no building) when it opens.
  const everyUnit = useApi<Payload>(rateUpdate && property !== 'all' ? `/reservations/calendar?from=${from}&to=${from}` : null);
  const rateSource = property === 'all' ? data : everyUnit.data ?? data;
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
  // Who holds each night, from every booking whatever the filters show: filters only hide bars, so a night taken
  // by a hidden booking still reads as taken. Inquiries hold nothing.
  const holding = useMemo(() => liveBlocks.filter(b => !['cancelled', 'no_show', 'inquiry'].includes(b.state)), [liveBlocks]);
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
    const label = monthLabel(iso(d), { long: true });
    if (acc.length && acc[acc.length - 1].label === label) acc[acc.length - 1].count++;
    else acc.push({ label, count: 1 });
    return acc;
  }, []);
  const colBg = (i: number) => (i === todayIdx ? BG_TODAY : isWeekendNight(days[i]) ? BG_WEEKEND : 'bg-card');
  const todayEdge = (i: number) => (i === todayIdx ? TODAY_EDGES : '');

  const buildingCount = properties.length;
  // Per unit: the bars the filters show, and which booking holds each night of the window (from every booking,
  // not just the shown ones). Worked out once per change, not once per row per render.
  const byUnit = useMemo(() => {
    const m = new Map<string, { bars: Block[]; cells: (Block | null)[] }>();
    for (const u of units) m.set(u.id, { bars: [], cells: Array(span).fill(null) });
    for (const b of blocks) m.get(b.unitId)?.bars.push(b);
    for (const b of holding) {
      const row = m.get(b.unitId);
      if (!row) continue;
      for (let i = Math.max(0, dayIndex(b.checkIn)); i < Math.min(span, dayIndex(b.checkOut)); i++) row.cells[i] = b;
    }
    return m;
  }, [units, blocks, holding, data?.from]); // eslint-disable-line react-hooks/exhaustive-deps
  const canSetRates = data?.canSetRates !== false;
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

  /** A unit's web price on a weekday and on a Friday or Saturday night. */
  const webRates = (unitId: string) => {
    const base = data?.baseRate[unitId] ?? 0;
    return { base, weekend: data?.weekendRate?.[unitId] ?? base };
  };
  function rateFor(unitId: string, channel: string, i: number) {
    const key = `${unitId}:${channel}:${dayIso(i)}`;
    if (rateEdits[key] != null) return rateEdits[key];
    const saved = data?.rates?.[key];
    if (saved != null) return saved;
    // Same rule as the Pricing page and Channex (functions/_lib/channelPrice.ts): the night's web price (the
    // weekend rate on Fri/Sat) plus the channel's uplift on that night.
    const weekend = isWeekendNight(addDays(gridStart, i));
    const web = weekend ? webRates(unitId).weekend : webRates(unitId).base;
    if (channel === 'web') return web;
    return web + ((weekend ? data?.weekendUplifts : data?.uplifts)?.[`${unitId}:${channel}`] ?? data?.uplifts?.[`${unitId}:${channel}`] ?? 0);
  }
  function setPrice(unitId: string, channel: string, i: number, rmValue: number) {
    const key = `${unitId}:${channel}:${dayIso(i)}`;
    const prev = rateEdits[key];
    setRateEdits(e => ({ ...e, [key]: Math.round(rmValue * 100) }));
    api.put('/rates', { unitId, channel, date: dayIso(i), rate: Math.round(rmValue * 100) })
      .then(() => toast({ tone: 'success', title: 'Rate set.', body: 'Saved for that night and sent to the channel if the unit is linked.' }))
      .catch(err => { setRateEdits(e => { const n = { ...e }; if (prev == null) delete n[key]; else n[key] = prev; return n; }); notifyFailure(err); });
  }

  /** Nights a..b (either order) of a unit were picked: open the Book / Block / Change price card at (x, y). */
  function openPick(unit: Unit, a: number, b: number, x: number, y: number) {
    const lo = Math.max(0, Math.min(a, b)), hi = Math.min(span - 1, Math.max(a, b));
    const cells = byUnit.get(unit.id)?.cells ?? [];
    const taken = cells.slice(lo, hi + 1).filter(Boolean) as Block[];
    setPicked({ unitId: unit.id, a: lo, b: hi });
    setTapStart(null);
    setPopover({
      unitId: unit.id, unitNumber: unit.unitNumber, first: dayIso(lo), last: dayIso(hi), nights: hi - lo + 1,
      taken: taken.length, takenBy: taken[0] ? (taken[0].guestName || CHANNEL[taken[0].channel].label) : null,
      priceNow: rateFor(unit.id, 'web', lo), x, y,
    });
  }
  function closePick() { setPopover(null); setPicked(null); setTapStart(null); }
  /** The night column under the pointer on a unit's track. */
  const nightAt = (e: { clientX: number; currentTarget: Element }) => Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / COL);

  /** An existing booking/block on the same unit that overlaps [ci, co). Inquiries hold nothing. */
  function conflictFor(unitId: string, ci: string, co: string, excludeId?: string) {
    return holding.find(o =>
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
          toast({ tone: 'critical', title: 'Booking not moved.', body: errorMessage(e, 'Try again in a moment.') });
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
    // With no booking site linked there is nothing to pull: refresh the board instead of asking Channex and failing.
    if (integrations && !otaRows.some(r => r.state !== 'not_connected')) {
      reload(); reloadIntegrations();
      toast({ tone: 'info', title: 'Calendar refreshed.', body: 'No booking site is linked yet, so there is nothing to pull from Airbnb, Booking.com or Agoda.' });
      return;
    }
    setSyncing(true);
    try {
      const res = await api.post<{ bookings?: { processed: number } }>('/integrations/sync');
      const n = res?.bookings?.processed ?? 0;
      toast({ tone: 'success', title: 'Channels synced.', body: n ? `${plural(n, 'booking update')} pulled from Channex.` : 'Nothing new from Channex.' });
      reload(); reloadIntegrations();
    } catch (e) {
      toast({ tone: 'critical', title: 'Channels were not synced.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setSyncing(false);
    }
  }

  const segBtn = 'h-full min-w-10 md:min-w-0 px-2.5 grid place-items-center bg-transparent hover:bg-muted border-none cursor-pointer font-sans text-copy text-ink';
  // Phones drop the year: the month header right under it already says it.
  const rangeShort = `${dateShort(iso(start))} – ${dateShort(iso(addDays(start, span - 1)))}`;
  const rangeYear = year(iso(addDays(start, span - 1)));
  // View toggles: icon-only 40px squares on phones; icon and label from md up.
  const toolBtn = 'relative inline-flex items-center justify-center gap-1.5 h-[42px] w-[42px] md:w-auto md:h-9 md:px-3 box-border rounded-control border border-solid border-line bg-card hover:bg-muted cursor-pointer font-sans text-copy font-medium text-ink whitespace-nowrap flex-none disabled:cursor-default';
  const refreshIcon = <span className={`inline-grid ${syncing ? 'animate-spin' : ''}`}><Icon name="RefreshCw" size="sm" /></span>;

  return (
    <>
      <PageHeader
        title="Calendar"
        sub={data ? `${plural(totalUnits, 'unit')} · ${plural(buildingCount, 'building')}` : 'Loading units…'}
        actions={phone ? (
          // Phones: icon-only 42px squares, each with its own label for screen readers.
          <div className="flex items-center gap-2">
            {canSetRates && <button type="button" className={toolBtn} onClick={() => setRateUpdate({})} aria-label="Rate update" title="Rate update"><Icon name="Tag" size="sm" /></button>}
            <button type="button" className={toolBtn} onClick={() => { setBlockPrefill({}); setBlockWizard(true); }} aria-label="Block dates" title="Block dates"><Icon name="Ban" size="sm" /></button>
            <button type="button" className={toolBtn} onClick={refresh} disabled={syncing} aria-label="Refresh" title="Pull new bookings from the channels">{refreshIcon}</button>
          </div>
        ) : (
          <>
            {canSetRates && <Button size="sm" variant="secondary" icon={<Icon name="Tag" size="sm" />} onClick={() => setRateUpdate({})}>Rate update</Button>}
            <Button size="sm" variant="secondary" icon={<Icon name="Ban" size="sm" />} onClick={() => { setBlockPrefill({}); setBlockWizard(true); }} title="Block dates">Block dates</Button>
            <Button size="sm" variant="secondary" icon={refreshIcon} onClick={refresh} disabled={syncing} disabledReason="Pulling new bookings from the channels" title="Pull new bookings from the channels">Refresh</Button>
          </>
        )}
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
              <span className="flex-1 md:flex-none min-w-0 px-1.5 md:px-3 grid place-items-center [border-left:1px_solid_var(--color-line)] [border-right:1px_solid_var(--color-line)] text-copy font-medium whitespace-nowrap [font-variant-numeric:tabular-nums] md:min-w-[156px]">
                <span>{rangeShort}<span className="hidden md:inline"> {rangeYear}</span></span>
              </span>
              <button type="button" onClick={() => setWeekOffset(w => w + 1)} className={segBtn} aria-label="Next 30 days"><Icon name="ChevronRight" size="sm" /></button>
              <button type="button" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}
                className={`${segBtn} [border-left:1px_solid_var(--color-line)]! px-3 font-medium disabled:text-faint disabled:cursor-default disabled:hover:bg-transparent`}>Today</button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {lastSync && (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-meta text-muted-ink whitespace-nowrap" title={`Last update sent to Channex ${dateTime(lastSync)}`}>
                  <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: TONE[syncTrouble ? 'warning' : 'success'].line }} />
                  {syncTrouble
                    ? <a href="#/system/integrations" className="no-underline" style={{ color: TONE.warning.fg }}>Channel errors · see Integrations</a>
                    : <>Channels updated {iso(new Date(lastSync)) === todayMyt() ? timeWithZone(lastSync) : `${dateShort(lastSync)} ${time(lastSync)}`}</>}
                </span>
              )}
              <button type="button" onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen} aria-label={filterCount ? `Filters, ${filterCount} on` : 'Filters'} title="Filters"
                className={`${toolBtn} md:hidden ${filtersOpen ? 'bg-muted!' : ''}`}>
                <Icon name="SlidersHorizontal" size="sm" />
                {filterCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 box-border rounded-full bg-black text-white text-caption grid place-items-center">{filterCount}</span>}
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
            <CalendarFilters channels={filterChannels} properties={properties} counted={!!data} property={property} setProperty={setProperty}
              off={off} setOff={setOff} statusOff={statusOff} setStatusOff={setStatusOff} dirty={filtersDirty}
              onReset={() => { setOff({}); setStatusOff({}); setProperty('all'); }} />
            {(offCount > 0 || Object.values(statusOff).some(Boolean)) && (
              <p className="m-0 mt-2 text-meta text-muted-ink">Filters only hide booking bars. Free and Full always count every booking.</p>
            )}
          </div>
        </div>

        {/* Grid: scrolls inside the card both ways; the date header and unit column stay put. */}
        <div className="max-h-[72vh] overflow-auto overscroll-x-contain rounded-none md:rounded-b-card [scrollbar-width:thin] [--unit-col:104px] md:[--unit-col:224px]">
          <div style={{ minWidth: `calc(var(--unit-col) + ${span * COL}px)` }} aria-busy={loading}
            className={`transition-opacity duration-150 ${loading && data ? 'opacity-70' : ''}`}>
            <div className="sticky top-0 z-20 flex bg-muted [border-bottom:1px_solid_var(--color-line)]">
              <div className={`${STICKY_COL} bg-muted! z-30 flex items-end px-2 md:px-3 pb-2.5 text-meta font-semibold text-muted-ink whitespace-nowrap`}>
                {data ? plural(units.length, 'unit') : ''}
              </div>
              <div className="flex flex-col">
                <div className="flex h-7">
                  {months.map((m, k) => (
                    <div key={m.label} className={`flex-none box-border flex items-center ${k ? '[border-left:1px_solid_var(--color-line)]' : ''}`} style={{ width: m.count * COL }}>
                      <span className="sticky left-[calc(var(--unit-col)+10px)] px-2.5 text-meta font-semibold text-ink whitespace-nowrap">{m.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex">
                  {days.map((d, i) => {
                    const isToday = i === todayIdx;
                    return (
                      <div key={i} className={`flex-none box-border h-11 flex flex-col items-center justify-center gap-0.5 ${CELL_EDGE} ${i === todayIdx ? BG_TODAY : isWeekendNight(d) ? 'bg-sunken' : 'bg-muted'} ${todayEdge(i)}`} style={{ width: COL }}
                        title={isToday ? 'Today' : undefined}>
                        <span className={`text-caption font-medium ${isToday ? 'font-semibold text-[var(--color-text-accent)]' : 'text-muted-ink'}`}>{weekdayDay(iso(d)).split(' ')[0]}</span>
                        <span className={`text-copy font-semibold leading-none grid place-items-center ${isToday ? 'w-6 h-6 rounded-full bg-gold text-black' : 'h-6 text-ink'}`}>{d.getUTCDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {units.length === 0 && (
              // Pinned to the visible part of the wide grid so it does not centre on the 30-night track.
              <div className="sticky left-0 w-[min(100%,calc(100vw-2rem))] md:w-[min(100%,720px)]">
                {loading ? <div className="p-4"><SkeletonRows rows={4} height={64} /></div>
                  : filtersDirty
                    ? <EmptyState bare kind="filtered" title="No units match these filters." action={{ label: 'Clear filters', onClick: () => { setOff({}); setStatusOff({}); setProperty('all'); } }} />
                    : <EmptyState bare icon="CalendarDays" title="No units on the board yet." body="Units appear here once they are added under Properties." action={{ label: 'Open units', onClick: () => { window.location.hash = '#/properties/units'; } }} />}
              </div>
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
                              <span className="flex items-center gap-[5px] min-w-0">
                                {readiness && <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: readiness.dot }} title={readiness.label} aria-label={readiness.label} />}
                                <span className="text-copy font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.unitNumber}</span>
                              </span>
                              {/* The building is the group header above, so the lines under the number are its prices. */}
                              {(() => {
                                const w = webRates(u.id);
                                if (w.base <= 0) return <span className="text-caption text-faint whitespace-nowrap">No rate set</span>;
                                return (
                                  <>
                                    <span className="hidden md:block text-caption text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis [font-variant-numeric:tabular-nums]">
                                      Web {rmShort(w.base)}{w.weekend !== w.base ? ` · Weekend ${rmShort(w.weekend)}` : ''}
                                    </span>
                                    <span className="md:hidden text-caption text-muted-ink whitespace-nowrap [font-variant-numeric:tabular-nums]">Web {rmShort(w.base)}</span>
                                    {w.weekend !== w.base && <span className="md:hidden text-caption text-muted-ink whitespace-nowrap [font-variant-numeric:tabular-nums]">Wknd {rmShort(w.weekend)}</span>}
                                  </>
                                );
                              })()}
                            </span>
                          </button>
                        </div>
    
                        {/* One track per unit instead of 30 cells: the night under the pointer is worked out from where
                            it is. The column shading comes from the layer behind the rows. */}
                        <div className="group relative flex-none h-16 cursor-pointer" style={{ width: span * COL }}
                          aria-label={`${u.unitNumber} nights`}
                          onPointerDown={e => {
                            lastPointer.current = e.pointerType;
                            if (e.button !== 0 || phone || e.pointerType === 'touch') return;
                            const i = nightAt(e);
                            if (i < 0 || cells[i]) return;
                            e.preventDefault();
                            setPopover(null); setTapStart(null);
                            setPicked({ unitId: u.id, a: i, b: i });
                            dragSel.current = true;
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                          onPointerMove={e => {
                            const r = e.currentTarget.getBoundingClientRect();
                            e.currentTarget.style.setProperty('--hx', `${Math.floor((e.clientX - r.left) / COL) * COL}px`);
                            if (!dragSel.current) return;
                            const i = Math.max(0, Math.min(span - 1, nightAt(e)));
                            setPicked(p => (p && p.unitId === u.id && p.b !== i ? { ...p, b: i } : p));
                          }}
                          onPointerUp={e => {
                            if (!dragSel.current) return;
                            dragSel.current = false; suppressClick.current = true;
                            const i = Math.max(0, Math.min(span - 1, nightAt(e)));
                            const a = picked?.unitId === u.id ? picked.a : i;
                            openPick(u, a, i, e.clientX, e.clientY);
                          }}
                          onPointerCancel={() => { dragSel.current = false; setPicked(null); }}
                          onClick={e => {
                            if (suppressClick.current) { suppressClick.current = false; return; }
                            const i = nightAt(e);
                            if (i < 0 || i >= span) return;
                            const tapMode = phone || lastPointer.current === 'touch';
                            if (!tapMode) { if (cells[i]) setOpenBlock(cells[i]); return; }
                            // Phones: the first tap marks the first night, the second the last.
                            if (tapStart && tapStart.unitId === u.id) { openPick(u, tapStart.i, i, e.clientX, e.clientY); return; }
                            if (cells[i]) { setOpenBlock(cells[i]); return; }
                            setPopover(null);
                            setTapStart({ unitId: u.id, i });
                            setPicked({ unitId: u.id, a: i, b: i });
                          }}
                          onDragOver={e => { if (dragRef.current) e.preventDefault(); }}
                          onDrop={e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); dropOnDay(u.id, Math.floor((e.clientX - r.left) / COL)); }}>
                          <div aria-hidden className="absolute top-0 bottom-0 hidden group-hover:block bg-sunken/80 pointer-events-none" style={{ left: 'var(--hx, -100px)', width: COL }} />
                          {picked?.unitId === u.id && (() => {
                            const lo = Math.min(picked.a, picked.b), hi = Math.max(picked.a, picked.b), n = hi - lo + 1;
                            return (
                              <div aria-hidden className="absolute top-2.5 bottom-2.5 z-[3] box-border rounded-[8px] border-2 border-solid border-gold bg-gold-tint/80 grid place-items-center pointer-events-none text-meta font-semibold text-[var(--color-text-accent)] whitespace-nowrap overflow-hidden"
                                style={{ left: lo * COL + 2, width: n * COL - 4 }}>
                                {n * COL > 190 ? `${n === 1 ? dateShort(dayIso(lo)) : `${dateShort(dayIso(lo))} – ${dateShort(dayIso(hi))}`} · ${plural(n, 'night')}` : n * COL > 80 ? plural(n, 'night') : n}
                              </div>
                            );
                          })()}
                          {unitBlocks.map(b => {
                            const ci = dayIndex(b.checkIn), co = dayIndex(b.checkOut);
                            const s = Math.max(0, ci), e = Math.min(span, co);
                            if (e <= s) return null;
                            const ch = CHANNEL[b.channel]; const hold = ch.border !== 'solid';
                            const inquiry = b.state === 'inquiry';
                            const ota = OTA_CHANNELS.includes(b.channel);
                            const movable = !inquiry && !ota;
                            const clipL = ci < 0, clipR = co > span;
                            const inset = 3;
                            const left = s * COL + (clipL ? 0 : inset), width = (e - s) * COL - (clipL ? 0 : inset) - (clipR ? 0 : inset);
                            const r = (on: boolean) => (on ? 0 : 8);
                            const fullName = inquiry ? `Inquiry · not holding${b.guestName ? ` · ${b.guestName}` : ''}`
                              : b.guestName || (b.channel === 'owner_stay' ? 'Owner stay' : b.channel === 'maintenance_block' ? (b.blockReason === 'other' ? 'Blocked' : 'Maintenance') : ch.label);
                            const firstName = fullName.split(' ')[0];
                            // A one-night bar is too narrow for logo and name side by side, so they stack.
                            const narrow = width < 100;
                            return (
                              <div key={b.id} draggable={!inquiry} onClick={e => { e.stopPropagation(); if (refusedDrag.current) { refusedDrag.current = false; return; } setOpenBlock(b); }}
                                onPointerDown={e => e.stopPropagation()}
                                title={`${fullName} · ${ch.label}${b.ref ? ' · ' + b.ref : ''} · ${dateRange(b.checkIn, b.checkOut)}${b.reason ? ' · ' + b.reason : ''}${movable ? ' · drag to move' : ota ? ` · dates change on ${ch.label}` : ''}`}
                                onDragStart={ev => {
                                  if (!movable) {
                                    // A booking site owns its booking's dates: moving it here would leave the site on the old ones.
                                    ev.preventDefault();
                                    refusedDrag.current = true;
                                    window.setTimeout(() => { refusedDrag.current = false; }, 400);
                                    if (ota) toast({ tone: 'info', title: `Change dates on ${ch.label}.`, body: `This booking came from ${ch.label}. Change its dates there; the new dates come back here on the next sync.` });
                                    return;
                                  }
                                  ev.dataTransfer.effectAllowed = 'move';
                                  const rect = ev.currentTarget.getBoundingClientRect();
                                  dragRef.current = { id: b.id, grabOffset: (s - ci) + Math.max(0, Math.floor((ev.clientX - rect.left) / COL)) };
                                }}
                                onDragEnd={() => { dragRef.current = null; }}
                                className={`absolute top-2.5 bottom-2.5 z-[2] box-border flex overflow-hidden ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} select-none hover:brightness-[0.98] ${narrow ? 'flex-col justify-center items-start gap-0.5 px-1.5' : 'items-center gap-1.5 px-2'}`}
                                style={inquiry ? {
                                  // An inquiry holds nothing: an outline only, so the night still reads as open.
                                  left, width, color: 'var(--color-text-muted)', background: 'transparent',
                                  border: '1px dashed var(--color-line-strong)',
                                  borderRadius: `${r(clipL)}px ${r(clipR)}px ${r(clipR)}px ${r(clipL)}px`,
                                } : {
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
                                  ? <span className="max-w-full text-caption leading-[13px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{firstName}</span>
                                  : <span className="min-w-0 flex flex-col">
                                      <span className="md:hidden text-meta leading-[14px] font-semibold [overflow-wrap:anywhere] line-clamp-2">{fullName}</span>
                                      <span className="hidden md:[display:-webkit-box] text-meta leading-[14px] font-semibold [overflow-wrap:anywhere] line-clamp-2">{fullName}</span>
                                      {b.grossBookingValue > 0 && width > 150 && (
                                        <span className="hidden md:block text-caption leading-[13px] whitespace-nowrap opacity-75 [font-variant-numeric:tabular-nums]">{rm(b.grossBookingValue, { cents: false })}</span>
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
                                <button key={i} type="button" disabled={!canSetRates} onClick={() => setRateUpdate({ unitIds: [u.id], from: dayIso(i), to: dayIso(i) })}
                                  title={`${left ? '1 of 1 unit available' : 'Sold'} · ${restriction}${canSetRates ? ' · click to change' : ''}`}
                                  style={{ width: COL }}
                                  className={`flex-none box-border h-10 md:h-8 p-0 pl-1 border-none bg-transparent enabled:hover:bg-sunken/80 enabled:cursor-pointer disabled:cursor-default font-sans text-meta whitespace-nowrap flex items-center justify-end gap-0.5 [font-variant-numeric:tabular-nums] ${minStay && !rs?.stopSell ? 'pr-1.5' : 'pr-2'} ${left ? 'text-ink-2' : 'text-faint'}`}>
                                  {rs?.stopSell
                                    ? <span className="px-1 rounded-[4px] text-caption font-semibold leading-[16px]" style={{ background: TONE.critical.bg, color: TONE.critical.fg }}>Closed</span>
                                    : <>
                                        {minStay > 0 && <span className="mr-auto px-[3px] rounded-[4px] text-caption font-semibold leading-[16px] bg-muted text-ink">{minStay}n</span>}
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
                                    <span className="hidden md:inline-block text-caption font-semibold px-1.5 rounded-full leading-[17px] whitespace-nowrap"
                                      style={{ background: TONE[chip.tone].bg, color: TONE[chip.tone].fg }}
                                      title={sync?.lastSyncedAt ? `Last update sent ${dateTime(sync.lastSyncedAt)}` : undefined}>{chip.label}</span>
                                  )}
                                  <span className="hidden md:inline ml-auto text-caption font-medium text-faint">RM</span>
                                </>
                              }>
                                {days.map((_, i) => {
                                  const price = rateFor(u.id, r.key, i);
                                  const custom = rateEdits[`${u.id}:${r.key}:${dayIso(i)}`] != null || data?.rates?.[`${u.id}:${r.key}:${dayIso(i)}`] != null;
                                  // No price to show: the unit has no base rate yet, or the site is not linked and nothing was set by hand.
                                  const none = !custom && (price <= 0 || unlinked);
                                  return (
                                    <button key={i} type="button" disabled={!canSetRates} onClick={() => setPriceModal({ unit: u, channel: r.key, dayIso: dayIso(i), current: price })}
                                      title={`${r.label} · ${date(dayIso(i))} · ${none ? (unlinked ? `not linked to ${r.label}, so no price is sent` : 'no rate set') : rmShort(price)}${custom ? ' · set by hand' : ''}${canSetRates ? ' · click to set' : ''}`}
                                      style={{ width: COL }}
                                      className={`flex-none box-border h-10 md:h-8 p-0 pr-2 border-none bg-transparent enabled:hover:bg-sunken/80 enabled:cursor-pointer disabled:cursor-default font-sans text-meta text-right [font-variant-numeric:tabular-nums] ${none ? 'text-faint' : custom ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                                      {none ? '—' : amount(price, { cents: false })}
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

      <ConfirmDialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
      {priceModal && <SetPriceModal m={priceModal} onClose={() => setPriceModal(null)}
        onSave={rmValue => { const i = dayIndex(priceModal.dayIso); setPrice(priceModal.unit.id, priceModal.channel, i, rmValue); setPriceModal(null); }} />}
      {popover && (() => {
        const u = allUnits.find(x => x.id === popover.unitId);
        if (!u) return null;
        const checkOut = iso(addDays(new Date(popover.last), 1));
        return (
          <SelectionPopover sel={popover} phone={phone} canSetRates={canSetRates} onClose={closePick}
            onBook={() => { closePick(); window.location.hash = `#/reservations/bookings?create=1&forUnit=${encodeURIComponent(u.id)}&checkIn=${popover.first}&checkOut=${checkOut}`; }}
            onBlock={() => { closePick(); setBlockPrefill({ unitId: u.id, from: popover.first, to: checkOut }); setBlockWizard(true); }}
            onPrice={() => { closePick(); setRateUpdate({ unitIds: [u.id], from: popover.first, to: popover.last }); }} />
        );
      })()}
      {tapStart && !popover && (() => {
        const u = allUnits.find(x => x.id === tapStart.unitId);
        return (
          <div role="status" className="fixed left-3 right-3 bottom-3 z-[55] bg-black text-white rounded-card shadow-[var(--shadow-overlay)] px-4 py-3 flex items-center gap-3">
            <span className="flex-1 min-w-0 text-copy">{u?.unitNumber} · from {dateShort(dayIso(tapStart.i))}. Tap the last night.</span>
            <button type="button" onClick={() => u && openPick(u, tapStart.i, tapStart.i, window.innerWidth / 2, window.innerHeight - 80)}
              className="flex-none h-9 px-3 rounded-control border border-solid border-white/40 bg-transparent text-white font-sans text-meta font-semibold cursor-pointer">Just this night</button>
            <button type="button" onClick={closePick} aria-label="Cancel picking" className="flex-none w-9 h-9 grid place-items-center rounded-control border-none bg-transparent text-white cursor-pointer"><Icon name="X" size="sm" /></button>
          </div>
        );
      })()}
      {blockWizard && <BlockWizard units={allUnits} initial={blockPrefill} onClose={() => setBlockWizard(false)}
        onSave={v => {
          const clash = conflictFor(v.unitId, v.from, v.to);
          if (clash) { toast({ tone: 'critical', title: 'Dates unavailable.', body: `${clash.guestName || CHANNEL[clash.channel].label} already holds ${dateRange(clash.checkIn, clash.checkOut)} on this unit.` }); return; }
          api.post<{ effects?: { channel: ChannelSync } }>('/blocks', { unitId: v.unitId, from: v.from, to: v.to, kind: v.kind, reason: v.reason })
            .then(res => { setBlockWizard(false); toast({ tone: 'success', title: v.kind === 'owner_stay' ? 'Owner stay added.' : 'Dates blocked.', body: `${dateRange(v.from, v.to)}. ${channelNote(res?.effects?.channel, 'held')}`.trim() }); reload(); })
            .catch(e => toast({ tone: 'critical', title: 'Dates not blocked.', body: errorMessage(e, 'Try again in a moment.') }));
        }} />}
      {rateUpdate && <RateUpdate units={rateSource?.units ?? allUnits} initial={rateUpdate} busy={rateBusy} onClose={() => { if (!rateBusy) setRateUpdate(false); }}
        loadingAll={property !== 'all' && !everyUnit.data} building={property !== 'all' ? property : undefined}
        preselect={!rateUpdate.unitIds && property !== 'all' && units.length <= 12 ? units.map(u => u.id) : undefined}
        pricing={{ baseRate: { ...(rateSource?.baseRate ?? {}), ...(data?.baseRate ?? {}) }, weekendRate: { ...(rateSource?.weekendRate ?? {}), ...(data?.weekendRate ?? {}) }, savedUplifts: { ...(rateSource?.savedUplifts ?? {}), ...(data?.savedUplifts ?? {}) }, upliftShares: data?.upliftShares ?? rateSource?.upliftShares }}
        onSave={v => {
          setRateBusy(true);
          api.post<{ nights?: number; skipped?: Record<string, number>; syncFailed?: number }>('/rates/bulk', v)
            .then(res => {
              setRateUpdate(false);
              const ranges = v.lines.length === 1 ? dateRange(v.lines[0].from, v.lines[0].to) : plural(v.lines.length, 'date range');
              const skipped = Object.entries(res?.skipped ?? {}).map(([c, n]) => `${CHANNEL[c as BookingChannel]?.label ?? c} on ${plural(n, 'unit')}`);
              toast({
                tone: res?.syncFailed ? 'warning' : 'success', title: 'Saved.',
                body: [`${plural(v.unitIds.length, 'unit')} · ${ranges}.`,
                  skipped.length ? `Not connected, left alone: ${skipped.join(', ')}.` : '',
                  res?.syncFailed ? `${plural(res.syncFailed, 'unit')} could not be queued for the booking sites; see System health.` : ''].filter(Boolean).join(' '),
              });
              setRateEdits({});
              reload();
            })
            .catch(notifyFailure)
            .finally(() => setRateBusy(false));
        }} />}
    </>
  );
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
          title={`${name} · ${plural(n, 'unit')}${showToggle ? (folded ? ' · show its units' : ' · fold it away') : ''}`}
          className="flex-1 min-w-0 flex items-center gap-1 pl-1.5 pr-2 md:pr-3 h-9 m-0 border-none bg-transparent enabled:hover:bg-muted/60 enabled:cursor-pointer text-left font-sans text-ink">
          {showToggle && <span className="w-5 h-5 flex-none grid place-items-center text-muted-ink"><Icon name={folded ? 'ChevronRight' : 'ChevronDown'} size="sm" /></span>}
          <span className="min-w-0 flex-1 text-meta font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{name}</span>
          <span className="flex-none text-caption font-medium text-muted-ink [font-variant-numeric:tabular-nums]">{n}</span>
        </button>
      </div>
      {days.map((_, i) => {
        const free = freeOn(i);
        return (
          <div key={i} style={{ width: COL }} title={`${name} · ${date(dayIso(i))} · ${free} of ${plural(n, 'unit')} free`}
            className={`flex-none box-border h-9 pr-2 flex items-center justify-end text-caption whitespace-nowrap [font-variant-numeric:tabular-nums] ${free === 0 ? 'text-faint' : 'text-muted-ink font-medium'}`}>
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
      <div className={`${STICKY_COL} z-10 pl-2 md:pl-[38px] pr-2 md:pr-3 h-10 md:h-8 flex items-center gap-1.5 md:gap-2 text-meta text-muted-ink min-w-0`}>{label}</div>
      {children}
    </div>
  );
}
