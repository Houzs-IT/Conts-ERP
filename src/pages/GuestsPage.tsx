import { mayWork } from '../lib/areaAccess';
import { readDevice } from '../lib/deviceClass';
import { useMedia } from '../lib/useMedia';
import { useFillHeight } from '../lib/useFillHeight';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { channel } from '../theme';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { ConfirmDialog, useConfirm } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { DateField, PhoneInput } from '../components/inputs';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { fetchAllPages } from '../lib/export';
import { runEach, skippedNote } from '../lib/bulk';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { CentreModal, ModalActions } from '../components/booking/BookingDrawer';
import { cx } from '../lib/design-tokens';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';
import { deliveryToast, stayPhase } from '../lib/bookingStatus';
import { rm, dateRange, time, date as fmtDate, nights as fmtNights, guests as fmtGuests, plural, count as fmtCount, todayMyt, greetName, titleCase } from '../lib/format';
import { phone, phoneCountries } from '../lib/phone';
import { Select, Menu } from '../components/Select';
import { FilterBar, FilterMenu } from '../components/FilterBar';
import type { BookingChannel, ReservationState, UnitReadiness, Tone } from '../lib/types';
import { RecordHistory } from '../components/RecordHistory';
import { Eyebrow, Figure } from '../components/Metric';
import { moneyStatus, isOtaChannel } from '../lib/payoutStatus';

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

interface Stay {
  reservationId: string; externalRef: string | null;
  checkIn: string; checkOut: string; unitNumber: string; propertyName: string;
  nights: number; channel: BookingChannel; value: number; state: ReservationState; rating: number | null;
  review: { text: string; at: string | null } | null;
  /** Expected times (HH:MM) and when the guest was actually checked in and out, if someone recorded it. */
  checkInTime: string; checkOutTime: string; checkedInAt: string | null; checkedOutAt: string | null;
  /** Host payout for a channel stay, guest payments for a direct one (functions/_lib/bookingMoney.ts). */
  expected: number; received: number; outstanding: number; paidOn: string | null;
}

/** An arrival or departure the guest has on the board today or tomorrow. */
interface GuestMovement {
  reservationId: string;
  kind: 'arrival' | 'departure';
  day: 'today' | 'tomorrow';
  checkInAt: string; checkOutAt: string;
  checkIn?: string; checkOut?: string;
  unitNumber: string; propertyName: string; channel: BookingChannel;
  nights: number; guestsCount: number;
  state: ReservationState; readiness: UnitReadiness;
  preparedAt: string | null; accessSentAt: string | null;
}

interface Tag { key: string; label: string; tone: Tone }

/** A directory row. Contact is null away from operations roles. */
interface GuestSummary {
  id: string; fullName: string; email: string | null; phone: string | null; countryCode: string | null;
  channel: BookingChannel; tags: Tag[]; missingId: boolean;
  /** Where the guest is from: the nationality on record, else the country of their phone number. */
  country: { code: string; name: string; from: 'nationality' | 'phone' } | null;
  since: string;
  stays: number; upcoming: number; nights: number; lifetimeValue: number;
  lastCheckIn?: string | null;
}

/** The full profile, read from GET /guests/:id when a guest is selected. */
interface Guest {
  id: string; fullName: string; email: string | null; phone: string | null; language: string | null;
  channel: BookingChannel; tags: Tag[]; manualTags: string[]; since: string;
  stays: number; upcoming: number; nights: number; lifetimeValue: number; ratingScore: number | null;
  received: number; outstanding: number;
  registration: { idType: string | null; idNumberMasked: string | null; hasIdNumber: boolean; dateOfBirth: string | null; countryCode: string | null; missing: string[]; required: boolean };
  notes: string | null;
  can: { edit: boolean; reveal: boolean; merge: boolean };
  history: Stay[];
  movement?: GuestMovement;
  redirectTo?: string;
}

const FILTERS = [
  { key: 'all', label: 'All guests', short: 'All', empty: 'No guests yet.' },
  { key: 'arriving_today', label: 'Arriving today', short: 'Arriving', empty: 'Nobody checks in today.' },
  { key: 'departing_today', label: 'Checking out today', short: 'Checking out', empty: 'Nobody checks out today.' },
  { key: 'tomorrow', label: 'Tomorrow', empty: 'No check-ins or checkouts tomorrow.' },
  { key: 'missing_id', label: 'Missing ID', empty: 'Every guest with a reservation coming up has their registration details.' },
  { key: 'repeat', label: 'Repeat', empty: 'No repeat guests yet.' },
  { key: 'vip', label: 'VIP', empty: 'No guest is tagged VIP.' },
  { key: 'blacklist', label: 'Blacklist', empty: 'No guest is blacklisted.' },
] as const;
type Filter = typeof FILTERS[number]['key'];
/** Ways to slice the whole directory; the rest are flags on a guest and live behind the Filter button. */
const VIEW_KEYS: readonly Filter[] = ['all', 'arriving_today', 'departing_today', 'tomorrow'];
interface ListPayload {
  data: GuestSummary[]; total: number; page: number; pageSize: number; generatedAt: string; registrationReady: boolean;
  counts: Record<Filter, number>;
  facets?: { country: { value: string; count: number; label: string }[] };
}

const LIST_FALLBACK: ListPayload = {
  data: [], total: 0, page: 1, pageSize: 50, generatedAt: '', registrationReady: true,
  counts: { all: 0, arriving_today: 0, departing_today: 0, tomorrow: 0, missing_id: 0, repeat: 0, vip: 0, blacklist: 0 },
};

// Latest stay first: the guest an operator is looking for is usually the one who just booked or stayed.
const SORTS = [
  { key: 'recent', label: 'Latest check-in', dir: 'desc' },
  { key: 'name', label: 'Name A to Z', dir: 'asc' },
  { key: 'value', label: 'Guest total', dir: 'desc' },
  { key: 'stays', label: 'Most reservations', dir: 'desc' },
] as const;

const TWO_HOURS = 2 * 60 * 60 * 1000;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();
const threadName = (ch: BookingChannel) => (ch === 'direct' ? 'WhatsApp' : channel[ch].label);
const failMessage = (e: unknown) => (errorMessage(e, 'Try again in a moment.'));

const ID_TYPES: Record<string, string> = { mykad: 'MyKad', passport: 'Passport', other: 'Other ID' };
/** Every country (a guest can come from anywhere; registration needs the nationality). */
const COUNTRY_CODES: string[] = phoneCountries().map(c => c.code);
const countryName = (code: string | null | undefined) => {
  if (!code) return null;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
};
const COUNTRIES = COUNTRY_CODES.map(c => ({ value: c, label: countryName(c) ?? c })).sort((a, b) => a.label.localeCompare(b.label));
const LANGUAGES = ['English', 'Malay', 'Chinese', 'Tamil', 'Arabic', 'Japanese', 'Korean', 'Indonesian', 'Thai', 'Other'];

/** null means allowed; a string is the reason "Send access details" is off. */
function accessGuard(m: GuestMovement): string | null {
  if (m.accessSentAt) return 'Access details already sent.';
  if (m.state === 'checked_in' || m.state === 'checked_out') return 'Guest is already checked in.';
  if (m.readiness !== 'ready') return 'Send access once the unit is Ready.';
  if (Date.now() < new Date(m.checkInAt).getTime() - TWO_HOURS) return 'Access details unlock 2 hours before check-in.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function GuestsPage() {
  const { user } = useSession();
  const canSeeContact = mayWork(user, 'reservations');
  const navigate = useNavigate();
  const toast = useToast();

  const [params, setParams] = useSearchParams();
  function updateParams(mut: (p: URLSearchParams) => void) {
    setParams(prev => { const next = new URLSearchParams(prev); mut(next); return next; }, { replace: true });
  }
  const rawFilter = params.get('filter');
  const filter: Filter = FILTERS.some(f => f.key === rawFilter) ? rawFilter as Filter : 'all';
  // The table writes `sort` as "<key>:asc|desc"; the Sort menu writes each key with its natural direction.
  const sortKey = (params.get('sort') ?? 'recent').split(':')[0];

  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of ['q', 'filter', 'country', 'page', 'size']) { const v = params.get(k); if (v) p.set(k, v); }
    p.set('sort', params.get('sort') ?? 'recent');
    return p.toString();
  }, [params]);
  const list = useApi<ListPayload>(`/guests${listQuery ? `?${listQuery}` : ''}`, LIST_FALLBACK);
  const rows = list.data?.data ?? [];
  const counts = list.data?.counts;
  const total = list.data?.total ?? 0;

  // Phones show the list or a profile, never both: only an explicit pick (g in the URL) opens a profile there.
  const pickedId = params.get('g');
  const selectedId = pickedId ?? rows[0]?.id ?? null;
  const detail = useApi<Guest>(selectedId ? `/guests/${selectedId}` : null);
  // A merged duplicate opens as the guest it was merged into.
  useEffect(() => { if (detail.data?.redirectTo) updateParams(p => p.set('g', detail.data!.redirectTo!)); }, [detail.data?.redirectTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draft, setDraft] = useState(params.get('q') ?? '');
  const timer = useRef<number | undefined>(undefined);
  function setSearch(value: string) {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => updateParams(p => {
      if (value.trim()) p.set('q', value); else p.delete('q');
      p.delete('page'); p.delete('g');
    }), 300);
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Guest | null>(null);
  const [checkout, setCheckout] = useState<Guest | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Guest | null>(null);
  const [merging, setMerging] = useState<Guest | null>(null);

  const selected = detail.data && !detail.data.redirectTo ? detail.data : null;
  const wide = useMedia('(min-width: 768px)');
  // The row of both panes takes the rest of the window; the profile fills it and scrolls, the list's own box fits it.
  const paneRow = useFillHeight({ enabled: wide, fallback: 'auto', prop: 'height' });
  const profileStale = !!selected && selected.id !== selectedId;

  function reloadAll() { list.reload(); detail.reload(); }
  function select(id: string) {
    updateParams(p => p.set('g', id));
    if (readDevice().cls === 'phone') document.querySelector('main')?.scrollTo({ top: 0 });
    else document.querySelector('[data-keep-scroll="guest-profile"]')?.scrollTo({ top: 0 });
  }
  function setFilter(key: Filter) { updateParams(p => { if (key === 'all') p.delete('filter'); else p.set('filter', key); p.delete('page'); p.delete('g'); }); }
  function setSort(key: string) {
    const s = SORTS.find(x => x.key === key);
    updateParams(p => { if (!s || key === 'recent') p.delete('sort'); else p.set('sort', `${key}:${s.dir}`); p.delete('page'); p.delete('g'); });
  }
  const sortOptions = SORTS.some(s => s.key === sortKey) ? SORTS.map(s => ({ value: s.key, label: s.label }))
    : [{ value: sortKey, label: 'By column' }, ...SORTS.map(s => ({ value: s.key, label: s.label }))];

  /** Every guest under the current search, chip and sort, for the table's Export. */
  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const q: Record<string, string> = { export: '1', sort: params.get('sort') ?? 'recent' };
    for (const k of ['q', 'filter', 'country']) { const v = params.get(k); if (v) q[k] = v; }
    const r = await fetchAllPages<GuestSummary>(async (page, size) => {
      const p = await api.get<ListPayload>('/guests', { ...q, page, size });
      return { rows: p.data, total: p.total };
    }, { onProgress });
    return r.rows;
  }

  // Sets or clears one manual tag on each ticked guest through the guest's own PATCH (role check and audit there).
  async function bulkTag(picked: GuestSummary[], tag: 'vip' | 'blacklist', on: boolean, clear: () => void) {
    const name = tag === 'vip' ? 'VIP' : 'Blacklist';
    const todo = picked.filter(g => g.tags.some(t => t.key === tag) !== on);
    const { ok, failed } = await runEach(todo, g => {
      const manual = g.tags.map(t => t.key).filter(k => k === 'vip' || k === 'blacklist');
      return api.patch(`/guests/${g.id}`, { tags: on ? [...manual, tag] : manual.filter(k => k !== tag) });
    }, g => g.fullName);
    const already = picked.length - todo.length;
    toast({
      tone: failed.length ? 'warning' : 'success',
      title: ok ? `${on ? `Tagged ${name}` : `${name} tag removed`}: ${plural(ok, 'guest')}.` : `No guest ${on ? 'tagged' : 'changed'}.`,
      body: [already ? `${plural(already, 'guest')} ${on ? 'already had' : 'did not have'} the tag.` : '', skippedNote(failed)].filter(Boolean).join(' ') || undefined,
    });
    if (ok) { clear(); reloadAll(); }
  }

  // The Country filter offers the countries in the list under the search and chip on screen, with their counts.
  const facetKey = JSON.stringify(list.data?.facets?.country ?? []);
  const picked = params.get('country') ?? '';
  const countryItems = useMemo(() => {
    const facets: { value: string; count: number; label: string }[] = JSON.parse(facetKey);
    const items = facets.map(f => ({ key: f.value, label: f.label, count: f.count }));
    for (const v of picked.split(',').filter(Boolean)) {
      if (!items.some(o => o.key === v)) items.push({ key: v, label: v === 'none' ? 'Not known' : countryName(v.toUpperCase()) ?? v, count: 0 });
    }
    return items;
  }, [facetKey, picked]);
  const pickedCountries = picked.split(',').filter(Boolean);
  function setCountries(next: string[]) {
    updateParams(p => { if (next.length) p.set('country', next.join(',')); else p.delete('country'); p.delete('page'); p.delete('g'); });
  }

  const columns = useMemo<Column<GuestSummary>[]>(() => [
    { key: 'name', label: 'Guest', value: g => g.fullName, sortKey: 'name', hideable: false, width: 196,
      render: g => (
        <span className="flex items-center gap-[10px] min-w-0">
          <span className="w-[30px] h-[30px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-caption font-semibold">{initials(g.fullName)}</span>
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={g.fullName}>{g.fullName}</span>
            <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{guestMeta(g, canSeeContact)}</span>
          </span>
        </span>
      ) },
    { key: 'tag', label: 'Tag', type: 'status', width: 104, phone: 'badge',
      status: g => (g.missingId ? { label: 'Missing ID', tone: 'critical' } : g.tags[0] ? { label: g.tags[0].label, tone: g.tags[0].tone } : null) },
    { key: 'stays', label: 'Reservations', type: 'number', value: g => g.stays, sortKey: 'stays', width: 112,
      sub: g => (g.upcoming ? `${fmtCount(g.upcoming)} upcoming` : null) },
    ...(canSeeContact ? [
      { key: 'email', label: 'Email', value: (g: GuestSummary) => g.email, hidden: true, width: 190 },
      { key: 'phone', label: 'Phone', type: 'phone' as const, value: (g: GuestSummary) => g.phone, hidden: true, width: 140 },
    ] : []),
    // A new key, not 'country': layouts saved when this column was a hidden Nationality would keep it hidden.
    { key: 'origin', label: 'Country', value: g => g.country?.name ?? countryName(g.countryCode), width: 116,
      title: 'The nationality on record, else the country of the phone number.',
      sub: g => (g.country?.from === 'phone' ? 'from phone' : null) },
    { key: 'channel', label: 'Latest channel', type: 'channel', value: g => g.channel, hidden: true },
    { key: 'nights', label: 'Nights', type: 'number', value: g => g.nights, sortKey: 'nights', hidden: true, width: 80 },
    { key: 'upcoming', label: 'Upcoming', type: 'number', value: g => g.upcoming, sortKey: 'upcoming', hidden: true, width: 90 },
    { key: 'lastCheckIn', label: 'Last check-in', type: 'date', value: g => g.lastCheckIn ?? null, sortKey: 'recent', hidden: true },
    { key: 'value', label: 'Guest total', type: 'money', value: g => g.lifetimeValue, sortKey: 'value', hidden: true,
      title: 'Guest totals of every reservation, upcoming included.' },
  ], [canSeeContact]);

  // ---- actions: each toast says what the server did, never what was hoped for ----
  async function prepareEarly(g: Guest) {
    const m = g.movement; if (!m) return;
    setBusy(true);
    try {
      const r = await api.post<{ taskCreated: boolean }>(`/reservations/${m.reservationId}/prepare`, {});
      toast({ tone: 'success', title: r.taskCreated ? `A cleaning job was added for ${m.propertyName} ${m.unitNumber}.` : `A cleaning job is already open for ${m.propertyName} ${m.unitNumber}.`,
        body: 'Nothing was sent to the guest. Send access details once the unit is Ready.' });
      reloadAll();
    } catch (e) { toast({ tone: 'critical', title: 'Cleaning job not added.', body: failMessage(e) }); }
    setBusy(false);
  }
  async function sendAccess(g: Guest) {
    const m = g.movement; if (!m) return;
    setBusy(true);
    try {
      const r = await api.post<{ delivery?: string; reason?: string }>('/messages', { reservationId: m.reservationId, kind: 'access_details' });
      toast(deliveryToast(r?.delivery, g.fullName, r?.reason));
      reloadAll();
    } catch (e) { toast({ tone: 'critical', title: 'Access details not sent.', body: failMessage(e) }); }
    setBusy(false);
  }
  async function markCheckedIn(g: Guest) {
    const m = g.movement; if (!m) return;
    setBusy(true);
    try {
      await api.patch(`/reservations/${m.reservationId}`, { state: 'checked_in' });
      toast({ tone: 'success', title: `${g.fullName} checked in.`, body: `${m.propertyName} ${m.unitNumber} is now occupied.` });
      reloadAll();
    } catch (e) { toast({ tone: 'critical', title: 'Not checked in.', body: failMessage(e) }); }
    setBusy(false);
  }
  async function confirmCheckout() {
    if (!checkout?.movement) return;
    const g = checkout, m = checkout.movement;
    setBusy(true);
    try {
      const r = await api.patch<{ effects?: { turnoverCreated?: boolean } }>(`/reservations/${m.reservationId}`, { state: 'checked_out' });
      toast({ tone: 'success', title: `${g.fullName} checked out.`, body: r?.effects?.turnoverCreated ? `A cleaning job was added for ${m.propertyName} ${m.unitNumber}.` : `${m.propertyName} ${m.unitNumber} already had a cleaning job planned.` });
      setCheckout(null);
      reloadAll();
    } catch (e) { toast({ tone: 'critical', title: 'Not checked out.', body: failMessage(e) }); } finally { setBusy(false); }
  }
  async function sendMessage(body: string) {
    if (!message) return;
    const g = message;
    try {
      const r = await api.post<{ delivery?: string; reason?: string }>('/messages', { guestId: g.id, body });
      setMessage(null);
      toast(deliveryToast(r?.delivery, g.fullName, r?.reason));
    } catch (e) { toast({ tone: 'critical', title: 'Message not sent.', body: failMessage(e) }); }
  }
  // A booking needs a unit and dates, so this opens the Bookings form with the guest filled in.
  function bookStay(g: Guest) {
    navigate('/reservations/bookings?create=1', { state: { guestName: g.fullName, phone: g.phone ?? '', email: g.email ?? '' } });
  }
  async function addGuest(input: { fullName: string; phone: string; email: string; countryCode: string; language: string }): Promise<Record<string, string> | undefined> {
    try {
      const r = await api.post<{ id: string; created: boolean; existingName?: string }>('/guests', input);
      setAdding(false);
      setDraft('');
      updateParams(p => { ['q', 'filter', 'page'].forEach(k => p.delete(k)); p.set('g', r.id); });
      toast(r.created
        ? { tone: 'success', title: `${input.fullName} added.`, body: 'Only the guest record was created. Use Add reservation to give them a unit and dates.' }
        : { tone: 'warning', title: 'This guest is already on file.', body: `${r.existingName} has the same ${input.email ? 'email' : 'phone'}. Their record is open; nothing new was created.` });
      reloadAll();
    } catch (e) {
      toast({ tone: 'critical', title: 'Guest not added.', body: failMessage(e) });
      if (e instanceof ApiFailure && e.fields) return e.fields;
    }
  }

  const searching = !!params.get('q');
  const emptyText = searching ? 'No guests match this search.' : FILTERS.find(f => f.key === filter)!.empty;

  return (
    <>
      <PageHeader
        title="Guests"
        sub={counts ? `${plural(counts.all, 'guest')}${searching ? ' match your search' : ''}${counts.missing_id ? ` · ${counts.missing_id} with a reservation coming up are missing ID details` : ''}` : 'Loading guests'}
        primary={canSeeContact ? <Button variant="primary" size="sm" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add guest</Button> : undefined}
      />

      {/* Desktop: the list and the profile are two panes that each scroll by themselves and both end at the bottom of the
          window, so the page itself does not scroll and the title stays put. Phones: the list, then a full-screen profile. */}
      <div ref={paneRow} className="flex gap-5 items-start max-w-[1600px] max-md:flex-col max-md:items-stretch">
        {/* -------- left: directory list -------- */}
        <div className={cx('md:flex-[0_1_560px] md:min-w-[360px] md:max-w-[600px] w-full min-w-0', pickedId && 'max-md:hidden')}>
          <DataTable<GuestSummary>
            id="guests" phoneSort={false} columns={columns} rows={list.data ? rows : null} rowKey={g => g.id}
            loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={g => select(g.id)}
            rowTone={g => (g.id === selectedId ? 'gold' : null)}
            server={{ total, page: list.data?.page ?? 1, pageSize: list.data?.pageSize ?? 50, sizes: [25, 50, 100], defaultPageSize: 50, fetchAll }}
            viewParams={['filter', 'country', 'q']} filtered={searching || pickedCountries.length > 0} onClearFilters={() => { setSearch(''); setCountries([]); }}
            noun={['guest', 'guests']} exportName="guests"
            empty={{ title: emptyText, icon: 'Users' }}
            selectable
            bulkActions={canSeeContact ? (picked, clear) => (
              <Menu label="Tag ticked guests" align="right"
                trigger={<span className="h-8 inline-flex items-center gap-1 px-3 rounded-control border border-solid border-line bg-card text-copy text-ink"><Icon name="Tag" size="sm" />Tag<Icon name="ChevronDown" size="sm" /></span>}
                items={[
                  { key: 'vip-on', label: 'Tag VIP', icon: 'Star', onSelect: () => void bulkTag(picked, 'vip', true, clear) },
                  { key: 'vip-off', label: 'Remove VIP', icon: 'X', onSelect: () => void bulkTag(picked, 'vip', false, clear) },
                  { key: 'bl-on', label: 'Tag Blacklist', icon: 'Ban', danger: true, onSelect: () => void bulkTag(picked, 'blacklist', true, clear) },
                  { key: 'bl-off', label: 'Remove Blacklist', icon: 'X', onSelect: () => void bulkTag(picked, 'blacklist', false, clear) },
                ]} />
            ) : undefined}
            header={
              <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)] flex items-center gap-2 flex-wrap">
                <FilterBar<Filter> label="Guest views" value={filter} onChange={setFilter}
                  views={FILTERS.filter(f => VIEW_KEYS.includes(f.key)).map(f => ({ key: f.key, label: f.label, short: 'short' in f ? f.short : undefined, count: counts?.[f.key] }))}
                  tags={{
                    single: true, active: [filter], onClear: () => setFilter('all'),
                    onToggle: k => setFilter(k === filter ? 'all' : k as Filter),
                    items: FILTERS.filter(f => !VIEW_KEYS.includes(f.key)).map(f => ({ key: f.key, label: f.label, count: counts?.[f.key], tone: f.key === 'missing_id' ? 'danger' as const : undefined })),
                  }} />
              </div>
            }
            toolbar={<>
              <label className="relative flex-[1_1_180px] min-w-0">
                <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid pointer-events-none"><Icon name="Search" size="sm" /></span>
                <input value={draft} onChange={e => setSearch(e.target.value)} aria-label="Search guests"
                  placeholder={canSeeContact ? 'Name, phone, email or reservation reference' : 'Guest name'}
                  className="h-9 w-full box-border rounded-control border border-solid border-line bg-card text-ink [font-family:inherit] text-copy pl-[32px] pr-3 py-0 outline-none" />
              </label>
              <Select label="Sort guests" value={sortKey} onChange={setSort} className="flex-[1_1_150px] sm:flex-none sm:w-[150px]" options={sortOptions} />
              <FilterMenu label="Country" items={countryItems} active={pickedCountries} onClear={() => setCountries([])}
                  onToggle={k => setCountries(pickedCountries.includes(k) ? pickedCountries.filter(x => x !== k) : [...pickedCountries, k])} />
            </>}
            renderCard={g => <GuestCard g={g} canSeeContact={canSeeContact} />}
          />
        </div>

        {/* -------- right: guest profile -------- */}
        <div data-keep-scroll="guest-profile"
          className={cx('md:flex-[1.6_1_460px] md:h-full min-w-0 flex flex-col gap-5 [&>*]:shrink-0 md:overflow-y-auto md:overscroll-contain md:[scrollbar-gutter:stable]', !pickedId && 'max-md:hidden')}>
          <button type="button" onClick={() => updateParams(p => p.delete('g'))}
            className="md:hidden self-start h-9 inline-flex items-center gap-1 px-2 -ml-2 rounded-control border-none bg-transparent text-ink [font-family:inherit] text-copy font-medium cursor-pointer">
            <Icon name="ChevronLeft" size="sm" /> All guests
          </button>
          {selected ? (
            <div className={cx('flex flex-col gap-5 transition-opacity duration-150', profileStale && 'opacity-55')} aria-busy={profileStale || busy}>
              <ProfilePanel
                g={selected} canSeeContact={canSeeContact} busy={busy}
                onMessage={() => setMessage(selected)}
                onBookStay={() => bookStay(selected)}
                onEdit={() => setEditing(selected)}
                onMerge={() => setMerging(selected)}
                onPrepare={() => prepareEarly(selected)}
                onSendAccess={() => sendAccess(selected)}
                onCheckIn={() => markCheckedIn(selected)}
                onCheckOut={() => setCheckout(selected)}
                onOpenStay={id => navigate(`/reservations/bookings?view=all&open=${encodeURIComponent(id)}`)}
                onSaved={reloadAll}
              />
            </div>
          ) : (
            <div className="py-10 px-5 bg-card border border-solid border-line rounded-card text-copy text-muted-ink">
              {detail.error ?? (list.data && rows.length === 0 ? 'No guest to show.' : selectedId ? 'Loading profile…' : 'Select a guest to see their profile.')}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        busy={busy}
        onClose={() => setCheckout(null)}
        spec={!checkout?.movement ? null : {
          title: `Check out ${checkout.fullName}?`,
          body: `${checkout.movement.propertyName} ${checkout.movement.unitNumber} moves to Dirty and the reservation is closed.`,
          meta: 'A cleaning job is added if the unit has none planned.',
          confirmLabel: 'Check out',
          busyLabel: 'Checking out…',
          onConfirm: confirmCheckout,
        }}
      />

      {message && <MessageModal g={message} onClose={() => setMessage(null)} onSend={sendMessage} />}
      {adding && <AddGuestModal onClose={() => setAdding(false)} onAdd={addGuest} />}
      {editing && <EditGuestModal g={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); }} />}
      {merging && <MergeModal g={merging} onClose={() => setMerging(null)}
        onMerged={intoId => { setMerging(null); updateParams(p => p.set('g', intoId)); reloadAll(); }} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Directory row                                                       */
/* ------------------------------------------------------------------ */

const guestMeta = (g: GuestSummary, canSeeContact: boolean) => {
  const lastStay = g.upcoming ? 'Reservation coming up' : g.lastCheckIn ? `Last check-in ${fmtDate(g.lastCheckIn)}` : 'No reservations yet';
  return canSeeContact ? [phone(g.phone), g.email].filter(Boolean).join(' · ') || lastStay : lastStay;
};

/** The phone card: the face the directory rows had before the list became a table. */
function GuestCard({ g, canSeeContact }: { g: GuestSummary; canSeeContact: boolean }) {
  const meta = [g.country?.name, guestMeta(g, canSeeContact)].filter(Boolean).join(' · ');
  const tag = g.tags[0];
  return (
    <span className="flex items-center gap-3 min-w-0">
      <span className="w-[34px] h-[34px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-meta font-semibold">{initials(g.fullName)}</span>
      <span className="flex flex-col gap-[2px] min-w-0 flex-1">
        <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={g.fullName}>{g.fullName}</span>
        <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={meta}>{meta}</span>
      </span>
      <span className="flex flex-col items-end gap-1 flex-none">
        {g.missingId ? <StatusBadge tone="critical" label="Missing ID" size="sm" /> : tag && <StatusBadge tone={tag.tone} label={tag.label} size="sm" />}
        <span className="text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{plural(g.stays, 'reservation')}{g.upcoming ? ` (${g.upcoming} upcoming)` : ''}</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

function ProfilePanel({ g, canSeeContact, busy, onMessage, onBookStay, onEdit, onMerge, onPrepare, onSendAccess, onCheckIn, onCheckOut, onOpenStay, onSaved }: {
  g: Guest; canSeeContact: boolean; busy: boolean;
  onMessage: () => void; onBookStay: () => void; onEdit: () => void; onMerge: () => void;
  onPrepare: () => void; onSendAccess: () => void; onCheckIn: () => void; onCheckOut: () => void;
  onOpenStay: (reservationId: string) => void; onSaved: () => void;
}) {
  const country = countryName(g.registration.countryCode);
  const contact = canSeeContact
    ? [phone(g.phone), g.email, g.language, country, `from ${channel[g.channel]?.label ?? 'Direct'}`].filter(Boolean).join(' · ')
    : 'Contact restricted to operations roles';
  return (
    <>
      {/* The name and actions stay at the top of the profile pane while its stays scroll under them. */}
      <div className="md:sticky md:top-0 md:z-[3] bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-4 md:shadow-[0_6px_12px_-10px_rgba(0,0,0,0.25)]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-[14px] min-w-0">
            <span className="w-[46px] h-[46px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-heading font-semibold">{initials(g.fullName)}</span>
            <div className="min-w-0 flex flex-col gap-[3px]">
              <h2 className="m-0 text-title leading-[1.25] font-semibold break-words">{g.fullName}</h2>
              <span className="text-meta text-muted-ink break-words">{contact}</span>
              <div className="flex items-center gap-[7px] flex-wrap pt-[2px]">
                {g.tags.map(t => <StatusBadge key={t.key} tone={t.tone} label={t.label} size="sm" />)}
                {g.registration.required && g.registration.missing.length > 0 && <StatusBadge tone="critical" label="Missing ID" size="sm" />}
                <span className="text-meta text-muted-ink">{g.since}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="secondary" icon={<Icon name="MessageSquare" size="sm" />} onClick={onMessage}>Message</Button>
            <Button size="sm" variant="primary" onClick={onBookStay}>Add reservation</Button>
            {(g.can.edit || g.can.merge) && (
              <Menu label="More actions" trigger={<span className="h-8 inline-flex items-center gap-1 px-3 rounded-control border border-solid border-line bg-card text-copy text-ink">More<Icon name="ChevronDown" size="sm" /></span>}
                items={[
                  ...(g.can.edit ? [{ key: 'edit', label: 'Edit details', hint: 'Contact, language and registration details', icon: 'Pencil', onSelect: onEdit }] : []),
                  ...(g.can.merge ? [{ key: 'merge', label: 'Merge into another guest', hint: 'For a duplicate record of the same person', icon: 'GitMerge', onSelect: onMerge }] : []),
                ]} />
            )}
          </div>
        </div>

      </div>

      <div className="bg-card border border-solid border-line rounded-card p-5 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-[14px]">
        <Stat label="Reservations" value={fmtCount(g.stays)} sub={g.upcoming ? `incl. ${g.upcoming} upcoming` : undefined} />
        <Stat label="Nights" value={fmtCount(g.nights)} />
        <Stat label="Total spent" value={rm(g.lifetimeValue, { cents: false })}
          sub={`Guest totals of ${plural(g.stays, 'reservation')}${g.upcoming ? ', upcoming included' : ''}`} />
        <Stat label="Rating given" value={g.ratingScore != null ? g.ratingScore.toFixed(1) : '—'} />
      </div>

      {g.movement && <MovementStrip g={g} busy={busy} onPrepare={onPrepare} onSendAccess={onSendAccess} onCheckIn={onCheckIn} onCheckOut={onCheckOut} />}

      {canSeeContact && (
        <div className="grid grid-cols-2 gap-5 max-lg:grid-cols-1">
          <Registration g={g} onEdit={onEdit} />
          <NotesAndTags g={g} onSaved={onSaved} />
        </div>
      )}

      <div className="bg-card border border-solid border-line rounded-card overflow-hidden">
        <div className="pt-5 pb-3.5 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Reservations</span>
          {g.history.length > 0 && <span className="text-meta text-muted-ink">Open one for its times, payment and review</span>}
        </div>
        {g.history.length === 0 ? (
          <div className="py-[18px] px-5 text-copy text-muted-ink">No reservations yet. Cancelled reservations are not listed here.</div>
        ) : (
          g.history.map((s, i) => <StayRow key={s.reservationId} s={s} last={i === g.history.length - 1} onOpen={() => onOpenStay(s.reservationId)} />)
        )}
      </div>

      <RecordHistory entity="guests" id={g.id} refreshKey={g} />
    </>
  );
}

/** One stay: the line the list always showed and, opened, its expected and actual times, its money and the guest's review. */
function StayRow({ s, last, onOpen }: { s: Stay; last: boolean; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const ota = isOtaChannel(s.channel);
  const status = moneyStatus({ channel: s.channel, state: s.state, expected: s.expected, received: s.received, outstanding: s.outstanding, paidOn: s.paidOn });
  const before = s.state === 'confirmed' || s.state === 'pending' || s.state === 'inquiry';
  const actual = (at: string | null, happened: boolean) => (at ? `${fmtDate(at)} · ${time(at)}` : happened ? 'Time not recorded' : 'Not yet');
  const line = (label: string, value: ReactNode, sub?: ReactNode) => (
    <div className="flex justify-between gap-3 py-[5px]">
      <span className="text-muted-ink">{label}</span>
      <span className="text-right min-w-0">{value}{sub ? <span className="block text-caption text-muted-ink">{sub}</span> : null}</span>
    </div>
  );
  const tone = status.tone === 'success' ? 'text-success' : status.tone === 'warning' ? 'text-warning' : 'text-muted-ink';
  return (
    <div className={cx(!last && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full text-left [font:inherit] bg-transparent border-none cursor-pointer hover:bg-page flex items-center gap-[14px] py-[13px] px-5 flex-wrap">
        <ChannelMark ch={s.channel} size={24} />
        <div className="flex flex-col gap-[2px] min-w-[150px] flex-1">
          <span className="text-copy font-medium text-ink">{s.propertyName} {s.unitNumber}</span>
          <span className="text-meta text-muted-ink">{dateRange(s.checkIn, s.checkOut)} · {fmtNights(s.nights)}{s.externalRef ? ` · ${s.externalRef}` : ''}{s.rating != null ? ` · rated ${s.rating.toFixed(1)}` : ''}</span>
        </div>
        <span className="flex flex-col items-end min-w-[92px] max-w-[190px]">
          <span className="text-copy font-medium [font-variant-numeric:tabular-nums] text-ink">{rm(s.value, { cents: false })}</span>
          <span className={cx('text-caption text-right', tone)}>{status.label}</span>
        </span>
        <StatusBadge entity="stay" value={stayPhase(s)} size="sm" />
        <span className={cx('text-muted-ink grid transition-transform', open && 'rotate-180')}><Icon name="ChevronDown" size="sm" /></span>
      </button>
      {open && (
        <div className="@container">
        <div className="px-5 pb-4 pt-1 grid grid-cols-1 @min-[640px]:grid-cols-2 gap-x-8 gap-y-3 text-copy">
          <div className="flex flex-col">
            <Eyebrow>Times</Eyebrow>
            {line('Expected check-in', `${fmtDate(s.checkIn)} · from ${s.checkInTime}`)}
            {line('Checked in', actual(s.checkedInAt, s.state === 'checked_in' || s.state === 'checked_out'))}
            {line('Expected checkout', `${fmtDate(s.checkOut)} · by ${s.checkOutTime}`)}
            {line('Checked out', actual(s.checkedOutAt, s.state === 'checked_out'))}
          </div>
          <div className="flex flex-col">
            <Eyebrow>Payment</Eyebrow>
            {line('Guest total', rm(s.value))}
            {ota ? line('Host payout', rm(s.expected), <span className={tone}>{status.label}</span>) : <>
              {line('Paid', rm(s.received))}
              {line('Balance due', s.outstanding > 0 ? rm(s.outstanding) : 'Nothing')}
            </>}
          </div>
          <div className="flex flex-col col-span-full">
            <Eyebrow>Review</Eyebrow>
            {s.review || s.rating != null ? (
              <div className="pt-1 flex flex-col gap-1">
                {s.rating != null && <span className="font-medium">{s.rating.toFixed(1)} out of 5{s.review?.at ? <span className="text-muted-ink font-normal"> · {fmtDate(s.review.at)}</span> : null}</span>}
                {s.review && <p className="m-0 text-ink leading-[1.45] break-words">{s.review.text}</p>}
              </div>
            ) : <span className="pt-1 text-muted-ink">{before || s.state === 'checked_in' ? 'The guest can leave a review after checkout.' : 'No review from this guest.'}</span>}
          </div>
          <div className="col-span-full">
            <Button size="sm" variant="secondary" onClick={onOpen}>Open reservation</Button>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

function Registration({ g, onEdit }: { g: Guest; onEdit: () => void }) {
  const toast = useToast();
  const r = g.registration;
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => setRevealed(null), [g.id]);
  const missing = r.missing.length > 0;
  async function reveal() {
    try {
      const x = await api.post<{ idNumber: string }>(`/guests/${g.id}/reveal`, {});
      setRevealed(x.idNumber);
    } catch (e) { toast({ tone: 'critical', title: 'ID number not shown.', body: failMessage(e) }); }
  }
  const row = (label: string, value: ReactNode, empty: boolean) => (
    <>
      <span className="text-muted-ink">{label}</span>
      <span className={cx('min-w-0 break-words', empty && (r.required ? 'text-danger' : 'text-muted-ink'))}>{value}</span>
    </>
  );
  return (
    <div className={cx('bg-card border border-solid rounded-card p-5 flex flex-col gap-3', missing && r.required ? 'border-danger-line' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Registration details</span>
        {missing && r.required && <span className="text-meta text-danger text-right">Needed before check-in</span>}
      </div>
      <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-copy">
        {row('ID type', r.idType ? ID_TYPES[r.idType] ?? r.idType : 'Not given', !r.idType)}
        {row('ID number', r.hasIdNumber ? (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <span className="font-mono">{revealed ?? r.idNumberMasked}</span>
            {g.can.reveal && !revealed && <button type="button" onClick={reveal} className="p-0 border-none bg-transparent [font-family:inherit] text-meta text-ink underline cursor-pointer">Show</button>}
          </span>
        ) : 'Not given', !r.hasIdNumber)}
        {row('Date of birth', r.dateOfBirth ? fmtDate(r.dateOfBirth) : 'Not given', !r.dateOfBirth)}
        {row('Nationality', countryName(r.countryCode) ?? 'Not given', !r.countryCode)}
      </div>
      {g.can.edit && <Button size="sm" variant="secondary" onClick={onEdit} style={{ alignSelf: 'flex-start' }}>{missing ? 'Fill in details' : 'Edit details'}</Button>}
      {g.can.reveal && <span className="text-caption text-muted-ink">Showing a full ID number is recorded in History.</span>}
    </div>
  );
}

function NotesAndTags({ g, onSaved }: { g: Guest; onSaved: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState(g.notes ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotes(g.notes ?? ''), [g.id, g.notes]);
  const dirty = notes.trim() !== (g.notes ?? '').trim();
  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try { await api.patch(`/guests/${g.id}`, body); toast({ tone: 'success', title: done }); onSaved(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: failMessage(e) }); }
    setBusy(false);
  }
  const [confirmDialog, ask] = useConfirm();
  const toggle = async (t: string) => {
    const had = g.manualTags.includes(t);
    const label = t === 'vip' ? 'VIP' : 'Blacklist';
    const name = titleCase(g.fullName);
    const ok = await ask(had
      ? { title: `Remove the ${label} tag from ${name}?`, confirmLabel: `Remove ${label}`, danger: false }
      : { title: `Tag ${name} as ${label}?`, body: 'The tag shows on this guest everywhere until someone removes it.', confirmLabel: `Tag ${label}`, danger: t === 'blacklist' });
    if (ok === null) return;
    const next = had ? g.manualTags.filter(x => x !== t) : [...g.manualTags, t];
    void save({ tags: next }, had ? `${label} tag removed.` : `Tagged ${label}.`);
  };
  return (
    <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-3">
      {confirmDialog}
      <span className="text-[16px] font-semibold tracking-[-0.01em]">Internal notes and tags</span>
      <div className="flex gap-2 flex-wrap items-center">
        {g.tags.filter(t => t.key !== 'vip' && t.key !== 'blacklist').map(t => <StatusBadge key={t.key} tone={t.tone} label={t.label} size="sm" />)}
        {(['vip', 'blacklist'] as const).map(t => {
          const on = g.manualTags.includes(t);
          return (
            <button key={t} type="button" onClick={() => toggle(t)} disabled={busy || !g.can.edit} aria-pressed={on}
              className={cx('h-7 inline-flex items-center gap-1 px-[10px] rounded-full [font-family:inherit] text-meta cursor-pointer border border-solid',
                on ? (t === 'blacklist' ? 'bg-danger-bg border-danger-line text-danger font-semibold' : 'bg-warning-bg border-warning-line text-warning font-semibold')
                  : 'bg-card border-dashed border-line text-muted-ink')}>
              <Icon name={on ? 'Check' : 'Plus'} size="sm" />{t === 'vip' ? 'VIP' : 'Blacklist'}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor="g-notes" className="text-meta font-medium text-muted-ink">Notes for the team</label>
        <textarea id="g-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={4000} disabled={!g.can.edit}
          placeholder="e.g. Prefers a high floor, arrives late"
          className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
      </div>
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setNotes(g.notes ?? '')} disabled={busy}>Discard</Button>
          <Button size="sm" variant="primary" loading={busy} onClick={() => save({ notes: notes.trim() || null }, 'Notes saved.')}>Save notes</Button>
        </div>
      )}
    </div>
  );
}

function MovementStrip({ g, busy, onPrepare, onSendAccess, onCheckIn, onCheckOut }: {
  g: Guest; busy: boolean; onPrepare: () => void; onSendAccess: () => void; onCheckIn: () => void; onCheckOut: () => void;
}) {
  const m = g.movement!;
  const arrival = m.kind === 'arrival';
  const when = arrival ? m.checkInAt : m.checkOutAt;
  // vocab-ok: arrival is the variable's name; the heading reads Arriving or Checking out
  const heading = `${arrival ? 'Arriving' : 'Checking out'} ${m.day} · ${time(when)}`;
  const guard = accessGuard(m);
  const checkedIn = m.state === 'checked_in';
  const checkedOut = m.state === 'checked_out';
  return (
    <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-[14px]">
      <div className="flex items-center gap-3 flex-wrap">
        <ChannelMark ch={m.channel} size={24} />
        <div className="flex flex-col gap-[2px] min-w-0 flex-1">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">{heading}</span>
          <span className="text-meta text-muted-ink">{m.propertyName} {m.unitNumber} · {fmtGuests(m.guestsCount)} · {fmtNights(m.nights)}</span>
        </div>
        <div className="flex items-center gap-[7px]">
          {m.checkIn && m.checkOut ? <StatusBadge entity="stay" value={stayPhase({ state: m.state, checkIn: m.checkIn, checkOut: m.checkOut })} size="sm" /> : <StatusBadge entity="booking" value={m.state} size="sm" />}
          <StatusBadge entity="readiness" value={m.readiness} size="sm" />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {arrival && !checkedIn && (
          <>
            <Button size="sm" variant="tertiary" onClick={onPrepare} disabled={busy || !!m.preparedAt} disabledReason="A cleaning job is already added for this check-in.">Add cleaning job</Button>
            <Button size="sm" variant="secondary" onClick={onSendAccess} disabled={busy || !!guard} disabledReason={guard ?? undefined}>Send access details</Button>
            {/* Checking in is for the arrival day itself: tomorrow's guest is not in yet. */}
            {m.day === 'today'
              ? <Button size="sm" variant="primary" onClick={onCheckIn} disabled={busy}>Check in</Button>
              : <span className="text-meta text-muted-ink">Check-in opens on the check-in day.</span>}
            {m.preparedAt && <Chip label="Cleaning job added" />}
            {m.accessSentAt && <Chip label="Access sent" />}
          </>
        )}
        {arrival && checkedIn && <span className="text-meta text-muted-ink">Checked in.</span>}
        {!arrival && (
          <Button size="sm" variant="secondary" onClick={onCheckOut} disabled={busy || checkedOut || m.day !== 'today'}
            disabledReason={checkedOut ? 'Guest is already checked out.' : 'Checkout opens on the checkout day.'}>
            {checkedOut ? 'Checked out' : 'Check out'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <Figure value={value} className="text-[20px] sm:text-[22px] leading-none font-medium tracking-[-0.02em] text-ink" />
      {sub && <span className="text-caption text-muted-ink">{sub}</span>}
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-[22px] px-[9px] py-0 rounded-full bg-gold-tint text-gold-ink border border-solid border-[var(--color-gold-200)] text-caption font-semibold">{label}</span>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

const fieldBase = 'block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy';
const labelClass = 'text-meta font-medium text-muted-ink';

function MessageModal({ g, onClose, onSend }: { g: Guest; onClose: () => void; onSend: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <CentreModal title={`Message ${g.fullName}`} sub={`Goes to the guest's latest conversation on ${threadName(g.channel)}.`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={async (e: FormEvent) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); await onSend(body.trim()); setBusy(false); }} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="msg-body" className={labelClass}>Message</label>
          <textarea id="msg-body" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${greetName(g.fullName)}, just checking that everything is fine…`} className={cx(fieldBase, 'p-[10px_12px] resize-y')} />
        </div>
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!body.trim()} disabledReason="Write a message first.">Send message</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

function NativeSelect({ label, value, onChange, options, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return <Select label={label} showLabel size="md" value={value} onChange={onChange} options={options} placeholder={placeholder} />;
}

/** The guest record only: a stay is booked separately, with a unit and dates. */
function AddGuestModal({ onClose, onAdd }: { onClose: () => void; onAdd: (input: { fullName: string; phone: string; email: string; countryCode: string; language: string }) => Promise<Record<string, string> | undefined> }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setBusy(true); setErrors({});
    const bad = await onAdd({ fullName: fullName.trim(), phone: phone.trim(), email: email.trim(), countryCode, language });
    if (bad) setErrors(bad);
    setBusy(false);
  }
  return (
    <CentreModal title="Add guest" sub="Creates the guest's record only. To give them a unit and dates, use Add reservation on their profile." onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <Field label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" required />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          <PhoneInput label="Phone" value={phone} onChange={setPhone} error={errors.phone} />
          <Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" error={errors.email} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <NativeSelect id="ag-country" label="Nationality" value={countryCode} onChange={setCountryCode} options={COUNTRIES} placeholder="Not known yet" />
          <NativeSelect id="ag-lang" label="Language" value={language} onChange={setLanguage} options={LANGUAGES.map(l => ({ value: l, label: l }))} placeholder="Not known yet" />
        </div>
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!fullName.trim()} disabledReason="A name is required.">Add guest</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

function EditGuestModal({ g, onClose, onSaved }: { g: Guest; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const r = g.registration;
  const [fullName, setFullName] = useState(g.fullName);
  const [phone, setPhone] = useState(g.phone ?? '');
  const [email, setEmail] = useState(g.email ?? '');
  const [language, setLanguage] = useState(g.language ?? '');
  const [countryCode, setCountryCode] = useState(r.countryCode ?? '');
  const [idType, setIdType] = useState(r.idType ?? '');
  const [idNumber, setIdNumber] = useState('');
  const [dob, setDob] = useState(r.dateOfBirth ?? '');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const countries = useMemo(() => (countryCode && !COUNTRY_CODES.includes(countryCode) ? [...COUNTRIES, { value: countryCode, label: countryName(countryCode) ?? countryCode }] : COUNTRIES), [countryCode]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      await api.patch(`/guests/${g.id}`, {
        fullName, phone, email, language: language || null, countryCode: countryCode || null, idType: idType || null,
        ...(idNumber.trim() ? { idNumber: idNumber.trim() } : {}), dateOfBirth: dob || null,
      });
      toast({ tone: 'success', title: `${fullName} updated.` });
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      toast({ tone: 'critical', title: 'Not saved.', body: failMessage(err) });
    }
    setBusy(false);
  }
  return (
    <CentreModal title="Edit guest details" sub="Registration details are what Malaysian short-stay rules ask for: ID, its number, date of birth and nationality." onClose={() => { if (!busy) onClose(); }} maxWidth={540}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <Field label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} required error={errors.fullName} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <PhoneInput label="Phone" value={phone} onChange={setPhone} error={errors.phone} />
          <Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} error={errors.email} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <NativeSelect id="eg-country" label="Nationality" value={countryCode} onChange={setCountryCode} options={countries} placeholder="Not given" />
          <NativeSelect id="eg-lang" label="Language" value={language} onChange={setLanguage} options={(LANGUAGES.includes(language) || !language ? LANGUAGES : [...LANGUAGES, language]).map(l => ({ value: l, label: l }))} placeholder="Not given" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <NativeSelect id="eg-idtype" label="ID type" value={idType} onChange={setIdType} options={Object.entries(ID_TYPES).map(([value, label]) => ({ value, label }))} placeholder="Not given" />
          <Field label="ID number" value={idNumber} onChange={e => setIdNumber(e.target.value)} autoComplete="off"
            placeholder={r.hasIdNumber ? `${r.idNumberMasked} on file` : 'e.g. 900101-14-5678'} help={r.hasIdNumber ? 'Leave empty to keep the one on file.' : undefined} />
          <DateField label="Date of birth" value={dob} min="1900-01-01" max={todayMyt()} onChange={setDob} error={errors.dateOfBirth} />
        </div>
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!fullName.trim()} disabledReason="A name is required.">Save details</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

/** This guest is a duplicate: its stays and conversations move to the guest picked here, which is kept. */
function MergeModal({ g, onClose, onMerged }: { g: Guest; onClose: () => void; onMerged: (intoId: string) => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [into, setInto] = useState<GuestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  const found = useApi<ListPayload>(debounced.length >= 2 ? `/guests?q=${encodeURIComponent(debounced)}&except=${encodeURIComponent(g.id)}&size=25&sort=recent` : null);
  async function merge() {
    if (!into) return;
    setBusy(true);
    try {
      const r = await api.post<{ reservationsMoved: number; threadsMoved: number }>(`/guests/${g.id}/merge`, { intoId: into.id });
      toast({ tone: 'success', title: `${g.fullName} merged into ${into.fullName}.`, body: `${plural(r.reservationsMoved, 'reservation')} and ${plural(r.threadsMoved, 'conversation')} moved. The duplicate is hidden from the list.` });
      onMerged(into.id);
    } catch (e) { toast({ tone: 'critical', title: 'Guests not merged.', body: failMessage(e) }); }
    setBusy(false);
  }
  return (
    <CentreModal title={`Merge ${g.fullName}`} sub={`Pick the guest to keep. ${g.fullName}'s ${plural(g.stays, 'reservation')} and conversations move to them, and details they lack are filled in.`} onClose={() => { if (!busy) onClose(); }} maxWidth={520}>
      <div className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <label className="relative">
          <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid"><Icon name="Search" size="sm" /></span>
          <input autoFocus value={q} onChange={e => { setQ(e.target.value); setInto(null); }} placeholder="Name, phone, email or reservation reference" aria-label="Find the guest to keep"
            className={cx(fieldBase, 'h-10 pl-[32px] pr-3')} />
        </label>
        <div className="max-h-[260px] overflow-y-auto border border-solid border-line rounded-control">
          {debounced.length < 2 ? <div className="p-3 text-meta text-muted-ink">Type at least two letters.</div>
            : !found.data ? <div className="p-3 text-meta text-muted-ink">Searching…</div>
            : found.data.data.length === 0 ? <div className="p-3 text-meta text-muted-ink">No other guest matches.</div>
            : found.data.data.map(x => (
              <button key={x.id} type="button" onClick={() => setInto(x)} aria-pressed={into?.id === x.id}
                className={cx('w-full text-left [font:inherit] flex items-center gap-3 px-3 py-2 border-none cursor-pointer [border-bottom:1px_solid_var(--color-line-soft)]', into?.id === x.id ? 'bg-gold-tint' : 'bg-card hover:bg-page')}>
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-copy font-medium truncate">{x.fullName}</span>
                  <span className="text-meta text-muted-ink truncate">{[phone(x.phone), x.email].filter(Boolean).join(' · ') || x.since}</span>
                </span>
                <span className="text-meta text-muted-ink whitespace-nowrap">{plural(x.stays, 'reservation')}</span>
              </button>
            ))}
        </div>
        <ModalActions>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!into} disabledReason="Pick the guest to keep." onClick={merge}>{into ? `Merge into ${into.fullName}` : 'Merge'}</Button>
        </ModalActions>
      </div>
    </CentreModal>
  );
}
