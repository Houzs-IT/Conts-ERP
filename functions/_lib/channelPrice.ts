/** The one pricing rule, shared by the Pricing page, the Calendar and what is sent to Channex:
 *  a night's price on a channel is the price set for that night if there is one, otherwise
 *  the unit's rate for that kind of night plus the channel's uplift. Friday and Saturday nights use
 *  the unit's own weekend rate, or base rate times the weekend multiplier when none is set. */
export const WEEKEND_MULTIPLIER = 1.22;
export const SALES_CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'] as const;
export type SalesChannel = typeof SALES_CHANNELS[number];
export const OTA_CHANNELS = ['airbnb', 'booking_com', 'agoda'] as const;

/** Until someone sets an uplift by hand, each OTA adds this share of the base rate. */
const DEFAULT_UPLIFT: Record<string, number> = { airbnb: 0.12, booking_com: 0.18, agoda: 0.16 };

/** A channel's uplift in sen: the one saved for the unit, else the default share of its base rate. Direct has none. */
export function upliftFor(channel: string, baseSen: number, saved: number | null | undefined): number {
  if (channel === 'web') return 0;
  return saved !== null && saved !== undefined ? Number(saved) : Math.round(baseSen * (DEFAULT_UPLIFT[channel] ?? 0));
}

const isWeekendNight = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 5 || d === 6; };

/** A unit's direct weekend rate in sen: its own if set, else base times the weekend multiplier. */
export const weekendBase = (baseSen: number, weekendSen: number | null | undefined) =>
  weekendSen !== null && weekendSen !== undefined && Number(weekendSen) > 0 ? Number(weekendSen) : Math.round(baseSen * WEEKEND_MULTIPLIER);

/** Standard price in sen for a night with no price of its own. The uplift covers a channel's commission,
 *  so on a weekend night it grows in step with the rate (uplift x weekend rate / base rate). */
export function standardRate(baseSen: number, upliftSen: number, date: string, weekendSen?: number | null): number {
  if (!isWeekendNight(date)) return baseSen + upliftSen;
  const w = weekendBase(baseSen, weekendSen);
  return Math.round(w + (baseSen > 0 ? upliftSen * (w / baseSen) : upliftSen));
}
