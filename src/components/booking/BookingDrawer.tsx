import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from '../Dialog';
import { Button } from '../Button';
import { Field } from '../Field';
import { Select } from '../Select';
import { DateField, TimeField, MoneyInput } from '../inputs';
import Icon from '../Icon';
import ChannelMark from '../ChannelMark';
import { PhoneText } from '../PhoneText';
import { useApi } from '../../lib/useApi';
import { useToast } from '../Toast';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { rm, date, dateRange, dateTime, time, nights as fmtNights, guests as fmtGuests, greetName } from '../../lib/format';
import { CHANNEL_META, cx } from '../../lib/design-tokens';
import { channelNote, deliveryToast, stayPhase, type ChannelSync } from '../../lib/bookingStatus';
import { statusLabel } from '../../lib/status';
import { StatusMenu } from '../StatusBadge';
import { ConfirmDialog } from '../ConfirmDialog';
import type { BookingChannel, ReservationState } from '../../lib/types';
import { PhoneHistory, RecordHistory } from '../RecordHistory';
import ApprovalBanner from '../ApprovalBanner';
import { DocumentsSection, type GuestDocument } from './GuestDocuments';
import { isStaged, stagedToast, useApprovalsOn, type Approval } from '../../lib/approvals';
import { CloseButton } from '../CloseButton';
import { moneyStatus, lastPaidOn, isOtaChannel } from '../../lib/payoutStatus';

/* ------------------------------------------------------------------ */
/* Shapes (GET /api/reservations/:id)                                  */
/* ------------------------------------------------------------------ */

export interface BookingSummary {
  id: string; externalRef: string | null; guestName: string; guestsCount: number; guestPhone?: string | null;
  unitNumber: string; propertyName: string; channel: BookingChannel; state: ReservationState;
  checkIn: string; checkOut: string; checkInTime?: string; checkOutTime?: string; nights?: number; grossBookingValue: number;
}

interface Move { to: ReservationState; label: string; hint: string; allowed: boolean; reason?: string; needsReason?: boolean }
interface TimelineEvent { at: string; label: string; detail?: string; actor?: string; upcoming?: boolean }
interface Money {
  gross: number; channelFee: number; collected: number;
  roomRevenue: number | null; guestCleaningFee: number | null; extraFees: number | null; sstAmount: number | null;
  tourismTax: number | null; otaTax: number | null; paymentProcessingFee: number | null;
  depositCollected: number | null; depositRefunded: number | null; payoutAmount: number | null;
  payoutDate: string | null; paymentMethod: string | null; ratePlan: string | null; guestNationality: string | null;
}
interface Payment {
  id: string; amount: number; receivedOn: string | null; status: 'received' | 'expected'; method: string | null;
  reference: string | null; kind: 'guest_payment' | 'ota_payout' | 'refund'; note: string | null; source: 'manual' | 'owner_workbook';
  createdBy: string | null; createdAt: string;
}
interface LedgerLine { key: string; label: string; sub?: string; amount: number }
interface Ledger {
  guestLines: LedgerLine[]; guestTotal: number; otaTax: number | null;
  platformLines: LedgerLine[]; platformTotal: number;
  expected: number; received: number; outstanding: number; receivedBefore: number;
  payments: Payment[]; paymentMethod: string | null;
  disagree: string | null; sources: { label: string; amount: number | null; from: string }[];
}
interface Detail extends Required<Omit<BookingSummary, 'guestPhone'>> {
  guestPhone: string | null; guestEmail: string | null; guestId: string | null; nationality: string | null;
  country: { code: string; name: string; from: 'nationality' | 'phone' } | null;
  unitId: string; notes: string | null; staffNotes: string | null; createdAt: string;
  money: Money; ledger: Ledger; timeline: TimelineEvent[]; moves: Move[];
  documents?: GuestDocument[]; approvals?: Approval[];
  can: { changeDates: boolean; changeDatesReason: string | null; recordPayment: boolean; editDetails: boolean; paymentsReady: boolean; issueDocuments?: boolean; invoiceReason?: string | null };
}

/** Airbnb, Booking.com and Agoda own their bookings' dates; a change is made there and arrives through Channex. */
const OTA: BookingChannel[] = ['airbnb', 'booking_com', 'agoda'];
const isBlock = (c: BookingChannel) => c === 'maintenance_block' || c === 'owner_stay';
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const failMessage = (e: unknown) => (errorMessage(e, 'Try again in a moment.'));

/* ------------------------------------------------------------------ */
/* Status pill and menu                                                */
/* ------------------------------------------------------------------ */

const MOVE_ICON: Partial<Record<ReservationState, string>> = {
  pending: 'Clock', confirmed: 'CheckCircle2', checked_in: 'LogIn', checked_out: 'LogOut', cancelled: 'XCircle', no_show: 'UserX',
};

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

function Line({ label, value, sub, strong, minus, muted }: { label: ReactNode; value: ReactNode; sub?: string; strong?: boolean; minus?: boolean; muted?: boolean }) {
  return (
    <div className={cx('flex justify-between items-baseline gap-3 py-[8px] px-[14px]', strong && 'bg-muted')}>
      <span className="flex flex-col min-w-0">
        <span className={cx(strong ? 'text-copy font-semibold text-ink' : 'text-copy text-muted-ink')}>{label}</span>
        {sub && <span className="text-caption text-muted-ink">{sub}</span>}
      </span>
      <span className={cx('[font-variant-numeric:tabular-nums] whitespace-nowrap', strong ? 'text-copy font-semibold' : 'text-copy', muted && 'text-muted-ink')}>
        {minus && typeof value === 'string' ? `− ${value}` : value}
      </span>
    </div>
  );
}
const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="[border-top:1px_solid_var(--color-line-soft)] first:border-t-0 py-1">
    <div className="px-[14px] pt-[6px] pb-[2px] text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">{title}</div>
    {children}
  </div>
);

const KIND_LABEL: Record<Payment['kind'], string> = { guest_payment: 'Guest payment', ota_payout: 'Host payout', refund: 'Refund' };

/** The money the way Airbnb shows a host (owner, 11 Oct 2026): what the guest paid, what the host is paid after the
 *  channel's commission, then one line saying where the payout stands. Expected / Received / Outstanding, each payment
 *  and where every figure came from sit behind Details. The server works the figures out (functions/_lib/bookingMoney.ts);
 *  this only lays them out, so the numbers are the ledger's own. */
function MoneyPanel({ d, onRecord, onRemove }: { d: Detail; onRecord: () => void; onRemove: (p: Payment) => void }) {
  const L = d.ledger;
  const [details, setDetails] = useState(false);
  const dead = d.state === 'cancelled' || d.state === 'no_show';
  const site = CHANNEL_META[d.channel].label;
  const ota = isOtaChannel(d.channel);
  const room = L.guestLines.find(l => l.key === 'room');
  const fees = L.guestLines.filter(l => l.key !== 'room');
  const nights = d.nights || 0;
  const perNight = room && nights > 0 ? Math.round(room.amount / nights) : null;
  const roomLabel = room && perNight != null
    // vocab-ok: room is the ledger line's key, the text is a price per night
    ? `${rm(perNight)}${perNight * nights === room.amount ? '' : ' avg.'} x ${fmtNights(nights)}`
    : room?.label ?? '';
  // The commission's share of what it is charged on: the guest total less the taxes passed on (as bookingMoney.ts has it).
  const taxes = L.guestLines.filter(l => l.key === 'sst' || l.key === 'tourism').reduce((n, l) => n + l.amount, 0);
  const base = L.guestTotal - taxes;
  const pctOf = (amount: number) => (base > 0 ? ` (${(amount / base * 100).toFixed(1)}%)` : '');
  const payout = ota || L.platformLines.length > 0;
  // vocab-ok: ota is a code flag; the label names the channel itself
  const feeOwner = ota ? site : 'Channel';
  const status = moneyStatus({ channel: d.channel, state: d.state, expected: L.expected, received: L.received, outstanding: L.outstanding, paidOn: lastPaidOn(L.payments, d.money.payoutDate) });
  const statusIcon = status.tone === 'success' ? 'CheckCircle2' : status.tone === 'warning' ? 'AlertCircle' : 'Clock';

  const paymentRow = (p: Payment) => (
    <div key={p.id} className="flex justify-between items-baseline gap-3 py-[7px] px-[14px]">
      <span className="flex flex-col min-w-0">
        <span className="text-copy text-muted-ink">
          {p.status === 'expected' ? `${KIND_LABEL[p.kind]} expected` : `${KIND_LABEL[p.kind]}${p.receivedOn ? ` · ${date(p.receivedOn)}` : ''}`}
        </span>
        <span className="text-caption text-muted-ink">
          {[p.note, p.method, p.reference ? `Ref ${p.reference}` : null,
            p.source === 'owner_workbook' ? (p.status === 'received' && !p.receivedOn ? 'Paid out (owner workbook; no date given)' : 'From the owner workbook') : p.createdBy ? `Recorded by ${p.createdBy}` : null,
          ].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <span className={cx('text-copy [font-variant-numeric:tabular-nums] whitespace-nowrap', p.status === 'expected' && 'text-warning')}>
          {p.kind === 'refund' ? `− ${rm(p.amount)}` : rm(p.amount)}{p.status === 'expected' ? ' not received' : ''}
        </span>
        {p.source === 'manual' && d.can.recordPayment && (
          <button type="button" onClick={() => onRemove(p)} aria-label="Remove this payment" title="Remove this payment"
            className="w-7 h-7 grid place-items-center rounded-control border-none bg-transparent text-muted-ink cursor-pointer hover:bg-muted"><Icon name="Trash2" size="sm" /></button>
        )}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="border border-solid border-line rounded-card overflow-hidden">
        <Group title="Guest paid">
          {room && <Line label={roomLabel} value={rm(room.amount)} />}
          {fees.map(l => <Line key={l.key} label={l.label} sub={l.sub} value={rm(l.amount)} />)}
          <Line strong label={dead ? `Total (MYR) before it was ${d.state === 'cancelled' ? 'cancelled' : 'marked no-show'}` : 'Total (MYR)'}
            value={L.guestTotal > 0 ? rm(L.guestTotal) : 'Not recorded'} muted={L.guestTotal <= 0}
            sub={!L.guestLines.length && L.guestTotal > 0 ? 'No breakdown recorded for this reservation.' : undefined} />
          {L.otaTax ? <Line label={`Tax collected by ${site}`} sub="Paid by the guest to the channel and kept by it. Not ours." value={rm(L.otaTax)} muted /> : null}
        </Group>
        {dead ? (
          <Group title={ota ? 'Host payout' : 'Payments'}>
            <Line strong label={d.state === 'cancelled' ? 'Kept after cancellation' : 'Kept after no-show'} value={rm(L.received)}
              sub={L.received ? undefined : 'No money is recorded on this reservation.'} />
          </Group>
        ) : payout ? (
          <Group title="Host payout">
            {room ? <>
              <Line label="Accommodation" value={rm(room.amount)} />
              {fees.map(l => <Line key={l.key} label={l.label} value={rm(l.amount)} />)}
            </> : <Line label="Guest total" value={rm(L.guestTotal)} />}
            {L.platformLines.map(l => (
              <Line key={l.key} label={l.key === 'commission' ? `${feeOwner} service fee${pctOf(l.amount)}` : l.label} value={rm(l.amount)} minus />
            ))}
            <Line strong label="Total (MYR)" value={rm(L.expected)} />
          </Group>
        ) : (
          <Group title="Payments">
            {L.receivedBefore > 0 && <Line label="Received earlier" value={rm(L.receivedBefore)} />}
            {L.payments.map(paymentRow)}
            {!L.receivedBefore && !L.payments.length && <Line label="No payment recorded yet" value="" />}
            <Line strong label="Balance due" value={L.outstanding > 0 ? rm(L.outstanding) : 'Nothing'} />
          </Group>
        )}
        {!dead && (
          <div className={cx('flex items-center gap-2 px-[14px] py-[10px] [border-top:1px_solid_var(--color-line-soft)] text-copy font-medium',
            status.tone === 'success' ? 'text-success' : status.tone === 'warning' ? 'text-warning' : 'text-ink')}>
            <Icon name={statusIcon} size="sm" /><span>{status.label}</span>
          </div>
        )}
      </div>

      {L.disagree && (
        <div role="note" className="rounded-control border border-solid border-warning-line bg-warning-bg px-3 py-[10px] text-meta flex flex-col gap-1">
          <span className="font-semibold text-warning flex items-center gap-[6px]"><Icon name="AlertTriangle" size="sm" />Sources disagree</span>
          <span className="text-ink leading-[1.45]">{L.disagree}</span>
        </div>
      )}
      <button type="button" onClick={() => setDetails(v => !v)} aria-expanded={details}
        className="self-start p-0 border-none bg-transparent [font-family:inherit] text-meta text-muted-ink underline cursor-pointer">
        {details ? 'Hide details' : 'Details'}
      </button>
      {details && (
        <div className="border border-solid border-line rounded-card overflow-hidden">
          {!dead && payout && (
            <Group title="Payout">
              <Line label="Expected" value={rm(L.expected)} sub={L.platformTotal ? 'Guest total less the service fee' : undefined} />
              {L.receivedBefore > 0 && <Line label="Received earlier" value={rm(L.receivedBefore)} />}
              {L.payments.map(paymentRow)}
              <Line label="Received" value={rm(L.received)} />
              <Line label="Outstanding" value={L.outstanding > 0 ? rm(L.outstanding) : 'Nothing'}
                sub={L.outstanding > 0 ? `${site} has not paid this out yet.` : undefined} />
            </Group>
          )}
          {L.paymentMethod && <Group title="Payment method"><Line label={L.paymentMethod} value="" /></Group>}
          <Group title="Where the figures come from">
            {L.sources.map((x, i) => (
              <div key={i} className="flex justify-between gap-3 px-[14px] py-[7px] text-meta">
                <span className="flex flex-col min-w-0"><span className="text-ink">{x.label}</span><span className="text-caption text-muted-ink">{x.from}</span></span>
                <span className="[font-variant-numeric:tabular-nums] whitespace-nowrap">{x.amount == null ? '—' : rm(x.amount)}</span>
              </div>
            ))}
          </Group>
        </div>
      )}
      {d.can.recordPayment && !dead && (
        <Button size="sm" variant="secondary" icon={<Icon name="Banknote" size="sm" />} onClick={onRecord}>Record payment</Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <div className="text-meta text-muted-ink">Nothing recorded yet.</div>;
  return (
    <ol className="list-none m-0 p-0 flex flex-col">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cx('w-[11px] h-[11px] rounded-pill border-2 border-solid mt-[3px] flex-none',
              e.upcoming ? 'bg-card [border-color:var(--color-line)]' : 'bg-success [border-color:var(--color-success-fg)]')} />
            {i < events.length - 1 && <span className="w-0.5 flex-1 min-h-[18px] bg-line" />}
          </div>
          <div className="pb-[14px] min-w-0">
            <div className={cx('text-copy font-medium', e.upcoming ? 'text-muted-ink' : 'text-ink')}>{e.label}</div>
            <div className="text-meta text-muted-ink">
              {e.upcoming ? `${date(e.at)} · ${time(e.at)}` : dateTime(e.at)}{e.actor ? ` · ${e.actor}` : ''}
            </div>
            {e.detail && <div className="text-meta text-muted-ink break-words">{e.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

export function CentreModal({ title, sub, onClose, children, maxWidth = 460 }: { title: string; sub?: string; onClose: () => void; children: ReactNode; maxWidth?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Portalled to the body: inside the drawer (which animates with a transform) a fixed overlay would be
  // trapped in the drawer's box instead of covering the screen.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[70] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div style={{ maxWidth }} className="relative w-full bg-card rounded-card shadow-[var(--shadow-overlay)] max-h-[90dvh] flex flex-col overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="px-[22px] pt-[22px] pb-1 flex-none">
          <h2 className="m-0 text-title font-semibold">{title}</h2>
          {sub && <p className="mt-[6px] mx-0 mb-0 text-copy text-muted-ink">{sub}</p>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The buttons at the foot of a CentreModal form (whose padding is px-[22px] py-4): a footer bar on the page tint, as on
 *  every other dialog, kept in view while a long form scrolls. A sticky box stops at the scroller's padding, hence -bottom-4 against the form's py-4. */
export function ModalActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-4 z-[1] -mx-[22px] -mb-4 mt-1 px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end flex-wrap gap-[9px]">
      {children}
    </div>
  );
}

export function MessageGuestModal({ r, onClose, onSent }: { r: { id: string; guestName: string; channel: BookingChannel }; onClose: () => void; onSent?: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const thread = r.channel === 'direct' ? 'WhatsApp' : CHANNEL_META[r.channel].label;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ delivery?: string; reason?: string }>('/messages', { reservationId: r.id, body: body.trim() });
      toast(deliveryToast(res?.delivery, r.guestName, res?.reason));
      onSent?.(); onClose();
    } catch (err) {
      toast({ tone: 'critical', title: 'Message was not sent.', body: failMessage(err) });
    }
    setBusy(false);
  }
  return (
    <CentreModal title={`Message ${r.guestName || 'guest'}`} sub={`Goes to the guest's ${thread} conversation when that channel is connected.`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="bk-msg" className="text-meta font-medium text-muted-ink">Message</label>
          <textarea id="bk-msg" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${greetName(r.guestName)}, a quick note about your reservation…`}
            className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
        </div>
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!body.trim()} disabledReason="Write a message first.">Send message</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

function ChangeDatesModal({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: (v: { checkIn: string; checkOut: string; channel: ChannelSync }) => void }) {
  const toast = useToast();
  const [checkIn, setCheckIn] = useState(d.checkIn);
  const [checkOut, setCheckOut] = useState(d.checkOut);
  const priced = d.channel === 'direct' || d.channel === 'owner_stay';
  const [totalSen, setTotalSen] = useState<number | null>(d.money.gross);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inHouse = d.state === 'checked_in';
  const n = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const priceChanged = priced && totalSen != null && totalSen !== d.money.gross;
  const changed = checkIn !== d.checkIn || checkOut !== d.checkOut || priceChanged;
  const valid = !!checkIn && !!checkOut && n >= 1 && changed && (!priced || (totalSen != null && totalSen >= 0));
  // Only the room scales with the nights; the cleaning fee and other one-off charges stay as they are.
  const roomSen = d.ledger.guestLines.find(l => l.key === 'room')?.amount ?? d.money.gross;
  const fixedSen = d.money.gross - roomSen;
  const perNight = d.nights > 0 && roomSen > 0 ? roomSen / d.nights : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError(null); setFieldErrors({});
    try {
      const res = await api.patch<{ effects?: { channel: ChannelSync } }>(`/reservations/${d.id}/dates`, {
        checkIn, checkOut, confirm: true, ...(priceChanged ? { grossBookingValue: totalSen } : {}),
      });
      onSaved({ checkIn, checkOut, channel: res?.effects?.channel });
    } catch (err) {
      setError(failMessage(err));
      if (err instanceof ApiFailure && err.fields) setFieldErrors(err.fields);
      toast({ tone: 'critical', title: 'Dates were not changed.', body: failMessage(err) });
    }
    setBusy(false);
  }

  return (
    <CentreModal title="Change dates" sub="Checked against the unit's other reservations before it is saved. The guest is not messaged." onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta text-muted-ink">
          Now: {dateRange(d.checkIn, d.checkOut)} · {fmtNights(d.nights)}{d.money.gross > 0 ? ` · ${rm(d.money.gross)}` : ''}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
          <DateField label="Check-in" value={checkIn} onChange={setCheckIn} required disabled={inHouse} error={fieldErrors.checkIn}
            help={inHouse ? 'The guest is already in.' : undefined} />
          <DateField label="Checkout" value={checkOut} min={checkIn || undefined} onChange={setCheckOut} required
            error={checkIn && checkOut && n < 1 ? 'Checkout must be after check-in.' : fieldErrors.checkOut}
            help={n >= 1 && (checkIn !== d.checkIn || checkOut !== d.checkOut) ? `New dates: ${dateRange(checkIn, checkOut)} · ${fmtNights(n)}` : undefined} />
        </div>
        {priced ? (
          <MoneyInput label="Guest total (RM)" valueSen={totalSen} onChangeSen={setTotalSen} required
            error={totalSen == null ? 'Enter the guest total, or 0.00.' : fieldErrors.grossBookingValue}
            help={perNight > 0 && n >= 1 && n !== d.nights
              ? `At the current ${rm(Math.round(perNight))} a night${fixedSen > 0 ? ` plus ${rm(fixedSen)} in fees` : ''}, ${fmtNights(n)} would be ${rm(Math.round(perNight * n) + fixedSen)}. Change the guest total if the price changes.`
              : 'Stays the same unless you change it.'} />
        ) : !isBlock(d.channel) && (
          <p className="m-0 text-meta text-muted-ink">The price is set by {CHANNEL_META[d.channel].label}, so it stays as recorded. Change the reservation there too.</p>
        )}
        {error && <p role="alert" className="m-0 text-meta text-danger">{error}</p>}
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason="Pick a new, valid date range first.">Save new dates</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

// vocab-ok: stored payment method values, same list as the server's PAYMENT_METHODS
const METHODS = ['Bank transfer', 'Cash', 'Card', 'DuitNow / QR', 'Booking site payout', 'Other'];
const todayIso = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

/** Money received against the booking: a guest paying, a booking site's payout, or a refund going back. */
function RecordPaymentModal({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const ota = d.channel === 'airbnb' || d.channel === 'booking_com' || d.channel === 'agoda';
  const [kind, setKind] = useState<Payment['kind']>(ota ? 'ota_payout' : 'guest_payment');
  const [sen, setSen] = useState<number | null>(d.ledger.outstanding > 0 ? d.ledger.outstanding : null);
  const [receivedOn, setReceivedOn] = useState(todayIso());
  // vocab-ok: stored payment method value from METHODS
  const [method, setMethod] = useState(ota ? 'Booking site payout' : 'Bank transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const refund = kind === 'refund';
  const approvalsOn = useApprovalsOn();
  const tooMuch = refund && sen != null && sen > Math.max(d.ledger.received, 0);
  const valid = sen != null && sen > 0 && !tooMuch && !!receivedOn && (!refund || !approvalsOn || !!reason.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || sen == null) return;
    setBusy(true); setErrors({});
    try {
      const res = await api.post<unknown>(`/reservations/${d.id}/payments`, { amount: sen, receivedOn, kind, method, reference: reference || undefined, note: note || undefined, reason: refund && reason.trim() ? reason.trim() : undefined });
      // With approvals on, a refund waits for a second person and nothing is recorded yet.
      if (isStaged(res)) { toast(stagedToast(res)); onSaved(''); setBusy(false); return; }
      if (refund) { onSaved(`Refund of ${rm(sen)} recorded.`); setBusy(false); return; }
      const left = Math.max(d.ledger.outstanding - sen, 0);
      onSaved(`Payment of ${rm(sen)} recorded. ${left > 0 ? `${rm(left)} still outstanding.` : 'Nothing is outstanding now.'}`);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      toast({ tone: 'critical', title: 'Payment not recorded.', body: failMessage(err) });
    }
    setBusy(false);
  }
  return (
    <CentreModal title="Record payment" sub={`Expected ${rm(d.ledger.expected)} · received ${rm(d.ledger.received)} · outstanding ${rm(d.ledger.outstanding)}`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <div role="radiogroup" aria-label="What is this" className="grid grid-cols-3 gap-1 p-1 rounded-control bg-muted">
          {(['guest_payment', 'ota_payout', 'refund'] as const).map(k => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => {
              // A refund starts from what was received, never from what is still owed.
              if ((k === 'refund') !== refund) setSen(k === 'refund' ? (d.ledger.received > 0 ? d.ledger.received : null) : (d.ledger.outstanding > 0 ? d.ledger.outstanding : null));
              setKind(k);
            }}
              className={cx('h-9 rounded-[8px] border-none [font-family:inherit] text-meta cursor-pointer', kind === k ? 'bg-card font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-ink')}>
              {k === 'guest_payment' ? 'From the guest' : k === 'ota_payout' ? 'Host payout' : 'Refund'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <MoneyInput label="Amount (RM)" valueSen={sen} onChangeSen={setSen} minSen={1} required
            error={tooMuch ? (d.ledger.received > 0 ? `At most ${rm(d.ledger.received)}, what was received.` : 'Nothing has been received to refund.') : errors.amount} />
          <DateField label={kind === 'refund' ? 'Refunded on' : 'Received on'} value={receivedOn} max={todayIso()} onChange={setReceivedOn} required error={errors.receivedOn} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Select label="Method" showLabel size="md" value={method} onChange={setMethod} options={METHODS.map(m => ({ value: m, label: m }))} />
          <Field label="Reference (optional)" value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank or receipt reference" />
        </div>
        <Field label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Deposit, balance at check-in" />
        {refund && approvalsOn && <>
          <Field label="Why the guest is refunded (required)" value={reason} onChange={e => setReason(e.target.value)} required maxLength={500}
            placeholder="e.g. Cancelled 10 days before check-in, full refund" error={errors.reason} />
          <p className="m-0 text-meta text-muted-ink text-pretty">A refund is money leaving the company. It is sent for approval and recorded only once it is approved.</p>
        </>}
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason={tooMuch ? 'A refund cannot be more than what was received.' : refund && approvalsOn ? 'Enter an amount, a date and the reason.' : 'Enter an amount and a date.'}>{refund ? (approvalsOn ? 'Send for approval' : 'Record refund') : 'Record payment'}</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

/** Early check-in or late check-out. Cleaning plans the turnover from these times. */
function TimesModal({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [inTime, setInTime] = useState(d.checkInTime || '15:00');
  const [outTime, setOutTime] = useState(d.checkOutTime || '11:00');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const changed = (inTime !== d.checkInTime || outTime !== d.checkOutTime) && !!inTime && !!outTime;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed) return;
    setBusy(true); setErrors({});
    try {
      await api.patch(`/reservations/${d.id}/details`, { checkInTime: inTime, checkOutTime: outTime });
      onSaved(`Check-in from ${inTime} on ${date(d.checkIn)}, checkout by ${outTime} on ${date(d.checkOut)}. Cleaning plans with the new times.`);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      toast({ tone: 'critical', title: 'Times not changed.', body: failMessage(err) });
    }
    setBusy(false);
  }
  return (
    <CentreModal title="Check-in and checkout times" sub="For an early check-in or a late checkout. The dates do not change, and the guest is not messaged." onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <TimeField label={`Check-in from (${date(d.checkIn)})`} value={inTime} onChange={setInTime} required disabled={d.state === 'checked_in'}
            help={d.state === 'checked_in' ? 'The guest is already in.' : 'Standard 15:00'} error={errors.checkInTime} />
          <TimeField label={`Checkout by (${date(d.checkOut)})`} value={outTime} onChange={setOutTime} required help="Standard 11:00" error={errors.checkOutTime} />
        </div>
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!changed} disabledReason="Change a time first.">Save times</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

/** Internal notes on the booking. What an import wrote stays separate and read-only, because a re-import rewrites it. */
function NotesBox({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(d.staffNotes ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(d.staffNotes ?? ''); }, [d.staffNotes]);
  const dirty = text.trim() !== (d.staffNotes ?? '').trim();
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/reservations/${d.id}/details`, { staffNotes: text.trim() || null });
      toast({ tone: 'success', title: 'Notes saved.' });
      onSaved();
    } catch (err) { toast({ tone: 'critical', title: 'Notes not saved.', body: failMessage(err) }); }
    setBusy(false);
  }
  const imported = d.notes && !/^Imported from (HostPlatform|owner workbook) \([^)]*\)$/.test(d.notes.replace(/ · amounts from owner workbook$/, '')) ? d.notes : null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="bk-notes" className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">Notes</label>
      {imported && <div className="text-meta text-muted-ink py-2 px-3 rounded-control bg-page border border-solid border-line-soft break-words">{imported}</div>}
      <textarea id="bk-notes" value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000} placeholder="Internal notes for the team, e.g. Guest asked for a high floor"
        className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="tertiary" onClick={() => setText(d.staffNotes ?? '')} disabled={busy}>Discard</Button>
          <Button size="sm" variant="primary" onClick={save} loading={busy}>Save notes</Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paid late checkout (functions/api/reservations/[id]/late-checkout)  */
/* ------------------------------------------------------------------ */

export interface LateCheckout { id: string; checkoutTime: string; amount: number; remark: string | null; status: 'requested'; requestedBy: string | null; requestedAt: string }
export interface LateCheckoutState { checkOut: string; checkOutTime: string; open: LateCheckout | null; canRequest: boolean; canPay: boolean }

/** A guest asks to check out later for a fee. Only the request is saved: the checkout time moves once they pay. */
function LateCheckoutModal({ id, s, onClose, onSaved }: { id: string; s: LateCheckoutState; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const now = s.checkOutTime;
  const [time, setTime] = useState('');
  const [sen, setSen] = useState<number | null>(null);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const early = !!time && time <= now;
  const valid = !!time && !early && sen != null && sen > 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || sen == null) return;
    setBusy(true); setErrors({});
    try {
      await api.post(`/reservations/${id}/late-checkout`, { checkoutTime: time, amount: sen, remark: remark.trim() || undefined });
      onSaved(`Late checkout to ${time} requested for ${rm(sen)}. Checkout stays ${now} until the guest pays.`);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      toast({ tone: 'critical', title: 'Late checkout not requested.', body: failMessage(err) });
    }
    setBusy(false);
  }
  return (
    <CentreModal title="Request late checkout" sub={`Checkout is by ${now} on ${date(s.checkOut)}. The time changes only after the guest pays.`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <TimeField label="New checkout time" value={time} onChange={setTime} required
            error={early ? `Pick a time after ${now}.` : errors.checkoutTime} help={`Now ${now}`} />
          <MoneyInput label="Price (RM)" valueSen={sen} onChangeSen={setSen} minSen={1} required error={errors.amount} />
        </div>
        <Field label="Remark (optional)" value={remark} onChange={e => setRemark(e.target.value)} maxLength={500}
          placeholder="e.g. Asked by WhatsApp, flight at 18:00" />
        <p className="m-0 text-meta text-muted-ink text-pretty">Company income: it is not added to the reservation's money or the owner statement.</p>
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason={`Pick a time after ${now} and enter the price.`}>Request late checkout</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

/** The guest paid for their late checkout: keeps the payment on the request and moves the checkout time, together. */
function LateCheckoutPaidModal({ id, s, lc, onClose, onSaved }: { id: string; s: LateCheckoutState; lc: LateCheckout; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [receivedOn, setReceivedOn] = useState(todayIso());
  // vocab-ok: stored payment method value from METHODS
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!receivedOn) return;
    setBusy(true); setErrors({});
    try {
      await api.post(`/reservations/${id}/late-checkout/paid`, { receivedOn, method, reference: reference.trim() || undefined });
      onSaved(`${rm(lc.amount)} recorded. Checkout is now by ${lc.checkoutTime}, and Cleaning plans with it.`);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      toast({ tone: 'critical', title: 'Late checkout not saved.', body: failMessage(err) });
    }
    setBusy(false);
  }
  return (
    <CentreModal title="Guest paid for late checkout" sub={`${rm(lc.amount)} for checkout by ${lc.checkoutTime} on ${date(s.checkOut)}. Company income, not on the owner statement.`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <DateField label="Received on" value={receivedOn} max={todayIso()} onChange={setReceivedOn} required error={errors.receivedOn} />
          <Select label="Method" showLabel size="md" value={method} onChange={setMethod} options={METHODS.filter(m => m !== 'Booking site payout').map(m => ({ value: m, label: m }))} />
        </div>
        <Field label="Reference (optional)" value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank or receipt reference" />
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!receivedOn} disabledReason="Pick the date it was received.">Record and change checkout</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

/** Late checkout on one reservation, for the cleaning job's panel and the reservation's: a "Request late checkout" button,
 *  or the open request with Guest paid and Cancel. Loads its own state; onChanged tells the host to reload its own. */
export function LateCheckoutBlock({ reservationId, onChanged }: { reservationId: string; onChanged?: () => void }) {
  const toast = useToast();
  const { data: s, reload } = useApi<LateCheckoutState>(`/reservations/${reservationId}/late-checkout`);
  const [step, setStep] = useState<'request' | 'paid' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const done = (msg: string) => { setStep(null); toast({ tone: 'success', title: msg }); reload(); onChanged?.(); };
  async function cancel() {
    setBusy(true);
    try { await api.del(`/reservations/${reservationId}/late-checkout`); done('Late checkout request cancelled.'); }
    catch (err) { toast({ tone: 'critical', title: 'Request not cancelled.', body: failMessage(err) }); }
    setBusy(false);
  }
  if (!s || (!s.open && !s.canRequest)) return null;
  const lc = s.open;
  return (
    <>
      {lc ? (
        <div className="rounded-card border border-solid border-line bg-gold-tint p-[13px] flex flex-col gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-copy font-semibold">Late checkout to {lc.checkoutTime} · waiting for payment</span>
            <span className="text-meta text-muted-ink">{rm(lc.amount)} · checkout stays {s.checkOutTime} until paid</span>
          </div>
          {lc.remark && <p className="m-0 text-meta text-ink [overflow-wrap:anywhere]">{lc.remark}</p>}
          {lc.requestedBy && <span className="text-caption text-muted-ink">Requested by {lc.requestedBy} · {dateTime(lc.requestedAt)}</span>}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="primary" onClick={() => setStep('paid')} disabled={!s.canPay}
              disabledReason="Only management, finance and operations managers record payments.">Guest paid</Button>
            <Button size="sm" variant="secondary" onClick={() => setStep('cancel')}>Cancel request</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="self-start" icon={<Icon name="Clock" size="sm" />} onClick={() => setStep('request')}>Request late checkout</Button>
      )}
      {step === 'request' && <LateCheckoutModal id={reservationId} s={s} onClose={() => setStep(null)} onSaved={done} />}
      {step === 'paid' && lc && <LateCheckoutPaidModal id={reservationId} s={s} lc={lc} onClose={() => setStep(null)} onSaved={done} />}
      <ConfirmDialog busy={busy} onClose={() => { if (!busy) setStep(null); }}
        spec={step === 'cancel' && lc ? {
          title: 'Cancel this late checkout request?',
          body: `Late checkout to ${lc.checkoutTime} for ${rm(lc.amount)}. Checkout stays ${s.checkOutTime}. Nothing was charged, so nothing is refunded.`,
          danger: true, cancelLabel: 'Keep it', confirmLabel: 'Cancel request', busyLabel: 'Cancelling…',
          onConfirm: cancel,
        } : null} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The drawer                                                          */
/* ------------------------------------------------------------------ */

/**
 * One booking drawer for the Bookings list and the Calendar. Reads the booking itself (money, timeline and the
 * allowed status moves come from the server), makes every change through the API, and only reports what the
 * server says happened. `onChanged` lets the page refresh its list or board.
 */
export function BookingDrawer({ id, summary, onClose, onChanged, onDuplicated }: {
  id: string | null; summary?: BookingSummary | null; onClose: () => void;
  onChanged?: (id: string) => void; onDuplicated?: (newId: string) => void;
}) {
  return (
    <Drawer open={!!id} onClose={onClose} width={460}>
      {id && <Panel key={id} id={id} summary={summary ?? null} onClose={onClose} onChanged={onChanged} onDuplicated={onDuplicated} />}
    </Drawer>
  );
}

const countryName = (code: string | null) => {
  if (!code) return null;
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
};

function Panel({ id, summary, onClose, onChanged, onDuplicated }: {
  id: string; summary: BookingSummary | null; onClose: () => void; onChanged?: (id: string) => void; onDuplicated?: (newId: string) => void;
}) {
  const toast = useToast();
  const { data, error, reload } = useApi<Detail>(`/reservations/${id}`);
  const d = data && data.id === id ? data : null;
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<Move | 'remove_block' | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);

  const s = d ?? summary;
  if (!s) {
    return (
      <div className="p-5 flex flex-col gap-3">
        <div className="flex justify-end"><CloseButton onClick={onClose} /></div>
        <div className="text-copy text-muted-ink">{error ?? 'Loading the reservation…'}</div>
      </div>
    );
  }
  const block = isBlock(s.channel);
  const ch = CHANNEL_META[s.channel];
  const nights = s.nights ?? nightsBetween(s.checkIn, s.checkOut);
  const live = !['cancelled', 'no_show', 'checked_out'].includes(s.state);

  async function move(m: Move, reason?: string) {
    setBusy(true);
    try {
      const res = await api.patch<{ state: ReservationState; effects: { channel: ChannelSync; readiness: string | null; turnoverCreated: boolean; tasksRemoved: number; tasksKept: number } }>(
        `/reservations/${id}`, { state: m.to, ...(reason ? { reason } : {}) });
      const e = res.effects;
      const bits = [
        e.readiness === 'occupied' ? 'Unit marked occupied.' : e.readiness === 'dirty' ? 'Unit marked dirty.' : e.readiness === 'ready' ? 'Unit marked ready.' : '',
        e.turnoverCreated ? 'A cleaning job was created.' : '',
        e.tasksRemoved ? `${e.tasksRemoved} unstarted ${e.tasksRemoved === 1 ? 'cleaning job was' : 'cleaning jobs were'} removed.` : '',
        e.tasksKept ? `${e.tasksKept} ${e.tasksKept === 1 ? 'cleaning job is' : 'cleaning jobs are'} already being worked on and ${e.tasksKept === 1 ? 'was' : 'were'} kept.` : '',
        channelNote(e.channel, m.to === 'cancelled' || m.to === 'no_show' ? 'released' : 'held'),
      ].filter(Boolean);
      // vocab-ok: 'booking' here is the status entity key, not text
      toast({ tone: m.to === 'cancelled' || m.to === 'no_show' ? 'neutral' : 'success', title: `${s!.externalRef ?? 'Reservation'} is now ${statusLabel('booking', res.state)}.`, body: bits.join(' ') || undefined });
      setAsking(null);
      reload(); onChanged?.(id);
    } catch (err) {
      toast({ tone: 'critical', title: 'Status not changed.', body: failMessage(err) });
      if (err instanceof ApiFailure && err.status === 409) reload();
    }
    setBusy(false);
  }

  async function removeBlock(reason: string) {
    setBusy(true);
    try {
      const res = await api.post<{ effects: { channel: ChannelSync } }>(`/reservations/${id}/cancel`, { reason });
      toast({ tone: 'neutral', title: s!.channel === 'owner_stay' ? 'Owner stay removed.' : 'Block removed.', body: channelNote(res?.effects?.channel, 'released') || undefined });
      setAsking(null); onChanged?.(id); onClose();
    } catch (err) {
      toast({ tone: 'critical', title: 'Block not removed.', body: failMessage(err) });
    }
    setBusy(false);
  }

  async function removePayment(p: Payment) {
    setBusy(true);
    try {
      await api.del(`/reservations/${id}/payments/${p.id}`);
      toast({ tone: 'neutral', title: `${KIND_LABEL[p.kind]} of ${rm(p.amount)} removed.` });
      setRemoving(null); reload(); onChanged?.(id);
    } catch (err) { toast({ tone: 'critical', title: 'Payment not removed.', body: failMessage(err) }); }
    setBusy(false);
  }

  function duplicate() {
    api.post<{ id: string; externalRef: string; checkIn: string; channel: BookingChannel; effects?: { channel: ChannelSync } }>(`/reservations/${id}/duplicate`, {})
      .then(res => {
        toast({
          tone: res.effects?.channel === 'failed' ? 'warning' : 'success',
          title: `Copy ${res.externalRef} created as Pending.`,
          body: [`${s!.guestName || 'The copy'} starts on ${date(res.checkIn)}.`, res.channel !== s!.channel ? 'It is a direct reservation: it is not on the original channel.' : '', channelNote(res.effects?.channel, 'held')].filter(Boolean).join(' '),
        });
        onChanged?.(id); onDuplicated?.(res.id);
      })
      .catch(err => toast({ tone: 'critical', title: 'Reservation not duplicated.', body: failMessage(err) }));
  }

  const pick = (m: Move) => { if (m.needsReason) setAsking(m); else void move(m); };
  const cancelMove = d?.moves.find(m => m.to === 'cancelled' && m.allowed);
  const metaLine = `${s.guestName || ch.label} · ${s.propertyName} ${s.unitNumber} · ${dateRange(s.checkIn, s.checkOut)}`;
  const saved = (msg: string) => { toast({ tone: 'success', title: msg }); reload(); onChanged?.(id); };
  const nationality = d ? countryName(d.nationality) : null;

  return (
    <>
      <div className="sticky top-0 z-[2] flex-none bg-black text-white px-[18px] pt-[14px] pb-[16px] flex flex-col gap-[10px]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-[10px] min-w-0">
            <ChannelMark ch={s.channel} size={24} />
            <div className="flex flex-col min-w-0">
              <span className="text-heading font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{s.channel === 'owner_stay' ? (s.guestName ? `Owner stay · ${s.guestName}` : 'Owner stay') : block ? 'Blocked dates' : (s.guestName || 'No guest name')}</span>
              <span className="text-meta text-[rgba(255,255,255,0.72)] whitespace-nowrap overflow-hidden text-ellipsis">{s.propertyName} {s.unitNumber} · {fmtNights(nights)}</span>
            </div>
          </div>
          <CloseButton onClick={onClose} onDark />
        </div>
        <div className="flex items-center gap-2 flex-wrap text-meta text-[rgba(255,255,255,0.72)]">
          <span className="font-semibold text-white">{ch.label}</span>
          {s.externalRef && <span className="font-mono">{s.externalRef}</span>}
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1">
        {!block && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-meta font-medium text-muted-ink">Status</span>
            <StatusMenu entity="booking" value={s.state} shown={{ entity: 'stay', value: stayPhase(s) }} busy={busy}
              options={d ? d.moves.map(m => ({ value: m.to, label: m.label, hint: m.allowed ? m.hint : m.reason, disabled: !m.allowed, icon: MOVE_ICON[m.to], danger: m.to === 'cancelled' || m.to === 'no_show' })) : null}
              onPick={o => { const m = d?.moves.find(x => x.to === o.value && x.label === o.label); if (m) pick(m); }} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-px bg-line border border-solid border-line rounded-card overflow-hidden">
          {([
            [date(s.checkIn), block ? 'From' : `Check-in${s.checkInTime ? ` · from ${s.checkInTime}` : ''}`],
            [date(s.checkOut), block ? 'Until (the day it frees up)' : `Checkout${s.checkOutTime ? ` · by ${s.checkOutTime}` : ''}`],
            [fmtNights(nights), 'Length'],
            [s.guestsCount > 0 ? fmtGuests(s.guestsCount) : '—', 'Guests'],
          ] as const).map(([v, l]) => (
            <div key={l} className="bg-card py-[11px] px-[13px] flex flex-col gap-0.5">
              <span className="text-copy font-semibold">{v}</span>
              <span className="text-caption text-muted-ink">{l}</span>
            </div>
          ))}
        </div>
        {d && live && !block && (
          <button type="button" onClick={() => setTimesOpen(true)}
            className="self-start -mt-3 p-0 border-none bg-transparent [font-family:inherit] text-meta text-ink underline cursor-pointer">Change check-in or checkout time</button>
        )}
        {d && live && !block && <LateCheckoutBlock reservationId={d.id} onChanged={() => { reload(); onChanged?.(id); }} />}

        {!block && d && (
          <div className="flex flex-col gap-1 text-copy">
            <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink mb-1">Guest</div>
            <div className="flex justify-between gap-3"><span className="text-muted-ink">Phone</span><span className="text-right break-all"><PhoneText value={d.guestPhone} className="text-ink" /></span></div>
            {d.guestEmail && <div className="flex justify-between gap-3"><span className="text-muted-ink">Email</span><span className="text-right break-all">{d.guestEmail}</span></div>}
            {nationality || !d.country ? (
              <div className="flex justify-between gap-3"><span className="text-muted-ink">Nationality</span>
                <span className="text-right">{nationality ?? '—'}{nationality && !/malaysia/i.test(nationality) ? <span className="text-muted-ink"> · tourism tax applies</span> : null}</span></div>
            ) : (
              // No nationality on record: the phone number's country says where the guest is likely from, but it is not
              // a nationality, so it says nothing about tourism tax.
              <div className="flex justify-between gap-3"><span className="text-muted-ink">Country</span>
                <span className="text-right">{d.country.name}<span className="text-muted-ink"> · from phone number</span></span></div>
            )}
            {d.guestId && <a href={`#/reservations/guests?g=${encodeURIComponent(d.guestId)}`} className="self-start mt-1 text-meta text-ink underline">Open guest profile</a>}
          </div>
        )}

        {block ? (
          <div className="text-copy text-muted-ink">
            <div>{d?.notes ? <>Note: <span className="text-ink">{d.notes}</span></> : 'No note recorded.'}</div>
            {d && <div className="mt-1">{d.money.gross > 0 ? <>Recorded value: <span className="text-ink [font-variant-numeric:tabular-nums]">{rm(d.money.gross)}</span></> : 'No money is recorded on it.'}</div>}
          </div>
        ) : d ? <>
          {(d.approvals?.length ?? 0) > 0 && <ApprovalBanner items={d.approvals!} compact onChanged={() => { reload(); onChanged?.(id); }} />}
          <MoneyPanel d={d} onRecord={() => setPayOpen(true)} onRemove={setRemoving} />
          {d.can.issueDocuments && (
            <DocumentsSection reservationId={d.id} documents={d.documents ?? []} payments={d.ledger.payments}
              invoiceReason={d.can.invoiceReason ?? null} onChanged={reload} />
          )}
        </> : <div className="h-[120px] rounded-card bg-muted animate-pulse" />}

        {!block && d && <NotesBox d={d} onSaved={reload} />}

        <div>
          <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink mb-3">Timeline</div>
          {d ? <Timeline events={d.timeline} /> : <div className="text-meta text-muted-ink">{error ?? 'Loading…'}</div>}
        </div>

        <PhoneHistory>
          <div>
            <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink mb-3">History</div>
            <div className="rounded-card border border-solid border-line overflow-hidden bg-card">
              <RecordHistory entity="reservations" id={id} bare pageSize={10} refreshKey={data} />
            </div>
          </div>
        </PhoneHistory>
      </div>

      {/* Pinned to the bottom only when the window has room: in a short window (restored down, or half a screen) the pinned
          buttons rose over the header and hid the whole reservation, and jumped about while the window was resized. */}
      <div className="p-4 [border-top:1px_solid_var(--color-line)] bg-page flex flex-col gap-[9px] flex-none [@media(min-height:560px)]:sticky bottom-0">
        {block ? (
          <div className="flex gap-[9px]">
            <Button variant="secondary" style={{ flex: 1 }} onClick={() => setDatesOpen(true)} disabled={!d || !live}>Change dates</Button>
            <Button variant="danger" style={{ flex: 1 }} onClick={() => setAsking('remove_block')} disabled={!d || !live}>{s.channel === 'owner_stay' ? 'Remove owner stay' : 'Remove block'}</Button>
          </div>
        ) : <>
          <div className="flex gap-[9px]">
            <Button variant="secondary" style={{ flex: 1 }} icon={<Icon name="Copy" size="sm" />} onClick={duplicate}>Duplicate</Button>
            <Button variant="primary" style={{ flex: 1 }} icon={<Icon name="MessageSquare" size="sm" />} onClick={() => setMessageOpen(true)}>Message guest</Button>
          </div>
          {live && (
            <div className="flex gap-[9px]">
              {!OTA.includes(s.channel) && (
                <Button variant="secondary" style={{ flex: 1 }} onClick={() => setDatesOpen(true)} disabled={!d || !d.can.changeDates}
                  disabledReason={d?.can.changeDatesReason ?? 'Loading…'}>Change dates</Button>
              )}
              <Button variant="danger" style={{ flex: 1 }} onClick={() => cancelMove && setAsking(cancelMove)} disabled={!cancelMove}
                disabledReason={d ? 'A guest who is already in cannot be cancelled. Check them out instead.' : 'Loading…'}>Cancel reservation</Button>
            </div>
          )}
          {live && d && !d.can.changeDates && d.can.changeDatesReason && (
            <p className="m-0 text-caption text-muted-ink leading-[1.4]">{d.can.changeDatesReason}</p>
          )}
        </>}
      </div>

      <ConfirmDialog busy={busy} onClose={() => { if (!busy) setAsking(null); }}
        spec={asking === 'remove_block' ? {
          title: s.channel === 'owner_stay' ? 'Remove this owner stay?' : 'Remove this block?',
          body: 'The nights become available again and reopen on the channels the unit is linked to.',
          meta: metaLine, danger: true, cancelLabel: 'Keep it', busyLabel: 'Saving…',
          confirmLabel: s.channel === 'owner_stay' ? 'Remove owner stay' : 'Remove block',
          reason: { placeholder: 'e.g. Owner no longer needs the unit those nights' },
          onConfirm: removeBlock,
        } : asking ? {
          title: asking.to === 'cancelled' ? `Cancel ${s.externalRef ?? 'this reservation'}?` : `Mark ${s.guestName || 'this guest'} as a no-show?`,
          body: asking.to === 'cancelled'
            ? 'The dates become available again. The guest is not messaged and no refund is made from here: do those on the channel or by message.'
            : 'The nights from today on become available again. The guest is not messaged.',
          meta: metaLine, danger: true, cancelLabel: 'Keep reservation', busyLabel: 'Saving…',
          confirmLabel: asking.to === 'cancelled' ? 'Cancel reservation' : 'Mark no-show',
          reason: { placeholder: 'e.g. Guest asked to cancel by WhatsApp' },
          onConfirm: reason => move(asking, reason),
        } : null} />
      {datesOpen && d && (
        <ChangeDatesModal d={d} onClose={() => setDatesOpen(false)}
          onSaved={v => {
            setDatesOpen(false);
            toast({ tone: 'success', title: 'Dates changed.', body: [`Now ${dateRange(v.checkIn, v.checkOut)}.`, channelNote(v.channel, 'moved'), block ? '' : 'The guest was not messaged.'].filter(Boolean).join(' ') });
            reload(); onChanged?.(id);
          }} />
      )}
      {timesOpen && d && <TimesModal d={d} onClose={() => setTimesOpen(false)} onSaved={msg => { setTimesOpen(false); saved(msg); }} />}
      {payOpen && d && <RecordPaymentModal d={d} onClose={() => setPayOpen(false)} onSaved={msg => { setPayOpen(false); if (msg) saved(msg); else { reload(); onChanged?.(id); } }} />}
      <ConfirmDialog busy={busy} onClose={() => { if (!busy) setRemoving(null); }}
        spec={removing ? {
          title: 'Remove this payment?',
          body: `${KIND_LABEL[removing.kind]} of ${rm(removing.amount)}${removing.receivedOn ? ` on ${date(removing.receivedOn)}` : ''}. Use this only for one recorded by mistake; the removal stays in History.`,
          danger: true, cancelLabel: 'Keep it', confirmLabel: 'Remove payment', busyLabel: 'Removing…',
          onConfirm: () => removePayment(removing),
        } : null} />
      {messageOpen && <MessageGuestModal r={{ id, guestName: s.guestName, channel: s.channel }} onClose={() => setMessageOpen(false)} onSent={reload} />}
    </>
  );
}

