import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { channel } from '../theme';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { fetchAllPages } from '../lib/export';
import { runEach, skippedNote } from '../lib/bulk';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { CentreModal } from '../components/booking/BookingDrawer';
import { cx } from '../lib/design-tokens';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';
import { deliveryToast } from '../lib/bookingStatus';
import { rm, dateRange, time, date as fmtDate, nights as fmtNights, guests as fmtGuests, plural, count as fmtCount, phone } from '../lib/format';
import { Select, Menu } from '../components/Select';
import { Chip as FilterChip } from './finance/listKit';
import type { BookingChannel, ReservationState, UnitReadiness, UserRole, Tone } from '../lib/types';
import { RecordHistory } from '../components/RecordHistory';

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

interface Stay {
  reservationId: string; externalRef: string | null;
  checkIn: string; checkOut: string; unitNumber: string; propertyName: string;
  nights: number; channel: BookingChannel; value: number; state: ReservationState; rating: number | null;
}

/** An arrival or departure the guest has on the board today or tomorrow. */
interface GuestMovement {
  reservationId: string;
  kind: 'arrival' | 'departure';
  day: 'today' | 'tomorrow';
  checkInAt: string; checkOutAt: string;
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
  since: string;
  stays: number; upcoming: number; nights: number; lifetimeValue: number;
  lastCheckIn?: string | null;
}

/** The full profile, read from GET /guests/:id when a guest is selected. */
interface Guest {
  id: string; fullName: string; email: string | null; phone: string | null; language: string | null;
  channel: BookingChannel; tags: Tag[]; manualTags: string[]; since: string;
  stays: number; upcoming: number; nights: number; lifetimeValue: number; ratingScore: number | null;
  registration: { idType: string | null; idNumberMasked: string | null; hasIdNumber: boolean; dateOfBirth: string | null; countryCode: string | null; missing: string[]; required: boolean };
  notes: string | null;
  can: { edit: boolean; reveal: boolean; merge: boolean };
  history: Stay[];
  movement?: GuestMovement;
  redirectTo?: string;
}

const FILTERS = [
  { key: 'all', label: 'All guests', empty: 'No guests yet.' },
  { key: 'arriving_today', label: 'Arriving today', empty: 'Nobody arrives today.' },
  { key: 'departing_today', label: 'Departing today', empty: 'Nobody departs today.' },
  { key: 'tomorrow', label: 'Tomorrow', empty: 'No arrivals or departures tomorrow.' },
  { key: 'missing_id', label: 'Missing ID', empty: 'Every guest with a stay coming has their registration details.' },
  { key: 'repeat', label: 'Repeat', empty: 'No repeat guests yet.' },
  { key: 'vip', label: 'VIP', empty: 'No guest is tagged VIP.' },
  { key: 'blacklist', label: 'Blacklist', empty: 'No guest is blacklisted.' },
] as const;
type Filter = typeof FILTERS[number]['key'];
interface ListPayload {
  data: GuestSummary[]; total: number; page: number; pageSize: number; generatedAt: string; registrationReady: boolean;
  counts: Record<Filter, number>;
}

const LIST_FALLBACK: ListPayload = {
  data: [], total: 0, page: 1, pageSize: 50, generatedAt: '', registrationReady: true,
  counts: { all: 0, arriving_today: 0, departing_today: 0, tomorrow: 0, missing_id: 0, repeat: 0, vip: 0, blacklist: 0 },
};

// Latest stay first: the guest an operator is looking for is usually the one who just booked or stayed.
const SORTS = [
  { key: 'recent', label: 'Latest stay', dir: 'desc' },
  { key: 'name', label: 'Name A to Z', dir: 'asc' },
  { key: 'value', label: 'Booking value', dir: 'desc' },
  { key: 'stays', label: 'Most stays', dir: 'desc' },
] as const;

const OPS_ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff'];
const TWO_HOURS = 2 * 60 * 60 * 1000;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();
const threadName = (ch: BookingChannel) => (ch === 'direct' ? 'WhatsApp' : channel[ch].label);
const failMessage = (e: unknown) => (errorMessage(e, 'Try again in a moment.'));

const ID_TYPES: Record<string, string> = { mykad: 'MyKad', passport: 'Passport', other: 'Other ID' };
/** Common guest nationalities; any other ISO code still shows by name. */
const COUNTRY_CODES = ['MY', 'SG', 'ID', 'TH', 'PH', 'VN', 'BN', 'CN', 'HK', 'TW', 'JP', 'KR', 'IN', 'PK', 'BD', 'LK', 'AU', 'NZ', 'GB', 'IE', 'US', 'CA',
  'DE', 'FR', 'NL', 'IT', 'ES', 'CH', 'SE', 'NO', 'DK', 'RU', 'SA', 'AE', 'QA', 'KW', 'OM', 'EG', 'TR', 'IR', 'MV', 'NG', 'ZA'];
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
  const canSeeContact = user ? OPS_ROLES.includes(user.role) : false;
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
    for (const k of ['q', 'filter', 'page', 'size']) { const v = params.get(k); if (v) p.set(k, v); }
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
  const profileStale = !!selected && selected.id !== selectedId;

  function reloadAll() { list.reload(); detail.reload(); }
  function select(id: string) {
    updateParams(p => p.set('g', id));
    if (window.matchMedia('(max-width: 767.98px)').matches) document.querySelector('main')?.scrollTo({ top: 0 });
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
    for (const k of ['q', 'filter']) { const v = params.get(k); if (v) q[k] = v; }
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

  const columns = useMemo<Column<GuestSummary>[]>(() => [
    { key: 'name', label: 'Guest', value: g => g.fullName, sortKey: 'name', hideable: false, width: 210,
      render: g => (
        <span className="flex items-center gap-[10px] min-w-0">
          <span className="w-[30px] h-[30px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-caption font-semibold">{initials(g.fullName)}</span>
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={g.fullName}>{g.fullName}</span>
            <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{guestMeta(g, canSeeContact)}</span>
          </span>
        </span>
      ) },
    { key: 'tag', label: 'Tag', type: 'status', width: 110, phone: 'badge',
      status: g => (g.missingId ? { label: 'Missing ID', tone: 'critical' } : g.tags[0] ? { label: g.tags[0].label, tone: g.tags[0].tone } : null) },
    { key: 'stays', label: 'Stays', type: 'number', value: g => g.stays, sortKey: 'stays', width: 80,
      sub: g => (g.upcoming ? `${fmtCount(g.upcoming)} upcoming` : null) },
    ...(canSeeContact ? [
      { key: 'email', label: 'Email', value: (g: GuestSummary) => g.email, hidden: true, width: 190 },
      { key: 'phone', label: 'Phone', type: 'phone' as const, value: (g: GuestSummary) => g.phone, hidden: true, width: 140 },
    ] : []),
    { key: 'country', label: 'Nationality', value: g => countryName(g.countryCode), hidden: true, width: 130 },
    { key: 'channel', label: 'Latest channel', type: 'channel', value: g => g.channel, hidden: true },
    { key: 'nights', label: 'Nights', type: 'number', value: g => g.nights, sortKey: 'nights', hidden: true, width: 80 },
    { key: 'upcoming', label: 'Upcoming', type: 'number', value: g => g.upcoming, sortKey: 'upcoming', hidden: true, width: 90 },
    { key: 'lastCheckIn', label: 'Last check-in', type: 'date', value: g => g.lastCheckIn ?? null, sortKey: 'recent', hidden: true },
    { key: 'value', label: 'Booking value', type: 'money', value: g => g.lifetimeValue, sortKey: 'value', hidden: true,
      title: 'Guest totals of every stay, upcoming included.' },
  ], [canSeeContact]);

  // ---- actions: each toast says what the server did, never what was hoped for ----
  async function prepareEarly(g: Guest) {
    const m = g.movement; if (!m) return;
    setBusy(true);
    try {
      const r = await api.post<{ taskCreated: boolean }>(`/reservations/${m.reservationId}/prepare`, {});
      toast({ tone: 'success', title: r.taskCreated ? `A clean was queued for ${m.propertyName} ${m.unitNumber}.` : `A clean is already open for ${m.propertyName} ${m.unitNumber}.`,
        body: 'Nothing was sent to the guest. Send access details once the unit is Ready.' });
      reloadAll();
    } catch (e) { toast({ tone: 'critical', title: 'Arrival not prepared.', body: failMessage(e) }); }
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
      toast({ tone: 'success', title: `${g.fullName} checked out.`, body: r?.effects?.turnoverCreated ? `A cleaning task was created for ${m.propertyName} ${m.unitNumber}.` : `${m.propertyName} ${m.unitNumber} already had a clean planned.` });
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
  async function addGuest(input: { fullName: string; phone: string; email: string; countryCode: string; language: string }) {
    try {
      const r = await api.post<{ id: string; created: boolean; existingName?: string }>('/guests', input);
      setAdding(false);
      setDraft('');
      updateParams(p => { ['q', 'filter', 'page'].forEach(k => p.delete(k)); p.set('g', r.id); });
      toast(r.created
        ? { tone: 'success', title: `${input.fullName} added.`, body: 'Only the guest record was created. Use Book a stay to give them a unit and dates.' }
        : { tone: 'warning', title: 'This guest is already on file.', body: `${r.existingName} has the same ${input.email ? 'email' : 'phone'}. Their record is open; nothing new was created.` });
      reloadAll();
    } catch (e) { toast({ tone: 'critical', title: 'Guest not added.', body: failMessage(e) }); }
  }

  const searching = !!params.get('q');
  const emptyText = searching ? 'No guests match this search.' : FILTERS.find(f => f.key === filter)!.empty;

  return (
    <>
      <PageHeader
        title="Guests"
        sub={counts ? `${plural(counts.all, 'guest')}${searching ? ' match your search' : ''}${counts.missing_id ? ` · ${counts.missing_id} with a stay coming are missing ID details` : ''}` : 'Loading guests'}
        primary={canSeeContact ? <Button variant="primary" size="sm" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add guest</Button> : undefined}
      />

      <div className="flex gap-5 items-start max-w-[1600px] max-md:flex-col max-md:items-stretch">
        {/* -------- left: directory list -------- */}
        <div className={cx('md:flex-[0_1_520px] md:min-w-[340px] md:max-w-[560px] w-full min-w-0', pickedId && 'max-md:hidden')}>
          <DataTable<GuestSummary>
            id="guests" phoneSort={false} columns={columns} rows={list.data ? rows : null} rowKey={g => g.id}
            loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={g => select(g.id)}
            rowTone={g => (g.id === selectedId ? 'gold' : null)}
            server={{ total, page: list.data?.page ?? 1, pageSize: list.data?.pageSize ?? 50, sizes: [25, 50, 100], defaultPageSize: 50, fetchAll }}
            viewParams={['filter', 'q']} filtered={searching} onClearFilters={() => setSearch('')}
            noun={['guest', 'guests']} exportName="guests" maxHeight="calc(100dvh - 420px)"
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
              <div role="group" aria-label="Filter guests" className="flex gap-2 flex-wrap py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
                {FILTERS.map(f => (
                  <FilterChip key={f.key} on={f.key === filter} onClick={() => setFilter(f.key)} count={counts?.[f.key]}>
                    {f.key === 'missing_id' && !!counts?.missing_id && f.key !== filter ? <span className="text-danger">{f.label}</span> : f.label}
                  </FilterChip>
                ))}
              </div>
            }
            toolbar={<>
              <label className="relative flex-[1_1_180px] min-w-0">
                <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid pointer-events-none"><Icon name="Search" size="sm" /></span>
                <input value={draft} onChange={e => setSearch(e.target.value)} aria-label="Search guests"
                  placeholder={canSeeContact ? 'Name, phone, email or booking reference' : 'Guest name'}
                  className="h-9 w-full box-border rounded-control border border-solid border-line bg-card text-ink [font-family:inherit] text-copy pl-[32px] pr-3 py-0 outline-none" />
              </label>
              <Select label="Sort guests" value={sortKey} onChange={setSort} className="flex-[1_1_150px] sm:flex-none sm:w-[150px]" options={sortOptions} />
            </>}
            renderCard={g => <GuestCard g={g} canSeeContact={canSeeContact} />}
          />
        </div>

        {/* -------- right: guest profile -------- */}
        <div className={cx('md:flex-[1.6_1_460px] min-w-0 flex flex-col gap-5', !pickedId && 'max-md:hidden')}>
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
          title: `Mark ${checkout.fullName} checked out?`,
          body: `${checkout.movement.propertyName} ${checkout.movement.unitNumber} moves to Dirty and the stay is closed.`,
          meta: 'A cleaning task is created if the unit has none planned.',
          confirmLabel: 'Mark checked out',
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
  const lastStay = g.upcoming ? 'Stay coming up' : g.lastCheckIn ? `Last stay ${fmtDate(g.lastCheckIn)}` : 'No stays yet';
  return canSeeContact ? [phone(g.phone), g.email].filter(Boolean).join(' · ') || lastStay : lastStay;
};

/** The phone card: the face the directory rows had before the list became a table. */
function GuestCard({ g, canSeeContact }: { g: GuestSummary; canSeeContact: boolean }) {
  const meta = guestMeta(g, canSeeContact);
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
        <span className="text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{plural(g.stays, 'stay')}{g.upcoming ? ` (${g.upcoming} upcoming)` : ''}</span>
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
      <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-4">
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
            <Button size="sm" variant="primary" onClick={onBookStay}>Book a stay</Button>
            {(g.can.edit || g.can.merge) && (
              <Menu label="More actions" trigger={<span className="h-8 inline-flex items-center gap-1 px-3 rounded-control border border-solid border-line bg-card text-copy text-ink">More<Icon name="ChevronDown" size="sm" /></span>}
                items={[
                  ...(g.can.edit ? [{ key: 'edit', label: 'Edit details', hint: 'Contact, language and registration details', icon: 'Pencil', onSelect: onEdit }] : []),
                  ...(g.can.merge ? [{ key: 'merge', label: 'Merge into another guest', hint: 'For a duplicate record of the same person', icon: 'GitMerge', onSelect: onMerge }] : []),
                ]} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-[14px] pt-4 [border-top:1px_solid_var(--color-line-soft)]">
          <Stat label="Stays" value={fmtCount(g.stays)} sub={g.upcoming ? `incl. ${g.upcoming} upcoming` : undefined} />
          <Stat label="Nights" value={fmtCount(g.nights)} />
          <Stat label="Booking value" value={rm(g.lifetimeValue, { cents: false })} sub="Guest totals, upcoming included" />
          <Stat label="Rating given" value={g.ratingScore != null ? g.ratingScore.toFixed(1) : '—'} />
        </div>
      </div>

      {g.movement && <MovementStrip g={g} busy={busy} onPrepare={onPrepare} onSendAccess={onSendAccess} onCheckIn={onCheckIn} onCheckOut={onCheckOut} />}

      {canSeeContact && (
        <div className="grid grid-cols-2 gap-5 max-lg:grid-cols-1">
          <Registration g={g} onEdit={onEdit} />
          <NotesAndTags g={g} onSaved={onSaved} />
        </div>
      )}

      <div className="bg-card border border-solid border-line rounded-card overflow-hidden">
        <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] text-heading font-semibold">Stays</div>
        {g.history.length === 0 ? (
          <div className="py-[18px] px-5 text-copy text-muted-ink">No stays yet. Cancelled bookings are not listed here.</div>
        ) : (
          g.history.map((s, i) => (
            <button key={s.reservationId} type="button" onClick={() => onOpenStay(s.reservationId)}
              className={cx('w-full text-left [font:inherit] bg-transparent border-none cursor-pointer hover:bg-page flex items-center gap-[14px] py-[13px] px-5 flex-wrap', i < g.history.length - 1 ? '[border-bottom:1px_solid_var(--color-line-soft)]' : '')}>
              <ChannelMark ch={s.channel} size={24} />
              <div className="flex flex-col gap-[2px] min-w-[150px] flex-1">
                <span className="text-copy font-medium text-ink">{s.propertyName} {s.unitNumber}</span>
                <span className="text-meta text-muted-ink">{dateRange(s.checkIn, s.checkOut)} · {fmtNights(s.nights)}{s.externalRef ? ` · ${s.externalRef}` : ''}{s.rating != null ? ` · rated ${s.rating.toFixed(1)}` : ''}</span>
              </div>
              <span className="text-copy font-medium w-[92px] text-right [font-variant-numeric:tabular-nums] text-ink">{rm(s.value, { cents: false })}</span>
              <StatusBadge entity="booking" value={s.state} size="sm" />
            </button>
          ))
        )}
      </div>

      <RecordHistory entity="guests" id={g.id} refreshKey={g} />
    </>
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
        <span className="text-heading font-semibold">Registration details</span>
        {missing && r.required && <span className="text-meta text-danger text-right">Needed before check-in</span>}
      </div>
      <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-copy">
        {row('ID type', r.idType ? ID_TYPES[r.idType] ?? r.idType : 'Not given', !r.idType)}
        {row('ID number', r.hasIdNumber ? (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <span className="font-mono">{revealed ?? r.idNumberMasked}</span>
            {g.can.reveal && !revealed && <button type="button" onClick={reveal} className="p-0 border-none bg-transparent [font:inherit] text-meta text-ink underline cursor-pointer">Show</button>}
          </span>
        ) : 'Not given', !r.hasIdNumber)}
        {row('Date of birth', r.dateOfBirth ? fmtDate(r.dateOfBirth) : 'Not given', !r.dateOfBirth)}
        {row('Nationality', countryName(r.countryCode) ?? 'Not given', !r.countryCode)}
      </div>
      {g.can.edit && <Button size="sm" variant="secondary" onClick={onEdit} style={{ alignSelf: 'flex-start' }}>{missing ? 'Fill in details' : 'Edit details'}</Button>}
      {g.can.reveal && <span className="text-caption text-muted-ink">Showing a full ID number is recorded in the audit log.</span>}
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
  const toggle = (t: string) => {
    const next = g.manualTags.includes(t) ? g.manualTags.filter(x => x !== t) : [...g.manualTags, t];
    void save({ tags: next }, g.manualTags.includes(t) ? `${t === 'vip' ? 'VIP' : 'Blacklist'} tag removed.` : `Tagged ${t === 'vip' ? 'VIP' : 'Blacklist'}.`);
  };
  return (
    <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-3">
      <span className="text-heading font-semibold">Internal notes and tags</span>
      <div className="flex gap-2 flex-wrap items-center">
        {g.tags.filter(t => t.key !== 'vip' && t.key !== 'blacklist').map(t => <StatusBadge key={t.key} tone={t.tone} label={t.label} size="sm" />)}
        {(['vip', 'blacklist'] as const).map(t => {
          const on = g.manualTags.includes(t);
          return (
            <button key={t} type="button" onClick={() => toggle(t)} disabled={busy || !g.can.edit} aria-pressed={on}
              className={cx('h-7 inline-flex items-center gap-1 px-[10px] rounded-full [font:inherit] text-meta cursor-pointer border border-solid',
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
  const heading = `${arrival ? 'Arriving' : 'Departing'} ${m.day} · ${time(when)}`;
  const guard = accessGuard(m);
  const checkedIn = m.state === 'checked_in';
  const checkedOut = m.state === 'checked_out';
  return (
    <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-[14px]">
      <div className="flex items-center gap-3 flex-wrap">
        <ChannelMark ch={m.channel} size={24} />
        <div className="flex flex-col gap-[2px] min-w-0 flex-1">
          <span className="text-heading font-semibold">{heading}</span>
          <span className="text-meta text-muted-ink">{m.propertyName} {m.unitNumber} · {fmtGuests(m.guestsCount)} · {fmtNights(m.nights)}</span>
        </div>
        <div className="flex items-center gap-[7px]">
          <StatusBadge entity="booking" value={m.state} size="sm" />
          <StatusBadge entity="readiness" value={m.readiness} size="sm" />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {arrival && !checkedIn && (
          <>
            <Button size="sm" variant="tertiary" onClick={onPrepare} disabled={busy || !!m.preparedAt} disabledReason="A clean is already queued for this arrival.">Queue a clean</Button>
            <Button size="sm" variant="secondary" onClick={onSendAccess} disabled={busy || !!guard} disabledReason={guard ?? undefined}>Send access details</Button>
            {/* Checking in is for the arrival day itself: tomorrow's guest is not in yet. */}
            {m.day === 'today'
              ? <Button size="sm" variant="primary" onClick={onCheckIn} disabled={busy}>Mark checked in</Button>
              : <span className="text-meta text-muted-ink">Check-in opens on the arrival day.</span>}
            {m.preparedAt && <Chip label="Clean queued" />}
            {m.accessSentAt && <Chip label="Access sent" />}
          </>
        )}
        {arrival && checkedIn && <span className="text-meta text-muted-ink">Checked in.</span>}
        {!arrival && (
          <Button size="sm" variant="secondary" onClick={onCheckOut} disabled={busy || checkedOut || m.day !== 'today'}
            disabledReason={checkedOut ? 'Guest is already checked out.' : 'Check-out opens on the departure day.'}>
            {checkedOut ? 'Checked out' : 'Mark checked out'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-meta text-muted-ink">{label}</span>
      <span className="text-title font-semibold [font-variant-numeric:tabular-nums]">{value}</span>
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
    <CentreModal title={`Message ${g.fullName}`} sub={`Goes to the guest's latest stay conversation on ${threadName(g.channel)}.`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={async (e: FormEvent) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); await onSend(body.trim()); setBusy(false); }} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="msg-body" className={labelClass}>Message</label>
          <textarea id="msg-body" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${g.fullName.split(' ')[0]}, checking in on your stay…`} className={cx(fieldBase, 'p-[10px_12px] resize-y')} />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!body.trim()} disabledReason="Write a message first.">Send message</Button>
        </div>
      </form>
    </CentreModal>
  );
}

function NativeSelect({ id, label, value, onChange, options, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return (
    <div className="flex flex-col gap-[6px] min-w-0">
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className={cx(fieldBase, 'h-10 px-3')}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** The guest record only: a stay is booked separately, with a unit and dates. */
function AddGuestModal({ onClose, onAdd }: { onClose: () => void; onAdd: (input: { fullName: string; phone: string; email: string; countryCode: string; language: string }) => Promise<void> }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setBusy(true);
    await onAdd({ fullName: fullName.trim(), phone: phone.trim(), email: email.trim(), countryCode, language });
    setBusy(false);
  }
  return (
    <CentreModal title="Add guest" sub="Creates the guest's record only. To give them a unit and dates, use Book a stay on their profile." onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <Field label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" required />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Field label="Phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+60 12-345 6789" />
          <Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <NativeSelect id="ag-country" label="Nationality" value={countryCode} onChange={setCountryCode} options={COUNTRIES} placeholder="Not known yet" />
          <NativeSelect id="ag-lang" label="Language" value={language} onChange={setLanguage} options={LANGUAGES.map(l => ({ value: l, label: l }))} placeholder="Not known yet" />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!fullName.trim()} disabledReason="A name is required.">Add guest</Button>
        </div>
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
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto">
        <Field label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} required error={errors.fullName} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Field label="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
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
          <Field label="Date of birth" type="date" value={dob} onChange={e => setDob(e.target.value)} error={errors.dateOfBirth} />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!fullName.trim()} disabledReason="A name is required.">Save details</Button>
        </div>
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
      toast({ tone: 'success', title: `${g.fullName} merged into ${into.fullName}.`, body: `${plural(r.reservationsMoved, 'stay')} and ${plural(r.threadsMoved, 'conversation')} moved. The duplicate is hidden from the list.` });
      onMerged(into.id);
    } catch (e) { toast({ tone: 'critical', title: 'Guests not merged.', body: failMessage(e) }); }
    setBusy(false);
  }
  return (
    <CentreModal title={`Merge ${g.fullName}`} sub={`Pick the guest to keep. ${g.fullName}'s ${plural(g.stays, 'stay')} and conversations move to them, and details they lack are filled in.`} onClose={() => { if (!busy) onClose(); }} maxWidth={520}>
      <div className="px-[22px] py-4 flex flex-col gap-[14px]">
        <label className="relative">
          <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid"><Icon name="Search" size="sm" /></span>
          <input autoFocus value={q} onChange={e => { setQ(e.target.value); setInto(null); }} placeholder="Name, phone, email or booking reference" aria-label="Find the guest to keep"
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
                <span className="text-meta text-muted-ink whitespace-nowrap">{plural(x.stays, 'stay')}</span>
              </button>
            ))}
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!into} disabledReason="Pick the guest to keep." onClick={merge}>{into ? `Merge into ${into.fullName}` : 'Merge'}</Button>
        </div>
      </div>
    </CentreModal>
  );
}
