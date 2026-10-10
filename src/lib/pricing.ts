import type { BookingChannel } from './types';

/** The share of the guest's price each booking site keeps, in percent. Used to show what we receive. */
export const COMMISSION: Record<'airbnb' | 'booking_com' | 'agoda', number> = { airbnb: 15, booking_com: 15, agoda: 18 };

/** Friday and Saturday nights: the nights a unit's weekend rate applies to. `d` is a YYYY-MM-DD date. */
export const isWeekendIso = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 5 || w === 6; };

/** A booking site's uplift over a web price: the one set by hand, else the site's default share of that price.
 *  Same rule as functions/_lib/channelPrice.ts. */
export function upliftOver(channel: 'web' | BookingChannel, webSen: number, saved: number | undefined, share: number | undefined) {
  if (channel === 'web' || channel === 'direct') return 0;
  return saved !== undefined ? saved : Math.round(webSen * (share ?? 0));
}
