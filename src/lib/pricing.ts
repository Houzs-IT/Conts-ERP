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

/** One channel's price per level (functions/_lib/channelPrice.ts LevelPrices). */
export interface LevelPrices { base: number; weekend: number; holiday: number | null }
/** How a channel is priced for a unit (functions/_lib/channelPrice.ts ChannelRule). */
export interface ChannelRule { mode: 'default' | 'amount' | 'percent' | 'fixed'; uplift?: number | null; percent?: number | null; fixedBase?: number | null; fixedWeekend?: number | null; fixedHoliday?: number | null }

/** A night with no custom price: holiday (when it is one and the channel has a holiday price), else weekend on Friday
 *  and Saturday, else the nightly price. Same rule as functions/_lib/channelPrice.ts priceOn. */
export function standardOn(lp: LevelPrices, date: string, holiday: boolean): number {
  if (holiday && lp.holiday != null) return lp.holiday;
  return isWeekendIso(date) ? lp.weekend : lp.base;
}

/** What a channel adds over a new direct price of a weekday night, by its rule (functions/_lib/channelPrice.ts
 *  channelFromDirect): an amount, a percentage, the default share, or for a fixed channel the proportion of its
 *  nightly price to the unit's nightly price. */
export function channelOver(channel: 'web' | BookingChannel, webSen: number, rule: ChannelRule | undefined, saved: number | undefined, share: number | undefined, unitBase: number): number {
  if (channel === 'web' || channel === 'direct') return 0;
  if (rule?.mode === 'percent') return Math.round(webSen * Number(rule.percent ?? 0) / 100);
  if (rule?.mode === 'fixed') return unitBase > 0 && rule.fixedBase ? Math.round(webSen * rule.fixedBase / unitBase) - webSen : 0;
  return upliftOver(channel, webSen, rule?.mode === 'amount' ? Number(rule.uplift ?? 0) : saved, share);
}
