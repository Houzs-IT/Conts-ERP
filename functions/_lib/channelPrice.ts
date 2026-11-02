/** The one pricing rule, shared by the Pricing page, the Calendar, the public showcase and what is sent to Channex.
 *
 *  A night's price on a channel, in order (owner, 2 Nov 2026):
 *    1. the custom price set for that night on that channel (channel_rates), if any;
 *    2. on a public holiday (and the night before, when the unit prices holiday eves): the holiday price;
 *    3. on a Friday or Saturday night: the weekend price;
 *    4. the nightly price.
 *  A level the unit has no price for falls back to the next one down: a holiday with no holiday price sells at the
 *  weekend price on a Friday or Saturday and at the nightly price otherwise.
 *
 *  Each channel's price per level comes from the direct price of that level by the channel's rule:
 *    default  (nobody set one)  direct + the channel's default share (Airbnb 12%, Booking.com 18%, Agoda 16%);
 *    amount   direct + a fixed amount in sen (what "uplift" always was);
 *    percent  direct + a percentage;
 *    fixed    the channel's own price per level, whatever the direct price is.
 *  There is no weekend multiplier: migration 0092 gave every priced unit a weekend rate of round(base * 1.22). */
export const SALES_CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'] as const;
export type SalesChannel = typeof SALES_CHANNELS[number];
export const OTA_CHANNELS = ['airbnb', 'booking_com', 'agoda'] as const;
export type OtaChannel = typeof OTA_CHANNELS[number];
export const PRICE_LEVELS = ['base', 'weekend', 'holiday'] as const;
export type PriceLevel = typeof PRICE_LEVELS[number];

/** Until someone sets a rule by hand, each channel adds this share of the night's direct price. */
const DEFAULT_UPLIFT: Record<string, number> = { airbnb: 0.12, booking_com: 0.18, agoda: 0.16 };

/** The share of the direct price a channel adds while nobody has set its rule by hand. */
export const defaultUpliftShare = (channel: string) => DEFAULT_UPLIFT[channel] ?? 0;

export type ChannelMode = 'default' | 'amount' | 'percent' | 'fixed';
export interface ChannelRule {
  mode: ChannelMode;
  /** sen above the direct price (mode amount) */
  uplift?: number | null;
  /** percent above the direct price (mode percent) */
  percent?: number | null;
  /** the channel's own price per level, sen (mode fixed); weekend and holiday may be empty */
  fixedBase?: number | null; fixedWeekend?: number | null; fixedHoliday?: number | null;
}
export const DEFAULT_RULE: ChannelRule = { mode: 'default' };

/** A channel_uplifts row (any migration level) as a rule. No row is the default rule. */
export function ruleFromRow(row: { uplift?: unknown; mode?: unknown; percent?: unknown; fixed_base?: unknown; fixed_weekend?: unknown; fixed_holiday?: unknown } | null | undefined): ChannelRule {
  if (!row) return DEFAULT_RULE;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const mode = typeof row.mode === 'string' ? row.mode : 'amount';
  if (mode === 'percent' && n(row.percent) !== null) return { mode, percent: n(row.percent) };
  if (mode === 'fixed' && n(row.fixed_base)) return { mode, fixedBase: n(row.fixed_base), fixedWeekend: n(row.fixed_weekend), fixedHoliday: n(row.fixed_holiday) };
  if (n(row.uplift) !== null) return { mode: 'amount', uplift: n(row.uplift) };
  return DEFAULT_RULE;
}

/** What a unit charges direct per level. weekend and holiday may be empty (fall back as described above). */
export interface UnitLevels { base: number; weekend: number | null; holiday: number | null; holidayEve: boolean }
/** One channel's price per level. holiday is null when that channel has no holiday price (the night then sells at
 *  the weekend or nightly price). */
export interface LevelPrices { base: number; weekend: number; holiday: number | null }

/** One direct price moved by a channel's rule (not used for fixed). */
function onTop(channel: string, direct: number, rule: ChannelRule): number {
  if (channel === 'web') return direct;
  if (rule.mode === 'amount') return direct + Number(rule.uplift ?? 0);
  if (rule.mode === 'percent') return direct + Math.round(direct * Number(rule.percent ?? 0) / 100);
  return direct + Math.round(direct * (DEFAULT_UPLIFT[channel] ?? 0));
}

/** A channel's price for each level of a unit. */
export function levelPrices(channel: string, u: UnitLevels, rule: ChannelRule = DEFAULT_RULE): LevelPrices {
  const weekendDirect = u.weekend ?? u.base;
  if (channel !== 'web' && rule.mode === 'fixed' && rule.fixedBase) {
    return { base: Number(rule.fixedBase), weekend: Number(rule.fixedWeekend ?? rule.fixedBase), holiday: rule.fixedHoliday ? Number(rule.fixedHoliday) : null };
  }
  return { base: onTop(channel, u.base, rule), weekend: onTop(channel, weekendDirect, rule), holiday: u.holiday ? onTop(channel, u.holiday, rule) : null };
}

/** Friday and Saturday nights. */
export const isWeekendNight = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 5 || d === 6; };
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** Whether a night is priced as a holiday for a unit: the holiday itself, or the night before one when the unit
 *  prices holiday eves. `holidays` are the dates that apply to the unit (its building's state, or every state). */
export function isHolidayNight(date: string, holidays: ReadonlySet<string>, holidayEve: boolean): boolean {
  return holidays.has(date) || (holidayEve && holidays.has(nextDay(date)));
}

/** The level a night sells at, for a channel's prices: holiday (if that channel has a holiday price), else weekend
 *  on Friday and Saturday, else the nightly price. */
export function levelOn(lp: LevelPrices, date: string, holidayNight: boolean): PriceLevel {
  if (holidayNight && lp.holiday !== null) return 'holiday';
  return isWeekendNight(date) ? 'weekend' : 'base';
}

/** The standard price of a night with no custom price, in sen. */
export function priceOn(lp: LevelPrices, date: string, holidayNight: boolean): number {
  const level = levelOn(lp, date, holidayNight);
  return level === 'holiday' ? lp.holiday! : level === 'weekend' ? lp.weekend : lp.base;
}

/** A channel's amount above a direct price under the default or amount rule, in sen (the Calendar's Rate update
 *  prices a new direct price this way). Direct has none. Percent and fixed rules are handled by levelPrices. */
export function upliftFor(channel: string, webSen: number, saved: number | null | undefined): number {
  if (channel === 'web') return 0;
  return saved !== null && saved !== undefined ? Number(saved) : Math.round(webSen * (DEFAULT_UPLIFT[channel] ?? 0));
}

/** A channel's price for a new direct price of one night, under its rule: the Calendar's "Change prices" sets the
 *  direct price of chosen nights and each channel follows it. A channel on fixed prices keeps the proportion it has
 *  to the direct price on that night's level (Booking.com fixed at RM 300 against a direct RM 250 stays 20% above),
 *  since a fixed price has no rule of its own to apply to a new direct price. */
export function channelFromDirect(channel: string, direct: number, rule: ChannelRule, standard?: { channel: number; direct: number }): number {
  if (channel === 'web') return direct;
  if (rule.mode === 'fixed') return standard && standard.direct > 0 ? Math.round(direct * standard.channel / standard.direct) : direct;
  return onTop(channel, direct, rule);
}
