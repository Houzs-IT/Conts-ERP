/** The one pricing rule, shared by the Pricing page, the Calendar and what is sent to Channex:
 *  a night's price on a channel is the price set for that night if there is one, otherwise
 *  (base rate + the channel's uplift), with the weekend multiplier on Friday and Saturday nights. */
export const WEEKEND_MULTIPLIER = 1.22;
export const SALES_CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'] as const;
export type SalesChannel = typeof SALES_CHANNELS[number];
export const OTA_CHANNELS = ['airbnb', 'booking_com', 'agoda'] as const;

/** Until someone sets an uplift by hand, each OTA adds this share of the base rate. */
const DEFAULT_UPLIFT: Record<string, number> = { airbnb: 0.12, booking_com: 0.18, agoda: 0.16 };

/** The share of the base rate a channel adds while nobody has set its uplift by hand. */
export const defaultUpliftShare = (channel: string) => DEFAULT_UPLIFT[channel] ?? 0;

/** A channel's uplift in sen: the one saved for the unit, else the default share of its base rate. Direct has none. */
export function upliftFor(channel: string, baseSen: number, saved: number | null | undefined): number {
  if (channel === 'web') return 0;
  return saved !== null && saved !== undefined ? Number(saved) : Math.round(baseSen * (DEFAULT_UPLIFT[channel] ?? 0));
}

const isWeekendNight = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 5 || d === 6; };

/** Standard price in sen for a night with no price of its own. */
export function standardRate(baseSen: number, upliftSen: number, date: string): number {
  const rate = baseSen + upliftSen;
  return isWeekendNight(date) ? Math.round(rate * WEEKEND_MULTIPLIER) : rate;
}
