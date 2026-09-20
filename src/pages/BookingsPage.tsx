import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Drawer, Dialog, type DialogSpec } from '../components/Dialog';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm, dateRange, date as fmtDate, time as fmtTime, nights as fmtNights } from '../lib/format';
import { CHANNEL_META, cx } from '../lib/design-tokens';
import type { Tone, BookingChannel, ReservationState } from '../lib/types';

const STATE_TONE: Record<ReservationState, Tone> = {
  inquiry: 'neutral', pending: 'warning', confirmed: 'info', checked_in: 'success',
  checked_out: 'neutral', cancelled: 'neutral', no_show: 'critical',
};
const STATE_LABEL: Record<ReservationState, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in',
  checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
};
const FEE_PCT: Partial<Record<BookingChannel, number>> = { airbnb: 15, booking_com: 15, agoda: 15 };

interface Row {
  id: string; externalRef: string | null; guestName: string; guestsCount: number;
  guestPhone: string | null; unitNumber: string; propertyName: string; channel: BookingChannel;
  state: ReservationState; checkIn: string; checkOut: string; checkInTime: string; checkOutTime: string;
  nights: number; grossBookingValue: number; paidAt: string | null; receivedAt: string;
}
interface Payload { data: Row[]; total: number; page: number; generatedAt: string }

const FALLBACK: Payload = {
  total: 6, page: 1, generatedAt: '',
  data: [
    { id: 'b1', externalRef: 'ABNB-7741QK', guestName: 'Nadia Abdullah', guestsCount: 2, guestPhone: '+60 12-111 0001', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', state: 'checked_in', checkIn: '2026-09-16', checkOut: '2026-09-19', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 85200, paidAt: '2026-09-12 10:04', receivedAt: '2026-09-12 10:02' },
    { id: 'b2', externalRef: 'DIR-2026-0916', guestName: 'Aaron Lee', guestsCount: 2, guestPhone: '+60 12-111 0002', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'direct', state: 'confirmed', checkIn: '2026-09-19', checkOut: '2026-09-23', checkInTime: '15:00', checkOutTime: '11:00', nights: 4, grossBookingValue: 113600, paidAt: '2026-09-14 09:20', receivedAt: '2026-09-14 09:18' },
    { id: 'b3', externalRef: 'BDC-5512088', guestName: 'Priya Sundaram', guestsCount: 2, guestPhone: '+60 12-111 0003', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'booking_com', state: 'confirmed', checkIn: '2026-09-24', checkOut: '2026-09-27', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 198800, paidAt: null, receivedAt: '2026-09-15 22:41' },
    { id: 'b4', externalRef: 'AGD-33110', guestName: 'Marcus Wong', guestsCount: 2, guestPhone: '+60 12-111 0004', unitNumber: '#MK2-09-16', propertyName: 'Arte Mont Kiara', channel: 'agoda', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-19', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 159000, paidAt: '2026-09-13 12:00', receivedAt: '2026-09-13 11:58' },
    { id: 'b5', externalRef: 'OWN-0032', guestName: 'Chong Wei Han', guestsCount: 2, guestPhone: null, unitNumber: '#MK2-09-15', propertyName: 'Arte Mont Kiara', channel: 'owner_stay', state: 'confirmed', checkIn: '2026-09-23', checkOut: '2026-09-25', checkInTime: '15:00', checkOutTime: '11:00', nights: 2, grossBookingValue: 0, paidAt: null, receivedAt: '2026-09-12 08:00' },
    { id: 'b6', externalRef: 'MNT-0914', guestName: 'AquaFix Sdn Bhd', guestsCount: 0, guestPhone: null, unitNumber: '#C-31-14', propertyName: 'Sentral Suites', channel: 'maintenance_block', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-22', checkInTime: '09:00', checkOutTime: '18:00', nights: 6, grossBookingValue: 0, paidAt: null, receivedAt: '2026-09-14 16:00' },
  ],
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'arriving', label: 'Arriving today' },
  { key: 'inhouse', label: 'In house' },
  { key: 'pending', label: 'Pending payment' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;
type FilterKey = typeof FILTERS[number]['key'];
const TODAY = '2026-09-16';

/** The unit roster a manual or imported booking is placed against. Ids mirror the
 *  calendar's unit ids so the optimistic POST carries a real `unitId`. */
const UNITS: { id: string; unitNumber: string; propertyName: string }[] = [
  { id: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One' },
  { id: 'u2', unitNumber: '#MK2-09-16', propertyName: 'Arte Mont Kiara' },
  { id: 'u3', unitNumber: '#MK2-09-15', propertyName: 'Arte Mont Kiara' },
  { id: 'u4', unitNumber: '#C-31-14', propertyName: 'Sentral Suites' },
  { id: 'u5', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara' },
  { id: 'u6', unitNumber: '#15-06', propertyName: 'Scarletz KLCC' },
];
/** Channels a manual entry may use — revenue channels only; blocks/owner stays are set on the calendar. */
const CREATE_CHANNELS: BookingChannel[] = ['direct', 'airbnb', 'booking_com', 'agoda'];

const COLS = 'grid-cols-[minmax(140px,1.2fr)_minmax(150px,1.4fr)_minmax(150px,1.2fr)_minmax(96px,0.7fr)_minmax(140px,1.1fr)_minmax(96px,0.8fr)_minmax(96px,0.8fr)_48px]';

type ColKey = 'reference' | 'guest' | 'unit' | 'channel' | 'stay' | 'gross' | 'status';
interface ColDef { key: ColKey; label: string; align?: 'right'; text: (r: Row) => string; val: (r: Row) => string | number }
const COLUMNS: ColDef[] = [
  { key: 'reference', label: 'Reference', text: r => r.externalRef ?? '', val: r => r.externalRef ?? '' },
  { key: 'guest', label: 'Guest', text: r => `${r.guestName} ${r.guestPhone ?? ''}`, val: r => r.guestName.toLowerCase() },
  { key: 'unit', label: 'Unit', text: r => `${r.unitNumber} ${r.propertyName}`, val: r => r.unitNumber.toLowerCase() },
  { key: 'channel', label: 'Channel', text: r => CHANNEL_META[r.channel].label, val: r => CHANNEL_META[r.channel].label },
  { key: 'stay', label: 'Stay', text: r => dateRange(r.checkIn, r.checkOut), val: r => r.checkIn },
  { key: 'gross', label: 'Gross', align: 'right', text: r => (r.grossBookingValue > 0 ? rm(r.grossBookingValue, { cents: false }) : ''), val: r => r.grossBookingValue },
  { key: 'status', label: 'Status', text: r => STATE_LABEL[r.state], val: r => STATE_LABEL[r.state] },
];

const nowStamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const nightsBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5);

function feeLines(r: Row) {
  const pct = FEE_PCT[r.channel] ?? 0;
  const channelFee = Math.round(r.grossBookingValue * pct / 100);
  const revenue = r.channel !== 'maintenance_block' && r.channel !== 'owner_stay';
  const cleaning = revenue && r.grossBookingValue > 0 ? 3500 : 0;
  const tourismTax = revenue && r.grossBookingValue > 0 ? 1000 * r.nights : 0;
  const collected = r.grossBookingValue - channelFee - cleaning - tourismTax;
  return { pct, channelFee, cleaning, tourismTax, collected };
}

export default function BookingsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/reservations', FALLBACK);
  const toast = useToast();

  // URL-as-state (react-router, HashRouter): filter chips, sort and the single
  // active per-column search all live in the query string, and the calendar's
  // "Create reservation" deep-links here with ?create=1.
  const [params, setParams] = useSearchParams();
  function updateParams(mut: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    mut(next);
    setParams(next, { replace: true });
  }

  const rawFilter = params.get('filter');
  const filter: FilterKey = FILTERS.some(f => f.key === rawFilter) ? (rawFilter as FilterKey) : 'all';
  const sort = params.get('sort') ?? '';
  const [sortKey, sortDir] = sort.split(':') as [ColKey | undefined, string | undefined];
  const q = params.get('q') ?? '';
  const rawField = params.get('field') ?? '';
  const field: ColKey | '' = COLUMNS.some(c => c.key === rawField) ? (rawField as ColKey) : '';

  const [added, setAdded] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [importRows, setImportRows] = useState<ParsedRow[] | null>(null);
  // The message modal targets a specific reservation — the drawer's open row, or
  // any row via its per-row chat icon — so it is keyed by row, not a bare boolean.
  const [messageRow, setMessageRow] = useState<Row | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Calendar deep-link: open the create form once, then strip the flag so a
  // refresh or a close does not reopen it.
  useEffect(() => {
    if (params.get('create') === '1') {
      setCreating(true);
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const rows = useMemo(
    () => [...added, ...(data?.data ?? [])].map(r => ({ ...r, ...edits[r.id] })),
    [data, edits, added],
  );

  const filtered = rows.filter(r => {
    switch (filter) {
      case 'arriving': return r.checkIn === TODAY && r.channel !== 'maintenance_block';
      case 'inhouse': return r.state === 'checked_in';
      case 'pending': return r.paidAt === null && r.channel !== 'maintenance_block' && r.channel !== 'owner_stay' && r.state !== 'cancelled';
      case 'blocks': return r.channel === 'maintenance_block' || r.channel === 'owner_stay';
      case 'cancelled': return r.state === 'cancelled';
      default: return true;
    }
  });
  const searchCol = field ? COLUMNS.find(c => c.key === field) : undefined;
  const searched = searchCol && q.trim()
    ? filtered.filter(r => searchCol.text(r).toLowerCase().includes(q.trim().toLowerCase()))
    : filtered;
  const sortCol = sortKey ? COLUMNS.find(c => c.key === sortKey) : undefined;
  const shown = sortCol
    ? [...searched].sort((a, b) => {
        const av = sortCol.val(a), bv = sortCol.val(b);
        const d = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === 'desc' ? -d : d;
      })
    : searched;

  const open = rows.find(r => r.id === openId) ?? null;

  function setFilter(key: FilterKey) {
    updateParams(p => { if (key === 'all') p.delete('filter'); else p.set('filter', key); });
  }
  function toggleSort(key: ColKey) {
    updateParams(p => {
      const [c, dir] = (p.get('sort') ?? '').split(':');
      if (c === key) { if (dir === 'asc') p.set('sort', `${key}:desc`); else p.delete('sort'); }
      else p.set('sort', `${key}:asc`);
    });
  }
  function setSearch(key: ColKey, value: string) {
    updateParams(p => {
      if (value.trim()) { p.set('field', key); p.set('q', value); }
      else if (p.get('field') === key) { p.delete('field'); p.delete('q'); }
    });
  }

  function patch(id: string, p: Partial<Row>) { setEdits(e => ({ ...e, [id]: { ...e[id], ...p } })); }

  function cancel(r: Row) {
    setDialog({
      title: `Cancel ${r.externalRef ?? 'this reservation'}?`,
      body: `This releases the dates on every channel, notifies ${r.guestName}, and reverses the payout line on the owner statement.`,
      meta: `${r.propertyName} ${r.unitNumber} · ${dateRange(r.checkIn, r.checkOut)}`,
      confirmLabel: 'Cancel reservation', busyLabel: 'Cancelling…', danger: true,
      onConfirm: async () => {
        setBusy(true);
        patch(r.id, { state: 'cancelled' });
        try { await api.post(`/reservations/${r.id}/cancel`, { reason: 'operator_cancelled' }); } catch { /* dev */ }
        setBusy(false); setDialog(null);
        toast({ tone: 'neutral', title: 'Reservation cancelled.', body: `${r.guestName} has been notified and the dates released.` });
      },
    });
  }

  // ---- Create reservation (POST /reservations) — optimistic add ----
  function createReservation(input: {
    unitId: string; channel: BookingChannel; guestName: string; phone: string; email: string;
    checkIn: string; checkOut: string; guestsCount: number; grossSen: number;
  }) {
    const unit = UNITS.find(u => u.id === input.unitId) ?? UNITS[0];
    const id = crypto.randomUUID();
    const row: Row = {
      id, externalRef: `MAN-${id.slice(0, 6).toUpperCase()}`, guestName: input.guestName, guestsCount: input.guestsCount,
      guestPhone: input.phone || null, unitNumber: unit.unitNumber, propertyName: unit.propertyName,
      channel: input.channel, state: 'confirmed', checkIn: input.checkIn, checkOut: input.checkOut,
      checkInTime: '15:00', checkOutTime: '11:00', nights: nightsBetween(input.checkIn, input.checkOut),
      grossBookingValue: input.grossSen, paidAt: null, receivedAt: nowStamp(),
    };
    setAdded(a => [row, ...a]);
    setCreating(false);
    toast({ tone: 'success', title: 'Reservation created.', body: `${input.guestName} · ${unit.propertyName} ${unit.unitNumber} · ${dateRange(input.checkIn, input.checkOut)}.` });
    api.post('/reservations', {
      unitId: input.unitId, channel: input.channel,
      guest: { fullName: input.guestName, email: input.email || null, phone: input.phone || null },
      checkIn: input.checkIn, checkOut: input.checkOut, guestsCount: input.guestsCount, grossBookingValue: input.grossSen,
    }).catch(() => { /* dev: no backend */ });
  }

  // ---- Import reservations (CSV) ----
  function pickImportFile() { fileRef.current?.click(); }
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportRows(buildImport(String(reader.result ?? '')));
    reader.readAsText(file);
  }
  function commitImport() {
    if (!importRows) return;
    const valid = importRows.filter(p => p.row).map(p => p.row!);
    if (valid.length) {
      setAdded(a => [...valid, ...a]);
      api.post('/reservations/import', {
        rows: valid.map(r => ({
          unitNumber: r.unitNumber, channel: r.channel, guest: { fullName: r.guestName, phone: r.guestPhone },
          checkIn: r.checkIn, checkOut: r.checkOut, guestsCount: r.guestsCount, grossBookingValue: r.grossBookingValue,
        })),
      }).catch(() => { /* dev: no backend */ });
    }
    const rejected = importRows.length - valid.length;
    toast({
      tone: valid.length ? 'success' : 'warning',
      title: valid.length ? `Imported ${valid.length} ${valid.length === 1 ? 'reservation' : 'reservations'}.` : 'Nothing imported.',
      body: rejected ? `${rejected} ${rejected === 1 ? 'row was' : 'rows were'} rejected and left out.` : 'Every row was accepted.',
    });
    setImportRows(null);
  }

  // ---- Export / Download CSV of the currently filtered rows ----
  function exportCsv() {
    const genAt = data?.generatedAt || new Date().toISOString();
    const bits: string[] = [FILTERS.find(f => f.key === filter)!.label];
    if (searchCol && q.trim()) bits.push(`${searchCol.label} contains "${q.trim()}"`);
    if (sortCol) bits.push(`sorted by ${sortCol.label} ${sortDir === 'desc' ? 'descending' : 'ascending'}`);
    const filtersLine = `Filters applied: ${bits.join(', ')} · generated ${fmtDate(genAt)} ${fmtTime(genAt)}`;
    const scopeLine = `Scope: ${shown.length} ${shown.length === 1 ? 'reservation' : 'reservations'} · reservations board · Asia/Kuala_Lumpur`;
    const head = ['Reference', 'Guest', 'Guests', 'Contact', 'Unit', 'Property', 'Channel', 'Check-in', 'Check-out', 'Nights', 'Gross', 'Status'];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const body = shown.map(r => [
      r.externalRef ?? '', r.guestName, String(r.guestsCount), r.guestPhone ?? '', r.unitNumber, r.propertyName,
      CHANNEL_META[r.channel].label, r.checkIn, r.checkOut, String(r.nights),
      r.grossBookingValue > 0 ? rm(r.grossBookingValue) : '', STATE_LABEL[r.state],
    ]);
    const lines = [`# ${filtersLine}`, `# ${scopeLine}`, '', head.map(esc).join(','), ...body.map(r => r.map(esc).join(','))];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `reservations-${filter}-${new Date(genAt).toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ tone: 'success', title: 'Export ready.', body: 'The CSV header prints the applied filters, generated time and scope.' });
  }

  // ---- Message guest (POST /messages) — from the drawer or a row's chat icon ----
  function sendGuestMessage(body: string) {
    const r = messageRow;
    if (!r) return;
    const ch = r.channel === 'direct' ? 'WhatsApp' : CHANNEL_META[r.channel].label;
    toast({ tone: 'success', title: `Message sent to ${r.guestName}.`, body: `Thread opened on ${ch}.` });
    api.post('/messages', { reservationId: r.id, body }).catch(() => { /* dev: no backend */ });
    setMessageRow(null);
  }

  // ---- Drawer → Duplicate booking (POST /reservations/:id/duplicate) — optimistic clone ----
  function duplicateReservation(r: Row) {
    const id = crypto.randomUUID();
    const clone: Row = {
      ...r, id, externalRef: `MAN-${id.slice(0, 6).toUpperCase()}`,
      state: 'confirmed', paidAt: null, receivedAt: nowStamp(),
    };
    setAdded(a => [clone, ...a]);
    setOpenId(clone.id);
    toast({ tone: 'success', title: 'Reservation duplicated.', body: `${r.guestName} · ${clone.propertyName} ${clone.unitNumber} · ${dateRange(clone.checkIn, clone.checkOut)}. Adjust the dates as needed.` });
    api.post(`/reservations/${r.id}/duplicate`, {}).catch(() => { /* dev: no backend */ });
  }

  // ---- Drawer → Quick status update (PATCH /reservations/:id) — optimistic ----
  function updateStatus(r: Row, status: ReservationState) {
    if (status === r.state) return;
    patch(r.id, { state: status });
    api.patch(`/reservations/${r.id}`, { status }).catch(() => { /* dev: no backend */ });
    toast({ tone: 'neutral', title: 'Status updated.', body: `${r.externalRef ?? 'Reservation'} is now ${STATE_LABEL[status]}.` });
  }

  // ---- Drawer → Change dates (PATCH /reservations/:id/dates) — optimistic ----
  async function submitChangeDates(vals: { checkIn: string; checkOut: string }) {
    if (!open) return;
    const r = open;
    patch(r.id, { checkIn: vals.checkIn, checkOut: vals.checkOut, nights: nightsBetween(vals.checkIn, vals.checkOut) });
    try { await api.patch(`/reservations/${r.id}/dates`, { checkIn: vals.checkIn, checkOut: vals.checkOut, confirm: true }); }
    catch { /* dev: no backend */ }
    setDatesOpen(false);
    toast({ tone: 'success', title: 'Dates changed.', body: `${r.guestName} moved to ${dateRange(vals.checkIn, vals.checkOut)} and notified.` });
  }

  return (
    <>
      <PageHeader title="Bookings" sub={`${(data?.total ?? rows.length) + added.length} reservations`}
        right={<div className="flex gap-[9px] flex-wrap">
          <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={pickImportFile}>Import</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportCsv} disabled={shown.length === 0} disabledReason="Nothing to export for this filter yet.">Download CSV</Button>
          <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>Create reservation</Button>
        </div>} />

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onImportFile} className="hidden" aria-hidden />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div className="flex gap-2 flex-wrap py-3 px-[22px] [border-bottom:1px_solid_var(--color-line)]">
          {FILTERS.map(f => {
            const on = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cx(
                  'h-8 px-[13px] py-0 rounded-pill cursor-pointer [font-family:inherit] text-[12.5px] border border-solid',
                  on ? 'font-semibold border-transparent bg-black text-white' : 'font-medium border-line bg-page text-muted-ink',
                )}>
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1010px]">
            {/* Sortable header */}
            <div className={cx(COLS, 'grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)]')}>
              {COLUMNS.map(c => {
                const active = sortKey === c.key;
                return (
                  <button key={c.key} type="button" onClick={() => toggleSort(c.key)} title={`Sort by ${c.label}`}
                    className={cx('flex items-center gap-1 [font:inherit] text-[12px] font-semibold text-muted-ink bg-transparent border-none cursor-pointer p-0', c.align === 'right' && 'justify-end')}>
                    <span>{c.label}</span>
                    <Icon name={active ? (sortDir === 'desc' ? 'ChevronDown' : 'ChevronUp') : 'ChevronsUpDown'} size="sm"
                      color={active ? 'var(--color-ink)' : 'var(--color-line)'} />
                  </button>
                );
              })}
              <div className="flex items-center justify-center text-[12px] font-semibold text-muted-ink">Chat</div>
            </div>
            {/* Per-column search */}
            <div className={cx(COLS, 'grid gap-[14px] py-[7px] px-[22px] bg-page [border-bottom:1px_solid_var(--color-line-soft)]')}>
              {COLUMNS.map(c => (
                <input key={c.key} value={field === c.key ? q : ''} onChange={e => setSearch(c.key, e.target.value)}
                  placeholder="Search" aria-label={`Search ${c.label}`}
                  className={cx('h-7 w-full box-border rounded-control border border-solid border-line bg-card text-ink [font:inherit] text-[12px] px-2 py-0 outline-none', c.align === 'right' && 'text-right')} />
              ))}
              <div aria-hidden />
            </div>

            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={8} /> : shown.length === 0 ? (
              <div className="py-[34px] px-[22px] text-center text-[13.5px] text-muted-ink">No reservations match this filter.</div>
            ) : shown.map(b => {
              const ch = CHANNEL_META[b.channel];
              return (
                <div key={b.id} role="button" tabIndex={0} onClick={() => setOpenId(b.id)}
                  onKeyDown={e => { if (e.key === 'Enter') setOpenId(b.id); }}
                  className={cx(COLS, 'grid gap-[14px] items-center min-h-[54px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer')}>
                  <div className="flex items-center gap-[9px] min-w-0">
                    <ChannelMark ch={b.channel} size={20} />
                    <span className="font-mono text-[12px] whitespace-nowrap overflow-hidden text-ellipsis">{b.externalRef ?? '—'}</span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{b.guestName}</span>
                    <span className="text-[11.5px] text-muted-ink">{b.guestsCount > 0 ? `${b.guestsCount} guests` : 'No guest'}</span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13px]">{b.unitNumber}</span>
                    <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{b.propertyName}</span>
                  </div>
                  <div>
                    <span className="inline-flex items-center h-[22px] px-[9px] rounded-pill text-[11.5px] font-semibold whitespace-nowrap" style={{ background: ch.tint, color: ch.ink }}>{ch.label}</span>
                  </div>
                  <div className="text-[12.5px]">{dateRange(b.checkIn, b.checkOut)}</div>
                  <div className="text-right text-[13px] font-medium">{b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '—'}</div>
                  <div><Badge tone={STATE_TONE[b.state]} label={STATE_LABEL[b.state]} /></div>
                  <div className="flex justify-center">
                    <button type="button" title="Message guest" aria-label={`Message ${b.guestName}`}
                      onClick={e => { e.stopPropagation(); setMessageRow(b); }}
                      className="w-8 h-8 grid place-items-center rounded-control text-muted-ink bg-transparent border-none cursor-pointer hover:bg-muted">
                      <Icon name="MessageSquare" size="sm" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Drawer open={!!open} onClose={() => setOpenId(null)} width={440}>
        {open && <ReservationPanel key={open.id} r={open} onClose={() => setOpenId(null)} onMessage={() => setMessageRow(open)} onChangeDates={() => setDatesOpen(true)} onCancel={() => cancel(open)} onDuplicate={() => duplicateReservation(open)} onStatus={s => updateStatus(open, s)} />}
      </Drawer>
      <Dialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />

      {creating && <CreateReservationModal onClose={() => setCreating(false)} onCreate={createReservation} />}
      {importRows && <ImportPreviewModal rows={importRows} onClose={() => setImportRows(null)} onConfirm={commitImport} />}
      {messageRow && <MessageModal r={messageRow} onClose={() => setMessageRow(null)} onSend={sendGuestMessage} />}
      {open && datesOpen && <ChangeDatesModal r={open} onClose={() => setDatesOpen(false)} onConfirm={submitChangeDates} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Reservation drawer                                                  */
/* ------------------------------------------------------------------ */

function ReservationPanel({ r, onClose, onMessage, onChangeDates, onCancel, onDuplicate, onStatus }: {
  r: Row; onClose: () => void; onMessage: () => void; onChangeDates: () => void; onCancel: () => void;
  onDuplicate: () => void; onStatus: (status: ReservationState) => void;
}) {
  const ch = CHANNEL_META[r.channel];
  const f = feeLines(r);
  const cancelled = r.state === 'cancelled';
  const [showActivity, setShowActivity] = useState(false);
  const steps = [
    { label: 'Booking created', meta: `Channel sync · ${r.receivedAt}`, done: true },
    { label: 'Payment received', meta: r.paidAt ? `${rm(r.grossBookingValue, { cents: false })} · ${r.paidAt}` : 'Awaiting payment', done: !!r.paidAt },
    { label: 'Access code sent', meta: r.state === 'checked_in' || r.state === 'checked_out' ? 'WhatsApp' : 'Sends 2h before check-in', done: r.state === 'checked_in' || r.state === 'checked_out' },
    { label: 'Guest checked in', meta: r.state === 'checked_in' || r.state === 'checked_out' ? `Smart lock · ${r.checkIn} ${r.checkInTime}` : `Due ${r.checkIn} ${r.checkInTime}`, done: r.state === 'checked_in' || r.state === 'checked_out' },
  ];
  const money = [
    { label: 'Gross booking value', value: rm(r.grossBookingValue), sign: '' },
    ...(f.channelFee ? [{ label: `Channel fee · ${f.pct}%`, value: rm(f.channelFee), sign: '−' }] : []),
    ...(f.cleaning ? [{ label: 'Cleaning', value: rm(f.cleaning), sign: '−' }] : []),
    ...(f.tourismTax ? [{ label: `Tourism tax · ${r.nights} nights`, value: rm(f.tourismTax), sign: '−' }] : []),
  ];

  return (
    <>
      <div className="relative h-[132px] bg-black flex-none flex items-end">
        <div className="absolute inset-0 grid place-items-center text-[rgba(255,255,255,0.25)]"><Icon name="Image" /></div>
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-[30px] h-[30px] grid place-items-center rounded-pill bg-[rgba(0,0,0,0.4)] [border:none] text-white cursor-pointer"><Icon name="X" size="sm" /></button>
        <div className="relative p-[18px] flex items-center gap-[10px]">
          <ChannelMark ch={r.channel} size={22} />
          <span className="text-white text-[13px] font-semibold">{r.unitNumber}</span>
          <span className="text-[rgba(255,255,255,0.7)] text-[12px]">{r.propertyName}</span>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1">
        <div className="flex items-center gap-[10px] flex-wrap">
          <Badge tone={STATE_TONE[r.state]} label={STATE_LABEL[r.state]} />
          <span className="inline-flex items-center h-[22px] px-[9px] rounded-pill text-[11.5px] font-semibold" style={{ background: ch.tint, color: ch.ink }}>{ch.label}</span>
          <span className="font-mono text-[12px] text-muted-ink">{r.externalRef}</span>
        </div>

        {/* Quick status update — closed list from the reservation_state enum */}
        <div className="flex items-center gap-[10px]">
          <label htmlFor="rv-status" className="text-[12px] font-medium text-muted-ink flex-none">Status</label>
          <select id="rv-status" value={r.state} onChange={e => onStatus(e.target.value as ReservationState)}
            className="h-9 flex-1 px-3 py-0 rounded-control border border-solid border-line bg-white text-ink [font:inherit] text-[13px] cursor-pointer">
            {(Object.keys(STATE_LABEL) as ReservationState[]).map(s => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-px bg-line border border-solid border-line rounded-card overflow-hidden">
          {[
            [`${r.checkIn} · ${r.checkInTime}`, 'Check-in'],
            [`${r.checkOut} · ${r.checkOutTime}`, 'Check-out'],
            [`${r.nights}`, 'Nights'],
            [`${r.guestsCount || '—'}`, 'Guests'],
          ].map(([v, l]) => (
            <div key={l} className="bg-card py-[11px] px-[13px] flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">{v}</span>
              <span className="text-[11px] text-muted-ink">{l}</span>
            </div>
          ))}
        </div>

        {r.grossBookingValue > 0 && (
          <div className="border border-solid border-line rounded-card overflow-hidden">
            {money.map(m => (
              <div key={m.label} className="flex justify-between gap-3 py-[10px] px-[14px] [border-bottom:1px_solid_var(--color-line-soft)]">
                <span className="text-[12.5px] text-muted-ink">{m.label}</span>
                <span className="text-[12.5px] [font-variant-numeric:tabular-nums]">{m.sign} {m.value}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 py-[11px] px-[14px] bg-muted">
              <span className="text-[13px] font-semibold">Collected revenue</span>
              <span className="text-[13px] font-semibold [font-variant-numeric:tabular-nums]">{rm(f.collected)}</span>
            </div>
          </div>
        )}

        <div>
          <div className="text-[12px] font-semibold text-muted-ink mb-3">Timeline</div>
          <div className="flex flex-col">
            {steps.map((s, i) => (
              <div key={s.label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cx('w-[11px] h-[11px] rounded-pill border-2 border-solid', s.done ? 'bg-[var(--color-success-fg)] [border-color:var(--color-success-fg)]' : 'bg-card [border-color:var(--color-line)]')} />
                  {i < steps.length - 1 && <span className="w-0.5 flex-1 min-h-[26px] bg-line" />}
                </div>
                <div className="pb-4">
                  <div className={cx('text-[13px] font-medium', s.done ? 'text-ink' : 'text-muted-ink')}>{s.label}</div>
                  <div className="text-[11.5px] text-muted-ink">{s.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity log — the reservation's audit trail, hydrated on demand */}
        <div>
          <button type="button" onClick={() => setShowActivity(v => !v)} aria-expanded={showActivity}
            className="flex items-center justify-between w-full [font:inherit] bg-transparent border-none p-0 cursor-pointer text-[12px] font-semibold text-muted-ink mb-3">
            <span>Activity log</span>
            <Icon name={showActivity ? 'ChevronUp' : 'ChevronDown'} size="sm" />
          </button>
          {showActivity && <ActivityLog r={r} />}
        </div>
      </div>

      <div className="p-4 [border-top:1px_solid_var(--color-line)] bg-page flex flex-col gap-[9px] flex-none">
        <Button variant="primary" icon={<Icon name="MessageSquare" size="sm" />} onClick={onMessage}>Message guest</Button>
        <Button variant="secondary" icon={<Icon name="Copy" size="sm" />} onClick={onDuplicate}>Duplicate booking</Button>
        {!cancelled && (
          <div className="flex gap-[9px]">
            <Button variant="secondary" style={{ flex: 1 }} onClick={onChangeDates}>Change dates</Button>
            <Button variant="danger" style={{ flex: 1 }} onClick={onCancel}>Cancel</Button>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Activity log — reservation audit trail                              */
/* ------------------------------------------------------------------ */

interface ActivityItem { actorLabel: string; action: string; source: string; occurredAt: string }

/** Dev fallback so the section renders before the audit endpoint is live. */
const ACTIVITY_FALLBACK: ActivityItem[] = [
  { actorLabel: 'Channel sync', action: 'reservation.created', source: 'channel_webhook', occurredAt: '2026-09-12 10:02' },
  { actorLabel: 'Aina Zulkifli', action: 'payment.recorded', source: 'operator', occurredAt: '2026-09-12 10:05' },
  { actorLabel: 'System', action: 'access_code.sent', source: 'automation', occurredAt: '2026-09-16 13:00' },
];

function ActivityLog({ r }: { r: Row }) {
  const { data } = useApi<ActivityItem[]>(`/audit?entityTable=reservations&entityId=${r.id}`, ACTIVITY_FALLBACK);
  const items = data ?? [];
  if (items.length === 0) return <div className="text-[12px] text-muted-ink py-2">No activity recorded yet.</div>;
  return (
    <div className="border border-solid border-line rounded-card overflow-hidden">
      {items.map((a, i) => (
        <div key={i} className={cx('flex items-start gap-3 py-[10px] px-[13px]', i < items.length - 1 && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
          <span className="w-[26px] h-[26px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-[10px] font-semibold">
            {a.actorLabel.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </span>
          <div className="flex flex-col gap-px flex-1 min-w-0">
            <span className="text-[12.5px]"><strong className="font-semibold">{a.actorLabel}</strong> · {a.action.replace(/[._]/g, ' ')}</span>
            <span className="text-[11px] text-muted-ink">{a.source.replace(/_/g, ' ')} · {a.occurredAt}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CSV import — parse + validate                                        */
/* ------------------------------------------------------------------ */

interface ParsedRow { line: number; label: string; error?: string; row?: Row }

/** Minimal RFC-4180-ish parser: handles quoted fields, escaped quotes and CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], val = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else inQ = false; }
      else val += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(val); val = ''; }
    else if (c === '\n') { cur.push(val); rows.push(cur); cur = []; val = ''; }
    else if (c !== '\r') val += c;
  }
  if (val !== '' || cur.length) { cur.push(val); rows.push(cur); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function buildImport(text: string): ParsedRow[] {
  const grid = parseCsv(text);
  if (grid.length < 2) return [{ line: 0, label: 'File', error: 'No data rows found. Expected a header row plus at least one reservation.' }];
  const header = grid[0].map(h => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iUnit = idx('unit'), iGuest = idx('guest'), iChannel = idx('channel'), iIn = idx('checkin'), iOut = idx('checkout'), iGuests = idx('guests'), iRate = idx('rate'), iPhone = idx('phone');
  if (iUnit < 0 || iGuest < 0 || iChannel < 0 || iIn < 0 || iOut < 0) {
    return [{ line: 0, label: 'Header', error: 'Missing columns. Required header: unit, guest, channel, checkin, checkout (optional: guests, rate, phone).' }];
  }
  return grid.slice(1).map((cols, n) => {
    const line = n + 2;
    const get = (i: number) => (i >= 0 ? (cols[i] ?? '').trim() : '');
    const unitNumber = get(iUnit), guest = get(iGuest), channelRaw = get(iChannel).toLowerCase();
    const checkIn = get(iIn), checkOut = get(iOut), guestsRaw = get(iGuests), rateRaw = get(iRate), phone = get(iPhone);
    const label = `${guest || '(no name)'} · ${unitNumber || '(no unit)'}`;
    const unit = UNITS.find(u => u.unitNumber.toLowerCase() === unitNumber.toLowerCase());
    if (!unit) return { line, label, error: `Unknown unit "${unitNumber}". Use one of ${UNITS.map(u => u.unitNumber).join(', ')}.` };
    if (!guest) return { line, label, error: 'Guest name is required.' };
    if (!(channelRaw in CHANNEL_META)) return { line, label, error: `Unknown channel "${channelRaw}". Use airbnb, booking_com, agoda or direct.` };
    if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) return { line, label, error: 'Dates must be YYYY-MM-DD.' };
    if (nightsBetween(checkIn, checkOut) < 1) return { line, label, error: 'Check-out must be after check-in.' };
    const guestsCount = guestsRaw ? Number(guestsRaw) : 2;
    if (!Number.isFinite(guestsCount) || guestsCount < 0) return { line, label, error: 'Guests must be a number.' };
    const rateNum = rateRaw ? Number(rateRaw.replace(/[^0-9.]/g, '')) : 0;
    if (!Number.isFinite(rateNum) || rateNum < 0) return { line, label, error: 'Rate must be a number (RM).' };
    const id = crypto.randomUUID();
    const row: Row = {
      id, externalRef: `IMP-${id.slice(0, 6).toUpperCase()}`, guestName: guest, guestsCount,
      guestPhone: phone || null, unitNumber: unit.unitNumber, propertyName: unit.propertyName,
      channel: channelRaw as BookingChannel, state: 'confirmed', checkIn, checkOut,
      checkInTime: '15:00', checkOutTime: '11:00', nights: nightsBetween(checkIn, checkOut),
      grossBookingValue: Math.round(rateNum * 100), paidAt: null, receivedAt: nowStamp(),
    };
    return { line, label, row };
  });
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

const selectCls = 'h-10 px-3 py-0 rounded-control border border-solid border-line bg-white text-ink [font:inherit] cursor-pointer';
const labelCls = 'text-[12px] font-medium text-muted-ink';

function Modal({ title, sub, onClose, children, maxWidth = 460 }: { title: string; sub?: string; onClose: () => void; children: ReactNode; maxWidth?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[70] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div style={{ maxWidth }} className="relative w-full bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden max-h-[90vh] flex flex-col [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="px-[22px] pt-[22px] pb-1 flex-none">
          <h2 className="m-0 text-[18px] font-semibold">{title}</h2>
          {sub && <p className="mt-[6px] mx-0 mb-0 text-[13px] text-muted-ink">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateReservationModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (input: { unitId: string; channel: BookingChannel; guestName: string; phone: string; email: string; checkIn: string; checkOut: string; guestsCount: number; grossSen: number }) => void;
}) {
  const [unitId, setUnitId] = useState(UNITS[0].id);
  const [channel, setChannel] = useState<BookingChannel>('direct');
  const [guestName, setGuestName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guestsCount, setGuestsCount] = useState('2');
  const [rate, setRate] = useState('');

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const datesValid = !!checkIn && !!checkOut && nights >= 1;
  const valid = !!guestName.trim() && datesValid && Number(guestsCount) >= 1;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onCreate({
      unitId, channel, guestName: guestName.trim(), phone: phone.trim(), email: email.trim(),
      checkIn, checkOut, guestsCount: Number(guestsCount) || 1, grossSen: Math.round((Number(rate) || 0) * 100),
    });
  }

  return (
    <Modal title="Create reservation" sub="Manual entry, the same validation as the calendar." onClose={onClose} maxWidth={480}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="cr-unit" className={labelCls}>Unit</label>
            <select id="cr-unit" value={unitId} onChange={e => setUnitId(e.target.value)} className={selectCls}>
              {UNITS.map(u => <option key={u.id} value={u.id}>{u.propertyName} {u.unitNumber}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="cr-channel" className={labelCls}>Channel</label>
            <select id="cr-channel" value={channel} onChange={e => setChannel(e.target.value as BookingChannel)} className={selectCls}>
              {CREATE_CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_META[c].label}</option>)}
            </select>
          </div>
        </div>
        <Field label="Guest name" placeholder="Jane Tan" value={guestName} onChange={e => setGuestName(e.target.value)} required />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <Field label="Phone" placeholder="+60 12-345 6789" value={phone} onChange={e => setPhone(e.target.value)} />
          <Field label="Email" type="email" placeholder="jane@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Field label="Check-in" type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} required />
          <Field label="Check-out" type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} required
            error={checkIn && checkOut && nights < 1 ? 'Check-out must be after check-in.' : undefined} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Field label="Guests" type="number" min={1} max={16} numeric value={guestsCount} onChange={e => setGuestsCount(e.target.value)} />
          <Field label="Rate (RM total)" type="number" min={0} numeric value={rate} onChange={e => setRate(e.target.value)}
            help={datesValid ? `${fmtNights(nights)} · ${dateRange(checkIn, checkOut)}` : 'Gross booking value for the stay.'} />
        </div>
        <div className="flex justify-end gap-[9px] pt-1">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" disabled={!valid} disabledReason="Add a guest name and a valid date range first.">Create reservation</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportPreviewModal({ rows, onClose, onConfirm }: { rows: ParsedRow[]; onClose: () => void; onConfirm: () => void }) {
  const ok = rows.filter(r => r.row).length;
  const bad = rows.length - ok;
  return (
    <Modal title="Import reservations" sub="Review the parsed rows before committing. Rejected rows are left out." onClose={onClose} maxWidth={620}>
      <div className="px-[22px] pt-1 pb-3 flex items-center gap-2 flex-wrap flex-none">
        <span className="text-[12.5px] text-muted-ink">{rows.length} {rows.length === 1 ? 'row' : 'rows'} parsed</span>
        <Badge tone="success" label={`${ok} ready`} size="sm" />
        {bad > 0 && <Badge tone="critical" label={`${bad} with ${bad === 1 ? 'an error' : 'errors'}`} size="sm" />}
      </div>
      <div className="mx-[22px] mb-2 border border-solid border-line rounded-card overflow-y-auto">
        {rows.map((r, i) => (
          <div key={i} className={cx('flex items-start gap-3 py-[10px] px-[13px]', i < rows.length - 1 && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
            <Icon name={r.row ? 'CheckCircle2' : 'AlertCircle'} size="sm" color={r.row ? 'var(--color-success-fg)' : 'var(--color-critical-fg)'} style={{ marginTop: 2 }} />
            <div className="flex flex-col gap-px min-w-0 flex-1">
              <span className="text-[13px] font-medium">{r.line ? `Line ${r.line} · ` : ''}{r.label}</span>
              {r.row
                ? <span className="text-[11.5px] text-muted-ink">{CHANNEL_META[r.row.channel].label} · {dateRange(r.row.checkIn, r.row.checkOut)} · {r.row.grossBookingValue > 0 ? rm(r.row.grossBookingValue, { cents: false }) : 'no rate'}</span>
                : <span className="text-[11.5px] text-[var(--color-critical-fg)]">{r.error}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-between gap-[9px] flex-wrap flex-none">
        <span className="text-[11.5px] text-muted-ink">Columns: unit, guest, channel, checkin, checkout, guests, rate, phone</span>
        <div className="flex gap-[9px]">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={onConfirm} disabled={ok === 0} disabledReason="No valid rows to import.">
            {ok > 0 ? `Import ${ok} ${ok === 1 ? 'reservation' : 'reservations'}` : 'Import'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MessageModal({ r, onClose, onSend }: { r: Row; onClose: () => void; onSend: (body: string) => void }) {
  const [body, setBody] = useState('');
  const thread = r.channel === 'direct' ? 'WhatsApp' : CHANNEL_META[r.channel].label;
  return (
    <Modal title={`Message ${r.guestName}`} sub={`Thread opens on ${thread}.`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (body.trim()) onSend(body.trim()); }} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="bk-msg" className={labelCls}>Message</label>
          <textarea id="bk-msg" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${r.guestName.split(' ')[0]}, checking in on your upcoming stay…`}
            className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit] p-[10px_12px] resize-y" />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" disabled={!body.trim()} disabledReason="Write a message first.">Send message</Button>
        </div>
      </form>
    </Modal>
  );
}

function ChangeDatesModal({ r, onClose, onConfirm }: { r: Row; onClose: () => void; onConfirm: (vals: { checkIn: string; checkOut: string }) => Promise<void> | void }) {
  const [checkIn, setCheckIn] = useState(r.checkIn);
  const [checkOut, setCheckOut] = useState(r.checkOut);
  const [busy, setBusy] = useState(false);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const changed = checkIn !== r.checkIn || checkOut !== r.checkOut;
  const valid = !!checkIn && !!checkOut && nights >= 1 && changed;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    await onConfirm({ checkIn, checkOut });
    setBusy(false);
  }

  return (
    <Modal title="Change dates" sub="Moving a stay updates the channel, re-checks availability and notifies the guest." onClose={onClose}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-[12px] text-muted-ink">
          Current: {dateRange(r.checkIn, r.checkOut)} · {fmtNights(r.nights)}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Field label="Check-in" type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} required />
          <Field label="Check-out" type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} required
            error={checkIn && checkOut && nights < 1 ? 'Check-out must be after check-in.' : undefined}
            help={valid ? `New stay: ${dateRange(checkIn, checkOut)} · ${fmtNights(nights)}` : undefined} />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason="Pick a new, valid date range first.">
            {busy ? 'Saving…' : 'Change dates'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
