import { useMemo, useRef, useState, type ReactNode } from 'react';
import { color, tone as toneMap } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Dialog, Drawer, type DialogSpec } from '../components/Dialog';
import { Field } from '../components/Field';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, notifyFailure } from '../lib/api';
import { todayMyt, rm, dateRange } from '../lib/format';
import { CHANNEL, RESERVATION } from '../lib/vocabulary';
import type { BookingChannel, ReservationState, Tone } from '../lib/types';

const COL = 62;
const UNIT_COL = 240;
const ALL: BookingChannel[] = ['airbnb', 'booking_com', 'agoda', 'direct', 'maintenance_block', 'owner_stay'];
// Channels a bulk rate push can target. Direct is the web rate itself.
const PUSH: BookingChannel[] = ['direct', 'airbnb', 'booking_com', 'agoda'];

/** The quick-status picker in the reservation drawer. Cancellation has its own
 *  destructive Cancel flow (confirm + notify), so it is not offered here. */
const QUICK_STATES: ReservationState[] = ['inquiry', 'pending', 'confirmed', 'checked_in', 'checked_out', 'no_show'];

/** Booking-status filter chips. `blocked` is a pseudo-status: the maintenance
 *  hold channel has no reservation_state, so its chip filters that channel. */
const STATUS_FILTERS: { key: string; label: string; tone: Tone }[] = [
  { key: 'confirmed', label: 'Confirmed', tone: 'info' },
  { key: 'checked_in', label: 'Checked in', tone: 'success' },
  { key: 'checked_out', label: 'Checked out', tone: 'neutral' },
  { key: 'pending', label: 'Pending', tone: 'warning' },
  { key: 'blocked', label: 'Blocked', tone: 'critical' },
];

// The rate rows revealed by "Expand rates": the web rate plus each connected channel.
const RATE_ROWS: { key: 'web' | BookingChannel; label: string; sync: string; syncTone: Tone; dot: string }[] = [
  { key: 'web', label: 'Web rate', sync: 'Direct', syncTone: 'success', dot: CHANNEL.direct.color },
  { key: 'airbnb', label: 'Airbnb rate', sync: 'Synced', syncTone: 'success', dot: CHANNEL.airbnb.color },
  { key: 'booking_com', label: 'Booking.com rate', sync: 'Synced', syncTone: 'success', dot: CHANNEL.booking_com.color },
  { key: 'agoda', label: 'Agoda rate', sync: 'Expired', syncTone: 'critical', dot: CHANNEL.agoda.color },
];
const UPLIFT: Record<string, number> = { web: 1, airbnb: 1.12, booking_com: 1.18, agoda: 1.16 };

// The web rate is always shown; the OTA rows shown for a unit are only the
// channels it is actually linked to (unit_channels / Channex). If the payload
// omits `channels` (older backend), fall back to all three so nothing is hidden.
const RATE_ROW_BY_KEY = Object.fromEntries(RATE_ROWS.map(r => [r.key, r])) as Record<string, typeof RATE_ROWS[number]>;
const OTA_CHANNELS: BookingChannel[] = ['airbnb', 'booking_com', 'agoda'];
const rateRowsFor = (u: Unit) => ['web', ...(u.channels ?? OTA_CHANNELS)].map(k => RATE_ROW_BY_KEY[k]).filter(Boolean);

interface Unit { id: string; unitNumber: string; propertyName: string; channels?: BookingChannel[] }
interface Block {
  id: string; unitId: string; channel: BookingChannel; state: ReservationState;
  guestName: string; checkIn: string; checkOut: string; grossBookingValue: number; ref: string | null; reason: string | null;
}
interface Payload { from: string; to: string; units: Unit[]; blocks: Block[]; baseRate: Record<string, number>; rates?: Record<string, number>; restrictions?: Record<string, { minStay: number; stopSell: boolean }>; generatedAt: string }

const today = new Date(todayMyt());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

const FALLBACK: Payload = {
  from: '2026-09-16', to: '2026-09-29', generatedAt: '',
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
    { id: 'b1', unitId: 'u1', channel: 'airbnb', state: 'checked_in', guestName: 'Nadia Abdullah', checkIn: '2026-09-16', checkOut: '2026-09-17', grossBookingValue: 85200, ref: 'ABNB-7741QK', reason: null },
    { id: 'b2', unitId: 'u1', channel: 'direct', state: 'confirmed', guestName: 'Aaron Lee', checkIn: '2026-09-17', checkOut: '2026-09-19', grossBookingValue: 113600, ref: 'DIR-2026-0916', reason: null },
    { id: 'b3', unitId: 'u1', channel: 'booking_com', state: 'confirmed', guestName: 'Priya Sundaram', checkIn: '2026-09-24', checkOut: '2026-09-28', grossBookingValue: 198800, ref: 'BDC-5512088', reason: null },
    { id: 'b4', unitId: 'u3', channel: 'agoda', state: 'confirmed', guestName: 'Marcus Wong', checkIn: '2026-09-16', checkOut: '2026-09-19', grossBookingValue: 159000, ref: 'AGD-33110', reason: null },
    { id: 'b5', unitId: 'u3', channel: 'booking_com', state: 'confirmed', guestName: 'Siti Rahmah', checkIn: '2026-09-24', checkOut: '2026-09-27', grossBookingValue: 127200, ref: 'BDC-5512411', reason: null },
    { id: 'b6', unitId: 'u2', channel: 'booking_com', state: 'confirmed', guestName: 'Chen Yu', checkIn: '2026-09-18', checkOut: '2026-09-23', grossBookingValue: 161700, ref: 'BDC-5512087', reason: null },
    { id: 'b7', unitId: 'u4', channel: 'owner_stay', state: 'confirmed', guestName: 'Chong Wei Han', checkIn: '2026-09-23', checkOut: '2026-09-25', grossBookingValue: 0, ref: 'OWN-0032', reason: 'Owner staying, agreed 12 Sep' },
    { id: 'b8', unitId: 'u6', channel: 'maintenance_block', state: 'confirmed', guestName: 'AquaFix Sdn Bhd', checkIn: '2026-09-16', checkOut: '2026-09-22', grossBookingValue: 0, ref: 'MNT-0914', reason: 'Plumbing works' },
  ],
};

export default function CalendarPage() {
  // Fixed 30-day window; navigate by scrolling the grid left/right, or jump a
  // window with the ‹ › buttons. (The old 2-weeks/Month toggle is gone.)
  const span = 30;
  const [weekOffset, setWeekOffset] = useState(0);
  const start = addDays(today, weekOffset * span);
  const from = iso(start), to = iso(addDays(start, span - 1));
  const { data, error, reload } = useApi<Payload>(`/reservations/calendar?from=${from}&to=${to}`, FALLBACK);
  const toast = useToast();

  const [off, setOff] = useState<Partial<Record<BookingChannel, boolean>>>({});
  const [statusOff, setStatusOff] = useState<Record<string, boolean>>({});
  const [property, setProperty] = useState('all');
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
  // Optimistic overlays — there is no backend in dev.
  const [dateEdits, setDateEdits] = useState<Record<string, { checkIn: string; checkOut: string }>>({});
  const [stateEdits, setStateEdits] = useState<Record<string, ReservationState>>({});
  // Which booking is being dragged, and where within it the pointer grabbed.
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

  function rateFor(unitId: string, channel: string, i: number) {
    const key = `${unitId}:${channel}:${i}`;
    if (rateEdits[key] != null) return rateEdits[key];
    const saved = data?.rates?.[`${unitId}:${channel}:${dayIso(i)}`];
    if (saved != null) return saved;
    const base = data?.baseRate[unitId] ?? 28800;
    const weekend = [5, 6].includes(addDays(gridStart, i).getDay());
    return Math.round(base * UPLIFT[channel] * (weekend ? 1.22 : 1));
  }
  function setPrice(unitId: string, channel: string, i: number, rmValue: number) {
    const key = `${unitId}:${channel}:${i}`;
    const prev = rateEdits[key];
    setRateEdits(e => ({ ...e, [key]: Math.round(rmValue * 100) }));
    api.put('/rates', { unitId, channel, date: dayIso(i), rate: Math.round(rmValue * 100) })
      .then(() => toast({ tone: 'success', title: 'Rate set.', body: 'Saved for that night. Channel sync is not connected yet.' }))
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
      await api.post('/integrations/sync');
      toast({ tone: 'success', title: 'Channels synced.', body: 'Airbnb and Booking.com pulled · Agoda skipped (expired).' });
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

  return (
    <>
      <PageHeader title="Calendar" sub="24 units · 6 buildings · Asia/Kuala Lumpur" />

      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}

      <Card>
        {/* Filters */}
        <div className="px-5 py-[13px] [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <FilterLabel label="Host">
              <span className="text-[13px] font-medium text-muted-ink bg-muted border border-solid border-line rounded-control px-3 py-[7px]">The Conts Sdn Bhd</span>
            </FilterLabel>
            <FilterLabel label="Property">
              <select value={property} onChange={e => setProperty(e.target.value)} className={`${selectCls} h-[34px]`}>
                <option value="all">All properties</option>
                {properties.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </FilterLabel>
          </div>

          {/* Channel checkboxes */}
          <div className="flex items-center gap-[18px] flex-wrap">
            {ALL.map(k => {
              const on = !off[k]; const c = CHANNEL[k];
              return (
                <button key={k} type="button" onClick={() => setOff(o => ({ ...o, [k]: on }))}
                  className="flex items-center gap-2 [background:none] border-none p-0 cursor-pointer [font:inherit]">
                  <span className="w-[18px] h-[18px] flex-none rounded-[4px] grid place-items-center"
                    style={{ background: on ? c.color : color.card, border: `1.5px solid ${on ? c.color : color.borderStrong}`, transition: 'background var(--motion-fast)' }}>
                    {on && <Icon name="Check" size="sm" color="#FFFFFF" style={{ width: 13, height: 13 }} />}
                  </span>
                  <span className="text-[13px] font-medium" style={{ color: on ? color.ink : color.textMuted }}>{c.label}</span>
                </button>
              );
            })}
            <span className="ml-auto flex gap-[14px]">
              <button type="button" onClick={() => setOff({})} className={linkCls}>Select all</button>
              <button type="button" onClick={() => setOff(Object.fromEntries(ALL.map(k => [k, true])))} className={linkCls}>Deselect all</button>
            </span>
          </div>

          {/* Booking status chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-ink mr-1">BOOKING STATUS</span>
            {STATUS_FILTERS.filter(s => !statusOff[s.key]).map(s => {
              const t = toneMap[s.tone];
              return (
                <span key={s.key} className="inline-flex items-center gap-[7px] h-[28px] pt-0 pr-2 pb-0 pl-[10px] rounded-full text-[12px] font-medium text-ink bg-card border border-solid border-line">
                  <span className="w-2 h-2 rounded-full flex-none" style={{ background: t.line }} />
                  {s.label}
                  <button type="button" aria-label={`Remove ${s.label}`} onClick={() => setStatusOff(o => ({ ...o, [s.key]: true }))}
                    className="grid place-items-center w-4 h-4 rounded-full border-none [background:none] cursor-pointer text-faint p-0">
                    <Icon name="X" size="sm" style={{ width: 13, height: 13 }} />
                  </button>
                </span>
              );
            })}
            <button type="button" onClick={() => { setOff({}); setStatusOff({}); setProperty('all'); }} className={`${linkCls} ml-auto`}>Reset</button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-[11px] [border-bottom:1px_solid_var(--color-line)] flex items-center gap-[9px] flex-wrap">
          <Button size="sm" variant={expanded ? 'primary' : 'secondary'} icon={<Icon name={expanded ? 'ChevronsLeft' : 'ChevronsRight'} size="sm" />} onClick={() => setExpanded(v => !v)}>{expanded ? 'Collapse rates' : 'Expand rates'}</Button>
          <Button size="sm" variant="secondary" onClick={() => setRateUpdate({})}>Rate update</Button>
          <Button size="sm" variant="secondary" style={{ color: toneMap.critical.fg, borderColor: toneMap.critical.line }} onClick={() => { setBlockPrefill({}); setBlockWizard(true); }}>Block wizard</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="RefreshCw" size="sm" />} loading={syncing} onClick={refresh}>Refresh</Button>
          <span className="text-[12px] text-muted-ink">Airbnb, Booking.com and Agoda synced 14:06 MYT</span>
          <span className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setWeekOffset(w => w - 1)} className={navCls} aria-label="Previous"><Icon name="ChevronsLeft" size="sm" /></button>
            <span className="text-[12.5px] font-medium min-w-[150px] text-center">{new Date(from).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })} – {new Date(to).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button type="button" onClick={() => setWeekOffset(w => w + 1)} className={navCls} aria-label="Next"><Icon name="ChevronsRight" size="sm" /></button>
            <Button size="sm" variant="secondary" onClick={() => setWeekOffset(0)}>Today</Button>
          </span>
        </div>

        {/* Grid */}
        <div className="max-h-[68vh] overflow-auto">
          <div style={{ minWidth: UNIT_COL + span * COL }}>
            <div className="flex bg-muted [border-bottom:1px_solid_var(--color-line)] sticky top-0 z-[4]">
              <div className="w-60 box-border flex-none sticky left-0 z-[5] bg-muted px-4 py-2.5 [border-right:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink">Unit</div>
              {Array.from({ length: span }, (_, i) => {
                const d = addDays(gridStart, i); const wk = [5, 6].includes(d.getDay());
                return (
                  <div key={i} className="flex-none w-[62px] box-border px-1 py-2 flex flex-col items-center gap-px [border-left:1px_solid_var(--color-line)]"
                    style={{ background: i === todayIdx ? color.goldTint : wk ? color.page : 'transparent' }}>
                    <span className="text-[11px] text-muted-ink">{d.toLocaleDateString('en-MY', { weekday: 'short' })}</span>
                    <span className="text-[12.5px] font-semibold">{d.getDate()}</span>
                  </div>
                );
              })}
            </div>

            {units.map(u => {
              const cells: ({ b: Block; first: boolean; last: boolean } | null)[] = Array(span).fill(null);
              blocks.filter(b => b.unitId === u.id).forEach(b => {
                const s = Math.max(0, dayIndex(b.checkIn)); const e = Math.min(span, dayIndex(b.checkOut));
                for (let i = s; i < e; i++) cells[i] = { b, first: i === s, last: i === e - 1 };
              });
              const rowOpen = expanded || unitOpen[u.id];
              const c0 = cells[0];
              const readiness = !c0 ? { label: 'Available', dot: toneMap.neutral.line }
                : c0.b.channel === 'maintenance_block' ? { label: 'Blocked', dot: toneMap.neutral.line }
                : c0.b.channel === 'owner_stay' ? { label: 'Owner stay', dot: toneMap.neutral.line }
                : { label: 'Occupied', dot: toneMap.success.line };
              return (
                <div key={u.id}>
                  <div className="flex min-h-16 [border-bottom:1px_solid_var(--color-line)]">
                    <div className="w-60 box-border flex-none sticky left-0 z-[3] bg-white px-[14px] py-2.5 [border-right:1px_solid_var(--color-line)] flex items-center gap-2.5">
                      <button type="button" aria-label={rowOpen ? 'Collapse unit' : 'Expand unit'} onClick={() => setUnitOpen(o => ({ ...o, [u.id]: !rowOpen }))}
                        className="w-[22px] h-[22px] flex-none grid place-items-center border-none [background:none] cursor-pointer text-muted-ink p-0">
                        <Icon name={rowOpen ? 'ChevronDown' : 'ChevronRight'} size="sm" />
                      </button>
                      <span className="w-10 h-10 flex-none rounded-control bg-muted border border-solid border-line-soft grid place-items-center text-faint"><Icon name="Image" size="sm" /></span>
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <div className="text-[12.5px] font-semibold whitespace-nowrap">{u.unitNumber}</div>
                        <div className="text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.propertyName}</div>
                        <div className="flex items-center gap-[5px] text-[11px] text-muted-ink">
                          <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: readiness.dot }} />{readiness.label}
                        </div>
                      </div>
                    </div>
                    {cells.map((c, i) => {
                      if (!c) return <div key={i} onClick={() => emptyNight(u, i)}
                        onDragOver={e => { if (dragRef.current) e.preventDefault(); }}
                        onDrop={e => { e.preventDefault(); dropOnDay(u.id, i); }}
                        className="relative box-border flex-none w-[62px] [border-left:1px_solid_var(--color-line-soft)] flex items-center px-[5px] py-[7px] cursor-pointer" style={{ background: i === todayIdx ? color.goldTint : undefined }} title={`${u.unitNumber} · available`} />;
                      const ch = CHANNEL[c.b.channel]; const hold = ch.border !== 'solid';
                      const nights = dayIndex(c.b.checkOut) - dayIndex(c.b.checkIn);
                      const lineColor = hold ? ch.color : 'rgba(21,21,21,0.06)';
                      return (
                        <div key={i} onClick={() => setOpenBlock(c.b)} title={`${c.b.guestName} · ${ch.label}${c.b.ref ? ' · ' + c.b.ref : ''} · drag to move`}
                          draggable
                          onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragRef.current = { id: c.b.id, grabOffset: i - dayIndex(c.b.checkIn) }; }}
                          onDragEnd={() => { dragRef.current = null; }}
                          onDragOver={e => { if (dragRef.current) e.preventDefault(); }}
                          onDrop={e => { e.preventDefault(); dropOnDay(u.id, i); }}
                          className="relative box-border flex-none w-[62px] flex items-center px-[5px] py-[7px] my-[11px] cursor-grab active:cursor-grabbing"
                          style={{ background: hold ? 'transparent' : ch.tint, borderTop: `1px ${hold ? ch.border : 'solid'} ${lineColor}`, borderBottom: `1px ${hold ? ch.border : 'solid'} ${lineColor}`, boxShadow: c.first && !hold ? `inset 3px 0 0 ${ch.color}` : undefined, borderRadius: c.first && c.last ? 6 : c.first ? '6px 0 0 6px' : c.last ? '0 6px 6px 0' : undefined, borderLeft: c.first && hold ? `1px ${ch.border} ${ch.color}` : undefined, borderRight: c.last ? `1px ${hold ? ch.border : 'solid'} ${lineColor}` : undefined }}>
                          {c.first && (
                            <span className="absolute left-3 text-[11.5px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none z-[2]" style={{ maxWidth: nights * COL - 22, color: ch.ink }}>{c.b.guestName}{c.b.grossBookingValue > 0 ? ` · ${rm(c.b.grossBookingValue, { cents: false })}` : ''}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {rowOpen && (
                    <>
                      <div className="flex [border-bottom:1px_solid_var(--color-line-soft)] bg-page">
                        <div className="w-60 box-border flex-none sticky left-0 z-[2] bg-page px-4 py-1.5 [border-right:1px_solid_var(--color-line)] text-[11.5px] font-medium text-muted-ink">Inventory</div>
                        {Array.from({ length: span }, (_, i) => {
                          const booked = cells[i] != null;
                          return <div key={i} className="flex-none w-[62px] box-border [border-left:1px_solid_var(--color-line-soft)] grid place-items-center text-[11px] [font-variant-numeric:tabular-nums]" style={{ color: booked ? color.textMuted : color.ink, background: i === todayIdx ? color.goldTint : undefined }}>{booked ? '0 | 1' : '1 | 1'}</div>;
                        })}
                      </div>
                      <div className="flex [border-bottom:1px_solid_var(--color-line-soft)] bg-page">
                        <div className="w-60 box-border flex-none sticky left-0 z-[2] bg-page px-4 py-1.5 [border-right:1px_solid_var(--color-line)] text-[11.5px] font-medium text-muted-ink">Min stay · stop sell</div>
                        {Array.from({ length: span }, (_, i) => {
                          const rs = data?.restrictions?.[`${u.id}:${dayIso(i)}`];
                          return (
                            <button key={i} type="button" onClick={() => setRateUpdate({ unitIds: [u.id], from: dayIso(i), to: dayIso(i) })} title="Set minimum stay or stop sell"
                              className="flex-none w-[62px] box-border border-none [border-left:1px_solid_var(--color-line-soft)]! cursor-pointer font-sans text-[11px] px-[2px] py-1.5 [font-variant-numeric:tabular-nums]"
                              style={{ color: rs?.stopSell ? toneMap.critical.fg : rs ? color.ink : color.textMuted, background: i === todayIdx ? color.goldTint : 'transparent', fontWeight: rs ? 600 : 400 }}>
                              {rs?.stopSell ? 'Closed' : rs && rs.minStay > 1 ? `min ${rs.minStay}` : '·'}
                            </button>
                          );
                        })}
                      </div>
                      {rateRowsFor(u).map(r => {
                        const t = toneMap[r.syncTone];
                        return (
                          <div key={r.key} className="flex [border-bottom:1px_solid_var(--color-line-soft)]">
                            <div className="w-60 box-border flex-none sticky left-0 z-[2] bg-white px-4 py-[7px] [border-right:1px_solid_var(--color-line)] flex items-center gap-[9px]">
                              <span className="w-[9px] h-[9px] flex-none rounded-full" style={{ background: r.dot }} />
                              <span className="text-[12px] font-medium">{r.label}</span>
                              <span className="ml-auto text-[10.5px] font-semibold px-2 py-px rounded-full" style={{ background: t.bg, color: t.fg }}>{r.sync}</span>
                            </div>
                            {Array.from({ length: span }, (_, i) => {
                              const price = rateFor(u.id, r.key, i);
                              const edited = rateEdits[`${u.id}:${r.key}:${i}`] != null;
                              return (
                                <button key={i} type="button" onClick={() => setPriceModal({ unit: u, channel: r.key, dayIso: dayIso(i), current: price })}
                                  className="flex-none w-[62px] box-border border-none [border-left:1px_solid_var(--color-line-soft)]! cursor-pointer font-sans text-[11.5px] text-ink px-[2px] py-[7px] [font-variant-numeric:tabular-nums]"
                                  style={{ background: edited ? color.goldTint : i === todayIdx ? color.goldTint : '#FFFFFF' }}
                                  title="Set price">
                                  {rm(price, { cents: false }).replace('RM', 'RM ')}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

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
                <span className="w-3 h-3 flex-none rounded-[3px]" style={{ background: CHANNEL[b.channel].color }} />
                <span className="text-[15px] font-semibold">{b.guestName}</span>
              </div>
              <button type="button" onClick={() => setOpenBlock(null)} aria-label="Close" className={navCls}><Icon name="X" size="sm" /></button>
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
                <select value={liveState} onChange={e => quickStatus(b, e.target.value as ReservationState)} className={`${selectCls} h-[38px]`} aria-label="Reservation status">
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
            unitIds: v.unitIds, from: v.from, to: v.to,
            ...(v.priceSen !== undefined ? { channels: v.channels, baseRate: v.priceSen } : {}),
            ...(v.minStay !== undefined ? { minStay: v.minStay } : {}),
            ...(v.stopSell !== undefined ? { stopSell: v.stopSell } : {}),
          })
            .then(() => {
              setRateUpdate(false);
              const what = [v.priceSen !== undefined && 'price', v.minStay !== undefined && 'minimum stay', v.stopSell !== undefined && (v.stopSell ? 'stop sell' : 'reopened')].filter(Boolean).join(', ');
              toast({ tone: 'success', title: 'Saved.', body: `${what} · ${v.unitIds.length} ${v.unitIds.length === 1 ? 'unit' : 'units'} · ${dateRange(v.from, v.to)}.` });
              reload();
            })
            .catch(notifyFailure);
        }} />}
    </>
  );
}


const linkCls = '[background:none] border-none cursor-pointer font-sans text-[12px] font-medium text-[var(--color-text-accent)]';
const navCls = 'w-[30px] h-[30px] grid place-items-center rounded-control bg-page border border-solid border-line cursor-pointer text-muted-ink';
const selectCls = 'px-[10px] py-0 font-sans text-[13px] text-ink bg-white border border-solid border-line rounded-control [outline:none]';
function FilterLabel({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center gap-2"><span className="text-[11px] font-semibold tracking-[0.06em] text-muted-ink">{label.toUpperCase()}</span>{children}</div>;
}

function CentreModal({ title, sub, onClose, onSave, saveLabel, canSave, children }: { title: string; sub?: string; onClose: () => void; onSave: () => void; saveLabel: string; canSave: boolean; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSave) onSave(); }}>
          <div className="pt-[22px] px-[22px] pb-1"><h2 className="m-0 text-[18px] font-semibold">{title}</h2>{sub && <p className="mt-[5px] mx-0 mb-0 text-[13px] text-muted-ink">{sub}</p>}</div>
          <div className="px-[22px] py-4 flex flex-col gap-[14px]">{children}</div>
          <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSave} disabledReason="Fill the fields first">{saveLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SetPriceModal({ m, onClose, onSave }: { m: { unit: Unit; channel: string; dayIso: string; current: number }; onClose: () => void; onSave: (rm: number) => void }) {
  const [v, setV] = useState(String(Math.round(m.current / 100)));
  const label = m.channel === 'web' ? 'Web rate' : CHANNEL[m.channel as BookingChannel].label;
  return (
    <CentreModal title="Set price" sub={`${m.unit.unitNumber} · ${label} · ${m.dayIso}`} onClose={onClose} saveLabel="Set price" canSave={v !== '' && Number(v) >= 0} onSave={() => onSave(Number(v))}>
      <Field label="Price (RM / night)" type="number" min={0} numeric value={v} onChange={e => setV(e.target.value)} help="Pushed to the connected channel for this night. Confirmed bookings keep their original rate." />
    </CentreModal>
  );
}
function ChangeDatesModal({ b, onClose, onSave }: { b: Block; onClose: () => void; onSave: (checkIn: string, checkOut: string) => void }) {
  const [ci, setCi] = useState(b.checkIn); const [co, setCo] = useState(b.checkOut);
  return (
    <CentreModal title="Change dates" sub={`${b.guestName} · currently ${dateRange(b.checkIn, b.checkOut)}`} onClose={onClose} saveLabel="Review move" canSave={ci !== '' && co !== '' && co > ci} onSave={() => onSave(ci, co)}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check-in" type="date" value={ci} onChange={e => setCi(e.target.value)} />
        <Field label="Check-out" type="date" value={co} onChange={e => setCo(e.target.value)} />
      </div>
      <p className="m-0 text-[12px] text-muted-ink">The move is availability-checked and confirmed on the next step before anything is sent.</p>
    </CentreModal>
  );
}
function MessageModal({ b, onClose, onSend }: { b: Block; onClose: () => void; onSend: (body: string) => void }) {
  const [body, setBody] = useState('');
  const thread = b.channel === 'direct' ? 'WhatsApp' : CHANNEL[b.channel].label;
  return (
    <CentreModal title={`Message ${b.guestName}`} sub={`Thread opens on ${thread}.`} onClose={onClose} saveLabel="Send message" canSave={body.trim() !== ''} onSave={() => onSend(body.trim())}>
      <div className="flex flex-col gap-[6px]">
        <label className="text-[12px] font-medium text-muted-ink">Message</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
          placeholder={`Hi ${b.guestName.split(' ')[0]}, checking in on your upcoming stay…`}
          className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit] p-[10px_12px] resize-y" />
      </div>
    </CentreModal>
  );
}

interface ActivityEntry { actorLabel: string; action: string; source: string; occurredAt: string }
interface ActivityPayload { data: ActivityEntry[] }
const ACTIVITY_FALLBACK: ActivityPayload = {
  data: [
    { actorLabel: 'Channel sync', action: 'reservation.created', source: 'channel_webhook', occurredAt: '12 Sep 10:02' },
    { actorLabel: 'Aina Zulkifli', action: 'reservation.dates_change', source: 'web', occurredAt: '14 Sep 09:18' },
    { actorLabel: 'System', action: 'notification.sent', source: 'system', occurredAt: '14 Sep 09:18' },
  ],
};

/** Activity log — the reservation's audit trail (actor, action, source, time),
 *  read straight from `GET /api/audit?entityTable=reservations&entityId=`. */
function ActivityLog({ reservationId }: { reservationId: string }) {
  const { data: audit } = useApi<ActivityPayload>(`/audit?entityTable=reservations&entityId=${reservationId}`, ACTIVITY_FALLBACK);
  const entries = audit?.data ?? [];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold text-muted-ink">Activity</span>
      {entries.length === 0 ? (
        <span className="text-[12px] text-muted-ink">No activity yet.</span>
      ) : (
        <div className="border border-solid border-line rounded-card overflow-hidden">
          {entries.map((a, i) => (
            <div key={i} className={`flex items-center gap-2.5 py-2 px-3 ${i < entries.length - 1 ? '[border-bottom:1px_solid_var(--color-line-soft)]' : ''}`}>
              <span className="w-[26px] h-[26px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-[10px] font-semibold">
                {a.actorLabel.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </span>
              <div className="flex flex-col gap-px flex-1 min-w-0">
                <span className="text-[12px]"><strong className="font-semibold">{a.actorLabel}</strong> · {a.action.replace(/[._]/g, ' ')}</span>
                <span className="text-[11px] text-muted-ink">{a.source.replace(/_/g, ' ')}</span>
              </div>
              <span className="text-[11px] text-muted-ink whitespace-nowrap">{a.occurredAt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function BlockWizard({ units, initial, onClose, onSave }: {
  units: Unit[]; initial: { unitId?: string; from?: string; to?: string };
  onClose: () => void; onSave: (v: { unitId: string; from: string; to: string; reason: string }) => void;
}) {
  const [unit, setUnit] = useState(initial.unitId ?? units[0]?.id ?? '');
  const [fromD, setFromD] = useState(initial.from ?? ''); const [toD, setToD] = useState(initial.to ?? ''); const [reason, setReason] = useState('');
  const valid = !!unit && fromD !== '' && toD !== '' && toD > fromD && reason.trim() !== '';
  return (
    <CentreModal title="Block wizard" sub="Hold nights so no channel can sell them." onClose={onClose} saveLabel="Block dates" canSave={valid} onSave={() => onSave({ unitId: unit, from: fromD, to: toD, reason: reason.trim() })}>
      <div className="flex flex-col gap-[7px]">
        <label className="text-[12px] font-medium text-muted-ink">Unit</label>
        <select value={unit} onChange={e => setUnit(e.target.value)} className={`${selectCls} h-[44px]`}>{units.map(u => <option key={u.id} value={u.id}>{u.unitNumber} — {u.propertyName}</option>)}</select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" type="date" value={fromD} onChange={e => setFromD(e.target.value)} />
        <Field label="To" type="date" value={toD} min={fromD || undefined} onChange={e => setToD(e.target.value)} />
      </div>
      <Field label="Reason" placeholder="e.g. Plumbing works" value={reason} onChange={e => setReason(e.target.value)} help="Required. Shown on the block and pushed to every channel as unavailable." />
    </CentreModal>
  );
}
function RateUpdate({ units, initial, onClose, onSave }: {
  units: Unit[]; initial: { unitIds?: string[]; from?: string; to?: string }; onClose: () => void;
  onSave: (v: { unitIds: string[]; channels: BookingChannel[]; from: string; to: string; priceSen?: number; minStay?: number; stopSell?: boolean }) => void;
}) {
  const [unitSel, setUnitSel] = useState<Record<string, boolean>>(Object.fromEntries(units.map(u => [u.id, initial.unitIds ? initial.unitIds.includes(u.id) : true])));
  const [chanSel, setChanSel] = useState<Record<string, boolean>>({ direct: true, airbnb: true, booking_com: true, agoda: true });
  const [fromD, setFromD] = useState(initial.from ?? ''); const [toD, setToD] = useState(initial.to ?? ''); const [price, setPrice] = useState('');
  const [minStay, setMinStay] = useState('');
  const [stop, setStop] = useState<'same' | 'close' | 'open'>('same');
  const unitIds = units.filter(u => unitSel[u.id]).map(u => u.id);
  const channels = PUSH.filter(c => chanSel[c]);
  const hasPrice = price !== '' && Number(price) >= 0;
  const minStayOk = minStay === '' || (Number.isInteger(Number(minStay)) && Number(minStay) >= 1 && Number(minStay) <= 60);
  const valid = unitIds.length > 0 && fromD !== '' && toD !== '' && toD >= fromD && minStayOk
    && (hasPrice || minStay !== '' || stop !== 'same') && (!hasPrice || channels.length > 0);
  const pill = (on: boolean) => `inline-flex items-center gap-[6px] h-[30px] px-[11px] rounded-pill cursor-pointer [font:inherit] text-[12px] border border-solid ${on ? 'font-semibold border-gold bg-gold-tint text-ink' : 'font-medium border-line bg-card text-muted-ink'}`;
  return (
    <CentreModal title="Rate update" sub="Set a price, minimum stay or stop sell across a date range and units in one save." onClose={onClose} saveLabel="Save" canSave={valid}
      onSave={() => onSave({
        unitIds, channels, from: fromD, to: toD,
        ...(hasPrice ? { priceSen: Math.round(Number(price) * 100) } : {}),
        ...(minStay !== '' ? { minStay: Number(minStay) } : {}),
        ...(stop !== 'same' ? { stopSell: stop === 'close' } : {}),
      })}>
      <div className="flex flex-col gap-[7px]">
        <label className="text-[12px] font-medium text-muted-ink">Units · {unitIds.length}/{units.length}</label>
        <div className="flex gap-2 flex-wrap">
          {units.map(u => { const on = !!unitSel[u.id]; return (
            <button key={u.id} type="button" aria-pressed={on} onClick={() => setUnitSel(s => ({ ...s, [u.id]: !on }))} className={pill(on)}>{u.unitNumber}</button>
          ); })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" type="date" value={fromD} onChange={e => setFromD(e.target.value)} />
        <Field label="To" type="date" value={toD} min={fromD || undefined} onChange={e => setToD(e.target.value)} />
      </div>
      <Field label="Price (RM / night)" type="number" min={0} numeric value={price} onChange={e => setPrice(e.target.value)} help="Leave empty to keep the current prices." />
      {hasPrice && (
        <div className="flex flex-col gap-[7px]">
          <label className="text-[12px] font-medium text-muted-ink">Price applies to</label>
          <div className="flex gap-2 flex-wrap">
            {PUSH.map(c => { const on = !!chanSel[c]; return (
              <button key={c} type="button" aria-pressed={on} onClick={() => setChanSel(s => ({ ...s, [c]: !on }))} className={pill(on)}>
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: CHANNEL[c].color }} />{c === 'direct' ? 'Web / Direct' : CHANNEL[c].label}
              </button>
            ); })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum stay (nights)" type="number" min={1} max={60} numeric value={minStay} onChange={e => setMinStay(e.target.value)} help={minStayOk ? 'Empty keeps it. 1 removes it.' : 'Enter 1 to 60 nights.'} />
        <div className="flex flex-col gap-[7px]">
          <label className="text-[12px] font-medium text-muted-ink" htmlFor="stop-sell">Stop sell</label>
          <select id="stop-sell" value={stop} onChange={e => setStop(e.target.value as 'same' | 'close' | 'open')}
            className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="same">Keep as is</option>
            <option value="close">Close for sale</option>
            <option value="open">Open for sale</option>
          </select>
        </div>
      </div>
    </CentreModal>
  );
}
