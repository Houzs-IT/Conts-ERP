import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { color, channel } from '../theme';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner } from '../components/DataState';
import Icon from '../components/Icon';
import { cx } from '../lib/design-tokens';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useSession } from '../lib/session';
import { RESERVATION, READINESS } from '../lib/vocabulary';
import { rm, dateRange, time, nights as fmtNights, guests as fmtGuests } from '../lib/format';
import type { BookingChannel, ReservationState, UnitReadiness, UserRole, Tone } from '../lib/types';

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

/** One past or current stay in a guest's history. */
interface Stay {
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

/** A directory guest. Contact is null-masked away from operations roles. */
interface Guest {
  id: string; fullName: string; email: string | null; phone: string | null;
  channel: BookingChannel;
  tag: { label: string; tone: Tone };
  since: string;
  stays: number; nights: number; lifetimeValue: number; ratingScore: number | null;
  history: Stay[];
  movement?: GuestMovement;
  /** Internal operations notes, when the payload carries them. Ops roles only. */
  notes?: string | null;
}

interface Payload { data: Guest[]; total: number; generatedAt: string }

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
      { checkIn: '2026-05-18', checkOut: '2026-05-22', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', nights: 4, channel: 'airbnb', value: 92400, state: 'checked_out' },
      { checkIn: '2026-03-06', checkOut: '2026-03-09', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', nights: 3, channel: 'booking_com', value: 79500, state: 'checked_out' },
    ],
    movement: { reservationId: 'r1', kind: 'arrival', day: 'today', checkInAt: at(95), checkOutAt: '', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', nights: 3, guestsCount: 2, state: 'confirmed', readiness: 'ready', preparedAt: null, accessSentAt: null },
  },
  {
    id: 'g2', fullName: 'Aaron Lee', email: 'aaron@example.com', phone: '+60 12-111 0002',
    channel: 'direct', tag: { label: 'Direct', tone: 'info' }, since: 'Guest since Jun 2025',
    stays: 3, nights: 11, lifetimeValue: 486000, ratingScore: 4.8,
    history: [
      { checkIn: '2026-05-09', checkOut: '2026-05-11', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', nights: 2, channel: 'direct', value: 262000, state: 'checked_out' },
      { checkIn: '2026-01-18', checkOut: '2026-01-21', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', nights: 3, channel: 'direct', value: 224000, state: 'checked_out' },
    ],
    movement: { reservationId: 'r2', kind: 'arrival', day: 'today', checkInAt: at(320), checkOutAt: '', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', channel: 'direct', nights: 2, guestsCount: 1, state: 'confirmed', readiness: 'ready', preparedAt: null, accessSentAt: null },
  },
  {
    id: 'g3', fullName: 'Priya Sundaram', email: 'priya@example.com', phone: '+65 8111 0003',
    channel: 'booking_com', tag: { label: 'Payment pending', tone: 'warning' }, since: 'First booking',
    stays: 1, nights: 4, lifetimeValue: 168000, ratingScore: null,
    history: [],
    movement: { reservationId: 'r3', kind: 'arrival', day: 'today', checkInAt: at(40), checkOutAt: '', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', channel: 'booking_com', nights: 4, guestsCount: 2, state: 'confirmed', readiness: 'cleaning', preparedAt: null, accessSentAt: null },
  },
  {
    id: 'g4', fullName: 'Chen Yu', email: 'chen@example.com', phone: '+86 131 110 004',
    channel: 'agoda', tag: { label: 'Repeat guest', tone: 'success' }, since: 'Guest since Jan 2026',
    stays: 2, nights: 5, lifetimeValue: 96000, ratingScore: 4.9,
    history: [
      { checkIn: '2026-06-20', checkOut: '2026-06-23', unitNumber: '#2207', propertyName: 'The Establishment', nights: 3, channel: 'agoda', value: 51000, state: 'checked_out' },
    ],
    movement: { reservationId: 'r4', kind: 'departure', day: 'today', checkInAt: '', checkOutAt: at(-45), unitNumber: '#2207', propertyName: 'The Establishment', channel: 'agoda', nights: 2, guestsCount: 3, state: 'checked_in', readiness: 'occupied', preparedAt: at(-2000), accessSentAt: at(-2000) },
  },
  {
    id: 'g5', fullName: 'Marcus Wong', email: 'marcus@example.com', phone: '+60 12-111 0005',
    channel: 'direct', tag: { label: 'Corporate', tone: 'info' }, since: 'Guest since Sep 2024',
    stays: 6, nights: 28, lifetimeValue: 1892000, ratingScore: 4.7,
    history: [
      { checkIn: '2026-07-01', checkOut: '2026-07-06', unitNumber: '#A-21-02', propertyName: 'The Establishment', nights: 5, channel: 'direct', value: 640000, state: 'checked_out' },
      { checkIn: '2026-04-14', checkOut: '2026-04-18', unitNumber: '#A-21-02', propertyName: 'The Establishment', nights: 4, channel: 'direct', value: 512000, state: 'checked_out' },
    ],
    movement: { reservationId: 'r5', kind: 'departure', day: 'today', checkInAt: '', checkOutAt: at(60), unitNumber: '#A-21-02', propertyName: 'The Establishment', channel: 'direct', nights: 5, guestsCount: 2, state: 'checked_in', readiness: 'occupied', preparedAt: at(-6000), accessSentAt: at(-6000) },
  },
  {
    id: 'g6', fullName: 'Siti Rahmah', email: 'siti@example.com', phone: '+60 12-111 0006',
    channel: 'direct', tag: { label: 'New', tone: 'neutral' }, since: 'First booking',
    stays: 1, nights: 2, lifetimeValue: 138000, ratingScore: null,
    history: [],
  },
  {
    id: 'g7', fullName: 'Sofia Reyes', email: 'sofia@example.com', phone: '+63 917 100 0006',
    channel: 'airbnb', tag: { label: 'New', tone: 'neutral' }, since: 'First booking',
    stays: 1, nights: 3, lifetimeValue: 0, ratingScore: null,
    history: [],
    movement: { reservationId: 'r6', kind: 'arrival', day: 'tomorrow', checkInAt: at(1440 + 60), checkOutAt: '', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', nights: 3, guestsCount: 2, state: 'confirmed', readiness: 'ready', preparedAt: null, accessSentAt: null },
  },
  {
    id: 'g8', fullName: 'Ben Carter', email: 'ben@example.com', phone: '+44 7700 900006',
    channel: 'agoda', tag: { label: 'Repeat guest', tone: 'success' }, since: 'Guest since Feb 2026',
    stays: 2, nights: 9, lifetimeValue: 742000, ratingScore: 4.7,
    history: [
      { checkIn: '2026-02-11', checkOut: '2026-02-17', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', nights: 6, channel: 'agoda', value: 742000, state: 'checked_out' },
    ],
    movement: { reservationId: 'r7', kind: 'arrival', day: 'tomorrow', checkInAt: at(1440 + 260), checkOutAt: '', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', channel: 'agoda', nights: 6, guestsCount: 4, state: 'confirmed', readiness: 'dirty', preparedAt: null, accessSentAt: null },
  },
  {
    id: 'g9', fullName: 'Yuki Tanaka', email: 'yuki@example.com', phone: '+81 90 1000 0007',
    channel: 'booking_com', tag: { label: 'Direct', tone: 'info' }, since: 'Guest since Nov 2025',
    stays: 1, nights: 3, lifetimeValue: 210000, ratingScore: null,
    history: [],
    movement: { reservationId: 'r8', kind: 'departure', day: 'tomorrow', checkInAt: '', checkOutAt: at(1440 + 30), unitNumber: '#15-06', propertyName: 'Scarletz KLCC', channel: 'booking_com', nights: 3, guestsCount: 1, state: 'checked_in', readiness: 'occupied', preparedAt: at(-2800), accessSentAt: at(-2800) },
  },
];

const FALLBACK: Payload = { data: GUESTS, total: 312, generatedAt: '' };

const OPS_ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff'];
const TWO_HOURS = 2 * 60 * 60 * 1000;
const initials = (name: string) => name.split(' ').map(n => n[0]).slice(0, 2).join('');
const threadName = (ch: BookingChannel) => (ch === 'direct' ? 'WhatsApp' : channel[ch].label);

type Filter = 'all' | 'arriving_today' | 'departing_today' | 'tomorrow';
const FILTERS: { key: Filter; label: string; match: (g: Guest) => boolean }[] = [
  { key: 'all', label: 'All guests', match: () => true },
  { key: 'arriving_today', label: 'Arriving today', match: g => g.movement?.kind === 'arrival' && g.movement.day === 'today' },
  { key: 'departing_today', label: 'Departing today', match: g => g.movement?.kind === 'departure' && g.movement.day === 'today' },
  { key: 'tomorrow', label: 'Tomorrow', match: g => g.movement?.day === 'tomorrow' },
];

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

  const { data, error, reload } = useApi<Payload>('/guests', FALLBACK);

  // Optimistic overlays — no backend in dev.
  const [mEdits, setMEdits] = useState<Record<string, Partial<GuestMovement>>>({});
  const [added, setAdded] = useState<Guest[]>([]);
  const [busy, setBusy] = useState(false);

  // Overlay / selection state.
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<Guest | null>(null);
  const [checkout, setCheckout] = useState<Guest | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const mergeGuest = (g: Guest): Guest =>
    g.movement && mEdits[g.movement.reservationId]
      ? { ...g, movement: { ...g.movement, ...mEdits[g.movement.reservationId] } }
      : g;
  const mPatch = (rid: string, p: Partial<GuestMovement>) =>
    setMEdits(e => ({ ...e, [rid]: { ...e[rid], ...p } }));

  const allGuests = useMemo(
    () => [...added, ...(data?.data ?? [])].map(mergeGuest),
    [added, data, mEdits],
  );
  const rows = useMemo(() => {
    const m = FILTERS.find(f => f.key === filter)!.match;
    return allGuests.filter(m);
  }, [allGuests, filter]);

  const selected = rows.find(g => g.id === selectedId) ?? rows[0] ?? allGuests[0] ?? null;
  const total = data?.total ?? allGuests.length;

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: allGuests.length, arriving_today: 0, departing_today: 0, tomorrow: 0 };
    for (const g of allGuests) for (const f of FILTERS) if (f.key !== 'all' && f.match(g)) c[f.key]++;
    return c;
  }, [allGuests]);

  // ---- actions (optimistic; the real call is attempted and swallowed) ----
  function prepareEarly(g: Guest) {
    const m = g.movement; if (!m) return;
    mPatch(m.reservationId, { preparedAt: new Date().toISOString(), accessSentAt: new Date().toISOString(), readiness: 'ready' });
    toast({ tone: 'success', title: `${m.propertyName} ${m.unitNumber} prepared.`, body: 'Access sent and the unit is confirmed ready.' });
    api.post(`/reservations/${m.reservationId}/prepare`, {}).catch(notifyFailure);
  }
  function sendAccess(g: Guest) {
    const m = g.movement; if (!m) return;
    mPatch(m.reservationId, { accessSentAt: new Date().toISOString() });
    toast({ tone: 'success', title: `Access details sent to ${g.fullName}.`, body: `Delivered on ${threadName(m.channel)}.` });
    api.post('/messages', { reservationId: m.reservationId, kind: 'access_details' }).catch(notifyFailure);
  }
  function markCheckedIn(g: Guest) {
    const m = g.movement; if (!m) return;
    mPatch(m.reservationId, { state: 'checked_in', readiness: 'occupied' });
    toast({ tone: 'success', title: `${g.fullName} checked in.`, body: `${m.propertyName} ${m.unitNumber} is now occupied.` });
    api.patch(`/reservations/${m.reservationId}`, { state: 'checked_in' }).catch(notifyFailure);
  }
  async function confirmCheckout() {
    if (!checkout?.movement) return;
    const g = checkout, m = checkout.movement;
    setBusy(true);
    mPatch(m.reservationId, { state: 'checked_out', readiness: 'dirty' });
    try { await api.patch(`/reservations/${m.reservationId}`, { state: 'checked_out' }); } catch (e) { notifyFailure(e); }
    toast({ tone: 'success', title: `${g.fullName} checked out.`, body: `A cleaning task was created for ${m.propertyName} ${m.unitNumber}.` });
    setBusy(false);
    setCheckout(null);
  }
  function sendMessage(body: string) {
    if (!message) return;
    const g = message;
    toast({ tone: 'success', title: `Message sent to ${g.fullName}.`, body: `Thread opened on ${threadName(g.channel)}.` });
    api.post('/messages', { guestId: g.id, body }).catch(notifyFailure);
    setMessage(null);
  }
  function bookAgain(g: Guest) {
    toast({ tone: 'success', title: `New booking started for ${g.fullName}.`, body: 'Pick a unit and dates to confirm.' });
    api.post('/reservations', { guestId: g.id }).catch(notifyFailure);
  }
  function addWalkIn(input: { fullName: string; phone: string; email: string; unitNumber: string; propertyName: string; guestsCount: number }) {
    const id = crypto.randomUUID();
    const g: Guest = {
      id, fullName: input.fullName, email: input.email || null, phone: input.phone || null,
      channel: 'direct', tag: { label: 'New', tone: 'neutral' }, since: 'First booking',
      stays: 1, nights: 1, lifetimeValue: 0, ratingScore: null, history: [],
      movement: {
        reservationId: id, kind: 'arrival', day: 'today', checkInAt: new Date().toISOString(), checkOutAt: '',
        unitNumber: input.unitNumber, propertyName: input.propertyName, channel: 'direct',
        nights: 1, guestsCount: input.guestsCount, state: 'confirmed', readiness: 'ready', preparedAt: null, accessSentAt: null,
      },
    };
    setAdded(a => [g, ...a]);
    setFilter('all');
    setSelectedId(id);
    toast({ tone: 'success', title: `${input.fullName} added.`, body: 'Walk-in placed in today’s arrivals.' });
    api.post('/guests', input).catch(notifyFailure);
    setAdding(false);
  }

  return (
    <>
      <PageHeader
        title="Guests"
        sub={`${total.toLocaleString('en-MY')} guests · contact details restricted to operations roles`}
        right={<Button variant="primary" size="md" onClick={() => setAdding(true)}>Add guest</Button>}
      />

      {error && <StaleBanner message={`Showing the last guest list we have. ${error}`} onRetry={reload} />}

      <div className="flex gap-5 items-start flex-wrap max-w-[1600px]">
        {/* -------- left: directory list -------- */}
        <div className="flex-[1_1_320px] min-w-[280px] max-w-[440px] bg-card border border-solid border-line rounded-card overflow-hidden">
          <div className="py-[14px] px-[18px] [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-[11px]">
            <span className="text-[12px] text-muted-ink">
              {total.toLocaleString('en-MY')} guests · {rows.length} shown
            </span>
            <div role="tablist" aria-label="Filter guests" className="flex gap-[6px] flex-wrap">
              {FILTERS.map(f => {
                const on = f.key === filter;
                const n = counts[f.key];
                return (
                  <button
                    key={f.key} role="tab" aria-selected={on}
                    onClick={() => { setFilter(f.key); setSelectedId(null); }}
                    className={cx(
                      'h-7 inline-flex items-center gap-[5px] px-[11px] py-0 rounded-full cursor-pointer whitespace-nowrap [font:inherit] border border-solid',
                      on ? 'border-black bg-black text-white' : 'border-line bg-card text-muted-ink',
                    )}
                  >
                    {f.label}
                    {f.key !== 'all' && <span className="[font-variant-numeric:tabular-nums] opacity-85">{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-[640px] overflow-y-auto">
            {rows.length === 0 ? (
              <div className="py-6 px-[18px] text-[13px] text-muted-ink">No guests match this filter.</div>
            ) : (
              rows.map(g => (
                <GuestRow
                  key={g.id} g={g} selected={selected?.id === g.id} canSeeContact={canSeeContact}
                  onSelect={() => setSelectedId(g.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* -------- right: guest profile -------- */}
        <div className="flex-[1.6_1_460px] min-w-0 flex flex-col gap-[18px]">
          {selected ? (
            <ProfilePanel
              g={selected} canSeeContact={canSeeContact}
              onMessage={() => setMessage(selected)}
              onBookAgain={() => bookAgain(selected)}
              onPrepare={() => prepareEarly(selected)}
              onSendAccess={() => sendAccess(selected)}
              onCheckIn={() => markCheckedIn(selected)}
              onCheckOut={() => setCheckout(selected)}
            />
          ) : (
            <div className="py-10 px-[22px] bg-card border border-solid border-line rounded-card text-[13px] text-muted-ink">
              Select a guest to see their profile.
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
  g: Guest; selected: boolean; canSeeContact: boolean; onSelect: () => void;
}) {
  const meta = canSeeContact
    ? [g.email, g.phone].filter(Boolean).join(' · ') || '—'
    : 'Contact limited to operations roles';
  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={cx(
        'flex items-center gap-3 w-full text-left [font:inherit] min-h-[62px] py-[11px] px-4 cursor-pointer [border-top:0] [border-right:0] [border-left:0] [border-bottom:1px_solid_var(--color-line-soft)]',
        selected ? 'bg-gold-tint shadow-[inset_3px_0_0_var(--color-gold)]' : 'bg-card shadow-none',
      )}
    >
      <span className="w-[34px] h-[34px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-[12px] font-semibold">
        {initials(g.fullName)}
      </span>
      <span className="flex flex-col gap-[2px] min-w-0 flex-1">
        <span className="text-[13.5px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{g.fullName}</span>
        <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{meta}</span>
      </span>
      <span className="flex flex-col items-end gap-1 flex-none">
        <Badge tone={g.tag.tone} label={g.tag.label} size="sm" />
        <span className="text-[11.5px] text-muted-ink">{g.stays} {g.stays === 1 ? 'stay' : 'stays'}</span>
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
      <div className="bg-card border border-solid border-line rounded-card p-[22px] flex flex-col gap-[18px]">
        <div className="flex items-start justify-between gap-[18px] flex-wrap">
          <div className="flex items-center gap-[14px] min-w-0">
            <span className="w-[46px] h-[46px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-[16px] font-semibold">
              {initials(g.fullName)}
            </span>
            <div className="min-w-0 flex flex-col gap-[3px]">
              <h2 className="m-0 text-[20px] leading-[1.25] font-semibold">{g.fullName}</h2>
              <span className="text-[12px] text-muted-ink">{contact}</span>
              <div className="flex items-center gap-[7px] flex-wrap pt-[2px]">
                <Badge tone={g.tag.tone} label={g.tag.label} size="sm" />
                <span className="text-[11.5px] text-muted-ink">{g.since}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="md" variant="secondary" icon={<Icon name="MessageSquare" size="sm" />} onClick={onMessage}>Message</Button>
            <Button size="md" variant="primary" onClick={onBookAgain}>Book again</Button>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-[14px] pt-4 [border-top:1px_solid_var(--color-line-soft)]">
          <Stat label="Stays" value={String(g.stays)} />
          <Stat label="Nights" value={String(g.nights)} />
          <Stat label="Lifetime value" value={rm(g.lifetimeValue, { cents: false })} />
          <Stat label="Rating given" value={g.ratingScore != null ? g.ratingScore.toFixed(1) : '—'} />
        </div>
      </div>

      {/* today's arrival / departure — ops controls on the relevant guest */}
      {g.movement && <MovementStrip g={g} onPrepare={onPrepare} onSendAccess={onSendAccess} onCheckIn={onCheckIn} onCheckOut={onCheckOut} />}

      {/* stay history */}
      <div className="bg-card border border-solid border-line rounded-card overflow-hidden">
        <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] text-[16px] font-semibold">Stay history</div>
        {g.history.length === 0 ? (
          <div className="py-[18px] px-5 text-[12.5px] text-muted-ink">This is their first stay.</div>
        ) : (
          g.history.map((s, i) => (
            <div key={i} className={cx('flex items-center gap-[14px] py-[13px] px-5 flex-wrap', i < g.history.length - 1 ? '[border-bottom:1px_solid_var(--color-line-soft)]' : '')}>
              <span aria-hidden className="w-[44px] h-[44px] flex-none rounded-[6px] bg-muted grid place-items-center">
                <Icon name="Image" size="sm" color={color.faint} />
              </span>
              <div className="flex flex-col gap-[2px] min-w-[140px] flex-1">
                <span className="text-[13.5px] font-medium">{s.propertyName} {s.unitNumber}</span>
                <span className="text-[11.5px] text-muted-ink">{dateRange(s.checkIn, s.checkOut)} · {fmtNights(s.nights)}</span>
              </div>
              <ChannelChip ch={s.channel} />
              <span className="text-[13px] font-medium w-[92px] text-right [font-variant-numeric:tabular-nums]">{rm(s.value, { cents: false })}</span>
              <Badge tone={RESERVATION[s.state].tone} label={RESERVATION[s.state].label} size="sm" />
            </div>
          ))
        )}
      </div>

      {/* contact / notes footnote */}
      <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-2">
        <span className="text-[16px] font-semibold">Contact</span>
        {canSeeContact ? (
          <div className="flex flex-col gap-[3px]">
            <span className="text-[13px]">{g.email ?? '—'}</span>
            <span className="text-[13px] text-muted-ink">{g.phone ?? '—'}</span>
          </div>
        ) : (
          <span className="text-[12.5px] text-faint">
            Guest contact details are visible to operations roles only. Field roles see the guest name where a task requires it.
          </span>
        )}
      </div>

      {/* operations notes — internal, restricted to operations roles like contact */}
      <div className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-2">
        <span className="text-[16px] font-semibold">Operations notes</span>
        {canSeeContact ? (
          g.notes ? (
            <span className="text-[13px] [text-wrap:pretty]">{g.notes}</span>
          ) : (
            <span className="text-[12.5px] text-muted-ink">No operations notes.</span>
          )
        ) : (
          <span className="text-[12.5px] text-faint">
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
        <ChannelMarkStub ch={m.channel} />
        <div className="flex flex-col gap-[2px] min-w-0 flex-1">
          <span className="text-[14px] font-semibold">{heading}</span>
          <span className="text-[11.5px] text-muted-ink">
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
        {arrival && checkedIn && <span className="text-[12px] text-muted-ink">Checked in.</span>}
        {!arrival && (
          <Button size="sm" variant="secondary" onClick={onCheckOut} disabled={checkedOut} disabledReason="Guest is already checked out.">
            {checkedOut ? 'Checked out' : 'Mark checked out'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Small channel tile matching ChannelMark without importing it (keeps ink rules). */
function ChannelMarkStub({ ch }: { ch: BookingChannel }) {
  const c = channel[ch];
  const two = c.glyph.length > 1;
  const px = Math.max(11, two ? 9 : 12);
  return (
    <span aria-hidden
      className="w-[24px] h-[24px] flex-none rounded-[7px] grid place-items-center leading-none font-bold"
      style={{ fontSize: px, letterSpacing: two ? '-0.03em' : 0, background: c.fill, color: c.markInk }}>
      {c.glyph}
    </span>
  );
}

function ChannelChip({ ch }: { ch: BookingChannel }) {
  const c = channel[ch];
  return (
    <span
      className="inline-flex items-center h-[22px] px-[9px] py-0 rounded-full border border-solid border-line text-[11px] font-semibold whitespace-nowrap"
      style={{ background: c.tint, color: c.ink }}>
      {c.label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-[11.5px] text-muted-ink">{label}</span>
      <span className="text-[19px] font-semibold [font-variant-numeric:tabular-nums]">{value}</span>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-[22px] px-[9px] py-0 rounded-full bg-gold-tint text-gold-ink border border-solid border-[var(--color-gold-200)] text-[11px] font-semibold">
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
const fieldBase = 'block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit]';
const inputClass = cx(fieldBase, 'h-10 px-3 py-0');
const labelClass = 'text-[12px] font-medium text-muted-ink';

function ModalShell({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[460px] bg-white rounded-card shadow-[var(--shadow-overlay)] overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="pt-5 px-[22px] pb-[6px]">
          <h2 className="m-0 text-[18px] font-semibold">{title}</h2>
          {sub && <p className="mt-[6px] mx-0 mb-0 text-[13px] text-muted-ink">{sub}</p>}
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
  const [unitNumber, setUnitNumber] = useState('#A-12-03');
  const [guestsCount, setGuestsCount] = useState(1);

  const UNITS = [
    { unitNumber: '#A-12-03', propertyName: 'Vista Jaya One' },
    { unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara' },
    { unitNumber: '#15-06', propertyName: 'Scarletz KLCC' },
    { unitNumber: '#2207', propertyName: 'The Establishment' },
    { unitNumber: '#C-31-14', propertyName: 'Sentral Suites' },
  ];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    const unit = UNITS.find(u => u.unitNumber === unitNumber) ?? UNITS[0];
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
            <label htmlFor="ag-unit" className={labelClass}>Unit</label>
            <select id="ag-unit" value={unitNumber} onChange={e => setUnitNumber(e.target.value)} className={inputClass}>
              {UNITS.map(u => <option key={u.unitNumber} value={u.unitNumber}>{u.propertyName} {u.unitNumber}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="ag-guests" className={labelClass}>Guests</label>
            <input id="ag-guests" type="number" min={1} max={12} value={guestsCount}
              onChange={e => setGuestsCount(Math.max(1, Number(e.target.value) || 1))} className={cx(inputClass, 'text-right [font-variant-numeric:tabular-nums]!')} />
          </div>
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" disabled={!fullName.trim()} disabledReason="A name is required.">Add guest</Button>
        </div>
      </form>
    </ModalShell>
  );
}
