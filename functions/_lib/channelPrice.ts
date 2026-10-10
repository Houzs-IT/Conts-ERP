/** The one pricing rule, shared by the Pricing page, the Calendar and what is sent to Channex:
 *  a night's price on a channel is the price set for that night if there is one, otherwise
 *  (the night's web price + the channel's uplift). The night's web price is the unit's weekend rate on Friday
 *  and Saturday nights when it has one, and its base rate otherwise.
 *  There is no weekend multiplier any more: migration 0092 gave every priced unit a weekend rate of
 *  round(base * 1.22), so the prices it used to produce stayed put, and a unit without one (new since then)
 *  sells its weekend at the base rate until someone sets one. */
export const SALES_CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'] as const;
export type SalesChannel = typeof SALES_CHANNELS[number];
export const OTA_CHANNELS = ['airbnb', 'booking_com', 'agoda'] as const;

/** Until someone sets an uplift by hand, each OTA adds this share of the night's web price. */
const DEFAULT_UPLIFT: Record<string, number> = { airbnb: 0.12, booking_com: 0.18, agoda: 0.16 };

/** The share of the web price a channel adds while nobody has set its uplift by hand. */
export const defaultUpliftShare = (channel: string) => DEFAULT_UPLIFT[channel] ?? 0;

/** A channel's uplift in sen over a web price of `webSen`: the one saved for the unit, else the default share.
 *  Direct has none. */
export function upliftFor(channel: string, webSen: number, saved: number | null | undefined): number {
  if (channel === 'web') return 0;
  return saved !== null && saved !== undefined ? Number(saved) : Math.round(webSen * (DEFAULT_UPLIFT[channel] ?? 0));
}

/** Friday and Saturday nights. */
export const isWeekendNight = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 5 || d === 6; };

/** The web (direct) price of a night with no price of its own. */
export function webRate(baseSen: number, weekendSen: number | null | undefined, date: string): number {
  return isWeekendNight(date) && weekendSen ? Number(weekendSen) : baseSen;
}

/** Standard price in sen of a night with no price of its own, on one channel. A default uplift is a share of
 *  that night's web price, so a weekend night's uplift follows the weekend rate. */
export function standardRate(channel: string, baseSen: number, weekendSen: number | null | undefined, savedUplift: number | null | undefined, date: string): number {
  const web = webRate(baseSen, weekendSen, date);
  return web + upliftFor(channel, web, savedUplift);
}
