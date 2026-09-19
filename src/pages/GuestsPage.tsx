import { useMemo, useState, type FormEvent, type ReactNode, type MouseEvent } from 'react';
import { color, radius, text } from '../theme';
import { Card, CardHeader } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog, Drawer } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import ChannelMark, { channelLabel } from '../components/ChannelMark';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { RESERVATION, READINESS } from '../lib/vocabulary';
import { rm, date, time, rating, nights, guests as guestCount } from '../lib/format';
import type { BookingChannel, ReservationState, UnitReadiness, UserRole } from '../lib/types';

/** One stay in a guest's history. */
interface Stay {
  date: string; unitNumber: string; propertyName: string;
  nights: number; channel: BookingChannel; value: number;
}
/** A single arrival or departure. `id` is the reservation id. */
interface Movement {
  id: string; guestId: string; fullName: string; email: string | null; phone: string | null;
  unitNumber: string; propertyName: string; channel: BookingChannel;
  state: ReservationState; readiness: UnitReadiness;
  checkInAt: string; checkOutAt: string; guestsCount: number; nights: number;
  preparedAt: string | null; accessSentAt: string | null;
  // profile
  stays: number; lifetimeValue: number; ratingScore: number | null; history: Stay[];
}
interface DayMovements { checkingIn: Movement[]; checkingOut: Movement[] }
interface Payload { today: DayMovements; tomorrow: DayMovements; generatedAt: string }

// Times are anchored at load so the two-hour access window is genuinely live in dev.
const NOW = Date.now();
const at = (min: number) => new Date(NOW + min * 60000).toISOString();

const FALLBACK: Payload = {
  generatedAt: '',
  today: {
    checkingIn: [
      { id: 'r1', guestId: 'g1', fullName: 'Nadia Abdullah', email: 'nadia@example.com', phone: '+60 12-111 0001',
        unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', state: 'confirmed', readiness: 'ready',
        checkInAt: at(95), checkOutAt: '', guestsCount: 2, nights: 3, preparedAt: null, accessSentAt: null,
        stays: 3, lifetimeValue: 1245000, ratingScore: 4.91, history: [
          { date: '2026-06-14', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', nights: 4, channel: 'airbnb', value: 512000 },
          { date: '2026-03-02', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', nights: 3, channel: 'direct', value: 384000 },
          { date: '2025-12-20', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', nights: 2, channel: 'airbnb', value: 349000 },
        ] },
      { id: 'r2', guestId: 'g2', fullName: 'Aaron Lee', email: 'aaron@example.com', phone: '+60 12-111 0002',
        unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', channel: 'direct', state: 'confirmed', readiness: 'ready',
        checkInAt: at(320), checkOutAt: '', guestsCount: 1, nights: 2, preparedAt: null, accessSentAt: null,
        stays: 2, lifetimeValue: 486000, ratingScore: 4.80, history: [
          { date: '2026-05-09', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', nights: 2, channel: 'direct', value: 262000 },
          { date: '2026-01-18', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', nights: 3, channel: 'direct', value: 224000 },
        ] },
      { id: 'r3', guestId: 'g3', fullName: 'Priya Sundaram', email: 'priya@example.com', phone: '+65 8111 0003',
        unitNumber: '#15-06', propertyName: 'Scarletz KLCC', channel: 'booking_com', state: 'confirmed', readiness: 'cleaning',
        checkInAt: at(40), checkOutAt: '', guestsCount: 2, nights: 4, preparedAt: null, accessSentAt: null,
        stays: 1, lifetimeValue: 168000, ratingScore: null, history: [] },
    ],
    checkingOut: [
      { id: 'r4', guestId: 'g4', fullName: 'Chen Yu', email: 'chen@example.com', phone: '+86 131 1100 04',
        unitNumber: '#2207', propertyName: 'The Establishment', channel: 'agoda', state: 'checked_in', readiness: 'occupied',
        checkInAt: '', checkOutAt: at(-45), guestsCount: 3, nights: 2, preparedAt: at(-2000), accessSentAt: at(-2000),
        stays: 1, lifetimeValue: 96000, ratingScore: 4.60, history: [] },
      { id: 'r5', guestId: 'g5', fullName: 'Marcus Tan', email: 'marcus@example.com', phone: '+60 12-111 0005',
        unitNumber: '#A-21-02', propertyName: 'The Establishment', channel: 'direct', state: 'checked_in', readiness: 'occupied',
        checkInAt: '', checkOutAt: at(60), guestsCount: 2, nights: 5, preparedAt: at(-6000), accessSentAt: at(-6000),
        stays: 4, lifetimeValue: 1892000, ratingScore: 4.95, history: [
          { date: '2026-07-01', unitNumber: '#A-21-02', propertyName: 'The Establishment', nights: 5, channel: 'direct', value: 640000 },
        ] },
    ],
  },
  tomorrow: {
    checkingIn: [
      { id: 'r6', guestId: 'g6', fullName: 'Sofia Reyes', email: 'sofia@example.com', phone: '+63 917 100 0006',
        unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', state: 'confirmed', readiness: 'ready',
        checkInAt: at(1440 + 60), checkOutAt: '', guestsCount: 2, nights: 3, preparedAt: null, accessSentAt: null,
        stays: 1, lifetimeValue: 0, ratingScore: null, history: [] },
      { id: 'r7', guestId: 'g7', fullName: 'Ben Carter', email: 'ben@example.com', phone: '+44 7700 900006',
        unitNumber: '#C-31-14', propertyName: 'Sentral Suites', channel: 'agoda', state: 'confirmed', readiness: 'dirty',
        checkInAt: at(1440 + 260), checkOutAt: '', guestsCount: 4, nights: 6, preparedAt: null, accessSentAt: null,
        stays: 2, lifetimeValue: 742000, ratingScore: 4.70, history: [
          { date: '2026-02-11', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', nights: 6, channel: 'agoda', value: 742000 },
        ] },
    ],
    checkingOut: [
      { id: 'r8', guestId: 'g8', fullName: 'Yuki Tanaka', email: 'yuki@example.com', phone: '+81 90 1000 0007',
        unitNumber: '#15-06', propertyName: 'Scarletz KLCC', channel: 'booking_com', state: 'checked_in', readiness: 'occupied',
        checkInAt: '', checkOutAt: at(1440 + 30), guestsCount: 1, nights: 3, preparedAt: at(-2800), accessSentAt: at(-2800),
        stays: 1, lifetimeValue: 210000, ratingScore: null, history: [] },
    ],
  },
};

const OPS_ROLES: UserRole[] = ['management', 'operations_manager', 'operations_staff'];
const TWO_HOURS = 2 * 60 * 60 * 1000;
const initials = (name: string) => name.split(' ').map(n => n[0]).slice(0, 2).join('');
const threadName = (ch: BookingChannel) => (ch === 'direct' ? 'WhatsApp' : channelLabel(ch));

/** null → allowed. A string → the reason the control is disabled. */
function accessGuard(m: Movement): string | null {
  if (m.accessSentAt) return 'Access details already sent.';
  if (m.state === 'checked_in' || m.state === 'checked_out') return 'Guest is already checked in.';
  if (m.readiness !== 'ready') return 'Send access once the unit is Ready.';
  if (Date.now() < new Date(m.checkInAt).getTime() - TWO_HOURS)
    return 'Access details unlock 2 hours before check-in.';
  return null;
}

export default function GuestsPage() {
  const { user } = useSession();
  const canSeeContact = user ? OPS_ROLES.includes(user.role) : false;

  const [tab, setTab] = useState<'today' | 'tomorrow'>('today');
  const { data, loading, error, reload } = useApi<Payload>('/guests/movements', FALLBACK);

  // Optimistic overlays — no backend in dev.
  const [edits, setEdits] = useState<Record<string, Partial<Movement>>>({});
  const [walkIns, setWalkIns] = useState<Record<'today' | 'tomorrow', Movement[]>>({ today: [], tomorrow: [] });
  const [busy, setBusy] = useState(false);

  // Overlay UI state.
  const [profile, setProfile] = useState<Movement | null>(null);
  const [message, setMessage] = useState<Movement | null>(null);
  const [checkout, setCheckout] = useState<Movement | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const merge = (m: Movement): Movement => ({ ...m, ...edits[m.id] });
  const patch = (id: string, p: Partial<Movement>) => setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));

  const day = data?.[tab] ?? { checkingIn: [], checkingOut: [] };
  const arrivals = useMemo(
    () => [...walkIns[tab], ...day.checkingIn].map(merge),
    [walkIns, tab, day.checkingIn, edits],
  );
  const departures = useMemo(() => day.checkingOut.map(merge), [tab, day.checkingOut, edits]);
  const live = profile ? merge(profile) : null;

  // ---- actions (optimistic; the real call is attempted and swallowed) ----
  function prepareEarly(m: Movement) {
    patch(m.id, { preparedAt: new Date().toISOString(), accessSentAt: new Date().toISOString(), readiness: 'ready' });
    toast({ tone: 'success', title: `${m.propertyName} ${m.unitNumber} prepared.`, body: 'Access sent and the unit is confirmed ready.' });
    api.post(`/reservations/${m.id}/prepare`, {}).catch(() => { /* dev: no backend */ });
  }
  function sendAccess(m: Movement) {
    patch(m.id, { accessSentAt: new Date().toISOString() });
    toast({ tone: 'success', title: `Access details sent to ${m.fullName}.`, body: `Delivered on ${threadName(m.channel)}.` });
    api.post('/messages', { reservationId: m.id, kind: 'access_details' }).catch(() => {});
  }
  function markCheckedIn(m: Movement) {
    patch(m.id, { state: 'checked_in', readiness: 'occupied' });
    toast({ tone: 'success', title: `${m.fullName} checked in.`, body: `${m.propertyName} ${m.unitNumber} is now occupied.` });
    api.patch(`/reservations/${m.id}`, { state: 'checked_in' }).catch(() => {});
  }
  async function confirmCheckout() {
    if (!checkout) return;
    const m = checkout;
    setBusy(true);
    patch(m.id, { state: 'checked_out', readiness: 'dirty' });
    try { await api.patch(`/reservations/${m.id}`, { state: 'checked_out' }); } catch { /* dev: no backend */ }
    toast({ tone: 'success', title: `${m.fullName} checked out.`, body: `A cleaning task was created for ${m.propertyName} ${m.unitNumber}.` });
    setBusy(false);
    setCheckout(null);
  }
  function sendMessage(body: string) {
    if (!message) return;
    const m = message;
    toast({ tone: 'success', title: `Message sent to ${m.fullName}.`, body: `Thread opened on ${threadName(m.channel)}.` });
    api.post('/messages', { reservationId: m.id, body }).catch(() => {});
    setMessage(null);
  }
  function addWalkIn(input: { fullName: string; phone: string; email: string; unitNumber: string; propertyName: string; guestsCount: number }) {
    const id = crypto.randomUUID();
    const m: Movement = {
      id, guestId: id, fullName: input.fullName, email: input.email || null, phone: input.phone || null,
      unitNumber: input.unitNumber, propertyName: input.propertyName, channel: 'direct', state: 'confirmed', readiness: 'ready',
      checkInAt: new Date().toISOString(), checkOutAt: '', guestsCount: input.guestsCount, nights: 1,
      preparedAt: null, accessSentAt: null, stays: 1, lifetimeValue: 0, ratingScore: null, history: [],
    };
    setWalkIns(w => ({ ...w, today: [m, ...w.today] }));
    setTab('today');
    toast({ tone: 'success', title: `${input.fullName} added.`, body: 'Walk-in placed in today’s arrivals.' });
    api.post('/guests', input).catch(() => {});
    setAdding(false);
  }

  const dayLabel = tab === 'today' ? 'today' : 'tomorrow';

  return (
    <>
      <PageHeader
        title="Guests"
        sub="Arrival and departure control"
        right={
          <Button variant="primary" size="md" onClick={() => setAdding(true)}>Add guest</Button>
        }
      />

      {error && <StaleBanner message={`Showing the last movements we have. ${error}`} onRetry={reload} />}

      <div role="tablist" aria-label="Movement day" style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {(['today', 'tomorrow'] as const).map(t => {
          const on = t === tab;
          const label = t === 'today' ? 'Today' : 'Tomorrow';
          return (
            <button key={t} role="tab" aria-selected={on} onClick={() => setTab(t)}
              style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 15px', borderRadius: radius.pill, fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
              {label}
            </button>
          );
        })}
      </div>

      <MovementCard
        title={`Checking in ${dayLabel}`} count={arrivals.length} kind="in"
        rows={arrivals} loading={loading && !data} canSeeContact={canSeeContact}
        emptyCopy={`No arrivals ${dayLabel}.`}
        onOpen={setProfile}
        onPrepare={prepareEarly}
        onSendAccess={sendAccess}
        onCheckIn={markCheckedIn}
        onMessage={setMessage}
      />

      <MovementCard
        title={`Checking out ${dayLabel}`} count={departures.length} kind="out"
        rows={departures} loading={loading && !data} canSeeContact={canSeeContact}
        emptyCopy={`No departures ${dayLabel}.`}
        onOpen={setProfile}
        onCheckOut={setCheckout}
        onMessage={setMessage}
      />

      {/* Guest profile drawer */}
      <Drawer open={!!live} onClose={() => setProfile(null)}>
        {live && <ProfilePanel m={live} canSeeContact={canSeeContact} onClose={() => setProfile(null)} onMessage={() => { setMessage(live); setProfile(null); }} />}
      </Drawer>

      {/* Mark checked out — confirmation, states the auto cleaning task */}
      <Dialog
        busy={busy}
        onClose={() => setCheckout(null)}
        spec={!checkout ? null : {
          title: `Mark ${checkout.fullName} checked out?`,
          body: `${checkout.propertyName} ${checkout.unitNumber} moves to Dirty and the stay is closed.`,
          meta: `A cleaning task is created automatically, its window set from the next arrival.`,
          confirmLabel: 'Mark checked out',
          busyLabel: 'Checking out…',
          onConfirm: confirmCheckout,
        }}
      />

      {message && <MessageModal m={message} onClose={() => setMessage(null)} onSend={sendMessage} />}
      {adding && <AddGuestModal onClose={() => setAdding(false)} onAdd={addWalkIn} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Movement list card                                                  */
/* ------------------------------------------------------------------ */

function MovementCard(props: {
  title: string; count: number; kind: 'in' | 'out'; rows: Movement[]; loading: boolean;
  canSeeContact: boolean; emptyCopy: string;
  onOpen: (m: Movement) => void;
  onPrepare?: (m: Movement) => void;
  onSendAccess?: (m: Movement) => void;
  onCheckIn?: (m: Movement) => void;
  onCheckOut?: (m: Movement) => void;
  onMessage: (m: Movement) => void;
}) {
  const { title, count, kind, rows, loading, canSeeContact, emptyCopy,
    onOpen, onPrepare, onSendAccess, onCheckIn, onCheckOut, onMessage } = props;
  return (
    <Card>
      <CardHeader title={title} right={<span style={{ fontSize: text.small, color: color.textMuted }}>{count} {count === 1 ? 'guest' : 'guests'}</span>} />
      <div style={{ borderTop: `1px solid ${color.border}` }}>
        {loading && rows.length === 0 ? (
          <TableSkeleton rows={3} cols={4} />
        ) : rows.length === 0 ? (
          <div style={{ padding: '24px 22px', fontSize: 13, color: color.textMuted }}>{emptyCopy}</div>
        ) : (
          rows.map(m => (
            <MovementRow key={m.id} m={m} kind={kind} canSeeContact={canSeeContact}
              onOpen={onOpen} onPrepare={onPrepare} onSendAccess={onSendAccess}
              onCheckIn={onCheckIn} onCheckOut={onCheckOut} onMessage={onMessage} />
          ))
        )}
      </div>
    </Card>
  );
}

function MovementRow({
  m, kind, canSeeContact, onOpen, onPrepare, onSendAccess, onCheckIn, onCheckOut, onMessage,
}: {
  m: Movement; kind: 'in' | 'out'; canSeeContact: boolean;
  onOpen: (m: Movement) => void;
  onPrepare?: (m: Movement) => void;
  onSendAccess?: (m: Movement) => void;
  onCheckIn?: (m: Movement) => void;
  onCheckOut?: (m: Movement) => void;
  onMessage: (m: Movement) => void;
}) {
  const guard = accessGuard(m);
  const checkedIn = m.state === 'checked_in';
  const checkedOut = m.state === 'checked_out';
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '13px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
      {/* identity — opens the profile drawer */}
      <button
        onClick={() => onOpen(m)}
        aria-label={`Open ${m.fullName}'s profile`}
        style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 220, flex: '1 1 240px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
      >
        <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: text.small, fontWeight: 600 }}>
          {initials(m.fullName)}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.fullName}</span>
          <span style={{ fontSize: 11.5, color: color.textMuted }}>{m.propertyName} {m.unitNumber} · {guestCount(m.guestsCount)}</span>
          {canSeeContact
            ? <span style={{ fontSize: 11.5, color: color.textMuted }}>{m.phone ?? m.email ?? '—'}</span>
            : <span style={{ fontSize: 11.5, color: color.faint }}>Contact limited to operations roles</span>}
        </span>
      </button>

      {/* channel + time + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto', minWidth: 150 }}>
        <ChannelMark ch={m.channel} size={22} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {kind === 'in' ? time(m.checkInAt) : time(m.checkOutAt)}
          </span>
          <span style={{ fontSize: 11.5, color: color.textMuted }}>
            {kind === 'in' ? 'check-in' : 'check-out'} · {nights(m.nights)}
          </span>
        </div>
      </div>

      {/* badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
        <Badge tone={RESERVATION[m.state].tone} label={RESERVATION[m.state].label} size="sm" />
        <Badge tone={READINESS[m.readiness].tone} label={READINESS[m.readiness].label} size="sm" />
        {m.preparedAt && kind === 'in' && !checkedIn && <Chip label="Prepared" />}
        {m.accessSentAt && kind === 'in' && !m.preparedAt && !checkedIn && <Chip label="Access sent" />}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }} onClick={stop}>
        {kind === 'in' && !checkedIn && (
          <>
            <Button size="sm" variant="tertiary" onClick={() => onPrepare?.(m)} disabled={!!m.preparedAt} disabledReason="Arrival is already prepared.">
              Prepare early
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onSendAccess?.(m)} disabled={!!guard} disabledReason={guard ?? undefined}>
              Send access details
            </Button>
            <Button size="sm" variant="primary" onClick={() => onCheckIn?.(m)}>Mark checked in</Button>
          </>
        )}
        {kind === 'in' && checkedIn && <span style={{ fontSize: text.small, color: color.textMuted }}>Checked in</span>}

        {kind === 'out' && (
          <Button size="sm" variant="secondary" onClick={() => onCheckOut?.(m)} disabled={checkedOut} disabledReason="Guest is already checked out.">
            {checkedOut ? 'Checked out' : 'Mark checked out'}
          </Button>
        )}

        <Button size="sm" variant="tertiary" onClick={() => onMessage(m)}>Message guest</Button>
      </div>
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
/* Profile drawer                                                      */
/* ------------------------------------------------------------------ */

function ProfilePanel({ m, canSeeContact, onClose, onMessage }: { m: Movement; canSeeContact: boolean; onClose: () => void; onMessage: () => void }) {
  return (
    <>
      <div style={{ padding: '20px 22px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ width: 42, height: 42, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 600 }}>
            {initials(m.fullName)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.fullName}</div>
            <div style={{ fontSize: text.small, color: color.textMuted }}>{m.stays} {m.stays === 1 ? 'stay' : 'stays'} with The Conts</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: color.textMuted, fontSize: 20, lineHeight: 1, padding: 4 }}>{'×'}</button>
      </div>

      <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
        {/* headline stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Stat label="Lifetime value" value={rm(m.lifetimeValue, { cents: false })} />
          <Stat label="Stays" value={String(m.stays)} />
          <Stat label="Rating" value={m.ratingScore != null ? rating(m.ratingScore, true) : '—'} />
        </div>

        {/* contact */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: text.small, fontWeight: 600, color: color.textMuted }}>Contact</div>
          {canSeeContact ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 13 }}>{m.email ?? '—'}</span>
              <span style={{ fontSize: 13, color: color.textMuted }}>{m.phone ?? '—'}</span>
            </div>
          ) : (
            <span style={{ fontSize: 12.5, color: color.faint }}>Contact details are limited to operations roles. Ask an operations manager for access.</span>
          )}
        </div>

        {/* stay history */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ fontSize: text.small, fontWeight: 600, color: color.textMuted }}>Stay history</div>
          {m.history.length === 0 ? (
            <span style={{ fontSize: 12.5, color: color.textMuted }}>This is their first stay.</span>
          ) : (
            m.history.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < m.history.length - 1 ? `1px solid ${color.borderMuted}` : 'none' }}>
                <span aria-hidden style={{ width: 44, height: 44, flex: 'none', borderRadius: radius.sm, background: color.muted, display: 'grid', placeItems: 'center', color: color.faint }}>
                  <ChannelMark ch={s.channel} size={20} muted />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.propertyName} {s.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>{date(s.date)} · {nights(s.nights)} · {channelLabel(s.channel)}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{rm(s.value)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ marginTop: 'auto', padding: '14px 22px', borderTop: `1px solid ${color.border}`, background: color.page }}>
        <Button size="md" variant="secondary" onClick={onMessage} style={{ width: '100%' }}>Message guest</Button>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '11px 12px', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}` }}>
      <div style={{ fontSize: text.micro, color: color.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message guest modal                                                 */
/* ------------------------------------------------------------------ */

const inputStyle = {
  display: 'block', width: '100%', boxSizing: 'border-box' as const, height: 40, padding: '0 12px',
  fontSize: text.body, color: color.ink, background: '#FFFFFF',
  border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit',
};
const labelStyle = { fontSize: text.small, fontWeight: 500, color: color.textMuted };

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

function MessageModal({ m, onClose, onSend }: { m: Movement; onClose: () => void; onSend: (body: string) => void }) {
  const [body, setBody] = useState('');
  return (
    <ModalShell title={`Message ${m.fullName}`} sub={`Thread opens on ${threadName(m.channel)}.`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (body.trim()) onSend(body.trim()); }} style={{ padding: '12px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="msg-body" style={labelStyle}>Message</label>
          <textarea id="msg-body" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${m.fullName.split(' ')[0]}, checking in on your stay at ${m.unitNumber}…`}
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

/* ------------------------------------------------------------------ */
/* Add guest (walk-in) modal                                           */
/* ------------------------------------------------------------------ */

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
