import { rm, date } from './format';
import type { BookingChannel, ReservationState } from './types';

/** One plain sentence on where a reservation's money stands, for the drawer and the guest profile.
 *  It only words figures the server already worked out (functions/_lib/bookingMoney.ts); it computes none. */
export interface MoneyState {
  channel: BookingChannel; state: ReservationState;
  expected: number; received: number; outstanding: number;
  /** The day the last money arrived, when known. */
  paidOn: string | null;
}

export const isOtaChannel = (c: BookingChannel) => c === 'airbnb' || c === 'booking_com' || c === 'agoda';

export function moneyStatus(m: MoneyState): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  const ota = isOtaChannel(m.channel);
  if (m.state === 'cancelled' || m.state === 'no_show') {
    return m.received > 0 ? { label: `${rm(m.received)} kept`, tone: 'neutral' } : { label: 'Nothing kept', tone: 'neutral' };
  }
  if (m.outstanding <= 0 && m.received > 0) {
    return { label: m.paidOn ? `${ota ? 'Paid' : 'Paid in full'} on ${date(m.paidOn)}` : ota ? 'Paid' : 'Paid in full', tone: 'success' };
  }
  if (m.outstanding <= 0) return { label: 'Nothing to collect', tone: 'neutral' };
  if (m.received > 0) return { label: `${rm(m.received)} of ${rm(m.expected)} received · ${rm(m.outstanding)} to come`, tone: 'warning' };
  const before = m.state === 'inquiry' || m.state === 'pending' || m.state === 'confirmed';
  if (ota) return before ? { label: 'Expected after check-in', tone: 'neutral' } : { label: 'Not paid yet', tone: 'warning' };
  return { label: `Not paid yet · ${rm(m.outstanding)} due`, tone: before ? 'neutral' : 'warning' };
}

/** The latest day money came in: a received payment's date, else the payout date the channel reported. */
export function lastPaidOn(payments: { status: string; kind: string; receivedOn: string | null }[], payoutDate: string | null): string | null {
  const days = payments.filter(p => p.status === 'received' && p.kind !== 'refund' && p.receivedOn).map(p => p.receivedOn!.slice(0, 10)).sort();
  return days[days.length - 1] ?? (payoutDate ? payoutDate.slice(0, 10) : null);
}
