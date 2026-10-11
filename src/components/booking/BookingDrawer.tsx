import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from '../Dialog';
import { Button } from '../Button';
import { Field } from '../Field';
import { DateField, TimeField, MoneyInput } from '../inputs';
import Icon from '../Icon';
import ChannelMark from '../ChannelMark';
import { PhoneText } from '../PhoneText';
import { useApi } from '../../lib/useApi';
import { useToast } from '../Toast';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { rm, date, dateRange, dateTime, time, nights as fmtNights, guests as fmtGuests, greetName } from '../../lib/format';
import { CHANNEL_META, cx } from '../../lib/design-tokens';
import { channelNote, deliveryToast, type ChannelSync } from '../../lib/bookingStatus';
import { statusLabel } from '../../lib/status';
import { payoutStatus } from '../../lib/payoutStatus';
import { StatusMenu } from '../StatusBadge';
import { ConfirmDialog } from '../ConfirmDialog';
import type { BookingChannel, ReservationState } from '../../lib/types';
import { RecordHistory } from '../RecordHistory';
import ApprovalBanner from '../ApprovalBanner';
import { DocumentsSection, type GuestDocument } from './GuestDocuments';
import { isStaged, stagedToast, useApprovalsOn, type Approval } from '../../lib/approvals';

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

function Line({ label, value, sub, total, muted, warn }: { label: ReactNode; value: ReactNode; sub?: ReactNode; total?: boolean; muted?: boolean; warn?: boolean }) {
  return (
    <div className={cx('flex justify-between items-baseline gap-3 py-[7px]', total && 'mt-1 pt-[10px] [border-top:1px_solid_var(--color-line)]')}>
      <span className="flex flex-col min-w-0">
        <span className={cx('text-copy', total ? 'font-semibold text-ink' : muted ? 'text-muted-ink' : 'text-ink')}>{label}</span>
        {sub && <span className="text-caption text-muted-ink">{sub}</span>}
      </span>
      <span className={cx('[font-variant-numeric:tabular-nums] whitespace-nowrap text-copy', total && 'font-semibold', muted && 'text-muted-ink', warn && 'text-warning font-semibold')}>{value}</span>
    </div>
  );
}
const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col" aria-label={title}>
    <h3 className="m-0 mb-1 text-heading font-semibold">{title}</h3>
    {children}
  </section>
);

const KIND_LABEL: Record<Payment['kind'], string> = { guest_payment: 'Guest payment', ota_payout: 'Payout', refund: 'Refund' };
const pctText = (x: number) => `${(Math.round(x * 10) / 10).toString()}%`;

/** The money laid out the way Airbnb shows a host a reservation: what the guest paid, what the host is paid, and one line
 *  saying where the payout is. Direct reservations show what the guest paid and what is still due. The figures are the
 *  server's (functions/_lib/bookingMoney.ts), unchanged; where its sources disagree, and the audit detail, sit behind
 *  Details instead of in the main view. */
function MoneyPanel({ d, onRecord, onRemove }: { d: Detail; onRecord: () => void; onRemove: (p: Payment) => void }) {
  const L = d.ledger;
  const [details, setDetails] = useState(false);
  const dead = d.state === 'cancelled' || d.state === 'no_show';
  const site = CHANNEL_META[d.channel].label;
  const ota = OTA.includes(d.channel);
  const n = d.nights;
  const room = L.guestLines.find(l => l.key === 'room');
  const extras = L.guestLines.filter(l => l.key !== 'room');
  const even = !!room && n > 0 && room.amount % n === 0;
  const roomLabel = room ? (even ? `${rm(room.amount / n)} x ${fmtNights(n)}` : fmtNights(n)) : null;
  const roomSub = room && !even && n > 1 ? `About ${rm(Math.round(room.amount / n))} a night` : undefined;

  // Host payout: what the guest paid less the channel's share. A payout the channel reported that differs from that
  // arithmetic is shown as its own line, so the block still adds up to the payout used everywhere else.
  const base = L.guestTotal - (d.money.sstAmount ?? 0) - (d.money.tourismTax ?? 0);
  const feeLabel = (l: LedgerLine) => l.key === 'commission'
    ? `${d.channel === 'airbnb' ? 'Host service fee' : `${site} service fee`}${base > 0 ? ` (${pctText(l.amount / base * 100)})` : ''}`
    : 'Payment processing fee';
  const adjust = L.expected - (L.guestTotal - L.platformTotal);
  const paidOn = [...L.payments.filter(p => p.status === 'received' && p.kind !== 'refund' && p.receivedOn).map(p => p.receivedOn!), ...(d.money.payoutDate ? [d.money.payoutDate.slice(0, 10)] : [])].sort().pop() ?? null;
  const status = payoutStatus({ channel: d.channel, state: d.state, checkIn: d.checkIn, checkOut: d.checkOut, expected: L.expected, received: L.received, outstanding: L.outstanding, paidOn });
  const guestPayments = L.payments.filter(p => p.status === 'received');

  return (
    <div className="flex flex-col gap-5">
      <Block title="Guest paid">
        {room && <Line label={roomLabel} sub={roomSub} value={rm(room.amount)} />}
        {extras.map(l => <Line key={l.key} label={l.label} value={rm(l.amount)} />)}
        <Line total label="Total (MYR)" value={L.guestTotal > 0 ? rm(L.guestTotal) : 'Not recorded'} muted={L.guestTotal <= 0}
          sub={!L.guestLines.length && L.guestTotal > 0 ? 'No breakdown recorded for this reservation.' : undefined} />
      </Block>

      {ota ? (
        <Block title="Host payout">
          {room && <Line label={`Room fee for ${fmtNights(n)}`} value={rm(room.amount)} />}
          {extras.map(l => <Line key={l.key} label={l.label} value={rm(l.amount)} />)}
          {!L.guestLines.length && <Line label="Guest total" value={rm(L.guestTotal)} />}
          {L.platformLines.map(l => <Line key={l.key} label={feeLabel(l)} value={`− ${rm(l.amount)}`} />)}
          {!dead && Math.abs(adjust) > 2 && <Line label={`Adjustment by ${site}`} sub="The payout it reported differs. See Details." value={adjust < 0 ? `− ${rm(-adjust)}` : rm(adjust)} />}
          <Line total label="Total (MYR)" value={rm(dead ? L.received : L.expected)} />
        </Block>
      ) : !dead && (
        <Block title="Payments">
          {guestPayments.length === 0 && L.receivedBefore <= 0 && <Line label="No payment recorded yet" value="" muted />}
          {L.receivedBefore > 0 && <Line label="Paid before payments were recorded here" value={rm(L.receivedBefore)} />}
          {guestPayments.map(p => (
            <Line key={p.id} label={`${p.kind === 'refund' ? 'Refund' : 'Paid'}${p.receivedOn ? ` ${date(p.receivedOn)}` : ''}`} sub={[p.method, p.reference ? `Ref ${p.reference}` : null].filter(Boolean).join(' · ') || undefined}
              value={p.kind === 'refund' ? `− ${rm(p.amount)}` : rm(p.amount)} />
          ))}
          <Line total label={L.outstanding > 0 ? 'Balance due' : 'Balance'} value={L.outstanding > 0 ? rm(L.outstanding) : 'Paid in full'} warn={L.outstanding > 0} />
        </Block>
      )}

      <div className={cx('flex items-center gap-2 rounded-control px-3 py-[10px] text-copy font-medium',
        status.tone === 'success' ? 'bg-success-bg text-success' : status.tone === 'warning' ? 'bg-warning-bg text-warning' : status.tone === 'info' ? 'bg-info-bg text-info' : 'bg-muted text-ink')}>
        <Icon name={status.tone === 'success' ? 'CheckCircle2' : status.tone === 'warning' ? 'Clock' : 'Info'} size="sm" />
        <span>{status.text}</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button type="button" onClick={() => setDetails(v => !v)} aria-expanded={details}
          className="inline-flex items-center gap-1 p-0 border-none bg-transparent [font-family:inherit] text-meta text-ink underline cursor-pointer min-h-[32px]">
          {L.disagree && <Icon name="AlertTriangle" size="sm" color="var(--color-warning-fg)" />}
          {details ? 'Hide details' : 'Details'}
        </button>
        {d.can.recordPayment && !dead && (
          <Button size="sm" variant="secondary" icon={<Icon name="Banknote" size="sm" />} onClick={onRecord}>Record payment</Button>
        )}
      </div>

      {details && (
        <div className="flex flex-col gap-3 rounded-card border border-solid border-line p-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            {([['Expected', L.expected], ['Received', L.received], ['Outstanding', L.outstanding]] as const).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-px rounded-control bg-page py-2">
                <span className="text-caption text-muted-ink">{k}</span>
                <span className="text-copy font-semibold [font-variant-numeric:tabular-nums]">{rm(v)}</span>
              </div>
            ))}
          </div>
          {L.disagree && (
            <div role="note" className="rounded-control border border-solid border-warning-line bg-warning-bg px-3 py-[10px] text-meta flex flex-col gap-1">
              <span className="font-semibold text-warning flex items-center gap-[6px]"><Icon name="AlertTriangle" size="sm" />Sources disagree</span>
              <span className="text-ink leading-[1.45]">{L.disagree}</span>
            </div>
          )}
          {(L.payments.length > 0 || L.receivedBefore > 0) && (
            <div className="flex flex-col">
              <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink pb-1">Money recorded</span>
              {L.receivedBefore > 0 && <Line label="Received before payments were recorded here" sub="From the HostPlatform or workbook import" value={rm(L.receivedBefore)} />}
              {L.payments.map(p => (
                <div key={p.id} className="flex justify-between items-baseline gap-3 py-[7px]">
                  <span className="flex flex-col min-w-0">
                    <span className="text-copy text-ink">{p.status === 'expected' ? `${KIND_LABEL[p.kind]} expected` : `${KIND_LABEL[p.kind]}${p.receivedOn ? ` · ${date(p.receivedOn)}` : ''}`}</span>
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
                        className="w-8 h-8 grid place-items-center rounded-control border-none bg-transparent text-muted-ink cursor-pointer hover:bg-muted"><Icon name="Trash2" size="sm" /></button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {L.paymentMethod && <Line label="Payment method" value={L.paymentMethod} />}
          {L.otaTax ? <Line label={`Tax collected by ${site}`} sub="Paid by the guest to the channel and kept by it. Not in the totals." value={rm(L.otaTax)} muted /> : null}
          {L.sources.length > 0 && (
            <div className="flex flex-col">
              <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink pb-1">Where the figures come from</span>
              {L.sources.map((x, i) => (
                <div key={i} className="flex justify-between gap-3 py-[6px] text-meta [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
                  <span className="flex flex-col min-w-0"><span className="text-ink">{x.label}</span><span className="text-caption text-muted-ink">{x.from}</span></span>
                  <span className="[font-variant-numeric:tabular-nums] whitespace-nowrap">{x.amount == null ? '—' : rm(x.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
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
      <div style={{ maxWidth }} className="relative w-full bg-card rounded-card shadow-[var(--shadow-overlay)] max-h-[90vh] flex flex-col [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
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
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="bk-msg" className="text-meta font-medium text-muted-ink">Message</label>
          <textarea id="bk-msg" required value={body} onChange={e => setBody(e.target.value)} rows={4}
            placeholder={`Hi ${greetName(r.guestName)}, checking in on your upcoming stay…`}
            className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!body.trim()} disabledReason="Write a message first.">{busy ? 'Sending…' : 'Send message'}</Button>
        </div>
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
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta text-muted-ink">
          Now: {dateRange(d.checkIn, d.checkOut)} · {fmtNights(d.nights)}{d.money.gross > 0 ? ` · ${rm(d.money.gross)}` : ''}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
          <DateField label="Check-in" value={checkIn} onChange={setCheckIn} required disabled={inHouse} error={fieldErrors.checkIn}
            help={inHouse ? 'The guest is already in.' : undefined} />
          <DateField label="Checkout" value={checkOut} min={checkIn || undefined} onChange={setCheckOut} required
            error={checkIn && checkOut && n < 1 ? 'Checkout must be after check-in.' : fieldErrors.checkOut}
            help={n >= 1 && (checkIn !== d.checkIn || checkOut !== d.checkOut) ? `New stay: ${dateRange(checkIn, checkOut)} · ${fmtNights(n)}` : undefined} />
        </div>
        {priced ? (
          <MoneyInput label="Total for the stay (RM)" valueSen={totalSen} onChangeSen={setTotalSen} required
            error={totalSen == null ? 'Enter the total, or 0.00.' : fieldErrors.grossBookingValue}
            help={perNight > 0 && n >= 1 && n !== d.nights
              ? `At the current ${rm(Math.round(perNight))} a night${fixedSen > 0 ? ` plus ${rm(fixedSen)} in fees` : ''}, ${fmtNights(n)} would be ${rm(Math.round(perNight * n) + fixedSen)}. Change the total if the price changes.`
              : 'Stays the same unless you change it.'} />
        ) : !isBlock(d.channel) && (
          <p className="m-0 text-meta text-muted-ink">The price is set by {CHANNEL_META[d.channel].label}, so it stays as recorded. Change the reservation on {CHANNEL_META[d.channel].label} too.</p>
        )}
        {error && <p role="alert" className="m-0 text-meta text-danger">{error}</p>}
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason="Pick a new, valid date range first.">{busy ? 'Saving…' : 'Save new dates'}</Button>
        </div>
      </form>
    </CentreModal>
  );
}

const METHODS = ['Bank transfer', 'Cash', 'Card', 'DuitNow / QR', 'Booking site payout', 'Other'];
const todayIso = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

/** Money received against the booking: a guest paying, a booking site's payout, or a refund going back. */
function RecordPaymentModal({ d, onClose, onSaved }: { d: Detail; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const ota = d.channel === 'airbnb' || d.channel === 'booking_com' || d.channel === 'agoda';
  const [kind, setKind] = useState<Payment['kind']>(ota ? 'ota_payout' : 'guest_payment');
  const [sen, setSen] = useState<number | null>(d.ledger.outstanding > 0 ? d.ledger.outstanding : null);
  const [receivedOn, setReceivedOn] = useState(todayIso());
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
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div role="radiogroup" aria-label="What is this" className="grid grid-cols-3 gap-1 p-1 rounded-control bg-muted">
          {(['guest_payment', 'ota_payout', 'refund'] as const).map(k => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => {
              // A refund starts from what was received, never from what is still owed.
              if ((k === 'refund') !== refund) setSen(k === 'refund' ? (d.ledger.received > 0 ? d.ledger.received : null) : (d.ledger.outstanding > 0 ? d.ledger.outstanding : null));
              setKind(k);
            }}
              className={cx('h-9 rounded-[8px] border-none [font-family:inherit] text-meta cursor-pointer', kind === k ? 'bg-card font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-ink')}>
              {k === 'guest_payment' ? 'From the guest' : k === 'ota_payout' ? 'Site payout' : 'Refund'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <MoneyInput label="Amount (RM)" valueSen={sen} onChangeSen={setSen} minSen={1} required
            error={tooMuch ? (d.ledger.received > 0 ? `At most ${rm(d.ledger.received)}, what was received.` : 'Nothing has been received to refund.') : errors.amount} />
          <DateField label={kind === 'refund' ? 'Refunded on' : 'Received on'} value={receivedOn} max={todayIso()} onChange={setReceivedOn} required error={errors.receivedOn} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-method" className="text-meta font-medium text-muted-ink">Method</label>
            <select id="pay-method" value={method} onChange={e => setMethod(e.target.value)}
              className="h-10 rounded-control border border-solid border-line bg-card text-ink [font-family:inherit] text-copy px-3">
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <Field label="Reference (optional)" value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank or receipt reference" />
        </div>
        <Field label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Deposit, balance on arrival" />
        {refund && approvalsOn && <>
          <Field label="Why the guest is refunded (required)" value={reason} onChange={e => setReason(e.target.value)} required maxLength={500}
            placeholder="e.g. Cancelled 10 days before arrival, full refund" error={errors.reason} />
          <p className="m-0 text-meta text-muted-ink text-pretty">A refund is money leaving the company. It is sent for approval and recorded only once it is approved.</p>
        </>}
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason={tooMuch ? 'A refund cannot be more than what was received.' : refund && approvalsOn ? 'Enter an amount, a date and the reason.' : 'Enter an amount and a date.'}>{busy ? 'Saving…' : refund ? (approvalsOn ? 'Send for approval' : 'Record refund') : 'Record payment'}</Button>
        </div>
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
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <TimeField label={`Check-in from (${date(d.checkIn)})`} value={inTime} onChange={setInTime} required disabled={d.state === 'checked_in'}
            help={d.state === 'checked_in' ? 'The guest is already in.' : 'Standard 15:00'} error={errors.checkInTime} />
          <TimeField label={`Checkout by (${date(d.checkOut)})`} value={outTime} onChange={setOutTime} required help="Standard 11:00" error={errors.checkOutTime} />
        </div>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!changed} disabledReason="Change a time first.">{busy ? 'Saving…' : 'Save times'}</Button>
        </div>
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
        <div className="flex justify-end"><CloseButton onClose={onClose} /></div>
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
        e.turnoverCreated ? 'A turnover clean was created.' : '',
        e.tasksRemoved ? `${e.tasksRemoved} unstarted ${e.tasksRemoved === 1 ? 'task was' : 'tasks were'} removed.` : '',
        e.tasksKept ? `${e.tasksKept} ${e.tasksKept === 1 ? 'task is' : 'tasks are'} already being worked on and ${e.tasksKept === 1 ? 'was' : 'were'} kept.` : '',
        channelNote(e.channel, m.to === 'cancelled' || m.to === 'no_show' ? 'released' : 'held'),
      ].filter(Boolean);
      toast({ tone: m.to === 'cancelled' || m.to === 'no_show' ? 'neutral' : 'success', title: `${s!.externalRef ?? 'The reservation'} is now ${statusLabel('booking', res.state)}.`, body: bits.join(' ') || undefined });
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
  const country = d?.country ?? null;

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
          <CloseButton onClose={onClose} dark />
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
            <StatusMenu entity="booking" value={s.state} busy={busy}
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

        {!block && d && (
          <div className="flex flex-col gap-1 text-copy">
            <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink mb-1">Guest</div>
            <div className="flex justify-between gap-3"><span className="text-muted-ink">Phone</span><span className="text-right break-all"><PhoneText value={d.guestPhone} className="text-ink" /></span></div>
            {d.guestEmail && <div className="flex justify-between gap-3"><span className="text-muted-ink">Email</span><span className="text-right break-all">{d.guestEmail}</span></div>}
            <div className="flex justify-between gap-3"><span className="text-muted-ink">Country</span>
              <span className="text-right">{country ? country.name : '—'}
                {country && <span className="text-muted-ink">{country.from === 'phone' ? ' · from phone number' : ''}{country.code !== 'MY' ? ' · tourism tax applies' : ''}</span>}</span></div>
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

        <div>
          <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink mb-3">History</div>
          <div className="rounded-card border border-solid border-line overflow-hidden bg-card">
            <RecordHistory entity="reservations" id={id} bare pageSize={10} refreshKey={data} />
          </div>
        </div>
      </div>

      <div className="p-4 [border-top:1px_solid_var(--color-line)] bg-page flex flex-col gap-[9px] flex-none sticky bottom-0">
        {block ? (
          <div className="flex gap-[9px]">
            <Button variant="secondary" style={{ flex: 1 }} onClick={() => setDatesOpen(true)} disabled={!d || !live}>Change dates</Button>
            <Button variant="danger" style={{ flex: 1 }} onClick={() => setAsking('remove_block')} disabled={!d || !live}>{s.channel === 'owner_stay' ? 'Remove owner stay' : 'Remove block'}</Button>
          </div>
        ) : <>
          <div className="flex gap-[9px]">
            <Button variant="primary" style={{ flex: 1 }} icon={<Icon name="MessageSquare" size="sm" />} onClick={() => setMessageOpen(true)}>Message guest</Button>
            <Button variant="secondary" style={{ flex: 1 }} icon={<Icon name="Copy" size="sm" />} onClick={duplicate}>Duplicate</Button>
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
          body: 'The nights go back on sale. A unit linked to Channex has them reopened on the channels.',
          meta: metaLine, danger: true, cancelLabel: 'Keep it', busyLabel: 'Saving…',
          confirmLabel: s.channel === 'owner_stay' ? 'Remove owner stay' : 'Remove block',
          reason: { placeholder: 'e.g. Owner no longer needs the unit those nights' },
          onConfirm: removeBlock,
        } : asking ? {
          title: asking.to === 'cancelled' ? `Cancel ${s.externalRef ?? 'this reservation'}?` : `Mark ${s.guestName || 'this guest'} as a no-show?`,
          body: asking.to === 'cancelled'
            ? 'The dates go back on sale. The guest is not messaged and no refund is made from here: do those on the channel or by message.'
            : 'The nights from today on go back on sale. The guest is not messaged.',
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
          body: `${KIND_LABEL[removing.kind]} of ${rm(removing.amount)}${removing.receivedOn ? ` on ${date(removing.receivedOn)}` : ''}. Use this only for one recorded by mistake; the removal is kept in the audit log.`,
          danger: true, cancelLabel: 'Keep it', confirmLabel: 'Remove payment', busyLabel: 'Removing…',
          onConfirm: () => removePayment(removing),
        } : null} />
      {messageOpen && <MessageGuestModal r={{ id, guestName: s.guestName, channel: s.channel }} onClose={() => setMessageOpen(false)} onSent={reload} />}
    </>
  );
}

function CloseButton({ onClose, dark }: { onClose: () => void; dark?: boolean }) {
  return (
    <button type="button" onClick={onClose} aria-label="Close"
      className={cx('w-[30px] h-[30px] flex-none grid place-items-center rounded-pill border-none cursor-pointer',
        dark ? 'bg-[rgba(255,255,255,0.14)] text-white hover:bg-[rgba(255,255,255,0.24)]' : 'bg-muted text-muted-ink')}>
      <Icon name="X" size="sm" />
    </button>
  );
}
