import { useMemo, useRef, useState, type ReactNode } from 'react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Dialog, Drawer, type DialogSpec } from '../components/Dialog';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, notifyFailure } from '../lib/api';
import { todayMyt, rm, dateRange, dateShort, dateTime, time, timeWithZone } from '../lib/format';
import { CHANNEL, RESERVATION, TONE } from '../lib/vocabulary';
import type { BookingChannel, ReservationState, Tone } from '../lib/types';
import { CalendarFilters } from '../components/calendar/CalendarFilters';
import { ActivityLog } from '../components/calendar/ActivityLog';
import { BlockWizard, ChangeDatesModal, MessageModal, RateUpdate, SetPriceModal } from '../components/calendar/CalendarModals';
import { selectCls, type CalendarBlock as Block, type CalendarUnit as Unit } from '../components/calendar/types';

/** Width of one night column, px. The unit column width is the CSS variable --unit-col (narrower on phones). */
const COL = 60;
const SPAN = 30;

/** The quick-status picker in the reservation drawer. Cancellation has its own
 *  destructive Cancel flow (confirm + notify), so it is not offered here. */
const QUICK_STATES: ReservationState[] = ['inquiry', 'pending', 'confirmed', 'checked_in', 'checked_out', 'no_show'];

// The rate rows: the web rate plus each channel the unit is linked to (unit_channels / Channex).
// If the payload omits `channels` (the current backend), all three OTAs are shown so nothing is hidden.
// `mark` is the channel whose logo labels the row; the web rate is the direct channel.
const RATE_ROWS: { key: 'web' | BookingChannel; label: string; mark: BookingChannel }[] = [
  { key: 'web', label: 'Web', mark: 'direct' },
  { key: 'airbnb', label: 'Airbnb', mark: 'airbnb' },
  { key: 'booking_com', label: 'Booking.com', mark: 'booking_com' },
  { key: 'agoda', label: 'Agoda', mark: 'agoda' },
];
const RATE_ROW_BY_KEY = Object.fromEntries(RATE_ROWS.map(r => [r.key, r])) as Record<string, typeof RATE_ROWS[number]>;
const OTA_CHANNELS: BookingChannel[] = ['airbnb', 'booking_com', 'agoda'];
const rateRowsFor = (u: Unit) => ['web', ...(u.channels ?? OTA_CHANNELS)].map(k => RATE_ROW_BY_KEY[k]).filter(Boolean);

interface Payload { from: string; to: string; units: Unit[]; blocks: Block[]; baseRate: Record<string, number>; rates?: Record<string, number>; uplifts?: Record<string, number>; weekendMultiplier?: number; restrictions?: Record<string, { minStay: number; stopSell: boolean }>; generatedAt: string }

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
    { id: 'u1', unitNumber: '#C-13-13A', propertyName: 'Agile Bukit Bintang, Imbi', channels: ['airbnb', 'booking_com', 'agoda'] },
    { id: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', channels: ['booking_com'] },
    { id: 'u3', unitNumber: '#MK2-09-16', propertyName: 'Arte Mont Kiara', channels: ['airbnb', 'agoda'] },
    { id: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz', channels: ['airbnb'] },
    { id: 'u5', unitNumber: '#A-21-02', propertyName: 'The Establishment', channels: ['booking_com', 'agoda'] },
    { id: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', channels: ['airbnb', 'booking_com', 'agoda'] },
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
// Buttons carry a UA border; border-none clears it, and the important left edge puts the divider back.
const CELL_EDGE_BTN = '[border-left:1px_solid_var(--color-line-soft)]!';
const STICKY_COL = 'w-[var(--unit-col)] flex-none box-border sticky left-0 bg-card [border-right:1px_solid_var(--color-line)]';

export default function CalendarPage() {
  // Fixed 30-day window; scroll the grid sideways, or jump a window with the arrows.
  const span = SPAN;
  const [weekOffset, setWeekOffset] = useState(0);
  const start = addDays(today, weekOffset * span);
  const from = iso(start), to = iso(addDays(start, span - 1));
  const { data, error, reload } = useApi<Payload>(`/reservations/calendar?from=${from}&to=${to}`, FALLBACK);
  // No fallback on purpose: without the real connection status the page shows no sync claims at all.
  const { data: integrations, reload: reloadIntegrations } = useApi<{ data: IntegrationRow[] }>('/integrations');
  const toast = useToast();

  const [off, setOff] = useState<Partial<Record<BookingChannel, boolean>>>({});
  const [statusOff, setStatusOff] = useState<Record<string, boolean>>({});
  const [property, setProperty] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [unitOpen, setUnitOpen] = useState<Record<string, boolean>>({});
  const [rateEdits, setRateEdits] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [priceModal, setPriceModal] = useState<null | { unit: Unit; channel: string; dayIso: string; current: number }>(null);
  const [blockWizard, setBlockWizard] = useState(false);
  const [blockPrefill, setBlockPrefill] = useState<{ unitId?: string; from?: string; to?: string }>({});
  const [rateUpdate, setRateUpdate] = useState<false | { unitIds?: string[]; from?: string; to?: string }>(false);
  const [openBlock, setOpenBlock] = useState<Block | null>(null);
  const [editDates, setEditDates] = useState<Block | null>(null);
  const [chatBlock, setChatBlock] = useState<Block | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Optimistic overlays, rolled back if the API refuses.
  const [dateEdits, setDateEdits] = useState<Record<string, { checkIn: string; checkOut: string }>>({});
  const [stateEdits, setStateEdits] = useState<Record<string, ReservationState>>({});
  // Which booking is being dragged, and which of its nights the pointer grabbed.
  const dragRef = useRef<{ id: string; grabOffset: number } | null>(null);

  const allUnits = data?.units ?? [];
  const properties = useMemo(() => Array.from(new Set(allUnits.map(u => u.propertyName))), [allUnits]);
  const units = property === 'all' ? allUnits : allUnits.filter(u => u.propertyName === property);
  const liveBlocks = useMemo(
    () => (data?.blocks ?? []).map(b => ({
      ...b, ...dateEdits[b.id], ...(stateEdits[b.id] ? { state: stateEdits[b.id] } : null),
    })),
    [data, dateEdits, stateEdits],
  );
  const blocks = liveBlocks.filter(b => {
    if (b.state === 'cancelled') return false; // a cancelled reservation releases its dates on the board
    if (off[b.channel]) return false;
    if (b.channel === 'maintenance_block') return !statusOff.blocked;
    return !statusOff[b.state];
  });
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
  const filtersDirty = property !== 'all' || Object.values(off).some(Boolean) || Object.values(statusOff).some(Boolean);
  const filterCount = (property !== 'all' ? 1 : 0) + Object.values(off).filter(Boolean).length + Object.values(statusOff).filter(Boolean).length;

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
      title: `${unit.unitNumber} · ${dayIso(i)}`,
      body: 'This night is open. Block it, create a reservation, or set a price.',
      confirmLabel: 'Set price',
      extraActions: [
        { label: 'Block dates', onClick: () => { setDialog(null); setBlockPrefill({ unitId: unit.id, from: dayIso(i), to: dayIso(i + 1) }); setBlockWizard(true); } },
        { label: 'Create reservation', onClick: () => { setDialog(null); window.location.hash = '#/reservations/bookings?create=1'; } },
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
      body: 'Moving the stay re-checks availability, notifies the guest and re-pushes the new dates to every connected channel.',
      meta: `${b.guestName} · ${dateRange(b.checkIn, b.checkOut)} → ${dateRange(newCheckIn, newCheckOut)}`,
      confirmLabel: 'Move booking', busyLabel: 'Moving…',
      onConfirm: async () => {
        setBusy(true);
        setDateEdits(e => ({ ...e, [b.id]: { checkIn: newCheckIn, checkOut: newCheckOut } }));
        try { await api.patch(`/reservations/${b.id}/dates`, { checkIn: newCheckIn, checkOut: newCheckOut, confirm: true }); } catch (e) { notifyFailure(e); }
        setBusy(false); setDialog(null); setOpenBlock(null);
        toast({ tone: 'success', title: 'Booking moved.', body: `${b.guestName} is now ${dateRange(newCheckIn, newCheckOut)}. Guest notified and channels updated.` });
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

  // ---- Reservation drawer: chat with guest (POST /messages) ----
  function sendGuestMessage(b: Block, body: string) {
    const thread = b.channel === 'direct' ? 'WhatsApp' : CHANNEL[b.channel].label;
    api.post('/messages', { reservationId: b.id, body })
      .then(() => { setChatBlock(null); toast({ tone: 'success', title: `Message sent to ${b.guestName}.`, body: `Thread opened on ${thread}.` }); })
      .catch(notifyFailure);
  }

  // ---- Reservation drawer: quick status update (PATCH /reservations/:id); rolled back if refused ----
  function quickStatus(b: Block, state: ReservationState) {
    if (state === (stateEdits[b.id] ?? b.state)) return;
    const prev = stateEdits[b.id];
    setStateEdits(e => ({ ...e, [b.id]: state }));
    api.patch(`/reservations/${b.id}`, { state })
      .then(() => { toast({ tone: 'success', title: 'Status updated.', body: `${b.guestName} is now ${RESERVATION[state].label}.` }); reload(); })
      .catch(err => { setStateEdits(e => { const n = { ...e }; if (prev) n[b.id] = prev; else delete n[b.id]; return n; }); notifyFailure(err); });
  }

  // ---- Reservation drawer: duplicate booking (POST /reservations/:id/duplicate); the copy appears once saved ----
  function duplicateBooking(b: Block) {
    api.post(`/reservations/${b.id}/duplicate`)
      .then(() => {
        setOpenBlock(null);
        toast({ tone: 'success', title: 'Booking duplicated.', body: `A pending copy for ${b.guestName} was placed after the original — drag it to the dates you want.` });
        reload();
      })
      .catch(notifyFailure);
  }

  // ---- Reservation drawer: cancel reservation (POST /reservations/:id/cancel) — optimistic release ----
  function requestCancel(b: Block) {
    setDialog({
      title: `Cancel ${b.ref ?? 'this reservation'}?`,
      body: `This releases the dates on every channel and notifies ${b.guestName}.`,
      meta: `${b.guestName} · ${dateRange(b.checkIn, b.checkOut)}`,
      confirmLabel: 'Cancel reservation', busyLabel: 'Cancelling…', danger: true,
      onConfirm: async () => {
        setBusy(true);
        setStateEdits(e => ({ ...e, [b.id]: 'cancelled' }));
        try { await api.post(`/reservations/${b.id}/cancel`, { reason: 'operator_cancelled' }); } catch (e) { notifyFailure(e); }
        setBusy(false); setDialog(null); setOpenBlock(null);
        toast({ tone: 'neutral', title: 'Reservation cancelled.', body: `${b.guestName} has been notified and the dates released.` });
      },
    });
  }

  const segBtn = 'h-full px-2.5 grid place-items-center bg-transparent hover:bg-muted border-none cursor-pointer font-sans text-[13px] text-ink';
  const rangeLabel = `${utcLabel(start, { day: 'numeric', month: 'short' })} – ${utcLabel(addDays(start, span - 1), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <>
      <PageHeader
        title="Calendar"
        sub={`${allUnits.length} ${allUnits.length === 1 ? 'unit' : 'units'} · ${buildingCount} ${buildingCount === 1 ? 'building' : 'buildings'} · Asia/Kuala Lumpur`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<Icon name="Tag" size="sm" />} onClick={() => setRateUpdate({})}>Rate update</Button>
            <Button size="sm" variant="secondary" icon={<Icon name="Ban" size="sm" />} onClick={() => { setBlockPrefill({}); setBlockWizard(true); }}>Block wizard</Button>
            <Button size="sm" variant="secondary" icon={<Icon name="RefreshCw" size="sm" />} loading={syncing} onClick={refresh}>Refresh</Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}

      {/* Not the shared Card: that clips overflow, which would cut off the status menu. */}
      <div className="flex-none bg-card border border-solid border-line rounded-card shadow-[var(--shadow-card)] min-w-0">
        {/* Toolbar + filters */}
        <div className="px-3 sm:px-4 py-3 flex flex-col gap-3 [border-bottom:1px_solid_var(--color-line)]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex sm:inline-flex w-full sm:w-auto items-stretch h-9 box-border rounded-control border border-solid border-line bg-card overflow-hidden">
              <button type="button" onClick={() => setWeekOffset(w => w - 1)} className={segBtn} aria-label="Previous 30 days"><Icon name="ChevronLeft" size="sm" /></button>
              <span className="flex-1 sm:flex-none px-2 sm:px-3 grid place-items-center [border-left:1px_solid_var(--color-line)] [border-right:1px_solid_var(--color-line)] text-[13px] font-medium whitespace-nowrap [font-variant-numeric:tabular-nums] sm:min-w-[156px]">{rangeLabel}</span>
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
              <button type="button" onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen}
                className="md:hidden inline-flex items-center gap-1.5 h-9 px-3 box-border rounded-control border border-solid border-line bg-card cursor-pointer font-sans text-[13px] font-medium text-ink">
                <Icon name="SlidersHorizontal" size="sm" />Filters{filterCount > 0 && <span className="min-w-[18px] h-[18px] px-1 box-border rounded-full bg-black text-white text-[11px] grid place-items-center">{filterCount}</span>}
              </button>
              <Button size="sm" variant="secondary" icon={<Icon name={expanded ? 'ChevronsDownUp' : 'ChevronsUpDown'} size="sm" />} onClick={() => { setExpanded(v => !v); setUnitOpen({}); }}>
                {expanded ? 'Hide rates' : 'Show rates'}
              </Button>
            </div>
          </div>

          <div className={`${filtersOpen ? 'block' : 'hidden'} md:block`}>
            <CalendarFilters properties={properties} property={property} setProperty={setProperty}
              off={off} setOff={setOff} statusOff={statusOff} setStatusOff={setStatusOff} dirty={filtersDirty}
              onReset={() => { setOff({}); setStatusOff({}); setProperty('all'); }} />
          </div>
        </div>

        {/* Grid: scrolls inside the card both ways; the date header and unit column stay put. */}
        <div className="max-h-[72vh] overflow-auto rounded-b-card [scrollbar-width:thin] [--unit-col:136px] md:[--unit-col:224px]">
          <div style={{ minWidth: `calc(var(--unit-col) + ${span * COL}px)` }}>
            <div className="sticky top-0 z-20 flex bg-card [border-bottom:1px_solid_var(--color-line)]">
              <div className={`${STICKY_COL} z-30 flex items-end px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-ink`}>
                {units.length} {units.length === 1 ? 'unit' : 'units'}
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
                      <div key={i} className={`flex-none box-border h-11 flex flex-col items-center justify-center gap-0.5 ${CELL_EDGE} ${colBg(i)} ${todayEdge(i)}`} style={{ width: COL }}
                        title={isToday ? 'Today' : undefined}>
                        <span className={`text-[10.5px] uppercase tracking-[0.04em] ${isToday ? 'font-semibold text-[var(--color-text-accent)]' : 'text-muted-ink'}`}>{utcLabel(d, { weekday: 'short' })}</span>
                        <span className={`text-[13px] font-semibold leading-none grid place-items-center ${isToday ? 'w-6 h-6 rounded-full bg-gold text-black' : 'h-6 text-ink'}`}>{d.getUTCDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {units.length === 0 && (
              <div className="px-4 py-10 text-center text-[13px] text-muted-ink">No units match these filters.</div>
            )}

            {units.map(u => {
              const unitBlocks = blocks.filter(b => b.unitId === u.id);
              const cells: (Block | null)[] = Array(span).fill(null);
              unitBlocks.forEach(b => {
                for (let i = Math.max(0, dayIndex(b.checkIn)); i < Math.min(span, dayIndex(b.checkOut)); i++) cells[i] = b;
              });
              const rowOpen = unitOpen[u.id] ?? expanded;
              const now = todayIdx >= 0 && todayIdx < span ? cells[todayIdx] : undefined;
              const readiness = now === undefined ? null
                : !now ? { label: 'Available today', dot: TONE.neutral.line }
                : now.channel === 'maintenance_block' ? { label: 'Blocked today', dot: TONE.critical.line }
                : now.channel === 'owner_stay' ? { label: 'Owner stay', dot: TONE.neutral.line }
                : { label: 'Occupied', dot: TONE.success.line };
              return (
                <div key={u.id} className="[border-bottom:1px_solid_var(--color-line)]">
                  {/* Unit row with booking bars */}
                  <div className="flex">
                    <div className={`${STICKY_COL} z-10 pl-1.5 pr-3 flex items-center gap-1`}>
                      <button type="button" aria-label={rowOpen ? 'Hide rates for this unit' : 'Show rates for this unit'} aria-expanded={rowOpen}
                        onClick={() => setUnitOpen(o => ({ ...o, [u.id]: !rowOpen }))}
                        className="w-6 h-6 flex-none grid place-items-center rounded-[6px] border-none bg-transparent hover:bg-muted cursor-pointer text-muted-ink p-0">
                        <Icon name={rowOpen ? 'ChevronDown' : 'ChevronRight'} size="sm" />
                      </button>
                      <div className="min-w-0 flex flex-col gap-px">
                        <div className="text-[13px] font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.unitNumber}</div>
                        <div className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={u.propertyName}>{u.propertyName}</div>
                        {readiness && (
                          <div className="flex items-center gap-[5px] text-[11px] text-muted-ink whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: readiness.dot }} />{readiness.label}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="relative flex"
                      onDragOver={e => { if (dragRef.current) e.preventDefault(); }}
                      onDrop={e => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); dropOnDay(u.id, Math.floor((e.clientX - r.left) / COL)); }}>
                      {days.map((_, i) => {
                        const booked = cells[i];
                        return (
                          <div key={i} onClick={() => (booked ? setOpenBlock(booked) : emptyNight(u, i))}
                            className={`flex-none box-border h-16 ${CELL_EDGE} ${colBg(i)} ${todayEdge(i)} ${booked ? '' : 'hover:bg-sunken cursor-pointer'}`}
                            style={{ width: COL }} title={booked ? undefined : `${u.unitNumber} · ${dayIso(i)} · open`} />
                        );
                      })}
                      {unitBlocks.map(b => {
                        const ci = dayIndex(b.checkIn), co = dayIndex(b.checkOut);
                        const s = Math.max(0, ci), e = Math.min(span, co);
                        if (e <= s) return null;
                        const ch = CHANNEL[b.channel]; const hold = ch.border !== 'solid';
                        const clipL = ci < 0, clipR = co > span;
                        const inset = 3;
                        const left = s * COL + (clipL ? 0 : inset), width = (e - s) * COL - (clipL ? 0 : inset) - (clipR ? 0 : inset);
                        const r = (on: boolean) => (on ? 0 : 8);
                        return (
                          <div key={b.id} draggable onClick={() => setOpenBlock(b)}
                            title={`${b.guestName} · ${ch.label}${b.ref ? ' · ' + b.ref : ''} · ${dateRange(b.checkIn, b.checkOut)} · drag to move`}
                            onDragStart={ev => {
                              ev.dataTransfer.effectAllowed = 'move';
                              const rect = ev.currentTarget.getBoundingClientRect();
                              dragRef.current = { id: b.id, grabOffset: (s - ci) + Math.max(0, Math.floor((ev.clientX - rect.left) / COL)) };
                            }}
                            onDragEnd={() => { dragRef.current = null; }}
                            className="absolute top-2.5 bottom-2.5 z-[2] box-border flex items-center gap-1.5 px-2 overflow-hidden cursor-grab active:cursor-grabbing select-none hover:brightness-[0.98]"
                            style={{
                              left, width, color: ch.ink,
                              background: hold ? `repeating-linear-gradient(135deg, ${ch.tint} 0 6px, var(--color-surface-card) 6px 12px)` : ch.tint,
                              border: hold ? `1.5px ${ch.border} ${ch.color}` : `1px solid color-mix(in srgb, ${ch.color} 28%, transparent)`,
                              borderLeft: clipL ? undefined : hold ? undefined : `3px solid ${ch.color}`,
                              borderRadius: `${r(clipL)}px ${r(clipR)}px ${r(clipR)}px ${r(clipL)}px`,
                            }}>
                            {width > 64 && <ChannelMark ch={b.channel} size={16} />}
                            <span className="text-[12px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{b.guestName || ch.label}</span>
                            {b.grossBookingValue > 0 && width > 150 && (
                              <span className="text-[11.5px] whitespace-nowrap opacity-80 [font-variant-numeric:tabular-nums]">{rm(b.grossBookingValue, { cents: false })}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {rowOpen && (
                    <>
                      <SubRow label="Availability">
                        {days.map((_, i) => {
                          const left = cells[i] ? 0 : 1;
                          return (
                            <div key={i} title={`${left} of 1 unit available`} style={{ width: COL }}
                              className={`flex-none box-border h-8 ${CELL_EDGE} ${colBg(i)} ${todayEdge(i)} flex items-center justify-end pr-2 text-[11.5px] [font-variant-numeric:tabular-nums] ${left ? 'text-ink-2' : 'text-faint'}`}>
                              {left ? '1 left' : 'Sold'}
                            </div>
                          );
                        })}
                      </SubRow>
                      <SubRow label="Min stay · stop sell">
                        {days.map((_, i) => {
                          const rs = data?.restrictions?.[`${u.id}:${dayIso(i)}`];
                          return (
                            <button key={i} type="button" onClick={() => setRateUpdate({ unitIds: [u.id], from: dayIso(i), to: dayIso(i) })}
                              title={rs?.stopSell ? 'Closed for sale · change' : rs && rs.minStay > 1 ? `Minimum ${rs.minStay} nights · change` : 'Set minimum stay or stop sell'}
                              style={{ width: COL }}
                              className={`flex-none box-border h-8 p-0 pr-2 border-none ${CELL_EDGE_BTN} ${colBg(i)} ${todayEdge(i)} hover:bg-sunken cursor-pointer font-sans text-[11.5px] flex items-center justify-end [font-variant-numeric:tabular-nums]`}>
                              {rs?.stopSell
                                ? <span className="px-1.5 rounded-[4px] text-[11px] font-semibold leading-[18px]" style={{ background: TONE.critical.bg, color: TONE.critical.fg }}>Closed</span>
                                : rs && rs.minStay > 1 ? <span className="font-semibold text-ink">{rs.minStay}n min</span> : null}
                            </button>
                          );
                        })}
                      </SubRow>
                      {rateRowsFor(u).map(r => {
                        const sync = r.key === 'web' ? undefined : syncFor(r.key);
                        const chip = sync ? SYNC_CHIP[sync.state] : undefined;
                        return (
                          <SubRow key={r.key} label={
                            <>
                              <ChannelMark ch={r.mark} size={16} />
                              <span className="text-ink font-medium whitespace-nowrap overflow-hidden text-ellipsis">{r.label}</span>
                              {chip && (
                                <span className="hidden md:inline-block text-[10.5px] font-semibold px-1.5 rounded-full leading-[17px] whitespace-nowrap"
                                  style={{ background: TONE[chip.tone].bg, color: TONE[chip.tone].fg }}
                                  title={sync?.lastSyncedAt ? `Last update sent ${dateTime(sync.lastSyncedAt)}` : undefined}>{chip.label}</span>
                              )}
                              <span className="ml-auto text-[10.5px] font-medium text-faint">RM</span>
                            </>
                          }>
                            {days.map((_, i) => {
                              const price = rateFor(u.id, r.key, i);
                              const custom = rateEdits[`${u.id}:${r.key}:${i}`] != null || data?.rates?.[`${u.id}:${r.key}:${dayIso(i)}`] != null;
                              return (
                                <button key={i} type="button" onClick={() => setPriceModal({ unit: u, channel: r.key, dayIso: dayIso(i), current: price })}
                                  title={`${r.label} · ${dayIso(i)} · RM ${ringgit(price)}${custom ? ' · set by hand' : ''} · click to change`}
                                  style={{ width: COL }}
                                  className={`flex-none box-border h-8 p-0 pr-2 border-none ${CELL_EDGE_BTN} ${colBg(i)} ${todayEdge(i)} hover:bg-sunken cursor-pointer font-sans text-[12px] text-right [font-variant-numeric:tabular-nums] ${custom ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                                  {ringgit(price)}
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
        </div>
      </div>

      {/* Block detail drawer. Maintenance / owner-stay holds keep the light block
          drawer; actual reservations get the full reservation-drawer actions. */}
      <Drawer open={!!openBlock} onClose={() => setOpenBlock(null)} width={380}>
        {openBlock && (() => {
          const b = openBlock;
          const isReservation = b.channel !== 'maintenance_block' && b.channel !== 'owner_stay';
          const liveState = stateEdits[b.id] ?? b.state;
          return (
          <div className="p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ChannelMark ch={b.channel} size={22} />
                <span className="text-[15px] font-semibold">{b.guestName}</span>
              </div>
              <button type="button" onClick={() => setOpenBlock(null)} aria-label="Close"
                className="w-[30px] h-[30px] grid place-items-center rounded-control bg-page border border-solid border-line cursor-pointer text-muted-ink"><Icon name="X" size="sm" /></button>
            </div>
            <div className="text-[12.5px] text-muted-ink leading-[1.8]">
              <div>{CHANNEL[b.channel].label} · {b.ref ?? '—'}</div>
              <div>{b.checkIn} → {b.checkOut}</div>
              {b.grossBookingValue > 0 && <div>Gross {rm(b.grossBookingValue)}</div>}
              {b.reason && <div>{b.reason}</div>}
            </div>

            {isReservation && (
              <div className="flex flex-col gap-[7px]">
                <label className="text-[12px] font-medium text-muted-ink">Status</label>
                <select value={liveState} onChange={e => quickStatus(b, e.target.value as ReservationState)} className={`${selectCls} h-[38px] text-[13px]`} aria-label="Reservation status">
                  {QUICK_STATES.map(s => <option key={s} value={s}>{RESERVATION[s].label}</option>)}
                </select>
              </div>
            )}

            <a href="#/reservations/bookings" onClick={() => setOpenBlock(null)} className="no-underline">
              <Button variant="primary" style={{ width: '100%' }}>View booking</Button>
            </a>
            {isReservation && (
              <Button variant="secondary" icon={<Icon name="MessageSquare" size="sm" />} style={{ width: '100%' }} onClick={() => setChatBlock(b)}>Chat with guest</Button>
            )}
            <Button variant="secondary" style={{ width: '100%' }} onClick={() => { setOpenBlock(null); setEditDates(b); }}>Change dates</Button>
            {isReservation && (
              <Button variant="secondary" icon={<Icon name="Copy" size="sm" />} style={{ width: '100%' }} onClick={() => duplicateBooking(b)}>Duplicate booking</Button>
            )}
            {isReservation && (
              <Button variant="danger" style={{ width: '100%' }} onClick={() => requestCancel(b)}>Cancel reservation</Button>
            )}

            {isReservation && (
              <div className="pt-4 [border-top:1px_solid_var(--color-line-soft)]">
                <ActivityLog reservationId={b.id} />
              </div>
            )}
          </div>
          );
        })()}
      </Drawer>

      <Dialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
      {priceModal && <SetPriceModal m={priceModal} onClose={() => setPriceModal(null)}
        onSave={rmValue => { const i = dayIndex(priceModal.dayIso); setPrice(priceModal.unit.id, priceModal.channel, i, rmValue); setPriceModal(null); }} />}
      {editDates && <ChangeDatesModal b={editDates} onClose={() => setEditDates(null)}
        onSave={(ci, co) => { const b = editDates; setEditDates(null); requestMove(b, ci, co); }} />}
      {chatBlock && <MessageModal b={chatBlock} onClose={() => setChatBlock(null)} onSend={body => sendGuestMessage(chatBlock, body)} />}
      {blockWizard && <BlockWizard units={units} initial={blockPrefill} onClose={() => setBlockWizard(false)}
        onSave={v => {
          const clash = conflictFor(v.unitId, v.from, v.to);
          if (clash) { toast({ tone: 'critical', title: 'Dates unavailable.', body: `${clash.guestName} already holds ${dateRange(clash.checkIn, clash.checkOut)} on this unit.` }); return; }
          api.post('/blocks', { unitId: v.unitId, from: v.from, to: v.to, reason: v.reason })
            .then(() => { setBlockWizard(false); toast({ tone: 'success', title: 'Dates blocked.', body: `Held on every channel · ${dateRange(v.from, v.to)}.` }); reload(); })
            .catch(notifyFailure);
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

/** A secondary row under a unit: sticky label on the left, one cell per night. */
function SubRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex [border-top:1px_solid_var(--color-line-soft)]">
      <div className={`${STICKY_COL} z-10 pl-3 md:pl-[38px] pr-3 h-8 flex items-center gap-2 text-[12px] text-muted-ink min-w-0`}>{label}</div>
      {children}
    </div>
  );
}
