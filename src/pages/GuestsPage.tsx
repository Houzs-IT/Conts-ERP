import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { color, channel } from '../theme';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { PageControls } from '../components/PageControls';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { cx } from '../lib/design-tokens';
import { useApi } from '../lib/useApi';
import { useUnitRoster } from '../lib/useUnitRoster';
import { api, notifyFailure } from '../lib/api';
import { useSession } from '../lib/session';
import { RESERVATION, READINESS } from '../lib/vocabulary';
import { rm, dateRange, time, date as fmtDate, nights as fmtNights, guests as fmtGuests, plural, count as fmtCount } from '../lib/format';
import { Select, SearchSelect } from '../components/Select';
import { EmptyState } from '../components/States';
import { Chip as FilterChip } from './finance/listKit';
import type { BookingChannel, ReservationState, UnitReadiness, UserRole, Tone } from '../lib/types';

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

/** One past or current stay in a guest's history. */
interface Stay {
  reservationId?: string;
  checkIn: string; checkOut: string; unitNumber: string; propertyName: string;
  nights: number; channel: BookingChannel; value: number; state: ReservationState;
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

/** A directory row: lifetime figures only. Contact is null-masked away from operations roles. */
interface GuestSummary {
  id: string; fullName: string; email: string | null; phone: string | null;
  channel: BookingChannel;
  tag: { label: string; tone: Tone };
  since: string;
  stays: number; nights: number; lifetimeValue: number;
  lastCheckIn?: string | null;
}

/** The full profile, read from GET /guests/:id when a guest is selected. */
interface Guest extends GuestSummary {
  ratingScore: number | null;
  history: Stay[];
  movement?: GuestMovement;
  /** Internal operations notes, when the payload carries them. Ops roles only. */
  notes?: string | null;
}

type Filter = 'all' | 'arriving_today' | 'departing_today' | 'tomorrow';
interface ListPayload {
  data: GuestSummary[]; total: number; page: number; pageSize: number; generatedAt: string;
  counts: Record<Filter, number>;
}

// Times are anchored at load so the two-hour access window is genuinely live in dev.
const NOW = Date.now();
const at = (min: number) => new Date(NOW + min * 60000).toISOString();

const GUESTS: Guest[] = [
  {
    id: 'g1', fullName: 'Nadia Abdullah', email: 'nadia@example.com', phone: '+60 12-111 0001',
    channel: 'airbnb', tag: { label: 'Repeat guest', tone: 'success' }, since: 'Guest since Mar 2025',
    stays: 4, nights: 17, lifetimeValue: 482000, ratingScore: 5.0,
    history: [
      { checkIn: '2026-09-13', checkOut: '2026-09-16', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', nights: 3, channel: 'airbnb', value: 85200, state: 'checked_in' },
      { checkIn: '2026-08-02', checkOut: '2026-08-05', unitNumber: '#2207', propertyName: 'The Establishment', nights: 3, channel: 'direct', value: 95400, state: 'checked_out' },
    ],
    movement: { reservationId: 'r1', kind: 'arrival', day: 'today', checkInAt: at(95), checkOutAt: '', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', nights: 3, guestsCount: 2, state: 'confirmed', readiness: 'ready', preparedAt: null, accessSentAt: null },
  },
  {
    id: 'g2', fullName: 'Aaron Lee', email: 'aaron@example.com', phone: '+60 12-111 0002',
    channel: 'direct', tag: { label: 'Direct', tone: 'info' }, since: 'Guest since Jun 2025',
    stays: 3, nights: 11, lifetimeValue: 486000, ratingScore: 4.8,
    history: [
      { checkIn: '2026-05-09', checkOut: '2026-05-11', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', nights: 2, channel: 'direct', value: 262000, state: 'checked_out' },
    ],
  },
];

const LIST_FALLBACK: ListPayload = {
  data: GUESTS, total: GUESTS.length, page: 1, pageSize: 50, generatedAt: '',
  counts: { all: GUESTS.length, arriving_today: 1, departing_today: 0, tomorrow: 0 },
};

const OPS_ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff'];
const TWO_HOURS = 2 * 60 * 60 * 1000;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();
const threadName = (ch: BookingChannel) => (ch === 'direct' ? 'WhatsApp' : channel[ch].label);

const FILTERS: { key: Filter; label: string; empty: string }[] = [
  { key: 'all', label: 'All guests', empty: 'No guests yet.' },
  { key: 'arriving_today', label: 'Arriving today', empty: 'Nobody arrives today.' },
  { key: 'departing_today', label: 'Departing today', empty: 'Nobody departs today.' },
  { key: 'tomorrow', label: 'Tomorrow', empty: 'No arrivals or departures tomorrow.' },
];
// Latest stay first: the guest an operator is looking for is usually the one who just booked or stayed,
// not "A Yoon Kim, 0 stays" at the top of 3,400 names.
const SORTS = [
  { key: 'recent', label: 'Latest stay' },
  { key: 'name', label: 'Name A to Z' },
  { key: 'value', label: 'Lifetime value' },
  { key: 'stays', label: 'Most stays' },
] as const;

/** null → allowed. A string → the reason "Send access" is disabled. */
function accessGuard(m: GuestMovement): string | null {
  if (m.accessSentAt) return 'Access details already sent.';
  if (m.state === 'checked_in' || m.state === 'checked_out') return 'Guest is already checked in.';
  if (m.readiness !== 'ready') return 'Send access once the unit is Ready.';
  if (Date.now() < new Date(m.checkInAt).getTime() - TWO_HOURS)
    return 'Access details unlock 2 hours before check-in.';
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

  // URL-as-state: search, filter, sort, page and the selected guest survive a refresh or a shared link.
  const [params, setParams] = useSearchParams();
  function updateParams(mut: (p: URLSearchParams) => void) {
    setParams(prev => { const next = new URLSearchParams(prev); mut(next); return next; }, { replace: true });
  }
  const rawFilter = params.get('filter');
  const filter: Filter = FILTERS.some(f => f.key === rawFilter) ? rawFilter as Filter : 'all';
  const sort = SORTS.some(s => s.key === params.get('sort')) ? params.get('sort')! : 'recent';

  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of ['q', 'filter', 'page']) { const v = params.get(k); if (v) p.set(k, v); }
    p.set('sort', sort);
    return p.toString();
  }, [params]);
  const list = useApi<ListPayload>(`/guests${listQuery ? `?${listQuery}` : ''}`, LIST_FALLBACK);
  const rows = list.data?.data ?? [];
  const counts = list.data?.counts;
  const total = list.data?.total ?? 0;

  // Phones show the list or a profile, never both: only an explicit pick (g in the URL) opens a profile there.
  const pickedId = params.get('g');
  const selectedId = pickedId ?? rows[0]?.id ?? null;
  const detail = useApi<Guest>(selectedId ? `/guests/${selectedId}` : null, GUESTS.find(g => g.id === selectedId) ?? GUESTS[0]);

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

  // Optimistic overlays on today's movement, rolled back if the server refuses.
  const [mEdits, setMEdits] = useState<Record<string, Partial<GuestMovement>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Guest | null>(null);
  const [checkout, setCheckout] = useState<Guest | null>(null);
  const [adding, setAdding] = useState(false);

  const mergeGuest = (g: Guest): Guest =>
    g.movement && mEdits[g.movement.reservationId]
      ? { ...g, movement: { ...g.movement, ...mEdits[g.movement.reservationId] } }
      : g;
  const mPatch = (rid: string, p: Partial<GuestMovement>) =>
    setMEdits(e => ({ ...e, [rid]: { ...e[rid], ...p } }));

  // While the next profile loads the previous one stays, dimmed, instead of blanking the panel.
  const selected = detail.data ? mergeGuest(detail.data) : null;
  const profileStale = !!selected && selected.id !== selectedId;

  function reloadAll() { list.reload(); detail.reload(); }
  function select(id: string) {
    updateParams(p => p.set('g', id));
    // On a phone the profile replaces the list, so it should open at its top, not at the list's scroll position.
    if (window.matchMedia('(max-width: 767.98px)').matches) document.querySelector('main')?.scrollTo({ top: 0 });
  }
  function setFilter(key: Filter) { updateParams(p => { if (key === 'all') p.delete('filter'); else p.set('filter', key); p.delete('page'); p.delete('g'); }); }
  function setSort(key: string) { updateParams(p => { if (key === 'recent') p.delete('sort'); else p.set('sort', key); p.delete('page'); p.delete('g'); }); }
  function goPage(n: number) { updateParams(p => { if (n <= 1) p.delete('page'); else p.set('page', String(n)); p.delete('g'); }); }

  // ---- actions: a change shows at once and is rolled back if the server refuses it ----
  function tryMove(rid: string, p: Partial<GuestMovement>, call: () => Promise<unknown>, ok: () => void) {
    const prev = mEdits[rid];
    mPatch(rid, p);
    call().then(() => { ok(); reloadAll(); }).catch(err => { setMEdits(e => ({ ...e, [rid]: prev ?? {} })); notifyFailure(err); });
  }
  function prepareEarly(g: Guest) {
    const m = g.movement; if (!m) return;
    tryMove(m.reservationId, { preparedAt: new Date().toISOString(), accessSentAt: new Date().toISOString(), readiness: 'ready' },
      () => api.post(`/reservations/${m.reservationId}/prepare`, {}),
      () => toast({ tone: 'success', title: `${m.propertyName} ${m.unitNumber} prepared.`, body: 'Access sent and the unit is confirmed ready.' }));
  }
  function sendAccess(g: Guest) {
    const m = g.movement; if (!m) return;
    tryMove(m.reservationId, { accessSentAt: new Date().toISOString() },
      () => api.post('/messages', { reservationId: m.reservationId, kind: 'access_details' }),
      () => toast({ tone: 'success', title: `Access details sent to ${g.fullName}.`, body: `Delivered on ${threadName(m.channel)}.` }));
  }
  function markCheckedIn(g: Guest) {
    const m = g.movement; if (!m) return;
    tryMove(m.reservationId, { state: 'checked_in', readiness: 'occupied' },
      () => api.patch(`/reservations/${m.reservationId}`, { state: 'checked_in' }),
      () => toast({ tone: 'success', title: `${g.fullName} checked in.`, body: `${m.propertyName} ${m.unitNumber} is now occupied.` }));
  }
  async function confirmCheckout() {
    if (!checkout?.movement) return;
    const g = checkout, m = checkout.movement;
    setBusy(true);
    try {
      await api.patch(`/reservations/${m.reservationId}`, { state: 'checked_out' });
      mPatch(m.reservationId, { state: 'checked_out', readiness: 'dirty' });
      toast({ tone: 'success', title: `${g.fullName} checked out.`, body: `A cleaning task was created for ${m.propertyName} ${m.unitNumber}.` });
      setCheckout(null);
      reloadAll();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }
  async function sendMessage(body: string) {
    if (!message) return;
    const g = message;
    try {
      await api.post('/messages', { guestId: g.id, body });
      setMessage(null);
      toast({ tone: 'success', title: `Message sent to ${g.fullName}.`, body: `Thread opened on ${threadName(g.channel)}.` });
    } catch (e) { notifyFailure(e); }
  }
  // A booking needs a unit and dates, so this opens the Bookings form with the guest filled in.
  function bookAgain(g: Guest) {
    navigate('/reservations/bookings?create=1', { state: { guestName: g.fullName, phone: g.phone ?? '', email: g.email ?? '' } });
  }
  async function addWalkIn(input: { fullName: string; phone: string; email: string; unitNumber: string; propertyName: string; guestsCount: number }) {
    try {
      const r = await api.post<{ id: string; reservationId: string }>('/guests', input);
      setAdding(false);
      setDraft('');
      updateParams(p => { ['q', 'filter', 'page'].forEach(k => p.delete(k)); p.set('g', r.id); });
      toast({ tone: 'success', title: `${input.fullName} added.`, body: 'Walk-in placed in today’s arrivals.' });
      reloadAll();
    } catch (e) { notifyFailure(e); }
  }

  const searching = !!params.get('q');
  const emptyText = searching ? 'No guests match this search.' : FILTERS.find(f => f.key === filter)!.empty;

  return (
    <>
      <PageHeader
        title="Guests"
        sub={counts ? `${plural(counts.all, 'guest')}${searching ? ' match your search' : ''}` : 'Loading guests'}
        primary={<Button variant="primary" size="sm" onClick={() => setAdding(true)}>Add guest</Button>}
      />

      {list.error && <StaleBanner message={`Showing the last guest list we have. ${list.error}`} onRetry={list.reload} />}

      <div className="flex gap-5 items-start max-w-[1600px] max-md:flex-col max-md:items-stretch">
        {/* -------- left: directory list -------- */}
        <div className={cx('md:flex-[0_1_400px] md:min-w-[320px] md:max-w-[440px] w-full bg-card border border-solid border-line rounded-card overflow-hidden', pickedId && 'max-md:hidden')}>
          <div className="py-4 px-4 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-3">
            <div className="flex gap-2 flex-wrap">
              <label className="relative flex-[1_1_180px] min-w-0">
                <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted-ink grid"><Icon name="Search" size="sm" /></span>
                <input value={draft} onChange={e => setSearch(e.target.value)} aria-label="Search guests"
                  placeholder={canSeeContact ? 'Name, phone or email' : 'Guest name'}
                  className="h-9 w-full box-border rounded-control border border-solid border-line bg-card text-ink [font-family:inherit] text-copy pl-[32px] pr-3 py-0 outline-none" />
              </label>
              <Select label="Sort guests" value={sort} onChange={setSort} className="flex-[1_1_150px] sm:flex-none sm:w-[150px]"
                options={SORTS.map(s => ({ value: s.key, label: s.label }))} />
            </div>
            <div role="group" aria-label="Filter guests" className="flex gap-2 flex-wrap">
              {FILTERS.map(f => (
                <FilterChip key={f.key} on={f.key === filter} onClick={() => setFilter(f.key)} count={counts?.[f.key]}>{f.label}</FilterChip>
              ))}
            </div>
          </div>

          <div className="md:max-h-[calc(100dvh-380px)] md:min-h-[320px] overflow-y-auto" aria-busy={list.loading}>
            {!list.data ? <TableSkeleton rows={8} cols={2} /> : rows.length === 0 ? (
              searching
                ? <EmptyState bare kind="filtered" title={emptyText} action={{ label: 'Clear search', onClick: () => setSearch('') }} />
                : <EmptyState bare title={emptyText} />
            ) : (
              <div className={cx('transition-opacity duration-150', list.loading && 'opacity-55')}>
                {rows.map(g => (
                  <GuestRow
                    key={g.id} g={g} selected={selectedId === g.id} canSeeContact={canSeeContact}
                    onSelect={() => select(g.id)}
                  />
                ))}
              </div>
            )}
          </div>
          {list.data && total > 0 && (
            <PageControls page={list.data.page} pageSize={list.data.pageSize} total={total} onPage={goPage}
              noun={total === 1 ? 'guest' : 'guests'} className="[border-top:1px_solid_var(--color-line-soft)] px-4!" />
          )}
        </div>

        {/* -------- right: guest profile -------- */}
        <div className={cx('md:flex-[1.6_1_460px] min-w-0 flex flex-col gap-5', !pickedId && 'max-md:hidden')}>
          <button type="button" onClick={() => updateParams(p => p.delete('g'))}
            className="md:hidden self-start h-9 inline-flex items-center gap-1 px-2 -ml-2 rounded-control border-none bg-transparent text-ink [font-family:inherit] text-copy font-medium cursor-pointer">
            <Icon name="ChevronLeft" size="sm" /> All guests
          </button>
          {selected ? (
            <div className={cx('flex flex-col gap-5 transition-opacity duration-150', profileStale && 'opacity-55')} aria-busy={profileStale}>
              <ProfilePanel
                g={selected} canSeeContact={canSeeContact}
                onMessage={() => setMessage(selected)}
                onBookAgain={() => bookAgain(selected)}
                onPrepare={() => prepareEarly(selected)}
                onSendAccess={() => sendAccess(selected)}
                onCheckIn={() => markCheckedIn(selected)}
                onCheckOut={() => setCheckout(selected)}
              />
            </div>
          ) : (
            <div className="py-10 px-5 bg-card border border-solid border-line rounded-card text-copy text-muted-ink">
              {detail.error ?? (list.data && rows.length === 0 ? 'No guest to show.' : selectedId ? 'Loading profile…' : 'Select a guest to see their profile.')}
            </div>
          )}
        </div>
      </div>

      {/* Mark checked out — confirmation, states the auto cleaning task */}
      <Dialog
        busy={busy}
        onClose={() => setCheckout(null)}
        spec={!checkout?.movement ? null : {
          title: `Mark ${checkout.fullName} checked out?`,
          body: `${checkout.movement.propertyName} ${checkout.movement.unitNumber} moves to Dirty and the stay is closed.`,
          meta: 'A cleaning task is created automatically, its window set from the next arrival.',
          confirmLabel: 'Mark checked out',
          busyLabel: 'Checking out…',
          onConfirm: confirmCheckout,
        }}
      />

      {message && <MessageModal g={message} onClose={() => setMessage(null)} onSend={sendMessage} />}
      {adding && <AddGuestModal onClose={() => setAdding(false)} onAdd={addWalkIn} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Directory row                                                       */
/* ------------------------------------------------------------------ */

function GuestRow({ g, selected, canSeeContact, onSelect }: {
  g: GuestSummary; selected: boolean; canSeeContact: boolean; onSelect: () => void;
}) {
  const lastStay = g.lastCheckIn ? `Last stay ${fmtDate(g.lastCheckIn)}` : 'No stays yet';
  const meta = canSeeContact ? [g.phone, g.email].filter(Boolean).join(' · ') || lastStay : lastStay;
  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={cx(
        'flex items-center gap-3 w-full text-left [font:inherit] min-h-[62px] py-[11px] px-4 cursor-pointer [border-top:0] [border-right:0] [border-left:0] [border-bottom:1px_solid_var(--color-line-soft)]',
        selected ? 'bg-gold-tint shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card shadow-none',
      )}
    >
      <span className="w-[34px] h-[34px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-meta font-semibold">
        {initials(g.fullName)}
      </span>
      <span className="flex flex-col gap-[2px] min-w-0 flex-1">
        <span className="text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis" title={g.fullName}>{g.fullName}</span>
        <span className="text-meta text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis" title={meta}>{meta}</span>
      </span>
      <span className="flex flex-col items-end gap-1 flex-none">
        <Badge tone={g.tag.tone} label={g.tag.label} size="sm" />
        <span className="text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{plural(g.stays, 'stay')}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

function ProfilePanel({ g, canSeeContact, onMessage, onBookAgain, onPrepare, onSendAccess, onCheckIn, onCheckOut }: {
  g: Guest; canSeeContact: boolean;
  onMessage: () => void; onBookAgain: () => void;
  onPrepare: () => void; onSendAccess: () => void; onCheckIn: () => void; onCheckOut: () => void;
}) {
  const contact = canSeeContact
    ? [g.email, g.phone].filter(Boolean).join(' · ') || '—'
    : 'Contact restricted to operations roles';
  return (
    <>
      {/* header + stats card */}
      <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-[14px] min-w-0">
            <span className="w-[46px] h-[46px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-heading font-semibold">
              {initials(g.fullName)}
            </span>
            <div className="min-w-0 flex flex-col gap-[3px]">
              <h2 className="m-0 text-title leading-[1.25] font-semibold">{g.fullName}</h2>
              <span className="text-meta text-muted-ink">{contact}</span>
              <div className="flex items-center gap-[7px] flex-wrap pt-[2px]">
                <Badge tone={g.tag.tone} label={g.tag.label} size="sm" />
                <span className="text-meta text-muted-ink">{g.since}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="secondary" icon={<Icon name="MessageSquare" size="sm" />} onClick={onMessage}>Message</Button>
            <Button size="sm" variant="primary" onClick={onBookAgain}>Book again</Button>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-[14px] pt-4 [border-top:1px_solid_var(--color-line-soft)]">
          <Stat label="Stays" value={fmtCount(g.stays)} />
          <Stat label="Nights" value={fmtCount(g.nights)} />
          <Stat label="Lifetime value" value={rm(g.lifetimeValue, { cents: false })} />
          <Stat label="Rating given" value={g.ratingScore != null ? g.ratingScore.toFixed(1) : '—'} />
        </div>
      </div>

      {/* today's arrival / departure — ops controls on the relevant guest */}
      {g.movement && <MovementStrip g={g} onPrepare={onPrepare} onSendAccess={onSendAccess} onCheckIn={onCheckIn} onCheckOut={onCheckOut} />}

      {/* stay history */}
      <div className="bg-card border border-solid border-line rounded-card overflow-hidden">
        <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] text-heading font-semibold">Stay history</div>
        {g.history.length === 0 ? (
          <div className="py-[18px] px-5 text-copy text-muted-ink">No stays yet. Cancelled bookings are not listed here.</div>
        ) : (
          g.history.map((s, i) => (
            <div key={i} className={cx('flex items-center gap-[14px] py-[13px] px-5 flex-wrap', i < g.history.length - 1 ? '[border-bottom:1px_solid_var(--color-line-soft)]' : '')}>
              <span aria-hidden className="w-[44px] h-[44px] flex-none rounded-[6px] bg-muted grid place-items-center">
                <Icon name="Image" size="sm" color={color.faint} />
              </span>
              <div className="flex flex-col gap-[2px] min-w-[140px] flex-1">
                <span className="text-copy font-medium">{s.propertyName} {s.unitNumber}</span>
                <span className="text-meta text-muted-ink">{dateRange(s.checkIn, s.checkOut)} · {fmtNights(s.nights)}</span>
              </div>
              <ChannelChip ch={s.channel} />
              <span className="text-copy font-medium w-[92px] text-right [font-variant-numeric:tabular-nums]">{rm(s.value, { cents: false })}</span>
              <Badge tone={RESERVATION[s.state].tone} label={RESERVATION[s.state].label} size="sm" />
            </div>
          ))
        )}
      </div>

      {/* contact / notes footnote */}
      <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-2">
        <span className="text-heading font-semibold">Contact</span>
        {canSeeContact ? (
          <div className="flex flex-col gap-[3px]">
            <span className="text-copy">{g.email ?? '—'}</span>
            <span className="text-copy text-muted-ink">{g.phone ?? '—'}</span>
          </div>
        ) : (
          <span className="text-copy text-faint">
            Guest contact details are visible to operations roles only. Field roles see the guest name where a task requires it.
          </span>
        )}
      </div>

      {/* operations notes — internal, restricted to operations roles like contact */}
      <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-2">
        <span className="text-heading font-semibold">Operations notes</span>
        {canSeeContact ? (
          g.notes ? (
            <span className="text-copy [text-wrap:pretty]">{g.notes}</span>
          ) : (
            <span className="text-copy text-muted-ink">No operations notes.</span>
          )
        ) : (
          <span className="text-copy text-faint">
            Operations notes are visible to operations roles only.
          </span>
        )}
      </div>
    </>
  );
}

function MovementStrip({ g, onPrepare, onSendAccess, onCheckIn, onCheckOut }: {
  g: Guest; onPrepare: () => void; onSendAccess: () => void; onCheckIn: () => void; onCheckOut: () => void;
}) {
  const m = g.movement!;
  const arrival = m.kind === 'arrival';
  const when = arrival ? m.checkInAt : m.checkOutAt;
  const dayLabel = m.day === 'today' ? 'today' : 'tomorrow';
  const heading = `${arrival ? 'Arriving' : 'Departing'} ${dayLabel} · ${time(when)}`;
  const guard = accessGuard(m);
  const checkedIn = m.state === 'checked_in';
  const checkedOut = m.state === 'checked_out';

  return (
    <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-[14px]">
      <div className="flex items-center gap-3 flex-wrap">
        <ChannelMark ch={m.channel} size={24} />
        <div className="flex flex-col gap-[2px] min-w-0 flex-1">
          <span className="text-heading font-semibold">{heading}</span>
          <span className="text-meta text-muted-ink">
            {m.propertyName} {m.unitNumber} · {fmtGuests(m.guestsCount)} · {fmtNights(m.nights)}
          </span>
        </div>
        <div className="flex items-center gap-[7px]">
          <Badge tone={RESERVATION[m.state].tone} label={RESERVATION[m.state].label} size="sm" />
          <Badge tone={READINESS[m.readiness].tone} label={READINESS[m.readiness].label} size="sm" />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {arrival && !checkedIn && (
          <>
            <Button size="sm" variant="tertiary" onClick={onPrepare} disabled={!!m.preparedAt} disabledReason="Arrival is already prepared.">Prepare early</Button>
            <Button size="sm" variant="secondary" onClick={onSendAccess} disabled={!!guard} disabledReason={guard ?? undefined}>Send access details</Button>
            <Button size="sm" variant="primary" onClick={onCheckIn}>Mark checked in</Button>
            {m.preparedAt && <Chip label="Prepared" />}
            {m.accessSentAt && !m.preparedAt && <Chip label="Access sent" />}
          </>
        )}
        {arrival && checkedIn && <span className="text-meta text-muted-ink">Checked in.</span>}
        {!arrival && (
          <Button size="sm" variant="secondary" onClick={onCheckOut} disabled={checkedOut} disabledReason="Guest is already checked out.">
            {checkedOut ? 'Checked out' : 'Mark checked out'}
          </Button>
        )}
      </div>
    </div>
  );
}

function ChannelChip({ ch }: { ch: BookingChannel }) {
  const c = channel[ch];
  return (
    <span
      className="inline-flex items-center h-[22px] px-[9px] py-0 rounded-full border border-solid border-line text-caption font-semibold whitespace-nowrap"
      style={{ background: c.tint, color: c.ink }}>
      {c.label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-meta text-muted-ink">{label}</span>
      <span className="text-title font-semibold [font-variant-numeric:tabular-nums]">{value}</span>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-[22px] px-[9px] py-0 rounded-full bg-gold-tint text-gold-ink border border-solid border-[var(--color-gold-200)] text-caption font-semibold">
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

/** Shared field visuals minus height/padding, so per-control sizing composes cleanly.
 *  `font:inherit` (last shorthand) intentionally resets the size/weight to the
 *  inherited 16px / 400 — the controls genuinely render at that, not text-body. */
const fieldBase = 'block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy';
const inputClass = cx(fieldBase, 'h-10 px-3 py-0');
const labelClass = 'text-meta font-medium text-muted-ink';

function ModalShell({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[460px] bg-white rounded-card shadow-[var(--shadow-overlay)] overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="pt-5 px-[22px] pb-[6px]">
          <h2 className="m-0 text-title font-semibold">{title}</h2>
          {sub && <p className="mt-[6px] mx-0 mb-0 text-copy text-muted-ink">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function MessageModal({ g, onClose, onSend }: { g: Guest; onClose: () => void; onSend: (body: string) => void }) {
  const [body, setBody] = useState('');
  return (
    <ModalShell title={`Message ${g.fullName}`} sub={`Thread opens on ${threadName(g.channel)}.`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (body.trim()) onSend(body.trim()); }} className="pt-3 px-[22px] pb-5 flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="msg-body" className={labelClass}>Message</label>
          <textarea id="msg-body" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${g.fullName.split(' ')[0]}, checking in on your upcoming stay…`}
            className={cx(fieldBase, 'p-[10px_12px] resize-y')} />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" disabled={!body.trim()} disabledReason="Write a message first.">Send message</Button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddGuestModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (input: { fullName: string; phone: string; email: string; unitNumber: string; propertyName: string; guestsCount: number }) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [guestsCount, setGuestsCount] = useState(1);

  // The real unit list, sorted by building so a portfolio of 100+ units stays findable.
  const roster = useUnitRoster();
  const UNITS = useMemo(() => [...roster].sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })), [roster]);
  const [unitId, setUnitId] = useState('');
  const unit = UNITS.find(u => u.id === unitId) ?? UNITS[0];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !unit) return;
    onAdd({ fullName: fullName.trim(), phone, email, unitNumber: unit.unitNumber, propertyName: unit.propertyName, guestsCount });
  }

  return (
    <ModalShell title="Add guest" sub="For walk-ins and direct bookings. Placed in today’s arrivals." onClose={onClose}>
      <form onSubmit={submit} className="pt-3 px-[22px] pb-5 flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="ag-name" className={labelClass}>Full name</label>
          <input id="ag-name" required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" className={inputClass} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ag-phone" className={labelClass}>Phone</label>
            <input id="ag-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+60 12-345 6789" className={inputClass} />
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ag-email" className={labelClass}>Email</label>
            <input id="ag-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <div className="flex flex-col gap-[6px]">
            {UNITS.length === 0
              ? <Select label="Unit" showLabel size="md" value="" onChange={() => {}} disabled placeholder="Loading units…" options={[]} />
              : <SearchSelect label="Unit" showLabel value={unit?.id ?? ''} onChange={setUnitId} placeholder="Search units"
                  options={UNITS.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName }))} />}
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ag-guests" className={labelClass}>Guests</label>
            <input id="ag-guests" type="number" min={1} max={12} value={guestsCount}
              onChange={e => setGuestsCount(Math.max(1, Number(e.target.value) || 1))} className={cx(inputClass, 'text-right [font-variant-numeric:tabular-nums]!')} />
          </div>
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" disabled={!fullName.trim() || !unit} disabledReason={unit ? 'A name is required.' : 'The unit list is still loading.'}>Add guest</Button>
        </div>
      </form>
    </ModalShell>
  );
}
