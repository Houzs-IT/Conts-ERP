import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from '../Dialog';
import { Button } from '../Button';
import { Field } from '../Field';
import { DateField, TimeField, MoneyInput } from '../inputs';
import Icon from '../Icon';
import ChannelMark from '../ChannelMark';
import { useApi } from '../../lib/useApi';
import { useToast } from '../Toast';
import { api, ApiFailure } from '../../lib/api';
import { rm, date, dateRange, dateTime, time, nights as fmtNights, guests as fmtGuests } from '../../lib/format';
import { CHANNEL_META, cx } from '../../lib/design-tokens';
import { TONE } from '../../lib/vocabulary';
import { STATUS, channelNote, deliveryToast, type ChannelSync } from '../../lib/bookingStatus';
import type { BookingChannel, ReservationState } from '../../lib/types';

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
  unitId: string; notes: string | null; staffNotes: string | null; createdAt: string;
  money: Money; ledger: Ledger; timeline: TimelineEvent[]; moves: Move[];
  can: { changeDates: boolean; changeDatesReason: string | null; recordPayment: boolean; editDetails: boolean; paymentsReady: boolean };
}

const isBlock = (c: BookingChannel) => c === 'maintenance_block' || c === 'owner_stay';
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const failMessage = (e: unknown) => (e instanceof Error ? e.message : 'Try again in a moment.');

/* ------------------------------------------------------------------ */
/* Status pill and menu                                                */
/* ------------------------------------------------------------------ */

export function StatusPill({ state, size = 'md' }: { state: ReservationState; size?: 'sm' | 'md' }) {
  const s = STATUS[state], t = TONE[s.tone];
  return (
    <span className={cx('inline-flex items-center gap-[6px] rounded-pill font-semibold whitespace-nowrap border border-solid',
      size === 'sm' ? 'h-[22px] px-[9px] text-caption' : 'h-[26px] px-[11px] text-meta')}
      style={{ background: s.outline ? 'transparent' : t.bg, color: t.fg, borderColor: s.outline ? t.line : 'transparent' }}>
      <span className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: t.line }} />
      {s.label}
    </span>
  );
}

const MOVE_ICON: Partial<Record<ReservationState, string>> = {
  pending: 'Clock', confirmed: 'CheckCircle2', checked_in: 'LogIn', checked_out: 'LogOut', cancelled: 'XCircle', no_show: 'UserX',
};

/** The current status as a coloured pill; clicking it lists only the moves the server allows, with the reason for any it does not. */
function StatusMenu({ state, moves, busy, onPick }: { state: ReservationState; moves: Move[] | null; busy: boolean; onPick: (m: Move) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const locked = moves !== null && moves.length === 0;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => !locked && moves && setOpen(o => !o)} disabled={busy || !moves} aria-haspopup="menu" aria-expanded={open}
        title={locked ? 'No further status changes for this booking' : 'Change status'}
        className={cx('inline-flex items-center gap-1 p-0 bg-transparent border-none [font:inherit]', locked || !moves ? 'cursor-default' : 'cursor-pointer')}>
        <StatusPill state={state} />
        {busy ? <span className="text-meta text-muted-ink">Saving…</span>
          : locked ? <span className="inline-flex items-center gap-1 text-meta text-muted-ink"><Icon name="Lock" size="sm" />Locked</span>
          : moves ? <Icon name="ChevronDown" size="sm" color="var(--color-text-muted)" /> : null}
      </button>
      {open && moves && (
        <div role="menu" className="absolute z-[60] right-0 top-full mt-1 w-[300px] max-w-[calc(100vw-48px)] p-1 bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)]">
          {moves.map(m => (
            <button key={m.to + m.label} type="button" role="menuitem" disabled={!m.allowed}
              onClick={() => { setOpen(false); onPick(m); }}
              className={cx('w-full text-left flex gap-[10px] items-start px-[10px] py-[9px] rounded-[8px] border-none bg-transparent [font:inherit]',
                m.allowed ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-60')}>
              <span className="mt-[1px]" style={{ color: TONE[STATUS[m.to].tone].fg }}><Icon name={MOVE_ICON[m.to] ?? 'ArrowRight'} size="sm" /></span>
              <span className="flex flex-col gap-[2px] min-w-0">
                <span className={cx('text-copy font-semibold', m.to === 'cancelled' || m.to === 'no_show' ? 'text-[var(--color-critical-fg)]' : 'text-ink')}>{m.label}</span>
                <span className="text-meta text-muted-ink leading-[1.4]">{m.allowed ? m.hint : m.reason}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

const KIND_LABEL: Record<Payment['kind'], string> = { guest_payment: 'Guest payment', ota_payout: 'Payout', refund: 'Refund' };

/** The money in three parts that add up: what the guest paid, what the platform took, what we receive. The server
 *  works the figures out (functions/_lib/bookingMoney.ts); where its sources disagree it says so, and the figures
 *  behind it are one click away instead of being shown side by side as if they agreed. */
function MoneyPanel({ d, onRecord, onRemove }: { d: Detail; onRecord: () => void; onRemove: (p: Payment) => void }) {
  const L = d.ledger;
  const [sources, setSources] = useState(false);
  const dead = d.state === 'cancelled' || d.state === 'no_show';
  const site = CHANNEL_META[d.channel].label;
  const ota = d.channel === 'airbnb' || d.channel === 'booking_com' || d.channel === 'agoda';

  return (
    <div className="flex flex-col gap-2">
      <div className="border border-solid border-line rounded-card overflow-hidden">
        <Group title="1 · What the guest paid">
          {L.guestLines.map(l => <Line key={l.key} label={l.label} sub={l.sub} value={rm(l.amount)} />)}
          <Line strong label={dead ? `Guest total before it was ${d.state === 'cancelled' ? 'cancelled' : 'marked no-show'}` : 'Guest total'}
            value={L.guestTotal > 0 ? rm(L.guestTotal) : 'Not recorded'} muted={L.guestTotal <= 0}
            sub={!L.guestLines.length && L.guestTotal > 0 ? 'No breakdown recorded for this booking.' : undefined} />
          {L.otaTax ? <Line label={`Tax collected by ${site}`} sub="Paid by the guest to the site and kept by it. Not ours." value={rm(L.otaTax)} muted /> : null}
        </Group>
        {L.platformLines.length > 0 && (
          <Group title="2 · Taken by the platform">
            {L.platformLines.map(l => <Line key={l.key} label={l.label} sub={l.sub} value={rm(l.amount)} minus />)}
          </Group>
        )}
        <Group title={`${L.platformLines.length ? 3 : 2} · What we receive`}>
          {dead ? (
            <Line strong label={d.state === 'cancelled' ? 'Kept after cancellation' : 'Kept after no-show'} value={rm(L.received)}
              sub={L.received ? undefined : 'No money is recorded on this booking.'} />
          ) : <>
            <Line strong label="Expected" value={rm(L.expected)} sub={L.platformTotal ? `Guest total less ${ota ? site : 'the platform'}'s share` : undefined} />
            {L.receivedBefore > 0 && <Line label="Received before payments were recorded here" sub="From the HostPlatform or workbook import" value={rm(L.receivedBefore)} />}
            {L.payments.map(p => (
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
                  <span className={cx('text-copy [font-variant-numeric:tabular-nums] whitespace-nowrap', p.status === 'expected' && 'text-[var(--color-warning-fg)]')}>
                    {p.kind === 'refund' ? `− ${rm(p.amount)}` : rm(p.amount)}{p.status === 'expected' ? ' not received' : ''}
                  </span>
                  {p.source === 'manual' && d.can.recordPayment && (
                    <button type="button" onClick={() => onRemove(p)} aria-label="Remove this payment" title="Remove this payment"
                      className="w-7 h-7 grid place-items-center rounded-control border-none bg-transparent text-muted-ink cursor-pointer hover:bg-muted"><Icon name="Trash2" size="sm" /></button>
                  )}
                </span>
              </div>
            ))}
            <Line strong label="Received" value={rm(L.received)} />
            <Line strong label="Outstanding" value={L.outstanding > 0 ? rm(L.outstanding) : 'Nothing'}
              sub={L.outstanding > 0 ? (ota ? `${site} has not paid this out yet.` : 'Still owed by the guest.') : undefined} />
            {L.paymentMethod && <Line label="Payment method" value={L.paymentMethod} />}
          </>}
        </Group>
      </div>

      {L.disagree && (
        <div role="note" className="rounded-control border border-solid border-[var(--color-warning-line)] bg-[var(--color-warning-bg)] px-3 py-[10px] text-meta flex flex-col gap-1">
          <span className="font-semibold text-[var(--color-warning-fg)] flex items-center gap-[6px]"><Icon name="AlertTriangle" size="sm" />Sources disagree</span>
          <span className="text-ink leading-[1.45]">{L.disagree}</span>
        </div>
      )}
      {L.sources.length > 1 && (
        <button type="button" onClick={() => setSources(v => !v)} aria-expanded={sources}
          className={cx('self-start p-0 border-none bg-transparent [font:inherit] text-meta underline cursor-pointer', L.disagree ? 'font-semibold text-ink' : 'text-muted-ink')}>
          {sources ? 'Hide sources' : 'View sources'}
        </button>
      )}
      {sources && (
        <div className="border border-solid border-line rounded-card overflow-hidden">
          {L.sources.map((x, i) => (
            <div key={i} className="flex justify-between gap-3 px-[14px] py-[7px] text-meta [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
              <span className="flex flex-col min-w-0"><span className="text-ink">{x.label}</span><span className="text-caption text-muted-ink">{x.from}</span></span>
              <span className="[font-variant-numeric:tabular-nums] whitespace-nowrap">{x.amount == null ? '—' : rm(x.amount)}</span>
            </div>
          ))}
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
              e.upcoming ? 'bg-card [border-color:var(--color-line)]' : 'bg-[var(--color-success-fg)] [border-color:var(--color-success-fg)]')} />
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

/** Cancel / no-show / remove block: says what happens, asks why, then does it. */
function ReasonModal({ title, body, meta, confirmLabel, keepLabel, onClose, onConfirm }: {
  title: string; body: string; meta: string; confirmLabel: string; keepLabel: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    await onConfirm(reason.trim());
    setBusy(false);
  }
  return (
    <CentreModal title={title} sub={body} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta">{meta}</div>
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="bk-reason" className="text-meta font-medium text-muted-ink">Reason (required)</label>
          <textarea id="bk-reason" autoFocus required value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300}
            placeholder="e.g. Guest asked to cancel by WhatsApp"
            className="block w-full box-border text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy p-[10px_12px] resize-y" />
        </div>
        <div className="flex justify-end gap-[9px] flex-wrap">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>{keepLabel}</Button>
          <Button type="submit" size="sm" variant="danger" loading={busy} disabled={!reason.trim()} disabledReason="Write a reason first.">{busy ? 'Saving…' : confirmLabel}</Button>
        </div>
      </form>
    </CentreModal>
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
            placeholder={`Hi ${(r.guestName || 'there').split(' ')[0]}, checking in on your upcoming stay…`}
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
  const perNight = d.nights > 0 && d.money.gross > 0 ? d.money.gross / d.nights : 0;

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
    <CentreModal title="Change dates" sub="Checked against the unit's other bookings before it is saved. The guest is not messaged." onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta text-muted-ink">
          Now: {dateRange(d.checkIn, d.checkOut)} · {fmtNights(d.nights)}{d.money.gross > 0 ? ` · ${rm(d.money.gross)}` : ''}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
          <DateField label="Check-in" value={checkIn} onChange={setCheckIn} required disabled={inHouse} error={fieldErrors.checkIn}
            help={inHouse ? 'The guest is already in.' : undefined} />
          <DateField label="Check-out" value={checkOut} min={checkIn || undefined} onChange={setCheckOut} required
            error={checkIn && checkOut && n < 1 ? 'Check-out must be after check-in.' : fieldErrors.checkOut}
            help={n >= 1 && (checkIn !== d.checkIn || checkOut !== d.checkOut) ? `New stay: ${dateRange(checkIn, checkOut)} · ${fmtNights(n)}` : undefined} />
        </div>
        {priced ? (
          <MoneyInput label="Total for the stay (RM)" valueSen={totalSen} onChangeSen={setTotalSen} required
            error={totalSen == null ? 'Enter the total, or 0.00.' : fieldErrors.grossBookingValue}
            help={perNight > 0 && n >= 1 && n !== d.nights
              ? `At the current ${rm(Math.round(perNight))} a night, ${fmtNights(n)} would be ${rm(Math.round(perNight * n))}. Change the total if the price changes.`
              : 'Stays the same unless you change it.'} />
        ) : !isBlock(d.channel) && (
          <p className="m-0 text-meta text-muted-ink">The price is set by {CHANNEL_META[d.channel].label}, so it stays as recorded. Change the booking on the site too.</p>
        )}
        {error && <p role="alert" className="m-0 text-meta text-[var(--color-critical-fg)]">{error}</p>}
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
  const valid = sen != null && sen > 0 && !!receivedOn;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || sen == null) return;
    setBusy(true); setErrors({});
    try {
      await api.post(`/reservations/${d.id}/payments`, { amount: sen, receivedOn, kind, method, reference: reference || undefined, note: note || undefined });
      const left = kind === 'refund' ? d.ledger.outstanding + sen : Math.max(d.ledger.outstanding - sen, 0);
      onSaved(`${kind === 'refund' ? 'Refund' : 'Payment'} of ${rm(sen)} recorded. ${left > 0 ? `${rm(left)} still outstanding.` : 'Nothing is outstanding now.'}`);
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
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={cx('h-9 rounded-[8px] border-none [font:inherit] text-meta cursor-pointer', kind === k ? 'bg-card font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-ink')}>
              {k === 'guest_payment' ? 'From the guest' : k === 'ota_payout' ? 'Site payout' : 'Refund'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <MoneyInput label="Amount (RM)" valueSen={sen} onChangeSen={setSen} minSen={1} required error={errors.amount} />
          <DateField label={kind === 'refund' ? 'Refunded on' : 'Received on'} value={receivedOn} max={todayIso()} onChange={setReceivedOn} required error={errors.receivedOn} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-method" className="text-meta font-medium text-muted-ink">Method</label>
            <select id="pay-method" value={method} onChange={e => setMethod(e.target.value)}
              className="h-10 rounded-control border border-solid border-line bg-card text-ink [font:inherit] text-copy px-3">
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <Field label="Reference (optional)" value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank or receipt reference" />
        </div>
        <Field label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Deposit, balance on arrival" />
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!valid} disabledReason="Enter an amount and a date.">{busy ? 'Saving…' : 'Record payment'}</Button>
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
      onSaved(`Check-in from ${inTime} on ${date(d.checkIn)}, check-out by ${outTime} on ${date(d.checkOut)}. Cleaning plans with the new times.`);
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      toast({ tone: 'critical', title: 'Times not changed.', body: failMessage(err) });
    }
    setBusy(false);
  }
  return (
    <CentreModal title="Check-in and check-out times" sub="For an early check-in or a late check-out. The dates do not change, and the guest is not messaged." onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <TimeField label={`Check-in from (${date(d.checkIn)})`} value={inTime} onChange={setInTime} required disabled={d.state === 'checked_in'}
            help={d.state === 'checked_in' ? 'The guest is already in.' : 'Standard 15:00'} error={errors.checkInTime} />
          <TimeField label={`Check-out by (${date(d.checkOut)})`} value={outTime} onChange={setOutTime} required help="Standard 11:00" error={errors.checkOutTime} />
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
        <div className="flex justify-end"><CloseButton onClose={onClose} /></div>
        <div className="text-copy text-muted-ink">{error ?? 'Loading the booking…'}</div>
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
      toast({ tone: m.to === 'cancelled' || m.to === 'no_show' ? 'neutral' : 'success', title: `${s!.externalRef ?? 'Booking'} is now ${STATUS[res.state].label}.`, body: bits.join(' ') || undefined });
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
          body: [`${s!.guestName || 'The copy'} starts on ${date(res.checkIn)}.`, res.channel !== s!.channel ? 'It is a direct booking: it is not on the original booking site.' : '', channelNote(res.effects?.channel, 'held')].filter(Boolean).join(' '),
        });
        onChanged?.(id); onDuplicated?.(res.id);
      })
      .catch(err => toast({ tone: 'critical', title: 'Booking not duplicated.', body: failMessage(err) }));
  }

  const pick = (m: Move) => { if (m.needsReason) setAsking(m); else void move(m); };
  const cancelMove = d?.moves.find(m => m.to === 'cancelled' && m.allowed);
  const metaLine = `${s.guestName || ch.label} · ${s.propertyName} ${s.unitNumber} · ${dateRange(s.checkIn, s.checkOut)}`;
  const saved = (msg: string) => { toast({ tone: 'success', title: msg }); reload(); onChanged?.(id); };
  const nationality = d ? countryName(d.nationality) : null;

  return (
    <>
      <div className="relative z-[1] flex-none bg-[#151515] text-white px-[18px] pt-[14px] pb-[16px] flex flex-col gap-[10px]">
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
            <StatusMenu state={s.state} moves={d ? d.moves : null} busy={busy} onPick={pick} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-px bg-line border border-solid border-line rounded-card overflow-hidden">
          {([
            [date(s.checkIn), `Check-in${s.checkInTime ? ` · from ${s.checkInTime}` : ''}`],
            [date(s.checkOut), `Check-out${s.checkOutTime ? ` · by ${s.checkOutTime}` : ''}`],
            [fmtNights(nights), 'Length'],
            [s.guestsCount > 0 ? fmtGuests(s.guestsCount) : '—', 'Guests'],
          ] as const).map(([v, l]) => (
            <div key={l} className="bg-card py-[11px] px-[13px] flex flex-col gap-0.5">
              <span className="text-copy font-semibold">{v}</span>
              <span className="text-caption text-muted-ink">{l}</span>
            </div>
          ))}
        </div>
        {d && live && (
          <button type="button" onClick={() => setTimesOpen(true)}
            className="self-start -mt-3 p-0 border-none bg-transparent [font:inherit] text-meta text-ink underline cursor-pointer">Change check-in or check-out time</button>
        )}

        {!block && d && (
          <div className="flex flex-col gap-1 text-copy">
            <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink mb-1">Guest</div>
            <div className="flex justify-between gap-3"><span className="text-muted-ink">Phone</span><span className="text-right break-all">{d.guestPhone ? <a href={`tel:${d.guestPhone.replace(/[^0-9+]/g, '')}`} className="text-ink">{d.guestPhone}</a> : '—'}</span></div>
            {d.guestEmail && <div className="flex justify-between gap-3"><span className="text-muted-ink">Email</span><span className="text-right break-all">{d.guestEmail}</span></div>}
            <div className="flex justify-between gap-3"><span className="text-muted-ink">Nationality</span>
              <span className="text-right">{nationality ?? '—'}{nationality && !/malaysia/i.test(nationality) ? <span className="text-muted-ink"> · tourism tax applies</span> : null}</span></div>
            {d.guestId && <a href={`#/reservations/guests?g=${encodeURIComponent(d.guestId)}`} className="self-start mt-1 text-meta text-ink underline">Open guest profile</a>}
          </div>
        )}

        {block ? (
          <div className="text-copy text-muted-ink">
            <div>{d?.notes ? <>Note: <span className="text-ink">{d.notes}</span></> : 'No note recorded.'}</div>
            {d && <div className="mt-1">{d.money.gross > 0 ? <>Recorded value: <span className="text-ink [font-variant-numeric:tabular-nums]">{rm(d.money.gross)}</span></> : 'No money is recorded on it.'}</div>}
          </div>
        ) : d ? <MoneyPanel d={d} onRecord={() => setPayOpen(true)} onRemove={setRemoving} /> : <div className="h-[120px] rounded-card bg-muted animate-pulse" />}

        {!block && d && <NotesBox d={d} onSaved={reload} />}

        <div>
          <div className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink mb-3">Timeline</div>
          {d ? <Timeline events={d.timeline} /> : <div className="text-meta text-muted-ink">{error ?? 'Loading…'}</div>}
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
              <Button variant="secondary" style={{ flex: 1 }} onClick={() => setDatesOpen(true)} disabled={!d || !d.can.changeDates}
                disabledReason={d?.can.changeDatesReason ?? 'Loading…'}>Change dates</Button>
              <Button variant="danger" style={{ flex: 1 }} onClick={() => cancelMove && setAsking(cancelMove)} disabled={!cancelMove}
                disabledReason={d ? 'A guest who is already in cannot be cancelled. Check them out instead.' : 'Loading…'}>Cancel booking</Button>
            </div>
          )}
          {live && d && !d.can.changeDates && d.can.changeDatesReason && (
            <p className="m-0 text-caption text-muted-ink leading-[1.4]">{d.can.changeDatesReason}</p>
          )}
        </>}
      </div>

      {asking === 'remove_block' && (
        <ReasonModal title={s.channel === 'owner_stay' ? 'Remove this owner stay?' : 'Remove this block?'} body="The nights go back on sale. A unit linked to Channex has them reopened on the booking sites."
          meta={metaLine} confirmLabel={s.channel === 'owner_stay' ? 'Remove owner stay' : 'Remove block'} keepLabel="Keep it" onClose={() => setAsking(null)} onConfirm={removeBlock} />
      )}
      {asking && asking !== 'remove_block' && (
        <ReasonModal
          title={asking.to === 'cancelled' ? `Cancel ${s.externalRef ?? 'this booking'}?` : `Mark ${s.guestName || 'this guest'} as a no-show?`}
          body={asking.to === 'cancelled'
            ? 'The dates go back on sale. The guest is not messaged and no refund is made from here: do those on the booking site or by message.'
            : 'The nights from today on go back on sale. The guest is not messaged.'}
          meta={metaLine}
          confirmLabel={asking.to === 'cancelled' ? 'Cancel booking' : 'Mark no-show'}
          keepLabel="Keep booking"
          onClose={() => setAsking(null)} onConfirm={reason => move(asking, reason)} />
      )}
      {datesOpen && d && (
        <ChangeDatesModal d={d} onClose={() => setDatesOpen(false)}
          onSaved={v => {
            setDatesOpen(false);
            toast({ tone: 'success', title: 'Dates changed.', body: [`Now ${dateRange(v.checkIn, v.checkOut)}.`, channelNote(v.channel, 'moved'), block ? '' : 'The guest was not messaged.'].filter(Boolean).join(' ') });
            reload(); onChanged?.(id);
          }} />
      )}
      {timesOpen && d && <TimesModal d={d} onClose={() => setTimesOpen(false)} onSaved={msg => { setTimesOpen(false); saved(msg); }} />}
      {payOpen && d && <RecordPaymentModal d={d} onClose={() => setPayOpen(false)} onSaved={msg => { setPayOpen(false); saved(msg); }} />}
      {removing && (
        <CentreModal title="Remove this payment?" sub={`${KIND_LABEL[removing.kind]} of ${rm(removing.amount)}${removing.receivedOn ? ` on ${date(removing.receivedOn)}` : ''}. Use this only for one recorded by mistake; the removal is kept in the audit log.`} onClose={() => { if (!busy) setRemoving(null); }}>
          <div className="px-[22px] py-4 flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>Keep it</Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => removePayment(removing)}>Remove payment</Button>
          </div>
        </CentreModal>
      )}
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
