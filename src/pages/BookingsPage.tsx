import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Drawer, Dialog, type DialogSpec } from '../components/Dialog';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { PageControls } from '../components/PageControls';
import { useApi } from '../lib/useApi';
import { useUnitRoster, type RosterUnit } from '../lib/useUnitRoster';
import { useToast } from '../components/Toast';
import { api, notifyFailure, downloadFile } from '../lib/api';
import { rm, dateRange, dateTime, nights as fmtNights } from '../lib/format';
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
  nights: number; grossBookingValue: number; channelFee: number; paidAt: string | null; receivedAt: string;
}

const VIEWS = [
  { key: 'upcoming', label: 'Upcoming', empty: 'No upcoming or in-house bookings.' },
  { key: 'arriving', label: 'Arriving today', empty: 'Nobody arrives today.' },
  { key: 'inhouse', label: 'In house', empty: 'Nobody is in house right now.' },
  { key: 'pending', label: 'Pending payment', empty: 'Every live booking has been paid.' },
  { key: 'past', label: 'Past', empty: 'No past bookings yet.' },
  { key: 'cancelled', label: 'Cancelled', empty: 'No cancelled bookings.' },
  { key: 'blocks', label: 'Blocks', empty: 'No maintenance blocks or owner stays.' },
  { key: 'all', label: 'All', empty: 'No bookings yet.' },
] as const;
type ViewKey = typeof VIEWS[number]['key'];

interface Payload {
  data: Row[]; total: number; page: number; pageSize: number; generatedAt: string; today: string; view: ViewKey;
  counts: Record<ViewKey, number>;
  totals: { bookings: number; nights: number; gross: number; fees: number };
}

const SAMPLE: Row[] = [
  { id: 'b1', externalRef: 'ABNB-7741QK', guestName: 'Nadia Abdullah', guestsCount: 2, guestPhone: '+60 12-111 0001', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', state: 'checked_in', checkIn: '2026-09-16', checkOut: '2026-09-19', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 85200, channelFee: 12780, paidAt: '2026-09-12 10:04', receivedAt: '2026-09-12 10:02' },
  { id: 'b2', externalRef: 'DIR-2026-0916', guestName: 'Aaron Lee', guestsCount: 2, guestPhone: '+60 12-111 0002', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'direct', state: 'confirmed', checkIn: '2026-09-19', checkOut: '2026-09-23', checkInTime: '15:00', checkOutTime: '11:00', nights: 4, grossBookingValue: 113600, channelFee: 0, paidAt: '2026-09-14 09:20', receivedAt: '2026-09-14 09:18' },
  { id: 'b3', externalRef: 'BDC-5512088', guestName: 'Priya Sundaram', guestsCount: 2, guestPhone: '+60 12-111 0003', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'booking_com', state: 'confirmed', checkIn: '2026-09-24', checkOut: '2026-09-27', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 198800, channelFee: 29820, paidAt: null, receivedAt: '2026-09-15 22:41' },
];
const FALLBACK: Payload = {
  total: 3, page: 1, pageSize: 50, generatedAt: '', today: '2026-09-16', view: 'upcoming', data: SAMPLE,
  counts: { upcoming: 3, arriving: 0, inhouse: 1, pending: 1, past: 0, cancelled: 0, blocks: 0, all: 3 },
  totals: { bookings: 3, nights: 10, gross: 397600, fees: 42600 },
};

/** Channels a manual entry may use — revenue channels only; blocks/owner stays are set on the calendar. */
const CREATE_CHANNELS: BookingChannel[] = ['direct', 'airbnb', 'booking_com', 'agoda'];

const COLS = 'grid-cols-[minmax(130px,1.1fr)_minmax(150px,1.4fr)_minmax(140px,1.2fr)_minmax(96px,0.7fr)_minmax(140px,1.1fr)_minmax(96px,0.8fr)_minmax(104px,0.8fr)_48px]';

type ColKey = 'reference' | 'guest' | 'unit' | 'channel' | 'stay' | 'gross' | 'status';
/** Each column's search box writes its own URL parameter; the server searches every booking, not just this page. */
const COLUMNS: { key: ColKey; param: string; label: string; align?: 'right'; hint: string }[] = [
  { key: 'reference', param: 'ref', label: 'Reference', hint: 'Search' },
  { key: 'guest', param: 'guest', label: 'Guest', hint: 'Name or phone' },
  { key: 'unit', param: 'unit', label: 'Unit', hint: 'Unit or building' },
  { key: 'channel', param: 'channel', label: 'Channel', hint: 'Search' },
  { key: 'stay', param: 'stay', label: 'Stay', hint: 'e.g. 12 Oct' },
  { key: 'gross', param: 'gross', label: 'Gross', align: 'right', hint: 'Search' },
  { key: 'status', param: 'status', label: 'Status', hint: 'Search' },
];
const SEARCH_PARAMS = ['q', ...COLUMNS.map(c => c.param)];
/** URL parameters the server reads. The drawer's `open` stays out so opening a booking does not refetch the list. */
const API_PARAMS = ['view', 'sort', 'page', 'size', ...SEARCH_PARAMS];

const nightsBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5);
const nowStamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const num = (v: number) => v.toLocaleString('en-MY');

function feeLines(r: Row) {
  const gross = r.grossBookingValue;
  const channelFee = r.channelFee > 0 ? r.channelFee : Math.round(gross * (FEE_PCT[r.channel] ?? 0) / 100);
  const pct = gross > 0 ? Math.round(channelFee / gross * 1000) / 10 : 0;
  const revenue = r.channel !== 'maintenance_block' && r.channel !== 'owner_stay';
  const cleaning = revenue && gross > 0 ? 3500 : 0;
  const tourismTax = revenue && gross > 0 ? 1000 * r.nights : 0;
  const collected = gross - channelFee - cleaning - tourismTax;
  return { pct, channelFee, cleaning, tourismTax, collected };
}

export default function BookingsPage() {
  const UNITS = useUnitRoster();
  const toast = useToast();

  // URL-as-state (react-router, HashRouter): tab, sort, page, page size and every search live in the
  // query string, so a link or a refresh shows the same list. The calendar deep-links with ?create=1.
  const [params, setParams] = useSearchParams();
  function updateParams(mut: (p: URLSearchParams) => void) {
    setParams(prev => { const next = new URLSearchParams(prev); mut(next); return next; }, { replace: true });
  }

  const rawView = params.get('view');
  const view: ViewKey = VIEWS.some(v => v.key === rawView) ? (rawView as ViewKey) : 'upcoming';
  const [sortKey, sortDir] = (params.get('sort') ?? '').split(':') as [ColKey | undefined, string | undefined];

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of API_PARAMS) { const v = params.get(k); if (v) p.set(k, v); }
    return p.toString();
  }, [params]);
  const { data, loading, error, reload } = useApi<Payload>(`/reservations${apiQuery ? `?${apiQuery}` : ''}`, FALLBACK);

  // Search boxes answer every keystroke locally; the URL (and so the server) follows once typing pauses.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(SEARCH_PARAMS.map(k => [k, params.get(k) ?? ''])));
  const timer = useRef<number | undefined>(undefined);
  function setSearch(param: string, value: string) {
    setDrafts(d => ({ ...d, [param]: value }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => updateParams(p => {
      if (value.trim()) p.set(param, value); else p.delete(param);
      p.delete('page');
    }), 300);
  }
  function clearSearches() {
    window.clearTimeout(timer.current);
    setDrafts(Object.fromEntries(SEARCH_PARAMS.map(k => [k, ''])));
    updateParams(p => { SEARCH_PARAMS.forEach(k => p.delete(k)); p.delete('page'); });
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const searching = SEARCH_PARAMS.some(k => params.get(k));

  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [creating, setCreating] = useState(false);
  // Guests' "Book again" passes the guest in router state (kept out of the URL). Captured when the
  // form opens, because stripping the create flag below replaces the location and drops the state.
  const location = useLocation();
  const [prefill, setPrefill] = useState<{ guestName?: string; phone?: string; email?: string } | null>(null);
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
      setPrefill((location.state ?? null) as typeof prefill);
      setCreating(true);
      updateParams(p => p.delete('create'));
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(
    () => (data?.data ?? []).map(r => ({ ...r, ...edits[r.id] })),
    [data, edits],
  );

  // A booking opened from outside this page (a fresh duplicate) is read on its own.
  const onPage = openId ? rows.find(r => r.id === openId) : undefined;
  const { data: fetchedOpen } = useApi<Row>(openId && !onPage ? `/reservations/${openId}` : null);
  const open = onPage ?? (fetchedOpen && fetchedOpen.id === openId ? { ...fetchedOpen, ...edits[openId] } : null);

  const page = data?.page ?? 1;
  // A new page or tab starts at its first row, not wherever the last one was scrolled to.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    // Phones have no inner table scroll: the cards scroll with the page, so bring the page back up instead.
    if (window.matchMedia('(max-width: 767.98px)').matches) document.querySelector('main')?.scrollTo({ top: 0 });
  }, [data?.page, data?.view]);
  const pageSize = data?.pageSize ?? 50;
  const total = data?.total ?? 0;
  const counts = data?.counts;
  const totals = data?.totals;
  const refreshing = loading && !!data;

  function setView(key: ViewKey) {
    updateParams(p => { if (key === 'upcoming') p.delete('view'); else p.set('view', key); p.delete('page'); });
  }
  function toggleSort(key: ColKey) {
    updateParams(p => {
      const [c, dir] = (p.get('sort') ?? '').split(':');
      if (c === key) { if (dir === 'asc') p.set('sort', `${key}:desc`); else p.delete('sort'); }
      else p.set('sort', `${key}:asc`);
      p.delete('page');
    });
  }
  function goPage(n: number) {
    updateParams(p => { if (n <= 1) p.delete('page'); else p.set('page', String(n)); });
  }
  function setSize(n: number) {
    updateParams(p => { if (n === 50) p.delete('size'); else p.set('size', String(n)); p.delete('page'); });
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
        const prev = edits[r.id];
        patch(r.id, { state: 'cancelled' });
        try {
          await api.post(`/reservations/${r.id}/cancel`, { reason: 'operator_cancelled' });
          toast({ tone: 'neutral', title: 'Reservation cancelled.', body: `${r.guestName} has been notified and the dates released.` });
          reload();
        } catch (e) { setEdits(x => ({ ...x, [r.id]: prev ?? {} })); notifyFailure(e); }
        setBusy(false); setDialog(null);
      },
    });
  }

  // ---- Create reservation (POST /reservations); the row appears once the server has saved it ----
  async function createReservation(input: {
    unitId: string; channel: BookingChannel; guestName: string; phone: string; email: string;
    checkIn: string; checkOut: string; guestsCount: number; grossSen: number;
  }) {
    const unit = UNITS.find(u => u.id === input.unitId) ?? UNITS[0];
    if (!unit) return;
    try {
      const res = await api.post<{ id: string }>('/reservations', {
        unitId: input.unitId, channel: input.channel,
        guest: { fullName: input.guestName, email: input.email || null, phone: input.phone || null },
        checkIn: input.checkIn, checkOut: input.checkOut, guestsCount: input.guestsCount, grossBookingValue: input.grossSen,
      });
      setCreating(false);
      setOpenId(res.id);
      toast({ tone: 'success', title: 'Reservation created.', body: `${input.guestName} · ${unit.propertyName} ${unit.unitNumber} · ${dateRange(input.checkIn, input.checkOut)}.` });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  // ---- Import reservations (CSV) ----
  function pickImportFile() { fileRef.current?.click(); }
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportRows(buildImport(String(reader.result ?? ''), UNITS));
    reader.readAsText(file);
  }
  // Reports the server's own count: rows it refused (e.g. clashing dates) are counted as rejected.
  async function commitImport() {
    if (!importRows) return;
    const valid = importRows.filter(p => p.row).map(p => p.row!);
    let created = 0, refused = 0;
    if (valid.length) {
      try {
        const r = await api.post<{ created: number; failed: unknown[] }>('/reservations/import', {
          rows: valid.map(r => ({
            unitNumber: r.unitNumber, channel: r.channel, guest: { fullName: r.guestName, phone: r.guestPhone },
            checkIn: r.checkIn, checkOut: r.checkOut, guestsCount: r.guestsCount, grossBookingValue: r.grossBookingValue,
          })),
        });
        created = r.created; refused = r.failed?.length ?? 0;
      } catch (e) { notifyFailure(e); return; }
    }
    const rejected = importRows.length - valid.length + refused;
    toast({
      tone: created ? 'success' : 'warning',
      title: created ? `Imported ${created} ${created === 1 ? 'reservation' : 'reservations'}.` : 'Nothing imported.',
      body: rejected ? `${rejected} ${rejected === 1 ? 'row was' : 'rows were'} rejected and left out.` : 'Every row was accepted.',
    });
    setImportRows(null);
    reload();
  }

  // ---- Download CSV: the server writes every booking matching this tab and these searches, not just this page ----
  async function exportCsv() {
    setExporting(true);
    try {
      await downloadFile('/reservations/export', Object.fromEntries(API_PARAMS.filter(k => k !== 'page' && k !== 'size').map(k => [k, params.get(k)])));
      toast({ tone: 'success', title: 'Export ready.', body: `${num(total)} ${total === 1 ? 'booking' : 'bookings'}. The first lines of the file name the filters and totals.` });
    } catch (e) { notifyFailure(e); }
    setExporting(false);
  }

  // ---- Message guest (POST /messages) — from the drawer or a row's chat icon ----
  function sendGuestMessage(body: string) {
    const r = messageRow;
    if (!r) return;
    const ch = r.channel === 'direct' ? 'WhatsApp' : CHANNEL_META[r.channel].label;
    api.post('/messages', { reservationId: r.id, body })
      .then(() => { setMessageRow(null); toast({ tone: 'success', title: `Message sent to ${r.guestName}.`, body: `Thread opened on ${ch}.` }); })
      .catch(notifyFailure);
  }

  // ---- Drawer → Duplicate booking (POST /reservations/:id/duplicate); opens the real copy once saved ----
  function duplicateReservation(r: Row) {
    api.post<{ id: string }>(`/reservations/${r.id}/duplicate`, {})
      .then(res => {
        setOpenId(res.id);
        toast({ tone: 'success', title: 'Reservation duplicated.', body: `${r.guestName} · ${r.propertyName} ${r.unitNumber}. Adjust the dates as needed.` });
        reload();
      })
      .catch(notifyFailure);
  }

  // ---- Drawer → Quick status update (PATCH /reservations/:id); rolled back if refused ----
  function updateStatus(r: Row, status: ReservationState) {
    if (status === r.state) return;
    const prev = edits[r.id];
    patch(r.id, { state: status });
    api.patch(`/reservations/${r.id}`, { status })
      .then(() => { toast({ tone: 'neutral', title: 'Status updated.', body: `${r.externalRef ?? 'Reservation'} is now ${STATE_LABEL[status]}.` }); reload(); })
      .catch(err => { setEdits(e => ({ ...e, [r.id]: prev ?? {} })); notifyFailure(err); });
  }

  // ---- Drawer → Change dates (PATCH /reservations/:id/dates) — optimistic, rolled back if refused ----
  async function submitChangeDates(vals: { checkIn: string; checkOut: string }) {
    if (!open) return;
    const r = open;
    const prev = edits[r.id];
    patch(r.id, { checkIn: vals.checkIn, checkOut: vals.checkOut, nights: nightsBetween(vals.checkIn, vals.checkOut) });
    try {
      await api.patch(`/reservations/${r.id}/dates`, { checkIn: vals.checkIn, checkOut: vals.checkOut, confirm: true });
      toast({ tone: 'success', title: 'Dates changed.', body: `${r.guestName} moved to ${dateRange(vals.checkIn, vals.checkOut)} and notified.` });
      reload();
    } catch (e) { setEdits(x => ({ ...x, [r.id]: prev ?? {} })); notifyFailure(e); }
    setDatesOpen(false);
  }

  const viewMeta = VIEWS.find(v => v.key === view)!;
  const sub = counts
    ? `${num(counts.upcoming)} upcoming or in house · ${num(counts.all)} bookings in total${searching ? ' matching your search' : ''}`
    : 'Loading bookings';

  return (
    <>
      <PageHeader title="Bookings" sub={sub}
        right={<div className="flex gap-[9px] flex-wrap">
          <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={pickImportFile}>Import</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportCsv} loading={exporting}
            disabled={!data || total === 0} disabledReason="Nothing to export for this tab and search.">Download CSV</Button>
          <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setCreating(true)}>Create reservation</Button>
        </div>} />

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onImportFile} className="hidden" aria-hidden />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        {/* Tabs, each with its count under the current searches */}
        <div role="tablist" aria-label="Booking views"
          className="flex gap-2 py-3 px-[22px] [border-bottom:1px_solid_var(--color-line)] overflow-x-auto [scrollbar-width:none] md:flex-wrap max-md:px-4">
          {VIEWS.map(v => {
            const on = view === v.key;
            const n = counts?.[v.key];
            return (
              <button key={v.key} role="tab" aria-selected={on} onClick={() => setView(v.key)}
                className={cx(
                  'flex-none h-8 inline-flex items-center gap-[6px] px-[13px] py-0 rounded-pill cursor-pointer [font-family:inherit] text-[12.5px] border border-solid whitespace-nowrap',
                  on ? 'font-semibold border-transparent bg-black text-white' : 'font-medium border-line bg-page text-muted-ink',
                )}>
                {v.label}
                <span className={cx('[font-variant-numeric:tabular-nums] min-w-[1ch]', on ? 'opacity-80' : 'opacity-70')}>{n === undefined ? '' : num(n)}</span>
              </button>
            );
          })}
        </div>

        {/* One search across reference, guest, phone, unit and building */}
        <div className="flex items-center gap-3 flex-wrap py-[10px] px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
          <label className="relative flex-[1_1_260px] max-w-[420px]">
            <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid"><Icon name="Search" size="sm" /></span>
            <input value={drafts.q} onChange={e => setSearch('q', e.target.value)} placeholder="Guest, phone, reference or unit"
              aria-label="Search bookings"
              className="h-9 w-full box-border rounded-control border border-solid border-line bg-card text-ink [font:inherit] text-[13px] pl-[32px] pr-3 py-0 outline-none" />
          </label>
          {searching && (
            <button type="button" onClick={clearSearches}
              className="h-8 inline-flex items-center gap-1 px-[10px] rounded-control border-none bg-transparent text-muted-ink [font:inherit] text-[12.5px] cursor-pointer hover:bg-muted">
              <Icon name="X" size="sm" /> Clear search
            </button>
          )}
          {/* Totals of the whole filtered set, so the owner reads the figure for the tab, not one page */}
          <dl className="m-0 ml-auto flex items-center gap-x-5 gap-y-1 flex-wrap text-[12.5px] min-h-[20px] max-md:ml-0 max-md:w-full">
            {totals && <>
              <Total label="Bookings" value={num(totals.bookings)} />
              <Total label="Nights" value={num(totals.nights)} />
              <Total label="Gross" value={rm(totals.gross, { cents: false })} />
              <Total label="Channel fees" value={rm(totals.fees, { cents: false })} />
            </>}
          </dl>
        </div>

        {/* Desktop and tablet: the sortable table. Its own scroll area keeps the header in view. */}
        <div ref={scrollRef} className="max-md:hidden overflow-auto max-h-[calc(100dvh-330px)] min-h-[360px]" aria-busy={loading}>
          <div className="min-w-[1010px]">
            <div className="sticky top-0 z-[2]">
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
              <div className={cx(COLS, 'grid gap-[14px] py-[7px] px-[22px] bg-page [border-bottom:1px_solid_var(--color-line-soft)]')}>
                {COLUMNS.map(c => (
                  <input key={c.key} value={drafts[c.param]} onChange={e => setSearch(c.param, e.target.value)}
                    placeholder={c.hint} aria-label={`Search ${c.label}`}
                    className={cx('h-7 w-full box-border rounded-control border border-solid border-line bg-card text-ink [font:inherit] text-[12px] px-2 py-0 outline-none', c.align === 'right' && 'text-right')} />
                ))}
                <div aria-hidden />
              </div>
            </div>

            {!data ? <TableSkeleton rows={8} cols={8} /> : rows.length === 0 ? (
              <EmptyList searching={searching} message={viewMeta.empty} onClear={clearSearches} />
            ) : (
              <div className={cx('transition-opacity duration-150', refreshing && 'opacity-55')}>
                {rows.map(b => {
                  const ch = CHANNEL_META[b.channel];
                  return (
                    <div key={b.id} role="button" tabIndex={0} onClick={() => setOpenId(b.id)}
                      onKeyDown={e => { if (e.key === 'Enter') setOpenId(b.id); }}
                      className={cx(COLS, 'grid gap-[14px] items-center min-h-[54px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer hover:bg-page')}>
                      <div className="flex items-center gap-[9px] min-w-0">
                        <ChannelMark ch={b.channel} size={20} />
                        <span className="font-mono text-[12px] whitespace-nowrap overflow-hidden text-ellipsis" title={b.externalRef ?? undefined}>{b.externalRef ?? '—'}</span>
                      </div>
                      <div className="flex flex-col gap-px min-w-0">
                        <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={b.guestName}>{b.guestName || '—'}</span>
                        <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{b.guestsCount > 0 ? `${b.guestsCount} ${b.guestsCount === 1 ? 'guest' : 'guests'}` : 'No guest'}</span>
                      </div>
                      <div className="flex flex-col gap-px min-w-0">
                        <span className="text-[13px] whitespace-nowrap overflow-hidden text-ellipsis" title={b.unitNumber}>{b.unitNumber}</span>
                        <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={b.propertyName}>{b.propertyName}</span>
                      </div>
                      <div>
                        <span className="inline-flex items-center h-[22px] px-[9px] rounded-pill text-[11.5px] font-semibold whitespace-nowrap" style={{ background: ch.tint, color: ch.ink }}>{ch.label}</span>
                      </div>
                      <div className="flex flex-col gap-px min-w-0">
                        <span className="text-[12.5px] whitespace-nowrap">{dateRange(b.checkIn, b.checkOut)}</span>
                        <span className="text-[11.5px] text-muted-ink">{fmtNights(b.nights)}</span>
                      </div>
                      <div className="text-right text-[13px] font-medium [font-variant-numeric:tabular-nums] whitespace-nowrap">{b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '—'}</div>
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
            )}
          </div>
        </div>

        {/* Phones: one condensed card per booking, no wide table */}
        <div className="md:hidden" aria-busy={loading}>
          {!data ? <TableSkeleton rows={6} cols={2} /> : rows.length === 0 ? (
            <EmptyList searching={searching} message={viewMeta.empty} onClear={clearSearches} />
          ) : (
            <ul className={cx('list-none m-0 p-0 transition-opacity duration-150', refreshing && 'opacity-55')}>
              {rows.map(b => (
                <li key={b.id} className="[border-bottom:1px_solid_var(--color-line-soft)]">
                  <button type="button" onClick={() => setOpenId(b.id)}
                    className="w-full text-left [font:inherit] text-ink bg-transparent border-none cursor-pointer py-3 px-4 flex gap-3 items-start">
                    <ChannelMark ch={b.channel} size={22} />
                    <span className="flex flex-col gap-[3px] min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{b.guestName || '—'}</span>
                        <span className="text-[13px] font-medium [font-variant-numeric:tabular-nums] whitespace-nowrap">{b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '—'}</span>
                      </span>
                      <span className="text-[12px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{b.unitNumber} · {b.propertyName}</span>
                      <span className="flex items-center justify-between gap-2 pt-[2px]">
                        <span className="text-[12px] whitespace-nowrap">{dateRange(b.checkIn, b.checkOut)} · {fmtNights(b.nights)}</span>
                        <Badge tone={STATE_TONE[b.state]} label={STATE_LABEL[b.state]} size="sm" />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data && total > 0 && (
          <PageControls page={page} pageSize={pageSize} total={total} onPage={goPage} onSize={setSize} sizes={[25, 50, 100, 200]}
            noun={total === 1 ? 'booking' : 'bookings'} className="[border-top:1px_solid_var(--color-line)] max-md:px-4" />
        )}
      </Card>

      <Drawer open={!!open} onClose={() => setOpenId(null)} width={440}>
        {open && <ReservationPanel key={open.id} r={open} onClose={() => setOpenId(null)} onMessage={() => setMessageRow(open)} onChangeDates={() => setDatesOpen(true)} onCancel={() => cancel(open)} onDuplicate={() => duplicateReservation(open)} onStatus={s => updateStatus(open, s)} />}
      </Drawer>
      <Dialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />

      {creating && <CreateReservationModal units={UNITS} prefill={prefill} onClose={() => setCreating(false)} onCreate={createReservation} />}
      {importRows && <ImportPreviewModal rows={importRows} onClose={() => setImportRows(null)} onConfirm={commitImport} />}
      {messageRow && <MessageModal r={messageRow} onClose={() => setMessageRow(null)} onSend={sendGuestMessage} />}
      {open && datesOpen && <ChangeDatesModal r={open} onClose={() => setDatesOpen(false)} onConfirm={submitChangeDates} />}
    </>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-[6px]">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="m-0 font-semibold text-ink [font-variant-numeric:tabular-nums]">{value}</dd>
    </div>
  );
}

function EmptyList({ searching, message, onClear }: { searching: boolean; message: string; onClear: () => void }) {
  return (
    <div className="py-[42px] px-[22px] flex flex-col items-center gap-3 text-center">
      <span className="text-[13.5px] text-muted-ink">{searching ? 'No bookings match this search in this tab.' : message}</span>
      {searching && <Button size="sm" variant="secondary" onClick={onClear}>Clear search</Button>}
    </div>
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
  { actorLabel: 'Channel sync', action: 'reservation.created', source: 'channel_webhook', occurredAt: '2026-09-12T10:02:00+08:00' },
  { actorLabel: 'Aina Zulkifli', action: 'payment.recorded', source: 'operator', occurredAt: '2026-09-12T10:05:00+08:00' },
  { actorLabel: 'System', action: 'access_code.sent', source: 'automation', occurredAt: '2026-09-16T13:00:00+08:00' },
];

function ActivityLog({ r }: { r: Row }) {
  const { data } = useApi<{ data: ActivityItem[] }>(`/audit?entityTable=reservations&entityId=${r.id}`, { data: ACTIVITY_FALLBACK });
  const items = data?.data ?? [];
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
            <span className="text-[11px] text-muted-ink">{a.source.replace(/_/g, ' ')} · {dateTime(a.occurredAt)}</span>
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

function buildImport(text: string, UNITS: RosterUnit[]): ParsedRow[] {
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
      grossBookingValue: Math.round(rateNum * 100), channelFee: 0, paidAt: null, receivedAt: nowStamp(),
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

function CreateReservationModal({ units: UNITS, prefill, onClose, onCreate }: {
  units: RosterUnit[];
  prefill?: { guestName?: string; phone?: string; email?: string } | null;
  onClose: () => void;
  onCreate: (input: { unitId: string; channel: BookingChannel; guestName: string; phone: string; email: string; checkIn: string; checkOut: string; guestsCount: number; grossSen: number }) => void;
}) {
  const [unitId, setUnitId] = useState(UNITS[0]?.id ?? '');
  const [channel, setChannel] = useState<BookingChannel>('direct');
  const [guestName, setGuestName] = useState(prefill?.guestName ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
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
