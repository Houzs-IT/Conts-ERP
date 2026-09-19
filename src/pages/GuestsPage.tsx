import { useMemo, useState, type FormEvent, type ReactNode, type CSSProperties } from 'react';
import { color, radius, text, channel, shell } from '../theme';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner } from '../components/DataState';
import Icon from '../components/Icon';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
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
    api.post(`/reservations/${m.reservationId}/prepare`, {}).catch(() => { /* dev: no backend */ });
  }
  function sendAccess(g: Guest) {
    const m = g.movement; if (!m) return;
    mPatch(m.reservationId, { accessSentAt: new Date().toISOString() });
    toast({ tone: 'success', title: `Access details sent to ${g.fullName}.`, body: `Delivered on ${threadName(m.channel)}.` });
    api.post('/messages', { reservationId: m.reservationId, kind: 'access_details' }).catch(() => {});
  }
  function markCheckedIn(g: Guest) {
    const m = g.movement; if (!m) return;
    mPatch(m.reservationId, { state: 'checked_in', readiness: 'occupied' });
    toast({ tone: 'success', title: `${g.fullName} checked in.`, body: `${m.propertyName} ${m.unitNumber} is now occupied.` });
    api.patch(`/reservations/${m.reservationId}`, { state: 'checked_in' }).catch(() => {});
  }
  async function confirmCheckout() {
    if (!checkout?.movement) return;
    const g = checkout, m = checkout.movement;
    setBusy(true);
    mPatch(m.reservationId, { state: 'checked_out', readiness: 'dirty' });
    try { await api.patch(`/reservations/${m.reservationId}`, { state: 'checked_out' }); } catch { /* dev: no backend */ }
    toast({ tone: 'success', title: `${g.fullName} checked out.`, body: `A cleaning task was created for ${m.propertyName} ${m.unitNumber}.` });
    setBusy(false);
    setCheckout(null);
  }
  function sendMessage(body: string) {
    if (!message) return;
    const g = message;
    toast({ tone: 'success', title: `Message sent to ${g.fullName}.`, body: `Thread opened on ${threadName(g.channel)}.` });
    api.post('/messages', { guestId: g.id, body }).catch(() => {});
    setMessage(null);
  }
  function bookAgain(g: Guest) {
    toast({ tone: 'success', title: `New booking started for ${g.fullName}.`, body: 'Pick a unit and dates to confirm.' });
    api.post('/reservations', { guestId: g.id }).catch(() => {});
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
    api.post('/guests', input).catch(() => {});
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

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', maxWidth: shell.contentMax }}>
        {/* -------- left: directory list -------- */}
        <div style={{ flex: '1 1 320px', minWidth: 280, maxWidth: 440, background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 11 }}>
            <span style={{ fontSize: text.small, color: color.textMuted }}>
              {total.toLocaleString('en-MY')} guests · {rows.length} shown
            </span>
            <div role="tablist" aria-label="Filter guests" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {FILTERS.map(f => {
                const on = f.key === filter;
                const n = counts[f.key];
                return (
                  <button
                    key={f.key} role="tab" aria-selected={on}
                    onClick={() => { setFilter(f.key); setSelectedId(null); }}
                    style={{
                      height: 28, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 11px',
                      borderRadius: radius.pill, fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                      border: `1px solid ${on ? color.black : color.border}`,
                      background: on ? color.black : color.card, color: on ? '#FFFFFF' : color.textMuted,
                    }}
                  >
                    {f.label}
                    {f.key !== 'all' && <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ maxHeight: 640, overflowY: 'auto' }}>
            {rows.length === 0 ? (
              <div style={{ padding: '24px 18px', fontSize: 13, color: color.textMuted }}>No guests match this filter.</div>
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
        <div style={{ flex: '1.6 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
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
            <div style={{ padding: '40px 22px', background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, fontSize: 13, color: color.textMuted }}>
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
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', font: 'inherit',
        minHeight: 62, padding: '11px 16px', border: 'none', cursor: 'pointer',
        borderBottom: `1px solid ${color.borderMuted}`,
        background: selected ? color.goldTint : color.card,
        boxShadow: selected ? `inset 3px 0 0 ${color.gold}` : 'none',
      }}
    >
      <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: text.small, fontWeight: 600 }}>
        {initials(g.fullName)}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.fullName}</span>
        <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
        <Badge tone={g.tag.tone} label={g.tag.label} size="sm" />
        <span style={{ fontSize: 11.5, color: color.textMuted }}>{g.stays} {g.stays === 1 ? 'stay' : 'stays'}</span>
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
      <div style={{ background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <span style={{ width: 46, height: 46, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 600 }}>
              {initials(g.fullName)}
            </span>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.25, fontWeight: 600 }}>{g.fullName}</h2>
              <span style={{ fontSize: 12, color: color.textMuted }}>{contact}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', paddingTop: 2 }}>
                <Badge tone={g.tag.tone} label={g.tag.label} size="sm" />
                <span style={{ fontSize: 11.5, color: color.textMuted }}>{g.since}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="md" variant="secondary" icon={<Icon name="MessageSquare" size="sm" />} onClick={onMessage}>Message</Button>
            <Button size="md" variant="primary" onClick={onBookAgain}>Book again</Button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14, paddingTop: 16, borderTop: `1px solid ${color.borderMuted}` }}>
          <Stat label="Stays" value={String(g.stays)} />
          <Stat label="Nights" value={String(g.nights)} />
          <Stat label="Lifetime value" value={rm(g.lifetimeValue, { cents: false })} />
          <Stat label="Rating given" value={g.ratingScore != null ? g.ratingScore.toFixed(1) : '—'} />
        </div>
      </div>

      {/* today's arrival / departure — ops controls on the relevant guest */}
      {g.movement && <MovementStrip g={g} onPrepare={onPrepare} onSendAccess={onSendAccess} onCheckIn={onCheckIn} onCheckOut={onCheckOut} />}

      {/* stay history */}
      <div style={{ background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, fontSize: text.cardTitle, fontWeight: 600 }}>Stay history</div>
        {g.history.length === 0 ? (
          <div style={{ padding: '18px 20px', fontSize: 12.5, color: color.textMuted }}>This is their first stay.</div>
        ) : (
          g.history.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: i < g.history.length - 1 ? `1px solid ${color.borderMuted}` : 'none', flexWrap: 'wrap' }}>
              <span aria-hidden style={{ width: 44, height: 44, flex: 'none', borderRadius: radius.sm, background: color.muted, display: 'grid', placeItems: 'center' }}>
                <Icon name="Image" size="sm" color={color.faint} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140, flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.propertyName} {s.unitNumber}</span>
                <span style={{ fontSize: 11.5, color: color.textMuted }}>{dateRange(s.checkIn, s.checkOut)} · {fmtNights(s.nights)}</span>
              </div>
              <ChannelChip ch={s.channel} />
              <span style={{ fontSize: 13, fontWeight: 500, width: 92, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rm(s.value, { cents: false })}</span>
              <Badge tone={RESERVATION[s.state].tone} label={RESERVATION[s.state].label} size="sm" />
            </div>
          ))
        )}
      </div>

      {/* contact / notes footnote */}
      <div style={{ background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Contact</span>
        {canSeeContact ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 13 }}>{g.email ?? '—'}</span>
            <span style={{ fontSize: 13, color: color.textMuted }}>{g.phone ?? '—'}</span>
          </div>
        ) : (
          <span style={{ fontSize: 12.5, color: color.faint }}>
            Guest contact details are visible to operations roles only. Field roles see the guest name where a task requires it.
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
    <div style={{ background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ChannelMarkStub ch={m.channel} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{heading}</span>
          <span style={{ fontSize: 11.5, color: color.textMuted }}>
            {m.propertyName} {m.unitNumber} · {fmtGuests(m.guestsCount)} · {fmtNights(m.nights)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Badge tone={RESERVATION[m.state].tone} label={RESERVATION[m.state].label} size="sm" />
          <Badge tone={READINESS[m.readiness].tone} label={READINESS[m.readiness].label} size="sm" />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {arrival && !checkedIn && (
          <>
            <Button size="sm" variant="tertiary" onClick={onPrepare} disabled={!!m.preparedAt} disabledReason="Arrival is already prepared.">Prepare early</Button>
            <Button size="sm" variant="secondary" onClick={onSendAccess} disabled={!!guard} disabledReason={guard ?? undefined}>Send access details</Button>
            <Button size="sm" variant="primary" onClick={onCheckIn}>Mark checked in</Button>
            {m.preparedAt && <Chip label="Prepared" />}
            {m.accessSentAt && !m.preparedAt && <Chip label="Access sent" />}
          </>
        )}
        {arrival && checkedIn && <span style={{ fontSize: text.small, color: color.textMuted }}>Checked in.</span>}
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
    <span aria-hidden style={{ width: 24, height: 24, flex: 'none', borderRadius: 7, display: 'grid', placeItems: 'center', lineHeight: 1, fontWeight: 700, fontSize: px, letterSpacing: two ? '-0.03em' : 0, background: c.fill, color: c.markInk }}>
      {c.glyph}
    </span>
  );
}

function ChannelChip({ ch }: { ch: BookingChannel }) {
  const c = channel[ch];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: radius.pill, background: c.tint, color: c.ink, border: `1px solid ${color.border}`, fontSize: text.micro, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {c.label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 11.5, color: color.textMuted }}>{label}</span>
      <span style={{ fontSize: 19, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: radius.pill, background: color.goldTint, color: color.goldInk, border: `1px solid ${color.gold200}`, fontSize: text.micro, fontWeight: 600 }}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

const inputStyle: CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px',
  fontSize: text.body, color: color.ink, background: '#FFFFFF',
  border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit',
};
const labelStyle: CSSProperties = { fontSize: text.small, fontWeight: 500, color: color.textMuted };

function ModalShell({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 460, background: '#FFFFFF', borderRadius: radius.card, boxShadow: 'var(--shadow-overlay)', overflow: 'hidden', animation: 'dialog-in var(--motion-slow) var(--ease-out) both' }}>
        <div style={{ padding: '20px 22px 6px' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>
          {sub && <p style={{ margin: '6px 0 0', fontSize: 13, color: color.textMuted }}>{sub}</p>}
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
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (body.trim()) onSend(body.trim()); }} style={{ padding: '12px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="msg-body" style={labelStyle}>Message</label>
          <textarea id="msg-body" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${g.fullName.split(' ')[0]}, checking in on your upcoming stay…`}
            style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
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
      <form onSubmit={submit} style={{ padding: '12px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="ag-name" style={labelStyle}>Full name</label>
          <input id="ag-name" required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Tan" style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="ag-phone" style={labelStyle}>Phone</label>
            <input id="ag-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+60 12-345 6789" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="ag-email" style={labelStyle}>Email</label>
            <input id="ag-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="ag-unit" style={labelStyle}>Unit</label>
            <select id="ag-unit" value={unitNumber} onChange={e => setUnitNumber(e.target.value)} style={inputStyle}>
              {UNITS.map(u => <option key={u.unitNumber} value={u.unitNumber}>{u.propertyName} {u.unitNumber}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="ag-guests" style={labelStyle}>Guests</label>
            <input id="ag-guests" type="number" min={1} max={12} value={guestsCount}
              onChange={e => setGuestsCount(Math.max(1, Number(e.target.value) || 1))} style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" disabled={!fullName.trim()} disabledReason="A name is required.">Add guest</Button>
        </div>
      </form>
    </ModalShell>
  );
}
