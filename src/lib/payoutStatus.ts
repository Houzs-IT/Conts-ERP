import { date, rm, todayMyt } from './format';
import { CHANNEL_META } from './design-tokens';
import type { BookingChannel } from './types';

/** One plain line about the money on a reservation, the way Airbnb's reservation details end with the payout's state.
 *  Channel stays (Airbnb, Booking.com, Agoda) talk about the host payout; direct stays about what the guest has paid.
 *  The figures come from the server (functions/_lib/bookingMoney.ts); this only words them. */

export const OTA_CHANNELS: BookingChannel[] = ['airbnb', 'booking_com', 'agoda'];

export interface MoneyState {
  channel: BookingChannel; state: string; checkIn: string; checkOut: string;
  expected: number; received: number; outstanding: number;
  /** The latest day money arrived, when known. */
  paidOn: string | null;
}

export type PayoutTone = 'success' | 'warning' | 'neutral' | 'info';

export function payoutStatus(m: MoneyState, today = todayMyt()): { text: string; tone: PayoutTone } {
  const ota = OTA_CHANNELS.includes(m.channel);
  const site = CHANNEL_META[m.channel]?.label ?? 'The channel';
  if (m.state === 'cancelled' || m.state === 'no_show') {
    const what = m.state === 'cancelled' ? 'Cancelled' : 'No-show';
    return m.received > 0 ? { text: `${what}. ${rm(m.received)} was kept.`, tone: 'neutral' } : { text: `${what}. Nothing was ${ota ? 'paid out' : 'paid'}.`, tone: 'neutral' };
  }
  const on = m.paidOn ? ` on ${date(m.paidOn)}` : '';
  if (m.outstanding <= 0 && m.received > 0) return { text: ota ? `Paid${on}` : `Paid in full${on}`, tone: 'success' };
  if (m.expected <= 0 && m.received <= 0) return { text: ota ? 'No payout recorded' : 'No price recorded', tone: 'neutral' };
  if (m.received > 0) return { text: `Part paid: ${rm(m.received)} received, ${rm(m.outstanding)} ${ota ? 'still to come' : 'still owed'}`, tone: 'warning' };
  if (ota) {
    // Airbnb releases a payout about a day after check-in; Booking.com and Agoda pay after the stay.
    if (m.channel === 'airbnb' && today <= m.checkIn) return { text: 'Expected the day after check-in', tone: 'info' };
    if (m.channel !== 'airbnb' && today < m.checkOut) return { text: `Expected from ${site} after checkout`, tone: 'info' };
    return { text: `Not paid out yet by ${site}`, tone: 'warning' };
  }
  return { text: today < m.checkIn ? 'Not paid yet' : 'Not paid yet, the stay has started', tone: 'warning' };
}
