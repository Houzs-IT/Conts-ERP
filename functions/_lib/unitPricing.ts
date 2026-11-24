import { type Env, all } from './db';
import { hasColumn } from './auth';
import { holidayDatesByUnit } from './holidays';
import {
  OTA_CHANNELS, SALES_CHANNELS, ruleFromRow, levelPrices, priceOn, isHolidayNight, DEFAULT_RULE,
  type ChannelRule, type LevelPrices, type OtaChannel, type SalesChannel, type UnitLevels,
} from './channelPrice';

/** Everything the price rule (channelPrice.ts) needs about a set of units, read in four queries whatever their
 *  number: their price levels, each channel's rule, and the holiday dates that apply to them in a date range. */
export interface UnitPricing {
  unitId: string;
  levels: UnitLevels;
  rules: Record<OtaChannel, ChannelRule>;
  /** holiday dates that apply to the unit, within the range asked for (plus the day after, for holiday eves) */
  holidays: Set<string>;
  state: string | null;
}

export const pricingReady = (env: Env): Promise<boolean> => hasColumn(env, 'units', 'holiday_rate');
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const IN = 'IN (SELECT jsonb_array_elements_text(?::text::jsonb))';

/** The pricing of the given units, with the holidays from `from` to `to` (a holiday eve on `to` needs the next day). */
export async function loadPricing(env: Env, unitIds: string[], from: string, to: string): Promise<Map<string, UnitPricing>> {
  const out = new Map<string, UnitPricing>();
  if (!unitIds.length) return out;
  const ready = await pricingReady(env);
  const ids = JSON.stringify([...new Set(unitIds)]);
  const [units, rows] = await Promise.all([
    all<{ id: string; base_rate: number; weekend_rate: number | null; holiday_rate?: number | null; holiday_eve?: boolean; state: string | null }>(env, `
      SELECT u.id, u.base_rate, u.weekend_rate, ${ready ? 'u.holiday_rate, u.holiday_eve,' : ''} p.state
      FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id ${IN}`, ids),
    all<{ unit_id: string; channel: string; uplift: unknown; mode?: unknown; percent?: unknown; fixed_base?: unknown; fixed_weekend?: unknown; fixed_holiday?: unknown }>(env, `
      SELECT unit_id, channel, uplift${ready ? ', mode, percent, fixed_base, fixed_weekend, fixed_holiday' : ''} FROM channel_uplifts WHERE unit_id ${IN}`, ids),
  ]);
  const holidays = await holidayDatesByUnit(env, units.map(u => ({ id: u.id, state: u.state })), from, addDays(to, 1));
  for (const u of units) {
    const rules = Object.fromEntries(OTA_CHANNELS.map(ch => [ch, ruleFromRow(rows.find(r => r.unit_id === u.id && r.channel === ch))])) as Record<OtaChannel, ChannelRule>;
    out.set(u.id, {
      unitId: u.id, state: u.state, rules, holidays: holidays.get(u.id) ?? new Set(),
      levels: {
        base: Number(u.base_rate), weekend: u.weekend_rate == null ? null : Number(u.weekend_rate),
        holiday: u.holiday_rate == null ? null : Number(u.holiday_rate), holidayEve: !!u.holiday_eve,
      },
    });
  }
  return out;
}

/** A channel's prices per level for a unit. */
export const pricesFor = (p: UnitPricing, channel: string): LevelPrices =>
  levelPrices(channel, p.levels, channel === 'web' ? DEFAULT_RULE : p.rules[channel as OtaChannel] ?? DEFAULT_RULE);

/** Whether the unit prices this night as a holiday. */
export const holidayNight = (p: UnitPricing, date: string) => isHolidayNight(date, p.holidays, p.levels.holidayEve);

/** The standard price of one night on one channel (no custom price), in sen. */
export const standardPrice = (p: UnitPricing, channel: string, date: string): number => priceOn(pricesFor(p, channel), date, holidayNight(p, date));

/** Every channel's prices per level, Direct first. */
export const grid = (p: UnitPricing): Record<SalesChannel, LevelPrices> =>
  Object.fromEntries(SALES_CHANNELS.map(ch => [ch, pricesFor(p, ch)])) as Record<SalesChannel, LevelPrices>;
