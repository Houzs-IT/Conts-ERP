import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { BookingDrawer, MessageGuestModal, CentreModal } from '../components/booking/BookingDrawer';
import { UnitPicker } from '../components/booking/UnitPicker';
import { channelNote, STATUS } from '../lib/bookingStatus';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Field } from '../components/Field';
import { DateField, TimeField, NumberInput, MoneyInput, PhoneInput } from '../components/inputs';
import { Select } from '../components/Select';
import { DataTable, type Column, type ViewPreset } from '../components/DataTable';
import { BulkAssignCleaner } from '../components/BulkAssignCleaner';
import { fetchAllPages } from '../lib/export';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { useUnitRoster, type RosterUnit } from '../lib/useUnitRoster';
import { useToast } from '../components/Toast';
import { api, notifyFailure, downloadFile, ApiFailure, errorMessage } from '../lib/api';
import { rm, dateRange, nights as fmtNights, guests as fmtGuests, todayMyt, plural, count as countLabel } from '../lib/format';
import { CHANNEL_META, cx } from '../lib/design-tokens';
import type { BookingChannel, ReservationState } from '../lib/types';
import { statusOptions } from '../lib/status';

interface Row {
  id: string; externalRef: string | null; guestName: string; guestsCount: number;
  guestPhone: string | null; guestCountry: string | null; guestNationality: string | null;
  unitNumber: string; propertyName: string; channel: BookingChannel;
  state: ReservationState; checkIn: string; checkOut: string; checkInTime: string; checkOutTime: string;
  nights: number; grossBookingValue: number; channelFee: number; collectedRevenue: number;
  expectedPayout: number; received: number; outstanding: number; createdAt: string;
  /** Where the guest is from: their nationality, else their phone's country. */
  country: { code: string; name: string; from: 'nationality' | 'phone' } | null;
}

/** Five tabs, no overlap: every reservation is in exactly one of the first four, and All is their sum. The words are
 *  Airbnb's host statuses, as the owner decided (docs/VOCABULARY.md). */
const VIEWS = [
  { key: 'upcoming', label: 'Upcoming', empty: 'No upcoming reservations.' },
  { key: 'inhouse', label: 'Currently hosting', empty: 'Nobody is staying right now.' },
  { key: 'past', label: 'Past', empty: 'No past reservations yet.' },
  { key: 'cancelled', label: 'Cancelled', empty: 'No cancelled reservations.' },
  { key: 'all', label: 'All', empty: 'No reservations yet.' },
] as const;
type ViewKey = typeof VIEWS[number]['key'];

/** Things to do. A card filters the list; it is not another tab. "Arriving today" is a ready-made view, not a card. */
const TODOS = [
  { key: 'soon', label: 'Arriving soon', hint: 'Check-in today or tomorrow', empty: 'Nobody arrives today or tomorrow.', money: false, card: true },
  { key: 'departing', label: 'Checking out', hint: 'Checkout today', empty: 'Nobody checks out today.', money: false, card: true },
  { key: 'unpaid', label: 'Unpaid direct', hint: 'Direct guests who still owe', empty: 'Every direct reservation is paid.', money: true, card: true },
  { key: 'payout', label: 'Channel payout pending', hint: 'Finished stays not paid out yet', empty: 'Every finished channel stay is paid out.', money: true, card: true },
  { key: 'arriving', label: 'Arriving today', hint: 'Check-in today', empty: 'Nobody arrives today.', money: false, card: false },
] as const;
type TodoKey = typeof TODOS[number]['key'];
type Facet = { value: string; count: number; label?: string };

interface Payload {
  data: Row[]; total: number; page: number; pageSize: number; generatedAt: string; today: string; view: ViewKey; todo: TodoKey | null;
  counts: Record<ViewKey, number>;
  todos: Record<TodoKey, { count: number; outstanding: number }>;
  totals: { bookings: number; nights: number; gross: number; fees: number; outstanding: number };
  buildings: { id: string; name: string }[];
  paymentsReady: boolean;
  /** Each filter's values with how many reservations each would show. */
  facets?: { ch: Facet[]; building: Facet[]; st: Facet[]; country: Facet[] };
}

const SAMPLE: Row[] = [
  { id: 'b1', externalRef: 'HMF4323EHS', guestName: 'Nadia Abdullah', guestsCount: 2, guestPhone: null, guestCountry: 'MY', guestNationality: null, unitNumber: 'A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', state: 'checked_in', checkIn: '2026-09-16', checkOut: '2026-09-19', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 85200, channelFee: 12780, collectedRevenue: 0, expectedPayout: 72420, received: 0, outstanding: 72420, createdAt: '2026-09-12T02:02:00Z', country: { code: 'MY', name: 'Malaysia', from: 'nationality' } },
];
const FALLBACK: Payload = {
  total: 1, page: 1, pageSize: 50, generatedAt: '', today: '2026-09-16', view: 'upcoming', todo: null, data: SAMPLE,
  counts: { upcoming: 0, inhouse: 1, past: 0, cancelled: 0, all: 1 },
  todos: { arriving: { count: 0, outstanding: 0 }, soon: { count: 0, outstanding: 0 }, departing: { count: 0, outstanding: 0 }, unpaid: { count: 0, outstanding: 0 }, payout: { count: 0, outstanding: 0 } },
  totals: { bookings: 1, nights: 3, gross: 85200, fees: 12780, outstanding: 72420 }, buildings: [], paymentsReady: true,
};

/** Searches the server reads. The column searches are kept for links from global search (?ref=, ?guest=). */
const SEARCH_PARAMS = ['q', 'ref', 'guest', 'unit', 'channel', 'stay', 'gross', 'status'];
const FILTER_PARAMS = ['ch', 'building', 'st', 'country', 'from', 'to', 'nightsMin', 'nightsMax', 'grossMin', 'grossMax'];
/** URL parameters the server reads. The drawer's `open` stays out so opening a booking does not refetch the list. */
const API_PARAMS = ['view', 'todo', 'sort', 'page', 'size', ...SEARCH_PARAMS, ...FILTER_PARAMS];
const CHANNEL_CHOICES: BookingChannel[] = ['airbnb', 'booking_com', 'agoda', 'direct'];
const MONEY_ROLES = ['management', 'finance_admin', 'operations_manager'];
const OPS_ROLES = ['management', 'operations_manager', 'operations_staff'];

const nightsBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5);
const num = (v: number) => countLabel(v);
const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => { const d = new Date(Date.parse(`${monthStart(iso)}T00:00:00Z`)); d.setUTCMonth(d.getUTCMonth() + 1); return shiftDay(d.toISOString().slice(0, 10), -1); };

/** Ready-made views under Views: the lists the front desk opens every day. */
const PRESETS: ViewPreset[] = [
  { id: 'arriving-today', name: 'Arriving today', hint: 'Check-in today', params: () => ({ view: 'all', todo: 'arriving' }) },
  { id: 'checking-out-today', name: 'Checking out today', hint: 'Checkout today', params: () => ({ view: 'all', todo: 'departing' }) },
  { id: 'currently-hosting', name: 'Currently hosting', hint: 'Guests staying now', params: () => ({ view: 'inhouse' }) },
  { id: 'unpaid-direct', name: 'Unpaid direct reservations', hint: 'Direct guests who still owe money', params: () => ({ view: 'all', todo: 'unpaid' }) },
  { id: 'payout-pending', name: 'Channel payout pending', hint: 'Finished Airbnb, Booking.com and Agoda stays not paid out yet', params: () => ({ view: 'all', todo: 'payout' }) },
  { id: 'cancelled-month', name: 'Cancelled this month', hint: 'Cancelled stays with nights this month', params: () => ({ view: 'cancelled', from: monthStart(todayMyt()), to: monthEnd(todayMyt()) }) },
  { id: 'long-stays', name: 'Long stays (28+ nights)', hint: 'Every status', params: () => ({ view: 'all', nightsMin: '28' }) },
];

/** Rows per import request (the server takes at most 100). */
const IMPORT_PART = 50;

export default function BookingsPage() {
  const UNITS = useUnitRoster();
  const toast = useToast();
  const { user } = useSession();
  const canMoney = !!user && MONEY_ROLES.includes(user.role);
  const canOps = !!user && OPS_ROLES.includes(user.role);

  // URL-as-state (react-router, HashRouter): tab, card, filters, sort, page and search live in the query
  // string, so a link or a refresh shows the same list. The calendar deep-links with ?create=1.
  const [params, setParams] = useSearchParams();
  function updateParams(mut: (p: URLSearchParams) => void) {
    setParams(prev => { const next = new URLSearchParams(prev); mut(next); return next; }, { replace: true });
  }

  const rawView = params.get('view');
  const view: ViewKey = VIEWS.some(v => v.key === rawView) ? (rawView as ViewKey) : 'upcoming';
  const rawTodo = params.get('todo');
  const todo: TodoKey | null = TODOS.some(t => t.key === rawTodo) ? (rawTodo as TodoKey) : null;

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of API_PARAMS) { const v = params.get(k); if (v) p.set(k, v); }
    return p.toString();
  }, [params]);
  const { data, loading, error, reload } = useApi<Payload>(`/reservations${apiQuery ? `?${apiQuery}` : ''}`, FALLBACK);

  // The search box answers every keystroke locally; the URL (and so the server) follows once typing pauses.
  const [draft, setDraft] = useState(params.get('q') ?? '');
  const timer = useRef<number | undefined>(undefined);
  function setSearch(value: string) {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => updateParams(p => {
      if (value.trim()) p.set('q', value); else p.delete('q');
      p.delete('page');
    }), 300);
  }
  function clearAll() {
    window.clearTimeout(timer.current);
    setDraft('');
    updateParams(p => { [...SEARCH_PARAMS, ...FILTER_PARAMS, 'todo'].forEach(k => p.delete(k)); p.delete('page'); });
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A saved view can change the search; keep the box in step.
  const urlQ = params.get('q') ?? '';
  useEffect(() => { setDraft(d => (d.trim() === urlQ.trim() ? d : urlQ)); }, [urlQ]);
  const searching = SEARCH_PARAMS.some(k => params.get(k)) || FILTER_PARAMS.some(k => params.get(k));

  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [creating, setCreating] = useState(false);
  // Guests' "Book a stay" passes the guest in router state (kept out of the URL); the Calendar passes the unit and
  // nights it was opened from (?forUnit=&checkIn=&checkOut=). Captured when the form opens, because stripping the
  // flags below replaces the location and drops the state.
  const location = useLocation();
  const [prefill, setPrefill] = useState<CreatePrefill | null>(null);
  const [importRows, setImportRows] = useState<ParsedRow[] | null>(null);
  const [messageRow, setMessageRow] = useState<Row | null>(null);
  const [bulkPayout, setBulkPayout] = useState<{ rows: Row[]; clear: () => void } | null>(null);
  const [bulkAssign, setBulkAssign] = useState<{ ids: string[]; clear: () => void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (params.get('create') === '1') {
      setPrefill({
        ...((location.state ?? {}) as CreatePrefill),
        unitId: params.get('forUnit') ?? undefined, checkIn: params.get('checkIn') ?? undefined, checkOut: params.get('checkOut') ?? undefined,
        kind: params.get('kind') === 'owner_stay' ? 'owner_stay' : undefined,
      });
      setCreating(true);
      updateParams(p => { p.delete('create'); p.delete('forUnit'); p.delete('checkIn'); p.delete('checkOut'); p.delete('kind'); });
    }
    const o = params.get('open');
    if (o) { setOpenId(o); updateParams(p => p.delete('open')); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.data ?? [];
  const onPage = openId ? rows.find(r => r.id === openId) ?? null : null;
  useEffect(() => {
    if (window.matchMedia('(max-width: 767.98px)').matches) document.querySelector('main')?.scrollTo({ top: 0 });
  }, [data?.page, data?.view, data?.todo]);
  const total = data?.total ?? 0;
  const counts = data?.counts;
  const totals = data?.totals;

  function setView(key: ViewKey) {
    updateParams(p => { if (key === 'upcoming') p.delete('view'); else p.set('view', key); p.delete('todo'); p.delete('page'); });
  }
  function setTodo(key: TodoKey) {
    updateParams(p => {
      if (p.get('todo') === key) { p.delete('todo'); p.delete('view'); } else { p.set('todo', key); p.set('view', 'all'); }
      p.delete('page');
    });
  }

  async function createReservation(input: CreateInput): Promise<Record<string, string> | undefined> {
    const unit = UNITS.find(u => u.id === input.unitId);
    if (!unit) { toast({ tone: 'critical', title: 'Pick a unit first.' }); return; }
    try {
      const res = await api.post<{ id: string; externalRef: string; effects?: { channel: 'queued' | 'not_linked' | 'failed' } }>('/reservations', {
        unitId: input.unitId, channel: input.channel,
        guest: input.guestName ? { fullName: input.guestName, email: input.email || null, phone: input.phone || null } : undefined,
        checkIn: input.checkIn, checkOut: input.checkOut, checkInTime: input.checkInTime, checkOutTime: input.checkOutTime,
        guestsCount: input.guestsCount, grossBookingValue: input.grossSen, externalRef: input.externalRef || undefined, notes: input.notes || undefined,
      });
      setCreating(false);
      const owner = input.channel === 'owner_stay';
      toast({
        tone: res.effects?.channel === 'failed' ? 'warning' : 'success',
        title: owner ? `Owner stay ${res.externalRef} saved.` : `Reservation ${res.externalRef} created.`,
        body: [`${owner ? '' : `${input.guestName} · `}${unit.propertyName} ${unit.unitNumber} · ${dateRange(input.checkIn, input.checkOut)}.`,
          channelNote(res.effects?.channel, 'held'), owner ? 'Owner stays show on the calendar and the unit page, not in this list.' : ''].filter(Boolean).join(' '),
      });
      if (!owner) setOpenId(res.id);
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Reservation not created.', body: errorMessage(e, 'Try again in a moment.') });
      if (e instanceof ApiFailure && e.fields) return e.fields;
    }
  }

  function pickImportFile() { fileRef.current?.click(); }
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportRows(buildImport(String(reader.result ?? ''), UNITS));
    reader.readAsText(file);
  }
  // Reports the server's own count: rows it refused (e.g. clashing dates) are counted as rejected, and how many
  // bookings had their nights closed on the booking sites.
  async function commitImport() {
    if (!importRows) return;
    const valid = importRows.filter(p => p.row).map(p => p.row!);
    let created = 0, refused = 0, failedSync = 0, queued = 0;
    if (valid.length) {
      // In parts of IMPORT_PART rows: each row is about eight queries, and 500 in one request took 70 seconds.
      for (let i = 0; i < valid.length; i += IMPORT_PART) {
        try {
          const r = await api.post<{ created: number; failed: unknown[]; effects?: { channels: { queued: number; not_linked: number; failed: number } } }>('/reservations/import', {
            rows: valid.slice(i, i + IMPORT_PART).map(r => ({
              unitNumber: r.unitNumber, channel: r.channel, guest: { fullName: r.guestName, phone: r.guestPhone },
              checkIn: r.checkIn, checkOut: r.checkOut, guestsCount: r.guestsCount, grossBookingValue: r.grossBookingValue, externalRef: r.externalRef,
            })),
          });
          created += r.created; refused += r.failed?.length ?? 0;
          failedSync += r.effects?.channels.failed ?? 0; queued += r.effects?.channels.queued ?? 0;
        } catch (e) {
          // Parts already sent stay imported; say how far it got so nothing is entered twice.
          notifyFailure(e);
          if (!created) return;
          toast({ tone: 'warning', title: `Imported ${plural(created, 'reservation')} before it stopped.`, body: 'The rest were not imported. Remove the imported rows from the file before trying again.' });
          setImportRows(null); reload(); return;
        }
      }
    }
    const rejected = importRows.length - valid.length + refused;
    toast({
      tone: created && !failedSync ? 'success' : 'warning',
      title: created ? `Imported ${plural(created, 'reservation')}.` : 'Nothing imported.',
      body: [rejected ? `${plural(rejected, 'row')} ${rejected === 1 ? 'was' : 'were'} rejected and left out.` : 'Every row was accepted.',
        queued ? `${plural(queued, 'stay')} closed on the channels.` : '',
        failedSync ? `${plural(failedSync, 'stay')} could not be closed on the channels; check Integrations.` : ''].filter(Boolean).join(' '),
    });
    setImportRows(null);
    reload();
  }

  // The money CSV: every column the server has (room, fees, taxes, each payment), not just the table's columns.
  async function exportCsv() {
    setExporting(true);
    try {
      await downloadFile('/reservations/export', Object.fromEntries(API_PARAMS.filter(k => k !== 'page' && k !== 'size').map(k => [k, params.get(k)])));
      toast({ tone: 'success', title: 'Export ready.', body: `${plural(total, 'reservation')} with the money breakdown and payments. The first lines name the filters and totals.` });
    } catch (e) { notifyFailure(e); }
    setExporting(false);
  }

  /** Every booking under the current tab, card, filters and sort, for the table's Export. */
  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const q: Record<string, string> = { export: '1' };
    for (const k of API_PARAMS) { const v = params.get(k); if (v && k !== 'page' && k !== 'size') q[k] = v; }
    const r = await fetchAllPages<Row>(async (page, size) => {
      const p = await api.get<Payload>('/reservations', { ...q, page, size });
      return { rows: p.data, total: p.total };
    }, { onProgress });
    return r.rows;
  }

  const moneyTodo = !!TODOS.find(t => t.key === todo)?.money;
  const facets = data?.facets;
  const buildingName = useMemo(() => new Map((data?.buildings ?? []).map(b => [b.id, b.name])), [data?.buildings]);
  const columns = useMemo<Column<Row>[]>(() => {
    const opts = (list: Facet[] | undefined, label: (v: string) => string) => list?.map(f => ({ value: f.value, label: f.label ?? label(f.value), count: f.count }));
    return [
      { key: 'reference', label: 'Reference', type: 'ref', value: r => r.externalRef, sortKey: 'reference', width: 150, hideable: false,
        filter: { kind: 'text', param: 'ref' },
        render: b => (
          <span className="flex items-center gap-[9px] min-w-0">
            <ChannelMark ch={b.channel} size={20} />
            <span className="font-mono text-meta whitespace-nowrap overflow-hidden text-ellipsis" title={`${CHANNEL_META[b.channel].label} · ${b.externalRef ?? ''}`}>{b.externalRef ?? '—'}</span>
          </span>
        ) },
      { key: 'guest', label: 'Guest', value: r => r.guestName, sortKey: 'guest', width: 170, filter: { kind: 'text', param: 'guest' },
        render: b => <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis block" title={b.guestName}>{b.guestName || '—'}</span>,
        sub: b => (b.guestsCount > 0 ? fmtGuests(b.guestsCount) : '—') },
      { key: 'country', label: 'Country', value: r => r.country?.name ?? null, sortKey: 'country', width: 130,
        title: "The guest's nationality when we have it, otherwise the country of their phone number.",
        filter: { kind: 'select', param: 'country', multi: true, options: opts(facets?.country, v => v) },
        render: b => b.country
          ? <span className="block whitespace-nowrap overflow-hidden text-ellipsis" title={b.country.from === 'phone' ? `${b.country.name}, from the phone number` : `${b.country.name}, nationality`}>{b.country.name}</span>
          : <span className="text-muted-ink">—</span> },
      { key: 'unit', label: 'Unit', value: r => r.unitNumber, text: r => `${r.unitNumber} ${r.propertyName}`, sortKey: 'unit', width: 140,
        filter: { kind: 'text', param: 'unit' }, exportValue: r => r.unitNumber, sub: b => b.propertyName },
      { key: 'building', label: 'Building', value: r => r.propertyName, hidden: true, width: 150,
        filter: { kind: 'select', param: 'building', multi: true, options: opts(facets?.building, v => buildingName.get(v) ?? v) } },
      { key: 'channel', label: 'Channel', type: 'channel', value: r => r.channel, sortKey: 'channel', hidden: true, width: 130,
        filter: { kind: 'select', param: 'ch', multi: true, options: opts(facets?.ch, v => CHANNEL_META[v as BookingChannel]?.label ?? v) ?? CHANNEL_CHOICES.map(c => ({ value: c, label: CHANNEL_META[c].label })) } },
      { key: 'stay', label: 'Check-in to checkout', type: 'date', value: r => r.checkIn, sortKey: 'stay', width: 160,
        filter: { kind: 'date', params: ['from', 'to'], hint: 'Stays with nights in these dates' },
        render: b => <span className="whitespace-nowrap">{dateRange(b.checkIn, b.checkOut)}</span>, sub: b => fmtNights(b.nights),
        exportKind: 'text', exportValue: r => `${r.checkIn} to ${r.checkOut}` },
      { key: 'checkIn', label: 'Check-in', type: 'date', value: r => r.checkIn, hidden: true, filter: false, sortKey: 'stay' },
      { key: 'checkOut', label: 'Checkout', type: 'date', value: r => r.checkOut, hidden: true, filter: false },
      { key: 'nights', label: 'Nights', type: 'number', value: r => r.nights, hidden: true, sortKey: 'nights', width: 80,
        filter: { kind: 'number', params: ['nightsMin', 'nightsMax'], presets: [{ label: '1 night', value: '1~1' }, { label: '7+ nights', value: '7~' }, { label: '28+ nights', value: '28~' }] } },
      { key: 'guests', label: 'Guests', type: 'number', value: r => r.guestsCount, hidden: true, sortKey: 'guests', filter: false, width: 80 },
      { key: 'phone', label: 'Phone', type: 'phone', value: r => r.guestPhone, hidden: true, filter: false, width: 140 },
      { key: 'gross', label: 'Guest total', type: 'money', value: r => (r.grossBookingValue > 0 ? r.grossBookingValue : null), sortKey: 'gross', width: 120,
        title: 'What the guest paid for the stay: room, fees and the taxes we collect. Tax a channel keeps is not included.',
        filter: { kind: 'number', params: ['grossMin', 'grossMax'], presets: false },
        render: b => <span className="font-medium tabular-nums whitespace-nowrap">{b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '—'}</span>,
        sub: b => (moneyTodo && b.outstanding > 0 ? <span className="text-warning tabular-nums">{rm(b.outstanding, { cents: false })} owed</span> : null) },
      { key: 'fee', label: 'Service fee', type: 'money', value: r => r.channelFee, hidden: true, sortKey: 'fee', filter: false },
      { key: 'expected', label: 'Host payout', type: 'money', value: r => r.expectedPayout, hidden: true, filter: false },
      { key: 'received', label: 'Received', type: 'money', value: r => r.received, hidden: true, filter: false },
      { key: 'outstanding', label: 'Outstanding', type: 'money', value: r => (['cancelled', 'no_show'].includes(r.state) ? 0 : r.outstanding), hidden: true, filter: false },
      { key: 'status', label: 'Status', type: 'status', value: r => r.state, text: r => STATUS[r.state]?.label ?? r.state, sortKey: 'status', width: 150,
        filter: { kind: 'select', param: 'st', multi: true, options: opts(facets?.st, v => STATUS[v as ReservationState]?.label ?? v) ?? statusOptions('booking').map(o => ({ value: o.value, label: o.label })) },
        render: b => <StatusBadge entity="booking" value={b.state} size="sm" /> },
      { key: 'created', label: 'Booked on', type: 'datetime', value: r => r.createdAt, hidden: true, sortKey: 'created', filter: false },
      { key: 'chat', label: 'Chat', width: 56, align: 'center', noExport: true, sortable: false, filter: false,
        render: b => (
          <button type="button" title="Message guest" aria-label={`Message ${b.guestName}`}
            onClick={e => { e.stopPropagation(); setMessageRow(b); }}
            className="w-8 h-8 grid place-items-center rounded-control text-muted-ink bg-transparent border-none cursor-pointer hover:bg-muted">
            <Icon name="MessageSquare" size="sm" />
          </button>
        ) },
    ];
  }, [moneyTodo, facets, buildingName]);

  const viewMeta = VIEWS.find(v => v.key === view)!;
  const todoMeta = todo ? TODOS.find(t => t.key === todo)! : null;
  const sub = counts && todoMeta ? `${todoMeta.label}: ${plural(counts.all, 'reservation')}${searching ? ' matching the filters' : ''}`
  : counts
    ? `${num(counts.upcoming)} upcoming · ${num(counts.inhouse)} currently hosting · ${plural(counts.all, 'reservation')} in total${searching ? ' matching the filters' : ''}`
    : 'Loading reservations';

  return (
    <>
      <PageHeader title="Reservations" sub={sub}
        actions={<>
          <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={pickImportFile}>Import</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />} onClick={exportCsv} loading={exporting}
            title="Every reservation under these filters with the full money breakdown and each payment, as CSV."
            disabled={!data || total === 0} disabledReason="Nothing to export for this tab and these filters.">Money CSV</Button>
        </>}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => { setPrefill(null); setCreating(true); }}>Create reservation</Button>} />

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onImportFile} className="hidden" aria-hidden />

      {/* To do: cards that filter the list. One swipeable row on a phone. */}
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-md:flex max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:-mx-4 max-md:px-4 max-md:snap-x shrink-0" role="group" aria-label="To do">
        {TODOS.filter(t => t.card).map(t => {
          const c = data?.todos?.[t.key];
          const on = todo === t.key;
          const warn = t.money && (c?.count ?? 0) > 0;
          return (
            <button key={t.key} type="button" onClick={() => setTodo(t.key)} aria-pressed={on} title={t.hint}
              className={cx('text-left [font:inherit] rounded-card border border-solid px-4 py-3 max-md:py-2.5 cursor-pointer flex flex-col gap-1 min-w-0 transition-colors max-md:flex-[0_0_auto] max-md:min-w-[150px] max-md:snap-start',
                on ? 'bg-black text-white border-black' : warn ? 'bg-warning-bg border-warning-line text-ink hover:border-warning' : 'bg-card border-line text-ink hover:border-muted-ink')}>
              <span className={cx('text-meta whitespace-nowrap', on ? 'text-[rgba(255,255,255,0.75)]' : warn ? 'text-warning' : 'text-muted-ink')}>{t.label}</span>
              <span className="text-heading font-semibold [font-variant-numeric:tabular-nums] whitespace-nowrap overflow-hidden text-ellipsis">
                {c ? num(c.count) : '–'}{t.money && c && c.count > 0 ? <span className="font-medium"> · {rm(c.outstanding, { cents: false })}</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      <DataTable<Row>
        id="bookings" columns={columns} rows={data ? rows : null} rowKey={r => r.id} fill presets={PRESETS}
        loading={loading} error={error} onRetry={reload} onRowClick={b => setOpenId(b.id)}
        rowTone={b => (b.id === openId ? 'gold' : null)}
        server={{ total, page: data?.page ?? 1, pageSize: data?.pageSize ?? 50, sizes: [25, 50, 100, 200], defaultPageSize: 50, fetchAll }}
        viewParams={['view', 'todo', 'q']} filtered={searching || !!todo} onClearFilters={clearAll}
        noun={['reservation', 'reservations']} exportName="reservations" selectionKey={`${view}|${todo ?? ''}`}
        empty={{ title: todoMeta?.empty ?? viewMeta.empty, icon: 'CalendarDays' }}
        selectable={canMoney || canOps}
        bulkActions={(picked, clear) => <>
          {canOps && (
            <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setBulkAssign({ ids: picked.map(r => r.id), clear })}>Assign cleaner</Button>
          )}
          {canMoney && data?.paymentsReady && (
            <Button size="sm" variant="primary" icon={<Icon name="CheckCircle2" size="sm" />} onClick={() => setBulkPayout({ rows: picked, clear })}>Mark payouts received</Button>
          )}
        </>}
        header={
          <div className="flex items-center gap-2 py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
            <div role="tablist" aria-label="Reservation status" className="flex gap-2 overflow-x-auto [scrollbar-width:none] max-md:-mx-4 max-md:px-4 min-w-0">
              {VIEWS.map(v => {
                const on = !todo && view === v.key;
                const n = counts?.[v.key];
                return (
                  <button key={v.key} role="tab" aria-selected={on} onClick={() => setView(v.key)}
                    className={cx('flex-none h-9 inline-flex items-center gap-[6px] px-[13px] py-0 rounded-pill cursor-pointer [font-family:inherit] text-copy border border-solid whitespace-nowrap',
                      on ? 'font-semibold border-transparent bg-black text-white' : 'font-medium border-line bg-page text-muted-ink')}>
                    {v.label}
                    <span className={cx('[font-variant-numeric:tabular-nums] min-w-[1ch]', on ? 'opacity-80' : 'opacity-70')}>{n === undefined ? '' : num(n)}</span>
                  </button>
                );
              })}
            </div>
            {todoMeta && (
              <span className="ml-auto max-md:hidden inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full bg-black text-white text-meta whitespace-nowrap">
                {todoMeta.label}
                <button type="button" aria-label={`Remove ${todoMeta.label}`} onClick={() => setTodo(todoMeta.key)}
                  className="w-6 h-6 grid place-items-center rounded-full border-none bg-transparent text-white cursor-pointer hover:bg-[rgba(255,255,255,0.15)]"><Icon name="X" size="sm" /></button>
              </span>
            )}
          </div>
        }
        toolbar={<>
          <label className="relative flex-[1_1_260px] min-w-[200px] max-w-[460px] max-md:max-w-none">
            <span className="absolute left-[11px] top-1/2 -translate-y-1/2 text-muted-ink grid pointer-events-none"><Icon name="Search" size="sm" /></span>
            <input value={draft} onChange={e => setSearch(e.target.value)} placeholder="Name, phone, reference, unit or country" type="search"
              aria-label="Search reservations" title="A name in any order, any reference, a phone number in any format or its last 4 digits"
              className="h-10 md:h-9 w-full box-border rounded-control border border-solid border-line bg-card text-ink font-sans text-copy pl-[33px] pr-3 py-0 outline-none" />
          </label>
          {(searching || todo) && <Button variant="tertiary" size="sm" icon={<Icon name="X" size="sm" />} onClick={clearAll}>Clear filters</Button>}
        </>}
        above={totals && (
          <dl className="m-0 flex items-center gap-x-5 gap-y-1 flex-wrap text-meta min-h-[20px] py-2 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
            {todoMeta && <span className="font-semibold text-ink md:hidden">{todoMeta.label}</span>}
            <Total label="Reservations" value={num(totals.bookings)} />
            <Total label="Nights" value={num(totals.nights)} />
            <Total label="Guest total" value={rm(totals.gross, { cents: false })} />
            <Total label="Service fees" value={rm(totals.fees, { cents: false })} />
            {todoMeta?.money && <Total label={todo === 'unpaid' ? 'Owed by guests' : 'Owed by channels'} value={rm(totals.outstanding, { cents: false })}
              title={todo === 'unpaid' ? 'Guest total less what has been received, for these direct reservations.' : 'The host payout expected less what has arrived, for these finished stays.'} />}
            {todo === 'payout' && canMoney && <span className="text-muted-ink">Tick the stays the channel has paid out, then mark them received.</span>}
          </dl>
        )}
        renderCard={b => (
          <span className="flex gap-3 items-start">
            <ChannelMark ch={b.channel} size={22} />
            <span className="flex flex-col gap-[3px] min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{b.guestName || '—'}</span>
                <span className="text-copy font-medium [font-variant-numeric:tabular-nums] whitespace-nowrap">{b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '—'}</span>
              </span>
              <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{[b.unitNumber, b.propertyName, b.country?.name].filter(Boolean).join(' · ')}</span>
              <span className="flex items-center justify-between gap-2 pt-[2px]">
                <span className="text-meta whitespace-nowrap min-w-0 overflow-hidden text-ellipsis">{dateRange(b.checkIn, b.checkOut)} · {fmtNights(b.nights)}</span>
                <StatusBadge entity="booking" value={b.state} size="sm" />
              </span>
              {todoMeta?.money && b.outstanding > 0 && <span className="text-meta text-warning">{rm(b.outstanding)} owed</span>}
            </span>
          </span>
        )}
      />

      <BookingDrawer id={openId} summary={onPage} onClose={() => setOpenId(null)} onChanged={reload} onDuplicated={newId => setOpenId(newId)} />

      {creating && <CreateReservationModal units={UNITS} prefill={prefill} onClose={() => setCreating(false)} onCreate={createReservation} />}
      {importRows && <ImportPreviewModal rows={importRows} onClose={() => setImportRows(null)} onConfirm={commitImport} />}
      {messageRow && <MessageGuestModal r={messageRow} onClose={() => setMessageRow(null)} />}
      {bulkPayout && <BulkPayoutModal rows={bulkPayout.rows} onClose={() => setBulkPayout(null)}
        onDone={() => { bulkPayout.clear(); setBulkPayout(null); reload(); }} />}
      {bulkAssign && <BulkAssignCleaner reservationIds={bulkAssign.ids} onClose={() => setBulkAssign(null)}
        onDone={() => { bulkAssign.clear(); setBulkAssign(null); reload(); }} />}
    </>
  );
}

function Total({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-[6px]" title={title}>
      <dt className="text-muted-ink">{label}</dt>
      <dd className="m-0 font-semibold text-ink [font-variant-numeric:tabular-nums]">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk: mark booking-site payouts received                            */
/* ------------------------------------------------------------------ */

function BulkPayoutModal({ rows: ticked, onClose, onDone }: { rows: Row[]; onClose: () => void; onDone: () => void }) {
  // Only booking-site stays that still owe a payout can be marked; the rest of the ticked rows are named, not sent.
  const rows = ticked.filter(r => ['airbnb', 'booking_com', 'agoda'].includes(r.channel) && !['cancelled', 'no_show', 'inquiry'].includes(r.state) && r.outstanding > 0);
  const left = ticked.length - rows.length;
  const owed = rows.reduce((n, r) => n + r.outstanding, 0);
  const toast = useToast();
  const [receivedOn, setReceivedOn] = useState(todayMyt());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ recorded: number; total: number; skipped: { ref: string | null; reason: string }[] }>('/reservations/mark-paid-out', { ids: rows.map(x => x.id), receivedOn, reference: reference || undefined });
      toast({
        tone: r.skipped.length ? 'warning' : 'success',
        title: r.recorded ? `${plural(r.recorded, 'payout')} recorded, ${rm(r.total)}.` : 'No payout recorded.',
        body: r.skipped.length ? `${plural(r.skipped.length, 'reservation')} left alone: ${r.skipped.slice(0, 3).map(s => `${s.ref ?? 'one'} (${s.reason.replace(/\.$/, '').toLowerCase()})`).join(', ')}${r.skipped.length > 3 ? ' …' : ''}.` : 'They have left Channel payout pending.',
      });
      onDone();
    } catch (err) { toast({ tone: 'critical', title: 'Payouts not recorded.', body: errorMessage(err, 'Try again in a moment.') }); }
    setBusy(false);
  }
  return (
    <CentreModal title="Mark payouts received" sub={`Records one payout per reservation for what it still has outstanding: ${plural(rows.length, 'reservation')}, ${rm(owed)} in all.${left ? ` ${plural(left, 'ticked reservation')} ${left === 1 ? 'is' : 'are'} left out: not a channel stay, cancelled, or nothing owed.` : ''}`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="max-h-[180px] overflow-y-auto border border-solid border-line rounded-control">
          {rows.map(r => (
            <div key={r.id} className="flex justify-between gap-3 px-3 py-2 text-meta [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
              <span className="min-w-0 truncate"><span className="font-mono">{r.externalRef}</span> · {r.guestName || '—'}</span>
              <span className="[font-variant-numeric:tabular-nums] whitespace-nowrap">{rm(r.outstanding)}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <DateField label="Arrived on" value={receivedOn} max={todayMyt()} onChange={setReceivedOn} required />
          <Field label="Bank reference (optional)" value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. AIRBNB 2610" />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!receivedOn || !rows.length} disabledReason={!rows.length ? 'None of the ticked reservations is waiting for a channel payout.' : 'Pick the date.'}>{busy ? 'Recording…' : 'Mark received'}</Button>
        </div>
      </form>
    </CentreModal>
  );
}

/* ------------------------------------------------------------------ */
/* CSV import — parse + validate                                        */
/* ------------------------------------------------------------------ */

interface ImportRow { unitNumber: string; propertyName: string; guestName: string; guestPhone: string | null; channel: BookingChannel; checkIn: string; checkOut: string; guestsCount: number; grossBookingValue: number; externalRef: string | null }
interface ParsedRow { line: number; label: string; error?: string; row?: ImportRow }

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
  const grid = parseCsv(text.replace(/^﻿/, ''));
  if (grid.length < 2) return [{ line: 0, label: 'File', error: 'No data rows found. Expected a header row plus at least one reservation.' }];
  const header = grid[0].map(h => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iUnit = idx('unit'), iGuest = idx('guest'), iChannel = idx('channel'), iIn = idx('checkin'), iOut = idx('checkout'), iGuests = idx('guests'), iRate = idx('rate'), iPhone = idx('phone'), iRef = idx('reference');
  if (iUnit < 0 || iGuest < 0 || iChannel < 0 || iIn < 0 || iOut < 0) {
    return [{ line: 0, label: 'Header', error: 'Missing columns. Required header: unit, guest, channel, checkin, checkout (optional: guests, rate, phone, reference).' }];
  }
  return grid.slice(1).map((cols, n) => {
    const line = n + 2;
    const get = (i: number) => (i >= 0 ? (cols[i] ?? '').trim() : '');
    const unitNumber = get(iUnit), guest = get(iGuest), channelRaw = get(iChannel).toLowerCase();
    const checkIn = get(iIn), checkOut = get(iOut), guestsRaw = get(iGuests), rateRaw = get(iRate), phone = get(iPhone), ref = get(iRef);
    const label = `${guest || '(no name)'} · ${unitNumber || '(no unit)'}`;
    const unit = UNITS.find(u => u.unitNumber.toLowerCase() === unitNumber.toLowerCase());
    if (!unit) return { line, label, error: `Unknown unit "${unitNumber}".` };
    if (!guest) return { line, label, error: 'Guest name is required.' };
    if (!['airbnb', 'booking_com', 'agoda', 'direct'].includes(channelRaw)) return { line, label, error: `Unknown channel "${channelRaw}". Use airbnb, booking_com, agoda or direct.` };
    if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) return { line, label, error: 'Dates must be YYYY-MM-DD.' };
    if (nightsBetween(checkIn, checkOut) < 1) return { line, label, error: 'Checkout must be after check-in.' };
    const guestsCount = guestsRaw ? Number(guestsRaw) : 2;
    if (!Number.isFinite(guestsCount) || guestsCount < 0) return { line, label, error: 'Guests must be a number.' };
    const rateNum = rateRaw ? Number(rateRaw.replace(/[^0-9.]/g, '')) : 0;
    if (!Number.isFinite(rateNum) || rateNum < 0) return { line, label, error: 'Rate must be a number (RM).' };
    return { line, label, row: { unitNumber: unit.unitNumber, propertyName: unit.propertyName, guestName: guest, guestPhone: phone || null, channel: channelRaw as BookingChannel, checkIn, checkOut, guestsCount, grossBookingValue: Math.round(rateNum * 100), externalRef: ref || null } };
  });
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

type Kind = 'direct' | 'ota' | 'owner_stay';
interface CreatePrefill { guestName?: string; phone?: string; email?: string; unitId?: string; checkIn?: string; checkOut?: string; kind?: Kind }
interface CreateInput {
  unitId: string; channel: BookingChannel; guestName: string; phone: string; email: string; checkIn: string; checkOut: string;
  checkInTime: string; checkOutTime: string; guestsCount: number; grossSen: number; externalRef: string; notes: string;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function CreateReservationModal({ units: UNITS, prefill, onClose, onCreate }: {
  units: RosterUnit[]; prefill?: CreatePrefill | null; onClose: () => void; onCreate: (input: CreateInput) => Promise<Record<string, string> | undefined>;
}) {
  // No unit is chosen for the user: the list may still be loading, and a silent default books the wrong unit.
  const [kind, setKind] = useState<Kind>(prefill?.kind ?? 'direct');
  const [unitId, setUnitId] = useState(prefill?.unitId ?? '');
  const [site, setSite] = useState<BookingChannel>('airbnb');
  const [guestName, setGuestName] = useState(prefill?.guestName ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [checkIn, setCheckIn] = useState(prefill?.checkIn && ISO_DAY.test(prefill.checkIn) ? prefill.checkIn : '');
  const [checkOut, setCheckOut] = useState(prefill?.checkOut && ISO_DAY.test(prefill.checkOut) ? prefill.checkOut : '');
  const [inTime, setInTime] = useState('15:00');
  const [outTime, setOutTime] = useState('11:00');
  const [guestsCount, setGuestsCount] = useState<number | null>(2);
  const [rateSen, setRateSen] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const owner = kind === 'owner_stay';
  const unitKnown = UNITS.some(u => u.id === unitId);
  const unitOwner = UNITS.find(u => u.id === unitId)?.ownerName;
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const datesValid = !!checkIn && !!checkOut && nights >= 1;
  const guestsOk = guestsCount != null && guestsCount >= 1 && guestsCount <= 16;
  const valid = unitKnown && (owner || !!guestName.trim()) && datesValid && guestsOk;
  const missing = !unitKnown ? 'Pick a unit first.' : !owner && !guestName.trim() ? 'Add the guest name.' : !datesValid ? 'Pick a valid date range.' : 'Check the number of guests.';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFieldErrors({});
    const bad = await onCreate({
      unitId, channel: owner ? 'owner_stay' : kind === 'ota' ? site : 'direct',
      guestName: guestName.trim() || (owner && unitOwner ? unitOwner : ''), phone: phone.trim(), email: email.trim(),
      checkIn, checkOut, checkInTime: inTime, checkOutTime: outTime, guestsCount: guestsCount ?? 1,
      grossSen: owner ? 0 : rateSen ?? 0, externalRef: kind === 'ota' ? ref.trim() : '', notes: notes.trim(),
    });
    if (bad) setFieldErrors(bad);
    setBusy(false);
  }

  return (
    <CentreModal title={owner ? 'Owner stay' : 'Create reservation'} sub="Checked against the unit's other reservations before it is saved, then closed on the channels the unit is sold on." onClose={() => { if (!busy) onClose(); }} maxWidth={520}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto">
        <div role="radiogroup" aria-label="What is this" className="grid grid-cols-3 gap-1 p-1 rounded-control bg-muted">
          {([['direct', 'Direct'], ['ota', 'Airbnb, Booking.com, Agoda'], ['owner_stay', 'Owner stay']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={cx('h-9 rounded-[8px] border-none [font-family:inherit] text-meta cursor-pointer', kind === k ? 'bg-card font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-ink')}>{l}</button>
          ))}
        </div>
        <UnitPicker units={UNITS} value={unitId} onChange={setUnitId} />
        {kind === 'ota' && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <Select label="Channel" showLabel size="md" value={site} onChange={v => setSite(v as BookingChannel)}
              options={(['airbnb', 'booking_com', 'agoda'] as const).map(c => ({ value: c, label: CHANNEL_META[c].label }))} />
            <Field label="The site's reference" placeholder="e.g. HMF4323EHS" value={ref} onChange={e => setRef(e.target.value)}
              help="Channel reservations normally arrive by themselves through Channex. Type one in only if it did not." />
          </div>
        )}
        <Field label={owner ? 'Who is staying (optional)' : 'Guest name'} placeholder={owner ? unitOwner ?? 'The owner' : 'Jane Tan'} value={guestName} onChange={e => setGuestName(e.target.value)} required={!owner} />
        {!owner && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            <PhoneInput label="Phone" value={phone} onChange={setPhone} error={fieldErrors['guest.phone']} />
            <Field label="Email" type="email" placeholder="jane@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <DateField label="Check-in" value={checkIn} min={todayMyt(-1)} onChange={setCheckIn} required error={fieldErrors.checkIn} />
          <DateField label="Checkout" value={checkOut} min={checkIn || undefined} onChange={setCheckOut} required
            error={checkIn && checkOut && nights < 1 ? 'Checkout must be after check-in.' : fieldErrors.checkOut} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <TimeField label="Check-in from" value={inTime} onChange={setInTime} help="Earlier for an early check-in." error={fieldErrors.checkInTime} />
          <TimeField label="Checkout by" value={outTime} onChange={setOutTime} help="Later for a late checkout." error={fieldErrors.checkOutTime} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <NumberInput label="Guests" min={1} max={16} value={guestsCount} onChange={setGuestsCount} required
            error={fieldErrors.guestsCount} />
          {!owner && (
            <MoneyInput label="Guest total for the stay (RM)" valueSen={rateSen} onChangeSen={setRateSen} error={fieldErrors.grossBookingValue}
              help={datesValid ? `${fmtNights(nights)} · ${dateRange(checkIn, checkOut)}` : 'What the guest pays for the whole stay.'} />
          )}
        </div>
        {owner && <p className="m-0 text-meta text-muted-ink">An owner stay holds the nights and earns nothing. It shows on the calendar and the unit page.</p>}
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="cr-notes" className="text-meta font-medium text-muted-ink">Notes (optional)</label>
          <textarea id="cr-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="e.g. Arrives late, around 21:00"
            className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
        </div>
        <div className="flex justify-end gap-[9px] pt-1">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason={missing}>{busy ? 'Saving…' : owner ? 'Save owner stay' : 'Create reservation'}</Button>
        </div>
      </form>
    </CentreModal>
  );
}

function ImportPreviewModal({ rows, onClose, onConfirm }: { rows: ParsedRow[]; onClose: () => void; onConfirm: () => void }) {
  const ok = rows.filter(r => r.row).length;
  const bad = rows.length - ok;
  return (
    <CentreModal title="Import reservations" sub="Review the rows before importing. Rejected rows are left out. Each reservation is closed on the channels its unit is sold on." onClose={onClose} maxWidth={620}>
      <div className="px-[22px] pt-1 pb-3 flex items-center gap-2 flex-wrap flex-none">
        <span className="text-meta text-muted-ink">{plural(rows.length, 'row')} read</span>
        <StatusBadge tone="success" label={`${num(ok)} ready`} size="sm" />
        {bad > 0 && <StatusBadge tone="critical" label={`${num(bad)} with ${bad === 1 ? 'an error' : 'errors'}`} size="sm" />}
      </div>
      <div className="mx-[22px] mb-2 border border-solid border-line rounded-card overflow-y-auto">
        {rows.map((r, i) => (
          <div key={i} className={cx('flex items-start gap-3 py-[10px] px-[13px]', i < rows.length - 1 && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
            <Icon name={r.row ? 'CheckCircle2' : 'AlertCircle'} size="sm" color={r.row ? 'var(--color-success-fg)' : 'var(--color-critical-fg)'} style={{ marginTop: 2 }} />
            <div className="flex flex-col gap-px min-w-0 flex-1">
              <span className="text-copy font-medium">{r.line ? `Line ${r.line} · ` : ''}{r.label}</span>
              {r.row
                ? <span className="text-meta text-muted-ink">{CHANNEL_META[r.row.channel].label} · {dateRange(r.row.checkIn, r.row.checkOut)} · {r.row.grossBookingValue > 0 ? rm(r.row.grossBookingValue, { cents: false }) : 'no rate'}</span>
                : <span className="text-meta text-danger">{r.error}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-between gap-[9px] flex-wrap flex-none">
        <span className="text-meta text-muted-ink">Columns: unit, guest, channel, checkin, checkout, guests, rate, phone, reference</span>
        <div className="flex gap-[9px]">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={onConfirm} disabled={ok === 0} disabledReason="No valid rows to import.">
            {ok > 0 ? `Import ${plural(ok, 'reservation')}` : 'Import'}
          </Button>
        </div>
      </div>
    </CentreModal>
  );
}
